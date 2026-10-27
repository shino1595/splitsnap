// Read-only queries over AppState. Pure functions; screens wrap them in useMemo.
import { ME_ID } from '../types';
import type {
  AppState,
  CategoryId,
  CurrencyAmounts,
  CurrencyCode,
  Debt,
  Expense,
  Group,
  ID,
  Minor,
  Payment,
  Person,
} from '../types';
import { addAmounts, balanceBetween, computeNets, debtsFor, isSettled, pairwiseDebts } from '../lib/balances';
import type { BalanceSummary } from '../lib/balances';
import { formatCurrencyAmounts } from '../lib/money';
import { monthKey } from '../lib/dates';

// ---------- People ----------

export function personName(state: AppState, id: ID, opts?: { you?: 'You' | 'you' | false }): string {
  const you = opts && opts.you !== undefined ? opts.you : 'You';
  if (id === ME_ID && you !== false) return you;
  const person = state.people[id];
  if (person) return person.name;
  return id === ME_ID ? 'You' : 'Unknown';
}

export function getPerson(state: AppState, id: ID): Person | undefined {
  return state.people[id];
}

const byName = (a: Person, b: Person): number => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export function listFriends(state: AppState): Person[] {
  return state.friendIds
    .filter((id) => id !== ME_ID)
    .map((id) => state.people[id])
    .filter((p): p is Person => !!p)
    .sort(byName);
}

// ---------- Groups ----------

/** Latest timestamp touching the group: creation, its expenses/payments, or its activity entries. */
function lastTouched(state: AppState, group: Group): string {
  let latest = group.createdAt;
  for (const a of state.activity) {
    if (a.groupId === group.id && a.at > latest) latest = a.at;
  }
  for (const e of Object.values(state.expenses)) {
    if (e.groupId === group.id && e.updatedAt > latest) latest = e.updatedAt;
  }
  for (const p of Object.values(state.payments)) {
    if (p.groupId === group.id && p.createdAt > latest) latest = p.createdAt;
  }
  return latest;
}

export function listGroups(state: AppState, opts?: { includeArchived?: boolean }): Group[] {
  const includeArchived = !!(opts && opts.includeArchived);
  return Object.values(state.groups)
    .filter((g) => includeArchived || !g.archived)
    .map((g) => ({ g, t: lastTouched(state, g) }))
    .sort((a, b) => (a.t !== b.t ? (a.t < b.t ? 1 : -1) : a.g.name.localeCompare(b.g.name)))
    .map((x) => x.g);
}

export function groupMembers(state: AppState, groupId: ID): Person[] {
  const group = state.groups[groupId];
  if (!group) return [];
  const ids = [ME_ID, ...group.memberIds.filter((id) => id !== ME_ID)];
  return ids.map((id) => state.people[id]).filter((p): p is Person => !!p);
}

export function expenseGroupName(state: AppState, e: { groupId: ID | null }): string {
  if (e.groupId === null) return 'Non-group expenses';
  const group = state.groups[e.groupId];
  return group ? group.name : 'Deleted group';
}

// ---------- Expenses, payments, timelines ----------

type Dated = { id: ID; date: string; createdAt: string };

/** Newest date first, then newest createdAt, then id (for a stable order). */
function newestFirst(a: Dated, b: Dated): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function matchesGroup(groupId: ID | null, filter?: { groupId?: ID | null }): boolean {
  if (!filter || filter.groupId === undefined) return true;
  return groupId === filter.groupId;
}

/** Non-deleted expenses, newest first. groupId null = non-group only; undefined = all. */
export function liveExpenses(state: AppState, filter?: { groupId?: ID | null }): Expense[] {
  return Object.values(state.expenses)
    .filter((e) => !e.deletedAt && matchesGroup(e.groupId, filter))
    .sort(newestFirst);
}

/** Non-deleted payments, newest first. groupId null = non-group only; undefined = all. */
export function livePayments(state: AppState, filter?: { groupId?: ID | null }): Payment[] {
  return Object.values(state.payments)
    .filter((p) => !p.deletedAt && matchesGroup(p.groupId, filter))
    .sort(newestFirst);
}

export type TimelineEntry = { kind: 'expense'; expense: Expense } | { kind: 'payment'; payment: Payment };

function entryKey(entry: TimelineEntry): Dated {
  return entry.kind === 'expense' ? entry.expense : entry.payment;
}

function timeline(expenses: Expense[], payments: Payment[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...expenses.map((expense): TimelineEntry => ({ kind: 'expense', expense })),
    ...payments.map((payment): TimelineEntry => ({ kind: 'payment', payment })),
  ];
  return entries.sort((a, b) => newestFirst(entryKey(a), entryKey(b)));
}

export function expenseInvolves(e: Pick<Expense, 'payers' | 'owed'>, personId: ID): boolean {
  return e.payers.some((p) => p.personId === personId) || e.owed.some((o) => o.personId === personId);
}

export function paymentInvolves(p: Pick<Payment, 'fromId' | 'toId'>, personId: ID): boolean {
  return p.fromId === personId || p.toId === personId;
}

export function groupTimeline(state: AppState, groupId: ID): TimelineEntry[] {
  return timeline(liveExpenses(state, { groupId }), livePayments(state, { groupId }));
}

/** Everything (any group or none) that involves both me and the friend. */
export function friendTimeline(state: AppState, friendId: ID): TimelineEntry[] {
  return timeline(
    liveExpenses(state).filter((e) => expenseInvolves(e, ME_ID) && expenseInvolves(e, friendId)),
    livePayments(state).filter((p) => paymentInvolves(p, ME_ID) && paymentInvolves(p, friendId)),
  );
}

export function nonGroupTimeline(state: AppState): TimelineEntry[] {
  return timeline(liveExpenses(state, { groupId: null }), livePayments(state, { groupId: null }));
}

// ---------- Balances ----------

export function groupDebts(state: AppState, groupId: ID): Debt[] {
  const group = state.groups[groupId];
  if (!group) return [];
  return debtsFor(liveExpenses(state, { groupId }), livePayments(state, { groupId }), group.simplifyDebts);
}

export function nonGroupDebts(state: AppState): Debt[] {
  return pairwiseDebts(liveExpenses(state, { groupId: null }), livePayments(state, { groupId: null }));
}

/** Net balance per currency per person inside one group (+ = is owed money). */
export function groupNets(state: AppState, groupId: ID): Record<CurrencyCode, Record<ID, Minor>> {
  return computeNets(liveExpenses(state, { groupId }), livePayments(state, { groupId }));
}

interface DebtScope {
  groupId: ID | null;
  debts: Debt[];
}

// Debts per group are needed by several selectors for every friend row, so they are
// computed once per state object. States are immutable, so the cache can never go stale.
const scopeCache = new WeakMap<AppState, DebtScope[]>();

/** Debts of every group (archived included; listGroups order) followed by non-group debts. */
function debtScopes(state: AppState): DebtScope[] {
  const cached = scopeCache.get(state);
  if (cached) return cached;
  const scopes: DebtScope[] = listGroups(state, { includeArchived: true }).map((g) => ({
    groupId: g.id,
    debts: groupDebts(state, g.id),
  }));
  scopes.push({ groupId: null, debts: nonGroupDebts(state) });
  scopeCache.set(state, scopes);
  return scopes;
}

/** Sum of signed debts for one person: + = is owed. */
function netFromDebts(debts: Debt[], personId: ID): CurrencyAmounts {
  let net: CurrencyAmounts = {};
  for (const d of debts) {
    if (d.toId === personId) net = addAmounts(net, { [d.currency]: d.amount });
    else if (d.fromId === personId) net = addAmounts(net, { [d.currency]: -d.amount });
  }
  return net;
}

/** + = I'm owed, per currency, inside the group. */
export function myGroupBalance(state: AppState, groupId: ID): CurrencyAmounts {
  return netFromDebts(groupDebts(state, groupId), ME_ID);
}

/** + = friend owes me. Σ over every group's debts plus non-group debts. */
export function friendBalance(state: AppState, friendId: ID): CurrencyAmounts {
  let total: CurrencyAmounts = {};
  for (const scope of debtScopes(state)) {
    total = addAmounts(total, balanceBetween(scope.debts, ME_ID, friendId));
  }
  return total;
}

export function friendBalanceByGroup(state: AppState, friendId: ID): { groupId: ID | null; amounts: CurrencyAmounts }[] {
  const rows: { groupId: ID | null; amounts: CurrencyAmounts }[] = [];
  for (const scope of debtScopes(state)) {
    const amounts = addAmounts({}, balanceBetween(scope.debts, ME_ID, friendId));
    if (!isSettled(amounts)) rows.push({ groupId: scope.groupId, amounts });
  }
  return rows;
}

/** friendBalance for everyone I have a balance with (friends or not), computed in one pass. */
export function balancesWithEveryone(state: AppState): Record<ID, CurrencyAmounts> {
  const result: Record<ID, CurrencyAmounts> = {};
  for (const scope of debtScopes(state)) {
    for (const d of scope.debts) {
      if (d.toId === ME_ID) result[d.fromId] = addAmounts(result[d.fromId] || {}, { [d.currency]: d.amount });
      else if (d.fromId === ME_ID) result[d.toId] = addAmounts(result[d.toId] || {}, { [d.currency]: -d.amount });
    }
  }
  for (const id of Object.keys(result)) {
    if (isSettled(result[id])) delete result[id];
  }
  return result;
}

/**
 * My totals across all groups and non-group expenses. Balances are netted per person
 * first (like Splitwise), so `net` equals Σ friendBalance and owedToMe / iOwe are the
 * sums of the positive / negative per-person balances.
 */
export function overallSummary(state: AppState): BalanceSummary {
  let owedToMe: CurrencyAmounts = {};
  let iOwe: CurrencyAmounts = {};
  let net: CurrencyAmounts = {};
  const perPerson = balancesWithEveryone(state);
  for (const id of Object.keys(perPerson)) {
    const amounts = perPerson[id];
    for (const currency of Object.keys(amounts)) {
      const amount = amounts[currency];
      if (amount > 0) owedToMe = addAmounts(owedToMe, { [currency]: amount });
      else if (amount < 0) iOwe = addAmounts(iOwe, { [currency]: -amount });
    }
    net = addAmounts(net, amounts);
  }
  return { owedToMe, iOwe, net };
}

// ---------- Totals ----------

export interface GroupTotals {
  currency: CurrencyCode;
  totalSpent: Minor;
  myShare: Minor;
  iPaid: Minor;
  byCategory: { category: CategoryId; amount: Minor }[];
  byMonth: { month: string; amount: Minor }[];
  byPayer: { personId: ID; amount: Minor }[];
}

function addTo<K extends string>(map: Map<K, Minor>, key: K, amount: Minor): void {
  map.set(key, (map.get(key) || 0) + amount);
}

function largestFirst<K extends string>(map: Map<K, Minor>): { key: K; amount: Minor }[] {
  return Array.from(map.entries())
    .map(([key, amount]) => ({ key, amount }))
    .sort((a, b) => (a.amount !== b.amount ? b.amount - a.amount : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Spending (payments excluded) per currency used in the group; default currency first. [] when nothing spent. */
export function groupTotals(state: AppState, groupId: ID): GroupTotals[] {
  const group = state.groups[groupId];
  if (!group) return [];
  const byCurrency = new Map<CurrencyCode, Expense[]>();
  for (const e of liveExpenses(state, { groupId })) {
    const list = byCurrency.get(e.currency) || [];
    list.push(e);
    byCurrency.set(e.currency, list);
  }
  const currencies = Array.from(byCurrency.keys()).sort((a, b) => {
    if (a === group.defaultCurrency) return -1;
    if (b === group.defaultCurrency) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return currencies.map((currency) => {
    const expenses = byCurrency.get(currency) || [];
    const categories = new Map<CategoryId, Minor>();
    const months = new Map<string, Minor>();
    const payers = new Map<ID, Minor>();
    let totalSpent = 0;
    let myShare = 0;
    let iPaid = 0;
    for (const e of expenses) {
      totalSpent += e.total;
      addTo(categories, e.category, e.total);
      addTo(months, monthKey(e.date), e.total);
      for (const p of e.payers) {
        addTo(payers, p.personId, p.amount);
        if (p.personId === ME_ID) iPaid += p.amount;
      }
      for (const o of e.owed) {
        if (o.personId === ME_ID) myShare += o.amount;
      }
    }
    return {
      currency,
      totalSpent,
      myShare,
      iPaid,
      byCategory: largestFirst(categories).map((x) => ({ category: x.key, amount: x.amount })),
      byMonth: Array.from(months.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([month, amount]) => ({ month, amount })),
      byPayer: largestFirst(payers).map((x) => ({ personId: x.key, amount: x.amount })),
    };
  });
}

// ---------- Search ----------

function expenseSearchText(state: AppState, e: Expense): string {
  const parts: string[] = [e.description, e.notes || ''];
  if (e.split.method === 'itemized') {
    for (const item of e.split.bill.items) parts.push(item.name);
    if (e.split.bill.merchant) parts.push(e.split.bill.merchant);
  }
  const ids = new Set<ID>([...e.payers.map((p) => p.personId), ...e.owed.map((o) => o.personId)]);
  ids.forEach((id) => {
    parts.push(personName(state, id, { you: false }));
    if (id === ME_ID) parts.push('you');
  });
  return parts.join('\n').toLowerCase();
}

/** Live expenses whose description, notes, item names or people match every word of the query; newest first. */
export function searchExpenses(state: AppState, query: string): Expense[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return liveExpenses(state).filter((e) => {
    const text = expenseSearchText(state, e);
    return terms.every((t) => text.indexOf(t) >= 0);
  });
}

// ---------- Guards for destructive actions ----------

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function positivePart(a: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const c of Object.keys(a)) if (a[c] > 0) out[c] = a[c];
  return out;
}

function negativePartAbs(a: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const c of Object.keys(a)) if (a[c] < 0) out[c] = -a[c];
  return out;
}

/** 'Aarav owes you ₹500.00' / 'you owe Aarav ₹200.00' (both joined with 'and' for mixed currencies). */
function friendBalanceSentence(name: string, amounts: CurrencyAmounts): string {
  const parts: string[] = [];
  const theyOwe = formatCurrencyAmounts(positivePart(amounts), { abs: true });
  const iOwe = formatCurrencyAmounts(negativePartAbs(amounts), { abs: true });
  if (theyOwe) parts.push(`${name} owes you ${theyOwe}`);
  if (iOwe) parts.push(`you owe ${name} ${iOwe}`);
  return parts.join(' and ');
}

export function canRemoveFriend(state: AppState, friendId: ID): GuardResult {
  if (friendId === ME_ID) return { ok: false, reason: "You can't remove yourself." };
  const name = personName(state, friendId);
  if (state.friendIds.indexOf(friendId) < 0) return { ok: false, reason: `${name} isn't in your friends list.` };

  const balance = friendBalance(state, friendId);
  if (!isSettled(balance)) {
    return {
      ok: false,
      reason: `You and ${name} aren't settled up (${friendBalanceSentence(name, balance)}). Settle up before removing ${name}.`,
    };
  }
  const others = new Set<ID>();
  for (const d of nonGroupDebts(state)) {
    if (d.fromId === friendId && d.toId !== ME_ID) others.add(d.toId);
    if (d.toId === friendId && d.fromId !== ME_ID) others.add(d.fromId);
  }
  if (others.size > 0) {
    const names = Array.from(others).map((id) => personName(state, id));
    return { ok: false, reason: `${name} still has unsettled non-group balances with ${joinNames(names)}.` };
  }
  const shared = Object.values(state.groups)
    .filter((g) => g.memberIds.indexOf(friendId) >= 0)
    .map((g) => g.name);
  if (shared.length > 0) {
    const which = shared.length === 1 ? 'that group' : 'those groups';
    return { ok: false, reason: `${name} is in ${joinNames(shared)}. Remove ${name} from ${which} first.` };
  }
  return { ok: true };
}

export function canRemoveGroupMember(state: AppState, groupId: ID, personId: ID): GuardResult {
  const group = state.groups[groupId];
  if (!group) return { ok: false, reason: 'This group no longer exists.' };
  if (personId === ME_ID) return { ok: false, reason: "You can't remove yourself from a group." };
  const name = personName(state, personId);
  if (group.memberIds.indexOf(personId) < 0) return { ok: false, reason: `${name} isn't a member of ${group.name}.` };

  const nets = groupNets(state, groupId);
  const mine: CurrencyAmounts = {};
  for (const currency of Object.keys(nets)) {
    const amount = nets[currency][personId] || 0;
    if (amount !== 0) mine[currency] = amount;
  }
  if (!isSettled(mine)) {
    const parts: string[] = [];
    const owed = formatCurrencyAmounts(positivePart(mine), { abs: true });
    const owes = formatCurrencyAmounts(negativePartAbs(mine), { abs: true });
    if (owes) parts.push(`owes ${owes}`);
    if (owed) parts.push(`is owed ${owed}`);
    return {
      ok: false,
      reason: `${name} ${parts.join(' and ')} in ${group.name}. Settle up before removing ${name}.`,
    };
  }
  return { ok: true };
}

export function canDeleteGroup(state: AppState, groupId: ID): GuardResult {
  const group = state.groups[groupId];
  if (!group) return { ok: false, reason: 'This group no longer exists.' };
  const nets = groupNets(state, groupId);
  let outstanding: CurrencyAmounts = {};
  for (const currency of Object.keys(nets)) {
    for (const id of Object.keys(nets[currency])) {
      const amount = nets[currency][id];
      if (amount > 0) outstanding = addAmounts(outstanding, { [currency]: amount });
    }
  }
  if (!isSettled(outstanding)) {
    return {
      ok: false,
      reason: `Everyone in ${group.name} must be settled up before it can be deleted (${formatCurrencyAmounts(outstanding, { abs: true })} is still owed).`,
    };
  }
  return { ok: true };
}
