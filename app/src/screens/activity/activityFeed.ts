// Pure helpers for the Activity feed (also used by Search and ExpenseDetail): day
// sections, icons per activity type, "what it means for me" lines and tap targets.
// No React / React Native imports so they can be unit-tested in a browser.
import { ME_ID } from '../../types';
import type { Activity, ActivityType, AppState, CurrencyCode, Expense, ID, ISODateTime, Minor, Payment } from '../../types';
import { colors, themed } from '../../theme';
import { expenseImpact } from '../../lib/balances';
import { formatMoney } from '../../lib/money';
import { addDays, formatDate, parseISODate, relativeTime, toISODate } from '../../lib/dates';

// ---------- Days ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local calendar day of a timestamp, '' when it is not a valid date. */
export function localDayOf(at: ISODateTime): string {
  return toISODate(new Date(at));
}

/** 'Today', 'Yesterday', 'Fri, Oct 3' or 'Fri, Oct 3, 2025'; 'Earlier' for an unknown day. */
export function dayLabel(day: string, now: Date = new Date()): string {
  if (!day) return 'Earlier';
  const today = toISODate(now);
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const date = parseISODate(day);
  if (isNaN(date.getTime())) return 'Earlier';
  return `${WEEKDAYS[date.getDay()]}, ${formatDate(day, 'short', now)}`;
}

export interface ActivitySection {
  /** Local day 'YYYY-MM-DD' ('' for entries without a valid timestamp). */
  key: string;
  title: string;
  data: Activity[];
}

/** Groups entries by local day, newest day first; entries keep their order within a day. */
export function groupActivityByDay(activity: Activity[], now: Date = new Date()): ActivitySection[] {
  const byDay = new Map<string, Activity[]>();
  for (const entry of activity) {
    const day = localDayOf(entry.at);
    const list = byDay.get(day);
    if (list) list.push(entry);
    else byDay.set(day, [entry]);
  }
  return Array.from(byDay.keys())
    .sort((a, b) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a < b ? 1 : -1))
    .map((day) => ({ key: day || 'unknown', title: dayLabel(day, now), data: byDay.get(day) || [] }));
}

/** '9:05 AM' in local time, '' for an invalid timestamp. */
export function clockTime(at: ISODateTime): string {
  const t = new Date(at);
  if (isNaN(t.getTime())) return '';
  const h = t.getHours();
  const m = t.getMinutes();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Today: 'just now' / '5 min ago' / '3 hours ago'. Older days (already under a day header): '9:05 AM'. */
export function activityTimeLabel(at: ISODateTime, now: Date = new Date()): string {
  return localDayOf(at) === toISODate(now) ? relativeTime(at, now) : clockTime(at);
}

// ---------- Icons ----------

export interface ActivityVisual {
  icon: string;
  color: string;
  background: string;
}

const VISUALS = themed((colors): Record<ActivityType, ActivityVisual> => {
  const GREEN = { color: colors.primaryDark, background: colors.primarySoft };
  const BLUE = { color: colors.info, background: colors.infoSoft };
  const RED = { color: colors.danger, background: colors.dangerSoft };
  const AMBER = { color: colors.warning, background: colors.warningSoft };
  return {
    expense_added: { icon: 'receipt-outline', ...GREEN },
    expense_updated: { icon: 'create-outline', ...BLUE },
    expense_deleted: { icon: 'trash-outline', ...RED },
    expense_restored: { icon: 'refresh-outline', ...GREEN },
    payment_added: { icon: 'cash-outline', ...GREEN },
    payment_deleted: { icon: 'trash-outline', ...RED },
    group_created: { icon: 'people-outline', ...BLUE },
    group_updated: { icon: 'people-outline', ...BLUE },
    group_deleted: { icon: 'trash-outline', ...RED },
    member_added: { icon: 'person-add-outline', ...BLUE },
    member_removed: { icon: 'person-remove-outline', ...AMBER },
    friend_added: { icon: 'person-add-outline', ...GREEN },
    friend_updated: { icon: 'create-outline', ...BLUE },
    friend_removed: { icon: 'person-remove-outline', ...AMBER },
    settings_updated: { icon: 'settings-outline', ...BLUE },
    comment_added: { icon: 'chatbubble-outline', ...AMBER },
  };
});

export function activityVisual(type: ActivityType): ActivityVisual {
  return VISUALS[type] || { icon: 'pulse-outline', color: colors.info, background: colors.infoSoft };
}

// ---------- What it means for me ----------

export type ImpactTone = 'owed' | 'owe' | 'neutral';

export interface Impact {
  /** e.g. 'You lent ₹300.00', 'You borrowed ₹90.00', 'You are not involved'. */
  text: string;
  /** Short form for a column above the amount: 'you lent', 'you borrowed', 'not involved', … */
  label: string;
  tone: ImpactTone;
  /** Signed effect on my balance (+ = I'm owed more), 0 when none. */
  net: Minor;
  currency: CurrencyCode;
}

function impact(label: string, tone: ImpactTone, net: Minor, currency: CurrencyCode): Impact {
  const sentence = label.charAt(0).toUpperCase() + label.slice(1);
  const text = net !== 0 ? `${sentence} ${formatMoney(Math.abs(net), currency)}` : sentence;
  return { text, label, tone, net, currency };
}

/** My side of an expense: lent (green) / borrowed (orange) / paid my share / not involved. */
export function expenseImpactFor(expense: Expense, personId: ID = ME_ID): Impact {
  const { paid, owed, net } = expenseImpact(expense, personId);
  const currency = expense.currency;
  if (net > 0) return impact('you lent', 'owed', net, currency);
  if (net < 0) return impact('you borrowed', 'owe', net, currency);
  if (paid === 0 && owed === 0) return { ...impact('not involved', 'neutral', 0, currency), text: 'You are not involved' };
  return impact('you paid your share', 'neutral', 0, currency);
}

/** My side of a payment: paying someone raises my balance (green), receiving lowers it (orange). */
export function paymentImpactFor(payment: Payment, personId: ID = ME_ID): Impact {
  const currency = payment.currency;
  if (payment.fromId === personId) return impact('you paid', 'owed', payment.amount, currency);
  if (payment.toId === personId) return impact('you received', 'owe', -payment.amount, currency);
  return { ...impact('not involved', 'neutral', 0, currency), text: 'You are not involved' };
}

/** Grey 'Expense deleted' / 'Payment deleted' line for an older entry whose record was deleted since. */
function deletedSince(kind: 'Expense' | 'Payment', currency: CurrencyCode): Impact {
  return { text: `${kind} deleted`, label: 'deleted', tone: 'neutral', net: 0, currency };
}

/**
 * Impact line for a feed entry whose expense / payment still exists: what it means for me
 * while it is live, 'Expense deleted' / 'Payment deleted' once it has been deleted (except on
 * the delete entry itself, which already says so). Null for comments and missing records.
 */
export function activityImpact(state: AppState, entry: Activity): Impact | null {
  if (entry.type === 'comment_added') return null;
  if (entry.expenseId) {
    const expense = state.expenses[entry.expenseId];
    if (!expense) return null;
    if (!expense.deletedAt) return expenseImpactFor(expense);
    return entry.type === 'expense_deleted' ? null : deletedSince('Expense', expense.currency);
  }
  if (entry.paymentId) {
    const payment = state.payments[entry.paymentId];
    if (!payment) return null;
    if (!payment.deletedAt) return paymentImpactFor(payment);
    return entry.type === 'payment_deleted' ? null : deletedSince('Payment', payment.currency);
  }
  return null;
}

// ---------- Where a tap goes ----------

export type ActivityTarget =
  | { screen: 'ExpenseDetail'; params: { expenseId: ID } }
  | { screen: 'PaymentDetail'; params: { paymentId: ID } }
  | { screen: 'GroupDetail'; params: { groupId: ID } }
  | { screen: 'FriendDetail'; params: { friendId: ID } };

/**
 * Expenses and payments open even when deleted (their detail screens say so, and an
 * expense can be restored). Friend entries open that person (also after removal: their
 * page still shows the shared history). Otherwise the group. Null when nothing is left.
 */
export function activityTarget(state: AppState, entry: Activity): ActivityTarget | null {
  if (entry.expenseId && state.expenses[entry.expenseId]) {
    return { screen: 'ExpenseDetail', params: { expenseId: entry.expenseId } };
  }
  if (entry.paymentId && state.payments[entry.paymentId]) {
    return { screen: 'PaymentDetail', params: { paymentId: entry.paymentId } };
  }
  if (entry.personId && entry.personId !== ME_ID && state.people[entry.personId]) {
    return { screen: 'FriendDetail', params: { friendId: entry.personId } };
  }
  if (entry.groupId && state.groups[entry.groupId]) {
    return { screen: 'GroupDetail', params: { groupId: entry.groupId } };
  }
  return null;
}

// ---------- Text ----------

export interface TextPart {
  text: string;
  emphasis: boolean;
}

/** Splits a summary so quoted names ("Dinner") can be shown in bold. Quotes are kept. */
export function emphasizeQuotes(summary: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /"[^"]+"/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(summary)) !== null) {
    if (match.index > last) parts.push({ text: summary.slice(last, match.index), emphasis: false });
    parts.push({ text: match[0], emphasis: true });
    last = match.index + match[0].length;
  }
  if (last < summary.length) parts.push({ text: summary.slice(last), emphasis: false });
  return parts;
}
