// Converts between the app's records and the server's rows (docs/SYNC_DESIGN.md §3, §5).
// Outgoing: person ids rewritten for the server, phone-only fields stripped, text fitted to the
// checks in supabase/setup.sql (one bad row would fail the whole push_changes transaction).
// Incoming: rows are untrusted. Every field is validated, a bad row is skipped whole, and ids,
// group and deletion always come from the row's columns, never from its JSON.
import { ME_ID } from '../types';
import type {
  Activity,
  ActivityType,
  AppState,
  BillCharge,
  BillItem,
  CategoryId,
  ChargeKind,
  Comment,
  Expense,
  Group,
  GroupType,
  ID,
  ISODateTime,
  ItemizedBill,
  MoneyShare,
  Payment,
  PaymentMethod,
  Person,
  Recurrence,
  RecurrenceFrequency,
  SplitInput,
} from '../types';
import type {
  ActivityRow,
  CommentRow,
  DataRow,
  GroupRow,
  LocalBatch,
  MemberRow,
  PushActivity,
  PushComment,
  PushData,
  PushGroup,
  PushMember,
  RemoteBatch,
  SharedGroupInfo,
  SharedMemberInfo,
  ShareRequest,
  SyncState,
} from './types';
import { CATEGORIES } from '../lib/categories';
import { computeOwed } from '../lib/split';
import { avatarPalette } from '../theme';
import { remapActivity, remapComment, remapExpense, remapPayment, toLocalId, toServerId } from './idMap';

// ---------- Outgoing ----------

/** Trimmed, at most `max` characters (code points, as Postgres counts them), never empty. */
function fit(text: string, max: number, fallback: string): string {
  const chars = Array.from(typeof text === 'string' ? text.trim() : '');
  return chars.length > 0 ? chars.slice(0, max).join('').trim() : fallback;
}

/** group_members.color allows at most 16 characters. */
function serverColor(color: string | null | undefined): string | null {
  return typeof color === 'string' && color.length > 0 && color.length <= 16 ? color : null;
}

export function pushGroup(group: Group): PushGroup {
  return {
    id: group.id,
    name: fit(group.name, 60, 'New group'),
    type: group.type,
    emoji: fit(group.emoji, 16, '👥'),
    defaultCurrency: group.defaultCurrency,
    simplifyDebts: !!group.simplifyDebts,
    archived: !!group.archived,
  };
}

export function pushMember(groupId: ID, person: Pick<Person, 'id' | 'name' | 'color'>, memberId: ID): PushMember {
  return { groupId, id: memberId, name: fit(person.name, 60, 'Friend'), color: serverColor(person.color) };
}

/** Comments travel as their own rows and bill photos stay on this phone (Option A). The JSON's
 *  groupId must equal the row's or the server's check fails the whole push. */
export function pushExpense(e: Expense, info: SharedGroupInfo): PushData {
  const data: Record<string, unknown> = { ...remapExpense(e, toServerId(info.myMemberId)), groupId: info.groupId };
  delete data.comments;
  delete data.receiptUri;
  return { id: e.id, groupId: info.groupId, data, deletedAt: e.deletedAt ?? null };
}

export function pushPayment(p: Payment, info: SharedGroupInfo): PushData {
  const data: Record<string, unknown> = { ...remapPayment(p, toServerId(info.myMemberId)), groupId: info.groupId };
  return { id: p.id, groupId: info.groupId, data, deletedAt: p.deletedAt ?? null };
}

export function pushComment(expenseId: ID, c: Comment, groupId: ID, info: SharedGroupInfo): PushComment {
  const data: Record<string, unknown> = { ...remapComment(c, toServerId(info.myMemberId)) };
  return { id: c.id, groupId, expenseId, data };
}

export function pushActivity(a: Activity, info: SharedGroupInfo, myName: string): PushActivity {
  const data: Record<string, unknown> = {
    ...remapActivity(a, toServerId(info.myMemberId)),
    groupId: info.groupId,
    summary: neutralSummary(a.summary, myName),
  };
  return { id: a.id, groupId: info.groupId, data };
}

/**
 * Local sentences call the user "You" / "you"; other readers need a name (§6). Everything from
 * the first to the last double quote is left alone, so a description such as "Dinner with you"
 * (even one that itself contains quotes) is never re-worded. "your" is a different word.
 */
export function neutralSummary(summary: string, myName: string): string {
  const name = myName.trim() || 'Someone';
  // A function replacement, so a name containing '$' is inserted literally.
  const swap = (part: string): string => part.replace(/\b[Yy]ou\b/g, () => name);
  const first = summary.indexOf('"');
  const last = summary.lastIndexOf('"');
  if (first < 0 || first === last) return swap(summary);
  return swap(summary.slice(0, first)) + summary.slice(first, last + 1) + swap(summary.slice(last + 1));
}

/**
 * share_group arguments for a local group: its members (you as `me`, named `myName`), every
 * expense (soft-deleted ones too), payment and existing comment, ids rewritten with `me` as
 * your member id. Throws when the group does not exist.
 */
export function shareRequest(state: AppState, groupId: ID, me: ID, myName: string): ShareRequest {
  const group = state.groups[groupId];
  if (!group) throw new Error('This group no longer exists');
  const info: SharedGroupInfo = { groupId, myMemberId: me, joinCode: null, joinEnabled: true, members: {}, cursor: null };
  const myself = state.people[ME_ID];

  const members: PushMember[] = [pushMember(groupId, { id: ME_ID, name: myName, color: myself ? myself.color : '' }, me)];
  for (const id of group.memberIds) {
    const person = state.people[id];
    if (id !== ME_ID && person) members.push(pushMember(groupId, person, id));
  }

  const expenses = Object.values(state.expenses).filter((e) => e.groupId === groupId);
  const comments: PushComment[] = [];
  for (const e of expenses) for (const c of e.comments) comments.push(pushComment(e.id, c, groupId, info));

  return {
    group: pushGroup(group),
    members,
    expenses: expenses.map((e) => pushExpense(e, info)),
    payments: Object.values(state.payments)
      .filter((p) => p.groupId === groupId)
      .map((p) => pushPayment(p, info)),
    comments,
    me,
  };
}

// ---------- Incoming: validation helpers ----------

type Json = Record<string, unknown>;

// Marked by name, not a subclass: transpiled Error subclasses can break instanceof.
const INVALID = 'InvalidRow';

function invalid(reason: string): Error {
  const error = new Error(reason);
  error.name = INVALID;
  return error;
}

/** Fails the row being read; the message becomes the skip reason. */
function need(ok: unknown, reason: string): asserts ok {
  if (!ok) throw invalid(reason);
}

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isMinor(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Ids become keys of the app's records, so names every object inherits ('__proto__',
 * 'constructor', 'toString', …) are refused: a lookup by one would find the inherited value.
 */
function isId(v: unknown): v is ID {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 && !(v in {});
}

/** Phones never send ME_ID (each writes its own member id instead), so a raw 'me' is forged. */
function isPersonId(v: unknown): v is ID {
  return isId(v) && v !== ME_ID;
}

function isOneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === 'string' && (list as readonly string[]).indexOf(v) >= 0;
}

function isCurrency(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v);
}

function isDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
}

function isTimestamp(v: unknown): v is ISODateTime {
  return timeOf(v) !== null;
}

function isColor(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Milliseconds of an ISO or Postgres timestamp ('2026-10-28T10:00:00.000Z',
 * '2026-10-28 10:00:00.123456+00'), or null. Parsed by hand: Hermes' Date.parse rejects the
 * Postgres forms, and string comparison breaks when the two forms mix.
 */
export function timeOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = TIMESTAMP.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] ? Number(m[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
  let t = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const zone = m[8];
  if (zone && zone.toUpperCase() !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const offset = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || '0');
    t -= (zone[0] === '-' ? -1 : 1) * offset * 60000;
  }
  return Number.isFinite(t) ? t : null;
}

/** A nullable timestamp column as an app ISO string; undefined when null. */
function columnTime(value: unknown, reason: string): ISODateTime | undefined {
  if (value === null || value === undefined) return undefined;
  const t = timeOf(value);
  need(t !== null, reason);
  return new Date(t).toISOString();
}

/** Drops keys whose value is undefined (same as the reducer's). */
function compact<T extends object>(obj: T): T {
  const out = { ...obj } as unknown as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as T;
}

function listOf(v: unknown, reason: string): unknown[] {
  need(Array.isArray(v), reason);
  return v as unknown[];
}

/** An optional string field: absent stays absent, anything but a string fails the row. */
function optionalText(v: unknown, reason: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  need(typeof v === 'string', reason);
  return v;
}

/** An optional id field (absent or empty = absent); anything but a valid id fails the row. */
function optionalId(v: unknown, reason: string): ID | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  need(isId(v), reason);
  return v;
}

const GROUP_TYPES: GroupType[] = ['trip', 'home', 'couple', 'other'];
const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);
const CHARGE_KINDS: ChargeKind[] = ['tax', 'service', 'tip', 'discount', 'roundoff', 'other'];
const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'upi', 'bank', 'other'];
const FREQUENCIES: RecurrenceFrequency[] = ['weekly', 'fortnightly', 'monthly', 'yearly'];
// A Record, so adding an ActivityType without listing it here is a type error.
const KNOWN_ACTIVITY: Record<ActivityType, true> = {
  expense_added: true,
  expense_updated: true,
  expense_deleted: true,
  expense_restored: true,
  payment_added: true,
  payment_deleted: true,
  group_created: true,
  group_updated: true,
  group_deleted: true,
  member_added: true,
  member_removed: true,
  friend_added: true,
  friend_updated: true,
  friend_removed: true,
  settings_updated: true,
  comment_added: true,
};
const ACTIVITY_TYPES = Object.keys(KNOWN_ACTIVITY) as ActivityType[];

// ---------- Incoming: one row each (server ids; the caller rewrites them) ----------

function readPersonList(v: unknown, what: string): ID[] {
  const list = listOf(v, `${what} missing`);
  need(list.every(isPersonId), `bad person id in ${what}`);
  return list.slice() as ID[];
}

function readPersonRecord(v: unknown, what: string, isValue: (n: unknown) => n is number): Record<ID, number> {
  need(isRecord(v), `${what} missing`);
  const out: Record<ID, number> = {};
  for (const id of Object.keys(v)) {
    const value = v[id];
    need(isPersonId(id) && isValue(value), `bad entry in ${what}`);
    out[id] = value as number;
  }
  return out;
}

function readItem(v: unknown): BillItem {
  need(isRecord(v) && isText(v.id) && typeof v.name === 'string', 'bad bill item');
  need(isFiniteNumber(v.quantity) && isMinor(v.amount), 'bad bill item');
  return { id: v.id, name: v.name, quantity: v.quantity, amount: v.amount, shares: readPersonRecord(v.shares, 'item shares', isFiniteNumber) };
}

function readCharge(v: unknown): BillCharge {
  need(isRecord(v) && isText(v.id) && isOneOf(v.kind, CHARGE_KINDS) && typeof v.label === 'string', 'bad bill charge');
  need(isMinor(v.amount) && (v.allocation === 'proportional' || v.allocation === 'equal'), 'bad bill charge');
  return { id: v.id, kind: v.kind, label: v.label, amount: v.amount, allocation: v.allocation };
}

function readBill(v: unknown): ItemizedBill {
  need(isRecord(v), 'bill missing');
  const bill: ItemizedBill = {
    items: listOf(v.items, 'bill items missing').map(readItem),
    charges: listOf(v.charges, 'bill charges missing').map(readCharge),
  };
  bill.merchant = optionalText(v.merchant, 'bad merchant');
  if (v.scanned !== undefined && v.scanned !== null) {
    need(typeof v.scanned === 'boolean', 'bad scanned flag');
    bill.scanned = v.scanned;
  }
  if (v.printedTotal !== undefined && v.printedTotal !== null) {
    need(isMinor(v.printedTotal), 'bad printed total');
    bill.printedTotal = v.printedTotal;
  }
  return compact(bill);
}

function readSplit(v: unknown): SplitInput {
  need(isRecord(v), 'split missing');
  switch (v.method) {
    case 'equal':
      return { method: 'equal', participantIds: readPersonList(v.participantIds, 'participants') };
    case 'exact':
      return { method: 'exact', amounts: readPersonRecord(v.amounts, 'amounts', isMinor) };
    case 'percent':
      return { method: 'percent', percents: readPersonRecord(v.percents, 'percents', isFiniteNumber) };
    case 'shares':
      return { method: 'shares', shares: readPersonRecord(v.shares, 'shares', isFiniteNumber) };
    case 'adjustment':
      return {
        method: 'adjustment',
        participantIds: readPersonList(v.participantIds, 'participants'),
        adjustments: readPersonRecord(v.adjustments, 'adjustments', isMinor),
      };
    case 'itemized':
      return { method: 'itemized', bill: readBill(v.bill) };
    default:
      throw invalid('unknown split method');
  }
}

function readPayers(v: unknown, total: number): MoneyShare[] {
  const list = listOf(v, 'payers missing');
  need(list.length > 0, 'payers missing');
  const payers = list.map((p): MoneyShare => {
    need(isRecord(p) && isPersonId(p.personId) && isMinor(p.amount) && p.amount > 0, 'bad payer');
    return { personId: p.personId, amount: p.amount };
  });
  const ids = payers.map((p) => p.personId);
  need(ids.every((id, i) => ids.indexOf(id) === i), 'payer listed twice');
  need(payers.reduce((sum, p) => sum + p.amount, 0) === total, "payers don't add up to the total");
  return payers;
}

function readRecurrence(v: unknown): Recurrence | undefined {
  if (v === undefined || v === null) return undefined;
  need(isRecord(v) && isOneOf(v.frequency, FREQUENCIES) && isDate(v.nextDate), 'bad recurrence');
  return { frequency: v.frequency, nextDate: v.nextDate };
}

/** owed is recomputed from the split; the sender's copy is ignored. */
function readExpense(row: DataRow, myMemberId: ID): Expense {
  const d = row.data;
  need(isRecord(d), 'data is not an object');
  need(isText(d.description), 'description missing');
  need(isOneOf(d.category, CATEGORY_IDS), 'unknown category');
  need(isCurrency(d.currency), 'bad currency');
  need(isMinor(d.total) && d.total > 0, 'total is not a positive whole amount');
  need(isDate(d.date), 'bad date');
  need(isPersonId(d.createdBy), 'bad createdBy');
  need(isTimestamp(d.createdAt) && isTimestamp(d.updatedAt), 'bad timestamps');
  const recurringParentId = optionalId(d.recurringParentId, 'bad recurringParentId');
  const server: Expense = compact({
    id: row.id,
    groupId: row.group_id,
    description: d.description,
    category: d.category,
    currency: d.currency,
    total: d.total,
    date: d.date,
    notes: optionalText(d.notes, 'bad notes'),
    payers: readPayers(d.payers, d.total),
    split: readSplit(d.split),
    owed: [],
    recurrence: readRecurrence(d.recurrence),
    recurringParentId,
    comments: [],
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    deletedAt: columnTime(row.deleted_at, 'bad deleted_at'),
  });
  const local = remapExpense(server, toLocalId(myMemberId));
  const result = computeOwed(local.total, local.split, local.currency);
  need(result.errors.length === 0, `bad split: ${result.errors[0]}`);
  const owedTotal = result.owed.reduce((sum, o) => sum + o.amount, 0);
  need(result.owed.length > 0 && owedTotal === local.total, "the split doesn't add up to the total");
  return { ...local, owed: result.owed };
}

function readPayment(row: DataRow, myMemberId: ID): Payment {
  const d = row.data;
  need(isRecord(d), 'data is not an object');
  need(isPersonId(d.fromId) && isPersonId(d.toId) && d.fromId !== d.toId, 'bad payer or payee');
  need(isMinor(d.amount) && d.amount > 0, 'amount is not a positive whole amount');
  need(isCurrency(d.currency), 'bad currency');
  need(isDate(d.date), 'bad date');
  need(isOneOf(d.method, PAYMENT_METHODS), 'unknown payment method');
  need(isTimestamp(d.createdAt), 'bad createdAt');
  const server: Payment = compact({
    id: row.id,
    groupId: row.group_id,
    fromId: d.fromId,
    toId: d.toId,
    amount: d.amount,
    currency: d.currency,
    date: d.date,
    note: optionalText(d.note, 'bad note'),
    method: d.method,
    createdAt: d.createdAt,
    deletedAt: columnTime(row.deleted_at, 'bad deleted_at'),
  });
  return remapPayment(server, toLocalId(myMemberId));
}

function readComment(row: CommentRow, myMemberId: ID): { expenseId: ID; comment: Comment } {
  need(row.deleted_at === null || row.deleted_at === undefined, 'deleted');
  need(isId(row.expense_id), 'bad expense id');
  const d = row.data;
  need(isRecord(d) && isPersonId(d.authorId), 'bad author');
  need(isText(d.text), 'text missing');
  need(isTimestamp(d.createdAt), 'bad createdAt');
  const comment: Comment = { id: row.id, authorId: d.authorId, text: d.text, createdAt: d.createdAt };
  return { expenseId: row.expense_id, comment: remapComment(comment, toLocalId(myMemberId)) };
}

/** The summary stays neutral; the reducer re-words it for this phone (§6). */
function readActivity(row: ActivityRow, myMemberId: ID): Activity {
  const d = row.data;
  need(isRecord(d), 'data is not an object');
  need(isOneOf(d.type, ACTIVITY_TYPES), 'unknown activity type');
  need(isTimestamp(d.at), 'bad time');
  need(isPersonId(d.actorId), 'bad actor');
  need(typeof d.summary === 'string', 'summary missing');
  need(d.personId === undefined || d.personId === null || isPersonId(d.personId), 'bad person id');
  need(d.amount === undefined || d.amount === null || isMinor(d.amount), 'bad amount');
  need(d.currency === undefined || d.currency === null || isCurrency(d.currency), 'bad currency');
  const server: Activity = compact({
    id: row.id,
    type: d.type,
    at: d.at,
    actorId: d.actorId,
    groupId: row.group_id,
    expenseId: optionalId(d.expenseId, 'bad expense id'),
    paymentId: optionalId(d.paymentId, 'bad payment id'),
    personId: d.personId ?? undefined,
    summary: d.summary,
    amount: d.amount ?? undefined,
    currency: d.currency ?? undefined,
  });
  return remapActivity(server, toLocalId(myMemberId));
}

function readGroup(row: GroupRow, memberIds: ID[], existing: Group | undefined): Group {
  need(isText(row.name), 'name missing');
  need(isCurrency(row.default_currency), 'bad currency');
  need(typeof row.simplify_debts === 'boolean' && typeof row.archived === 'boolean', 'bad flags');
  const createdAt = existing ? existing.createdAt : columnTime(row.created_at, 'bad created_at');
  need(createdAt, 'bad created_at');
  return compact({
    id: row.id,
    name: row.name,
    type: isOneOf(row.type, GROUP_TYPES) ? row.type : 'other',
    emoji: isText(row.emoji) ? row.emoji : '👥',
    memberIds,
    simplifyDebts: row.simplify_debts,
    defaultCurrency: row.default_currency,
    createdAt,
    archived: row.archived ? true : undefined,
  });
}

/** Same colour on every phone for a member who has none. */
function paletteColor(id: ID): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
}

// ---------- Incoming: a whole batch ----------

export type RowKind = 'group' | 'member' | 'expense' | 'payment' | 'comment' | 'activity';

export interface SkippedRow {
  kind: RowKind;
  id: ID;
  reason: string;
}

export interface ConvertedBatch {
  local: LocalBatch;
  /** Per shared group seen in the batch; merge with `{ ...info, ...groupInfo[id] }` (members are already merged). */
  groupInfo: Record<ID, Partial<SharedGroupInfo>>;
  skipped: SkippedRow[];
}

interface GroupTouch {
  newest: number | null;
  members: Record<ID, SharedMemberInfo> | null;
  /** Local ids of this group's member rows in the batch. */
  memberIds: ID[];
  joinCode?: string | null;
  joinEnabled?: boolean;
}

/**
 * Well-formed rows only, one per key: the newest wins, because a pull and a live event can
 * deliver the same row twice.
 */
function distinctRows<T>(
  list: unknown,
  kind: RowKind,
  groupKey: string,
  keyOf: (row: T) => string,
  stampOf: (row: T) => unknown,
  skipped: SkippedRow[],
): T[] {
  const byKey = new Map<string, T>();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isRecord(raw) || !isId(raw.id) || !isId(raw[groupKey])) {
      skipped.push({ kind, id: isRecord(raw) && typeof raw.id === 'string' ? raw.id : '', reason: 'malformed row' });
      continue;
    }
    const row = raw as unknown as T;
    const key = keyOf(row);
    const prev = byKey.get(key);
    if (!prev || (timeOf(stampOf(row)) ?? 0) >= (timeOf(stampOf(prev)) ?? 0)) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

/**
 * Server rows → what the reducer applies (sync/applyRemote), with ids rewritten to this phone.
 * Rows of groups that are not shared here are skipped, as is any row that fails validation
 * (with a reason). groupInfo carries member status, join code and the new cursor per group.
 */
export function batchToLocal(batch: RemoteBatch, sync: SyncState, state: AppState): ConvertedBatch {
  const local: LocalBatch = { people: [], groups: [], deletedGroupIds: [], expenses: [], payments: [], comments: [], activity: [] };
  const skipped: SkippedRow[] = [];
  const touches: Record<ID, GroupTouch> = {};
  const touchOrder: ID[] = [];
  const b: Partial<RemoteBatch> = isRecord(batch) ? batch : {};

  /** The shared group a row belongs to (moving its cursor), or null with the row skipped. */
  function sharedInfo(kind: RowKind, id: ID, groupId: ID, stamp: unknown): SharedGroupInfo | null {
    const info = Object.prototype.hasOwnProperty.call(sync.groups, groupId) ? sync.groups[groupId] : undefined;
    if (!info) {
      skipped.push({ kind, id, reason: 'not a shared group on this phone' });
      return null;
    }
    let touch = touches[groupId];
    if (!touch) {
      touch = touches[groupId] = { newest: null, members: null, memberIds: [] };
      touchOrder.push(groupId);
    }
    const t = timeOf(stamp);
    if (t !== null && (touch.newest === null || t > touch.newest)) touch.newest = t;
    return info;
  }

  function attempt<T>(kind: RowKind, id: ID, read: () => T): T | null {
    try {
      return read();
    } catch (error) {
      const reason = error instanceof Error && error.name === INVALID ? error.message : 'could not be read';
      skipped.push({ kind, id, reason });
      return null;
    }
  }

  // Members → people (never yourself) and member status.
  const people = new Map<ID, { person: Pick<Person, 'id' | 'name' | 'color'>; time: number }>();
  const memberRows = distinctRows<MemberRow>(b.members, 'member', 'group_id', (r) => `${r.group_id}\u0000${r.id}`, (r) => r.updated_at, skipped);
  for (const row of memberRows) {
    const info = sharedInfo('member', row.id, row.group_id, row.updated_at);
    if (!info) continue;
    const member = attempt('member', row.id, () => {
      need(isPersonId(row.id), 'bad member id');
      need(isText(row.name), 'name missing');
      need(row.user_id === null || row.user_id === undefined || typeof row.user_id === 'string', 'bad user id');
      const status: SharedMemberInfo = { userId: row.user_id ?? null, leftAt: columnTime(row.left_at, 'bad left_at') ?? null };
      return status;
    });
    if (!member) continue;
    const touch = touches[row.group_id];
    touch.members = { ...touch.members, [row.id]: member };
    const localId = toLocalId(info.myMemberId)(row.id);
    if (touch.memberIds.indexOf(localId) < 0) touch.memberIds.push(localId);
    if (localId === ME_ID) continue;
    const existing = state.people[localId];
    const color = isColor(row.color) ? row.color : existing ? existing.color : paletteColor(localId);
    const time = timeOf(row.updated_at) ?? 0;
    const seen = people.get(localId);
    if (!seen || time >= seen.time) people.set(localId, { person: { id: localId, name: row.name, color }, time });
  }
  people.forEach((p) => local.people.push(p.person));

  const memberIdsFor = (groupId: ID, info: SharedGroupInfo): ID[] => {
    const toLocal = toLocalId(info.myMemberId);
    const ids: ID[] = [ME_ID];
    const add = (id: ID): void => {
      if (ids.indexOf(id) < 0) ids.push(id);
    };
    const existing = state.groups[groupId];
    if (existing) existing.memberIds.forEach(add);
    Object.keys(info.members || {}).forEach((id) => add(toLocal(id)));
    touches[groupId].memberIds.forEach(add);
    return ids;
  };

  // Groups. Members who left stay members: old expenses still name them.
  const groupRows = distinctRows<GroupRow>(b.groups, 'group', 'id', (r) => r.id, (r) => r.updated_at, skipped);
  const fromRows = new Set<ID>();
  for (const row of groupRows) {
    const info = sharedInfo('group', row.id, row.id, row.updated_at);
    if (!info) continue;
    const touch = touches[row.id];
    if (row.join_code === null || typeof row.join_code === 'string') touch.joinCode = row.join_code;
    if (typeof row.join_enabled === 'boolean') touch.joinEnabled = row.join_enabled;
    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      fromRows.add(row.id);
      if (local.deletedGroupIds.indexOf(row.id) < 0) local.deletedGroupIds.push(row.id);
      continue;
    }
    const group = attempt('group', row.id, () => readGroup(row, memberIdsFor(row.id, info), state.groups[row.id]));
    if (group) {
      fromRows.add(row.id);
      local.groups.push(group);
    }
  }
  // A join only adds a member row, so a known group still has to learn its new members.
  for (const groupId of touchOrder) {
    const existing = state.groups[groupId];
    if (fromRows.has(groupId) || !existing || touches[groupId].memberIds.length === 0) continue;
    const memberIds = memberIdsFor(groupId, sync.groups[groupId]);
    const changed = memberIds.length !== existing.memberIds.length || memberIds.some((id, i) => id !== existing.memberIds[i]);
    if (changed) local.groups.push({ ...existing, memberIds });
  }

  for (const row of distinctRows<DataRow>(b.expenses, 'expense', 'group_id', (r) => r.id, (r) => r.updated_at, skipped)) {
    const info = sharedInfo('expense', row.id, row.group_id, row.updated_at);
    const expense = info && attempt('expense', row.id, () => readExpense(row, info.myMemberId));
    if (expense) local.expenses.push(expense);
  }

  for (const row of distinctRows<DataRow>(b.payments, 'payment', 'group_id', (r) => r.id, (r) => r.updated_at, skipped)) {
    const info = sharedInfo('payment', row.id, row.group_id, row.updated_at);
    const payment = info && attempt('payment', row.id, () => readPayment(row, info.myMemberId));
    if (payment) local.payments.push(payment);
  }

  for (const row of distinctRows<CommentRow>(b.comments, 'comment', 'group_id', (r) => r.id, (r) => r.created_at, skipped)) {
    const info = sharedInfo('comment', row.id, row.group_id, row.created_at);
    const comment = info && attempt('comment', row.id, () => readComment(row, info.myMemberId));
    if (comment) local.comments.push(comment);
  }

  for (const row of distinctRows<ActivityRow>(b.activity, 'activity', 'group_id', (r) => r.id, (r) => r.created_at, skipped)) {
    const info = sharedInfo('activity', row.id, row.group_id, row.created_at);
    const entry = info && attempt('activity', row.id, () => readActivity(row, info.myMemberId));
    if (entry) local.activity.push(entry);
  }

  const groupInfo: Record<ID, Partial<SharedGroupInfo>> = {};
  for (const groupId of touchOrder) {
    const touch = touches[groupId];
    const info = sync.groups[groupId];
    const out: Partial<SharedGroupInfo> = {};
    if (touch.members) out.members = { ...info.members, ...touch.members };
    if (touch.joinCode !== undefined) out.joinCode = touch.joinCode;
    if (touch.joinEnabled !== undefined) out.joinEnabled = touch.joinEnabled;
    if (touch.newest !== null) {
      const old = timeOf(info.cursor);
      out.cursor = old !== null && old >= touch.newest ? info.cursor : new Date(touch.newest).toISOString();
    }
    groupInfo[groupId] = out;
  }

  return { local, groupInfo, skipped };
}
