# Plan: run SplitSnap on an iPhone 15 Pro, with saved data, without Snack

Status: **plan, waiting for approval** (2026-10-27).

## Problem

- The iPhone's Expo Go (App Store) now runs **SDK 58** only. Each Expo Go build supports exactly
  one SDK.
- Expo Snack only builds up to **SDK 56**: 55 is its newest selectable SDK, and 56 is hidden and
  unfinished. Its last change (22 Oct) added nothing newer.
- An iPhone can't install an older Expo Go. Expo's workaround (`eas go` + TestFlight) needs a
  **💰 Apple Developer membership ($99/year)**, which the no-cost rule rules out.

So **no Snack version can open on this iPhone**, and the saved Snack can't be opened there.

## Proposed route: publish with EAS Update (free) from GitHub Actions (free)

Expo's free **EAS Update** service hosts the app's code at a fixed address under your Expo
account. Expo's docs say: "To test the content of an update in Expo Go, run `eas update` and then
browse to the update in Expo Go."

The publishing runs on **GitHub's servers** (a GitHub Actions run), so nothing is installed on
this PC. Because the app always comes from the same Expo project, its saved data should persist
between launches **and across app updates**. That's better than the saved Snack, where every code
update meant a new Snack and empty data.

### Phase 0: prove it works first (small, about 2–4% of a weekly limit)

1. A tiny SDK 58 test app: a counter saved on the phone, plus "last opened at".
2. Publish it with a GitHub Actions run that calls `eas update`.
3. You open it in Expo Go on the iPhone. We check that it loads, then close Expo Go fully,
   reopen, and check the counter kept its value.

If this fails, we stop there. Very little is spent, and the main app is untouched.

### Phase 1: move SplitSnap to SDK 58 (about 8–12%)

- Add a real Expo project setup around today's code (`package.json` with SDK 58 versions,
  `app.json` with name, icon, Expo project ID and update settings, entry file). The app code
  itself barely changes.
- Type-check against SDK 58's libraries (`tools\typecheck.ps1 -Sdk 58`, a new option) and keep
  all unit tests passing.
- Keep the SDK 54 Snack launcher working for quick tests in the browser, as long as the code still
  runs on both.
- **Risk:** no tool can *run* SDK 58 code on this PC or in Snack, so the first real run is on your
  phone. Phase 0 and type checking cut the risk, but expect one fix-up round.

### Phase 2: one-tap publishing

- A GitHub Actions workflow publishes a new version on every push.
- Your iPhone gets the latest version the next time you open the app in Expo Go. Your data
  stays.

## What you'd do yourself (accounts and secrets; I won't handle passwords or tokens)

1. **GitHub:** a free account and a new **private** repository (e.g. `splitsnap`).
2. **Expo:**
   - On expo.dev, create a project called **SplitSnap** and tell me its *project ID*. That's not
     a secret; it goes into `app.json`.
   - Create an **access token** at expo.dev/settings/access-tokens and paste it into the GitHub
     repo as the secret `EXPO_TOKEN` (Settings → Secrets and variables → Actions).
3. **First push:** I prepare the files and the git commands. Pushing opens a GitHub sign-in in your
   browser, so you approve it. This is also when you decide whether a personal project may be
   pushed from this work PC.
4. **iPhone:** Expo Go, signed in, → your project → open the update.

## Costs and limits (all free)

- **GitHub:** private repos and Actions are free (2,000 Actions minutes a month on the free plan;
  one publish takes a few minutes).
- **EAS Update, free plan:** "1,000 MAUs", 100 GiB bandwidth, 20 GiB storage, "no update overage
  pricing". A personal app uses 1–5 "monthly active users".
- **Expo account:** free.
- **Not needed:** Apple Developer, TestFlight, App Store.

## Options if you'd rather not

- **Wait for Snack to support SDK 58.** No date is known.
- **Test only in Snack's web preview or iPhone simulator.** Neither keeps data between sessions.
- **💰 Apple Developer ($99/year)** for an SDK 54 Expo Go through TestFlight. Ruled out by the cost
  rule unless you decide otherwise.
