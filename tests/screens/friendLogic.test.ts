import { ME_ID } from '../../app/src/types';
import type { AppState, ExpenseInput } from '../../app/src/types';
import { friendBalance, friendBalanceByGroup } from '../../app/src/store/selectors';
import {
  amountLines,
  filterCounts,
  friendRows,
  isValidEmail,
  isValidPhone,
  isValidUpiId,
  mainCurrency,
  matchesFilter,
  pairAmountForExpense,
  payerSummary,
  reminderMessage,
  removeButtonTitle,
  sameNameFriend,
  validateFriendForm,
} from '../../app/src/screens/friends/friendLogic';
import { A, B, C, equalExpense, makeState, run, stamp } from '../store/fixtures';

let n = 0;

function addExpense(state: AppState, input: ExpenseInput): AppState {
  n += 1;
  return run(state, { type: 'expense/add', id: `fe_${n}`, input, ...stamp() });
}

describe('friendLogic', () => {
  /** A owes me ₹100 (Trip), I owe B ₹50 (non-group), C settled. */
  function sample(): AppState {
    let s = makeState();
    s = addExpense(s, equalExpense({ ids: [ME_ID, A], total: 20000 }));
    s = addExpense(s, equalExpense({ groupId: null, ids: [ME_ID, B], total: 10000, payer: B }));
    return s;
  }

  it('lists friends with their balance and filters them', () => {
    const rows = friendRows(sample());
    expect(rows.map((r) => [r.person.name, r.balance])).toEqual([
      ['Aarav', { INR: 10000 }],
      ['Bhavna', { INR: -5000 }],
      ['Chirag', {}],
    ]);
    expect(filterCounts(rows)).toEqual({ all: 3, owesYou: 1, youOwe: 1, settled: 1 });
    expect(matchesFilter({ INR: 100, USD: -5 }, 'owesYou')).toBe(true);
    expect(matchesFilter({ INR: 100, USD: -5 }, 'youOwe')).toBe(true);
    expect(matchesFilter({}, 'settled')).toBe(true);
    expect(matchesFilter({ INR: 1 }, 'settled')).toBe(false);
  });

  it('keeps people with a balance who are no longer friends', () => {
    const s = sample();
    const removed: AppState = { ...s, friendIds: s.friendIds.filter((id) => id !== A) };
    expect(friendRows(removed).map((r) => r.person.id)).toEqual([B, C, A]);
  });

  it('picks the main currency by size, then the preferred one', () => {
    expect(mainCurrency({})).toBeNull();
    expect(mainCurrency({ INR: 0 })).toBeNull();
    expect(mainCurrency({ INR: 500, USD: -900 })).toBe('USD');
    expect(mainCurrency({ USD: 500, INR: -500 }, 'INR')).toBe('INR');
    expect(mainCurrency({ EUR: 500, USD: -500 })).toBe('USD');
  });

  it('works out the balance between me and a friend on one expense', () => {
    let s = makeState();
    s = addExpense(s, equalExpense({ ids: [ME_ID, A, B], total: 30000 }));
    s = addExpense(s, equalExpense({ ids: [ME_ID, A, B], total: 30000, payer: A }));
    s = addExpense(s, equalExpense({ ids: [A, B], total: 9000, payer: B }));
    const [first, second, third] = Object.values(s.expenses).sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(pairAmountForExpense(first, A)).toBe(10000);
    expect(pairAmountForExpense(second, A)).toBe(-10000);
    expect(pairAmountForExpense(third, A)).toBe(0);
    expect(payerSummary(s, first)).toBe('you paid ₹300.00');
    expect(payerSummary(s, second)).toBe('Aarav paid ₹300.00');
  });

  it('writes a reminder only for what the friend owes me', () => {
    let s = sample();
    s = addExpense(s, equalExpense({ groupId: null, ids: [ME_ID, A], total: 4000 }));
    const msg = reminderMessage(s, A, friendBalance(s, A), friendBalanceByGroup(s, A));
    expect(msg).toContain('Hi Aarav!');
    expect(msg).toContain('you owe me ₹120.00');
    expect(msg).toContain('Trip: ₹100.00');
    expect(msg).toContain('non-group expenses: ₹20.00');
    expect(reminderMessage(s, B, friendBalance(s, B), friendBalanceByGroup(s, B))).toBeNull();
    expect(reminderMessage(s, C, {}, [])).toBeNull();

    const withUpi: AppState = { ...s, people: { ...s.people, [ME_ID]: { ...s.people[ME_ID], upiId: 'me@okhdfc' } } };
    expect(reminderMessage(withUpi, A, friendBalance(s, A), [])).toContain('UPI at me@okhdfc');
  });

  it('checks the friend form lightly', () => {
    expect(isValidUpiId('aarav@okicici')).toBe(true);
    expect(isValidUpiId(' name.surname-1@ybl ')).toBe(true);
    expect(isValidUpiId('9820011111@paytm')).toBe(true);
    expect(isValidUpiId('aarav')).toBe(false);
    expect(isValidUpiId('a@b')).toBe(false);
    expect(isValidUpiId('aarav@ok icici')).toBe(false);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidPhone('+91 98200 11111')).toBe(true);
    expect(isValidPhone('call me')).toBe(false);

    expect(validateFriendForm({ name: ' ', email: '', phone: '', upiId: '' })).toEqual({ name: 'Enter a name' });
    expect(Object.keys(validateFriendForm({ name: 'X', email: 'x', phone: 'abc', upiId: 'x' }))).toEqual(['email', 'phone', 'upiId']);
    expect(validateFriendForm({ name: 'X', email: '', phone: '', upiId: 'x@okaxis' })).toEqual({});
  });

  it('splits multi-currency amounts into one line per currency', () => {
    expect(amountLines({})).toEqual([]);
    expect(amountLines({ INR: 0 })).toEqual([]);
    expect(amountLines({ INR: 335511 })).toEqual(['₹3,355.11']);
    expect(amountLines({ USD: 1800, INR: 335511 })).toEqual(['₹3,355.11', '+ $18.00']);
    expect(amountLines({ INR: -76389 })).toEqual(['₹763.89']);
  });

  it('keeps the remove button label short', () => {
    expect(removeButtonTitle('Aarav')).toBe('Remove Aarav');
    expect(removeButtonTitle('Maximilian Alexander Konstantinopoulos')).toBe('Remove this friend');
  });

  it('spots a friend with the same name', () => {
    const s = makeState();
    expect(sameNameFriend(s, ' aarav ')?.id).toBe(A);
    expect(sameNameFriend(s, 'Aarav', A)).toBeUndefined();
    expect(sameNameFriend(s, '')).toBeUndefined();
  });
});
