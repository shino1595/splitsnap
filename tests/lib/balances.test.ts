import {
  addAmounts,
  balanceBetween,
  computeNets,
  debtsFor,
  expenseImpact,
  expenseNet,
  isSettled,
  negateAmounts,
  pairwiseDebts,
  paymentNet,
  summarizeFor,
} from '../../app/src/lib/balances';
import { makeExpense, makePayment, shares } from './helpers';

/** A paid ₹1,000 for dinner shared equally by A, B, C, D. */
const dinner = () => makeExpense({ payers: shares('A', 100000), owed: shares('A', 25000, 'B', 25000, 'C', 25000, 'D', 25000) });

/** A paid ₹600 and B ₹400 of ₹1,000 shared equally by A, B, C, D. */
const multiPayer = () =>
  makeExpense({ payers: shares('A', 60000, 'B', 40000), owed: shares('A', 25000, 'B', 25000, 'C', 25000, 'D', 25000) });

describe('expenseNet / paymentNet', () => {
  it('is paid minus owed', () => {
    expect(expenseNet(dinner())).toEqual({ A: 75000, B: -25000, C: -25000, D: -25000 });
    expect(expenseNet(multiPayer())).toEqual({ A: 35000, B: 15000, C: -25000, D: -25000 });
  });

  it('omits people who come out even', () => {
    expect(expenseNet({ payers: shares('A', 500), owed: shares('A', 500) })).toEqual({});
  });

  it('treats a payment as from paying to', () => {
    expect(paymentNet(makePayment({ fromId: 'B', toId: 'A', amount: 25000 }))).toEqual({ B: 25000, A: -25000 });
    expect(paymentNet(makePayment({ fromId: 'A', toId: 'A', amount: 100 }))).toEqual({});
  });
});

describe('computeNets', () => {
  it('sums live expenses and payments per currency', () => {
    const nets = computeNets(
      [dinner(), makeExpense({ payers: shares('B', 2000), owed: shares('A', 1000, 'B', 1000), currency: 'USD' })],
      [makePayment({ fromId: 'B', toId: 'A', amount: 25000 })],
    );
    expect(nets).toEqual({
      INR: { A: 50000, C: -25000, D: -25000 },
      USD: { B: 1000, A: -1000 },
    });
  });

  it('ignores deleted expenses and payments', () => {
    const nets = computeNets(
      [dinner(), makeExpense({ payers: shares('C', 5000), owed: shares('A', 5000), deleted: true })],
      [makePayment({ fromId: 'C', toId: 'A', amount: 25000, deleted: true })],
    );
    expect(nets).toEqual({ INR: { A: 75000, B: -25000, C: -25000, D: -25000 } });
  });

  it('drops currencies that net to zero', () => {
    const nets = computeNets(
      [makeExpense({ payers: shares('A', 1000), owed: shares('B', 1000), currency: 'USD' })],
      [makePayment({ fromId: 'B', toId: 'A', amount: 1000, currency: 'USD' })],
    );
    expect(nets).toEqual({});
  });
});

describe('pairwiseDebts', () => {
  it('makes everyone owe the single payer', () => {
    expect(pairwiseDebts([dinner()], [])).toEqual([
      { fromId: 'B', toId: 'A', amount: 25000, currency: 'INR' },
      { fromId: 'C', toId: 'A', amount: 25000, currency: 'INR' },
      { fromId: 'D', toId: 'A', amount: 25000, currency: 'INR' },
    ]);
  });

  it('splits each debtor across multiple payers pro rata', () => {
    expect(pairwiseDebts([multiPayer()], [])).toEqual([
      { fromId: 'C', toId: 'A', amount: 17500, currency: 'INR' },
      { fromId: 'D', toId: 'A', amount: 17500, currency: 'INR' },
      { fromId: 'C', toId: 'B', amount: 7500, currency: 'INR' },
      { fromId: 'D', toId: 'B', amount: 7500, currency: 'INR' },
    ]);
  });

  it('keeps every creditor exact when debtors round the same way', () => {
    // Splitting each ₹0.01 debt 2:1 on its own would send all three paise to A.
    const e = makeExpense({ payers: shares('A', 2, 'B', 1), owed: shares('C', 1, 'D', 1, 'E', 1) });
    expect(pairwiseDebts([e], [])).toEqual([
      { fromId: 'C', toId: 'A', amount: 1, currency: 'INR' },
      { fromId: 'D', toId: 'A', amount: 1, currency: 'INR' },
      { fromId: 'E', toId: 'B', amount: 1, currency: 'INR' },
    ]);
  });

  it('reduces debts with payments', () => {
    const full = pairwiseDebts([dinner()], [makePayment({ fromId: 'C', toId: 'A', amount: 25000 })]);
    expect(full.map((d) => d.fromId)).toEqual(['B', 'D']);
    const partial = pairwiseDebts([dinner()], [makePayment({ fromId: 'C', toId: 'A', amount: 10000 })]);
    expect(partial.find((d) => d.fromId === 'C')).toEqual({ fromId: 'C', toId: 'A', amount: 15000, currency: 'INR' });
    const over = pairwiseDebts([dinner()], [makePayment({ fromId: 'C', toId: 'A', amount: 30000 })]);
    expect(over.find((d) => d.toId === 'C')).toEqual({ fromId: 'A', toId: 'C', amount: 5000, currency: 'INR' });
  });

  it('nets a→b against b→a', () => {
    const e1 = makeExpense({ payers: shares('A', 30000), owed: shares('B', 30000) });
    const e2 = makeExpense({ payers: shares('B', 10000), owed: shares('A', 10000) });
    expect(pairwiseDebts([e1, e2], [])).toEqual([{ fromId: 'B', toId: 'A', amount: 20000, currency: 'INR' }]);
    const e3 = makeExpense({ payers: shares('B', 20000), owed: shares('A', 20000) });
    expect(pairwiseDebts([e1, e2, e3], [])).toEqual([]);
  });

  it('keeps currencies separate', () => {
    const inr = makeExpense({ payers: shares('A', 30000), owed: shares('B', 30000) });
    const usd = makeExpense({ payers: shares('B', 1200), owed: shares('A', 1200), currency: 'USD' });
    expect(pairwiseDebts([usd, inr], [])).toEqual([
      { fromId: 'B', toId: 'A', amount: 30000, currency: 'INR' },
      { fromId: 'A', toId: 'B', amount: 1200, currency: 'USD' },
    ]);
  });

  it('ignores deleted expenses and payments', () => {
    const deleted = makeExpense({ payers: shares('B', 50000), owed: shares('A', 50000), deleted: true });
    const payment = makePayment({ fromId: 'B', toId: 'A', amount: 25000, deleted: true });
    expect(pairwiseDebts([dinner(), deleted], [payment])).toEqual(pairwiseDebts([dinner()], []));
  });

  it('agrees with computeNets', () => {
    const expenses = [dinner(), multiPayer(), makeExpense({ payers: shares('D', 9001), owed: shares('A', 3001, 'B', 3000, 'D', 3000) })];
    const payments = [makePayment({ fromId: 'B', toId: 'D', amount: 777 })];
    const fromDebts: Record<string, number> = {};
    for (const d of pairwiseDebts(expenses, payments)) {
      fromDebts[d.fromId] = (fromDebts[d.fromId] ?? 0) - d.amount;
      fromDebts[d.toId] = (fromDebts[d.toId] ?? 0) + d.amount;
    }
    const nets = computeNets(expenses, payments).INR;
    for (const id of Object.keys(nets)) expect(fromDebts[id] ?? 0).toBe(nets[id]);
  });
});

describe('debtsFor', () => {
  // B owes A ₹100 and C owes B ₹100: simplified, C pays A directly.
  const chain = () => [
    makeExpense({ payers: shares('A', 10000), owed: shares('B', 10000) }),
    makeExpense({ payers: shares('B', 10000), owed: shares('C', 10000) }),
  ];

  it('returns pairwise debts without simplification', () => {
    expect(debtsFor(chain(), [], false)).toHaveLength(2);
  });

  it('simplifies per currency', () => {
    expect(debtsFor(chain(), [], true)).toEqual([{ fromId: 'C', toId: 'A', amount: 10000, currency: 'INR' }]);
    const usd = makeExpense({ payers: shares('A', 500), owed: shares('B', 500), currency: 'USD' });
    expect(debtsFor([...chain(), usd], [], true)).toEqual([
      { fromId: 'C', toId: 'A', amount: 10000, currency: 'INR' },
      { fromId: 'B', toId: 'A', amount: 500, currency: 'USD' },
    ]);
  });
});

describe('balanceBetween / summarizeFor', () => {
  const debts = [
    { fromId: 'B', toId: 'A', amount: 50000, currency: 'INR' },
    { fromId: 'A', toId: 'C', amount: 20000, currency: 'INR' },
    { fromId: 'A', toId: 'B', amount: 1200, currency: 'USD' },
  ];

  it('is positive when the other person owes me', () => {
    expect(balanceBetween(debts, 'A', 'B')).toEqual({ INR: 50000, USD: -1200 });
    expect(balanceBetween(debts, 'B', 'A')).toEqual({ INR: -50000, USD: 1200 });
    expect(balanceBetween(debts, 'A', 'C')).toEqual({ INR: -20000 });
    expect(balanceBetween(debts, 'B', 'C')).toEqual({});
  });

  it('summarizes what I am owed and what I owe', () => {
    expect(summarizeFor(debts, 'A')).toEqual({
      owedToMe: { INR: 50000 },
      iOwe: { INR: 20000, USD: 1200 },
      net: { INR: 30000, USD: -1200 },
    });
    expect(summarizeFor(debts, 'Z')).toEqual({ owedToMe: {}, iOwe: {}, net: {} });
  });
});

describe('expenseImpact', () => {
  it('reports paid, owed and net for a person', () => {
    expect(expenseImpact(dinner(), 'A')).toEqual({ paid: 100000, owed: 25000, net: 75000 });
    expect(expenseImpact(dinner(), 'B')).toEqual({ paid: 0, owed: 25000, net: -25000 });
    expect(expenseImpact(dinner(), 'Z')).toEqual({ paid: 0, owed: 0, net: 0 });
  });
});

describe('currency amount helpers', () => {
  it('adds and drops zeros', () => {
    expect(addAmounts({ INR: 500, USD: 100 }, { INR: -500, EUR: 3 })).toEqual({ USD: 100, EUR: 3 });
  });

  it('negates without -0', () => {
    const n = negateAmounts({ INR: 500, USD: 0 });
    expect(n).toEqual({ INR: -500 });
  });

  it('knows when everything is settled', () => {
    expect(isSettled({})).toBe(true);
    expect(isSettled({ INR: 0 })).toBe(true);
    expect(isSettled({ INR: 0, USD: 1 })).toBe(false);
  });
});
