import { ME_ID } from '../../app/src/types';
import type { AppState } from '../../app/src/types';
import { diffShared } from '../../app/src/sync/diff';
import { buildPush, mergeOutbox } from '../../app/src/sync/outbox';
import { EMPTY_SYNC_STATE } from '../../app/src/sync/types';
import type { OutboxKey, SharedGroupInfo, SyncState } from '../../app/src/sync/types';
import { appReducer } from '../../app/src/store/reducer';
import type { AppAction } from '../../app/src/store/reducer';
import { A, B, TRIP, equalExpense, makeState, payment, run, stamp } from '../store/fixtures';

// makeState(): you (Diya, on this phone) + Aarav (A), Bhavna (B), Chirag (C) in the group Trip.
const MY = 'u_diya01';
const FLAT = 'g_flat';
const INFO: SharedGroupInfo = { groupId: TRIP, myMemberId: MY, joinCode: 'ABCD2345', joinEnabled: true, members: {}, cursor: null };
const SYNC: SyncState = { ...EMPTY_SYNC_STATE, userId: 'user-d', displayName: 'Diya', groups: { [TRIP]: INFO } };

const key = (kind: OutboxKey['kind'], groupId: string, id: string, expenseId?: string): OutboxKey =>
  expenseId ? { kind, groupId, id, expenseId } : { kind, groupId, id };

describe('mergeOutbox', () => {
  it('keeps one key per kind, group and entity, in first-seen order', () => {
    const existing = [key('expense', TRIP, 'e1'), key('payment', TRIP, 'p1')];
    const added = [key('expense', TRIP, 'e1'), key('comment', TRIP, 'c1', 'e1'), key('payment', TRIP, 'p1'), key('expense', TRIP, 'e2')];
    expect(mergeOutbox(existing, added)).toEqual([
      key('expense', TRIP, 'e1'),
      key('payment', TRIP, 'p1'),
      key('comment', TRIP, 'c1', 'e1'),
      key('expense', TRIP, 'e2'),
    ]);
  });

  it('treats the same id under another kind or group as a different key', () => {
    const keys = [key('expense', TRIP, 'x'), key('payment', TRIP, 'x'), key('expense', FLAT, 'x')];
    expect(mergeOutbox([], keys)).toEqual(keys);
  });

  it('returns the existing list itself when nothing new arrives', () => {
    const existing = [key('expense', TRIP, 'e1'), key('member', TRIP, A)];
    expect(mergeOutbox(existing, [])).toBe(existing);
    expect(mergeOutbox(existing, [key('member', TRIP, A)])).toBe(existing);
    const messy = [key('expense', TRIP, 'e1'), key('expense', TRIP, 'e1')];
    expect(mergeOutbox(messy, [])).toEqual([key('expense', TRIP, 'e1')]);
  });

  it('lets a group-delete remove every other key of that group, before or after it', () => {
    const existing = [key('expense', TRIP, 'e1'), key('expense', FLAT, 'e9'), key('member', TRIP, A)];
    const added = [key('group-delete', TRIP, TRIP), key('activity', TRIP, 'a1'), key('group', FLAT, FLAT)];
    expect(mergeOutbox(existing, added)).toEqual([key('expense', FLAT, 'e9'), key('group-delete', TRIP, TRIP), key('group', FLAT, FLAT)]);

    const deleted = [key('group-delete', TRIP, TRIP)];
    expect(mergeOutbox(deleted, [key('expense', TRIP, 'e2')])).toBe(deleted);
  });

  it('never changes its inputs', () => {
    const existing = [key('expense', TRIP, 'e1')];
    const added = [key('group-delete', TRIP, TRIP)];
    mergeOutbox(existing, added);
    expect(existing).toEqual([key('expense', TRIP, 'e1')]);
    expect(added).toEqual([key('group-delete', TRIP, TRIP)]);
  });
});

/** Runs actions one by one, collecting outbox keys the way the engine does. */
function play(start: AppState, actions: AppAction[]): { state: AppState; outbox: OutboxKey[] } {
  let state = start;
  let outbox: OutboxKey[] = [];
  for (const action of actions) {
    const next = appReducer(state, action);
    outbox = mergeOutbox(outbox, diffShared(state, next, SYNC));
    state = next;
  }
  return { state, outbox };
}

function base(): AppState {
  return run(makeState(), {
    type: 'group/create',
    id: FLAT,
    input: { name: 'Flat', type: 'home', emoji: '🏠', memberIds: [B], defaultCurrency: 'INR', simplifyDebts: false },
    ...stamp(),
  });
}

describe('buildPush', () => {
  it('builds every kind of row from the current state, with you as your member id', () => {
    const { state, outbox } = play(base(), [
      { type: 'group/update', id: TRIP, patch: { name: 'Goa Trip' }, ...stamp() },
      { type: 'expense/add', id: 'e_dinner', input: equalExpense({ receiptUri: 'file:///bill.jpg' }), ...stamp() },
      { type: 'comment/add', expenseId: 'e_dinner', commentId: 'cmt_1', text: 'Paid by card', ...stamp() },
      { type: 'payment/add', id: 'pay_1', input: payment(), ...stamp() },
      { type: 'person/update', id: A, patch: { name: 'Aarav S' }, ...stamp() },
    ]);
    const { payload, sent, dropped } = buildPush(state, SYNC, outbox, 'Diya');
    expect(dropped).toEqual([]);
    expect(sent).toEqual(outbox);

    expect(payload.groups).toEqual([{ id: TRIP, name: 'Goa Trip', type: 'trip', emoji: state.groups[TRIP].emoji, defaultCurrency: 'INR', simplifyDebts: true, archived: false }]);
    expect(payload.members).toEqual([{ groupId: TRIP, id: A, name: 'Aarav S', color: state.people[A].color }]);

    expect(payload.expenses).toHaveLength(1);
    const e = payload.expenses[0];
    expect(e.id).toBe('e_dinner');
    expect(e.deletedAt).toBeNull();
    expect(e.data.payers).toEqual([{ personId: MY, amount: 30000 }]);
    expect(e.data.split).toEqual({ method: 'equal', participantIds: [MY, A, B] });
    expect('comments' in e.data).toBe(false);
    expect('receiptUri' in e.data).toBe(false);

    expect(payload.comments).toEqual([
      { id: 'cmt_1', groupId: TRIP, expenseId: 'e_dinner', data: { ...state.expenses.e_dinner.comments[0], authorId: MY } },
    ]);
    expect(payload.payments.map((p) => [p.id, p.data.fromId, p.data.toId])).toEqual([['pay_1', A, MY]]);

    expect(payload.activity.map((a) => a.data.summary)).toEqual([
      'Diya renamed "Trip" to "Goa Trip".',
      'Diya added "Dinner" in Goa Trip.',
      'Diya commented on "Dinner".',
      'Diya recorded a payment in Goa Trip: Aarav paid Diya ₹100.00.',
    ]);
    expect(payload.activity.every((a) => a.data.actorId === MY && a.groupId === TRIP)).toBe(true);
    expect(JSON.stringify(payload).indexOf(`"${ME_ID}"`)).toBe(-1);
  });

  it('sends the latest version of an entity changed several times', () => {
    const { state, outbox } = play(base(), [
      { type: 'expense/add', id: 'e_dinner', input: equalExpense(), ...stamp() },
      { type: 'expense/update', id: 'e_dinner', input: equalExpense({ description: 'Dinner at Thalassa', total: 45000 }), ...stamp() },
      { type: 'expense/delete', id: 'e_dinner', ...stamp() },
    ]);
    expect(outbox.filter((k) => k.kind === 'expense')).toEqual([key('expense', TRIP, 'e_dinner')]);
    const { payload } = buildPush(state, SYNC, outbox, 'Diya');
    expect(payload.expenses).toHaveLength(1);
    expect(payload.expenses[0].data.description).toBe('Dinner at Thalassa');
    expect(payload.expenses[0].data.total).toBe(45000);
    expect(payload.expenses[0].deletedAt).toBe(state.expenses.e_dinner.deletedAt);
    expect(payload.activity).toHaveLength(3);
  });

  it('sends your own member row under your member id and display name', () => {
    const state = base();
    const { payload } = buildPush(state, SYNC, [key('member', TRIP, ME_ID)], 'Diya');
    expect(payload.members).toEqual([{ groupId: TRIP, id: MY, name: 'Diya', color: state.people[ME_ID].color }]);
  });

  it('drops keys whose record is gone, moved or no longer shared', () => {
    const { state } = play(base(), [
      { type: 'expense/add', id: 'e_dinner', input: equalExpense(), ...stamp() },
      { type: 'expense/add', id: 'e_rent', input: equalExpense({ groupId: FLAT, ids: [ME_ID, B] }), ...stamp() },
      { type: 'comment/add', expenseId: 'e_dinner', commentId: 'cmt_1', text: 'Hi', ...stamp() },
      { type: 'friend/add', id: 'p_e', input: { name: 'Esha' }, ...stamp() },
    ]);
    // An expense that moved out of Trip can't follow it on the server.
    const moved: AppState = { ...state, expenses: { ...state.expenses, e_moved: { ...state.expenses.e_dinner, id: 'e_moved', groupId: FLAT } } };
    const gone = [
      key('expense', TRIP, 'e_missing'),
      key('expense', TRIP, 'e_moved'),
      key('expense', FLAT, 'e_rent'),
      key('payment', TRIP, 'pay_missing'),
      key('comment', TRIP, 'cmt_1'),
      key('comment', TRIP, 'cmt_missing', 'e_dinner'),
      key('activity', TRIP, 'act_missing'),
      key('activity', TRIP, state.activity.find((a) => a.type === 'friend_added')!.id),
      key('member', TRIP, 'p_e'),
      key('member', TRIP, 'p_nobody'),
      key('group', 'g_gone', 'g_gone'),
    ];
    const ok = [key('expense', TRIP, 'e_dinner'), key('comment', TRIP, 'cmt_1', 'e_dinner')];
    const { payload, sent, dropped } = buildPush(moved, SYNC, [...gone, ...ok], 'Diya');
    expect(dropped).toEqual(gone);
    expect(sent).toEqual(ok);
    expect(payload.expenses.map((e) => e.id)).toEqual(['e_dinner']);
    expect(payload.comments.map((c) => c.id)).toEqual(['cmt_1']);
    expect(payload.members).toEqual([]);
    expect(payload.groups).toEqual([]);
  });

  it('drops keys of a group that stopped being shared', () => {
    const { state, outbox } = play(base(), [{ type: 'expense/add', id: 'e_dinner', input: equalExpense(), ...stamp() }]);
    const left: SyncState = { ...SYNC, groups: {} };
    const { payload, sent, dropped } = buildPush(state, left, outbox, 'Diya');
    expect(sent).toEqual([]);
    expect(dropped).toEqual(outbox);
    expect(payload.expenses).toEqual([]);
    expect(payload.activity).toEqual([]);
  });

  it('sends a group-delete as { id, deleted: true }, even after the group is forgotten', () => {
    const { state, outbox } = play(base(), [{ type: 'group/delete', id: TRIP, ...stamp() }]);
    expect(outbox).toEqual([key('group-delete', TRIP, TRIP)]);
    expect(buildPush(state, SYNC, outbox, 'Diya').payload.groups).toEqual([{ id: TRIP, deleted: true }]);
    const forgotten = buildPush(state, { ...SYNC, groups: {} }, outbox, 'Diya');
    expect(forgotten.payload.groups).toEqual([{ id: TRIP, deleted: true }]);
    expect(forgotten.sent).toEqual(outbox);
  });

  it('never puts the same row in the payload twice', () => {
    const { state } = play(base(), [{ type: 'expense/add', id: 'e_dinner', input: equalExpense(), ...stamp() }]);
    const keys = [key('expense', TRIP, 'e_dinner'), key('member', TRIP, A), key('expense', TRIP, 'e_dinner'), key('member', TRIP, A)];
    const { payload, sent, dropped } = buildPush(state, SYNC, keys, 'Diya');
    expect(payload.expenses).toHaveLength(1);
    expect(payload.members).toHaveLength(1);
    expect(sent).toEqual(keys);
    expect(dropped).toEqual([]);
  });

  it('sends an itemised split with every item share rewritten', () => {
    const input = equalExpense({
      total: 90000,
      split: {
        method: 'itemized',
        bill: {
          items: [
            { id: 'i1', name: 'Naan', quantity: 6, amount: 40000, shares: { [ME_ID]: 2, [B]: 1 } },
            { id: 'i2', name: 'Paneer', quantity: 1, amount: 50000, shares: { [A]: 1, [ME_ID]: 1 } },
          ],
          charges: [],
        },
      },
    });
    const { state, outbox } = play(base(), [{ type: 'expense/add', id: 'e_bill', input, ...stamp() }]);
    const { payload } = buildPush(state, SYNC, outbox, 'Diya');
    const split = payload.expenses[0].data.split as { bill: { items: { shares: Record<string, number> }[] } };
    expect(split.bill.items.map((i) => i.shares)).toEqual([{ [MY]: 2, [B]: 1 }, { [A]: 1, [MY]: 1 }]);
    expect(payload.expenses[0].data.owed).toEqual(state.expenses.e_bill.owed.map((o) => ({ ...o, personId: o.personId === ME_ID ? MY : o.personId })));
  });
});
