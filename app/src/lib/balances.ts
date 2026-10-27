// Balances: who owes whom, from expenses and settle-up payments.
// Sign convention everywhere: a positive net means the person is owed money.
import type { CurrencyAmounts, CurrencyCode, Debt, Expense, ID, Minor, MoneyShare, Payment } from '../types';
import { allocate, compareCurrencyCodes } from './money';
import { simplifyDebts } from './simplify';

function isLive(x: { deletedAt?: string }): boolean {
  return !x.deletedAt;
}

function dropZeros<K extends string>(record: Record<K, number>): Record<K, number> {
  const out = {} as Record<K, number>;
  (Object.keys(record) as K[]).forEach((k) => {
    if (record[k] !== 0) out[k] = record[k];
  });
  return out;
}

function addTo(record: Record<string, number>, key: string, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

/** paid − owed per person for one expense (or payment treated as payer=fromId, owed=toId). Zero entries omitted. */
export function expenseNet(e: { payers: MoneyShare[]; owed: MoneyShare[] }): Record<ID, Minor> {
  const net: Record<ID, Minor> = {};
  for (const p of e.payers ?? []) addTo(net, p.personId, p.amount);
  for (const o of e.owed ?? []) addTo(net, o.personId, -o.amount);
  return dropZeros(net);
}

/** { [fromId]: +amount, [toId]: −amount }. */
export function paymentNet(p: Payment): Record<ID, Minor> {
  return expenseNet({ payers: [{ personId: p.fromId, amount: p.amount }], owed: [{ personId: p.toId, amount: p.amount }] });
}

/** Net balance per currency per person over live (non-deleted) expenses and payments. + = is owed money. */
export function computeNets(expenses: Expense[], payments: Payment[]): Record<CurrencyCode, Record<ID, Minor>> {
  const out: Record<CurrencyCode, Record<ID, Minor>> = {};
  const add = (currency: CurrencyCode, net: Record<ID, Minor>) => {
    const bucket = out[currency] ?? (out[currency] = {});
    Object.keys(net).forEach((id) => addTo(bucket, id, net[id]));
  };
  expenses.filter(isLive).forEach((e) => add(e.currency, expenseNet(e)));
  payments.filter(isLive).forEach((p) => add(p.currency, paymentNet(p)));

  const result: Record<CurrencyCode, Record<ID, Minor>> = {};
  Object.keys(out)
    .sort(compareCurrencyCodes)
    .forEach((currency) => {
      const nets = dropZeros(out[currency]);
      if (Object.keys(nets).length > 0) result[currency] = nets;
    });
  return result;
}

function compareDebts(a: Debt, b: Debt): number {
  const c = compareCurrencyCodes(a.currency, b.currency);
  if (c !== 0) return c;
  if (a.amount !== b.amount) return b.amount - a.amount;
  if (a.fromId !== b.fromId) return a.fromId < b.fromId ? -1 : 1;
  if (a.toId !== b.toId) return a.toId < b.toId ? -1 : 1;
  return 0;
}

/** Who owes whom without simplification: each expense's debtors pay its creditors pro rata
 *  (allocate), aggregated per ordered pair and netted (a→b and b→a cancel). Payments included.
 *  Sorted by currency, then largest amount, then ids. */
export function pairwiseDebts(expenses: Expense[], payments: Payment[]): Debt[] {
  // currency → "from\u0001to" → amount owed
  const owedBy: Record<CurrencyCode, Record<string, Minor>> = {};
  const addDebt = (currency: CurrencyCode, fromId: ID, toId: ID, amount: Minor) => {
    if (fromId === toId || amount === 0) return;
    const bucket = owedBy[currency] ?? (owedBy[currency] = {});
    addTo(bucket, `${fromId}\u0001${toId}`, amount);
  };

  for (const e of expenses.filter(isLive)) {
    const net = expenseNet(e);
    const ids = Object.keys(net);
    const creditors = ids.filter((id) => net[id] > 0);
    const debtors = ids.filter((id) => net[id] < 0);
    // Each debtor is split pro rata over what creditors are still owed. Allocating against the
    // remaining amounts (not the original ones) keeps every creditor's total exact as well as
    // every debtor's: rounding each debtor separately could leave a creditor a paisa off.
    const remaining = creditors.map((id) => Math.round(net[id]));
    for (const d of debtors) {
      const left = remaining.reduce((a, b) => a + b, 0);
      if (left <= 0) break;
      const parts = allocate(Math.min(Math.round(-net[d]), left), remaining);
      creditors.forEach((c, i) => {
        remaining[i] -= parts[i];
        addDebt(e.currency, d, c, parts[i]);
      });
    }
  }
  // A payment from → to cancels debt from → to, i.e. it is a debt to → from.
  for (const p of payments.filter(isLive)) addDebt(p.currency, p.toId, p.fromId, p.amount);

  const debts: Debt[] = [];
  Object.keys(owedBy).forEach((currency) => {
    const bucket = owedBy[currency];
    const done = new Set<string>();
    Object.keys(bucket).forEach((key) => {
      const [fromId, toId] = key.split('\u0001');
      const pairKey = fromId < toId ? `${fromId}\u0001${toId}` : `${toId}\u0001${fromId}`;
      if (done.has(pairKey)) return;
      done.add(pairKey);
      const net = bucket[key] - (bucket[`${toId}\u0001${fromId}`] ?? 0);
      if (net > 0) debts.push({ fromId, toId, amount: net, currency });
      else if (net < 0) debts.push({ fromId: toId, toId: fromId, amount: -net, currency });
    });
  });
  return debts.sort(compareDebts);
}

/** simplify=true → simplifyDebts on computeNets per currency; else pairwiseDebts. */
export function debtsFor(expenses: Expense[], payments: Payment[], simplify: boolean): Debt[] {
  if (!simplify) return pairwiseDebts(expenses, payments);
  const nets = computeNets(expenses, payments);
  const debts: Debt[] = [];
  Object.keys(nets)
    .sort(compareCurrencyCodes)
    .forEach((currency) => debts.push(...simplifyDebts(nets[currency], currency)));
  return debts;
}

/** What `other` owes `me` per currency (+ = other owes me, − = I owe other). */
export function balanceBetween(debts: Debt[], me: ID, other: ID): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const d of debts) {
    if (d.fromId === other && d.toId === me) addTo(out, d.currency, d.amount);
    else if (d.fromId === me && d.toId === other) addTo(out, d.currency, -d.amount);
  }
  return dropZeros(out);
}

/** owedToMe and iOwe are positive totals; net = owedToMe − iOwe. Zero currencies omitted. */
export interface BalanceSummary {
  owedToMe: CurrencyAmounts;
  iOwe: CurrencyAmounts;
  net: CurrencyAmounts;
}

export function summarizeFor(debts: Debt[], personId: ID): BalanceSummary {
  const owedToMe: CurrencyAmounts = {};
  const iOwe: CurrencyAmounts = {};
  for (const d of debts) {
    if (d.fromId === d.toId) continue;
    if (d.toId === personId) addTo(owedToMe, d.currency, d.amount);
    else if (d.fromId === personId) addTo(iOwe, d.currency, d.amount);
  }
  return {
    owedToMe: dropZeros(owedToMe),
    iOwe: dropZeros(iOwe),
    net: addAmounts(owedToMe, negateAmounts(iOwe)),
  };
}

/** For list rows: net > 0 → 'you lent ₹300', net < 0 → 'you borrowed ₹90', paid = owed = 0 → 'not involved'. */
export function expenseImpact(e: Expense, personId: ID): { paid: Minor; owed: Minor; net: Minor } {
  let paid = 0;
  let owed = 0;
  for (const p of e.payers ?? []) if (p.personId === personId) paid += p.amount;
  for (const o of e.owed ?? []) if (o.personId === personId) owed += o.amount;
  return { paid, owed, net: paid - owed };
}

/** Sum per currency; zero results are dropped. */
export function addAmounts(a: CurrencyAmounts, b: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  Object.keys(a).forEach((k) => addTo(out, k, a[k]));
  Object.keys(b).forEach((k) => addTo(out, k, b[k]));
  return dropZeros(out);
}

export function negateAmounts(a: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  Object.keys(a).forEach((k) => {
    if (a[k] !== 0) out[k] = -a[k];
  });
  return out;
}

/** True when every amount is zero (or there are none). */
export function isSettled(a: CurrencyAmounts): boolean {
  return Object.keys(a).every((k) => !a[k]);
}
