// Pure helpers behind the group screens (no React, no react-native), unit-tested in
// tests/screens/groupLogic.test.ts.
import { ME_ID } from '../../types';
import type { AppState, CurrencyAmounts, Debt, Expense, Group, ID, ISODate, Minor, Payment, PaymentMethod, Person } from '../../types';
import type { GroupTotals, TimelineEntry } from '../../store/selectors';
import { groupMembers, groupNets, listGroups, myGroupBalance, personName } from '../../store/selectors';
import { expenseImpact } from '../../lib/balances';
import { monthKey, monthLabel } from '../../lib/dates';
import { formatCurrencyAmounts, formatMoney } from '../../lib/money';
import { firstName, negativePart, plural, positivePart } from './components/groupMeta';

// ---------- Groups list ----------

export interface GroupRowData {
  group: Group;
  members: Person[];
  /** + = I'm owed, per currency. */
  balance: CurrencyAmounts;
  /** Has at least one live expense or payment (tells "settled up" from "no expenses yet"). */
  hasActivity: boolean;
}

/** Rows for the Groups tab in listGroups order, split into active and archived groups. */
export function groupListRows(state: AppState): { current: GroupRowData[]; archived: GroupRowData[] } {
  const active = new Set<ID>();
  for (const e of Object.values(state.expenses)) if (!e.deletedAt && e.groupId) active.add(e.groupId);
  for (const p of Object.values(state.payments)) if (!p.deletedAt && p.groupId) active.add(p.groupId);
  const all = listGroups(state, { includeArchived: true }).map((group) => ({
    group,
    members: groupMembers(state, group.id),
    balance: myGroupBalance(state, group.id),
    hasActivity: active.has(group.id),
  }));
  return { current: all.filter((r) => !r.group.archived), archived: all.filter((r) => !!r.group.archived) };
}

// ---------- Timeline ----------

export interface TimelineMonth {
  key: string;
  label: string;
  entries: TimelineEntry[];
}

export function entryDate(entry: TimelineEntry): ISODate {
  return entry.kind === 'expense' ? entry.expense.date : entry.payment.date;
}

export function entryId(entry: TimelineEntry): ID {
  return entry.kind === 'expense' ? entry.expense.id : entry.payment.id;
}

/** Consecutive entries of the same month (entries arrive newest first). */
export function groupByMonth(entries: TimelineEntry[]): TimelineMonth[] {
  const months: TimelineMonth[] = [];
  for (const entry of entries) {
    const key = monthKey(entryDate(entry));
    const last = months[months.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else months.push({ key, label: monthLabel(key), entries: [entry] });
  }
  return months;
}

export type ImpactTone = 'owed' | 'owe' | 'none';

/** Right side of an expense row: 'you lent ₹300.00' / 'you borrowed ₹90.00' / 'not involved'. */
export function expenseRowImpact(e: Expense, personId: ID = ME_ID): { label: string; amount: Minor; tone: ImpactTone } {
  const impact = expenseImpact(e, personId);
  if (impact.paid === 0 && impact.owed === 0) return { label: 'not involved', amount: 0, tone: 'none' };
  if (impact.net > 0) return { label: 'you lent', amount: impact.net, tone: 'owed' };
  if (impact.net < 0) return { label: 'you borrowed', amount: -impact.net, tone: 'owe' };
  return { label: 'no balance', amount: 0, tone: 'none' };
}

/** 'you paid ₹1,460.00' / 'Bhavna paid ₹1,460.00' / '2 people paid ₹1,460.00'. */
export function payerLine(state: AppState, e: Expense): string {
  const total = formatMoney(e.total, e.currency);
  if (e.payers.length === 1) return `${personName(state, e.payers[0].personId, { you: 'you' })} paid ${total}`;
  if (e.payers.length > 1) return `${e.payers.length} people paid ${total}`;
  return total;
}

/** 'Aarav paid you ₹500.00' / 'You paid Bhavna ₹200.00'; without the amount when it is shown beside it. */
export function paymentLine(state: AppState, p: Payment, opts?: { amount?: boolean }): string {
  const who = `${personName(state, p.fromId)} paid ${personName(state, p.toId, { you: 'you' })}`;
  return opts?.amount === false ? who : `${who} ${formatMoney(p.amount, p.currency)}`;
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank transfer',
  other: 'Other',
};

/** 'Cash' / 'UPI · Dinner share'. */
export function paymentDetail(p: Payment): string {
  const method = METHOD_LABELS[p.method] ?? 'Payment';
  return p.note ? `${method} · ${p.note}` : method;
}

// ---------- Balances ----------

export interface MemberNet {
  id: ID;
  person: Person | undefined;
  /** + = gets money back, − = owes; zero currencies omitted. */
  amounts: CurrencyAmounts;
}

/** Every member's net in the group (you first), plus former members who still have a balance. */
export function memberNets(state: AppState, groupId: ID): MemberNet[] {
  const nets = groupNets(state, groupId);
  const ids: ID[] = groupMembers(state, groupId).map((m) => m.id);
  for (const currency of Object.keys(nets)) {
    for (const id of Object.keys(nets[currency])) {
      if (nets[currency][id] !== 0 && ids.indexOf(id) < 0) ids.push(id);
    }
  }
  return ids.map((id) => {
    const amounts: CurrencyAmounts = {};
    for (const currency of Object.keys(nets)) {
      const amount = nets[currency][id] || 0;
      if (amount !== 0) amounts[currency] = amount;
    }
    return { id, person: state.people[id], amounts };
  });
}

/** Friendly text for the Remind button, addressed to the debtor. */
export function reminderMessage(state: AppState, group: Pick<Group, 'name'>, debt: Debt): string {
  const amount = formatMoney(debt.amount, debt.currency);
  const debtor = firstName(personName(state, debt.fromId));
  const owedTo = debt.toId === ME_ID ? 'me' : personName(state, debt.toId);
  return `Hi ${debtor}! Friendly reminder from SplitSnap: you owe ${owedTo} ${amount} for "${group.name}". Settle up when you get a chance. Thanks!`;
}

/** The note under the debts list, depending on the simplify setting and how many payments it saves. */
export function simplifyExplanation(simplify: boolean, pairwiseCount: number, simplifiedCount: number): string {
  const saved = pairwiseCount - simplifiedCount;
  if (simplify) {
    const extra = saved > 0 ? ` Here that saves ${plural(saved, 'payment')}.` : '';
    return `Debts are combined so everyone pays as few people as possible. If Aarav owes Bhavna and Bhavna owes you, Aarav simply pays you. Nobody's total changes.${extra}`;
  }
  const extra = saved > 0 ? ` Simplifying would cut ${plural(pairwiseCount, 'payment')} to ${simplifiedCount}.` : '';
  return `Showing who owes whom from each expense, netted between each pair of people.${extra}`;
}

// ---------- Export and totals ----------

/** CSV columns: you, the other members, then anyone in the records who has since left. */
export function csvPersonIds(group: Pick<Group, 'memberIds'>, expenses: Expense[], payments: Payment[]): ID[] {
  const ids: ID[] = [ME_ID, ...group.memberIds.filter((id) => id !== ME_ID)];
  const include = (id: ID) => {
    if (ids.indexOf(id) < 0) ids.push(id);
  };
  for (const e of expenses) {
    e.payers.forEach((s) => include(s.personId));
    e.owed.forEach((s) => include(s.personId));
  }
  for (const p of payments) {
    include(p.fromId);
    include(p.toId);
  }
  return ids;
}

/** Whole percent of `part` in `whole` (0 when whole is 0). */
export function percentOf(part: Minor, whole: Minor): number {
  return whole > 0 ? Math.round((Math.max(0, part) * 100) / whole) : 0;
}

// ---------- Group editor ----------

/** 'Aarav' matches ' aarav ' (case and extra spaces ignored). */
export function findPersonByName<T extends Pick<Person, 'name'>>(people: T[], name: string): T | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  return people.find((p) => normalizeName(p.name) === key);
}

/** Trimmed, inner runs of spaces collapsed. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeName(name: string): string {
  return cleanName(name).toLowerCase();
}

/** ' Its 2 expenses and 1 payment will be deleted too.' for the delete-group question ('' if none). */
export function deletionNote(expenseCount: number, paymentCount: number): string {
  const parts: string[] = [];
  if (expenseCount > 0) parts.push(plural(expenseCount, 'expense'));
  if (paymentCount > 0) parts.push(plural(paymentCount, 'payment'));
  return parts.length ? ` Its ${parts.join(' and ')} will be deleted too.` : '';
}

/** Short line under a member who can't be removed: 'Owes ₹300.00 · settle up to remove'. */
export function lockedMemberDetail(amounts: CurrencyAmounts): string {
  const owes = formatCurrencyAmounts(negativePart(amounts));
  const owed = formatCurrencyAmounts(positivePart(amounts));
  const parts: string[] = [];
  if (owes) parts.push(`Owes ${owes}`);
  if (owed) parts.push(`${owes ? 'is owed' : 'Is owed'} ${owed}`);
  return parts.length ? `${parts.join(' and ')} · settle up to remove` : 'Settle up to remove';
}

/** 'You paid ₹300.00 more than your share' etc. for the totals summary. */
export function paidVsShare(totals: Pick<GroupTotals, 'currency' | 'myShare' | 'iPaid'>): { text: string; tone: ImpactTone } {
  const { currency, myShare, iPaid } = totals;
  const diff = iPaid - myShare;
  if (diff > 0) return { text: `You paid ${formatMoney(diff, currency)} more than your share`, tone: 'owed' };
  if (diff < 0) return { text: `You paid ${formatMoney(-diff, currency)} less than your share`, tone: 'owe' };
  if (myShare > 0) return { text: 'You paid exactly your share', tone: 'none' };
  return { text: "You're not part of any of these expenses", tone: 'none' };
}
