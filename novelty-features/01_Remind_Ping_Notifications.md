# Plan: "Remind" pings the other person's phone

Status: **Parked: not approved for the current build** (decided 2026-10-16). Nothing below is built. Revisit only when the user asks.

## Goal

Pressing **Remind** makes the friend's phone buzz with a notification ("Sam says you owe ₹500
for Goa Trip"), as well as the existing option to share a text message.

## Constraints

- No costs beyond the Claude subscription, and nothing installed on this PC.
- The app runs in Expo Go through Expo Snack (SDK 54).
- SplitSnap keeps each person's data on their own phone. There is no server and no SplitSnap
  accounts, so one phone cannot look the other person up.

## Options considered

| Option | Result | Why |
|---|---|---|
| A. Expo push notifications (a real SplitSnap notification) | **Not possible now** | Expo Go dropped remote push in SDK 53 ("Expo Go does not support push notifications functionality"). Push needs a *development build*, which is made with the EAS command-line tool (Node.js, not allowed on this PC), and an iPhone build needs a paid Apple Developer account. Sending through Expo's push service would be free, so this is the production path later. |
| B. **ntfy relay** (free, open-source push service) | **Recommended** | Free with no sign-up ("free of charge… without signup"). The friend installs the free ntfy app once (App Store and Google Play). SplitSnap posts the reminder to the friend's private ntfy channel, and the friend's phone buzzes. It works on iPhone and Android, and also from Snack's web preview (I checked that ntfy.sh allows browser requests: `Access-Control-Allow-Origin: *`). |
| C. Prefilled WhatsApp chat (`wa.me` link) | Optional extra | Free and easy, but the friend has to read WhatsApp. It is a better *share*, not a ping. |

## How option B works for the two people

**Friend (receiver), once:**
1. SplitSnap → Account → **"Get payment reminders on this phone"**. The app creates a private
   reminder channel: a random 24-character name that works like a password.
2. The screen walks through it: install **ntfy** (free), then tap **Subscribe in ntfy** (a direct
   link on Android; on iPhone, copy the channel name into ntfy), then tap **Send me a test ping**.
3. **Share my reminder code** sends the code to friends (share sheet / copy).

**You (sender), once per friend:** Friend → Edit → **Reminder code**: paste the code you received,
then **Test ping**.

**Every reminder:** Remind (on the friend's page and on group Balances) opens a small menu:
- **Ping Aarav's phone** (when a code is saved). The phone gets *"💸 Payment reminder — Sam says
  you owe ₹500.00 for Goa Trip. Settle up in SplitSnap."* at high priority (long vibration).
- **Send as a message** (today's share option).
- **Set up pings / How do pings work?** (when no code is saved).

The result shows as "Reminder sent to Aarav's phone" or a plain-English error (offline, too
many reminders, code not working). The Activity tab logs "You reminded Aarav".

## Safeguards

- **Consent:** pings only go to people who set up a channel and shared their code, as ntfy's
  terms require ("no messages to recipients who have not consented").
- **No spamming:** one ping per friend per hour, shown as "You can remind Aarav again at 6:40 pm".
  ntfy.sh allows 250 messages a day per internet connection, far more than needed.
- **Privacy:** the reminder passes through ntfy.sh and Google/Apple's delivery services. It only
  contains a first name, the amount and the group name, never bank or UPI details. Channel
  names are long and random, because anyone who knows a channel name can read it.
- **Honest limits shown in the app:** delivery is best-effort with no guarantee. On iPhone the
  notification comes from the ntfy app, not SplitSnap. On Android, the user turns on "instant
  delivery" for the channel in ntfy, otherwise it can arrive minutes late.

## Build steps (after approval)

1. **Data (additive):** `Person.reminderCode?`, `Settings.myReminderCode?`, the last-ping time per
   friend, and a new activity type `reminder_sent`.
2. **`lib/ntfy.ts` + unit tests:** create and validate codes, build the message (title, text,
   priority, tags), send with a timeout, map errors (429 = too many, offline, server errors),
   and the cooldown rule.
3. **Store actions:** save my code, save a friend's code, record a sent reminder.
4. **Screens:** the Account/Settings set-up section (with the test ping and share code), the
   Reminder-code field on Edit friend, the Remind menu on Friend detail and on group Balances,
   and the activity entry.
5. **Verification without a phone:** run the flow in Snack's web preview from this PC, sending
   to a throw-away test channel, then read that channel back through ntfy's public read-back
   (polling) address to prove the ping arrived with the right text. Unit tests and type check
   must pass.
6. **Your test on a real phone:** install ntfy, set up the channel in SplitSnap, and press
   Remind in another copy of SplitSnap (for example the Snack web preview on your PC).
7. Update README and ARCHITECTURE.

## Effort

One build round of 3–4 agents after the QA run finishes, so they don't edit the same screens at
the same time. That is roughly 8–12% of the weekly limit, and costs nothing.

## Later (not now)

Real SplitSnap-branded push (option A) needs development builds plus a small server for
exchanging push tokens. It becomes possible if you later allow EAS / Apple developer costs.
