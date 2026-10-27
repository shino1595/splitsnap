<#
.SYNOPSIS
    Runs the SplitSnap unit tests in headless Microsoft Edge (no Node.js, nothing installed).

.DESCRIPTION
    Bundles app/src/**/*.ts (not .tsx) and tests/**/*.ts into tools/.out/test-sources.js and
    opens tools/test-runner.html in headless Edge. The page loads the TypeScript compiler from
    jsDelivr (cached in tools/.edge-profile after the first run), transpiles each module to
    CommonJS on demand and runs every *.test.ts file with a Jest-like API:
      describe / it / test (+ .only .skip .todo .each), beforeEach / afterEach / beforeAll / afterAll,
      expect(x).toBe / toEqual / toStrictEqual / toBeCloseTo / toBeTruthy / toBeFalsy / toBeNull /
      toBeUndefined / toBeDefined / toBeNaN / toContain / toContainEqual / toHaveLength /
      toBeGreaterThan(OrEqual) / toBeLessThan(OrEqual) / toMatch / toMatchObject / toThrow /
      toHaveProperty / toBeInstanceOf, all with .not, plus .resolves / .rejects, expect.any /
      anything / objectContaining / arrayContaining / stringContaining / stringMatching,
      jest.fn / jest.spyOn with toHaveBeenCalled(Times/With). Async tests and done() work.
    Each test file gets a fresh module registry. Packages are stubs: react-native (Platform.OS
    = 'web', StyleSheet.create = identity), react (no hooks), an in-memory AsyncStorage, and
    proxies for Expo / React Navigation modules that throw when called. fetch() is blocked;
    mock globalThis.fetch in tests that need it.

    Output (compact by default): one line per test file with its counts, every failing test in
    full (expected/received, diff, source location, console output), the list of failures,
    totals and duration. -Full lists every test. Exit code 0 = all passed; 1 = any failure, no
    tests found, or the page never reported (e.g. jsDelivr unreachable on the very first run).

.PARAMETER Filter
    Only run test files whose path (relative to the root, e.g. tests/lib/money.test.ts)
    contains this text (case-insensitive).
.PARAMETER Root
    Project root that contains app/src and tests (default: the folder above tools/).
.PARAMETER TestGlob
    File-name pattern for test files under tests/ (default '*.test.ts').
.PARAMETER TestTimeoutMs
    Default timeout per test and hook (default 5000).
.PARAMETER VirtualTimeBudgetMs
    Edge virtual-time budget (default 60000). Virtual time only advances while the page is idle,
    so raise it only if tests wait on long timers.
.PARAMETER TimeoutSec
    Real-time limit for the Edge process (default 110).
.PARAMETER Full
    List every test (passed, skipped, todo), not just one line per file.
.PARAMETER Verbose
    Like -Full, plus console output of passing tests, per-file timings and the Edge command line.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-tests.ps1
.EXAMPLE
    .\tools\run-tests.ps1 -Filter receiptParser -Verbose
.EXAMPLE
    .\tools\run-tests.ps1 -Root tools\selftest\runner
#>
[CmdletBinding()]
param(
    [string]$Filter,
    [string]$Root,
    [string]$TestGlob = '*.test.ts',
    [int]$TestTimeoutMs = 5000,
    [int]$VirtualTimeBudgetMs = 60000,
    [int]$TimeoutSec = 110,
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$showVerbose = $VerbosePreference -eq 'Continue'
$wall = [Diagnostics.Stopwatch]::StartNew()
$glyph = Get-StatusGlyphs

function Write-Indented([string]$Text, [string]$Indent, [string]$Color = 'Gray') {
    foreach ($line in ($Text -split "`r?`n")) {
        $c = $Color
        if ($line -match '^(Expected|- )') { $c = 'Green' }
        elseif ($line -match '^(Received|\+ )') { $c = 'Red' }
        Write-Host ($Indent + $line) -ForegroundColor $c
    }
}

function Write-ErrorDetails($ErrorInfo, [string]$Indent) {
    Write-Indented ([string](Get-Field $ErrorInfo 'message')) $Indent
    $location = Get-Field $ErrorInfo 'location'
    $stack = [string](Get-Field $ErrorInfo 'stack')
    if (-not (Get-Field $ErrorInfo 'assertion') -and $stack) {
        $frames = @($stack -split "`n")
        $limit = if ($showVerbose) { $frames.Count } else { [Math]::Min(4, $frames.Count) }
        foreach ($f in $frames[0..($limit - 1)]) { Write-Host ($Indent + $f) -ForegroundColor DarkGray }
    } elseif ($location) {
        Write-Host ($Indent + 'at ' + $location) -ForegroundColor DarkGray
    }
}

function Write-Logs($Logs, [string]$Indent) {
    if (-not $Logs) { return }
    Write-Host ($Indent + 'console output:') -ForegroundColor DarkGray
    foreach ($entry in @($Logs)) {
        $level = [string](Get-Field $entry 'level')
        $color = switch ($level) { 'error' { 'Red' } 'warn' { 'Yellow' } default { 'DarkGray' } }
        Write-Indented ("[$level] " + [string](Get-Field $entry 'text')) ($Indent + '  ') $color
    }
}

# ---------------------------------------------------------------------------------------------
# Collect sources

$rootDir = Resolve-ProjectRoot $Root
$srcDir = Join-Path $rootDir 'app\src'
$testsDir = Join-Path $rootDir 'tests'

$moduleFiles = @(Get-SourceFiles $srcDir @('.ts'))
$tsxFiles = @(Get-SourceFiles $srcDir @('.tsx') | ForEach-Object { Get-RelativePath $rootDir $_.FullName })
$testDirFiles = @(Get-SourceFiles $testsDir @('.ts'))

$filterText = if ($Filter) { $Filter.Replace('\', '/') } else { '' }
$testFiles = @($testDirFiles |
    Where-Object { $_.Name -like $TestGlob } |
    ForEach-Object { Get-RelativePath $rootDir $_.FullName } |
    Where-Object { -not $filterText -or $_.IndexOf($filterText, [StringComparison]::OrdinalIgnoreCase) -ge 0 })

if ($testFiles.Count -eq 0) {
    $why = if ($Filter) { " matching -Filter '$Filter'" } else { '' }
    Write-Host "No test files ($TestGlob)$why found under $testsDir." -ForegroundColor Red
    exit 1
}

$bundle = New-Object Text.StringBuilder
[void]$bundle.AppendLine('// Generated by tools/run-tests.ps1 - do not edit. Strings are ASCII-escaped JSON.')
$config = [ordered]@{ root = $rootDir; testFiles = $testFiles; tsxFiles = $tsxFiles; timeoutMs = $TestTimeoutMs }
[void]$bundle.AppendLine('window.__TEST_CONFIG__ = ' + (ConvertTo-AsciiJson $config) + ';')
[void]$bundle.AppendLine('window.__SOURCES__ = {')
$sourceBytes = 0
foreach ($f in @($moduleFiles + $testDirFiles)) {
    $text = Read-Utf8File $f.FullName
    $sourceBytes += $f.Length
    [void]$bundle.Append('  ').Append((ConvertTo-JsString (Get-RelativePath $rootDir $f.FullName))).Append(': ').Append((ConvertTo-JsString $text)).AppendLine(',')
}
[void]$bundle.AppendLine('};')

$moduleCount = $moduleFiles.Count + $testDirFiles.Count
Write-Host ("SplitSnap unit tests: {0} test file(s), {1} module(s) bundled from {2}" -f $testFiles.Count, $moduleCount, $rootDir) -ForegroundColor Cyan

# ---------------------------------------------------------------------------------------------
# Run headless Edge

$outDir = Initialize-OutDir
$bundlePath = Join-Path $outDir 'test-sources.js'
$lock = Enter-EdgeLock
try {
    Write-Utf8File $bundlePath $bundle.ToString()
    Write-Verbose ("Bundle: {0} ({1:N0} KB of sources)" -f $bundlePath, ($sourceBytes / 1KB))
    $run = Invoke-EdgeDumpDom -HtmlPath (Join-Path $PSScriptRoot 'test-runner.html') -VirtualTimeBudgetMs $VirtualTimeBudgetMs -TimeoutSec $TimeoutSec
} finally {
    Exit-EdgeLock $lock
}
Write-Verbose ("Edge: {0}" -f $run.Command)
Write-Verbose ("Edge finished in {0} (exit code {1})" -f (Format-Duration $run.ElapsedMs), $run.ExitCode)

$result = $null
try { $result = Get-DomJson $run.Dom 'splitsnap-results' } catch { $result = $null }

if ($null -eq $result) {
    Write-Host ''
    Write-Host 'The test page never reported a result.' -ForegroundColor Red
    $progress = [regex]::Match([string]$run.Dom, '<pre id="splitsnap-progress"[^>]*>([^<]*)</pre>')
    if ($run.TimedOut) {
        Write-Host "Edge was stopped after $TimeoutSec s. A test may be stuck in a synchronous loop, or a network request never answered." -ForegroundColor Red
    } elseif (-not $run.Dom) {
        Write-Host 'Edge produced no output. Is another process using tools\.edge-profile? Edge stderr:' -ForegroundColor Red
        Write-Host ($run.StdErr.Trim()) -ForegroundColor DarkGray
    } else {
        Write-Host "The virtual-time budget ($VirtualTimeBudgetMs ms) ran out before the run finished. Tests that wait on long timers need a larger -VirtualTimeBudgetMs." -ForegroundColor Red
    }
    if ($progress.Success) { Write-Host ("Last progress: " + $progress.Groups[1].Value) -ForegroundColor DarkGray }
    Write-Host 'If this is the first run, check that https://cdn.jsdelivr.net is reachable (TypeScript is loaded from there).' -ForegroundColor DarkGray
    exit 1
}

$fatal = Get-Field $result 'fatal'
if ($fatal) {
    Write-Host ''
    Write-Host "Test run failed: $fatal" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------------------------
# Report

$edgeVersion = ([regex]::Match([string](Get-Field $result 'userAgent'), 'Edg/([\d.]+)')).Groups[1].Value
Write-Host ("TypeScript {0} in headless Edge {1}" -f (Get-Field $result 'tsVersion'), $edgeVersion) -ForegroundColor DarkGray

$listAll = $Full -or $showVerbose
$failedNames = New-Object Collections.Generic.List[string]
if (-not $listAll) { Write-Host '' }
foreach ($file in @(Get-Field $result 'files')) {
    $path = [string](Get-Field $file 'path')
    $tests = @(Get-Field $file 'tests' | Where-Object { $null -ne $_ })
    $loadError = Get-Field $file 'error'
    $count = @{ pass = 0; fail = 0; skip = 0; todo = 0 }
    foreach ($t in $tests) {
        switch ([string](Get-Field $t 'status')) {
            'pass' { $count.pass++ } 'fail' { $count.fail++ } 'todo' { $count.todo++ } default { $count.skip++ }
        }
    }
    $fileMs = [double](Get-Field $file 'ms')

    if ($listAll) {
        Write-Host ''
        $fileTiming = if ($showVerbose) { '  (' + (Format-Duration $fileMs) + ')' } else { '' }
        Write-Host ($path + $fileTiming) -ForegroundColor White
    } else {
        # Compact mode: one line per file; failing tests follow in full.
        $parts = New-Object Collections.Generic.List[string]
        if ($loadError) { $parts.Add('failed to run') }
        if ($count.fail) { $parts.Add("$($count.fail) failed") }
        if ($count.pass) { $parts.Add("$($count.pass) passed") }
        if ($count.skip) { $parts.Add("$($count.skip) skipped") }
        if ($count.todo) { $parts.Add("$($count.todo) todo") }
        if (-not $parts.Count) { $parts.Add('no tests') }
        $bad = [bool]$loadError -or $count.fail -gt 0
        $mark = if ($bad) { $glyph.Fail } else { $glyph.Pass }
        $slow = if ($fileMs -ge 500) { ', ' + (Format-Duration $fileMs) } else { '' }
        Write-Host ("{0} {1}  ({2}{3})" -f $mark, $path, ($parts -join ', '), $slow) -ForegroundColor $(if ($bad) { 'Red' } else { 'Green' })
    }

    if ($loadError) {
        Write-Host ("  {0} test file failed to run" -f $glyph.Fail) -ForegroundColor Red
        Write-ErrorDetails $loadError '      '
        Write-Logs (Get-Field $file 'logs') '      '
        $failedNames.Add("$path (failed to run)")
    } elseif ($showVerbose) {
        Write-Logs (Get-Field $file 'logs') '    '
    }
    foreach ($t in $tests) {
        $name = [string](Get-Field $t 'name')
        $ms = [double](Get-Field $t 'ms')
        $timing = if ($ms -ge 50 -or ($showVerbose -and $ms -ge 1)) { ' (' + (Format-Duration $ms) + ')' } else { '' }
        $status = [string](Get-Field $t 'status')
        if ($status -eq 'fail') {
            Write-Host ("  {0} {1}{2}" -f $glyph.Fail, $name, $timing) -ForegroundColor Red
            Write-ErrorDetails (Get-Field $t 'error') '      '
            Write-Logs (Get-Field $t 'logs') '      '
            $failedNames.Add("$path $($glyph.Arrow) $name")
            continue
        }
        if (-not $listAll) { continue }
        switch ($status) {
            'pass' {
                Write-Host ("  {0} {1}{2}" -f $glyph.Pass, $name, $timing) -ForegroundColor Green
                if ($showVerbose) { Write-Logs (Get-Field $t 'logs') '      ' }
            }
            'todo' { Write-Host ("  {0} todo: {1}" -f $glyph.Skip, $name) -ForegroundColor Magenta }
            default { Write-Host ("  {0} skipped: {1}" -f $glyph.Skip, $name) -ForegroundColor Yellow }
        }
    }
}

$totals = Get-Field $result 'totals'
$filesTotal = [int](Get-Field $totals 'files')
$filesFailed = [int](Get-Field $totals 'filesFailed')
$testsFailed = [int](Get-Field $totals 'failed')
$testsPassed = [int](Get-Field $totals 'passed')
$testsSkipped = [int](Get-Field $totals 'skipped')
$testsTodo = [int](Get-Field $totals 'todo')
$testsTotal = [int](Get-Field $totals 'tests')

if ($failedNames.Count) {
    Write-Host ''
    Write-Host 'Failed:' -ForegroundColor Red
    foreach ($n in $failedNames) { Write-Host ("  {0} {1}" -f $glyph.Fail, $n) -ForegroundColor Red }
}

function Format-Count([int]$Count, [string]$Label, [string]$Color) {
    if ($Count -gt 0) { Write-Host ("{0} {1}, " -f $Count, $Label) -NoNewline -ForegroundColor $Color }
}

Write-Host ''
Write-Host 'Test files:  ' -NoNewline
Format-Count $filesFailed 'failed' 'Red'
Format-Count ($filesTotal - $filesFailed) 'passed' 'Green'
Write-Host ("{0} total" -f $filesTotal)
Write-Host 'Tests:       ' -NoNewline
Format-Count $testsFailed 'failed' 'Red'
Format-Count $testsSkipped 'skipped' 'Yellow'
Format-Count $testsTodo 'todo' 'Magenta'
Format-Count $testsPassed 'passed' 'Green'
Write-Host ("{0} total" -f $testsTotal)
$wall.Stop()
Write-Host ("Time:        {0} (tests {1} in page)" -f (Format-Duration $wall.ElapsedMilliseconds), (Format-Duration ([double](Get-Field $result 'ms'))))

if ((Get-Field $result 'ok') -and $testsTotal -gt 0) {
    exit 0
}
exit 1
