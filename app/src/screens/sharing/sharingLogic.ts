// Pure helpers for the shared-group screens: join codes, the invite message, member badges,
// display names, the sync status line and friendly error texts (docs/SYNC_DESIGN.md §7).
import type { ID } from '../../types';
import type { GroupPreview, SyncStatus } from '../../sync/types';

/** Opens SplitSnap in Expo Go (EAS Update, channel main). Every invite carries it. */
export const APP_LINK =
  'exp://u.expo.dev/e2a3167d-0539-40eb-8acf-3593c97841b5?runtime-version=exposdk%3A58.0.0&channel-name=main';

/** The characters the server picks join codes from (supabase/setup.sql: no I, L, O, 0 or 1). */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;

/** The server keeps 60 characters of a member's name. */
export const DISPLAY_NAME_MAX = 60;

/** Spaces, dashes (plain and typographic), underscores and invisible characters chat apps add. */
const CODE_SEPARATORS = /[\s​-‍﻿_\-‐-―−]+/g;
const LOOK_ALIKES = 'IL0O1';

/** What people paste or type, as the server stores it: ' abcd-efgh ' → 'ABCDEFGH'. */
export function normalizeJoinCode(text: string): string {
  return text.replace(CODE_SEPARATORS, '').toUpperCase();
}

/** Why a typed code can't be right, or null when it looks like a real code. */
export function joinCodeProblem(text: string): string | null {
  const code = normalizeJoinCode(text);
  if (!code) return 'Enter the code from your invite';
  const wrong = code.split('').filter((c) => JOIN_CODE_ALPHABET.indexOf(c) < 0);
  if (wrong.length > 0) {
    return wrong.every((c) => LOOK_ALIKES.indexOf(c) >= 0)
      ? 'Codes never use I, L, O, 0 or 1. Check those characters again.'
      : 'Codes only have letters and the numbers 2 to 9.';
  }
  if (code.length !== JOIN_CODE_LENGTH) {
    return `A code has ${JOIN_CODE_LENGTH} characters; this one has ${code.length}.`;
  }
  return null;
}

/** 'ABCDEFGH' → 'ABCD-EFGH' (easier to read out); anything else is returned as it is. */
export function formatJoinCode(code: string): string {
  return code.length === JOIN_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function inviteTitle(groupName: string): string {
  return `Join ${groupName} on SplitSnap`;
}

/** The WhatsApp-style invite: what to open, where to type the code, and how to claim your name. */
export function inviteMessage(groupName: string, code: string): string {
  return [
    `Join "${groupName}" on SplitSnap, so we can split our costs together.`,
    '',
    `1. Open SplitSnap in Expo Go: ${APP_LINK}`,
    `2. Go to Groups, tap "Join a group" and enter the code ${formatJoinCode(code)}`,
    '3. Tap "That\'s me" next to your name.',
  ].join('\n');
}

/** Member badge: a real SplitSnap user in the shared group, or a placeholder nobody claimed yet. */
export function memberBadge(onSplitSnap: boolean): string {
  return onSplitSnap ? 'On SplitSnap' : 'Invited';
}

/** 'Shared · 2 of 4 on SplitSnap' for the group screen; just 'Shared' while you are alone in it. */
export function sharedSummary(onSplitSnap: number, members: number): string {
  return members <= 1 ? 'Shared' : `Shared · ${onSplitSnap} of ${members} on SplitSnap`;
}

/** One line for an editor whose group picker is locked (SYNC_DESIGN §4.5). */
export function sharedGroupLock(kind: 'expense' | 'payment', groupName: string): string {
  return `This ${kind} is shared in ${groupName}, so it can't move to another group.`;
}

export function cleanDisplayName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, DISPLAY_NAME_MAX).trim();
}

export function displayNameProblem(text: string): string | null {
  const name = cleanDisplayName(text);
  if (!name) return 'Enter your name';
  const lower = name.toLowerCase();
  if (lower === 'you' || lower === 'me') return 'Use your own name, so the others know who you are';
  return null;
}

/** What the name field starts with: the saved display name, else your profile name (not the default 'You'). */
export function displayNameDraft(current: string | null, profileName: string | undefined): string {
  if (current && current.trim()) return current;
  const name = cleanDisplayName(profileName ?? '');
  return displayNameProblem(name) ? '' : name;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The status line in Settings ('Live', 'Offline: 3 changes waiting', …). */
export function syncStatusText(status: SyncStatus, pending: number): string {
  const waiting = plural(pending, 'change', 'changes');
  switch (status) {
    case 'off':
      return 'Sharing is off in this version';
    case 'idle':
      return 'Not connected yet';
    case 'connecting':
      return pending > 0 ? `Connecting: ${waiting} waiting` : 'Connecting…';
    case 'live':
      return pending > 0 ? `Live: sending ${waiting}` : 'Live';
    case 'offline':
      return pending > 0 ? `Offline: ${waiting} waiting` : 'Offline: nothing waiting';
  }
}

export interface JoinChoices {
  /** Placeholders nobody claimed yet ("That's me"), in the server's order. */
  open: GroupPreview['members'];
  /** Members who already joined. */
  taken: GroupPreview['members'];
  /** The open placeholder that is most likely you (same name as your display name), or null. */
  suggested: ID | null;
}

/** Splits a preview's members for the "Who are you?" list and guesses which placeholder is you. */
export function joinChoices(preview: GroupPreview, displayName: string | null): JoinChoices {
  const open = preview.members.filter((m) => !m.claimed);
  const taken = preview.members.filter((m) => m.claimed);
  const mine = cleanDisplayName(displayName ?? '').toLowerCase();
  let suggested: ID | null = null;
  if (mine) {
    const exact = open.filter((m) => cleanDisplayName(m.name).toLowerCase() === mine);
    const first = (s: string) => cleanDisplayName(s).toLowerCase().split(' ')[0];
    const byFirst = open.filter((m) => first(m.name) === first(mine));
    if (exact.length === 1) suggested = exact[0].id;
    else if (exact.length === 0 && byFirst.length === 1) suggested = byFirst[0].id;
  }
  return { open, taken, suggested };
}

// ---------- Friendly errors ----------

export const OFFLINE_TEXT = 'You seem to be offline. Check your connection and try again.';
export const WRONG_CODE_TEXT =
  "That code doesn't match a group. Check it, or ask for a new invite: the code may have been changed or switched off.";
export const CLAIMED_TEXT = 'Someone has already claimed that name. Pick another one, or join as a new member.';
export const DENIED_TEXT = "You can't do that in this group any more. You may have left it, or it was deleted.";

const ERROR_KINDS = ['network', 'denied', 'invalid', 'not-found'];

/** SyncError-like fields of anything thrown (the engine throws SyncError; others throw Error). */
function errorParts(error: unknown): { kind: string | null; message: string } {
  if (!error || typeof error !== 'object') return { kind: null, message: typeof error === 'string' ? error : '' };
  const fields = error as { kind?: unknown; message?: unknown };
  const kind = typeof fields.kind === 'string' && ERROR_KINDS.indexOf(fields.kind) >= 0 ? fields.kind : null;
  return { kind, message: typeof fields.message === 'string' ? fields.message : '' };
}

/** A sentence to show for a failed share / join / leave / code change; `fallback` when nothing fits. */
export function syncErrorText(error: unknown, fallback: string): string {
  const { kind, message } = errorParts(error);
  if (/already claimed/i.test(message)) return CLAIMED_TEXT;
  if (kind === 'network' || /network|failed to fetch|offline|timed? ?out/i.test(message)) return OFFLINE_TEXT;
  if (kind === 'not-found' || /doesn.?t match a group/i.test(message)) return WRONG_CODE_TEXT;
  if (kind === 'denied') return DENIED_TEXT;
  // 'invalid' carries the server's own sentence (e.g. "You must be one of the members").
  if (kind === 'invalid' && message && message.length <= 140) return message;
  return fallback;
}
