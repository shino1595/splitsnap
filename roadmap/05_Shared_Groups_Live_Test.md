# Plan: shared groups for a live test with friends (Option A), and how Option B builds on it

Status: **Option A approved** (2026-10-28). **A0 in progress:** setup script `supabase/setup.sql`
(start-over script `supabase/teardown.sql`) and the fixed app link are ready; waiting for your
Supabase project (checklist below). A1–A3 not started.

## Goal

You and a group of friends each run SplitSnap on your own phones (Expo Go, SDK 58). When someone
creates a shared group, adds an expense, records a payment or comments, everyone in that group
sees it within a second or two, with "Aarav added *Dinner* · ₹1,460" in Activity.

## Today's limits

- **Data stays on each phone.** Every phone keeps its own copy (AsyncStorage). There's no server and
  no notion of "the same group on two phones".
- **Delivery already works.** Your published app opens on any phone with Expo Go (App Store or
  Play Store, SDK 58).

Both points shape the plan: the app needs a shared database, and a way to reach friends' phones
that doesn't mean re-sending QR codes.

## Option A: what we'd build

| Part | How |
|---|---|
| **Shared database** | A free **Supabase** project (Postgres + live updates). You create it. Pick the **Mumbai** region for speed. |
| **Who is who** | **Anonymous sign-in**: on first use each phone gets an anonymous account and you type a display name. No email or password. |
| **Sharing a group** | Group screen → **Share group**: uploads the group, its members (as placeholders), expenses and payments, then shows an **8-character join code** and a ready-made WhatsApp message. |
| **Joining** | Friends tap **Join a group** and enter the code. If the group already has them as a placeholder ("Bhavna"), they tap **"That's me"** and inherit Bhavna's history and balances. Otherwise they join as a new member. |
| **Live updates** | Supabase **Realtime**: each phone listens for changes to the groups it belongs to. New and changed rows merge into the local copy, so the app works as today, just fed from the server too. |
| **Offline** | Changes save locally first and wait in a send queue; it flushes when the phone is online. |
| **Conflicts** | Rare for a group of friends. If two people edit the *same* expense at once, the later save wins, and Activity shows who edited it. |
| **What stays local** | Your non-shared groups and non-group expenses. Nothing is uploaded until you tap **Share group**. |

### Data model (Supabase tables)

- **`profiles`**: your anonymous user id and display name.
- **`groups`**: name, type, emoji, currency, simplify-debts, join code, archived.
- **`group_members`**: one row per person in a group. Linked to a profile once a real user joins or
  claims the row; a placeholder until then.
- **`expenses`, `payments`**: the expense or payment as stored by the app today (JSON, including the
  itemised bill), plus `group_id`, `updated_at`, `updated_by` and a soft-delete `deleted_at`.
  Keeping the app's own format means the split and balance engine (627 tests) stays unchanged.
- **`comments`, `activity`**: one row each, so simultaneous comments never overwrite each other.

**Identity mapping:** person ids inside expenses are member ids. On each phone the member that is
*you* is shown as "You", so every existing screen works without changes.

### Security (Supabase's recommended setup)

- **Row Level Security on every table:** you can only read and write rows of groups you're a
  member of. Membership checks run in a helper function kept in a private schema, as Supabase
  recommends against policy loops.
- **Join by code:** a single server function. It only adds *you*, only with a valid code, and
  codes can be regenerated or switched off per group. It has to be callable from the app, so it
  gets extra care.
- **The publishable key in the app** is designed to be public ("Safe to expose … mobile app") as
  long as Row Level Security is on. The secret key never leaves the Supabase dashboard.
- **Deletes are soft** (marked, not removed). Live updates for deleted rows bypass the security
  rules, and soft deletes avoid that.

### A0 checklist (about 10 minutes)

1. Sign up at **supabase.com** (a personal email or GitHub; not the work email) and create a
   project: any name (e.g. `splitsnap`), region **Mumbai (ap-south-1)**, free plan. Supabase
   asks for a database password: let it generate one and keep it yourself (password manager).
   - **If it asks for a card or shows a price, stop and tell me.**
2. **Authentication → Sign In / Providers:** switch on **Allow anonymous sign-ins** and save.
3. **SQL Editor → New query:** paste all of `supabase/setup.sql`, click **Run**. It should say
   "Success. No rows returned". If it shows an error, send me a screenshot; nothing is half-made,
   because the script is all-or-nothing.
4. **Project Settings → API Keys** (and **Data API** for the URL): send me the **Project URL**
   (`https://<id>.supabase.co`) and the **publishable key** (`sb_publishable_…`). Both are meant
   to be inside the app. **Never send the secret key (`sb_secret_…`) or the database password.**
5. Push to GitHub when I've committed (one command, as before).

### The fixed app link (part of A0)

After the next publish, this one link always opens the **newest** version in Expo Go, so
friends never need a new QR code:

- QR code to scan with the iPhone camera (open on a computer):
  `https://qr.expo.dev/eas-update?projectId=e2a3167d-0539-40eb-8acf-3593c97841b5&runtimeVersion=exposdk:58.0.0&channel=main`
- The link inside it: `exp://u.expo.dev/e2a3167d-0539-40eb-8acf-3593c97841b5?runtime-version=exposdk%3A58.0.0&channel-name=main`

It uses the EAS channel `main`, which the publish workflow now creates and points at branch
`main` (format from Expo's QR-code docs, `slug=exp` = Expo Go).

### Steps and effort

| Step | What | Effort (weekly limit) |
|---|---|---|
| A0 | Your Supabase setup + my SQL script. **A fixed "always latest" app link**, so friends get one link and all updates automatically. | ~1–2% |
| A1 | **Quick proof**, like the counter test: in a hidden test screen, an anonymous sign-in plus a live update round-trip, on your iPhone (Expo Go) **and** in the browser. Supabase's docs don't confirm Expo Go, so we stop here if it fails. | ~2–3% |
| A2 | **The build:** sync engine (pull, live updates, send queue), Share / Join / "That's me", member badges ("on SplitSnap" vs placeholder), shared Activity, display name and **Leave group** in Settings, plus unit tests for the merge logic. | ~10–15% |
| A3 | **Testing:** an automated **two-person test** on this PC (two hidden browsers as two users: one shares, the other joins, both add expenses, both see each other's changes live). Then you + one friend on phones, then the whole group. | ~3–5% |
| | **Total** | **~16–25%** |

## Costs and limits (Supabase free plan, from supabase.com)

| Item | Free plan |
|---|---|
| Price | $0/month |
| Projects | 2 active |
| Database | 500 MB (thousands of times more than a friends' test needs) |
| Users | 50,000 monthly active |
| Live updates | 200 connections at once, 2 million messages/month |
| Data transfer | 5 GB/month |
| **Pausing** | Paused after **1 week without activity**. You restore it from the dashboard. |
| **Backups** | Not downloadable on the free plan. Every phone still keeps its own local copy. |

## Known limits of Option A (deliberate, for a test)

- **The anonymous account is per phone.** If someone deletes Expo Go or its data, they can't sign
  back in. To reclaim their member row, you (the project owner) delete their old user under
  Authentication → Users; they then rejoin with the code and tap "That's me". Option B fixes
  this with email.
- **No push notifications** (Expo Go has none from SDK 53). Changes appear live while the app is
  open, and on next open otherwise.
- **You own the project:** as its owner you can see all shared data in the Supabase dashboard.
  Tell friends this, and delete the project after the test if you like.
- **Basic abuse protection only:** no CAPTCHA (Supabase recommends one for public apps). Fine for
  a private test with a known group; needed before any public launch.

## Building Option B on top later (nothing from A is thrown away)

| Option B feature | How it extends A |
|---|---|
| **Permanent accounts (email)** | Link an email to the existing anonymous account (`updateUser` + 6-digit code). **Same user id**, so no data moves. Sign in with the email code on a new phone. Supabase's built-in email sends only ~2 per hour, so a free email service (custom SMTP) would be set up. |
| **Invite links & QR codes** | The join code inside a link and a QR shown in the app (a QR library on top of `react-native-svg`, which Expo Go includes). |
| **Invite-only privacy** ("Who can add me": Anyone / Friends / Invite only) | A privacy setting on `profiles`, plus a new **`invitations`** table. Adding someone who is invite-only creates a pending invite in their **Inbox** (Join / Decline). Enforced by the server's security rules, so it can't be bypassed. |
| **Add from phone contacts** | `expo-contacts`: match contacts to existing accounts by email/phone, otherwise invite them. |
| **Block / report** | A `blocks` table: blocked people can't invite you, and their activity is hidden. |
| **Group roles (optional)** | Owner/admin can remove members, reset the code or delete the group. |
| **Notifications** | Still no push in Expo Go. Option B adds an in-app **Inbox** and optional email digests. Real push needs a development build, and on iPhone a paid Apple membership, so it's excluded. |

**Option B effort: about +15–20% of a weekly limit.** It adds tables (`invitations`, `blocks`,
privacy columns) and screens. Option A's tables, sync engine and data carry over unchanged.

## Decision needed

Approve **Option A** (A0 → A3). We'd stop after **A1** if the proof fails on your iPhone, so at most
about 3–5% would be spent. Option B stays in this plan for later.
