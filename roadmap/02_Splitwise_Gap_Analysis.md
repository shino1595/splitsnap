# Task 3: SplitSnap vs Splitwise, what's missing

Status: **list only, not started** (2026-10-20).

The Splitwise side comes from splitwise.com, splitwise.com/pro, its help centre (kb.splitwise.com)
and its blog, read on 2026-10-20 (26 pages). "Pro" means Splitwise charges for it.

## Already on par (or better) in SplitSnap

- **Groups and friends:**
  - groups, friends, non-group expenses
  - group types and emoji
  - archive
- **Splitting:**
  - equal (with a subset of people)
  - exact amounts, percentages, shares, adjustment
  - item by item, with tax, tip and discount
  - multiple payers
- **Balances and settling:**
  - simplify debts
  - settle up with cash, UPI, bank or other
  - undo a settle-up by deleting the payment
- **Expense details:**
  - activity feed
  - comments, notes and categories
  - repeating expenses (weekly, fortnightly, monthly, yearly)
  - restore deleted expenses
- **Reports and data:**
  - multi-currency balances kept separate per currency
  - totals screen
  - CSV export
- **Appearance:** dark mode with Light / Dark / System (Splitwise added its toggle in May 2026).
- **Free here, Pro in Splitwise:**
  - receipt scanning
  - itemization from a scanned receipt
  - expense search
  - charts
  - no daily limit (Splitwise Free allows 4 expenses a day)
- **Only in SplitSnap:**
  - unequal portions per item (A ate 2 of 6 naan)
  - "please check" hints on doubtful scanned lines
  - UPI pay link

## Missing or weaker: functional

| # | Splitwise feature | SplitSnap today | Why it matters | Needs |
|---|---|---|---|---|
| G1 | **Accounts, sign-in, cloud sync across devices**, offline mode with sync | Data on one phone only | Without it, nobody else sees the group, and changing phones loses data | Backend (see roadmap 01, Phase B) |
| G2 | **Invite by email or phone; invite link to join a group**; pending invitees; one invite + one reminder | Name-only local people | Real-life group building | G1 |
| G3 | **Notifications**: push/email when someone adds, edits or deletes an expense; held 60 s so mistakes can be fixed; per-user settings | None | Keeps everyone in sync | G1 (push is also blocked in Expo Go) |
| G4 | **Balance reminders delivered to the other person** ("Remind…") | Share-a-message only | The nudge that gets people paid | G1, or the parked ntfy idea (novelty-features 01) |
| G5 | **Currency conversion** (Pro): convert a group or friendship to your default currency at market rate | Per-currency balances, no conversion | Trips abroad | A free exchange-rate source (e.g. frankfurter.app, ECB rates, no key) |
| G6 | **Group default split** (Pro): e.g. 55%/45% or shares per family, used for every new expense | Each expense starts equal | Couples and families with fixed ratios | Local only |
| G7 | **Reimbursement / refund entries** (reimbursement split is web-only in Splitwise) | No dedicated type | Returned items, refunds, deposits | Local only |
| G8 | **New expenses default to the last currency used** in that group or friendship | Uses the group's default currency | Fewer taps on trips | Local only |
| G9 | **Block user / report user / blocklist** | None | Privacy and safety | G1 for real effect |
| G10 | **Full backup** (Pro JSON backup; full export by email) | CSV only, no restore | **More important for us**, since data lives on one phone | Local only (file export/import) |
| G11 | **Payment integrations**: Splitwise Pay, Venmo, PayPal (US), Pay by Bank (EU), payment requests | UPI pay link + "record a payment" | For India, UPI is the right path; no payment requests | UPI improvements are local; real payment requests need a payment provider (paid) |
| G12 | **Recurring expense email reminder** before each repeat; repeats visible in an all-recurring view; "just this once" cancel | Repeats work; no list of repeating expenses, no reminder | Managing rent, subscriptions | List: local. Reminder: G3 |
| G13 | **Totals by month or all time**, including payments made/received and change in balance | Totals by category, month and payer per currency | Month-to-month budgeting | Local only |
| G14 | **Group cover photos** | Emoji only | Personality | Local (image picker) |
| G15 | **7+ languages** | English only | India: Hindi and regional languages | Local (i18n) |
| G16 | **Web app** | Snack web preview only | Desktop entry of big bills | G1 plus hosting |
| G17 | **Public API** | None | Integrations | G1 |
| G18 | **Transaction import from bank cards** (US / select countries, Pro) | None | Auto-capture spending | Paid banking aggregators, not planned |

## Missing or weaker: quality of life

| # | Splitwise behaviour | SplitSnap today |
|---|---|---|
| Q1 | Activity loads the last 100 items and can't be cleared, an audit trail | Full feed; no paging yet (fine for now) |
| Q2 | Changes only notify *other* people; your own edits are quiet | No notifications at all (G3) |
| Q3 | "Fully settled up" explained; settled friends move out of the way | Settled filter exists; no "hide settled" toggle on the Groups list |
| Q4 | Changing an expense's currency only relabels it ("does not convert the amount"); conversion is explicit | Same today; G5 would add explicit conversion |

## Not copying (deliberately)

- **Ads and the 4-expenses-a-day limit** on the free tier.
- **Paid Pro tiers, Trip Pass and transaction import:** these cost money or need paid providers.
- **Splitwise's "no admins, anyone can edit anything" model:** SplitSnap could add optional group
  admins later, together with the invite-only privacy setting (roadmap 01).

## Suggested order (when you're ready)

1. **Local, quick, high value:** G10 backup & restore, G6 group default split, G8 last-used
   currency, G7 refunds, G13 monthly totals, G12 recurring list.
2. **G5 currency conversion**, using a free rates source.
3. **Roadmap 01 Phase A:** contacts, identity, invite messages.
4. **The big step, G1 to G4:** accounts and sync (roadmap 01 Phase B), which unlocks invites,
   notifications and reminders.
