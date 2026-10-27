// Demo data shown on first launch and after "Reset demo data". Everything is created
// through the reducer, so the demo obeys the same validation as real input (owed is
// computed by computeOwed, payers and splits must add up). Dates are relative to
// `today` so the demo always looks recent.
import { ME_ID } from '../types';
import type { AppState, ExpenseInput, ID, ISODate, ISODateTime, ItemizedBill, MoneyShare, PaymentInput } from '../types';
import { addDays, addMonths, parseISODate } from '../lib/dates';
import { advance } from '../lib/recurrence';
import { appReducer, buildExpense } from './reducer';
import type { AppAction, FriendInput, GroupInput } from './reducer';
import { blankState } from './stateShape';

export function createEmptyState(): AppState {
  return blankState(new Date().toISOString());
}

export const DEMO_IDS = {
  aarav: 'p_aarav',
  bhavna: 'p_bhavna',
  chirag: 'p_chirag',
  diya: 'p_diya',
  ishaan: 'p_ishaan',
  meera: 'p_meera',
  goa: 'g_goa',
  flat: 'g_flat',
  dinner: 'e_goa_dinner',
  scuba: 'e_goa_scuba',
  insurance: 'e_goa_insurance',
  rent: 'e_flat_rent',
  movie: 'e_movie_diya',
} as const;

const FRIENDS: (FriendInput & { id: ID })[] = [
  { id: DEMO_IDS.aarav, name: 'Aarav', email: 'aarav@example.com', phone: '+91 98200 11111', upiId: 'aarav@okicici' },
  { id: DEMO_IDS.bhavna, name: 'Bhavna', email: 'bhavna@example.com', phone: '+91 98200 22222', upiId: 'bhavna@oksbi' },
  { id: DEMO_IDS.chirag, name: 'Chirag', email: 'chirag@example.com', phone: '+91 98200 33333', upiId: 'chirag@okhdfcbank' },
  { id: DEMO_IDS.diya, name: 'Diya', email: 'diya@example.com', phone: '+91 98200 44444', upiId: 'diya@ybl' },
  { id: DEMO_IDS.ishaan, name: 'Ishaan', email: 'ishaan@example.com', phone: '+91 98200 55555', upiId: 'ishaan@okaxis' },
  { id: DEMO_IDS.meera, name: 'Meera', email: 'meera@example.com', phone: '+91 98200 66666', upiId: 'meera@paytm' },
];

const A = DEMO_IDS.aarav;
const B = DEMO_IDS.bhavna;
const C = DEMO_IDS.chirag;
const D = DEMO_IDS.diya;
const I = DEMO_IDS.ishaan;
const M = DEMO_IDS.meera;

/**
 * The itemized example from the brief (Punjab Grill, ₹1,460.00):
 * 6 Naan → A, B, C, D · Butter Chicken → A, C · Chicken Lababdar → B, C, D · Gulab Jamun → B, D,
 * plus CGST/SGST 2.5% and round-off shared in proportion to what each person ate.
 */
export function demoDinnerBill(): ItemizedBill {
  return {
    merchant: 'Punjab Grill',
    scanned: true,
    printedTotal: 146000,
    items: [
      { id: 'item_naan', name: 'Naan', quantity: 6, amount: 36000, shares: { [A]: 1, [B]: 1, [C]: 1, [D]: 1 } },
      { id: 'item_butter_chicken', name: 'Butter Chicken', quantity: 1, amount: 42000, shares: { [A]: 1, [C]: 1 } },
      { id: 'item_chicken_lababdar', name: 'Chicken Lababdar', quantity: 1, amount: 45000, shares: { [B]: 1, [C]: 1, [D]: 1 } },
      { id: 'item_gulab_jamun', name: 'Gulab Jamun', quantity: 2, amount: 16000, shares: { [B]: 1, [D]: 1 } },
    ],
    charges: [
      { id: 'charge_cgst', kind: 'tax', label: 'CGST 2.5%', amount: 3475, allocation: 'proportional' },
      { id: 'charge_sgst', kind: 'tax', label: 'SGST 2.5%', amount: 3475, allocation: 'proportional' },
      { id: 'charge_roundoff', kind: 'roundoff', label: 'Round Off', amount: 50, allocation: 'proportional' },
    ],
  };
}

export function createDemoState(today: ISODate): AppState {
  /** Local time on `date` as an ISO timestamp. */
  const at = (date: ISODate, hour: number, minute = 0): ISODateTime => {
    const d = parseISODate(date);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const day = (offset: number): ISODate => addDays(today, offset);
  const monthStart = `${today.slice(0, 8)}01`;
  const rentStart = addMonths(monthStart, -2);

  let state = blankState(at(addDays(rentStart, -7), 9));
  let counter = 0;
  const stamp = (when: ISODateTime, actorId: ID = ME_ID) => ({ at: when, activityId: `act_demo_${++counter}`, actorId });
  const run = (action: AppAction): void => {
    state = appReducer(state, action);
  };

  const expense = (id: ID, actorId: ID, when: ISODateTime, input: ExpenseInput): void => {
    const before = state;
    run({ type: 'expense/add', id, input, ...stamp(when, actorId) });
    if (!state.expenses[id]) {
      const { errors } = buildExpense(before, input, { id, at: when, createdBy: actorId });
      throw new Error(`Demo expense "${input.description}" is invalid: ${errors.join('; ')}`);
    }
  };
  const payment = (id: ID, actorId: ID, when: ISODateTime, input: PaymentInput): void => {
    run({ type: 'payment/add', id, input, ...stamp(when, actorId) });
    if (!state.payments[id]) throw new Error(`Demo payment ${id} is invalid`);
  };
  const group = (id: ID, when: ISODateTime, input: GroupInput): void => run({ type: 'group/create', id, input, ...stamp(when) });
  const paidBy = (personId: ID, amount: number): MoneyShare[] => [{ personId, amount }];
  const equal = (participantIds: ID[]) => ({ method: 'equal' as const, participantIds });

  // People
  const joined = at(addDays(rentStart, -7), 9);
  for (const f of FRIENDS) run({ type: 'friend/add', id: f.id, input: f, ...stamp(joined) });

  // Flat 302: monthly rent (recurring) plus utilities, pairwise debts
  group(DEMO_IDS.flat, at(addDays(rentStart, -3), 20), {
    name: 'Flat 302',
    type: 'home',
    emoji: '🏠',
    memberIds: [I, M],
    defaultCurrency: 'INR',
    simplifyDebts: false,
  });
  expense(DEMO_IDS.rent, ME_ID, at(rentStart, 9), {
    groupId: DEMO_IDS.flat,
    description: 'Rent',
    category: 'rent',
    currency: 'INR',
    total: 3600000,
    date: rentStart,
    notes: 'Paid to the landlord by bank transfer',
    payers: paidBy(ME_ID, 3600000),
    split: equal([ME_ID, I, M]),
    recurrence: { frequency: 'monthly', nextDate: advance(rentStart, 'monthly') },
  });
  // Materialise the monthly copies one month at a time so each gets its own timestamp.
  for (let guard = 0; guard < 24; guard++) {
    const rent = state.expenses[DEMO_IDS.rent];
    const due = rent.recurrence ? rent.recurrence.nextDate : '9999-12-31';
    if (due > today) break;
    run({ type: 'recurring/process', today: due, at: at(due, 9), idBase: `e_flat_rent_${due.slice(0, 7)}` });
  }
  const lastRent = addMonths(monthStart, -1);
  payment('pay_flat_ishaan', I, at(addDays(lastRent, 3), 19), {
    groupId: DEMO_IDS.flat,
    fromId: I,
    toId: ME_ID,
    amount: 2400000,
    currency: 'INR',
    date: addDays(lastRent, 3),
    note: 'Rent for two months',
    method: 'bank',
  });
  expense('e_flat_electricity', M, at(day(-18), 21), {
    groupId: DEMO_IDS.flat,
    description: 'Electricity bill',
    category: 'utilities',
    currency: 'INR',
    total: 324075,
    date: day(-18),
    payers: paidBy(M, 324075),
    split: equal([ME_ID, I, M]),
  });
  expense('e_flat_internet', I, at(day(-9), 8, 30), {
    groupId: DEMO_IDS.flat,
    description: 'Airtel broadband',
    category: 'internet',
    currency: 'INR',
    total: 117900,
    date: day(-9),
    payers: paidBy(I, 117900),
    split: equal([ME_ID, I, M]),
  });

  // Goa Trip: simplified debts, one USD expense, one itemized dinner, one multi-payer expense
  group(DEMO_IDS.goa, at(day(-16), 18), {
    name: 'Goa Trip',
    type: 'trip',
    emoji: '🏖️',
    memberIds: [A, B, C, D],
    defaultCurrency: 'INR',
    simplifyDebts: true,
  });
  expense(DEMO_IDS.insurance, ME_ID, at(day(-15), 20), {
    groupId: DEMO_IDS.goa,
    description: 'Travel insurance',
    category: 'travel',
    currency: 'USD',
    total: 9000,
    date: day(-15),
    notes: 'Bought online for all five',
    payers: paidBy(ME_ID, 9000),
    split: equal([ME_ID, A, B, C, D]),
  });
  expense('e_goa_villa', ME_ID, at(day(-14), 10), {
    groupId: DEMO_IDS.goa,
    description: 'Villa in Anjuna (Airbnb)',
    category: 'hotel',
    currency: 'INR',
    total: 2400000,
    date: day(-14),
    payers: paidBy(ME_ID, 2400000),
    split: equal([ME_ID, A, B, C, D]),
  });
  expense('e_goa_taxi', C, at(day(-14), 14), {
    groupId: DEMO_IDS.goa,
    description: 'Taxi from airport',
    category: 'transport',
    currency: 'INR',
    total: 240000,
    date: day(-14),
    payers: paidBy(C, 240000),
    split: equal([ME_ID, A, B, C, D]),
  });
  expense('e_goa_groceries', B, at(day(-13), 12), {
    groupId: DEMO_IDS.goa,
    description: 'Groceries for the villa',
    category: 'groceries',
    currency: 'INR',
    total: 180000,
    date: day(-13),
    payers: paidBy(B, 180000),
    split: { method: 'percent', percents: { [ME_ID]: 20, [A]: 20, [B]: 30, [C]: 15, [D]: 15 } },
  });
  expense(DEMO_IDS.scuba, A, at(day(-12), 18), {
    groupId: DEMO_IDS.goa,
    description: 'Scuba diving at Grande Island',
    category: 'sports',
    currency: 'INR',
    total: 1000000,
    date: day(-12),
    payers: [
      { personId: A, amount: 600000 },
      { personId: C, amount: 400000 },
    ],
    split: equal([ME_ID, A, B, C]),
  });
  expense(DEMO_IDS.dinner, ME_ID, at(day(-12), 22, 30), {
    groupId: DEMO_IDS.goa,
    description: 'Dinner at Punjab Grill',
    category: 'food',
    currency: 'INR',
    total: 146000,
    date: day(-12),
    notes: 'Paid on my card. I had already eaten, so it is split among the four of them.',
    payers: paidBy(ME_ID, 146000),
    split: { method: 'itemized', bill: demoDinnerBill() },
  });
  expense('e_goa_drinks', D, at(day(-11), 23), {
    groupId: DEMO_IDS.goa,
    description: 'Drinks at the beach shack',
    category: 'drinks',
    currency: 'INR',
    total: 315000,
    date: day(-11),
    payers: paidBy(D, 315000),
    split: { method: 'exact', amounts: { [ME_ID]: 70000, [A]: 90000, [B]: 45000, [C]: 60000, [D]: 50000 } },
  });
  run({
    type: 'comment/add',
    expenseId: DEMO_IDS.dinner,
    commentId: 'cmt_demo_1',
    text: 'Thanks for covering this! Will settle up after the trip.',
    ...stamp(at(day(-11), 9), A),
  });
  payment('pay_goa_diya', D, at(day(-3), 9, 30), {
    groupId: DEMO_IDS.goa,
    fromId: D,
    toId: ME_ID,
    amount: 200000,
    currency: 'INR',
    date: day(-3),
    note: 'For the villa',
    method: 'upi',
  });

  // Non-group expense with Diya: overall I now owe her in INR while she owes me in USD.
  expense(DEMO_IDS.movie, D, at(day(-5), 21), {
    groupId: null,
    description: 'Movie and dinner at Phoenix Mall',
    category: 'entertainment',
    currency: 'INR',
    total: 400000,
    date: day(-5),
    payers: paidBy(D, 400000),
    split: equal([ME_ID, D]),
  });

  // The feed starts with the groups and expenses, not "You added Aarav as a friend".
  const activity = state.activity
    .filter((a) => a.type !== 'friend_added')
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return { ...state, activity };
}
