<#
.SYNOPSIS
    Live check of SplitSnap bill scanning against the real OCR.space service, using only
    synthetic (made-up) bills rendered from the HTML pages in this folder.

.DESCRIPTION
    1. Renders bill-<name>.html to PNG with headless Microsoft Edge (2x device scale) and
       re-encodes it to JPEG under 900 KB with System.Drawing.
    2. POSTs each JPEG to https://api.ocr.space/parse/image exactly the way the app does
       (x-www-form-urlencoded base64Image, language=eng, isTable=true, OCREngine, scale=true,
       detectOrientation=true, isOverlayRequired=true; header apikey).
    3. Saves each raw JSON response to tests/ocr/fixtures/live/bill_<name>.json and as a
       TypeScript fixture tests/ocr/fixtures/live_bill_<name>.ts (export const response = ...).

    Every upload is logged in .calls.log; the script refuses to go over -CallBudget uploads in
    total (the free demo key allows ~500 requests a day per IP, we stay far below that).

.PARAMETER Names      Bills to process (default a, b, c; d is the angled, blurred cafe bill).
.PARAMETER RenderOnly Only render the JPEGs, do not upload.
.PARAMETER Engine     OCR.space engine (default 2).
.PARAMETER Suffix     Appended to the fixture names, e.g. -Names a -Engine 1 -Suffix _e1 writes bill_a_e1.json
                      and live_bill_a_e1.ts (so engine variants never overwrite the default fixtures).
.PARAMETER ApiKey     OCR.space key (default: the public demo key 'helloworld').
.PARAMETER CallBudget Maximum uploads ever made by this script (default 12).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\ocr-live\run-ocr-live.ps1
.EXAMPLE
    .\tools\ocr-live\run-ocr-live.ps1 -Names b -RenderOnly
#>
[CmdletBinding()]
param(
    [string[]]$Names = @('a', 'b', 'c'),
    [switch]$RenderOnly,
    [ValidateSet(1, 2, 3)][int]$Engine = 2,
    [ValidatePattern('^[A-Za-z0-9_]*$')][string]$Suffix = '',
    [string]$ApiKey = 'helloworld',
    [int]$CallBudget = 12
)

$ErrorActionPreference = 'Stop'
# powershell -File passes '-Names a,d' as one string.
$Names = @($Names | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$here = $PSScriptRoot
$root = Split-Path (Split-Path $here -Parent) -Parent
$outDir = Join-Path $here 'out'
$fixtureDir = Join-Path $root 'tests\ocr\fixtures'
$liveDir = Join-Path $fixtureDir 'live'
$profileDir = Join-Path $here '.edge-profile'
$callLog = Join-Path $here '.calls.log'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$utf8 = New-Object Text.UTF8Encoding($false)

foreach ($d in @($outDir, $liveDir, $profileDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

function Render-Bill([string]$Name) {
    $html = Join-Path $here "bill-$Name.html"
    if (-not (Test-Path $html)) { throw "Missing $html" }
    $png = Join-Path $outDir "bill_$Name.png"
    $jpg = Join-Path $outDir "bill_$Name.jpg"
    if (Test-Path $png) { Remove-Item $png -Force }

    $url = 'file:///' + ($html -replace '\\', '/')
    $edgeArgs = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
        '--window-size=420,1200', "--user-data-dir=$profileDir", "--screenshot=$png", $url)
    $p = Start-Process -FilePath $edge -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden
    if (-not $p.WaitForExit(60000)) { try { $p.Kill() } catch {} ; throw "Edge timed out rendering $html" }
    for ($i = 0; $i -lt 20 -and -not (Test-Path $png); $i++) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path $png)) { throw "Edge did not write $png" }

    $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $img = [Drawing.Image]::FromFile($png)
    try {
        foreach ($quality in @(82, 70, 55, 40)) {
            $params = New-Object Drawing.Imaging.EncoderParameters(1)
            $params.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]$quality)
            $img.Save($jpg, $codec, $params)
            if ((Get-Item $jpg).Length -lt 900KB) { break }
        }
    } finally { $img.Dispose() }
    $size = (Get-Item $jpg).Length
    if ($size -ge 900KB) { throw "$jpg is still $size bytes" }
    Write-Host ("Rendered bill_{0}.jpg ({1:N0} KB)" -f $Name, ($size / 1KB)) -ForegroundColor Cyan
    return $jpg
}

function Get-CallCount {
    if (-not (Test-Path $callLog)) { return 0 }
    return @(Get-Content $callLog | Where-Object { $_.Trim() }).Count
}

function Invoke-Ocr([string]$Jpg) {
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Jpg))
    $fields = [ordered]@{
        base64Image         = "data:image/jpeg;base64,$b64"
        language            = 'eng'
        isTable             = 'true'
        OCREngine           = [string]$Engine
        scale               = 'true'
        detectOrientation   = 'true'
        isOverlayRequired   = 'true'
    }
    $body = ($fields.GetEnumerator() | ForEach-Object { $_.Key + '=' + [Net.WebUtility]::UrlEncode($_.Value) }) -join '&'

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $client = New-Object Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(90)
    try {
        $content = New-Object Net.Http.StringContent($body, $utf8, 'application/x-www-form-urlencoded')
        $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Post, 'https://api.ocr.space/parse/image')
        $request.Headers.Add('apikey', $ApiKey)
        $request.Content = $content
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $sw.Stop()
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Text = $utf8.GetString($bytes); Ms = $sw.ElapsedMilliseconds }
    } finally { $client.Dispose() }
}

foreach ($name in $Names) {
    $jpg = Render-Bill $name
    if ($RenderOnly) { continue }

    $used = Get-CallCount
    if ($used -ge $CallBudget) {
        Write-Host "Call budget reached ($used of $CallBudget uploads logged in $callLog); not uploading bill_$name." -ForegroundColor Yellow
        continue
    }
    $id = "bill_$name$Suffix"
    Add-Content -Path $callLog -Value ("{0:u} {1} engine={2}" -f (Get-Date), $id, $Engine)
    try {
        $r = Invoke-Ocr $jpg
    } catch {
        Write-Host "${id}: request failed: $($_.Exception.Message)" -ForegroundColor Red
        continue
    }
    Write-Host ("{0}: HTTP {1} in {2:N1} s, {3:N0} chars" -f $id, $r.Status, ($r.Ms / 1000), $r.Text.Length)

    $isJson = $r.Text.TrimStart().StartsWith('{')
    if ($r.Status -ne 200 -or -not $isJson) {
        $errFile = Join-Path $outDir "${id}_error.txt"
        [IO.File]::WriteAllText($errFile, "HTTP $($r.Status)`r`n$($r.Text)", $utf8)
        Write-Host "  Not a JSON success response; saved to $errFile" -ForegroundColor Red
        continue
    }
    $parsed = $r.Text | ConvertFrom-Json
    if ($parsed.IsErroredOnProcessing) {
        Write-Host ("  OCR.space error: " + (@($parsed.ErrorMessage) -join ' | ')) -ForegroundColor Red
    }

    $jsonPath = Join-Path $liveDir "$id.json"
    [IO.File]::WriteAllText($jsonPath, $r.Text, $utf8)
    $tsPath = Join-Path $fixtureDir "live_$id.ts"
    $header = "// Raw OCR.space response (OCREngine=$Engine, isTable=true, isOverlayRequired=true) for the synthetic`n" +
        "// bill tools/ocr-live/bill-$name.html, captured $(Get-Date -Format 'yyyy-MM-dd') by tools/ocr-live/run-ocr-live.ps1.`n"
    [IO.File]::WriteAllText($tsPath, $header + 'export const response = ' + $r.Text.Trim() + ";`n", $utf8)
    Write-Host "  Saved $jsonPath and $tsPath" -ForegroundColor Green
    $first = @($parsed.ParsedResults)[0]
    if ($first) { Write-Host ($first.ParsedText -replace "`r", '') -ForegroundColor DarkGray }
}
Write-Host ("Uploads used so far: {0} of {1}" -f (Get-CallCount), $CallBudget)
