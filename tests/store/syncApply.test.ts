import { ME_ID } from '../../app/src/types';
import type { Activity, AppState, Comment, Expense, Group, Payment } from '../../app/src/types';
import type { LocalBatch } from '../../app/src/sync/types';
import { MAX_ACTIVITY, appReducer } from '../../app/src/store/reducer';
import { rewordRemoteActivity } from '../../app/src/store/activityText';
import { A, B, C, TRIP, T0, equalExpense, makeState, payment, run, stamp } from './fixtures';

const AT = '2026-10-05T08:00:00.000Z';
/** Diya: a member who joined on another phone. */
const D = 'u_diya';

function apply(state: AppState, parts: Partial<LocalBatch>): AppState {
  const batch: LocalBatch = { people: [], groups: [], deletedGroupIds: [], expenses: [], payments: [], comments: [], activity: [], ...parts };
  return appReducer(state, { type: 'sync/applyRemote', batch, at: AT });
}

function comment(id: string, authorId: string, createdAt: string): Comment {
  return { id, authorId, text: `Note ${id}`, createdAt };
}

/** makeState() plus a Trip dinner with a bill photo and one comment, a payment Aarav → you, and a non-group expense. */
function withHistory(): AppState {
  return run(
    makeState(),
    { type: 'expense/add', id: 'e1', input: equalExpense({ receiptUri: 'file:///bill.jpg' }), ...stamp(T0) },
    { type: 'comment/add', expenseId: 'e1', commentId: 'c_local', text: 'Paid by card', ...stamp('2026-10-01T12:00:00.000Z') },
    { type: 'payment/add', id: 'pay1', input: payment(), ...stamp(T0) },
    { type: 'expense/add', id: 'e_solo', input: equalExpense({ groupId: null, description: 'Taxi', ids: [ME_ID, A] }), ...stamp(T0) },
  );
}

/** As the server sends it: no comments, no bill photo. */
function serverCopy(e: Expense, patch: Partial<Expense> = {}): Expense {
  return { ...e, comments: [], receiptUri: undefined, ...patch };
}

function entry(id: string, patch: Partial<Activity>): Activity {
  return { id, type: 'expense_added', at: AT, actorId: A, summary: 'neutral', ...patch };
}

describe('sync/applyRemote', () => {
  it('returns the same state object when the batch changes nothing', () => {
    const s = withHistory();
    expect(apply(s, {})).toBe(s);

    const trip = s.groups[TRIP];
    const sameTrip: Group = {
      createdAt: trip.createdAt,
      defaultCurrency: trip.defaultCurrency,
      simplifyDebts: trip.simplifyDebts,
      memberIds: [...trip.memberIds],
      emoji: trip.emoji,
      type: trip.type,
      name: trip.name,
      id: trip.id,
    };
    const next = apply(s, {
      people: [
        { id: A, name: 'Aarav', color: '#000000' },
        { id: ME_ID, name: 'Bhavna', color: '#ffffff' },
      ],
      groups: [sameTrip],
      expenses: [serverCopy(s.expenses.e1)],
      payments: [{ ...s.payments.pay1 }],
      comments: [{ expenseId: 'e1', comment: { ...s.expenses.e1.comments[0] } }],
      activity: [{ ...s.activity[0], summary: 'neutral' }],
    });
    expect(next).toBe(s);
  });

  it('creates missing people, renames known ones (nothing else) and never touches you', () => {
    const s = makeState();
    const next = apply(s, {
      people: [
        { id: D, name: ' Diya ', color: '#123456' },
        { id: A, name: 'Aarav S', color: '#000000' },
        { id: B, name: '   ', color: '#000000' },
        { id: ME_ID, name: 'Chirag', color: '#ffffff' },
      ],
    });
    expect(next.people[D]).toEqual({ id: D, name: 'Diya', color: '#123456', createdAt: AT });
    expect(next.people[A]).toEqual({ ...s.people[A], name: 'Aarav S' });
    expect(next.people[A].upiId).toBe('aarav@okicici');
    expect(next.people[B]).toBe(s.people[B]);
    expect(next.people[ME_ID]).toBe(s.people[ME_ID]);
    expect(next.activity).toBe(s.activity);
  });

  it('creates and replaces groups; their members become friends', () => {
    const s = makeState();
    const goa: Group = {
      id: 'g_goa',
      name: 'Goa',
      type: 'trip',
      emoji: '🏖️',
      memberIds: [ME_ID, A, D],
      simplifyDebts: false,
      defaultCurrency: 'INR',
      createdAt: '2026-10-04T09:00:00.000Z',
    };
    let next = apply(s, { people: [{ id: D, name: 'Diya', color: '#123456' }], groups: [goa] });
    expect(next.groups.g_goa).toEqual(goa);
    expect(next.friendIds).toEqual([A, B, C, D]);
    expect(next.activity).toBe(s.activity);

    // Replaced whole; unknown and repeated member ids are left out.
    next = apply(next, { groups: [{ ...s.groups[TRIP], name: 'Trip 2026', archived: true, memberIds: [ME_ID, A, A, 'u_ghost', D] }] });
    expect(next.groups[TRIP]).toMatchObject({ name: 'Trip 2026', archived: true, memberIds: [ME_ID, A, D] });
    expect(next.groups.g_goa).toEqual(goa);
  });

  it('deletes groups with their expenses and payments, without checks or activity', () => {
    const s = withHistory();
    const next = apply(s, {
      deletedGroupIds: [TRIP, 'g_unknown'],
      // Applied last, so rows of the deleted group in the same batch go too.
      expenses: [serverCopy(s.expenses.e1, { id: 'e_late' })],
    });
    expect(next.groups[TRIP]).toBeUndefined();
    expect(next.expenses.e1).toBeUndefined();
    expect(next.expenses.e_late).toBeUndefined();
    expect(next.payments.pay1).toBeUndefined();
    expect(next.expenses.e_solo).toBe(s.expenses.e_solo);
    expect(next.people).toBe(s.people);
    expect(next.activity).toBe(s.activity);

    expect(apply(s, { deletedGroupIds: ['g_unknown'] })).toBe(s);
  });

  it('replaces an expense but keeps local comments (merged by id, oldest first) and the bill photo', () => {
    const s = withHistory();
    const before = JSON.stringify(s);
    const early = comment('c_early', A, '2026-10-01T11:00:00.000Z');
    const remote = serverCopy(s.expenses.e1, {
      description: 'Dinner at the shack',
      updatedAt: AT,
      comments: [{ ...s.expenses.e1.comments[0] }, early],
    });
    const next = apply(s, { expenses: [remote] });
    const e1 = next.expenses.e1;
    expect(e1.description).toBe('Dinner at the shack');
    expect(e1.updatedAt).toBe(AT);
    expect(e1.comments.map((c) => c.id)).toEqual(['c_early', 'c_local']);
    expect(e1.receiptUri).toBe('file:///bill.jpg');
    expect(next.payments).toBe(s.payments);
    expect(next.activity).toBe(s.activity);
    expect(JSON.stringify(s)).toBe(before);

    // A photo on the server copy wins.
    expect(apply(s, { expenses: [{ ...remote, receiptUri: 'file:///other.jpg' }] }).expenses.e1.receiptUri).toBe('file:///other.jpg');

    // A new expense arrives with its comments in time order.
    const late = comment('c_late', B, '2026-10-03T09:00:00.000Z');
    const created = apply(s, { expenses: [serverCopy(s.expenses.e1, { id: 'e_new', comments: [late, early] })] }).expenses.e_new;
    expect(created.comments).toEqual([early, late]);
    expect(created.receiptUri).toBeUndefined();
  });

  it('adds remote comments once, in time order, and skips comments on unknown expenses', () => {
    const s = withHistory();
    const fresh = comment('c_new', B, '2026-10-02T13:00:00.000Z');
    const old = comment('c_old', A, '2026-10-01T09:00:00.000Z');
    const parts: Partial<LocalBatch> = {
      comments: [
        { expenseId: 'e1', comment: fresh },
        { expenseId: 'e1', comment: old },
        { expenseId: 'e1', comment: { ...s.expenses.e1.comments[0], text: 'edited elsewhere' } },
        { expenseId: 'e1', comment: fresh },
        { expenseId: 'e_missing', comment: comment('c_lost', A, AT) },
      ],
    };
    const next = apply(s, parts);
    expect(next.expenses.e1.comments.map((c) => c.id)).toEqual(['c_old', 'c_local', 'c_new']);
    expect(next.expenses.e1.comments[1]).toBe(s.expenses.e1.comments[0]);
    expect(next.expenses.e_missing).toBeUndefined();
    expect(next.activity).toBe(s.activity);
    expect(apply(next, parts)).toBe(next);

    // A comment on an expense that arrives in the same batch.
    const withNew = apply(s, {
      expenses: [serverCopy(s.expenses.e1, { id: 'e_new' })],
      comments: [{ expenseId: 'e_new', comment: fresh }],
    });
    expect(withNew.expenses.e_new.comments).toEqual([fresh]);
  });

  it('treats ids such as "constructor" and "toString" as plain ids, never as inherited values', () => {
    const s = withHistory();
    const odd = serverCopy(s.expenses.e1, { id: 'constructor' });
    const note = comment('c_odd', A, AT);
    const oddPayment: Payment = { ...s.payments.pay1, id: 'toString' };
    const next = apply(s, {
      expenses: [odd],
      payments: [oddPayment],
      comments: [
        { expenseId: 'constructor', comment: note },
        { expenseId: 'hasOwnProperty', comment: comment('c_lost', A, AT) },
      ],
    });
    const own = (record: object, id: string): boolean => Object.prototype.hasOwnProperty.call(record, id);
    expect(own(next.expenses, 'constructor')).toBe(true);
    expect(next.expenses['constructor']).toEqual({ ...odd, comments: [note] });
    expect(own(next.expenses, 'hasOwnProperty')).toBe(false);
    expect(own(next.payments, 'toString')).toBe(true);
    expect(next.payments['toString']).toEqual(oddPayment);
    expect(next.expenses.e1).toBe(s.expenses.e1);
    expect(apply(next, { expenses: [odd], comments: [{ expenseId: 'constructor', comment: note }] })).toBe(next);
  });

  it('replaces payments by id', () => {
    const s = withHistory();
    const p2: Payment = { ...s.payments.pay1, id: 'pay2', fromId: ME_ID, toId: B, amount: 50000 };
    const next = apply(s, { payments: [{ ...s.payments.pay1, deletedAt: AT }, p2] });
    expect(next.payments.pay1).toEqual({ ...s.payments.pay1, deletedAt: AT });
    expect(next.payments.pay2).toEqual(p2);
    expect(next.expenses).toBe(s.expenses);
    expect(next.activity).toBe(s.activity);
  });

  it('adds new activity once, re-worded for this phone, newest first', () => {
    const s = withHistory();
    const paid: Payment = { ...s.payments.pay1, id: 'pay_r', amount: 50000, createdAt: '2026-10-03T10:00:00.000Z' };
    const newest = entry('act_r1', {
      type: 'payment_added',
      at: '2026-10-03T10:00:00.000Z',
      groupId: TRIP,
      paymentId: 'pay_r',
      amount: 50000,
      currency: 'INR',
      summary: 'Aarav paid Sam ₹500.00 in Trip.',
    });
    const oldest = entry('act_r0', { type: 'group_created', at: '2026-09-01T09:30:00.000Z', groupId: TRIP, summary: 'Aarav created the group "Trip".' });
    const known = { ...s.activity[1], summary: 'neutral' };
    const next = apply(s, { payments: [paid], activity: [oldest, known, newest, newest] });

    expect(next.activity).toHaveLength(s.activity.length + 2);
    expect(next.activity[0]).toEqual({ ...newest, summary: 'Aarav paid you ₹500.00 in Trip.' });
    expect(next.activity.slice(1, s.activity.length + 1)).toEqual(s.activity);
    expect(next.activity[1]).toBe(s.activity[0]);
    expect(next.activity[next.activity.length - 1]).toEqual({ ...oldest, summary: 'Aarav created the group "Trip".' });
    expect(apply(next, { activity: [oldest, newest] })).toBe(next);
  });

  it('keeps the activity size cap', () => {
    const s = withHistory();
    const filler: Activity[] = [];
    for (let i = 0; i < MAX_ACTIVITY; i++) {
      filler.push(entry(`old_${i}`, { type: 'settings_updated', at: `2026-10-01T${String(23 - Math.floor(i / 60)).padStart(2, '0')}:${String(59 - (i % 60)).padStart(2, '0')}:00.000Z`, actorId: ME_ID }));
    }
    const full: AppState = { ...s, activity: filler };
    const next = apply(full, { activity: [entry('act_new', { type: 'comment_added', expenseId: 'e1', groupId: TRIP, at: AT })] });
    expect(next.activity).toHaveLength(MAX_ACTIVITY);
    expect(next.activity[0].id).toBe('act_new');
    expect(next.activity[0].summary).toBe('Aarav commented on "Dinner".');
    expect(next.activity[MAX_ACTIVITY - 1].id).toBe(`old_${MAX_ACTIVITY - 2}`);

    // Older than everything the cap keeps: nothing changes.
    expect(apply(full, { activity: [entry('act_ancient', { at: '2026-01-01T00:00:00.000Z' })] })).toBe(full);
  });
});

describe('rewordRemoteActivity', () => {
  const s = run(
    withHistory(),
    { type: 'payment/add', id: 'pay_me', input: payment({ fromId: ME_ID, toId: B, amount: 50000 }), ...stamp(T0) },
    { type: 'friend/add', id: D, input: { name: 'Diya' }, ...stamp(T0) },
  );
  const say = (patch: Partial<Activity>): string => rewordRemoteActivity(s, entry('act_x', patch));

  it('says "You" when the entry was made by this phone\'s user', () => {
    expect(say({ actorId: ME_ID, expenseId: 'e1' })).toBe('You added "Dinner" in Trip.');
    expect(say({ actorId: ME_ID, type: 'payment_added', paymentId: 'pay_me' })).toBe('You paid Bhavna ₹500.00 in Trip.');
    expect(say({ actorId: ME_ID, type: 'group_created', groupId: TRIP })).toBe('You created the group "Trip".');
  });

  it('says "you" when someone else paid or added you', () => {
    expect(say({ type: 'payment_added', paymentId: 'pay1' })).toBe('Aarav paid you ₹100.00 in Trip.');
    expect(say({ actorId: B, type: 'payment_added', paymentId: 'pay1' })).toBe('Bhavna recorded a payment in Trip: Aarav paid you ₹100.00.');
    expect(say({ type: 'payment_deleted', paymentId: 'pay1' })).toBe('Aarav deleted a payment from Trip: Aarav paid you ₹100.00.');
    expect(say({ type: 'member_added', groupId: TRIP, personId: ME_ID })).toBe('Aarav added you to Trip.');
  });

  it('re-words every expense, comment, member and group type from the current state', () => {
    expect(say({ actorId: B, type: 'expense_updated', expenseId: 'e1' })).toBe('Bhavna updated "Dinner" in Trip.');
    expect(say({ actorId: B, type: 'expense_deleted', expenseId: 'e1' })).toBe('Bhavna deleted "Dinner" from Trip.');
    expect(say({ actorId: B, type: 'expense_restored', expenseId: 'e1' })).toBe('Bhavna restored "Dinner" in Trip.');
    expect(say({ actorId: C, type: 'comment_added', expenseId: 'e1' })).toBe('Chirag commented on "Dinner".');
    expect(say({ type: 'expense_added', expenseId: 'e_solo' })).toBe('Aarav added "Taxi".');
    expect(say({ type: 'member_added', groupId: TRIP, personId: D })).toBe('Aarav added Diya to Trip.');
    expect(say({ actorId: C, type: 'member_removed', groupId: TRIP, personId: D })).toBe('Chirag removed Diya from Trip.');
    expect(say({ type: 'group_created', groupId: TRIP })).toBe('Aarav created the group "Trip".');
  });

  it('keeps the neutral summary for other types and for anything it can no longer find', () => {
    expect(say({ type: 'group_updated', groupId: TRIP })).toBe('neutral');
    expect(say({ type: 'expense_added', expenseId: 'e_gone' })).toBe('neutral');
    expect(say({ type: 'expense_added' })).toBe('neutral');
    expect(say({ type: 'payment_added', paymentId: 'pay_gone' })).toBe('neutral');
    expect(say({ type: 'member_added', groupId: TRIP })).toBe('neutral');
    expect(say({ type: 'member_added', groupId: TRIP, personId: 'u_ghost' })).toBe('neutral');
    expect(say({ type: 'member_added', groupId: 'g_gone', personId: D })).toBe('neutral');
    expect(say({ type: 'group_created', groupId: 'g_gone' })).toBe('neutral');
    expect(say({ actorId: 'u_ghost', expenseId: 'e1' })).toBe('neutral');
  });
});
