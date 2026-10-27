import { ME_ID } from '../../app/src/types';
import type { Activity, AppState } from '../../app/src/types';
import {
  activityImpact,
  activityTarget,
  activityTimeLabel,
  activityVisual,
  clockTime,
  dayLabel,
  emphasizeQuotes,
  expenseImpactFor,
  groupActivityByDay,
  paymentImpactFor,
} from '../../app/src/screens/activity/activityFeed';
import { A, B, TRIP, equalExpense, makeState, payment, run, stamp } from '../store/fixtures';

/** Local time → ISO timestamp, so day grouping does not depend on the machine's time zone. */
function at(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function entry(id: string, when: string, extra: Partial<Activity> = {}): Activity {
  return { id, type: 'expense_added', at: when, actorId: ME_ID, summary: `Entry ${id}`, ...extra };
}

function withData(): AppState {
  return run(
    makeState(),
    { type: 'expense/add', id: 'e_lent', input: equalExpense({ total: 30000, ids: [ME_ID, A, B] }), ...stamp() },
    { type: 'expense/add', id: 'e_borrowed', input: equalExpense({ total: 9000, ids: [ME_ID, A, B], payer: A }), ...stamp() },
    { type: 'expense/add', id: 'e_other', input: equalExpense({ total: 5000, ids: [A, B], payer: A }), ...stamp() },
    { type: 'payment/add', id: 'pay_in', input: payment({ amount: 10000 }), ...stamp() },
  );
}

describe('activityFeed days', () => {
  const now = new Date(2026, 9, 15, 18, 30);

  it('labels today, yesterday and older days with the weekday', () => {
    expect(dayLabel('2026-10-15', now)).toBe('Today');
    expect(dayLabel('2026-10-14', now)).toBe('Yesterday');
    expect(dayLabel('2026-10-03', now)).toBe('Sat, Oct 3');
    expect(dayLabel('2025-12-31', now)).toBe('Wed, Dec 31, 2025');
    expect(dayLabel('', now)).toBe('Earlier');
  });

  it('groups by local day, newest day first, keeping order inside a day', () => {
    const feed = [
      entry('a', at(2026, 10, 15, 17)),
      entry('b', at(2026, 10, 15, 9)),
      entry('c', at(2026, 10, 14, 23, 59)),
      entry('d', 'not a date'),
      entry('e', at(2026, 10, 1, 8)),
    ];
    const sections = groupActivityByDay(feed, now);
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Yesterday', 'Thu, Oct 1', 'Earlier']);
    expect(sections[0].data.map((x) => x.id)).toEqual(['a', 'b']);
    expect(sections[3].key).toBe('unknown');
    expect(groupActivityByDay([], now)).toEqual([]);
  });

  it('formats clock times and picks relative time only for today', () => {
    expect(clockTime(at(2026, 10, 3, 9, 5))).toBe('9:05 AM');
    expect(clockTime(at(2026, 10, 3, 0, 0))).toBe('12:00 AM');
    expect(clockTime(at(2026, 10, 3, 12, 30))).toBe('12:30 PM');
    expect(clockTime(at(2026, 10, 3, 23, 59))).toBe('11:59 PM');
    expect(clockTime('nope')).toBe('');
    expect(activityTimeLabel(at(2026, 10, 15, 18, 25), now)).toBe('5 min ago');
    expect(activityTimeLabel(at(2026, 10, 14, 21, 0), now)).toBe('9:00 PM');
  });
});

describe('activityFeed impact', () => {
  const state = withData();

  it('says what an expense means for me', () => {
    const lent = expenseImpactFor(state.expenses.e_lent);
    expect(lent.text).toBe('You lent ₹200.00');
    expect(lent.tone).toBe('owed');
    expect(lent.net).toBe(20000);

    const borrowed = expenseImpactFor(state.expenses.e_borrowed);
    expect(borrowed.text).toBe('You borrowed ₹30.00');
    expect(borrowed.tone).toBe('owe');
    expect(borrowed.label).toBe('you borrowed');

    const other = expenseImpactFor(state.expenses.e_other);
    expect(other.text).toBe('You are not involved');
    expect(other.tone).toBe('neutral');
  });

  it('treats paying exactly my share as neutral', () => {
    const s = run(state, {
      type: 'expense/add',
      id: 'e_mine',
      input: equalExpense({ total: 5000, ids: [ME_ID] }),
      ...stamp(),
    });
    expect(expenseImpactFor(s.expenses.e_mine).text).toBe('You paid your share');
  });

  it('says what a payment means for me', () => {
    const received = paymentImpactFor(state.payments.pay_in);
    expect(received.text).toBe('You received ₹100.00');
    expect(received.tone).toBe('owe');
    const paid = paymentImpactFor({ ...state.payments.pay_in, fromId: ME_ID, toId: A });
    expect(paid.text).toBe('You paid ₹100.00');
    expect(paid.tone).toBe('owed');
    expect(paymentImpactFor({ ...state.payments.pay_in, fromId: A, toId: B }).tone).toBe('neutral');
  });

  it('shows impact while the record is live, never for comments, and flags later deletes', () => {
    expect(activityImpact(state, entry('x', at(2026, 10, 1), { expenseId: 'e_lent' }))?.net).toBe(20000);
    expect(activityImpact(state, entry('x', at(2026, 10, 1), { type: 'comment_added', expenseId: 'e_lent' }))).toBeNull();
    expect(activityImpact(state, entry('x', at(2026, 10, 1), { expenseId: 'gone' }))).toBeNull();
    expect(activityImpact(state, entry('x', at(2026, 10, 1), { type: 'payment_added', paymentId: 'pay_in' }))?.net).toBe(-10000);

    const deleted = run(state, { type: 'expense/delete', id: 'e_lent', ...stamp() }, { type: 'payment/delete', id: 'pay_in', ...stamp() });
    const added = activityImpact(deleted, entry('x', at(2026, 10, 1), { expenseId: 'e_lent' }));
    expect(added?.text).toBe('Expense deleted');
    expect(added?.tone).toBe('neutral');
    expect(added?.net).toBe(0);
    expect(activityImpact(deleted, entry('x', at(2026, 10, 1), { type: 'expense_deleted', expenseId: 'e_lent' }))).toBeNull();
    expect(activityImpact(deleted, entry('x', at(2026, 10, 1), { type: 'payment_added', paymentId: 'pay_in' }))?.text).toBe('Payment deleted');
    expect(activityImpact(deleted, entry('x', at(2026, 10, 1), { type: 'payment_deleted', paymentId: 'pay_in' }))).toBeNull();

    const restored = run(deleted, { type: 'expense/restore', id: 'e_lent', ...stamp() });
    expect(activityImpact(restored, entry('x', at(2026, 10, 1), { expenseId: 'e_lent' }))?.net).toBe(20000);
  });
});

describe('activityFeed targets and text', () => {
  const state = withData();

  it('opens expenses and payments (even deleted ones), else the group', () => {
    const deleted = run(state, { type: 'expense/delete', id: 'e_lent', ...stamp() }, { type: 'payment/delete', id: 'pay_in', ...stamp() });
    expect(activityTarget(deleted, entry('x', at(2026, 10, 1), { expenseId: 'e_lent', groupId: TRIP }))).toEqual({
      screen: 'ExpenseDetail',
      params: { expenseId: 'e_lent' },
    });
    expect(activityTarget(state, entry('x', at(2026, 10, 1), { paymentId: 'pay_in', groupId: TRIP }))).toEqual({
      screen: 'PaymentDetail',
      params: { paymentId: 'pay_in' },
    });
    // PaymentDetail shows a deleted payment with a "This payment was deleted" banner.
    expect(activityTarget(deleted, entry('x', at(2026, 10, 1), { type: 'payment_deleted', paymentId: 'pay_in', groupId: TRIP }))).toEqual({
      screen: 'PaymentDetail',
      params: { paymentId: 'pay_in' },
    });
    expect(activityTarget(state, entry('x', at(2026, 10, 1), { paymentId: 'pay_gone', groupId: TRIP }))).toEqual({
      screen: 'GroupDetail',
      params: { groupId: TRIP },
    });
    expect(activityTarget(state, entry('x', at(2026, 10, 1), { expenseId: 'gone', groupId: 'g_gone' }))).toBeNull();
    expect(activityTarget(state, entry('x', at(2026, 10, 1), { type: 'friend_added' }))).toBeNull();
  });

  it('opens the friend for friend entries, also after they were removed', () => {
    let s = run(state, { type: 'friend/add', id: 'p_zoe', input: { name: 'Zoe' }, ...stamp() });
    expect(s.activity[0].personId).toBe('p_zoe');
    expect(activityTarget(s, s.activity[0])).toEqual({ screen: 'FriendDetail', params: { friendId: 'p_zoe' } });
    s = run(s, { type: 'person/update', id: 'p_zoe', patch: { name: 'Zoe K' }, ...stamp() });
    expect(activityTarget(s, s.activity[0])).toEqual({ screen: 'FriendDetail', params: { friendId: 'p_zoe' } });
    s = run(s, { type: 'friend/remove', id: 'p_zoe', ...stamp() });
    expect(s.activity[0].type).toBe('friend_removed');
    expect(activityTarget(s, s.activity[0])).toEqual({ screen: 'FriendDetail', params: { friendId: 'p_zoe' } });
    // My own profile edits have nowhere to go; unknown people neither.
    s = run(s, { type: 'person/update', id: ME_ID, patch: { name: 'Sam' }, ...stamp() });
    expect(activityTarget(s, s.activity[0])).toBeNull();
    expect(activityTarget(s, entry('x', at(2026, 10, 1), { type: 'friend_added', personId: 'p_nobody' }))).toBeNull();
  });

  it('has an icon for every activity type', () => {
    expect(activityVisual('expense_added').icon).toBe('receipt-outline');
    expect(activityVisual('payment_added').icon).toBe('cash-outline');
    expect(activityVisual('comment_added').icon).toBe('chatbubble-outline');
    expect(activityVisual('expense_deleted').icon).toBe('trash-outline');
    expect(activityVisual('expense_restored').icon).toBe('refresh-outline');
  });

  it('splits quoted names out of a summary for bold text', () => {
    expect(emphasizeQuotes('You added "Dinner" in "Goa Trip".')).toEqual([
      { text: 'You added ', emphasis: false },
      { text: '"Dinner"', emphasis: true },
      { text: ' in ', emphasis: false },
      { text: '"Goa Trip"', emphasis: true },
      { text: '.', emphasis: false },
    ]);
    expect(emphasizeQuotes('No quotes here')).toEqual([{ text: 'No quotes here', emphasis: false }]);
    expect(emphasizeQuotes('')).toEqual([]);
  });
});
