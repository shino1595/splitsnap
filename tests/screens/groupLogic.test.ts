import { ME_ID } from '../../app/src/types';
import type { AppState, Debt, Expense, ExpenseInput, Payment, PaymentInput } from '../../app/src/types';
import { groupTimeline } from '../../app/src/store/selectors';
import {
  cleanName,
  csvPersonIds,
  deletionNote,
  entryId,
  expenseRowImpact,
  findPersonByName,
  groupByMonth,
  groupListRows,
  lockedMemberDetail,
  memberNets,
  paidVsShare,
  payerLine,
  paymentDetail,
  paymentLine,
  percentOf,
  reminderMessage,
  simplifyExplanation,
} from '../../app/src/screens/groups/groupLogic';
import {
  firstName,
  GROUP_EMOJIS,
  GROUP_TYPES,
  groupTypeInfo,
  headerDebtLines,
  meLabel,
  memberCountLabel,
  negativePart,
  plural,
  positivePart,
  slugify,
  sortDebtsForMe,
} from '../../app/src/screens/groups/components/groupMeta';
import { A, B, C, TRIP, equalExpense, makeState, payment, run, stamp } from '../store/fixtures';

let n = 0;

function withExpense(state: AppState, input: ExpenseInput): { state: AppState; expense: Expense } {
  n += 1;
  const id = `ge_${n}`;
  const next = run(state, { type: 'expense/add', id, input, ...stamp() });
  return { state: next, expense: next.expenses[id] };
}

function withPayment(state: AppState, input: PaymentInput): { state: AppState; payment: Payment } {
  n += 1;
  const id = `gp_${n}`;
  const next = run(state, { type: 'payment/add', id, input, ...stamp() });
  return { state: next, payment: next.payments[id] };
}

describe('groupLogic: groups list', () => {
  it('tells groups without expenses apart from settled ones and separates archived groups', () => {
    let s = makeState();
    expect(groupListRows(s).current.map((r) => [r.group.id, r.hasActivity, r.balance])).toEqual([[TRIP, false, {}]]);

    s = withExpense(s, equalExpense({ ids: [ME_ID, A, B], total: 30000 })).state;
    const row = groupListRows(s).current[0];
    expect(row.hasActivity).toBe(true);
    expect(row.balance).toEqual({ INR: 20000 });
    expect(row.members.map((m) => m.id)).toEqual([ME_ID, A, B, C]);

    s = run(s, { type: 'group/update', id: TRIP, patch: { archived: true }, ...stamp() });
    const rows = groupListRows(s);
    expect(rows.current).toHaveLength(0);
    expect(rows.archived.map((r) => r.group.id)).toEqual([TRIP]);
  });
});

describe('groupLogic: timeline', () => {
  it('groups entries by month, newest month first', () => {
    let s = makeState();
    s = withExpense(s, equalExpense({ date: '2026-09-20', description: 'Hotel' })).state;
    s = withExpense(s, equalExpense({ date: '2026-10-05', description: 'Cab' })).state;
    s = withPayment(s, payment({ date: '2026-10-02' })).state;
    const months = groupByMonth(groupTimeline(s, TRIP));
    expect(months.map((m) => [m.key, m.label, m.entries.length])).toEqual([
      ['2026-10', 'October 2026', 2],
      ['2026-09', 'September 2026', 1],
    ]);
    expect(months[0].entries.map((e) => e.kind)).toEqual(['expense', 'payment']);
    expect(groupByMonth([])).toEqual([]);
  });

  it('describes my share of each expense', () => {
    const s = makeState();
    const lent = withExpense(s, equalExpense({ ids: [ME_ID, A, B], total: 30000 })).expense;
    expect(expenseRowImpact(lent)).toEqual({ label: 'you lent', amount: 20000, tone: 'owed' });
    expect(payerLine(s, lent)).toBe('you paid ₹300.00');

    const borrowed = withExpense(s, equalExpense({ ids: [ME_ID, A], total: 30000, payer: A })).expense;
    expect(expenseRowImpact(borrowed)).toEqual({ label: 'you borrowed', amount: 15000, tone: 'owe' });
    expect(payerLine(s, borrowed)).toBe('Aarav paid ₹300.00');

    const others = withExpense(s, equalExpense({ ids: [A, B], payer: B })).expense;
    expect(expenseRowImpact(others)).toEqual({ label: 'not involved', amount: 0, tone: 'none' });

    const mine = withExpense(s, equalExpense({ ids: [ME_ID], total: 5000 })).expense;
    expect(expenseRowImpact(mine).label).toBe('no balance');

    const multi = withExpense(
      s,
      equalExpense({ total: 30000, payers: [{ personId: A, amount: 10000 }, { personId: B, amount: 20000 }] }),
    ).expense;
    expect(payerLine(s, multi)).toBe('2 people paid ₹300.00');
  });

  it('describes payments', () => {
    const s = makeState();
    const received = withPayment(s, payment({ fromId: A, toId: ME_ID, amount: 50000, method: 'cash' })).payment;
    expect(paymentLine(s, received)).toBe('Aarav paid you ₹500.00');
    expect(paymentDetail(received)).toBe('Cash');
    expect(entryId({ kind: 'payment', payment: received })).toBe(received.id);

    const paid = withPayment(s, payment({ fromId: ME_ID, toId: B, amount: 12000, note: 'Cab' })).payment;
    expect(paymentLine(s, paid)).toBe('You paid Bhavna ₹120.00');
    expect(paymentLine(s, paid, { amount: false })).toBe('You paid Bhavna');
    expect(paymentDetail(paid)).toBe('UPI · Cab');
  });
});

describe('groupLogic: balances', () => {
  it("lists every member's net, you first, settled members with no amounts", () => {
    const s = withExpense(makeState(), equalExpense({ ids: [ME_ID, A, B], total: 30000 })).state;
    expect(memberNets(s, TRIP).map((r) => [r.id, r.amounts])).toEqual([
      [ME_ID, { INR: 20000 }],
      [A, { INR: -10000 }],
      [B, { INR: -10000 }],
      [C, {}],
    ]);
    expect(memberNets(s, 'missing')).toEqual([]);
  });

  it('writes a friendly reminder to the person who owes', () => {
    const s = makeState();
    const toMe: Debt = { fromId: A, toId: ME_ID, amount: 10000, currency: 'INR' };
    expect(reminderMessage(s, { name: 'Trip' }, toMe)).toBe(
      'Hi Aarav! Friendly reminder from SplitSnap: you owe me ₹100.00 for "Trip". Settle up when you get a chance. Thanks!',
    );
    const between: Debt = { fromId: B, toId: C, amount: 4550, currency: 'USD' };
    expect(reminderMessage(s, { name: 'Trip' }, between)).toContain('Hi Bhavna! ');
    expect(reminderMessage(s, { name: 'Trip' }, between)).toContain('you owe Chirag $45.50 for "Trip"');
  });

  it('explains debt simplification with the number of payments saved', () => {
    expect(simplifyExplanation(true, 3, 2)).toContain('Here that saves 1 payment.');
    expect(simplifyExplanation(true, 2, 2)).not.toContain('saves');
    expect(simplifyExplanation(false, 3, 2)).toContain('Simplifying would cut 3 payments to 2.');
    expect(simplifyExplanation(false, 1, 1)).not.toContain('Simplifying');
  });
});

describe('groupLogic: export and totals', () => {
  it('orders CSV columns: you, members, then former members found in the records', () => {
    const expense = { payers: [{ personId: 'p_old', amount: 100 }], owed: [{ personId: A, amount: 100 }] } as Expense;
    const pay = { fromId: 'p_gone', toId: ME_ID } as Payment;
    expect(csvPersonIds({ memberIds: [A, ME_ID, B] }, [expense], [pay])).toEqual([ME_ID, A, B, 'p_old', 'p_gone']);
    expect(csvPersonIds({ memberIds: [ME_ID] }, [], [])).toEqual([ME_ID]);
  });

  it('computes whole percentages safely', () => {
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(-5, 100)).toBe(0);
  });

  it('compares what I paid with my share', () => {
    expect(paidVsShare({ currency: 'INR', myShare: 10000, iPaid: 30000 })).toEqual({
      text: 'You paid ₹200.00 more than your share',
      tone: 'owed',
    });
    expect(paidVsShare({ currency: 'INR', myShare: 30000, iPaid: 0 })).toEqual({
      text: 'You paid ₹300.00 less than your share',
      tone: 'owe',
    });
    expect(paidVsShare({ currency: 'INR', myShare: 500, iPaid: 500 }).text).toBe('You paid exactly your share');
    expect(paidVsShare({ currency: 'INR', myShare: 0, iPaid: 0 }).text).toBe("You're not part of any of these expenses");
  });
});

describe('groupMeta', () => {
  it('has a picture and type info for every group type', () => {
    expect(GROUP_TYPES.map((t) => t.value)).toEqual(['trip', 'home', 'couple', 'other']);
    expect(groupTypeInfo('home').label).toBe('Home');
    expect(GROUP_EMOJIS).toHaveLength(24);
    expect(new Set(GROUP_EMOJIS).size).toBe(24);
  });

  it('formats counts, names and file names', () => {
    expect(memberCountLabel(1)).toBe('1 person');
    expect(memberCountLabel(5)).toBe('5 people');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
    expect(plural(1, 'payment')).toBe('1 payment');
    expect(firstName('  Aarav  Shah ')).toBe('Aarav');
    expect(slugify('Goa Trip 🏖️ 2026')).toBe('goa-trip-2026');
    expect(slugify('🏖️')).toBe('group');
  });

  it('splits balances into owed and owing parts', () => {
    expect(positivePart({ INR: 500, USD: -200, EUR: 0 })).toEqual({ INR: 500 });
    expect(negativePart({ INR: 500, USD: -200, EUR: 0 })).toEqual({ USD: 200 });
  });

  it('sorts debts involving me first, then by amount', () => {
    const debts: Debt[] = [
      { fromId: A, toId: B, amount: 90000, currency: 'INR' },
      { fromId: ME_ID, toId: C, amount: 1000, currency: 'INR' },
      { fromId: B, toId: ME_ID, amount: 5000, currency: 'INR' },
    ];
    expect(sortDebtsForMe(debts).map((d) => d.amount)).toEqual([5000, 1000, 90000]);
    expect(debts[0].amount).toBe(90000);
  });

  it('gives each currency and direction a header line before more of the same', () => {
    const debts: Debt[] = sortDebtsForMe([
      { fromId: A, toId: ME_ID, amount: 300000, currency: 'INR' },
      { fromId: B, toId: ME_ID, amount: 200000, currency: 'INR' },
      { fromId: C, toId: ME_ID, amount: 100000, currency: 'INR' },
      { fromId: ME_ID, toId: A, amount: 2800, currency: 'USD' },
    ]);
    expect(headerDebtLines(debts, 3).map((d) => `${d.currency}${d.amount}`)).toEqual(['INR300000', 'INR200000', 'USD2800']);
    expect(headerDebtLines(debts, 10)).toEqual(debts);
    expect(headerDebtLines(debts.slice(0, 3), 2).map((d) => d.amount)).toEqual([300000, 200000]);
  });
});

describe('groupLogic: group editor', () => {
  const people = [
    { id: A, name: 'Aarav' },
    { id: B, name: 'Bhavna  Rao' },
  ];

  it('finds a person by name ignoring case and extra spaces', () => {
    expect(findPersonByName(people, ' aarav ')?.id).toBe(A);
    expect(findPersonByName(people, 'BHAVNA rao')?.id).toBe(B);
    expect(findPersonByName(people, 'Aar')).toBeUndefined();
    expect(findPersonByName(people, '   ')).toBeUndefined();
  });

  it('cleans typed names', () => {
    expect(cleanName('  Zoe   Fernandes \t Rao ')).toBe('Zoe Fernandes Rao');
    expect(cleanName('   ')).toBe('');
  });

  it('explains why a member is locked with their balance', () => {
    expect(lockedMemberDetail({ INR: -335511, USD: -1800 })).toBe('Owes ₹3,355.11 + $18.00 · settle up to remove');
    expect(lockedMemberDetail({ INR: 50000 })).toBe('Is owed ₹500.00 · settle up to remove');
    expect(lockedMemberDetail({ INR: 50000, USD: -100 })).toBe('Owes $1.00 and is owed ₹500.00 · settle up to remove');
    expect(lockedMemberDetail({})).toBe('Settle up to remove');
  });

  it('labels your own row without repeating "you"', () => {
    expect(meLabel('You')).toBe('You');
    expect(meLabel(' you ')).toBe('You');
    expect(meLabel(undefined)).toBe('You');
    expect(meLabel('Sam')).toBe('Sam (you)');
  });
});

describe('groupLogic: delete group question', () => {
  it('counts the expenses and payments that go with the group', () => {
    expect(deletionNote(0, 0)).toBe('');
    expect(deletionNote(1, 0)).toBe(' Its 1 expense will be deleted too.');
    expect(deletionNote(0, 2)).toBe(' Its 2 payments will be deleted too.');
    expect(deletionNote(3, 1)).toBe(' Its 3 expenses and 1 payment will be deleted too.');
  });
});
