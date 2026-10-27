# Shared helpers for the SplitSnap no-install tooling (dot-sourced by the tools/*.ps1 scripts).
#
# Everything runs in headless Microsoft Edge: a script writes a generated JS file under
# tools\.out\, opens an HTML harness with --dump-dom, and parses a JSON result that the page
# writes into <pre id="..."> before the virtual-time budget runs out.
#
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.

Set-StrictMode -Version 2.0

$script:ToolsDir = $PSScriptRoot
$script:DefaultProjectRoot = Split-Path -Parent $PSScriptRoot
$script:OutDir = Join-Path $PSScriptRoot '.out'
# $env:SPLITSNAP_EDGE_PROFILE points a run at another profile folder (e.g. to time a cold start).
$script:EdgeProfileDir = if ($env:SPLITSNAP_EDGE_PROFILE) { $env:SPLITSNAP_EDGE_PROFILE.TrimEnd('\') } else { Join-Path $PSScriptRoot '.edge-profile' }

function Get-EdgePath {
    $candidates = @(
        $env:SPLITSNAP_EDGE,
        'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    throw 'Microsoft Edge (msedge.exe) was not found. Set $env:SPLITSNAP_EDGE to its full path.'
}

function Initialize-OutDir {
    if (-not (Test-Path -LiteralPath $script:OutDir)) {
        New-Item -ItemType Directory -Path $script:OutDir | Out-Null
    }
    return $script:OutDir
}

function Resolve-ProjectRoot([string]$Root) {
    if (-not $Root) { return $script:DefaultProjectRoot }
    return (Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd('\')
}

# Path of $FullPath relative to $Base, always with forward slashes.
function Get-RelativePath([string]$Base, [string]$FullPath) {
    $b = $Base.TrimEnd('\') + '\'
    if ($FullPath.StartsWith($b, [StringComparison]::OrdinalIgnoreCase)) {
        return $FullPath.Substring($b.Length).Replace('\', '/')
    }
    return $FullPath.Replace('\', '/')
}

# Files under $Dir (recursively) whose extension is in $Extensions, skipping node_modules,
# dot-folders and declaration files unless asked. Sorted for deterministic output.
function Get-SourceFiles([string]$Dir, [string[]]$Extensions, [switch]$IncludeDeclarations) {
    if (-not (Test-Path -LiteralPath $Dir)) { return @() }
    $files = Get-ChildItem -LiteralPath $Dir -Recurse -File | Where-Object {
        $ext = $_.Extension.ToLowerInvariant()
        ($Extensions -contains $ext) -and
        ($_.FullName -notmatch '[\\/](node_modules|\.[^\\/]+)[\\/]') -and
        ($IncludeDeclarations -or $_.Name -notmatch '\.d\.ts$')
    }
    return @($files | Sort-Object FullName)
}

function Read-Utf8File([string]$Path) {
    # ReadAllText with an explicit UTF-8 decoder also strips a BOM if present.
    return [IO.File]::ReadAllText($Path, (New-Object Text.UTF8Encoding($false)))
}

function Write-Utf8File([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

# A JSON/JS string literal that is pure ASCII: quotes, backslashes, control characters,
# '<', '>', '&', U+2028/9 and every non-ASCII character become escapes, so the text survives
# any file or console encoding and is safe inside an HTML <script>. Surrogate pairs are
# escaped one UTF-16 unit at a time, which is valid in both JSON and JavaScript.
$script:JsEscapeEvaluator = [Text.RegularExpressions.MatchEvaluator] {
    param($m)
    return ('\u{0:x4}' -f [int]$m.Value[0])
}
$script:JsEscapeRegex = New-Object Text.RegularExpressions.Regex('[^\x20-\x7E]|[<>&]', 'Compiled')

function ConvertTo-JsString([string]$Text) {
    if ($null -eq $Text) { return 'null' }
    # Frequent characters go through fast String.Replace (backslash first); the regex
    # evaluator only sees the rarer ones (other control characters, non-ASCII, < > &).
    $s = $Text.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
    return '"' + $script:JsEscapeRegex.Replace($s, $script:JsEscapeEvaluator) + '"'
}

# Serialises nested hashtables / arrays / strings / numbers / booleans as ASCII-only JSON.
# Hashtable keys keep insertion order when an [ordered] dictionary is passed.
function ConvertTo-AsciiJson($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string]) { return ConvertTo-JsString $Value }
    if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double]) {
        return ([string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0}', $Value))
    }
    if ($Value -is [Collections.IDictionary]) {
        $parts = foreach ($k in $Value.Keys) { (ConvertTo-JsString ([string]$k)) + ':' + (ConvertTo-AsciiJson $Value[$k]) }
        return '{' + ($parts -join ',') + '}'
    }
    if ($Value -is [Collections.IEnumerable]) {
        $parts = foreach ($v in $Value) { ConvertTo-AsciiJson $v }
        return '[' + ($parts -join ',') + ']'
    }
    return ConvertTo-JsString ([string]$Value)
}

# Serialises Edge runs across processes: two headless instances cannot share one
# --user-data-dir, and the generated input files under tools\.out are shared too.
function Enter-EdgeLock([int]$TimeoutSec = 600) {
    $mutex = New-Object Threading.Mutex($false, 'Local\SplitSnapHeadlessEdge')
    $acquired = $false
    try {
        $acquired = $mutex.WaitOne(0)
        if (-not $acquired) {
            Write-Host 'Another SplitSnap headless Edge run is in progress; waiting for it to finish...' -ForegroundColor DarkGray
            $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSec))
        }
    } catch [Threading.AbandonedMutexException] {
        # The previous holder was killed; we own the lock now. Its Edge may still be running.
        $acquired = $true
        $stopped = Stop-OrphanEdge
        if ($stopped -gt 0) {
            Write-Host "The previous headless Edge run was interrupted; stopped $stopped leftover Edge process(es)." -ForegroundColor DarkYellow
        }
    }
    if (-not $acquired) {
        $mutex.Dispose()
        throw "Timed out after $TimeoutSec s waiting for another headless Edge run to finish."
    }
    return $mutex
}

function Exit-EdgeLock($Mutex) {
    if ($Mutex) {
        try { $Mutex.ReleaseMutex() } catch { }
        $Mutex.Dispose()
    }
}

# Kills a process and all of its descendants (children first). Never throws.
function Stop-ProcessTree([int]$ProcessId) {
    try {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue -Verbose:$false)
        foreach ($c in $children) { Stop-ProcessTree ([int]$c.ProcessId) }
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue -Verbose:$false
    } catch { }
}

# Opens $HtmlPath in headless Edge and returns the serialised DOM after the virtual-time
# budget has elapsed (virtual time only advances while the page is idle and no network
# request is pending, so a budget of 60 s finishes in a few real seconds once work is done).
# A real-time timeout kills Edge if the page hangs (e.g. a CDN request that never answers).
function Invoke-EdgeDumpDom {
    param(
        [Parameter(Mandatory)] [string]$HtmlPath,
        [int]$VirtualTimeBudgetMs = 60000,
        [int]$TimeoutSec = 180,
        [switch]$ConsoleLog,
        [string]$Fragment
    )
    $run = Invoke-EdgeDumpDomOnce @PSBoundParameters
    if (-not (Test-EdgeRunEmpty $run)) { return $run }

    # Edge printed nothing. Usual cause: a headless Edge from a run whose PowerShell was killed
    # still holds the profile (Edge then exits at once with "Failed to create a
    # ProcessSingleton"). The caller holds the Edge lock, so any such process is an orphan.
    $stopped = Stop-OrphanEdge
    if ($stopped -gt 0) {
        Write-Host "Edge printed nothing; stopped $stopped leftover headless Edge process(es) that still held tools\$(Split-Path -Leaf $script:EdgeProfileDir) and retrying." -ForegroundColor DarkYellow
        $run = Invoke-EdgeDumpDomOnce @PSBoundParameters
        if (-not (Test-EdgeRunEmpty $run)) { return $run }
    }

    # A profile damaged by a killed Edge can make every later run print nothing: set it aside
    # (never delete it) and retry once with a fresh profile.
    if (Test-Path -LiteralPath $script:EdgeProfileDir) {
        $asideName = '{0}-broken-{1:yyyyMMdd-HHmmss}' -f (Split-Path -Leaf $script:EdgeProfileDir), (Get-Date)
        try {
            Rename-Item -LiteralPath $script:EdgeProfileDir -NewName $asideName -ErrorAction Stop
            Write-Host "Edge printed nothing; moved the Edge profile aside to tools\$asideName (safe to delete) and retrying once with a fresh one." -ForegroundColor DarkYellow
            return (Invoke-EdgeDumpDomOnce @PSBoundParameters)
        } catch {
            # Still locked by something we may not stop: use a throwaway profile for this run.
            $alt = '{0}-tmp-{1}' -f $script:EdgeProfileDir, $PID
            Write-Host "Edge printed nothing and its profile is locked ($($_.Exception.Message.Trim())); retrying once with a temporary profile." -ForegroundColor DarkYellow
            return (Invoke-EdgeDumpDomOnce @PSBoundParameters -ProfileDir $alt)
        }
    }
    return $run
}

function Test-EdgeRunEmpty($Run) {
    return (-not $Run.TimedOut) -and (-not ([string]$Run.Dom).Trim())
}

# Stops headless Edge processes (and their children) whose command line uses this tool's
# profile folder. Only call while holding the Edge lock: then none of them can be a live run.
# Returns how many root processes were stopped.
function Stop-OrphanEdge([string]$ProfileDir = $script:EdgeProfileDir) {
    $pattern = '--user-data-dir="?' + [regex]::Escape($ProfileDir.TrimEnd('\')) + '"?(\s|$)'
    $procs = @()
    try {
        $procs = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop -Verbose:$false |
            Where-Object { $_.CommandLine -and [regex]::IsMatch($_.CommandLine, $pattern, 'IgnoreCase') })
    } catch { return 0 }
    if (-not $procs.Count) { return 0 }
    $ids = @($procs | ForEach-Object { [int]$_.ProcessId })
    $roots = @($procs | Where-Object { $ids -notcontains [int]$_.ParentProcessId })
    foreach ($p in $roots) { Stop-ProcessTree ([int]$p.ProcessId) }
    foreach ($p in $procs) { Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 300   # let Windows release the profile's file handles
    return $roots.Count
}

function Invoke-EdgeDumpDomOnce {
    param(
        [Parameter(Mandatory)] [string]$HtmlPath,
        [int]$VirtualTimeBudgetMs = 60000,
        [int]$TimeoutSec = 180,
        # Copies the page's console messages to StdErr (lines containing ':CONSOLE').
        [switch]$ConsoleLog,
        # Optional URL fragment (without '#') passed to the page.
        [string]$Fragment,
        [string]$ProfileDir = $script:EdgeProfileDir
    )
    $edge = Get-EdgePath
    $url = ([Uri](Resolve-Path -LiteralPath $HtmlPath).ProviderPath).AbsoluteUri
    if ($Fragment) { $url += '#' + $Fragment }
    $edgeArgs = @(
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-sync', '--mute-audio',
        "--user-data-dir=`"$ProfileDir`""
    )
    if ($ConsoleLog) { $edgeArgs += @('--enable-logging=stderr', '--v=0') }
    $edgeArgs += @("--virtual-time-budget=$VirtualTimeBudgetMs", '--dump-dom', "`"$url`"")
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $edge
    $psi.Arguments = $edgeArgs -join ' '
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)

    $sw = [Diagnostics.Stopwatch]::StartNew()
    $proc = [Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEndAsync()
    $stderr = $proc.StandardError.ReadToEndAsync()
    $timedOut = -not $proc.WaitForExit($TimeoutSec * 1000)
    if ($timedOut) {
        Stop-ProcessTree $proc.Id
        $proc.WaitForExit(10000) | Out-Null
    }
    # Child processes can keep the pipes open briefly after the browser exits.
    $dom = ''
    if ($stdout.Wait(15000)) { $dom = $stdout.Result }
    $err = ''
    if ($stderr.Wait(2000)) { $err = $stderr.Result }
    $sw.Stop()
    return [pscustomobject]@{
        Dom       = $dom
        StdErr    = $err
        ExitCode  = $(if ($timedOut) { -1 } else { $proc.ExitCode })
        TimedOut  = $timedOut
        ElapsedMs = $sw.ElapsedMilliseconds
        Command   = "`"$edge`" $($psi.Arguments)"
    }
}

# Extracts and parses the JSON the page wrote into <pre id="$Id">. The pages emit
# ASCII-only JSON (no '<' or '&'), so no HTML decoding is needed; returns $null if absent.
function Get-DomJson([string]$Dom, [string]$Id) {
    if (-not $Dom) { return $null }
    $m = [regex]::Match($Dom, '<pre id="' + [regex]::Escape($Id) + '"[^>]*>([^<]*)</pre>')
    if (-not $m.Success) { return $null }
    $text = $m.Groups[1].Value.Trim()
    if (-not $text -or $text -eq 'pending') { return $null }
    $text = $text.Replace('&quot;', '"').Replace('&gt;', '>').Replace('&lt;', '<').Replace('&amp;', '&')
    return ($text | ConvertFrom-Json)
}

# Property of a ConvertFrom-Json object, or $null when absent (StrictMode-safe).
function Get-Field($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

# Check mark / cross that degrade to ASCII when the console cannot show them.
function Get-StatusGlyphs {
    $utf8 = $false
    try { $utf8 = ([Console]::OutputEncoding.CodePage -eq 65001) } catch { }
    if ($utf8) {
        return @{ Pass = [string][char]0x2713; Fail = [string][char]0x2717; Skip = [string][char]0x25CB; Arrow = [string][char]0x203A }
    }
    return @{ Pass = '+'; Fail = 'x'; Skip = 'o'; Arrow = '>' }
}

function Format-Duration([double]$Ms) {
    if ($Ms -lt 1000) { return ('{0:0} ms' -f $Ms) }
    return ([string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:0.0} s', $Ms / 1000))
}
