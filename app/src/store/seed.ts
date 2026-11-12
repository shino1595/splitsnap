// Demo data shown on first launch and after "Reset demo data". Everything is created
// through the reducer, so the demo obeys the same validation as real input (owed is
// computed by computeOwed, payers and splits must add up). Dates are relative to
// `today` so the demo always looks recent.
import { ME_ID } from '../types';
import type { AppState, Expense, ExpenseInput, Group, ID, ISODate, ISODateTime, ItemizedBill, MoneyShare, Payment, PaymentInput, Person } from '../types';
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
    theme: 'home',
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
    theme: 'beach',
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

const DEMO_PERSON_IDS: ID[] = [DEMO_IDS.aarav, DEMO_IDS.bhavna, DEMO_IDS.chirag, DEMO_IDS.diya, DEMO_IDS.ishaan, DEMO_IDS.meera];
const DEMO_GROUP_IDS: ID[] = [DEMO_IDS.goa, DEMO_IDS.flat];

/** True while a demo group (Goa Trip or Flat 302) is still in the state. */
export function hasDemoData(state: AppState): boolean {
  return DEMO_GROUP_IDS.some((id) => Object.prototype.hasOwnProperty.call(state.groups, id));
}

/** The demo groups removeDemoData would delete: those still in the state and not in keepGroupIds (shared with others). */
export function removableDemoGroups(state: AppState, keepGroupIds: ID[]): Group[] {
  return DEMO_GROUP_IDS.filter((id) => Object.prototype.hasOwnProperty.call(state.groups, id) && !keepGroupIds.includes(id)).map(
    (id) => state.groups[id],
  );
}

/** Every person an expense names: payers, owed, split, comments and who created it. */
function expensePeople(e: Expense): ID[] {
  const ids: ID[] = [e.createdBy];
  for (const p of e.payers) ids.push(p.personId);
  for (const p of e.owed) ids.push(p.personId);
  for (const c of e.comments) ids.push(c.authorId);
  const split = e.split;
  if (split.method === 'equal') ids.push(...split.participantIds);
  else if (split.method === 'exact') ids.push(...Object.keys(split.amounts));
  else if (split.method === 'percent') ids.push(...Object.keys(split.percents));
  else if (split.method === 'shares') ids.push(...Object.keys(split.shares));
  else if (split.method === 'adjustment') ids.push(...split.participantIds, ...Object.keys(split.adjustments));
  else for (const item of split.bill.items) ids.push(...Object.keys(item.shares));
  return ids;
}

/** True when the list names at least one demo person and nobody else but you. */
function onlyYouAndDemo(ids: ID[]): boolean {
  let demo = false;
  for (const id of ids) {
    if (id === ME_ID) continue;
    if (!DEMO_PERSON_IDS.includes(id)) return false;
    demo = true;
  }
  return demo;
}

/**
 * The state without the demo: demo groups (except ids in keepGroupIds) with their expenses and payments,
 * non-group expenses and payments that involve nobody but you and demo people, and demo people nothing
 * else refers to. Your own groups, friends and entries stay. Activity entries about removed groups,
 * expenses, payments or people go too.
 */
export function removeDemoData(state: AppState, keepGroupIds: ID[]): AppState {
  const has = (record: object, id: ID): boolean => Object.prototype.hasOwnProperty.call(record, id);
  const goneGroups = removableDemoGroups(state, keepGroupIds).map((g) => g.id);

  const expenses: Record<ID, Expense> = {};
  const goneExpenses: ID[] = [];
  for (const e of Object.values(state.expenses)) {
    const remove = e.groupId === null ? onlyYouAndDemo(expensePeople(e)) : goneGroups.includes(e.groupId);
    if (remove) goneExpenses.push(e.id);
    else expenses[e.id] = e;
  }
  const payments: Record<ID, Payment> = {};
  const gonePayments: ID[] = [];
  for (const p of Object.values(state.payments)) {
    const remove = p.groupId === null ? onlyYouAndDemo([p.fromId, p.toId]) : goneGroups.includes(p.groupId);
    if (remove) gonePayments.push(p.id);
    else payments[p.id] = p;
  }
  const groups: Record<ID, Group> = {};
  for (const g of Object.values(state.groups)) if (!goneGroups.includes(g.id)) groups[g.id] = g;

  const used = new Set<ID>();
  for (const g of Object.values(groups)) for (const id of g.memberIds) used.add(id);
  for (const e of Object.values(expenses)) for (const id of expensePeople(e)) used.add(id);
  for (const p of Object.values(payments)) {
    used.add(p.fromId);
    used.add(p.toId);
  }
  const gonePeople = DEMO_PERSON_IDS.filter((id) => id !== ME_ID && has(state.people, id) && !used.has(id));

  if (!goneGroups.length && !goneExpenses.length && !gonePayments.length && !gonePeople.length) return state;

  const people: Record<ID, Person> = {};
  for (const p of Object.values(state.people)) if (!gonePeople.includes(p.id)) people[p.id] = p;
  const activity = state.activity.filter(
    (a) =>
      !(a.groupId && goneGroups.includes(a.groupId)) &&
      !(a.expenseId && goneExpenses.includes(a.expenseId)) &&
      !(a.paymentId && gonePayments.includes(a.paymentId)) &&
      !(a.personId && gonePeople.includes(a.personId)) &&
      !gonePeople.includes(a.actorId),
  );
  return {
    ...state,
    people,
    friendIds: state.friendIds.filter((id) => !gonePeople.includes(id)),
    groups,
    expenses,
    payments,
    activity,
  };
}
