// Backup file: build, read, check and restore. Pure (no React / React Native).
import { ME_ID } from '../types';
import type { AppState, Expense, ID, ISODate, ISODateTime, Payment, Person } from '../types';
import { readSavedValue } from './stateShape';

export const BACKUP_FORMAT = 'splitsnap-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export interface BackupCounts {
  groups: number;
  friends: number;
  expenses: number;
  payments: number;
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Expenses and payments count only when not deleted. */
export function countsOf(state: AppState): BackupCounts {
  return {
    groups: Object.keys(state.groups).length,
    friends: state.friendIds.length,
    expenses: Object.values(state.expenses).filter((e) => !e.deletedAt).length,
    payments: Object.values(state.payments).filter((p) => !p.deletedAt).length,
  };
}

/** JSON text of the whole state in an envelope. The OCR key is left out. */
export function buildBackup(state: AppState, opts: { at: ISODateTime; sharedGroupIds?: ID[] }): string {
  const copy: AppState = { ...state, settings: { ...state.settings, ocrApiKey: '' } };
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: opts.at, sharedGroupIds: opts.sharedGroupIds ?? [], state: copy },
    null,
    1,
  );
}

export function backupFilename(today: ISODate): string {
  return `splitsnap-backup-${today}.json`;
}

export type BackupReadResult =
  | { ok: true; state: AppState; exportedAt: ISODateTime | null; sharedGroupIds: ID[]; counts: BackupCounts }
  | { ok: false; error: string };

const NOT_BACKUP = "This isn't a SplitSnap backup file.";
const NEWER = 'This backup was made by a newer version of SplitSnap. Update the app, then try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBackup(text: string): BackupReadResult {
  const body = text.replace(/^﻿/, '').trim();
  if (!body) return { ok: false, error: 'That file is empty.' };
  if (body.length > MAX_BACKUP_BYTES) return { ok: false, error: 'That file is too big to be a SplitSnap backup.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: NOT_BACKUP };
  }
  if (!isRecord(parsed)) return { ok: false, error: NOT_BACKUP };

  let stateValue: unknown;
  let exportedAt: ISODateTime | null = null;
  let sharedRaw: unknown = [];
  if (parsed.format === BACKUP_FORMAT) {
    const version = parsed.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, error: NOT_BACKUP };
    if (version > BACKUP_VERSION) return { ok: false, error: NEWER };
    stateValue = parsed.state;
    exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null;
    sharedRaw = parsed.sharedGroupIds;
  } else if (!('format' in parsed) && 'schemaVersion' in parsed) {
    stateValue = parsed;
  } else {
    return { ok: false, error: NOT_BACKUP };
  }

  const saved = readSavedValue(stateValue);
  if (saved.kind === 'none') return { ok: false, error: NOT_BACKUP };
  if (saved.kind === 'damaged') {
    return { ok: false, error: saved.reason === 'newer-version' ? NEWER : "This backup is damaged and can't be used." };
  }
  const state = saved.state;

  const problems = checkIntegrity(state);
  if (problems.length > 0) {
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more problem${problems.length === 2 ? '' : 's'})` : '';
    return { ok: false, error: `This backup can't be used: ${problems[0]}${more}` };
  }

  const sharedGroupIds = Array.isArray(sharedRaw)
    ? sharedRaw.filter((id): id is string => typeof id === 'string' && has(state.groups, id))
    : [];
  return { ok: true, state, exportedAt, sharedGroupIds, counts: countsOf(state) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const isString = (v: unknown): v is string => typeof v === 'string';
const isIdList = (v: unknown): boolean => Array.isArray(v) && v.every(isString);
const isNumberMap = (v: unknown): boolean =>
  isRecord(v) && Object.keys(v).every((k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number));

const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'yearly'];

/** True when a saved split has the shape its method needs: the editor and the detail screen read it. */
function splitIsUsable(split: unknown): boolean {
  if (!isRecord(split)) return false;
  switch (split.method) {
    case 'equal':
      return isIdList(split.participantIds);
    case 'exact':
      return isNumberMap(split.amounts);
    case 'percent':
      return isNumberMap(split.percents);
    case 'shares':
      return isNumberMap(split.shares);
    case 'adjustment':
      return isIdList(split.participantIds) && isNumberMap(split.adjustments);
    case 'itemized': {
      const bill = split.bill;
      if (!isRecord(bill) || !Array.isArray(bill.items) || !Array.isArray(bill.charges)) return false;
      const itemsOk = bill.items.every(
        (i: unknown) =>
          isRecord(i) && isString(i.id) && isString(i.name) && Number.isSafeInteger(i.amount) && typeof i.quantity === 'number' && isNumberMap(i.shares),
      );
      const chargesOk = bill.charges.every(
        (c: unknown) =>
          isRecord(c) &&
          isString(c.id) &&
          isString(c.label) &&
          isString(c.kind) &&
          Number.isSafeInteger(c.amount) &&
          (c.allocation === 'proportional' || c.allocation === 'equal'),
      );
      return itemsOk && chargesOk;
    }
    default:
      return false;
  }
}

function recurrenceIsUsable(r: unknown): boolean {
  return isRecord(r) && isString(r.frequency) && FREQUENCIES.includes(r.frequency) && isString(r.nextDate) && ISO_DATE.test(r.nextDate);
}

/** Problems that would break balances or crash a screen; empty = sound. */
export function checkIntegrity(state: AppState): string[] {
  const problems: string[] = [];
  const people = state.people;
  const groups = state.groups;

  for (const [label, record] of [['people', people], ['groups', groups], ['expenses', state.expenses], ['payments', state.payments]] as const) {
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_KEYS.includes(key)) problems.push(`the ${label} list has a record with the reserved id "${key}"`);
    }
  }
  const knownPerson = (id: unknown): boolean => isString(id) && has(people, id);
  const knownGroup = (id: unknown): boolean => isString(id) && has(groups, id);

  const seenFriends: Record<string, boolean> = Object.create(null);
  for (const id of state.friendIds) {
    if (!knownPerson(id)) problems.push('the friends list has someone who doesn\'t exist');
    else if (id === ME_ID) problems.push('the friends list includes you');
    else if (seenFriends[id]) problems.push(`the friends list has "${people[id].name}" twice`);
    seenFriends[id] = true;
  }

  for (const id of Object.keys(groups)) {
    const g = groups[id];
    const name = `the group "${g.name}"`;
    if (!Array.isArray(g.memberIds) || !g.memberIds.every(isString)) {
      problems.push(`${name} has a bad member list`);
    } else {
      if (!g.memberIds.every(knownPerson)) problems.push(`${name} lists a member that doesn't exist`);
      if (!g.memberIds.includes(ME_ID)) problems.push(`${name} doesn't include you`);
      if (new Set(g.memberIds).size !== g.memberIds.length) problems.push(`${name} lists a member twice`);
    }
    if (typeof g.simplifyDebts !== 'boolean') problems.push(`${name} has a bad debt setting`);
    if (!isString(g.type) || !isString(g.emoji)) problems.push(`${name} has a missing type or emoji`);
  }

  const sumOf = (list: { amount: number }[]): number => list.reduce((s, x) => s + x.amount, 0);
  for (const id of Object.keys(state.expenses)) {
    const e: Expense = state.expenses[id];
    const name = `the expense "${e.description}"`;
    if (!isPositiveInt(e.total)) problems.push(`${name} has a bad total`);
    if (e.groupId !== null && !knownGroup(e.groupId)) problems.push(`${name} is in a group that doesn't exist`);
    if (!e.payers.length || !e.payers.every((p) => isPositiveInt(p.amount))) problems.push(`${name} has a bad payer list`);
    if (!e.owed.every((p) => Number.isSafeInteger(p.amount))) problems.push(`${name} has a bad amount owed`);
    if (![...e.payers, ...e.owed].every((p) => knownPerson(p.personId))) problems.push(`${name} involves someone who doesn't exist`);
    if (sumOf(e.payers) !== sumOf(e.owed)) problems.push(`${name} has shares that don't add up`);
    if (!isString(e.date) || !ISO_DATE.test(e.date)) problems.push(`${name} has a bad date`);
    if (![e.category, e.createdBy, e.createdAt, e.updatedAt].every(isString)) problems.push(`${name} is missing some details`);
    if (e.deletedAt !== undefined && !isString(e.deletedAt)) problems.push(`${name} has a bad deleted time`);
    if (!splitIsUsable(e.split)) problems.push(`${name} has a split that can't be read`);
    if (e.recurrence !== undefined && !recurrenceIsUsable(e.recurrence)) problems.push(`${name} has a bad repeat setting`);
    if (!e.comments.every((c) => isRecord(c) && [c.id, c.authorId, c.text, c.createdAt].every(isString))) {
      problems.push(`${name} has a bad comment`);
    }
  }

  for (const id of Object.keys(state.payments)) {
    const p: Payment = state.payments[id];
    const name = `the payment from ${knownPerson(p.fromId) ? people[p.fromId].name : 'someone'} to ${knownPerson(p.toId) ? people[p.toId].name : 'someone'}`;
    if (!isPositiveInt(p.amount)) problems.push(`${name} has a bad amount`);
    if (p.fromId === p.toId) problems.push(`${name} is from a person to themselves`);
    if (!knownPerson(p.fromId) || !knownPerson(p.toId)) problems.push(`${name} involves someone who doesn't exist`);
    if (p.groupId !== null && !knownGroup(p.groupId)) problems.push(`${name} is in a group that doesn't exist`);
    if (!isString(p.date) || !ISO_DATE.test(p.date)) problems.push(`${name} has a bad date`);
    if (!isString(p.method) || !isString(p.createdAt)) problems.push(`${name} is missing some details`);
    if (p.deletedAt !== undefined && !isString(p.deletedAt)) problems.push(`${name} has a bad deleted time`);
  }

  state.activity.forEach((a, i) => {
    if (![a.id, a.type, a.at, a.actorId].every(isString)) problems.push(`activity entry ${i + 1} is missing some details`);
  });

  const cur = state.settings.defaultCurrency;
  if (!isString(cur) || cur.length !== 3) problems.push('the default currency is not a 3-letter code');
  return problems;
}

/** The state after restoring `backup` on a phone whose state is `current`. */
export function restoreState(
  current: AppState,
  backup: AppState,
  opts: { sharedHere: ID[]; sharedInBackup: ID[]; includeSharedCopies: boolean },
): AppState {
  const keep = opts.sharedHere.filter((id) => has(current.groups, id));
  const inKeep = (id: ID | null | undefined): boolean => id !== null && id !== undefined && keep.includes(id);
  const skip = opts.includeSharedCopies ? [] : opts.sharedInBackup.filter((id) => !keep.includes(id));
  const dropped = (id: ID | null | undefined): boolean => inKeep(id) || (id !== null && id !== undefined && skip.includes(id));

  const groups: AppState['groups'] = {};
  for (const id of Object.keys(backup.groups)) if (!dropped(id)) groups[id] = backup.groups[id];
  for (const id of keep) groups[id] = current.groups[id];

  const expenses: AppState['expenses'] = {};
  for (const id of Object.keys(backup.expenses)) if (!dropped(backup.expenses[id].groupId)) expenses[id] = backup.expenses[id];
  for (const id of Object.keys(current.expenses)) if (inKeep(current.expenses[id].groupId)) expenses[id] = current.expenses[id];

  const payments: AppState['payments'] = {};
  for (const id of Object.keys(backup.payments)) if (!dropped(backup.payments[id].groupId)) payments[id] = backup.payments[id];
  for (const id of Object.keys(current.payments)) if (inKeep(current.payments[id].groupId)) payments[id] = current.payments[id];

  const people: Record<ID, Person> = { ...backup.people };
  const wanted: Record<string, boolean> = Object.create(null);
  for (const gid of keep) {
    for (const m of current.groups[gid].memberIds) wanted[m] = true;
  }
  for (const e of Object.values(current.expenses)) {
    if (!inKeep(e.groupId)) continue;
    wanted[e.createdBy] = true;
    for (const s of e.payers) wanted[s.personId] = true;
    for (const s of e.owed) wanted[s.personId] = true;
    for (const c of e.comments) wanted[c.authorId] = true;
  }
  for (const p of Object.values(current.payments)) {
    if (!inKeep(p.groupId)) continue;
    wanted[p.fromId] = true;
    wanted[p.toId] = true;
  }
  for (const id of Object.keys(wanted)) if (has(current.people, id)) people[id] = current.people[id];
  if (keep.length > 0 && has(current.people, ME_ID)) people[ME_ID] = current.people[ME_ID];

  const friendIds: ID[] = [];
  const seen: Record<string, boolean> = Object.create(null);
  const addFriend = (id: ID): void => {
    if (id === ME_ID || seen[id] || !has(people, id)) return;
    seen[id] = true;
    friendIds.push(id);
  };
  backup.friendIds.forEach(addFriend);
  for (const id of current.friendIds) {
    if (keep.some((gid) => current.groups[gid].memberIds.includes(id))) addFriend(id);
  }

  const activity = [
    ...backup.activity.filter((a) => !dropped(a.groupId)),
    ...current.activity.filter((a) => inKeep(a.groupId)),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    ...backup,
    people,
    friendIds,
    groups,
    expenses,
    payments,
    activity,
    settings: { ...backup.settings, ocrApiKey: backup.settings.ocrApiKey || current.settings.ocrApiKey },
  };
}

/** '3 groups · 6 friends · 42 expenses · 5 payments' */
export function countsText(counts: BackupCounts): string {
  const n = (v: number, one: string, many: string): string => `${v} ${v === 1 ? one : many}`;
  return [n(counts.groups, 'group', 'groups'), n(counts.friends, 'friend', 'friends'), n(counts.expenses, 'expense', 'expenses'), n(counts.payments, 'payment', 'payments')].join(' · ');
}
