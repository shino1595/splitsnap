// Pure settle-up helpers (no React): which balances can be settled, and how one real
// transfer is recorded so that every group it touches moves with it, like Splitwise's
// "settle up across all groups".
import { ME_ID } from '../../types';
import type { AppState, CurrencyCode, Debt, ID, ISODate, Minor, PaymentInput, PaymentMethod } from '../../types';
import { balanceBetween } from '../../lib/balances';
import { compareCurrencyCodes, currencyDecimals, parseAmountInput } from '../../lib/money';
import { validatePaymentInput } from '../../store/reducer';
import { balancesWithEveryone, groupDebts, listGroups, nonGroupDebts, personName } from '../../store/selectors';

/** A group id, null for non-group expenses, or undefined for the overall balance across all of them. */
export type SettleScope = ID | null | undefined;

/** One balance the user can tap to settle: `fromId` owes `toId` `amount` (> 0). */
export interface SettleOption {
  key: string;
  fromId: ID;
  toId: ID;
  amount: Minor;
  currency: CurrencyCode;
  groupId: SettleScope;
}

/** What `fromId` owes `toId` inside one group (or non-group); negative = toId owes fromId. */
export interface ScopeAmount {
  groupId: ID | null;
  amount: Minor;
}

interface ScopeDebts {
  groupId: ID | null;
  debts: Debt[];
}

// States are immutable, so debts per state object can be cached safely.
const scopeCache = new WeakMap<AppState, ScopeDebts[]>();

function allScopes(state: AppState): ScopeDebts[] {
  const cached = scopeCache.get(state);
  if (cached) return cached;
  const scopes: ScopeDebts[] = listGroups(state, { includeArchived: true }).map((g) => ({
    groupId: g.id,
    debts: groupDebts(state, g.id),
  }));
  scopes.push({ groupId: null, debts: nonGroupDebts(state) });
  scopeCache.set(state, scopes);
  return scopes;
}

/** Non-zero balances between two people in one currency, per group (most recent first) then non-group. */
export function pairBalanceByScope(state: AppState, fromId: ID, toId: ID, currency: CurrencyCode): ScopeAmount[] {
  const out: ScopeAmount[] = [];
  for (const scope of allScopes(state)) {
    const amount = balanceBetween(scope.debts, toId, fromId)[currency] || 0;
    if (amount !== 0) out.push({ groupId: scope.groupId, amount });
  }
  return out;
}

/** What `fromId` owes `toId` in `currency` within the scope (negative = toId owes fromId). */
export function outstandingBetween(state: AppState, fromId: ID, toId: ID, currency: CurrencyCode, scope: SettleScope): Minor {
  if (!fromId || !toId || fromId === toId) return 0;
  const rows = pairBalanceByScope(state, fromId, toId, currency);
  if (scope === undefined) return rows.reduce((sum, r) => sum + r.amount, 0);
  const row = rows.find((r) => r.groupId === scope);
  return row ? row.amount : 0;
}

function sortOptions(state: AppState, options: SettleOption[]): SettleOption[] {
  const otherOf = (o: SettleOption) => (o.fromId === ME_ID ? o.toId : o.fromId);
  return options.sort((a, b) => {
    const na = personName(state, otherOf(a)).toLowerCase();
    const nb = personName(state, otherOf(b)).toLowerCase();
    if (na !== nb) return na < nb ? -1 : 1;
    const c = compareCurrencyCodes(a.currency, b.currency);
    if (c !== 0) return c;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

function involves(o: { fromId: ID; toId: ID }, id: ID): boolean {
  return o.fromId === id || o.toId === id;
}

/**
 * Balances to pick from on the settle-up screen. A group id or null lists that scope's debts
 * (mine first, then other people's); undefined lists my overall balance with each person.
 * `friendId` keeps only balances involving that person.
 */
export function settleOptions(
  state: AppState,
  args: { groupId?: ID | null; friendId?: ID },
): { mine: SettleOption[]; others: SettleOption[] } {
  const { groupId, friendId } = args;

  if (groupId === undefined) {
    const mine: SettleOption[] = [];
    const balances = balancesWithEveryone(state);
    for (const personId of Object.keys(balances)) {
      if (friendId && personId !== friendId) continue;
      for (const currency of Object.keys(balances[personId])) {
        const amount = balances[personId][currency];
        if (amount === 0) continue;
        const fromId = amount > 0 ? personId : ME_ID;
        const toId = amount > 0 ? ME_ID : personId;
        mine.push({ key: `all:${fromId}:${toId}:${currency}`, fromId, toId, amount: Math.abs(amount), currency, groupId: undefined });
      }
    }
    return { mine: sortOptions(state, mine), others: [] };
  }

  if (groupId !== null && !state.groups[groupId]) return { mine: [], others: [] };
  const debts = groupId === null ? nonGroupDebts(state) : groupDebts(state, groupId);
  const options = debts
    .filter((d) => d.amount > 0 && (!friendId || involves(d, friendId)))
    .map(
      (d): SettleOption => ({
        key: `${groupId ?? 'none'}:${d.fromId}:${d.toId}:${d.currency}`,
        fromId: d.fromId,
        toId: d.toId,
        amount: d.amount,
        currency: d.currency,
        groupId,
      }),
    );
  return {
    mine: sortOptions(state, options.filter((o) => involves(o, ME_ID))),
    others: options.filter((o) => !involves(o, ME_ID)),
  };
}

export interface SettlementArgs {
  fromId: ID;
  toId: ID;
  amount: Minor;
  currency: CurrencyCode;
  groupId: SettleScope;
  date: ISODate;
  method: PaymentMethod;
  note?: string;
}

function pushOrMerge(list: PaymentInput[], p: PaymentInput): void {
  const same = list.find((x) => x.groupId === p.groupId && x.fromId === p.fromId && x.toId === p.toId);
  if (same) same.amount += p.amount;
  else list.push(p);
}

/**
 * The payments that record one transfer. A group id or null gives a single payment there.
 * Undefined (overall) spreads it over the groups where the two have balances: paying exactly
 * the overall balance settles every group (opposite balances get a matching payment the other
 * way); any other amount pays off the largest debts first and puts any excess in non-group.
 */
export function planSettlement(state: AppState, args: SettlementArgs): PaymentInput[] {
  const base = {
    currency: args.currency,
    date: args.date,
    method: args.method,
    ...(args.note && args.note.trim() ? { note: args.note.trim() } : {}),
  };
  const single = (groupId: ID | null): PaymentInput => ({
    ...base,
    groupId,
    fromId: args.fromId,
    toId: args.toId,
    amount: args.amount,
  });

  if (args.groupId !== undefined) return [single(args.groupId)];
  if (!args.fromId || !args.toId || args.fromId === args.toId || args.amount <= 0) return [single(null)];

  const scopes = pairBalanceByScope(state, args.fromId, args.toId, args.currency);
  const total = scopes.reduce((sum, s) => sum + s.amount, 0);

  if (total > 0 && args.amount === total) {
    return scopes.map(
      (s): PaymentInput =>
        s.amount > 0
          ? { ...base, groupId: s.groupId, fromId: args.fromId, toId: args.toId, amount: s.amount }
          : { ...base, groupId: s.groupId, fromId: args.toId, toId: args.fromId, amount: -s.amount },
    );
  }

  const owed = scopes
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.amount > 0)
    .sort((a, b) => (b.amount !== a.amount ? b.amount - a.amount : a.index - b.index));
  const payments: PaymentInput[] = [];
  let remaining = args.amount;
  for (const s of owed) {
    if (remaining <= 0) break;
    const part = Math.min(remaining, s.amount);
    pushOrMerge(payments, { ...base, groupId: s.groupId, fromId: args.fromId, toId: args.toId, amount: part });
    remaining -= part;
  }
  if (remaining > 0) pushOrMerge(payments, { ...single(null), amount: remaining });
  return payments;
}

/** validatePaymentInput over every planned payment, without repeats. */
export function validatePlan(state: AppState, payments: PaymentInput[]): string[] {
  const errors: string[] = [];
  for (const p of payments) {
    for (const e of validatePaymentInput(state, p)) if (errors.indexOf(e) < 0) errors.push(e);
  }
  return errors;
}

export type AmountProblemCode = 'empty' | 'invalid' | 'zero' | 'too_large' | 'precision';

export interface AmountProblem {
  code: AmountProblemCode;
  message: string;
}

/** Digits after the decimal separator, read the same way parseAmountInput reads it. */
function fractionDigits(text: string): number {
  const s = text.replace(/[^0-9.,]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let at = -1;
  if (lastDot >= 0 && lastComma >= 0) at = Math.max(lastDot, lastComma);
  else if (lastDot >= 0) at = lastDot;
  else if (lastComma >= 0 && s.indexOf(',') === lastComma) {
    // A single comma followed by 1–2 digits is a decimal comma ('12,5'); otherwise grouping.
    const after = s.length - lastComma - 1;
    if (after === 1 || after === 2) at = lastComma;
  }
  return at < 0 ? 0 : s.length - at - 1;
}

/**
 * Why a typed payment amount can't be saved, or null when it is fine. Catches what
 * parseAmountInput would otherwise round away silently ('0.005' rupees, '18.5' yen).
 */
export function amountProblem(text: string, currency: CurrencyCode): AmountProblem | null {
  const trimmed = text.trim();
  if (!trimmed) return { code: 'empty', message: 'Enter an amount' };
  const decimals = currencyDecimals(currency);
  const frac = fractionDigits(trimmed);
  const amount = parseAmountInput(trimmed, currency);
  if (amount === null) {
    const wholeDigits = trimmed.replace(/[^0-9]/g, '').length - frac;
    return wholeDigits > 13
      ? { code: 'too_large', message: 'That amount is too large' }
      : { code: 'invalid', message: 'Enter a valid amount, e.g. 250.50' };
  }
  if (frac > decimals) {
    return {
      code: 'precision',
      message: decimals === 0 ? `${currency} amounts have no decimals` : `Use at most ${decimals} decimals for ${currency}`,
    };
  }
  if (amount <= 0) return { code: 'zero', message: 'Enter an amount more than zero' };
  return null;
}

/** 'Goa Trip' / 'Non-group expenses' / 'All groups'. */
export function scopeName(state: AppState, scope: SettleScope): string {
  if (scope === undefined) return 'All groups';
  if (scope === null) return 'Non-group expenses';
  return state.groups[scope] ? state.groups[scope].name : 'Deleted group';
}
