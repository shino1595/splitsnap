import { ME_ID } from '../../app/src/types';
import type { AppState } from '../../app/src/types';
import { diffShared } from '../../app/src/sync/diff';
import { EMPTY_SYNC_STATE } from '../../app/src/sync/types';
import type { OutboxKey, SharedGroupInfo, SyncState } from '../../app/src/sync/types';
import { appReducer } from '../../app/src/store/reducer';
import type { AppAction } from '../../app/src/store/reducer';
import { createDemoState } from '../../app/src/store/seed';
import { A, B, C, TRIP, equalExpense, makeState, payment, run, stamp } from '../store/fixtures';

// makeState(): you + Aarav (A), Bhavna (B), Chirag (C) and the group Trip with all four.
const FLAT = 'g_flat';
const GOA = 'g_goa';
const D = 'p_d';

function sharing(...groupIds: string[]): SyncState {
  const groups: Record<string, SharedGroupInfo> = {};
  for (const id of groupIds) {
    groups[id] = { groupId: id, myMemberId: 'u_me01', joinCode: null, joinEnabled: true, members: {}, cursor: null };
  }
  return { ...EMPTY_SYNC_STATE, groups };
}

const SHARED = sharing(TRIP);

/** Trip (shared), Flat (not shared: you + Bhavna) and Diya, a friend in no group. */
function base(): AppState {
  return run(
    makeState(),
    { type: 'friend/add', id: D, input: { name: 'Diya' }, ...stamp() },
    {
      type: 'group/create',
      id: FLAT,
      input: { name: 'Flat', type: 'home', emoji: '🏠', memberIds: [B], defaultCurrency: 'INR', simplifyDebts: false },
      ...stamp(),
    },
  );
}

function withDinner(): AppState {
  return run(base(), { type: 'expense/add', id: 'e_dinner', input: equalExpense(), ...stamp() });
}

/** Applies one action and diffs the transition. */
function step(prev: AppState, action: AppAction, sync: SyncState = SHARED): { next: AppState; keys: OutboxKey[] } {
  const next = appReducer(prev, action);
  return { next, keys: diffShared(prev, next, sync) };
}

const activityKey = (state: AppState, groupId: string = TRIP): OutboxKey => ({ kind: 'activity', groupId, id: state.activity[0].id });

describe('diffShared: nothing to send', () => {
  it('returns nothing for the same state or a no-op action', () => {
    const s = base();
    expect(diffShared(s, s, SHARED)).toEqual([]);
    expect(step(s, { type: 'person/update', id: A, patch: { name: 'Aarav' }, ...stamp() }).keys).toEqual([]);
  });

  it('ignores groups that are not shared and expenses outside groups', () => {
    const s = base();
    expect(step(s, { type: 'group/update', id: FLAT, patch: { name: 'Flat 2B' }, ...stamp() }).keys).toEqual([]);
    expect(step(s, { type: 'expense/add', id: 'e_rent', input: equalExpense({ groupId: FLAT, ids: [ME_ID, B] }), ...stamp() }).keys).toEqual([]);
    expect(step(s, { type: 'expense/add', id: 'e_solo', input: equalExpense({ groupId: null, ids: [ME_ID, D] }), ...stamp() }).keys).toEqual([]);
    expect(step(s, { type: 'payment/add', id: 'pay_flat', input: payment({ groupId: FLAT, fromId: B }), ...stamp() }).keys).toEqual([]);
    expect(step(s, { type: 'friend/add', id: 'p_e', input: { name: 'Esha' }, ...stamp() }).keys).toEqual([]);
  });

  it('is safe for state/clear and state/replace (the engine resyncs those)', () => {
    const s = withDinner();
    expect(step(s, { type: 'state/clear', at: '2026-10-05T10:00:00.000Z' }).keys).toEqual([]);
    expect(step(s, { type: 'state/replace', state: createDemoState('2026-10-05') }).keys).toEqual([]);
    expect(step(s, { type: 'state/replace', state: JSON.parse(JSON.stringify(s)) }).keys).toEqual([]);
    // Even a replacement that kept the settings object is recognised by its activity.
    const copy: AppState = { ...JSON.parse(JSON.stringify(s)), settings: s.settings, groups: {} };
    expect(diffShared(s, copy, SHARED)).toEqual([]);
  });

  it('does not invent changes for a shared group without a baseline', () => {
    const s = withDinner();
    const groups = { ...s.groups };
    delete groups[TRIP];
    expect(diffShared({ ...s, groups }, s, SHARED)).toEqual([]);
    // A shared id that exists in neither state is ignored.
    expect(step(s, { type: 'group/update', id: FLAT, patch: { name: 'Flat 2B' }, ...stamp() }, sharing(TRIP, 'g_unknown')).keys).toEqual([]);
  });
});

describe('diffShared: groups and members', () => {
  it('sends a group change and its activity', () => {
    const { next, keys } = step(base(), { type: 'group/update', id: TRIP, patch: { name: 'Goa Trip', simplifyDebts: false }, ...stamp() });
    expect(keys).toEqual([{ kind: 'group', groupId: TRIP, id: TRIP }, activityKey(next)]);
  });

  it('sends a new member, not a group change, when only membership changes', () => {
    const { next, keys } = step(base(), { type: 'group/addMember', groupId: TRIP, personId: D, ...stamp() });
    expect(keys).toEqual([{ kind: 'member', groupId: TRIP, id: D }, activityKey(next)]);
  });

  it('sends a rename or recolour once per shared group the person belongs to', () => {
    let s = run(base(), {
      type: 'group/create',
      id: GOA,
      input: { name: 'Goa', type: 'trip', emoji: '🏖️', memberIds: [A, D], defaultCurrency: 'INR', simplifyDebts: true },
      ...stamp(),
    });
    const both = sharing(TRIP, GOA);
    expect(step(s, { type: 'person/update', id: A, patch: { name: 'Aarav S' }, ...stamp() }, both).keys).toEqual([
      { kind: 'member', groupId: TRIP, id: A },
      { kind: 'member', groupId: GOA, id: A },
    ]);
    expect(step(s, { type: 'person/update', id: B, patch: { color: '#000000' }, ...stamp() }, both).keys).toEqual([
      { kind: 'member', groupId: TRIP, id: B },
    ]);
    expect(step(s, { type: 'person/update', id: A, patch: { upiId: 'aarav@okaxis', phone: '98200' }, ...stamp() }, both).keys).toEqual([]);
    // Diya is only in Goa; with Goa not shared nothing goes out.
    s = run(s, { type: 'person/update', id: D, patch: { name: 'Diya R' }, ...stamp() });
    expect(step(s, { type: 'person/update', id: D, patch: { name: 'Diya Rao' }, ...stamp() }).keys).toEqual([]);
  });

  it('turns a deleted shared group into one group-delete key', () => {
    const { keys } = step(base(), { type: 'group/delete', id: TRIP, ...stamp() });
    expect(keys).toEqual([{ kind: 'group-delete', groupId: TRIP, id: TRIP }]);
  });
});

describe('diffShared: expenses, payments, comments, activity', () => {
  it('sends added, edited, deleted and restored expenses with their activity', () => {
    const added = step(base(), { type: 'expense/add', id: 'e_dinner', input: equalExpense(), ...stamp() });
    expect(added.keys).toEqual([{ kind: 'expense', groupId: TRIP, id: 'e_dinner' }, activityKey(added.next)]);

    const edited = step(added.next, { type: 'expense/update', id: 'e_dinner', input: equalExpense({ description: 'Dinner at Thalassa' }), ...stamp() });
    expect(edited.keys).toEqual([{ kind: 'expense', groupId: TRIP, id: 'e_dinner' }, activityKey(edited.next)]);

    const deleted = step(edited.next, { type: 'expense/delete', id: 'e_dinner', ...stamp() });
    expect(deleted.keys).toEqual([{ kind: 'expense', groupId: TRIP, id: 'e_dinner' }, activityKey(deleted.next)]);
    expect(deleted.next.expenses.e_dinner.deletedAt).toBeDefined();

    const restored = step(deleted.next, { type: 'expense/restore', id: 'e_dinner', ...stamp() });
    expect(restored.keys).toEqual([{ kind: 'expense', groupId: TRIP, id: 'e_dinner' }, activityKey(restored.next)]);
  });

  it('sends an itemised expense like any other', () => {
    const input = equalExpense({
      total: 90000,
      payers: [{ personId: A, amount: 90000 }],
      split: {
        method: 'itemized',
        bill: {
          items: [
            { id: 'i1', name: 'Naan', quantity: 6, amount: 40000, shares: { [ME_ID]: 2, [B]: 1 } },
            { id: 'i2', name: 'Paneer', quantity: 1, amount: 50000, shares: { [C]: 1 } },
          ],
          charges: [],
        },
      },
    });
    const { next, keys } = step(base(), { type: 'expense/add', id: 'e_bill', input, ...stamp() });
    expect(next.expenses.e_bill.split.method).toBe('itemized');
    expect(keys).toEqual([{ kind: 'expense', groupId: TRIP, id: 'e_bill' }, activityKey(next)]);
  });

  it('sends a new comment as its own key, without re-sending the expense', () => {
    const { next, keys } = step(withDinner(), { type: 'comment/add', expenseId: 'e_dinner', commentId: 'cmt_1', text: 'Paid by card', ...stamp() });
    expect(keys).toEqual([{ kind: 'comment', groupId: TRIP, id: 'cmt_1', expenseId: 'e_dinner' }, activityKey(next)]);
  });

  it('sends added and deleted payments', () => {
    const added = step(base(), { type: 'payment/add', id: 'pay_1', input: payment(), ...stamp() });
    expect(added.keys).toEqual([{ kind: 'payment', groupId: TRIP, id: 'pay_1' }, activityKey(added.next)]);
    const deleted = step(added.next, { type: 'payment/delete', id: 'pay_1', ...stamp() });
    expect(deleted.keys).toEqual([{ kind: 'payment', groupId: TRIP, id: 'pay_1' }, activityKey(deleted.next)]);
  });

  it('sends every new activity entry, oldest first (recurring copies)', () => {
    const s = run(base(), {
      type: 'expense/add',
      id: 'e_rent',
      input: equalExpense({ description: 'Rent', recurrence: { frequency: 'weekly', nextDate: '2026-10-08' } }),
      ...stamp(),
    });
    const { next, keys } = step(s, { type: 'recurring/process', today: '2026-10-22', at: '2026-10-22T09:00:00.000Z', idBase: 'rec' });
    expect(Object.keys(next.expenses)).toEqual(['e_rent', 'rec_1', 'rec_2', 'rec_3']);
    expect(keys).toEqual([
      { kind: 'expense', groupId: TRIP, id: 'e_rent' },
      { kind: 'expense', groupId: TRIP, id: 'rec_1' },
      { kind: 'expense', groupId: TRIP, id: 'rec_2' },
      { kind: 'expense', groupId: TRIP, id: 'rec_3' },
      { kind: 'activity', groupId: TRIP, id: 'rec_a1' },
      { kind: 'activity', groupId: TRIP, id: 'rec_a2' },
      { kind: 'activity', groupId: TRIP, id: 'rec_a3' },
    ]);
  });

  it('sends everything new when the previous state had no activity yet', () => {
    const empty: AppState = { ...withDinner(), activity: [] };
    const { next, keys } = step(empty, { type: 'payment/add', id: 'pay_1', input: payment(), ...stamp() });
    expect(keys).toEqual([{ kind: 'payment', groupId: TRIP, id: 'pay_1' }, activityKey(next)]);
  });
});
