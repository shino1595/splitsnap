// Shared builders for the store tests: a tiny state with three friends and one group.
import { ME_ID } from '../../app/src/types';
import type { AppState, ExpenseInput, ID, PaymentInput } from '../../app/src/types';
import { appReducer } from '../../app/src/store/reducer';
import type { AppAction } from '../../app/src/store/reducer';
import { blankState } from '../../app/src/store/stateShape';

export const A = 'p_a';
export const B = 'p_b';
export const C = 'p_c';
export const TRIP = 'g_trip';
export const T0 = '2026-10-01T10:00:00.000Z';

let counter = 0;

/** Activity id + timestamp for an action (actor defaults to me inside the reducer). */
export function stamp(at: string = T0, actorId?: ID): { at: string; activityId: string; actorId?: ID } {
  counter += 1;
  return actorId ? { at, activityId: `act_test_${counter}`, actorId } : { at, activityId: `act_test_${counter}` };
}

export function run(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(appReducer, state);
}

/** Me + Aarav (A), Bhavna (B), Chirag (C) and the group 'Trip' with all four. */
export function makeState(): AppState {
  return run(
    blankState('2026-09-01T09:00:00.000Z'),
    { type: 'friend/add', id: A, input: { name: 'Aarav', upiId: 'aarav@okicici' }, ...stamp() },
    { type: 'friend/add', id: B, input: { name: 'Bhavna' }, ...stamp() },
    { type: 'friend/add', id: C, input: { name: 'Chirag' }, ...stamp() },
    {
      type: 'group/create',
      id: TRIP,
      input: { name: 'Trip', type: 'trip', emoji: '✈️', memberIds: [A, B, C], defaultCurrency: 'INR', simplifyDebts: true },
      ...stamp(),
    },
  );
}

/** Equal split among `ids`, paid in full by `payer`. */
export function equalExpense(overrides: Partial<ExpenseInput> & { ids?: ID[]; payer?: ID } = {}): ExpenseInput {
  const ids = overrides.ids || [ME_ID, A, B];
  const total = overrides.total !== undefined ? overrides.total : 30000;
  const input: ExpenseInput = {
    groupId: TRIP,
    description: 'Dinner',
    category: 'food',
    currency: 'INR',
    total,
    date: '2026-10-01',
    payers: [{ personId: overrides.payer || ME_ID, amount: total }],
    split: { method: 'equal', participantIds: ids },
  };
  const rest: Partial<ExpenseInput> & { ids?: ID[]; payer?: ID } = { ...overrides };
  delete rest.ids;
  delete rest.payer;
  return { ...input, ...rest };
}

export function payment(overrides: Partial<PaymentInput> = {}): PaymentInput {
  return {
    groupId: TRIP,
    fromId: A,
    toId: ME_ID,
    amount: 10000,
    currency: 'INR',
    date: '2026-10-02',
    method: 'upi',
    ...overrides,
  };
}
