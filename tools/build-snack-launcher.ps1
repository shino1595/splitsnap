<#
.SYNOPSIS
    Builds open-in-snack.html: a page whose button runs the whole app/ folder in Expo Snack.

.DESCRIPTION
    Reads every text file under app/ (App.tsx, src/**) and writes:
      - open-in-snack.html (project root): a self-contained page. Its "Run SplitSnap in Expo
        Snack" button loads Snack's embedded editor (https://snack.expo.dev/embedded) inside the
        page and hands it the project through Snack's embed data channel: Snack posts
        ['expoFrameLoaded', { iframeId }] to the page, which answers with
        ['expoDataEvent', { iframeId, name, description, platform: 'web', sdkVersion: '54.0.0' (-SdkVersion),
        supportedPlatforms: 'ios,android,web,mydevice', dependencies, files }], where files is
        JSON { "App.tsx": { "type": "CODE", "contents": "..." }, "src/lib/money.ts": {...}, ... }.
        The arrow icon at the top of the embedded Snack opens the full editor in a new tab with
        the same files (My Device QR code, iOS / Android previews); nothing is saved to Expo.
      - tools/.out/<page name>.files.json: the same files object, for inspection.

    Why not a form POST to snack.expo.dev: Snack parses POST bodies with koa-bodyparser's
    default 56 KB form limit, and this app is far larger, so a POST fails (HTTP 413). The embed
    data channel has no such limit.

    Nothing is uploaded by this script or when the page opens; the code only leaves the PC when
    someone clicks the button. The data is embedded as an ASCII-escaped JSON literal, so any
    source text (quotes, </script>, Unicode such as the rupee sign) survives exactly. Binary
    files (images, fonts) are skipped with a warning: Snack needs those uploaded as assets.
    Empty files are sent as a single newline, because Snack rejects files without contents.

    The page also explains how to run the app: Android phone = Expo Go for SDK 54 from
    https://expo.dev/go + Snack's "My Device" QR code; iPhone = App Store Expo Go (SDK 54) signed in to a free
    Expo account + "My Device"; no phone = Snack's in-browser iOS / Android / Web preview; bill scanning
    = the shared OCR.space demo key, or a free personal key from https://ocr.space/ocrapi/freekey.
    Re-run this script after changing anything under app/.

    Page fragments used by tools/selftest/run-selftest.ps1: #verify writes the exact data
    message into <pre id="snack-verify"> without contacting Snack; #live starts Snack at once
    and writes the handshake result into <pre id="snack-live">.

.PARAMETER Root
    Project root that contains app/ (default: the folder above tools/).
.PARAMETER OutFile
    Where to write the launcher page (default: <Root>\open-in-snack.html).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-snack-launcher.ps1
#>
[CmdletBinding()]
param(
    [string]$Root,
    [string]$OutFile,
    # Expo SDK Snack runs the project with. 54 is the newest that works everywhere: Snack's own
    # iOS/Android simulators (its 55 and 56 entries point at SDK 56 devices) and the App Store's
    # Expo Go, which stops at SDK 54.
    [string]$SdkVersion = '54.0.0'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$rootDir = Resolve-ProjectRoot $Root
$appDir = Join-Path $rootDir 'app'
if (-not $OutFile) { $OutFile = Join-Path $rootDir 'open-in-snack.html' }
if (-not (Test-Path -LiteralPath $appDir)) {
    Write-Host "No app/ folder under $rootDir." -ForegroundColor Red
    exit 1
}

# docs/ARCHITECTURE.md section 9 (versions pinned where Snack cannot infer them).
# react-native-screens is left out on purpose: Snack's native runtime already ships it, and
# asking Snack to build it from npm fails ("Failed to resolve dependency react-native-screens@~4.23.0").
$dependencies = '@react-navigation/native@7.5.0,@react-navigation/native-stack@7.20.0,@react-navigation/bottom-tabs@7.20.0,' +
    'react-native-safe-area-context,@react-native-async-storage/async-storage,' +
    'expo-image-picker,expo-image-manipulator,expo-document-picker,@expo/vector-icons,' +
    '@supabase/supabase-js,react-native-url-polyfill'

# Snack's SDK 56 runtime still ships a preview `expo` package. expo-image-picker 56.0.7+ imports
# createPermissionHook from `expo` and crashes there ("createPermissionHook is not a function");
# 56.0.6 still imports it from expo-modules-core.
if ($SdkVersion -like '56.*') { $dependencies = $dependencies.Replace('expo-image-picker,', 'expo-image-picker@56.0.6,') }

$textExtensions = @('.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css')
$snackFiles = [ordered]@{}
$listing = New-Object Collections.Generic.List[object]
$totalBytes = 0
$skipped = New-Object Collections.Generic.List[string]
$emptied = New-Object Collections.Generic.List[string]

# app/ is also the real Expo project published with EAS Update (SDK 58). Its project files would
# make Snack switch SDK or entry point, so they stay out of the Snack.
$expoProjectFiles = @('package.json', 'package-lock.json', 'app.json', 'eas.json', 'index.js', 'tsconfig.json', 'babel.config.js', 'metro.config.js')
$all = Get-ChildItem -LiteralPath $appDir -Recurse -File |
    Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.[^\\/]+)[\\/]' -and $_.Name -notlike '.*' } |
    Where-Object { -not ($_.DirectoryName -eq $appDir -and $expoProjectFiles -contains $_.Name) } |
    Sort-Object FullName
foreach ($f in $all) {
    $rel = Get-RelativePath $appDir $f.FullName
    if ($textExtensions -notcontains $f.Extension.ToLowerInvariant()) {
        $skipped.Add($rel)
        continue
    }
    $text = Read-Utf8File $f.FullName
    if ($text.Length -eq 0) {
        $text = "`n"
        $emptied.Add($rel)
    }
    $snackFiles[$rel] = [ordered]@{ type = 'CODE'; contents = $text }
    $bytes = [Text.Encoding]::UTF8.GetByteCount($text)
    $totalBytes += $bytes
    $listing.Add([ordered]@{ path = $rel; bytes = $bytes })
}

if ($snackFiles.Count -eq 0) {
    Write-Host "No source files under $appDir." -ForegroundColor Red
    exit 1
}
# Snack's entry-point rule (website/src/client/utils/fileUtilities.tsx: /^App\.(js|tsx?)$/).
$entryPoints = @($snackFiles.Keys | Where-Object { $_ -cmatch '^App\.(js|tsx?)$' })
if ($entryPoints.Count -eq 0) {
    Write-Host 'Warning: app/ has no App.tsx yet; Snack refuses a project without an entry point.' -ForegroundColor Yellow
}

$snack = [ordered]@{
    name               = 'SplitSnap'
    description        = "Splitwise-style bill splitting with bill scanning (OCR.space) and item-by-item splits. React Native + Expo SDK $($SdkVersion.Split('.')[0])."
    platform           = 'web'
    sdkVersion         = $SdkVersion
    supportedPlatforms = 'ios,android,web,mydevice'
    dependencies       = $dependencies
    files              = $snackFiles
}
$meta = [ordered]@{
    generated  = (Get-Date).ToString('yyyy-MM-dd HH:mm')
    fileCount  = $snackFiles.Count
    totalBytes = $totalBytes
    listing    = $listing
    skipped    = $skipped
}

$snackJson = ConvertTo-AsciiJson $snack
$metaJson = ConvertTo-AsciiJson $meta

$template = @'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SplitSnap in Expo Snack</title>
<style>
  :root {
    --primary: #1CC29F; --primary-dark: #0E8C71; --primary-soft: #E3F8F2; --on-primary: #FFFFFF; --button: #0F9A7C;
    --text: #1F2A2E; --muted: #5F6F74; --border: #E3E8EA; --bg: #F4F6F7; --card: #FFFFFF;
    --warn-bg: #FFF6E5; --warn-text: #8A5A00; --error-text: #A12A2A; --code-bg: #EEF2F3;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --primary: #1CC29F; --primary-dark: #5BE0C2; --primary-soft: #133A33; --on-primary: #06231C; --button: #1CC29F;
      --text: #E6EDEF; --muted: #9AABB0; --border: #2A3539; --bg: #111719; --card: #182124;
      --warn-bg: #3A2E14; --warn-text: #F5C76B; --error-text: #F4A3A3; --code-bg: #222D31;
    }
  }
  :root[data-theme="dark"] {
    --primary: #1CC29F; --primary-dark: #5BE0C2; --primary-soft: #133A33; --on-primary: #06231C; --button: #1CC29F;
    --text: #E6EDEF; --muted: #9AABB0; --border: #2A3539; --bg: #111719; --card: #182124;
    --warn-bg: #3A2E14; --warn-text: #F5C76B; --error-text: #F4A3A3; --code-bg: #222D31;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 16px 56px; }
  main > * + * { margin-top: 16px; }
  a { color: var(--primary-dark); text-underline-offset: 2px; overflow-wrap: anywhere; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
  .hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px 28px; align-items: center; }
  .hero-foot { grid-column: 1 / -1; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .logo { flex: none; width: 48px; height: 48px; border-radius: 14px; background: var(--primary); color: var(--on-primary);
          display: grid; place-items: center; font-weight: 700; font-size: 24px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 0; }
  h2 { font-size: 17px; margin: 0 0 8px; }
  .sub { color: var(--muted); margin: 2px 0 0; }
  p { margin: 8px 0; }
  button { font: inherit; }
  .run { border: 0; border-radius: 12px; padding: 16px 26px; cursor: pointer; white-space: nowrap;
         background: var(--button); color: var(--on-primary); font-size: 17px; font-weight: 600; }
  .run:hover { filter: brightness(0.95); }
  .run:focus-visible, .link:focus-visible { outline: 3px solid var(--primary-dark); outline-offset: 3px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .chips li { background: var(--primary-soft); color: var(--primary-dark); border-radius: 999px; padding: 3px 12px; font-size: 13px; }
  .snack { padding: 0; overflow: hidden; }
  .snack-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 14px 20px; border-bottom: 1px solid var(--border); }
  .status { flex: 1 1 260px; font-weight: 600; }
  .status::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 9px;
                    background: var(--muted); vertical-align: 1px; }
  .status[data-state="ok"]::before { background: var(--primary); }
  .status[data-state="error"] { color: var(--error-text); }
  .status[data-state="error"]::before { background: var(--error-text); }
  .link { border: 0; background: none; padding: 0; color: var(--primary-dark); cursor: pointer; text-decoration: underline;
          text-underline-offset: 2px; }
  .tip { margin: 0; padding: 12px 20px; background: var(--primary-soft); font-size: 14px; }
  .arrow { display: inline-block; min-width: 22px; padding: 0 5px; border: 1px solid var(--border); border-radius: 6px;
           background: var(--card); text-align: center; font-weight: 700; }
  iframe { display: block; width: 100%; height: min(78vh, 760px); min-height: 520px; border: 0; background: var(--card); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
  .tag { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
         color: var(--primary-dark); margin-bottom: 6px; }
  ol { padding-left: 20px; margin: 8px 0 0; }
  li { margin: 5px 0; }
  .warn { background: var(--warn-bg); color: var(--warn-text); border-radius: 10px; padding: 10px 12px; font-size: 14px; margin-top: 10px; }
  .note { color: var(--muted); font-size: 13px; }
  .nojs { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: rgba(245, 165, 36, 0.12); color: inherit; }
  summary { cursor: pointer; color: var(--muted); font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  td { padding: 3px 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  td.size { text-align: right; color: var(--muted); white-space: nowrap; padding-left: 12px; }
  code { font-family: Consolas, "SF Mono", monospace; font-size: 13px; background: var(--code-bg); padding: 1px 5px; border-radius: 5px; }
  .deps { overflow-wrap: anywhere; color: var(--muted); font-size: 13px; }
  @media (max-width: 640px) {
    .hero { grid-template-columns: 1fr; }
    .run { width: 100%; }
    .card { padding: 18px; }
    .snack { padding: 0; }
    iframe { height: 82vh; min-height: 480px; }
  }
</style>
</head>
<body>
<main>
  <section class="card hero">
    <div class="brand">
      <div class="logo" aria-hidden="true">S</div>
      <div>
        <h1>SplitSnap</h1>
        <p class="sub">Split bills with friends, scan receipts and split them item by item.</p>
      </div>
    </div>
    <button class="run" id="run" type="button">Run SplitSnap in Expo Snack</button>
    <p class="note nojs" id="nojs"><strong>Button does nothing?</strong> This page was opened somewhere that blocks
      scripts (an app's file preview, a mail or chat preview). Open the file in Microsoft Edge or Chrome instead: in File
      Explorer, right-click <code>open-in-snack.html</code> &rarr; <em>Open with</em> &rarr; <em>Microsoft Edge</em>.</p>
    <div class="hero-foot">
      <ul class="chips" id="meta"></ul>
      <p class="note">Nothing leaves this PC until you click. The button loads Expo Snack (snack.expo.dev, Expo's free online
        editor) on this page and hands it the files under <code>app/</code>. Nothing is saved to an Expo account unless you
        save it there yourself. After changing the app, rebuild this page with <code>tools\build-snack-launcher.ps1</code>.</p>
    </div>
  </section>

  <section class="card snack" id="snack-panel" hidden>
    <div class="snack-bar">
      <span class="status" id="snack-status" role="status" aria-live="polite">Loading Expo Snack&hellip;</span>
      <button class="link" id="retry" type="button" hidden>Try again</button>
    </div>
    <p class="tip" id="snack-tip" hidden>For the <strong>My Device</strong> QR code and the iOS / Android previews, open the
      full editor: click the <span class="arrow">&#8599;</span> icon next to &ldquo;SplitSnap&rdquo; at the top left of the
      Snack. It opens in a new tab with every file.</p>
    <iframe id="snack-frame" title="SplitSnap in Expo Snack" allow="clipboard-read; clipboard-write"></iframe>
  </section>

  <div class="grid">
    <section class="card">
      <span class="tag">Android phone</span>
      <h2>Run it in Expo Go</h2>
      <ol>
        <li>Install <strong>Expo Go for SDK __SDK_MAJOR__</strong>. If the Play Store version is for a newer SDK, get the
            SDK __SDK_MAJOR__ build free from <a href="https://expo.dev/go" target="_blank" rel="noopener">https://expo.dev/go</a>.</li>
        <li>Click <strong>Run SplitSnap in Expo Snack</strong>, then the <span class="arrow">&#8599;</span> icon at the top of the
            Snack to open the full editor.</li>
        <li>Open the <strong>My Device</strong> tab beside the preview and scan its QR code with Expo Go.</li>
      </ol>
    </section>
    <section class="card">
      <span class="tag">iPhone</span>
      <h2>Run it in Expo Go</h2>
      <ol>
        <li>Install <strong>Expo Go</strong> from the App Store (it runs SDK 54 projects).</li>
        <li>Expo Go on an iPhone asks you to sign in: create a <strong>free Expo account</strong> at
            <a href="https://expo.dev/signup" target="_blank" rel="noopener">expo.dev/signup</a> (no payment) and sign in
            to it in Expo Go and in Snack (<strong>Log in</strong> at the top left of the full editor).</li>
        <li>Run the Snack, open the full editor (<span class="arrow">&#8599;</span>), then <strong>My Device</strong>: scan
            the QR code with the Camera app, or open the project from Expo Go's home screen.</li>
      </ol>
    </section>
    <section class="card">
      <span class="tag">No phone</span>
      <h2>Preview in the browser</h2>
      <p>The Snack on this page starts with the <strong>Web</strong> preview beside the code. For a simulated phone, open the
        full editor and pick <strong>iOS</strong> or <strong>Android</strong> above the preview.</p>
      <p class="note">The iOS and Android previews stream a shared online device, so they can take a minute to start.</p>
    </section>
  </div>

  <section class="card">
    <span class="tag">Bill scanning</span>
    <h2>Works out of the box, for free</h2>
    <p>Scanning uses OCR.space. With no setup the app uses the shared <strong>demo key</strong>: it is free but shared by
      everyone, so scans can be slow or hit its rate limit. <strong>Try a sample bill</strong> on the scan screen works offline.</p>
    <p>For reliable scans, get your own free key at
      <a href="https://ocr.space/ocrapi/freekey" target="_blank" rel="noopener">https://ocr.space/ocrapi/freekey</a>
      (just an email address; no payment or card) and paste it in <strong>Account &rarr; Settings &rarr; Bill scanning</strong>.</p>
    <p class="note">Free-key limits: about 25,000 scans a month and images up to 1 MB. The app shrinks photos before sending them.</p>
  </section>

  <section class="card">
    <details>
      <summary id="files-summary">Files included</summary>
      <table id="files"></table>
      <p class="deps" id="deps"></p>
    </details>
  </section>
</main>
__SCRIPT__
</body>
</html>
'@

$pageScript = @'
<script>
  var SNACK = __SNACK_JSON__;
  var META = __META_JSON__;
  (function () {
    'use strict';
    var SNACK_ORIGIN = 'https://snack.expo.dev';
    var IFRAME_ID = 'splitsnap-launcher';
    var TIMEOUT_MS = 60000;
    var mode = location.hash.slice(1);   // '' normally; 'verify' or 'live' for the self-test

    function $(id) { return document.getElementById(id); }
    var run = $('run'), panel = $('snack-panel'), frame = $('snack-frame'), status = $('snack-status'), retry = $('retry'), tip = $('snack-tip');
    $('nojs').hidden = true;   // scripts run here, so the 'button does nothing' hint is not needed
    var timer = null;
    var startedAt = 0;

    function query(params) {
      return Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    }

    function prefersDark() {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    // Only small values go in the URL; the files follow in the data message.
    function embedUrl() {
      return SNACK_ORIGIN + '/embedded?' + query({
        iframeId: IFRAME_ID, waitForData: 'true', name: SNACK.name, sdkVersion: SNACK.sdkVersion,
        platform: SNACK.platform, supportedPlatforms: SNACK.supportedPlatforms, preview: 'true',
        theme: prefersDark() ? 'dark' : 'light'
      });
    }

    // Snack merges these fields into its query parameters (website/src/client/components/EmbeddedApp.tsx).
    function dataMessage() {
      return ['expoDataEvent', {
        iframeId: IFRAME_ID, name: SNACK.name, description: SNACK.description, platform: SNACK.platform,
        sdkVersion: SNACK.sdkVersion, supportedPlatforms: SNACK.supportedPlatforms, dependencies: SNACK.dependencies,
        preview: 'true', files: JSON.stringify(SNACK.files)
      }];
    }

    // The checks Snack applies before it accepts the files (website/src/client/utils/getFilesFromQuery.tsx).
    function problems() {
      var names = Object.keys(SNACK.files);
      var out = names.some(function (n) { return /^App\.(js|tsx?)$/.test(n); }) ? [] : ['there is no App.tsx entry point'];
      names.forEach(function (n) {
        var f = SNACK.files[n];
        if (!f || f.type !== 'CODE' || !f.contents) out.push(n + ' has no contents');
      });
      return out;
    }

    function dump(id, value) {
      var pre = document.createElement('pre');
      pre.id = id;
      pre.hidden = true;
      pre.textContent = JSON.stringify(value).replace(/[^ -~]|[<>&]/g, function (c) {
        return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
      });
      document.body.appendChild(pre);
    }

    function setStatus(state, text) {
      status.setAttribute('data-state', state);
      status.textContent = text;
    }

    function start() {
      panel.hidden = false;
      retry.hidden = true;
      tip.hidden = true;
      clearTimeout(timer);
      var issues = problems();
      if (issues.length) {
        setStatus('error', 'Snack would reject this project: ' + issues.join('; ') + '. Fix app/ and rebuild this page.');
        return;
      }
      setStatus('loading', 'Loading Expo Snack...');
      startedAt = Date.now();
      frame.src = embedUrl();
      timer = setTimeout(function () {
        setStatus('error', 'Expo Snack did not answer. Check the internet connection, then try again.');
        retry.hidden = false;
        if (mode === 'live') dump('snack-live', { handshake: false });
      }, TIMEOUT_MS);
      run.textContent = 'Reload in Expo Snack';
      if (mode !== 'live' && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    window.addEventListener('message', function (event) {
      var d = event.data;
      if (event.origin !== SNACK_ORIGIN || !Array.isArray(d) || d[0] !== 'expoFrameLoaded' || !d[1] || d[1].iframeId !== IFRAME_ID) return;
      event.source.postMessage(dataMessage(), SNACK_ORIGIN);
      clearTimeout(timer);
      setStatus('ok', 'Snack has all ' + META.fileCount + ' files. The web preview starts once Snack has installed the libraries.');
      tip.hidden = false;
      if (mode === 'live') dump('snack-live', { handshake: true, ms: Date.now() - startedAt });
    });
    run.addEventListener('click', start);
    retry.addEventListener('click', start);

    function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }
    function chip(text) {
      var li = document.createElement('li');
      li.textContent = text;
      $('meta').appendChild(li);
    }
    chip(META.fileCount + ' files');
    chip(kb(META.totalBytes));
    chip('Expo SDK ' + SNACK.sdkVersion.split('.')[0]);
    chip('Built ' + META.generated);

    $('files-summary').textContent = 'Files included (' + META.fileCount + ')' +
      (META.skipped.length ? ' - skipped binaries: ' + META.skipped.join(', ') : '');
    var table = $('files');
    META.listing.forEach(function (f) {
      var tr = table.insertRow();
      tr.insertCell().textContent = f.path;
      var size = tr.insertCell();
      size.className = 'size';
      size.textContent = kb(f.bytes);
    });
    $('deps').textContent = 'Dependencies: ' + SNACK.dependencies.split(',').join(', ');

    if (mode === 'verify') dump('snack-verify', { embedUrl: embedUrl(), message: dataMessage(), problems: problems() });
    if (mode === 'live') start();
  })();
</script>
'@

# One pass, so text inserted for one placeholder is never scanned for another.
$values = @{ '__SNACK_JSON__' = $snackJson; '__META_JSON__' = $metaJson }
$evaluator = [Text.RegularExpressions.MatchEvaluator] { param($m) $values[$m.Value] }
$template = $template.Replace('__SDK_MAJOR__', $SdkVersion.Split('.')[0])
$html = [regex]::Replace($template.Replace('__SCRIPT__', $pageScript), '__(SNACK|META)_JSON__', $evaluator)
Write-Utf8File $OutFile $html

# Named after the page, so a self-test build never overwrites the real one.
$filesJson = ConvertTo-AsciiJson $snackFiles
$filesJsonPath = Join-Path (Initialize-OutDir) ([IO.Path]::GetFileNameWithoutExtension($OutFile) + '.files.json')
Write-Utf8File $filesJsonPath $filesJson

Write-Host ("Wrote {0}" -f $OutFile) -ForegroundColor Green
Write-Host ("  {0} file(s), {1:N1} KB of source ({2:N1} KB handed to Snack when the button is clicked)" -f $snackFiles.Count, ($totalBytes / 1KB), ($filesJson.Length / 1KB))
Write-Host ("  Also wrote {0}" -f $filesJsonPath) -ForegroundColor DarkGray
foreach ($s in $skipped) { Write-Host ("  Skipped binary file (upload it to Snack as an asset if needed): {0}" -f $s) -ForegroundColor Yellow }
foreach ($e in $emptied) { Write-Host ("  Empty file sent as a single newline (Snack rejects empty files): {0}" -f $e) -ForegroundColor Yellow }
exit 0
