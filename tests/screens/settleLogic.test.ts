import { ME_ID } from '../../app/src/types';
import type { AppState, PaymentInput } from '../../app/src/types';
import { friendBalance, friendBalanceByGroup, groupDebts } from '../../app/src/store/selectors';
import {
  amountProblem,
  outstandingBetween,
  pairBalanceByScope,
  planSettlement,
  scopeName,
  settleOptions,
  validatePlan,
} from '../../app/src/screens/settle/settleLogic';
import { A, B, C, TRIP, equalExpense, makeState, run, stamp } from '../store/fixtures';

const HOME = 'g_home';
let n = 0;

function withHome(state: AppState): AppState {
  return run(state, {
    type: 'group/create',
    id: HOME,
    input: { name: 'Home', type: 'home', emoji: '🏠', memberIds: [A], defaultCurrency: 'INR', simplifyDebts: false },
    ...stamp(),
  });
}

function addExpense(state: AppState, input: ReturnType<typeof equalExpense>): AppState {
  n += 1;
  return run(state, { type: 'expense/add', id: `e_${n}`, input, ...stamp() });
}

function applyAll(state: AppState, payments: PaymentInput[]): AppState {
  return payments.reduce((s, p) => {
    n += 1;
    return run(s, { type: 'payment/add', id: `pay_${n}`, input: p, ...stamp() });
  }, state);
}

const common = { date: '2026-10-05', method: 'cash' as const };

describe('settleLogic', () => {
  /** Trip: A owes me ₹100 (I paid ₹200 for me + A). Home: I owe A ₹40 (A paid ₹80 for both). */
  function mixedState(): AppState {
    let s = withHome(makeState());
    s = addExpense(s, equalExpense({ ids: [ME_ID, A], total: 20000 }));
    s = addExpense(s, equalExpense({ groupId: HOME, ids: [ME_ID, A], total: 8000, payer: A }));
    return s;
  }

  it('breaks a pair balance down by group', () => {
    const s = mixedState();
    expect(pairBalanceByScope(s, A, ME_ID, 'INR')).toEqual([
      { groupId: HOME, amount: -4000 },
      { groupId: TRIP, amount: 10000 },
    ]);
    expect(outstandingBetween(s, A, ME_ID, 'INR', undefined)).toBe(6000);
    expect(outstandingBetween(s, A, ME_ID, 'INR', TRIP)).toBe(10000);
    expect(outstandingBetween(s, ME_ID, A, 'INR', HOME)).toBe(4000);
    expect(outstandingBetween(s, A, A, 'INR', undefined)).toBe(0);
  });

  it('records a group-scoped payment as one payment', () => {
    const s = mixedState();
    const plan = planSettlement(s, { ...common, fromId: A, toId: ME_ID, amount: 10000, currency: 'INR', groupId: TRIP, note: '  ' });
    expect(plan).toEqual([
      { groupId: TRIP, fromId: A, toId: ME_ID, amount: 10000, currency: 'INR', date: '2026-10-05', method: 'cash' },
    ]);
  });

  it('settles every group when the overall balance is paid exactly', () => {
    const s = mixedState();
    const plan = planSettlement(s, { ...common, fromId: A, toId: ME_ID, amount: 6000, currency: 'INR', groupId: undefined, note: 'Thanks' });
    expect(plan).toHaveLength(2);
    expect(plan).toContainEqual(expect.objectContaining({ groupId: TRIP, fromId: A, toId: ME_ID, amount: 10000, note: 'Thanks' }));
    expect(plan).toContainEqual(expect.objectContaining({ groupId: HOME, fromId: ME_ID, toId: A, amount: 4000 }));
    const after = applyAll(s, plan);
    expect(friendBalance(after, A)).toEqual({});
    expect(friendBalanceByGroup(after, A)).toEqual([]);
  });

  it('pays the largest debts first on a partial payment', () => {
    let s = mixedState();
    s = addExpense(s, equalExpense({ groupId: null, ids: [ME_ID, A], total: 3000 }));
    // A owes me: Trip 100, non-group 15; I owe A 40 in Home.
    const plan = planSettlement(s, { ...common, fromId: A, toId: ME_ID, amount: 10500, currency: 'INR', groupId: undefined });
    expect(plan).toEqual([
      expect.objectContaining({ groupId: TRIP, fromId: A, toId: ME_ID, amount: 10000 }),
      expect.objectContaining({ groupId: null, fromId: A, toId: ME_ID, amount: 500 }),
    ]);
  });

  it('puts an overpayment or a payment without debts in non-group', () => {
    const s = mixedState();
    const over = planSettlement(s, { ...common, fromId: A, toId: ME_ID, amount: 12000, currency: 'INR', groupId: undefined });
    expect(over).toEqual([
      expect.objectContaining({ groupId: TRIP, amount: 10000 }),
      expect.objectContaining({ groupId: null, fromId: A, toId: ME_ID, amount: 2000 }),
    ]);
    const none = planSettlement(s, { ...common, fromId: ME_ID, toId: B, amount: 500, currency: 'INR', groupId: undefined });
    expect(none).toEqual([expect.objectContaining({ groupId: null, fromId: ME_ID, toId: B, amount: 500 })]);
    const usd = planSettlement(s, { ...common, fromId: A, toId: ME_ID, amount: 500, currency: 'USD', groupId: undefined });
    expect(usd).toEqual([expect.objectContaining({ groupId: null, currency: 'USD', amount: 500 })]);
  });

  it('lists my overall balances per person and currency', () => {
    let s = mixedState();
    s = addExpense(s, equalExpense({ ids: [ME_ID, B], total: 1000, currency: 'USD', payer: B }));
    const all = settleOptions(s, {});
    expect(all.others).toEqual([]);
    expect(all.mine.map((o) => [o.fromId, o.toId, o.amount, o.currency, o.groupId])).toEqual([
      [A, ME_ID, 6000, 'INR', undefined],
      [ME_ID, B, 500, 'USD', undefined],
    ]);
    expect(settleOptions(s, { friendId: B }).mine).toHaveLength(1);
    expect(settleOptions(s, { friendId: C }).mine).toEqual([]);
  });

  it('lists a group\'s debts with mine first and other people\'s separately', () => {
    let s = makeState();
    s = addExpense(s, equalExpense({ ids: [ME_ID, A], total: 20000 }));
    s = addExpense(s, equalExpense({ ids: [B, C], total: 6000, payer: B }));
    const opts = settleOptions(s, { groupId: TRIP });
    expect(opts.mine.map((o) => [o.fromId, o.toId, o.amount, o.groupId])).toEqual([[A, ME_ID, 10000, TRIP]]);
    expect(opts.others.map((o) => [o.fromId, o.toId, o.amount])).toEqual([[C, B, 3000]]);
    expect(groupDebts(s, TRIP)).toHaveLength(2);
    expect(settleOptions(s, { groupId: TRIP, friendId: C }).mine).toEqual([]);
    expect(settleOptions(s, { groupId: 'g_missing' })).toEqual({ mine: [], others: [] });
    expect(settleOptions(s, { groupId: null })).toEqual({ mine: [], others: [] });
  });

  it('validates every planned payment without repeating errors', () => {
    const s = makeState();
    const bad: PaymentInput = { groupId: 'g_gone', fromId: A, toId: A, amount: 0, currency: 'INR', date: '2026-10-05', method: 'cash' };
    const errors = validatePlan(s, [bad, { ...bad }]);
    expect(errors).toEqual(['Enter an amount', 'Choose two different people', 'This group no longer exists']);
    expect(validatePlan(s, [{ ...bad, groupId: TRIP, toId: ME_ID, amount: 100 }])).toEqual([]);
  });

  it('explains what is wrong with a typed amount instead of rounding it away', () => {
    expect(amountProblem('', 'INR')?.code).toBe('empty');
    expect(amountProblem('   ', 'INR')?.code).toBe('empty');
    expect(amountProblem('500', 'INR')).toBeNull();
    expect(amountProblem('1,00,000', 'INR')).toBeNull();
    expect(amountProblem('1,390.50', 'INR')).toBeNull();
    expect(amountProblem('12,5', 'EUR')).toBeNull();
    expect(amountProblem('0', 'INR')?.code).toBe('zero');
    expect(amountProblem('0.00', 'INR')?.code).toBe('zero');
    expect(amountProblem('0.005', 'INR')).toEqual({ code: 'precision', message: 'Use at most 2 decimals for INR' });
    expect(amountProblem('0.004', 'INR')?.code).toBe('precision');
    expect(amountProblem('18.5', 'JPY')).toEqual({ code: 'precision', message: 'JPY amounts have no decimals' });
    expect(amountProblem('18,5', 'JPY')?.code).toBe('precision');
    expect(amountProblem('1,800', 'JPY')).toBeNull();
    expect(amountProblem('99999999999999', 'INR')).toEqual({ code: 'too_large', message: 'That amount is too large' });
    expect(amountProblem('1.2.3', 'INR')?.code).toBe('invalid');
  });

  it('names scopes', () => {
    const s = makeState();
    expect(scopeName(s, TRIP)).toBe('Trip');
    expect(scopeName(s, null)).toBe('Non-group expenses');
    expect(scopeName(s, undefined)).toBe('All groups');
    expect(scopeName(s, 'g_gone')).toBe('Deleted group');
  });
});
