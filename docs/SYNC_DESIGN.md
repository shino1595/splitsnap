# Shared groups: sync design (roadmap/05, Option A, step A2)

How SplitSnap keeps a shared group the same on several phones. The server side is
`supabase/setup.sql`; this document is the app side. Status: design, being built (2026-10-28).

## 1. Principles

- **Local first.** The app keeps working exactly as today on `AppState` (reducer, AsyncStorage).
  Sync is a layer around it: it watches local changes to shared groups and pushes them, and it
  feeds server changes back in through one reducer action. No screen reads the server directly.
- **Only shared groups sync.** Non-group expenses and unshared groups never leave the phone.
- **The engine never imports Supabase.** It talks to a `SyncBackend` interface. The real
  implementation (`supabaseBackend.ts`, supabase-js, loaded with `import()`) is one file; tests use
  an in-memory `FakeBackend` that behaves like the server (membership rules, join codes,
  timestamps). If supabase-js ever fails in Expo Go, only that one file changes.
- **The money engine is untouched.** Expenses travel as the app's own JSON, so `split.ts`,
  `balances.ts` and their tests stay as they are.

## 2. Identity: "me" on every phone

Locally the user is always `ME_ID` (`'me'`). On the server, each person in a group is a
**member id**, unique within the group:

| Who | Member id |
|---|---|
| Someone added as a placeholder by the sharer | their local person id, e.g. `per_lq3k9x_4f2a` |
| A user who joined as a new member | a random `u_…` id from `join_group` (returned as `memberId`) |
| The sharer themselves | a random `u_…` id the app picks and sends in `share_group` |
| A user who claimed a placeholder ("That's me") | the placeholder's id |

Per shared group the phone stores **`myMemberId`**. Conversion is a pure, exhaustive id rewrite:

- **To the server:** `ME_ID` → `myMemberId`.
- **From the server:** `myMemberId` → `ME_ID`. All other ids stay the same, and become local
  people (created if missing, added to Friends like Splitwise does).

The rewrite must cover every place a person id appears: `payers[].personId`, `owed[].personId`,
every `SplitInput` variant (`participantIds`, keys of `amounts` / `percents` / `shares` /
`adjustments`, itemised `items[].shares` keys), `createdBy`, comment `authorId`, payment
`fromId` / `toId`, activity `actorId` / `personId`, and group `memberIds`. Round trip
(to server, then back) must give the identical object.

## 3. What is stored where

| Server table | Local source | Notes |
|---|---|---|
| `groups` | `state.groups[id]` (name, type, emoji, currency, simplify, archived) | `memberIds` come from `group_members`. |
| `group_members` | group `memberIds` + `state.people` (name, colour) | `user_id` set = a real user ("on SplitSnap"), null = placeholder. |
| `expenses.data` | the `Expense` **without** `comments` and **without** `receiptUri` | Bill photos stay on the phone that took them (Option A). |
| `payments.data` | the `Payment` | |
| `comments.data` | one `Comment` (+ `expense_id`) | Merged into `expense.comments` by id. |
| `activity.data` | the `Activity` (type, actor, ids, amount) + a neutral `summary` | Re-worded for the reader (§6). |

Sync bookkeeping lives in its own AsyncStorage key (`splitsnap/sync/v1`), not in `AppState`:
signed-in user id, display name, per shared group `{ myMemberId, joinCode, members:
{ [memberId]: { userId?: string } }, cursor }`, and the **outbox**.

## 4. Local → server

1. After every local action, `diffShared(prev, next, shared)` compares the two states **for shared
   groups only** (records are replaced, not mutated, so a reference check finds changes):
   group fields; added members; added / changed expenses and payments (soft deletes included);
   new comments; new activity entries.
2. Each change becomes an **outbox key**: `{ kind, groupId, id }`. Keys are coalesced (one per
   entity). The payload is read from the current state **when sending**, so the latest version
   always wins locally. A deleted shared group is a `group-delete` key (the local record is gone).
3. The outbox is saved with the sync state and flushed when online with **`push_changes`**
   (one call, one transaction: groups are updated, members / expenses / payments inserted or
   updated, comments / activity insert-only). Plain PostgREST upserts are not used: they would
   also SET `group_id`, which the server deliberately does not allow (an expense can't move
   group). Network errors: keep and retry with
   backoff. Permission errors (e.g. you left the group): drop the key and show a notice. Being
   signed out (no session, 28000, HTTP 401) counts as a network error, never as a refusal.
4. Changes that came **from** the server are applied with `sync/applyRemote`, which the differ
   ignores, so they never echo back.
5. **An expense or payment can't change group once the group is shared:** ids are global on the
   server, so a move can't be stored. The editor locks the group picker for them (the server
   would skip the change). `push_changes` returns how many rows it wrote per kind; fewer than
   sent means rows were skipped (e.g. a group you left) and is logged.

## 5. Server → local

- **Pull:** on start, on resume and after reconnecting, per shared group: rows with
  `updated_at` (`created_at` for comments / activity) after the group's cursor minus a
  **10-second overlap** (server timestamps are transaction start times, so a row can commit later
  than a newer-looking one). Applying is idempotent, so the overlap only repeats work. A new
  cursor is saved only after the app state holding its rows (AppStore saves with a delay), and a
  shared group missing from the app state at start is pulled again from the beginning.
- **Live:** one Realtime channel with Postgres Changes on the six tables. Row security means each
  phone only receives rows of its groups. Each event goes through the same apply path.
  - **When the channel counts as live:** only after the server's `postgres_changes` system
    message with status `ok` (or about 10 s after `SUBSCRIBED` without one, for a server that
    never sends it). A system `error` is handled like a channel error: drop, retry with backoff.
    `realtime.setAuth()` runs before every join, so the join carries the user's token. Without
    it the server joins as the anon role: a filtered binding is refused with a system error, and
    an unfiltered one (like this channel) can be accepted but then delivers no rows.
  - **Why:** `SUBSCRIBED` comes from the join reply. On a cold project the change stream starts
    seconds later, and changes made in between are never delivered. Going live triggers the
    pull, which covers everything before that point. If the confirmation comes after the 10 s
    fallback, the channel reports live again, so the engine pulls once more.
- **Apply** (`sync/applyRemote`, pure, in the reducer): rewrite ids (§2), create missing people,
  upsert by id. **Conflicts:** an entity with a pending outbox key keeps the local version (it
  is about to be sent, and later saves win). Otherwise the server row replaces the local one.
  `owed` is recomputed with `computeOwed`; a row that fails validation is skipped and logged,
  never half-applied.

## 6. Activity for several readers

Local activity sentences say "You". For a shared entry the sender also stores a neutral
summary (names, no "you"). The receiver re-words the common types from structured fields and its
own state (`expense_*`, `payment_*`, `comment_added`, `member_added`, `group_created/updated`),
so Bhavna reads "Aarav paid you ₹500.00" while Aarav reads "You paid Bhavna ₹500.00". Other types
fall back to the neutral summary.

## 7. Flows

- **Sign-in:** only when you first share or join (not at app start): `signInAnonymously()`, then
  your display name (prefilled from your profile) is saved to `profiles`. The session is kept in
  AsyncStorage; tokens refresh while the app is in the foreground.
- **Share group** (group screen): uploads with `share_group` (all or nothing, existing
  comments included), saves `myMemberId` (a random `u_…` id) and the join code, then
  shows the code and a WhatsApp message with the fixed app link.
- **Join group** (Groups tab): enter the code → `preview_group` lists the members → tap
  **"That's me"** on your placeholder or **Join as new member** → `join_group` returns the member row
  that is now you (`myMemberId`) → full pull → the group appears with your history mapped to
  "You". Someone who was in the group before always gets their old row back.
- **Leave group:** `leave_group`; the local copy stays as an ordinary (unshared) group.
- **New phone or reinstalled Expo Go** (a new anonymous user): the project owner deletes the old
  user under Authentication → Users, which frees the member row; then "That's me" works again.

## 8. Not in Option A

Bill photos, push notifications, member removal on the server (members only leave), email
accounts, invite-only privacy and blocking (Option B, roadmap/05).

## 9. Files

`app/src/sync/`: `types.ts` (contract), `idMap.ts`, `rows.ts`, `diff.ts`, `outbox.ts`,
`engine.ts`, `fakeBackend.ts` (tests and the two-user web test), `supabaseBackend.ts`,
`config.ts` (project URL + publishable key), `SyncProvider.tsx`. Reducer: `sync/applyRemote`.
Screens: `screens/sharing/` (Share, Join, That's me), a member badge, and Settings rows (display
name, sync status, leave group). Tests in `tests/sync/`.
