<#
.SYNOPSIS
    Self-test for the SplitSnap no-install tooling. Proves that run-tests.ps1, typecheck.ps1 and
    build-snack-launcher.ps1 really work, using the throwaway fixtures in this folder.

.DESCRIPTION
    runner/     tiny module + tests: one file that passes, one with 7 deliberate failures, one
                that fails to load. Checks pass/fail reporting (compact and -Full), diffs,
                source-mapped locations, timeouts and exit codes (0 when all pass, 1 otherwise).
    typecheck/  tiny Expo app: correct code using every allowed package, plus Broken.tsx,
                IconNames.tsx and alias.ts with deliberate errors that only real react-native /
                vector-icons typings can catch. Also runs once with -ShimAll.
    snack/      tiny app with awkward characters (</script>, quotes, backslashes, rupee sign,
                emoji), an empty file and a binary file; the generated launcher is opened in
                headless Edge with #verify and the data message it would hand to Snack is
                compared byte for byte with the sources. Then, unless -SkipOnline, the page is
                opened with #live: it embeds the real snack.expo.dev and must get its handshake.
    common.ps1  the Edge lock serialises runs and survives a killed holder; Invoke-EdgeDumpDom
                recovers from an orphan Edge on the profile, a locked profile and a broken one
                (on a scratch profile under tools\.out\selftest-edge, never the real one).

    Prints PASS/FAIL per check; exit code 0 only when every check passes.

.PARAMETER SkipTypecheck
    Skip the two type-check runs (they need jsDelivr; the first run downloads typings).
.PARAMETER SkipEdgeRecovery
    Skip the lock and profile-recovery checks (about 30 s).
.PARAMETER SkipOnline
    Skip the live snack.expo.dev embed handshake.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\selftest\run-selftest.ps1
#>
[CmdletBinding()]
param([switch]$SkipTypecheck, [switch]$SkipEdgeRecovery, [switch]$SkipOnline)

$ErrorActionPreference = 'Stop'
$tools = Split-Path -Parent $PSScriptRoot
. (Join-Path $tools 'common.ps1')

$results = New-Object Collections.Generic.List[object]

function Invoke-Tool([string]$Script, [string[]]$Arguments) {
    $path = Join-Path $tools $Script
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $text = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $path @Arguments 2>&1 | Out-String -Width 400
    return [pscustomobject]@{ Output = $text; ExitCode = $LASTEXITCODE; Seconds = [Math]::Round($sw.Elapsed.TotalSeconds, 1) }
}

function Test-Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
    $results.Add([pscustomobject]@{ Name = $Name; Ok = $Ok })
    if ($Ok) { Write-Host "  PASS  $Name" -ForegroundColor Green }
    else { Write-Host "  FAIL  $Name $Detail" -ForegroundColor Red }
}

function Test-Output($Run, [string]$Name, [int]$ExpectedExit, [string[]]$MustContain, [string[]]$MustNotContain = @()) {
    Test-Check "$Name exits with $ExpectedExit ($($Run.Seconds) s)" ($Run.ExitCode -eq $ExpectedExit) "(got $($Run.ExitCode))"
    foreach ($s in $MustContain) {
        Test-Check "$Name prints '$s'" ($Run.Output.Contains($s))
    }
    foreach ($s in $MustNotContain) {
        Test-Check "$Name does not print '$s'" (-not $Run.Output.Contains($s))
    }
}

$runnerRoot = Join-Path $PSScriptRoot 'runner'
$typecheckRoot = Join-Path $PSScriptRoot 'typecheck'
$snackRoot = Join-Path $PSScriptRoot 'snack'

# ---------------------------------------------------------------------------------------------
Write-Host 'run-tests.ps1' -ForegroundColor Cyan

$run = Invoke-Tool 'run-tests.ps1' @('-Root', $runnerRoot, '-Filter', 'passing', '-Full')
Test-Output $run 'passing tests (-Full)' 0 @('19 passed', '1 skipped', '1 todo', 'keeps UTF-8 symbols intact')

$run = Invoke-Tool 'run-tests.ps1' @('-Root', $runnerRoot, '-Filter', 'passing')
Test-Output $run 'passing tests (compact)' 0 @('tests/passing.test.ts  (19 passed, 1 skipped, 1 todo', 'Tests:       1 skipped, 1 todo, 19 passed, 21 total') @('keeps UTF-8 symbols intact')

$run = Invoke-Tool 'run-tests.ps1' @('-Root', $runnerRoot)
Test-Output $run 'deliberate failures' 1 @(
    '7 failed', '2 failed, 1 passed, 3 total',
    '- Expected  - 2', '"amount": 45000', 'Expected: 33', 'Received: 34',
    'at crash (app/src/lib/calc.ts:35:', 'tests/failing.test.ts:12:',
    'Exceeded timeout of 100 ms', 'Expected 2 assertion(s)',
    'is a React (.tsx) module', 'async failure after a timer')
if ($run.ExitCode -ne 1) { Write-Host $run.Output }

$run = Invoke-Tool 'run-tests.ps1' @('-Root', $runnerRoot, '-Filter', 'no-such-test-file')
Test-Output $run 'no matching test files' 1 @('No test files')

# ---------------------------------------------------------------------------------------------
if (-not $SkipTypecheck) {
    Write-Host 'typecheck.ps1' -ForegroundColor Cyan

    $run = Invoke-Tool 'typecheck.ps1' @('-Root', $typecheckRoot)
    Test-Output $run 'real types' 1 @(
        'app/src/Broken.tsx(10,', "Type 'string' is not assignable to type 'number'",
        'app/src/Broken.tsx(12,', 'notAProp',
        'app/src/Broken.tsx(13,',
        'app/src/Broken.tsx(14,', 'not-a-real-glyph',
        'app/src/alias.ts(2,', 'SPLITSNAP1', 'TS2307',
        'react-native@0.83', '@types/react@19.2',
        'Icon names: ', 'Ionicons glyphs (@expo/vector-icons 15.0.2)',
        "app/src/IconNames.tsx(16,30): error SPLITSNAP2: 'walet'", "did you mean 'wallet'?",
        "app/src/IconNames.tsx(18,96): error SPLITSNAP2: 'shopping-cart'",
        "app/src/IconNames.tsx(21,43): error SPLITSNAP2: 'chek'",
        "app/src/IconNames.tsx(23,37): error SPLITSNAP2: 'clos'", "did you mean 'close'?",
        "app/src/IconNames.tsx(24,33): error SPLITSNAP2: 'not-an-icon'",
        'Found 11 error(s) in 3 file(s).'
    ) @('app/App.tsx(', 'app/src/Home.tsx(', 'app/src/money.ts(', 'Shimmed', 'error SPLITSNAP2: ''not-a-real-glyph''',
        'app/src/IconNames.tsx(7,', 'app/src/IconNames.tsx(15,', 'app/src/IconNames.tsx(25,', 'app/src/IconNames.tsx(26,', 'tomato')
    if ($run.ExitCode -ne 1) { Write-Host $run.Output }

    $run = Invoke-Tool 'typecheck.ps1' @('-Root', $typecheckRoot, '-ShimAll')
    Test-Output $run 'shim mode' 1 @('Shimmed', 'react-native', 'app/src/Broken.tsx(10,', 'Icon names: not checked') @(
        'app/src/Broken.tsx(12,', 'app/src/Broken.tsx(14,', 'SPLITSNAP2', 'app/src/Home.tsx(', 'app/App.tsx(', 'TS2347')
}

# ---------------------------------------------------------------------------------------------
Write-Host 'build-snack-launcher.ps1' -ForegroundColor Cyan

$outDir = Initialize-OutDir
$page = Join-Path $outDir 'selftest-open-in-snack.html'
$run = Invoke-Tool 'build-snack-launcher.ps1' @('-Root', $snackRoot, '-OutFile', $page)
Test-Output $run 'launcher build' 0 @('3 file(s)', 'Skipped binary file', 'assets/icon.png', 'Empty file sent as a single newline', 'src/empty.ts')

$lock = Enter-EdgeLock
try {
    $dump = Invoke-EdgeDumpDom -HtmlPath $page -Fragment 'verify' -VirtualTimeBudgetMs 5000 -TimeoutSec 60
} finally {
    Exit-EdgeLock $lock
}
$verify = Get-DomJson $dump.Dom 'snack-verify'
Test-Check 'launcher page reports its Snack data message' ($null -ne $verify)
if ($verify) {
    $embedUrl = [string](Get-Field $verify 'embedUrl')
    Test-Check 'Snack is embedded from snack.expo.dev/embedded and waits for the data' (
        $embedUrl.StartsWith('https://snack.expo.dev/embedded?') -and $embedUrl.Contains('waitForData=true') -and
        $embedUrl.Contains('iframeId=splitsnap-launcher') -and $embedUrl.Contains('sdkVersion=55.0.0')) "(got '$embedUrl')"
    $message = @(Get-Field $verify 'message')
    Test-Check "the message is ['expoDataEvent', {...}]" ($message.Count -eq 2 -and $message[0] -ceq 'expoDataEvent')
    $data = $message[-1]
    $expected = [ordered]@{
        iframeId = 'splitsnap-launcher'; name = 'SplitSnap'; platform = 'web'; sdkVersion = '55.0.0'
        supportedPlatforms = 'ios,android,web,mydevice'
        dependencies = '@react-navigation/native@7.5.0,@react-navigation/native-stack@7.20.0,@react-navigation/bottom-tabs@7.20.0,react-native-screens,react-native-safe-area-context,@react-native-async-storage/async-storage,expo-image-picker,expo-image-manipulator,@expo/vector-icons'
    }
    foreach ($k in $expected.Keys) {
        Test-Check "message field $k" ((Get-Field $data $k) -ceq $expected[$k]) "(got '$(Get-Field $data $k)')"
    }
    Test-Check 'message field description is set' ([bool](Get-Field $data 'description'))
    $files = (Get-Field $data 'files') | ConvertFrom-Json
    $sources = @(Get-ChildItem -LiteralPath (Join-Path $snackRoot 'app') -Recurse -File | Where-Object { @('.ts', '.tsx') -contains $_.Extension })
    Test-Check 'files has exactly the text files' (@($files.PSObject.Properties).Count -eq $sources.Count)
    foreach ($s in $sources) {
        $rel = Get-RelativePath (Join-Path $snackRoot 'app') $s.FullName
        $entry = Get-Field $files $rel
        $want = Read-Utf8File $s.FullName
        if ($want.Length -eq 0) { $want = "`n" }
        $same = $entry -and (Get-Field $entry 'type') -ceq 'CODE' -and (Get-Field $entry 'contents') -ceq $want
        Test-Check "$rel is handed over byte for byte" ([bool]$same)
    }
    $problems = @(Get-Field $verify 'problems' | Where-Object { $_ })
    Test-Check "files pass Snack's own checks (entry point, no empty file)" ($problems.Count -eq 0) ($problems -join '; ')
}
$pageText = Read-Utf8File $page
foreach ($s in @('https://expo.dev/go', 'SDK 55', 'My Device', 'App Store', 'https://ocr.space/ocrapi/freekey', 'demo key')) {
    Test-Check "launcher page explains '$s'" ($pageText.Contains($s))
}
Test-Check 'launcher page does not POST a form (Snack caps form bodies at 56 KB)' (-not $pageText.Contains('method="POST"'))

if (-not $SkipOnline) {
    # Real Snack in an iframe: proves a local page can embed it and gets the data handshake.
    # Only the synthetic fixture above is handed over.
    $lock = Enter-EdgeLock
    try {
        $dump = Invoke-EdgeDumpDom -HtmlPath $page -Fragment 'live' -VirtualTimeBudgetMs 45000 -TimeoutSec 120
    } finally {
        Exit-EdgeLock $lock
    }
    $live = Get-DomJson $dump.Dom 'snack-live'
    Test-Check ('snack.expo.dev answers the embed handshake ({0} ms)' -f (Get-Field $live 'ms')) ([bool](Get-Field $live 'handshake'))
}

# ---------------------------------------------------------------------------------------------
if (-not $SkipEdgeRecovery) {
    Write-Host 'common.ps1: Edge lock and profile recovery' -ForegroundColor Cyan

    $scratch = Join-Path $outDir 'selftest-edge'
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }   # left by an earlier self-test
    New-Item -ItemType Directory -Path $scratch | Out-Null
    $probe = Join-Path $scratch 'probe.html'
    Write-Utf8File $probe '<!doctype html><html><body><pre id="probe">pending</pre><script>document.getElementById("probe").textContent = JSON.stringify({ ok: true });</script></body></html>'

    # A helper process that takes the lock, signals through a marker file, holds it, then
    # releases it or exits without releasing (an abandoned mutex, like a killed run).
    $holder = Join-Path $scratch 'hold-lock.ps1'
    Write-Utf8File $holder (@'
param([string]$Marker, [int]$Seconds, [string]$Mode)
. '{0}'
$m = Enter-EdgeLock
Set-Content -LiteralPath $Marker -Value 'held'
Start-Sleep -Seconds $Seconds
if ($Mode -eq 'release') {{ Exit-EdgeLock $m }}
'@ -f (Join-Path $tools 'common.ps1'))

    function Start-LockHolder([string]$Mode, [int]$Seconds) {
        $marker = Join-Path $scratch ("held-{0}.txt" -f $Mode)
        $proc = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$holder`"", "`"$marker`"", $Seconds, $Mode)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while (-not (Test-Path -LiteralPath $marker) -and $sw.Elapsed.TotalSeconds -lt 300 -and -not $proc.HasExited) {
            Start-Sleep -Milliseconds 100
        }
        return $proc
    }

    $proc = Start-LockHolder 'release' 4
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $lock = Enter-EdgeLock
    $waited = $sw.Elapsed.TotalSeconds
    Exit-EdgeLock $lock
    Test-Check ("a second run waits for the lock holder ({0:N1} s)" -f $waited) ($waited -ge 2)
    $proc.WaitForExit()

    $proc = Start-LockHolder 'abandon' 0
    $proc.WaitForExit()
    $lock = $null
    try { $lock = Enter-EdgeLock 120 } catch { }
    Test-Check 'the lock is taken over after its holder died without releasing it' ($null -ne $lock)

    $savedProfile = $script:EdgeProfileDir
    $script:EdgeProfileDir = Join-Path $scratch 'profile'
    function Invoke-Probe {
        $all = @(Invoke-EdgeDumpDom -HtmlPath $probe -VirtualTimeBudgetMs 2000 -TimeoutSec 60 6>&1)
        $info = @($all | Where-Object { $_ -is [Management.Automation.InformationRecord] }) -join "`n"
        $run = @($all | Where-Object { $_ -isnot [Management.Automation.InformationRecord] })[-1]
        return [pscustomobject]@{ Ok = [bool](Get-Field (Get-DomJson $run.Dom 'probe') 'ok'); Messages = $info }
    }
    try {
        $r = Invoke-Probe
        Test-Check 'scratch profile works' $r.Ok

        $edgeArgs = @('--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=`"$($script:EdgeProfileDir)`"", '--remote-debugging-port=0', 'about:blank')
        $orphan = Start-Process -FilePath (Get-EdgePath) -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden
        Start-Sleep -Seconds 3
        $r = Invoke-Probe
        Test-Check 'recovers when an orphan Edge holds the profile' ($r.Ok -and $r.Messages.Contains('stopped 1 leftover')) $r.Messages
        Test-Check 'the orphan Edge was stopped' ($orphan.HasExited)

        $held = [IO.File]::Open((Join-Path $script:EdgeProfileDir 'lockfile'), 'OpenOrCreate', 'ReadWrite', 'None')
        try { $r = Invoke-Probe } finally { $held.Dispose() }
        Test-Check 'recovers when the profile is locked by another process' ($r.Ok -and $r.Messages.Contains('temporary profile')) $r.Messages

        Remove-Item -LiteralPath $script:EdgeProfileDir -Recurse -Force
        Write-Utf8File $script:EdgeProfileDir 'not a profile'
        $r = Invoke-Probe
        Test-Check 'recovers from a broken profile by moving it aside' ($r.Ok -and $r.Messages.Contains('moved the Edge profile aside')) $r.Messages
        Test-Check 'the broken profile was kept, not deleted' (@(Get-ChildItem -LiteralPath $scratch -Filter 'profile-broken-*').Count -eq 1)
    } finally {
        $script:EdgeProfileDir = $savedProfile
        Exit-EdgeLock $lock
    }
    try { Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction Stop } catch { }
}

# ---------------------------------------------------------------------------------------------
$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ''
if ($failed.Count) {
    Write-Host ("Self-test FAILED: {0} of {1} checks failed." -f $failed.Count, $results.Count) -ForegroundColor Red
    exit 1
}
Write-Host ("Self-test passed: {0} checks." -f $results.Count) -ForegroundColor Green
exit 0
