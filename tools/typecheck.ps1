<#
.SYNOPSIS
    Type-checks every .ts/.tsx file under app/ with the real TypeScript compiler in headless
    Microsoft Edge (no Node.js, nothing installed).

.DESCRIPTION
    Writes all files under app/ (tests/ is ignored) into tools/.out/typecheck-input.js and opens
    tools/typecheck.html in headless Edge. The page loads TypeScript 5.9.3 from jsDelivr and
    fetches real type definitions for the third-party packages the code imports (react-native
    0.83, @types/react 19.2, React Navigation 7, Expo SDK 55 modules, AsyncStorage, safe-area,
    screens, @expo/vector-icons and whatever their typings import), resolving each file with
    TypeScript's own module resolution. Every download is saved in tools/.cache/typecheck-cache.js
    (read and written only while holding the Edge lock), so only the first run needs the
    network: a cold run (fresh Edge profile, empty cache) takes about 20 s, a warm one 3-8 s.

    Compiler options: strict, noImplicitAny, jsx react-jsx, module esnext, moduleResolution
    bundler (customConditions react-native, like Metro/Expo), target es2022, lib es2022 + dom,
    esModuleInterop, isolatedModules, resolveJsonModule, skipLibCheck, noEmit.

    Extra checks beyond the compiler:
      SPLITSNAP1  imports of packages that docs/ARCHITECTURE.md does not allow (or '@/' aliases).
      SPLITSNAP2  string literals in icon positions (JSX name on <Ionicons>/<...Icon>, icon /
                  ...Icon props, properties, parameter defaults and arguments, collections named
                  ...icons) that are not glyphs of the real Ionicons typings. Needs real types.
    A package whose types cannot be fetched is replaced by an ambient `declare module` shim and
    listed under "Shimmed". Errors print as path(line,col): error TSnnnn: message.
    Exit code 0 = no errors; 1 = errors, or the check could not run.

.PARAMETER Root
    Project root that contains app/ (default: the folder above tools/).
.PARAMETER ShimAll
    Skip type acquisition for everything except @types/react (+ csstype); all other packages
    become `any` shims (TS2347, type arguments on an untyped call, is then not reported).
    Faster on a cold cache, but only checks our own code against React's types (no
    react-native props, no icon names).
.PARAMETER Refresh
    Discard tools/.cache/typecheck-cache.js and download every typing again.
.PARAMETER Diagnostics
    Print the page's progress log with real wall-clock times and every request.
.PARAMETER TimeoutSec
    Real-time limit for the Edge process (default 300; the very first run downloads typings).
.PARAMETER VirtualTimeBudgetMs
    Edge virtual-time budget (default 120000).
.PARAMETER Verbose
    Also list every acquired package and version, unresolved imports inside libraries and the
    Edge command line.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\typecheck.ps1
.EXAMPLE
    .\tools\typecheck.ps1 -Verbose
.EXAMPLE
    .\tools\typecheck.ps1 -Root tools\selftest\typecheck
#>
[CmdletBinding()]
param(
    [string]$Root,
    [switch]$ShimAll,
    [switch]$Refresh,
    [switch]$Diagnostics,
    [int]$TimeoutSec = 300,
    [int]$VirtualTimeBudgetMs = 120000,
    # Expo SDK whose library versions the code is checked against (54 = what Snack and the App Store Expo Go run).
    [ValidateSet('54', '55', '58')] [string]$Sdk = '54'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$showVerbose = $VerbosePreference -eq 'Continue'
$wall = [Diagnostics.Stopwatch]::StartNew()

$rootDir = Resolve-ProjectRoot $Root
$appDir = Join-Path $rootDir 'app'
if (-not (Test-Path -LiteralPath $appDir)) {
    Write-Host "No app/ folder under $rootDir." -ForegroundColor Red
    exit 1
}

# Versions used for top-level packages (per Expo SDK). Dependencies of these packages are
# resolved from their own package.json ranges.
$pins = [ordered]@{
    '@types/react'                              = '~19.2.0'
    'react-native'                              = '~0.83.0'
    '@react-navigation/native'                  = '7.5.0'
    '@react-navigation/native-stack'            = '7.20.0'
    '@react-navigation/bottom-tabs'             = '7.20.0'
    'react-native-safe-area-context'            = '5.6.2'
    'react-native-screens'                      = '4.23.0'
    '@react-native-async-storage/async-storage' = '2.2.0'
    'expo-image-picker'                         = '55.0.24'
    'expo-image-manipulator'                    = '55.0.21'
    'expo-document-picker'                      = '55.0.17'
    'expo-modules-core'                         = '~55.0.0'
    'expo-font'                                 = '~55.0.0'
    'expo'                                      = '~55.0.0'
    '@expo/vector-icons'                        = '15.0.2'
}
if ($Sdk -eq '58') {
    # The real Expo project published with EAS Update (iPhone Expo Go runs SDK 58): expo@58.0.19.
    $pins['@types/react'] = '~19.3.0'
    $pins['react-native'] = '0.88.0'
    $pins['react-native-safe-area-context'] = '~5.10.1'
    $pins['react-native-screens'] = '~4.30.0'
    $pins['expo-image-picker'] = '~58.0.10'
    $pins['expo-image-manipulator'] = '~58.0.15'
    $pins['expo-document-picker'] = '~58.0.4'
    $pins['expo-modules-core'] = '~58.0.26'
    $pins['expo-font'] = '~58.0.10'
    $pins['expo'] = '~58.0.19'
    $pins['@expo/vector-icons'] = '^15.0.2'
}
if ($Sdk -eq '54') {
    # bundledNativeModules.json of expo@54.0.37 (react-native 0.81.5, react 19.1.0).
    $pins['@types/react'] = '~19.1.0'
    $pins['react-native'] = '0.81.5'
    $pins['react-native-safe-area-context'] = '~5.6.0'
    $pins['react-native-screens'] = '~4.16.0'
    $pins['expo-image-picker'] = '~17.0.11'
    $pins['expo-image-manipulator'] = '~14.0.8'
    $pins['expo-document-picker'] = '~14.0.8'
    $pins['expo-modules-core'] = '~3.0.30'
    $pins['expo-font'] = '~14.0.0'
    $pins['expo'] = '~54.0.0'
    $pins['@expo/vector-icons'] = '^15.0.3'
}
Write-Host "Checking against Expo SDK $Sdk library versions."

# docs/ARCHITECTURE.md section 1, rule 3.
$allowedPackages = @(
    'react', 'react-native', '@react-navigation/native', '@react-navigation/native-stack',
    '@react-navigation/bottom-tabs', 'react-native-safe-area-context', 'react-native-screens',
    '@react-native-async-storage/async-storage', 'expo-image-picker', 'expo-image-manipulator', 'expo-document-picker',
    '@expo/vector-icons'
)

$compilerOptions = [ordered]@{
    strict                           = $true
    noImplicitAny                    = $true
    jsx                              = 'react-jsx'
    module                           = 'esnext'
    moduleResolution                 = 'bundler'
    customConditions                 = @('react-native')
    target                           = 'es2022'
    lib                              = @('es2022', 'dom')
    esModuleInterop                  = $true
    isolatedModules                  = $true
    resolveJsonModule                = $true
    forceConsistentCasingInFileNames = $true
    skipLibCheck                     = $true
    noEmit                           = $true
    types                            = @()
}

$files = [ordered]@{}
$appFiles = @(Get-SourceFiles $appDir @('.ts', '.tsx', '.json') -IncludeDeclarations)
foreach ($f in $appFiles) {
    $files[(Get-RelativePath $rootDir $f.FullName)] = Read-Utf8File $f.FullName
}
$codeCount = @($appFiles | Where-Object { $_.Extension -ne '.json' }).Count
if ($codeCount -eq 0) {
    Write-Host "No .ts/.tsx files under $appDir." -ForegroundColor Red
    exit 1
}

$payload = [ordered]@{
    files           = $files
    compilerOptions = $compilerOptions
    pins            = $pins
    typesFor        = [ordered]@{ 'react' = '@types/react' }
    allowedPackages = $allowedPackages
    shimAll         = [bool]$ShimAll
    debug           = [bool]$Diagnostics
}
$inputJs = New-Object Text.StringBuilder
[void]$inputJs.Append("// Generated by tools/typecheck.ps1 - do not edit. Strings are ASCII-escaped JSON.`n")
[void]$inputJs.Append('window.__TYPECHECK_INPUT__ = ').Append((ConvertTo-AsciiJson $payload)).Append(";`n")

# Downloaded typings are kept in tools\.cache\typecheck-cache.js (written from the JSON the page
# emits, loaded by typecheck.html), so warm runs need no network. PowerShell never parses it.
# It is read and written only while holding the Edge lock, so concurrent runs cannot drop each
# other's downloads.
$cacheDir = Join-Path $PSScriptRoot '.cache'
$cacheFile = Join-Path $cacheDir 'typecheck-cache.js'
$legacyCacheFile = Join-Path $cacheDir 'typecheck-cache.json'
$cachePrefix = "// Generated by tools/typecheck.ps1: jsDelivr responses (URL -> text). Delete it or use -Refresh to start over.`nwindow.__TYPECHECK_CACHE__ = "

$mode = if ($ShimAll) { 'shim mode: only @types/react is real' } else { 'real third-party types from jsDelivr' }
Write-Host ("SplitSnap type check: {0} file(s) under {1} ({2})" -f $codeCount, (Get-RelativePath $rootDir $appDir), $mode) -ForegroundColor Cyan

$outDir = Initialize-OutDir
$lock = Enter-EdgeLock
try {
    if (-not (Test-Path -LiteralPath $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
    if ($Refresh) {
        foreach ($f in @($cacheFile, $legacyCacheFile)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f } }
    } elseif ((Test-Path -LiteralPath $legacyCacheFile) -and -not (Test-Path -LiteralPath $cacheFile)) {
        Write-Utf8File $cacheFile ($cachePrefix + (Read-Utf8File $legacyCacheFile) + ";`n")
        Remove-Item -LiteralPath $legacyCacheFile
    }
    Write-Utf8File (Join-Path $outDir 'typecheck-input.js') $inputJs.ToString()
    $run = Invoke-EdgeDumpDom -HtmlPath (Join-Path $PSScriptRoot 'typecheck.html') -VirtualTimeBudgetMs $VirtualTimeBudgetMs -TimeoutSec $TimeoutSec -ConsoleLog:$Diagnostics
    $newCache = [regex]::Match([string]$run.Dom, '<pre id="typecheck-cache"[^>]*>([^<]+)</pre>')
    if ($newCache.Success) {
        Write-Utf8File $cacheFile ($cachePrefix + $newCache.Groups[1].Value + ";`n")
        Write-Verbose ("Saved downloaded typings to {0} ({1:N1} MB)" -f $cacheFile, ($newCache.Groups[1].Length / 1MB))
    }
} finally {
    Exit-EdgeLock $lock
}
if ($Diagnostics) {
    # Edge log lines carry real wall-clock times (in-page clocks run on virtual time).
    foreach ($line in ($run.StdErr -split "`r?`n")) {
        $m = [regex]::Match($line, '^\[[^\]]*?(\d{6}\.\d{3}):INFO:CONSOLE[^\]]*\] "(.*)", source:')
        if ($m.Success) { Write-Host ('  {0}  {1}' -f $m.Groups[1].Value, $m.Groups[2].Value) -ForegroundColor DarkGray }
    }
}
Write-Verbose ("Edge: {0}" -f $run.Command)
Write-Verbose ("Edge finished in {0} (exit code {1})" -f (Format-Duration $run.ElapsedMs), $run.ExitCode)

$result = $null
try { $result = Get-DomJson $run.Dom 'typecheck-results' } catch { $result = $null }
if ($null -eq $result) {
    Write-Host 'The type-check page never reported a result.' -ForegroundColor Red
    $progress = [regex]::Match([string]$run.Dom, '<pre id="typecheck-progress"[^>]*>([^<]*)</pre>')
    if ($run.TimedOut) { Write-Host "Edge was stopped after $TimeoutSec s (slow or unreachable jsDelivr?)." -ForegroundColor Red }
    elseif (-not $run.Dom) { Write-Host ('Edge produced no output. Edge stderr: ' + $run.StdErr.Trim()) -ForegroundColor Red }
    else { Write-Host "The virtual-time budget ($VirtualTimeBudgetMs ms) ran out; try a larger -VirtualTimeBudgetMs." -ForegroundColor Red }
    if ($progress.Success) { Write-Host ('Last progress: ' + $progress.Groups[1].Value) -ForegroundColor DarkGray }
    Write-Host 'The first run needs https://cdn.jsdelivr.net and https://data.jsdelivr.com to be reachable.' -ForegroundColor DarkGray
    exit 1
}
$fatal = Get-Field $result 'fatal'
if ($fatal) {
    Write-Host "Type check failed to run: $fatal" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------------------------
# Report

$packages = @(Get-Field $result 'packages')
$ready = @($packages | Where-Object { $_ -and (Get-Field $_ 'state') -eq 'ready' })
$failed = @($packages | Where-Object { $_ -and (Get-Field $_ 'state') -ne 'ready' })
$shimmed = @(Get-Field $result 'shimmed' | Where-Object { $_ })

$top = @($ready | Where-Object { $pins.Contains([string](Get-Field $_ 'name')) } | ForEach-Object { '{0}@{1}' -f (Get-Field $_ 'name'), (Get-Field $_ 'version') })
Write-Host ("Types: {0} package(s) acquired{1}" -f $ready.Count, $(if ($top.Count) { ' - ' + ($top -join ', ') } else { '' })) -ForegroundColor DarkGray
if ($showVerbose) {
    foreach ($p in $packages) {
        if (-not $p) { continue }
        $line = '  {0}@{1}  [{2}] {3} file(s)' -f (Get-Field $p 'name'), (Get-Field $p 'version'), (Get-Field $p 'state'), (Get-Field $p 'fetched')
        if (Get-Field $p 'error') { $line += '  ' + (Get-Field $p 'error') }
        Write-Host $line -ForegroundColor DarkGray
    }
    $unresolved = @(Get-Field $result 'unresolvedInLibraries' | Where-Object { $_ })
    if ($unresolved.Count) {
        Write-Host ("  Untyped imports inside library typings ({0}, harmless with skipLibCheck):" -f $unresolved.Count) -ForegroundColor DarkGray
        foreach ($u in $unresolved) { Write-Host ('    ' + $u) -ForegroundColor DarkGray }
    }
} elseif ($failed.Count) {
    Write-Host ("  {0} dependency package(s) could not be fetched (use -Verbose for details)." -f $failed.Count) -ForegroundColor DarkGray
}
if ($shimmed.Count) {
    Write-Host 'Shimmed (no real types, treated as any):' -ForegroundColor Yellow
    foreach ($s in $shimmed) { Write-Host ('  {0}  - {1}' -f (Get-Field $s 'name'), (Get-Field $s 'reason')) -ForegroundColor Yellow }
}
$icons = Get-Field $result 'icons'
if ((Get-Field $icons 'state') -eq 'checked') {
    Write-Host ("Icon names: {0} literal(s) in icon positions checked against {1} Ionicons glyphs (@expo/vector-icons {2})" -f
        (Get-Field $icons 'literals'), (Get-Field $icons 'glyphs'), (Get-Field $icons 'version')) -ForegroundColor DarkGray
} elseif ($icons) {
    Write-Host ("Icon names: not checked ({0})" -f (Get-Field $icons 'reason')) -ForegroundColor $(if ($ShimAll) { 'DarkGray' } else { 'Yellow' })
}

Write-Host ''
$errorCount = 0
$errorFiles = New-Object 'Collections.Generic.HashSet[string]'
foreach ($d in @(Get-Field $result 'diagnostics')) {
    if (-not $d) { continue }
    $category = [string](Get-Field $d 'category')
    $code = [string](Get-Field $d 'code')
    $codeText = if ($code -match '^\d+$') { "TS$code" } else { $code }
    $message = ([string](Get-Field $d 'message')) -replace "`n", "`n  "
    $file = Get-Field $d 'file'
    $where = if ($file) { '{0}({1},{2}): ' -f $file, (Get-Field $d 'line'), (Get-Field $d 'col') } else { '' }
    $color = if ($category -eq 'error') { 'Red' } else { 'Yellow' }
    Write-Host ('{0}{1} {2}: {3}' -f $where, $category, $codeText, $message) -ForegroundColor $color
    if ($category -eq 'error') {
        $errorCount++
        if ($file) { [void]$errorFiles.Add([string]$file) }
    }
}

$stats = Get-Field $result 'stats'
$wall.Stop()
if ($errorCount -eq 0) {
    Write-Host ("No type errors in {0} file(s)." -f (Get-Field $result 'appFiles')) -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host ("Found {0} error(s) in {1} file(s)." -f $errorCount, $errorFiles.Count) -ForegroundColor Red
}
$mb = [double](Get-Field $stats 'bytes') / 1MB
Write-Host ("Time: {0} ({1} file(s) in the program; {2} download(s), {3:N1} MB; {4} from tools\.cache)" -f (Format-Duration $wall.ElapsedMilliseconds),
    (Get-Field $result 'programFiles'), (Get-Field $stats 'requests'), $mb, (Get-Field $stats 'cacheHits')) -ForegroundColor DarkGray

if ($errorCount -gt 0) { exit 1 }
exit 0
