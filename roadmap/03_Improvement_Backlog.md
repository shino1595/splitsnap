# Task 4: improvement backlog

Status: **backlog for the near future, nothing started** (2026-10-20).

This is a look at the app as it stands: features, UX, scanning, payments, privacy, engineering.
Items that close Splitwise gaps are in `02_Splitwise_Gap_Analysis.md` (G-numbers), and the members
and invites plan is in `01_Adding_Members_And_Invites.md`. They're only cross-referenced here.

**Size:** S = a few hours of agent work (about 1–3% of a weekly limit), M = one build round
(about 3–8%), L = several rounds (10%+).
**Needs:** *local* = works in today's app; *backend* = needs accounts and sync (roadmap 01 Phase
B); *dev build* = needs to move off Expo Go (see T1).
Everything is free unless marked 💰.

## 1. Functional features

| # | Item | What and why | Size | Needs |
|---|---|---|---|---|
| F1 | **Backup & restore** | Export all data to a file (share to Drive/email) and import it back. Today one lost phone loses everything. | S | local |
| F2 | **Trip mode** | Start and end dates, spend per day and per person, "end trip" summary with a settle-up plan. | M | local |
| F3 | **Budgets** | Monthly budget per group or category, with a progress bar and an over-budget banner. | M | local |
| F4 | **Personal spending view** | "My share" across all groups by month and category. Answers "what did I actually spend?", not just "who owes whom". | M | local |
| F5 | **Expense templates and quick add** | One-tap repeats of frequent items (milk, Uber, chai) with the people and split filled in. | S | local |
| F6 | **Split shortcuts** | "Everyone except me", "only me and X", saved percentage presets. | S | local |
| F7 | **Several attachments per expense** | Multiple bill photos, warranty card, PDF invoice. | M | local |
| F8 | **Tags and filters** | Filter a group's timeline by person, category, date range or tag (e.g. "#dinner"). | S–M | local |
| F9 | **Settlement summary to share** | One image or text: "Goa Trip: Aarav → you ₹3,355, Bhavna → you ₹7,306…", sent to the group chat. | S | local |
| F10 | **Bill splitting without saving** | "Quick split" calculator for a one-off bill that isn't kept in balances. | S | local |
| F11 | **Recurring list and reminders** | All repeating expenses in one place: pause, skip one, end (see G12). | S | local |

## 2. Quality of life / UX

| # | Item | What and why | Size | Needs |
|---|---|---|---|---|
| Q1 | **Stray space while scrolling** (reported, deferred) | Reproduce on a phone/simulator; likely the keyboard spacing on forms measured mid-animation. | S | local |
| Q2 | **Undo instead of "Are you sure?"** | Delete straight away with a 5-second "Undo" bar. Faster and less nagging. | S | local |
| Q3 | **Smart defaults** | Remember the last payer, split and currency per group (G8). Suggest description and category from history. | S | local |
| Q4 | **Calculator in the amount box** | Type "120+80+45" and get 245. | S | local |
| Q5 | **Swipe actions** | Swipe a row to delete, settle or remind. | M | local (gesture handler is in Expo Go) |
| Q6 | **Haptics** | Light taps on toggles, save and errors. | S | local (`expo-haptics` added to the allowed list) |
| Q7 | **First-run tour** | Three short cards plus "Try the sample bill" for new users. Today it opens straight into demo data. | S | local |
| Q8 | **Pinned and sorted groups** | Pin favourites; sort by recent activity or by what you're owed. "Hide settled" toggle. | S | local |
| Q9 | **Search everywhere** | One search across people, groups, expenses and bill items, with filters. | S–M | local |
| Q10 | **Tablet / landscape layout** | Cap the width so cards don't stretch on tablets or web. | S | local |
| Q11 | **Better pickers** | Recent and favourite currencies at the top; search inside every list picker. | S | local |
| Q12 | **Consistent pressed states and animations** | Small motion on add/remove and screen changes for polish. | S | local |

## 3. Bill scanning and itemization

| # | Item | What and why | Size | Needs |
|---|---|---|---|---|
| S1 | **Long bills in several photos** | Scan a long receipt in 2–3 shots and merge the items. | M | local |
| S2 | **Photo guidance** | Live tips: too dark, too far, tilted. Crop before upload. | M | local (`expo-image-manipulator` crop) |
| S3 | **Learn from corrections** | Remember how you fixed names and charges per restaurant, and apply that next time. | M | local |
| S4 | **Faster assigning** | "Pick a person, then tap their items" mode; quick groups such as "all drinks → A & B". | M | local |
| S5 | **Smarter charges** | Detect per-item GST rates, service charge %, tips; check GST maths and flag mismatches. | M | local |
| S6 | **Item history** | "Who had the Paneer Tikka?" search across past bills. Restaurant favourites. | S | local |
| S7 | **Privacy before upload** | Optional blur of phone numbers or card digits on the photo; a clear "what we send" note. | S | local |
| S8 | **On-device scanning** | ML Kit text recognition: offline, private, no rate limits. | L | dev build |

## 4. Payments and settling (India first)

| # | Item | What and why | Size | Needs |
|---|---|---|---|---|
| P1 | **"Pay me" UPI QR** | Show your UPI QR on your profile; scan a friend's UPI QR to save their UPI ID (`expo-camera` barcode scanning works in Expo Go). | M | local |
| P2 | **Payment confirmation** | After paying through a UPI app, capture the UPI reference (UTR) and amount on the payment record. | S | local |
| P3 | **Partial and planned settle-ups** | "Pay ₹2,000 now, rest later" with a remaining-balance view per friend. | S | local |
| P4 | **Settle in another currency** | Pay a USD debt in INR at a chosen rate (with G5). | M | local + free rates |
| P5 | **Payment requests** | Ask someone to pay through UPI collect. 💰 Needs a payment provider; not planned. | L | provider |

## 5. Data, privacy and security

| # | Item | What and why | Size | Needs |
|---|---|---|---|---|
| D1 | **App lock** | PIN or fingerprint/Face ID to open the app (`expo-local-authentication` works in Expo Go). | S–M | local |
| D2 | **Store the OCR key securely** | Move the API key to the device keychain (`expo-secure-store`). | S | local |
| D3 | **Privacy page** | What's stored, what's sent to OCR.space, how to delete everything. A first-scan consent note. | S | local |
| D4 | **"Who can add me" and invite-only, block and report** | See roadmap 01. Stored now, enforced with a server. | L | backend |
| D5 | **Data checks on import/restore** | Validate files and amounts so a bad backup can't corrupt balances. | S | local (with F1) |

## 6. Technical and engineering

| # | Item | What and why | Size | Needs |
|---|---|---|---|---|
| T1 | **Move from Snack to a full Expo project with EAS builds** | Unlocks push notifications, on-device OCR, widgets and store releases. Needs the EAS CLI (Node.js, so a cloud dev environment, since nothing may be installed here) and, for iPhone builds, 💰 Apple Developer ($99/yr). | L | — |
| T2 | **Accounts and cloud sync** | Supabase free tier, offline-first with conflict handling (roadmap 01 Phase B). | L | backend |
| T3 | **Faster storage for big histories** | Move from one big saved file to per-record storage or SQLite (`expo-sqlite`); add data versioning and upgrade steps. | M | local |
| T4 | **Long lists that stay fast** | Make sure every long list scrolls efficiently and memoises its rows; test with 5,000 expenses. | M | local |
| T5 | **Crash screen** | A friendly "something went wrong" screen with "copy details" instead of a blank app. | S | local |
| T6 | **Automated click-through tests** | Turn the Snack driver (tools\cdp-drive.ps1) runs into a repeatable smoke suite for every release. | M | local |
| T7 | **Version control and CI** | A private GitHub repo with tests and type check on every change. Free tier minutes are enough. | S–M | GitHub account |
| T8 | **Code tidy-up** | Split the largest screens (ExpenseDetail, ItemizedSplit) into smaller parts; share form pieces. | S–M | local |
| T9 | **Newer Expo SDKs** | Move up once Snack and the App Store's Expo Go both support the next SDK (see ARCHITECTURE §10). | S | — |

## 7. Accessibility and languages

| # | Item | What and why | Size | Needs |
|---|---|---|---|---|
| A1 | **Hindi and regional languages** | Translatable text and number formats (G15). | M | local |
| A2 | **Screen reader pass** | Labels, reading order, announcements for totals and errors. | M | local |
| A3 | **Not colour-only** | Add ↑/↓ icons or words next to green/orange amounts for colour-blind users. | S | local |
| A4 | **Large text** | Check every screen at the largest system font size; let rows wrap. | S | local |
| A5 | **Number style choice** | Indian (1,23,456) or international (123,456) grouping. | S | local |

## Suggested first batch

**Quick and local, all S:**
- F1 backup & restore
- Q1 stray scroll space
- Q2 undo bar
- Q3 smart defaults
- T5 crash screen
- D2 secure OCR key
- A3 not colour-only

That's about 10–15% of a weekly limit in total.
