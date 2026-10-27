import { ME_ID } from '../../app/src/types';
import type { AppState, Expense } from '../../app/src/types';
import {
  MAX_ACTIVITY,
  appReducer,
  buildExpense,
  normalizeRecurrence,
  processRecurring,
  validatePaymentInput,
} from '../../app/src/store/reducer';
import { canDeleteGroup, canRemoveFriend, canRemoveGroupMember, myGroupBalance } from '../../app/src/store/selectors';
import { blankState, parsePersistedState, STORAGE_KEY } from '../../app/src/store/stateShape';
import { createDemoState } from '../../app/src/store/seed';
import { A, B, C, TRIP, T0, equalExpense, makeState, payment, run, stamp } from './fixtures';

const T1 = '2026-10-02T10:00:00.000Z';

function owedOf(e: Expense, id: string): number {
  const share = e.owed.find((o) => o.personId === id);
  return share ? share.amount : 0;
}

describe('friends and people', () => {
  it('adds a friend with trimmed fields, a colour and an activity entry', () => {
    const state = run(blankState(T0), {
      type: 'friend/add',
      id: 'p_new',
      input: { name: '  Ishaan ', email: ' ', upiId: ' ishaan@okaxis ' },
      ...stamp(T1),
    });
    const person = state.people.p_new;
    expect(person.name).toBe('Ishaan');
    expect(person.upiId).toBe('ishaan@okaxis');
    expect(person.email).toBeUndefined();
    expect(person.color).toMatch(/^#/);
    expect(person.createdAt).toBe(T1);
    expect(state.friendIds).toEqual(['p_new']);
    expect(state.activity[0].type).toBe('friend_added');
    expect(state.activity[0].summary).toBe('You added Ishaan as a friend.');
  });

  it('updates a person but never blanks the name', () => {
    const state = run(makeState(), { type: 'person/update', id: A, patch: { name: '   ', phone: ' 98200 ' }, ...stamp() });
    expect(state.people[A].name).toBe('Aarav');
    expect(state.people[A].phone).toBe('98200');
    expect(state.people[A].upiId).toBe('aarav@okicici');
  });

  it('refuses to remove a friend who is still in a shared group, then allows it once removed', () => {
    let state = makeState();
    const check = canRemoveFriend(state, C);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Trip');
    expect(run(state, { type: 'friend/remove', id: C, ...stamp() })).toBe(state);

    state = run(state, { type: 'group/removeMember', groupId: TRIP, personId: C, ...stamp() });
    expect(canRemoveFriend(state, C).ok).toBe(true);
    state = run(state, { type: 'friend/remove', id: C, ...stamp() });
    expect(state.friendIds).not.toContain(C);
    expect(state.people[C]).toBeDefined();
  });

  it('logs friend edits, profile edits and removals, but not edits that change nothing', () => {
    const base = makeState();
    expect(run(base, { type: 'person/update', id: A, patch: { name: 'Aarav' }, ...stamp() })).toBe(base);

    let state = run(base, { type: 'person/update', id: A, patch: { name: 'Aarav S' }, ...stamp() });
    expect(state.activity[0].type).toBe('friend_updated');
    expect(state.activity[0].summary).toBe('You renamed Aarav to Aarav S.');
    state = run(state, { type: 'person/update', id: A, patch: { phone: '98200' }, ...stamp() });
    expect(state.activity[0].summary).toBe("You updated Aarav S's details.");
    state = run(state, { type: 'person/update', id: ME_ID, patch: { name: 'Sam' }, ...stamp() });
    expect(state.activity[0].summary).toBe('You updated your profile.');

    state = run(state, { type: 'group/removeMember', groupId: TRIP, personId: C, ...stamp() });
    state = run(state, { type: 'friend/remove', id: C, ...stamp() });
    expect(state.activity[0].type).toBe('friend_removed');
    expect(state.activity[0].summary).toBe('You removed Chirag from your friends.');
  });

  it('adds a removed friend back, once, and logs it', () => {
    let state = run(makeState(), { type: 'group/removeMember', groupId: TRIP, personId: C, ...stamp() });
    state = run(state, { type: 'friend/remove', id: C, ...stamp() });
    const back = run(state, { type: 'friend/restore', id: C, ...stamp() });
    expect(back.friendIds).toContain(C);
    expect(back.activity[0].type).toBe('friend_added');
    expect(back.activity[0].summary).toBe('You added Chirag as a friend.');
    expect(back.activity[0].personId).toBe(C);
    expect(run(back, { type: 'friend/restore', id: C, ...stamp() })).toBe(back);
    expect(run(back, { type: 'friend/restore', id: 'p_unknown', ...stamp() })).toBe(back);
    expect(run(back, { type: 'friend/restore', id: ME_ID, ...stamp() })).toBe(back);
  });

  it('refuses to remove a friend with an unsettled balance and says who owes whom', () => {
    const state = run(
      makeState(),
      { type: 'friend/add', id: 'p_d', input: { name: 'Diya' }, ...stamp() },
      { type: 'expense/add', id: 'e1', input: equalExpense({ groupId: null, ids: [ME_ID, 'p_d'], total: 90000 }), ...stamp() },
    );
    const check = canRemoveFriend(state, 'p_d');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Diya owes you ₹450.00');
  });
});

describe('groups', () => {
  it('creates a group with me first, no duplicates, and adds new members to friends', () => {
    let state = run(blankState(T0), { type: 'friend/add', id: A, input: { name: 'Aarav' }, ...stamp() });
    state = { ...state, people: { ...state.people, p_x: { id: 'p_x', name: 'Xavier', color: '#000000', createdAt: T0 } } };
    state = run(state, {
      type: 'group/create',
      id: 'g1',
      input: { name: ' Goa ', type: 'trip', emoji: '🏖️', memberIds: [A, A, 'p_x', ME_ID, 'p_unknown'], defaultCurrency: 'INR', simplifyDebts: true },
      ...stamp(),
    });
    expect(state.groups.g1.memberIds).toEqual([ME_ID, A, 'p_x']);
    expect(state.groups.g1.name).toBe('Goa');
    expect(state.friendIds).toContain('p_x');
    expect(state.activity[0].summary).toBe('You created the group "Goa".');
    expect(state.activity[0].groupId).toBe('g1');
  });

  it('logs renames and skips no-op updates', () => {
    const state = makeState();
    const renamed = run(state, { type: 'group/update', id: TRIP, patch: { name: 'Goa Trip' }, ...stamp() });
    expect(renamed.groups[TRIP].name).toBe('Goa Trip');
    expect(renamed.activity[0].summary).toBe('You renamed "Trip" to "Goa Trip".');
    expect(run(state, { type: 'group/update', id: TRIP, patch: { name: 'Trip' }, ...stamp() })).toBe(state);
    const archived = run(state, { type: 'group/update', id: TRIP, patch: { archived: true }, ...stamp() });
    expect(archived.activity[0].summary).toBe('You archived "Trip".');
  });

  it('keeps a member with a balance when a memberIds patch tries to drop them', () => {
    const state = run(makeState(), { type: 'expense/add', id: 'e1', input: equalExpense(), ...stamp() });
    const next = run(state, { type: 'group/update', id: TRIP, patch: { memberIds: [ME_ID, B] }, ...stamp() });
    // Aarav owes money so he stays; Chirag is settled so he goes.
    expect(next.groups[TRIP].memberIds).toEqual([ME_ID, A, B]);
  });

  it('adds and removes members with readable activity', () => {
    let state = run(makeState(), { type: 'friend/add', id: 'p_d', input: { name: 'Diya' }, ...stamp() });
    state = run(state, { type: 'group/addMember', groupId: TRIP, personId: 'p_d', ...stamp() });
    expect(state.groups[TRIP].memberIds).toContain('p_d');
    expect(state.activity[0].summary).toBe('You added Diya to Trip.');
    expect(run(state, { type: 'group/addMember', groupId: TRIP, personId: 'p_d', ...stamp() })).toBe(state);
    state = run(state, { type: 'group/removeMember', groupId: TRIP, personId: 'p_d', ...stamp() });
    expect(state.groups[TRIP].memberIds).not.toContain('p_d');
    expect(state.activity[0].summary).toBe('You removed Diya from Trip.');
  });

  it('refuses to remove a member with a balance, or me', () => {
    const state = run(makeState(), { type: 'expense/add', id: 'e1', input: equalExpense(), ...stamp() });
    const check = canRemoveGroupMember(state, TRIP, A);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('Aarav owes ₹100.00 in Trip. Settle up before removing Aarav.');
    expect(run(state, { type: 'group/removeMember', groupId: TRIP, personId: A, ...stamp() })).toBe(state);
    expect(canRemoveGroupMember(state, TRIP, ME_ID).ok).toBe(false);
    expect(canRemoveGroupMember(state, TRIP, C).ok).toBe(true);
  });

  it('refuses to delete an unsettled group; once settled it deletes the group with its expenses and payments', () => {
    let state = run(makeState(), { type: 'expense/add', id: 'e1', input: equalExpense(), ...stamp() });
    const check = canDeleteGroup(state, TRIP);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('₹200.00');
    expect(run(state, { type: 'group/delete', id: TRIP, ...stamp() })).toBe(state);

    state = run(
      state,
      { type: 'payment/add', id: 'pay1', input: payment({ fromId: A, amount: 10000 }), ...stamp() },
      { type: 'payment/add', id: 'pay2', input: payment({ fromId: B, amount: 10000 }), ...stamp() },
    );
    expect(canDeleteGroup(state, TRIP).ok).toBe(true);
    state = run(state, { type: 'group/delete', id: TRIP, ...stamp() });
    expect(state.groups[TRIP]).toBeUndefined();
    expect(state.expenses.e1).toBeUndefined();
    expect(state.payments.pay1).toBeUndefined();
    expect(state.activity[0].summary).toBe('You deleted the group "Trip".');
  });
});

describe('expenses', () => {
  it('saves a valid expense with owed recomputed by computeOwed and logs it', () => {
    const state = run(makeState(), { type: 'expense/add', id: 'e1', input: equalExpense({ total: 10000 }), ...stamp(T1) });
    const e = state.expenses.e1;
    expect(e.owed.reduce((s, o) => s + o.amount, 0)).toBe(10000);
    expect(owedOf(e, ME_ID) + owedOf(e, A) + owedOf(e, B)).toBe(10000);
    expect([owedOf(e, ME_ID), owedOf(e, A), owedOf(e, B)].sort()).toEqual([3333, 3333, 3334]);
    expect(e.createdBy).toBe(ME_ID);
    expect(e.createdAt).toBe(T1);
    expect(e.comments).toEqual([]);
    expect(state.activity[0]).toEqual({
      id: state.activity[0].id,
      type: 'expense_added',
      at: T1,
      actorId: ME_ID,
      groupId: TRIP,
      expenseId: 'e1',
      summary: 'You added "Dinner" in Trip.',
      amount: 10000,
      currency: 'INR',
    });
  });

  it('returns plain-English errors and saves nothing when the input is invalid', () => {
    const state = makeState();
    const blank = buildExpense(state, equalExpense({ description: '  ', total: 0 }), { id: 'x', at: T0, createdBy: ME_ID });
    expect(blank.expense).toBeUndefined();
    expect(blank.errors).toContain('Enter a description');
    expect(blank.errors).toContain('Enter an amount');

    const badPayers = equalExpense({ payers: [{ personId: ME_ID, amount: 20000 }] });
    expect(buildExpense(state, badPayers, { id: 'x', at: T0, createdBy: ME_ID }).errors.length).toBeGreaterThan(0);
    expect(run(state, { type: 'expense/add', id: 'x', input: badPayers, ...stamp() })).toBe(state);

    const badSplit = equalExpense({ split: { method: 'exact', amounts: { [ME_ID]: 10000, [A]: 16000 } } });
    expect(buildExpense(state, badSplit, { id: 'x', at: T0, createdBy: ME_ID }).errors).toContain('₹40.00 left to assign');

    const noGroup = equalExpense({ groupId: 'g_missing' });
    expect(buildExpense(state, noGroup, { id: 'x', at: T0, createdBy: ME_ID }).errors).toContain('This group no longer exists');
  });

  it('accepts multiple payers whose amounts add up', () => {
    const input = equalExpense({
      total: 9000,
      payers: [
        { personId: A, amount: 6000 },
        { personId: C, amount: 3000 },
      ],
      ids: [ME_ID, A, B, C],
    });
    const state = run(makeState(), { type: 'expense/add', id: 'e1', input, ...stamp() });
    expect(state.expenses.e1.payers).toHaveLength(2);
    expect(myGroupBalance(state, TRIP)).toEqual({ INR: -2250 });
  });

  it('updates an expense, keeping identity, author and comments', () => {
    let state = run(
      makeState(),
      { type: 'expense/add', id: 'e1', input: equalExpense({ description: 'Taxi' }), ...stamp(T0) },
      { type: 'comment/add', expenseId: 'e1', commentId: 'c1', text: '  Paid by card ', ...stamp(T0, A) },
    );
    expect(state.expenses.e1.comments).toEqual([{ id: 'c1', authorId: A, text: 'Paid by card', createdAt: T0 }]);
    expect(state.activity[0].summary).toBe('Aarav commented on "Taxi".');
    expect(run(state, { type: 'comment/add', expenseId: 'e1', commentId: 'c2', text: '   ', ...stamp() })).toBe(state);

    state = run(state, {
      type: 'expense/update',
      id: 'e1',
      input: equalExpense({ description: 'Airport taxi', total: 12000 }),
      ...stamp(T1),
    });
    const e = state.expenses.e1;
    expect(e.description).toBe('Airport taxi');
    expect(e.total).toBe(12000);
    expect(e.createdAt).toBe(T0);
    expect(e.updatedAt).toBe(T1);
    expect(e.comments).toHaveLength(1);
    expect(state.activity[0].summary).toBe('You updated "Airport taxi" in Trip.');
  });

  it('soft-deletes and restores, ignoring repeats', () => {
    let state = run(makeState(), {
      type: 'expense/add',
      id: 'e1',
      input: equalExpense({ description: 'Taxi', groupId: null, ids: [ME_ID, A] }),
      ...stamp(),
    });
    state = run(state, { type: 'expense/delete', id: 'e1', ...stamp(T1) });
    expect(state.expenses.e1.deletedAt).toBe(T1);
    expect(state.activity[0].summary).toBe('You deleted "Taxi".');
    expect(run(state, { type: 'expense/delete', id: 'e1', ...stamp() })).toBe(state);

    state = run(state, { type: 'expense/restore', id: 'e1', ...stamp() });
    expect(state.expenses.e1.deletedAt).toBeUndefined();
    expect(state.activity[0].summary).toBe('You restored "Taxi".');
  });

  it('names the group when deleting a group expense', () => {
    const state = run(
      makeState(),
      { type: 'expense/add', id: 'e1', input: equalExpense({ description: 'Taxi' }), ...stamp() },
      { type: 'expense/delete', id: 'e1', ...stamp() },
    );
    expect(state.activity[0].summary).toBe('You deleted "Taxi" from Trip.');
  });

  it('pushes a repeat date that is not after the expense date to the next occurrence', () => {
    expect(normalizeRecurrence({ frequency: 'monthly', nextDate: '2026-10-01' }, '2026-10-01')).toEqual({
      frequency: 'monthly',
      nextDate: '2026-11-01',
    });
    expect(normalizeRecurrence({ frequency: 'weekly', nextDate: '2026-10-20' }, '2026-10-01')).toEqual({
      frequency: 'weekly',
      nextDate: '2026-10-20',
    });
    expect(normalizeRecurrence(undefined, '2026-10-01')).toBeUndefined();
  });
});

describe('payments', () => {
  it('records a payment someone else made with the contract wording', () => {
    const state = run(makeState(), {
      type: 'payment/add',
      id: 'pay1',
      input: payment({ groupId: null, amount: 50000 }),
      ...stamp(),
    });
    expect(state.payments.pay1.amount).toBe(50000);
    expect(state.activity[0].summary).toBe('You recorded a payment: Aarav paid you ₹500.00.');
    expect(state.activity[0].paymentId).toBe('pay1');
  });

  it('describes my own payment and payments in a group', () => {
    const mine = run(makeState(), {
      type: 'payment/add',
      id: 'pay1',
      input: payment({ fromId: ME_ID, toId: A, amount: 50000 }),
      ...stamp(),
    });
    expect(mine.activity[0].summary).toBe('You paid Aarav ₹500.00 in Trip.');
    const theirs = run(makeState(), { type: 'payment/add', id: 'pay1', input: payment({ amount: 50000 }), ...stamp(T0, A) });
    expect(theirs.activity[0].summary).toBe('Aarav paid you ₹500.00 in Trip.');
  });

  it('rejects invalid payments and soft-deletes valid ones', () => {
    const state = makeState();
    expect(validatePaymentInput(state, payment({ amount: 0 }))).toContain('Enter an amount');
    expect(validatePaymentInput(state, payment({ toId: A }))).toContain('Choose two different people');
    expect(run(state, { type: 'payment/add', id: 'bad', input: payment({ amount: -5 }), ...stamp() })).toBe(state);

    let next = run(state, { type: 'payment/add', id: 'pay1', input: payment(), ...stamp() });
    next = run(next, { type: 'payment/delete', id: 'pay1', ...stamp(T1) });
    expect(next.payments.pay1.deletedAt).toBe(T1);
    expect(next.activity[0].summary).toBe('You deleted a payment from Trip: Aarav paid you ₹100.00.');
  });
});

describe('recurring expenses', () => {
  function withRent(): AppState {
    return run(makeState(), {
      type: 'expense/add',
      id: 'rent',
      input: equalExpense({
        description: 'Rent',
        total: 3000000,
        date: '2026-08-01',
        recurrence: { frequency: 'monthly', nextDate: '2026-09-01' },
      }),
      ...stamp(),
    });
  }

  it('materialises each due date, moves nextDate on and logs each copy', () => {
    const state = withRent();
    const next = processRecurring(state, '2026-10-14', T1, 'rec1');
    const copies = Object.values(next.expenses).filter((e) => e.recurringParentId === 'rent');
    expect(copies.map((e) => e.date).sort()).toEqual(['2026-09-01', '2026-10-01']);
    expect(copies.every((e) => e.recurrence === undefined && e.total === 3000000 && e.comments.length === 0)).toBe(true);
    expect(copies[0].owed).toEqual(state.expenses.rent.owed);
    expect(next.expenses.rent.recurrence).toEqual({ frequency: 'monthly', nextDate: '2026-11-01' });
    expect(next.activity.slice(0, 2).every((a) => a.summary === 'Recurring expense "Rent" was added in Trip.')).toBe(true);
    expect(processRecurring(next, '2026-10-14', T1, 'rec2')).toBe(next);
  });

  it('works through the reducer and skips deleted parents', () => {
    const state = run(withRent(), { type: 'expense/delete', id: 'rent', ...stamp() });
    expect(appReducer(state, { type: 'recurring/process', today: '2026-10-14', at: T1, idBase: 'r' })).toBe(state);
    const live = appReducer(withRent(), { type: 'recurring/process', today: '2026-09-01', at: T1, idBase: 'r' });
    expect(live.expenses.r_1.date).toBe('2026-09-01');
  });

  it('keeps a month-end expense on month-ends across separate runs', () => {
    const state = run(makeState(), {
      type: 'expense/add',
      id: 'eom',
      input: equalExpense({ description: 'Gym', total: 150000, date: '2026-08-31', recurrence: { frequency: 'monthly', nextDate: '2026-09-30' } }),
      ...stamp(),
    });
    const first = processRecurring(state, '2026-10-01', T1, 'm1');
    expect(first.expenses.eom.recurrence).toEqual({ frequency: 'monthly', nextDate: '2026-10-31' });
    const second = processRecurring(first, '2026-11-30', T1, 'm2');
    const dates = Object.values(second.expenses).filter((e) => e.recurringParentId === 'eom').map((e) => e.date).sort();
    expect(dates).toEqual(['2026-09-30', '2026-10-31', '2026-11-30']);
    expect(second.expenses.eom.recurrence).toEqual({ frequency: 'monthly', nextDate: '2026-12-31' });
  });
});

describe('settings, clearing and the activity cap', () => {
  it('merges settings', () => {
    const state = run(makeState(), { type: 'settings/update', patch: { ocrApiKey: 'K123', ocrEngine: 3 }, ...stamp() });
    expect(state.settings.ocrApiKey).toBe('K123');
    expect(state.settings.ocrEngine).toBe(3);
    expect(state.settings.defaultCurrency).toBe('INR');
  });

  it('logs settings changes without ever showing the API key', () => {
    const base = makeState();
    expect(run(base, { type: 'settings/update', patch: { defaultCurrency: base.settings.defaultCurrency }, ...stamp() })).toBe(base);

    const keyed = run(base, { type: 'settings/update', patch: { ocrApiKey: 'SECRET42' }, ...stamp() });
    expect(keyed.activity[0].type).toBe('settings_updated');
    expect(keyed.activity[0].summary).toBe('You saved an OCR.space API key for bill scanning.');
    expect(keyed.activity[0].summary).not.toContain('SECRET42');
    expect(run(keyed, { type: 'settings/update', patch: { ocrApiKey: '' }, ...stamp() }).activity[0].summary).toBe(
      'You removed your OCR.space API key.',
    );
    expect(run(base, { type: 'settings/update', patch: { defaultCurrency: 'USD' }, ...stamp() }).activity[0].summary).toBe(
      'You changed your default currency to USD.',
    );
    expect(run(base, { type: 'settings/update', patch: { ocrEngine: 3 }, ...stamp() }).activity[0].summary).toBe(
      'You switched bill scanning to OCR engine 3.',
    );
    expect(
      run(base, { type: 'settings/update', patch: { simplifyDebtsDefault: !base.settings.simplifyDebtsDefault }, ...stamp() })
        .activity[0].summary,
    ).toContain('simplify debts for new groups');
    expect(run(base, { type: 'settings/update', patch: { ocrEngine: 1, defaultCurrency: 'EUR' }, ...stamp() }).activity[0].summary).toBe(
      'You updated your settings.',
    );
  });

  it('clears everything except my profile and settings', () => {
    let state = run(makeState(), { type: 'person/update', id: ME_ID, patch: { name: 'Sam' }, ...stamp() });
    state = run(state, { type: 'settings/update', patch: { ocrApiKey: 'K1' }, ...stamp() });
    const cleared = run(state, { type: 'state/clear', at: T1 });
    expect(cleared.people[ME_ID].name).toBe('Sam');
    expect(Object.keys(cleared.people)).toEqual([ME_ID]);
    expect(cleared.friendIds).toEqual([]);
    expect(cleared.groups).toEqual({});
    expect(cleared.activity).toEqual([]);
    expect(cleared.settings.ocrApiKey).toBe('K1');
  });

  it(`keeps at most ${MAX_ACTIVITY} activity entries`, () => {
    let state = makeState();
    for (let i = 0; i < MAX_ACTIVITY + 5; i++) {
      state = run(state, { type: 'group/update', id: TRIP, patch: { name: `Trip ${i}` }, ...stamp() });
    }
    expect(state.activity).toHaveLength(MAX_ACTIVITY);
    expect(state.activity[0].summary).toContain(`Trip ${MAX_ACTIVITY + 4}`);
  });
});

describe('persisted state', () => {
  it('uses the agreed storage key', () => {
    expect(STORAGE_KEY).toBe('splitsnap/state/v1');
  });

  it('round-trips a demo state through JSON', () => {
    const demo = createDemoState('2026-10-14');
    expect(parsePersistedState(JSON.stringify(demo))).toEqual(demo);
  });

  it('returns null for missing, corrupt, old or damaged data', () => {
    expect(parsePersistedState(null)).toBeNull();
    expect(parsePersistedState('')).toBeNull();
    expect(parsePersistedState('{not json')).toBeNull();
    expect(parsePersistedState(JSON.stringify({ schemaVersion: 0 }))).toBeNull();
    const demo = createDemoState('2026-10-14');
    const damaged = JSON.parse(JSON.stringify(demo));
    damaged.expenses[Object.keys(damaged.expenses)[0]].total = '12.50';
    expect(parsePersistedState(JSON.stringify(damaged))).toBeNull();
    const noMe = JSON.parse(JSON.stringify(demo));
    delete noMe.people[ME_ID];
    expect(parsePersistedState(JSON.stringify(noMe))).toBeNull();
  });

  it('fills settings that were added after the state was saved', () => {
    const demo = createDemoState('2026-10-14') as unknown as { settings: Record<string, unknown> };
    delete demo.settings.ocrEngine;
    const parsed = parsePersistedState(JSON.stringify(demo));
    expect(parsed && parsed.settings.ocrEngine).toBe(2);
  });
});
