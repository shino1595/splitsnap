# Task 1: adding members, contacts and invite-only privacy

Status: **explanation and plan, waiting for approval** (2026-10-20). Nothing in the plan below is built.

## 1. How adding members works today

- **New group / Edit group → Members:** you see yourself (always a member) and every friend, each with
  a tick box. Below the list, **New person's name + Add** creates a new friend from just a name.
  It shows as "New friend · added when you save" and is saved when you tap Create group.
  - A name that matches an existing friend ticks that friend instead ("Aarav is already your
    friend, so we ticked them").
- **Friends → Add friend:** name (required) plus optional email, phone and UPI ID. A name that is
  already used gets a warning ("You already have a friend called …").
- **What "adding" means:** SplitSnap has no server and no accounts. Everything lives only on your
  phone. Adding "LeBron" creates a **label** on your phone. LeBron is not contacted, does not need
  to agree, and never sees the group. It is a private ledger: you track who owes what, and you share
  reminders yourself. This matches Splitwise's **placeholder member** ("someone tracked by name,
  without contact info"), which Splitwise only offers on its web app.

So you're right: as a model of real life, member adding is incomplete. Your screenshot shows the
local, name-only step.

## 2. How Splitwise does it (help centre and blog, checked 2026-10-20)

| Topic | Splitwise |
|---|---|
| Add a person to a group | Group → gear → **Add people to group**, by **email or phone number** |
| Join a group | "A current member of the group will need to invite you", by email or phone, or **Invite via link** |
| Person without an account | Added at once; "you can start adding expenses with them right away, even before they accept the invite". Splitwise sends "one invite, one reminder, and then leave them alone" |
| Name only | "Placeholder group member", **web app only**; email or phone can be added later |
| Phone contacts | Not documented on the pages read |
| Stop people adding you | **No such setting.** No approval step, no group admins. Only **Block user** (hides shared groups, mutes them) and **Report user**, after the fact |

**Your invite-only idea is not in Splitwise.** It would be a real privacy advantage for SplitSnap.

## 3. The real-world design (what we'd build)

### Identity
Each person has an **account** (email, or phone later) and a **profile**. A member of a group is
one of:
- **Joined:** has an account and accepted.
- **Invited (pending):** an invitation exists but they haven't accepted it yet.
- **Placeholder:** a name only, tracked privately, like today.

### Ways to add someone
1. **From your phone contacts:** pick a contact, and their name, phone and email fill in.
   - If they're already on SplitSnap, they're linked.
   - If not, they become a placeholder with an **Invite** button.
2. **By email or phone:** typed in.
3. **Invite link / QR code** for a group. Anyone with the link can ask to join. The link can be
   turned off or reset.
4. **Name only:** a placeholder, as today.

### Privacy setting: "Who can add me to groups" (Account → Privacy)
- **Anyone who has my email/phone:** Splitwise's behaviour. You're added straight away and notified.
- **Only my friends:** strangers' adds become invitations.
- **Nobody, invite only:** every add becomes an **invitation**. You get an invite (in-app inbox,
  plus a link by email or text) and choose **Join** or **Decline**.
  - Until you accept, the group shows you as **Invited (pending)**.
  - The sender can still record expenses against your placeholder. You only see them, and owe
    them, once you join.
  - Declining removes you. Repeated declines from the same person can be blocked.
- Plus **Block** and **Report**, like Splitwise.

## 4. What it needs: why this is a phased plan

Invites, accepting and an enforceable privacy setting only work if both phones share data. That
needs **accounts and a small server** (cloud sync). SplitSnap doesn't have one today.

**Phase A: works now, no server, free (about 4–6% of a weekly limit)**
- **Add from phone contacts:** the `expo-contacts` library works in Expo Go. There's a permission
  prompt, and on web it falls back to typing.
- **Email/phone on every person:** asked for when adding. Used to spot duplicates and to link
  accounts later.
- **"Invite to SplitSnap" button:** shares a ready-made message through WhatsApp/SMS.
- **"Not on SplitSnap yet" badge** on placeholder people.
- **Privacy screen with "Who can add me":** stored now, enforced once Phase B exists. Clearly
  marked as "takes effect when sync is available" so it doesn't promise more than it does.

**Phase B: real multi-user (large, about 30–40% of a weekly limit over several rounds)**
- **Backend at no cost:** Supabase free tier (database, sign-in, live updates and access rules,
  usable from Expo Go). You would create the free account yourself.
  - Free-tier limits: projects pause after about a week of no use, 500 MB database, sign-in email
    is rate-limited.
  - Phone (SMS) sign-in costs money, so it's **email sign-in only**.
- **Sign-in:** email magic link or one-time code.
- **Cloud sync:** groups, expenses and payments, with offline-first local copies.
- **Invite links and QR codes, pending invitations with Join/Decline, and the privacy setting
  enforced by the server.**
- **Notifications:** Expo Go can't receive push (SDK 53+), so the app gets an in-app **Inbox**.
  Email notifications are limited on the free tier.

**Decision needed:** approve Phase A, Phase B (with the Supabase free account), both, or park it in
`novelty-features\`.
