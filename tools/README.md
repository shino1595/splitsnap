# SplitSnap tools (no installs)

Everything runs in headless Microsoft Edge from Windows PowerShell 5.1: no Node.js, npm or
Python. TypeScript 5.9.3 and package typings come from jsDelivr (free, no account) and are
cached, so only the first run needs the network. Run from the project root:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools\<script>.ps1 [options]
```

## run-tests.ps1 - unit tests

Transpiles `app/src/**/*.ts` (not `.tsx`) and `tests/**/*.ts` and runs every `*.test.ts` with a
Jest-like API (`describe`/`it`/`expect`, `jest.fn`, async tests). Output is one line per test
file, then every failing test in full (diff, expected/received, source location, console
output). Exit code 1 on any failure.

- `-Filter money` only runs test files whose path contains the text.
- `-Full` lists every test; `-Verbose` also prints console output and timings.
- About 3-5 s for the whole suite.

## typecheck.ps1 - TypeScript strict check of app/

Compiles all of `app/` in strict mode against the real typings of the Expo SDK 54 libraries
(react-native 0.81, @types/react 19.1, expo-image-picker 17, expo-image-manipulator 14; `-Sdk 55`
checks against SDK 55 instead), React Navigation 7, AsyncStorage 2.2 and @expo/vector-icons. Prints
`file(line,col): error TSxxxx: message`; exit code 1 on errors. Extra checks:

- `SPLITSNAP1`: an import that docs/ARCHITECTURE.md does not allow, or an `@/` alias.
- `SPLITSNAP2`: an icon name that is not an Ionicons glyph, even when it reaches the icon
  through a string-typed prop such as `<EmptyState icon="...">`, `{ icon: '...' }` or a
  `TAB_ICONS` table. (`<Ionicons name="...">` itself is checked by the compiler, TS2322.)

Options: `-ShimAll` treats every package except React as `any` (no downloads, but no
react-native or icon checks), `-Refresh` downloads all typings again, `-Verbose` lists
packages and versions, `-Diagnostics` logs every request with timings. Typings are cached in
`tools\.cache\typecheck-cache.js`: a warm run takes 3-8 s, a cold one (fresh Edge profile,
empty cache) about 20 s.

## build-snack-launcher.ps1 - open the app in Expo Snack

Writes `open-in-snack.html` in the project root. Its button loads Snack's embedded editor
(snack.expo.dev/embedded) on the page and hands it every text file under `app/` with name,
description, platform=web, SDK 54.0.0 (`-SdkVersion 55.0.0` for another SDK), supportedPlatforms and the dependencies from
ARCHITECTURE.md section 9, through Snack's embed data message (`waitForData`). The arrow icon
next to the title in the Snack opens the full editor in a new tab with the same files (My
Device QR code, iOS/Android previews); nothing is saved to Expo. A plain form POST is not
used because snack.expo.dev caps form bodies at 56 KB and the app is far larger. The page also
explains Android (Expo Go for SDK 54 from https://expo.dev/go, "My Device" QR code), iPhone
(App Store Expo Go signed in to a free Expo account, "My Device"), the in-browser previews and bill scanning (shared demo key, or a free key from
https://ocr.space/ocrapi/freekey). Nothing is uploaded until someone clicks the button. Re-run
it after every app change.

## Self-test and housekeeping

- `selftest\run-selftest.ps1` proves the three tools still work on the fixtures in `selftest\`
  (deliberate failures must be reported, clean code must pass), checks the Edge lock and
  profile recovery, and embeds the real Snack with the fixture app to check its handshake.
  `-SkipTypecheck`, `-SkipEdgeRecovery` and `-SkipOnline` make it shorter. About 2 minutes.
- Only one headless Edge runs at a time. The scripts share a named lock (`Enter-EdgeLock` in
  `common.ps1`), so a second run waits and prints that it is waiting; runs hold it for a few
  seconds. Once the lock is taken, any leftover headless Edge still using `tools\.edge-profile`
  (from a killed run) is stopped. If Edge then prints nothing, the profile is renamed to
  `.edge-profile-broken-<time>` and the run is retried once. If the profile is locked, a
  temporary `.edge-profile-tmp-<pid>` is used instead. Those folders and `tools\.out` can be
  deleted at any time.
- `$env:SPLITSNAP_EDGE_PROFILE` points a run at another Edge profile folder (e.g. to time a
  cold start).
- `ocr-live\` holds a separate live OCR.space check with its own Edge profile. These scripts do
  not use it.
