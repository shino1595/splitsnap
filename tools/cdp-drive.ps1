<#
.SYNOPSIS
    Drives a hidden (headless) Microsoft Edge through the Chrome DevTools Protocol so the app can
    be clicked through in the Expo Snack web preview. Nothing is installed.

.DESCRIPTION
    Each instance is a separate Edge on its own debugging port (127.0.0.1 only) and profile
    (tools\.edge-profile-cdp-<port>). Set $env:CDP_PORT (default 9333) to run several in parallel.
    The first call starts Edge; later calls reuse it, so a session is driven step by step.
    Screenshots go to tools\.out\snack-shots\<name>.png (override with $env:CDP_SHOTS).

    Usual session:
      cdp-drive.ps1 'open tools\.out\qa-me.html'      # loads app/ in Snack, opens the full editor, waits for the preview
      cdp-drive.ps1 'pshot home' 'text'               # screenshot of the phone preview + its visible text
      cdp-drive.ps1 'tap tab-add-expense' 'wait 2' 'pshot add'
      cdp-drive.ps1 'quit'

    Steps (executed in order):
      open <launcher.html>  open a launcher page built by build-snack-launcher.ps1 in live mode,
                            open Snack's full editor from it and wait (up to 150 s) for the preview
      reload                reload the full-editor tab's preview (after a code change, use 'open' again)
      wait <seconds>        real-time wait
      shot <name> [x y w h] screenshot of the whole page, optionally clipped
      pshot <name>          screenshot of just the phone preview
      text                  print the preview's visible text (first 3000 characters)
      tap <testID>          scroll the element with that testID into view in the preview and click it
      tapText <text>        click the first visible element in the preview whose text is exactly <text>
      pclick <x> <y>        click at preview coordinates
      click <x> <y>         click at page coordinates
      type <text>           insert text at the focused element
      key <Enter|Backspace|Tab|Escape>
      scroll <dy>           mouse-wheel scroll inside the preview (dy > 0 scrolls down)
      drag <x1> <y1> <x2> <y2>  page-coordinate drag
      eval <js>             evaluate JavaScript in the page; peval <js> evaluates it in the preview
      errors                print console errors/warnings captured in the preview since 'open'
      quit                  close this Edge instance
#>
param([Parameter(ValueFromRemainingArguments)] [string[]]$Steps)
$ErrorActionPreference = 'Stop'
$port = if ($env:CDP_PORT) { [int]$env:CDP_PORT } else { 9333 }
$root = Split-Path $PSScriptRoot -Parent
$shots = if ($env:CDP_SHOTS) { $env:CDP_SHOTS } else { Join-Path $root 'tools\.out\snack-shots' }
New-Item -ItemType Directory -Force $shots | Out-Null
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$ct = [Threading.CancellationToken]::None
$buffer = New-Object byte[] 1048576
$script:nextId = 0

function Get-Targets {
    # Invoke-RestMethod hands a JSON array back as one object; ForEach-Object unrolls it.
    try { return (Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 3) | ForEach-Object { $_ } } catch { return $null }
}

function Start-Edge {
    $targets = Get-Targets
    if ($targets) { return }
    $profileDir = Join-Path $root "tools\.edge-profile-cdp-$port"
    Start-Process -FilePath $edge -WindowStyle Hidden -ArgumentList @(
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        "--remote-debugging-port=$port", "--user-data-dir=`"$profileDir`"", '--window-size=1500,1000', 'about:blank') | Out-Null
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (Get-Targets) { return } }
    throw "Edge did not open debugging port $port."
}

# ---- one websocket per target ----
function Connect-Target($target) {
    $ws = New-Object Net.WebSockets.ClientWebSocket
    $ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $ct).Wait()
    return $ws
}

function Receive-Message($ws) {
    $ms = New-Object IO.MemoryStream
    do {
        $seg = New-Object 'ArraySegment[byte]' -ArgumentList @(, $buffer)
        $r = $ws.ReceiveAsync($seg, $ct).GetAwaiter().GetResult()
        $ms.Write($buffer, 0, $r.Count)
    } while (-not $r.EndOfMessage)
    return [Text.Encoding]::UTF8.GetString($ms.ToArray())
}

# Sends one command and returns the raw JSON text of its response (events are skipped).
function Invoke-Cdp($ws, [string]$Method, [hashtable]$Params = @{}) {
    $script:nextId++
    $id = $script:nextId
    $json = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $seg = New-Object 'ArraySegment[byte]' -ArgumentList @(, $bytes)
    $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
    while ($true) {
        $text = Receive-Message $ws
        if ($text.StartsWith('{"id":' + $id + ',')) {
            if ($text -match '^\{"id":\d+,"error":') { throw "CDP $Method failed: $text" }
            return $text
        }
    }
}

# Evaluates JS and returns the string value (JS must evaluate to a string or number).
function Get-EvalString($ws, [string]$Js) {
    $resp = Invoke-Cdp $ws 'Runtime.evaluate' @{ expression = $Js; returnByValue = $true; awaitPromise = $true }
    $obj = $resp | ConvertFrom-Json
    if ($obj.result.exceptionDetails) { return 'EXCEPTION: ' + $obj.result.exceptionDetails.exception.description }
    return [string]$obj.result.result.value
}

function Close-Ws($ws) {
    if ($ws -and $ws.State -eq 'Open') { try { $ws.CloseAsync([Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $ct).Wait() } catch { } }
}

# ---- target selection ----
function Get-EditorPage {
    $t = Get-Targets
    if ($env:CDP_TARGET) { return @($t | Where-Object { $_.type -in 'page', 'iframe' -and $_.url -like "*$($env:CDP_TARGET)*" })[0] }
    $editor = @($t | Where-Object { $_.type -eq 'page' -and $_.url -like 'https://snack.expo.dev/*' })[0]
    if ($editor) { return $editor }
    return @($t | Where-Object { $_.type -eq 'page' })[0]
}

function Get-PreviewTarget($page) {
    # The preview frame may be a child (full editor) or grandchild (Snack embedded in a page).
    $t = @(Get-Targets)
    foreach ($f in ($t | Where-Object { $_.type -eq 'iframe' -and $_.url -like '*snack-runtime*' })) {
        $p = $f.parentId
        for ($depth = 0; $p -and $depth -lt 4; $depth++) {
            if ($p -eq $page.id) { return $f }
            $p = @($t | Where-Object { $_.id -eq $p })[0].parentId
        }
    }
    return $null
}

$script:pageWs = $null
$script:page = $null
$script:previewWs = $null

function Use-Page {
    if ($script:pageWs) { return }
    $script:page = Get-EditorPage
    if (-not $script:page) { throw 'No page target found.' }
    $script:pageWs = Connect-Target $script:page
    Invoke-Cdp $script:pageWs 'Page.enable' | Out-Null
    # The viewport override only lives as long as this connection, so set it every time.
    Invoke-Cdp $script:pageWs 'Emulation.setDeviceMetricsOverride' @{ width = 1500; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
}

function Reset-Connections {
    Close-Ws $script:previewWs; $script:previewWs = $null
    Close-Ws $script:pageWs; $script:pageWs = $null
}

function Use-Preview {
    Use-Page
    if ($script:previewWs) { return }
    $p = Get-PreviewTarget $script:page
    if (-not $p) { throw 'The Snack preview frame was not found (is the full editor open?).' }
    $script:previewWs = Connect-Target $p
}

function Get-PreviewRect {
    Use-Page
    $v = Get-EvalString $script:pageWs "(function(){var f=document.querySelector('iframe[src*=""snack-runtime""]');if(!f)return '';var r=f.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join(' ')})()"
    if (-not $v) { throw 'Preview frame not found in the page.' }
    return [double[]]($v -split ' ')
}

function Send-Click([double]$x, [double]$y) {
    Use-Page
    Invoke-Cdp $script:pageWs 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $x; y = $y } | Out-Null
    Invoke-Cdp $script:pageWs 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $x; y = $y; button = 'left'; clickCount = 1 } | Out-Null
    Invoke-Cdp $script:pageWs 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $x; y = $y; button = 'left'; clickCount = 1 } | Out-Null
}

function Save-Shot([string]$Name, $Clip) {
    Use-Page
    $p = @{ format = 'png' }
    if ($Clip) { $p.clip = @{ x = $Clip[0]; y = $Clip[1]; width = $Clip[2]; height = $Clip[3]; scale = 1 } }
    $resp = Invoke-Cdp $script:pageWs 'Page.captureScreenshot' $p
    if ($resp -notmatch '"data":"([^"]+)"') { throw 'No screenshot data.' }
    $file = Join-Path $shots ($Name + '.png')
    [IO.File]::WriteAllBytes($file, [Convert]::FromBase64String($Matches[1]))
    Write-Host "saved $file"
}

$hookJs = "(function(){if(window.__qaErrs)return 'already';window.__qaErrs=[];var push=function(p,a){window.__qaErrs.push(p+[].map.call(a,function(x){return (x&&x.stack)||String(x)}).join(' ').slice(0,700))};var oe=console.error,ow=console.warn;console.error=function(){push('ERROR: ',arguments);oe.apply(console,arguments)};console.warn=function(){push('WARN: ',arguments);ow.apply(console,arguments)};window.addEventListener('error',function(e){window.__qaErrs.push('UNCAUGHT: '+e.message)});window.addEventListener('unhandledrejection',function(e){window.__qaErrs.push('REJECTION: '+((e.reason&&e.reason.stack)||e.reason))});return 'hooked'})()"

Start-Edge
$keyCodes = @{ Enter = 13; Backspace = 8; Tab = 9; Escape = 27 }
try {
    foreach ($step in $Steps) {
        $parts = $step -split ' ', 2
        $verb = $parts[0]
        $arg = if ($parts.Count -gt 1) { $parts[1] } else { '' }
        switch ($verb) {
            'open' {
                # Close old editor tabs, load the launcher in live mode, open the full editor.
                Reset-Connections
                foreach ($t in (Get-Targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'https://snack.expo.dev/*' })) {
                    try { Invoke-RestMethod "http://127.0.0.1:$port/json/close/$($t.id)" | Out-Null } catch { }
                }
                $launcher = (Resolve-Path $arg).ProviderPath
                # A unique query forces a real reload; a hash-only change would keep the old files in the page.
                $url = ([Uri]$launcher).AbsoluteUri + '?v=' + [DateTime]::Now.Ticks + '#live'
                $lp = @(Get-Targets | Where-Object { $_.type -eq 'page' })[0]
                $lws = Connect-Target $lp
                Invoke-Cdp $lws 'Emulation.setDeviceMetricsOverride' @{ width = 1500; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
                Invoke-Cdp $lws 'Page.navigate' @{ url = $url } | Out-Null
                $ok = $false
                for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
                    Start-Sleep -Seconds 1
                    $ok = (Get-EvalString $lws "document.getElementById('snack-live') ? document.getElementById('snack-live').textContent : ''") -match 'handshake":true'
                }
                if (-not $ok) { Close-Ws $lws; throw 'Snack did not accept the files (no handshake within 60 s).' }
                $pos = Get-EvalString $lws "(function(){var f=document.getElementById('snack-frame');f.scrollIntoView();var r=f.getBoundingClientRect();return Math.round(r.left+135)+' '+Math.round(r.top+23)})()"
                Start-Sleep -Seconds 3
                $xy = [double[]]($pos -split ' ')
                Invoke-Cdp $lws 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $xy[0]; y = $xy[1]; button = 'left'; clickCount = 1 } | Out-Null
                Invoke-Cdp $lws 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $xy[0]; y = $xy[1]; button = 'left'; clickCount = 1 } | Out-Null
                Close-Ws $lws
                $ready = $false
                for ($i = 0; $i -lt 150 -and -not $ready; $i++) {
                    Start-Sleep -Seconds 1
                    try {
                        Reset-Connections
                        Use-Preview
                        $txt = Get-EvalString $script:previewWs "document.querySelector('[data-testid]') ? 'app' : ''"
                        $ready = $txt -eq 'app'
                    } catch { $ready = $false }
                }
                if (-not $ready) { throw 'The Snack preview did not start within 150 s.' }
                # Free the copy of Snack embedded in the launcher tab (~0.8 GB); the full editor has the files.
                $lws = Connect-Target $lp
                Invoke-Cdp $lws 'Page.navigate' @{ url = 'about:blank' } | Out-Null
                Close-Ws $lws
                Get-EvalString $script:previewWs $hookJs | Out-Null
                Start-Sleep -Seconds 2
                Write-Host 'Snack preview is running.'
            }
            'reload' { Use-Preview; Get-EvalString $script:previewWs 'location.reload(); 1' | Out-Null; Reset-Connections; Start-Sleep -Seconds 8; Use-Preview; Get-EvalString $script:previewWs $hookJs | Out-Null }
            'nav' { Use-Page; Invoke-Cdp $script:pageWs 'Page.navigate' @{ url = $arg } | Out-Null }
            'wait' { Start-Sleep -Seconds ([double]$arg) }
            'shot' {
                $sp = $arg -split ' '
                $clip = $null
                if ($sp.Count -ge 5) { $clip = [double[]]$sp[1..4] }
                Save-Shot $sp[0] $clip
            }
            'pshot' { Save-Shot $arg (Get-PreviewRect) }
            'text' { Use-Preview; Write-Host (Get-EvalString $script:previewWs "document.body.innerText.slice(0,3000)") }
            'tap' {
                Use-Preview
                $r = Get-PreviewRect
                $v = Get-EvalString $script:previewWs "(function(){var e=document.querySelector('[data-testid=""$arg""]');if(!e)return 'missing';e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();return Math.round(r.left+r.width/2)+' '+Math.round(r.top+r.height/2)})()"
                if ($v -eq 'missing') { throw "No element with testID '$arg' in the preview." }
                Start-Sleep -Milliseconds 300
                $xy = [double[]]($v -split ' ')
                Send-Click ($r[0] + $xy[0]) ($r[1] + $xy[1])
            }
            'tapText' {
                Use-Preview
                $r = Get-PreviewRect
                $needle = $arg.Replace('\', '\\').Replace("'", "\'")
                $v = Get-EvalString $script:previewWs "(function(){var all=document.querySelectorAll('div,span,a,button');for(var i=all.length-1;i>=0;i--){var e=all[i];if((e.innerText||'').trim()==='$needle'){var r0=e.getBoundingClientRect();if(r0.width>0&&r0.height>0){e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();return Math.round(r.left+r.width/2)+' '+Math.round(r.top+r.height/2)}}}return 'missing'})()"
                if ($v -eq 'missing') { throw "No visible element with text '$arg' in the preview." }
                Start-Sleep -Milliseconds 300
                $xy = [double[]]($v -split ' ')
                Send-Click ($r[0] + $xy[0]) ($r[1] + $xy[1])
            }
            'nettap' {
                # nettap <seconds> <visible text>: taps the text, then prints the preview's network
                # requests (URL, status, failures) and console exceptions for <seconds>.
                $sp = $arg -split ' ', 2
                Use-Preview
                Invoke-Cdp $script:previewWs 'Network.enable' | Out-Null
                Invoke-Cdp $script:previewWs 'Runtime.enable' | Out-Null
                $r = Get-PreviewRect
                $needle = $sp[1].Replace("'", "\'")
                $v = Get-EvalString $script:previewWs "(function(){var all=document.querySelectorAll('div,span,a,button');for(var i=all.length-1;i>=0;i--){var e=all[i];if((e.innerText||'').trim()==='$needle'){var r=e.getBoundingClientRect();if(r.width>0)return Math.round(r.left+r.width/2)+' '+Math.round(r.top+r.height/2)}}return 'missing'})()"
                if ($v -eq 'missing') { throw "No visible element with text '$($sp[1])'." }
                $xy = [double[]]($v -split ' ')
                Send-Click ($r[0] + $xy[0]) ($r[1] + $xy[1])
                $deadline = (Get-Date).AddSeconds([double]$sp[0])
                # Only one receive may be pending on a websocket, so a timed-out read is kept and awaited again.
                $pending = $null
                $ms = New-Object IO.MemoryStream
                while ((Get-Date) -lt $deadline) {
                    if (-not $pending) {
                        $seg = New-Object 'ArraySegment[byte]' -ArgumentList @(, $buffer)
                        $pending = $script:previewWs.ReceiveAsync($seg, $ct)
                    }
                    if (-not $pending.Wait(1000)) { continue }
                    $ms.Write($buffer, 0, $pending.Result.Count)
                    $done = $pending.Result.EndOfMessage
                    $pending = $null
                    if (-not $done) { continue }
                    $msg = [Text.Encoding]::UTF8.GetString($ms.ToArray())
                    $ms = New-Object IO.MemoryStream
                    if ($msg -match '"method":"Network\.requestWillBeSent".*?"url":"([^"]{0,160})') { Write-Host "REQ  $($Matches[1])" }
                    elseif ($msg -match '"method":"Network\.responseReceived".*?"url":"([^"]{0,120})".*?"status":(\d+)') { Write-Host "RESP $($Matches[2]) $($Matches[1])" }
                    elseif ($msg -match '"method":"Network\.loadingFailed".*?"errorText":"([^"]*)"') { Write-Host "FAIL $($Matches[1]) $($msg.Substring(0, [Math]::Min(300, $msg.Length)))" }
                    elseif ($msg -match '"method":"Runtime\.(exceptionThrown|consoleAPICalled)"') { Write-Host "CONSOLE $($msg.Substring(0, [Math]::Min(500, $msg.Length)))" }
                }
            }
            'upload' {
                # upload <file> <visible text>: taps the element with that text (which opens a file
                # chooser, e.g. "Choose from gallery") and answers the chooser with <file>.
                $sp = $arg -split ' ', 2
                $file = (Resolve-Path $sp[0]).ProviderPath
                $needle = $sp[1].Replace("'", "\'")
                Use-Preview
                Invoke-Cdp $script:previewWs 'Page.enable' | Out-Null
                Invoke-Cdp $script:previewWs 'DOM.enable' | Out-Null
                Invoke-Cdp $script:previewWs 'Page.setInterceptFileChooserDialog' @{ enabled = $true } | Out-Null
                $r = Get-PreviewRect
                $v = Get-EvalString $script:previewWs "(function(){var all=document.querySelectorAll('div,span,a,button');for(var i=all.length-1;i>=0;i--){var e=all[i];if((e.innerText||'').trim()==='$needle'){var r0=e.getBoundingClientRect();if(r0.width>0){e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();return Math.round(r.left+r.width/2)+' '+Math.round(r.top+r.height/2)}}}return 'missing'})()"
                if ($v -eq 'missing') { throw "No visible element with text '$($sp[1])' in the preview." }
                $xy = [double[]]($v -split ' ')
                Send-Click ($r[0] + $xy[0]) ($r[1] + $xy[1])
                $node = $null
                $deadline = (Get-Date).AddSeconds(15)
                $pending = $null
                while (-not $node -and (Get-Date) -lt $deadline) {
                    if (-not $pending) {
                        $seg = New-Object 'ArraySegment[byte]' -ArgumentList @(, $buffer)
                        $pending = $script:previewWs.ReceiveAsync($seg, $ct)
                    }
                    if (-not $pending.Wait(1000)) { continue }
                    $msg = [Text.Encoding]::UTF8.GetString($buffer, 0, $pending.Result.Count)
                    $pending = $null
                    if ($msg -match '"method":"Page\.fileChooserOpened".*"backendNodeId":(\d+)') { $node = [int]$Matches[1] }
                }
                if (-not $node) { throw 'No file chooser opened (the tap did not start a file picker).' }
                Invoke-Cdp $script:previewWs 'DOM.setFileInputFiles' @{ files = @($file); backendNodeId = $node } | Out-Null
                Write-Host "uploaded $file"
            }
            'pclick' { $r = Get-PreviewRect; $xy = [double[]]($arg -split ' '); Send-Click ($r[0] + $xy[0]) ($r[1] + $xy[1]) }
            'click' { $xy = [double[]]($arg -split ' '); Send-Click $xy[0] $xy[1] }
            'type' { Use-Page; Invoke-Cdp $script:pageWs 'Input.insertText' @{ text = $arg } | Out-Null }
            'key' {
                Use-Page
                $code = $keyCodes[$arg]
                Invoke-Cdp $script:pageWs 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = $arg; code = $arg; windowsVirtualKeyCode = $code } | Out-Null
                Invoke-Cdp $script:pageWs 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = $arg; code = $arg; windowsVirtualKeyCode = $code } | Out-Null
            }
            'scroll' {
                $r = Get-PreviewRect
                Invoke-Cdp $script:pageWs 'Input.dispatchMouseEvent' @{ type = 'mouseWheel'; x = $r[0] + $r[2] / 2; y = $r[1] + $r[3] / 2; deltaX = 0; deltaY = [double]$arg } | Out-Null
            }
            'drag' {
                Use-Page
                $v = [double[]]($arg -split ' ')
                Invoke-Cdp $script:pageWs 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $v[0]; y = $v[1]; button = 'left'; clickCount = 1 } | Out-Null
                for ($s = 1; $s -le 10; $s++) {
                    Invoke-Cdp $script:pageWs 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $v[0] + ($v[2] - $v[0]) * $s / 10; y = $v[1] + ($v[3] - $v[1]) * $s / 10; button = 'left'; buttons = 1 } | Out-Null
                }
                Invoke-Cdp $script:pageWs 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $v[2]; y = $v[3]; button = 'left'; clickCount = 1 } | Out-Null
            }
            'eval' { Use-Page; Write-Host (Get-EvalString $script:pageWs $arg) }
            'peval' { Use-Preview; Write-Host (Get-EvalString $script:previewWs $arg) }
            'pevalfile' { Use-Preview; Write-Host (Get-EvalString $script:previewWs ([IO.File]::ReadAllText((Resolve-Path $arg).ProviderPath))) }
            'errors' { Use-Preview; Write-Host (Get-EvalString $script:previewWs "JSON.stringify(window.__qaErrs || ['(not hooked: run open first)'], null, 1)") }
            'quit' {
                Reset-Connections
                Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match "edge-profile-cdp-$port" } |
                    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
                Write-Host "Edge on port $port closed."
            }
            default { throw "Unknown step: $step" }
        }
    }
} finally {
    Reset-Connections
}
