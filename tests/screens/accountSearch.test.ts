import { ME_ID } from '../../app/src/types';
import type { AppState, ExpenseInput } from '../../app/src/types';
import { blankState } from '../../app/src/store/stateShape';
import { searchExpenses } from '../../app/src/store/selectors';
import {
  accountStats,
  buildFullExport,
  cleanOcrKey,
  csvPersonIds,
  currencyLabel,
  currencyOptions,
  emailError,
  hasOwnOcrKey,
  scanningSummary,
} from '../../app/src/screens/account/accountData';
import { matchHint, paidByText, searchTerms, snippetAround } from '../../app/src/screens/search/searchHints';
import { A, B, C, TRIP, equalExpense, makeState, payment, run, stamp } from '../store/fixtures';

function dinnerBill(): ExpenseInput {
  return equalExpense({
    description: 'Dinner at Punjab Grill',
    total: 78000,
    payer: B,
    notes: 'Bhavna kept the paper bill in her wallet for the office reimbursement claim next month',
    split: {
      method: 'itemized',
      bill: {
        merchant: 'Punjab Grill',
        items: [
          { id: 'i_naan', name: 'Naan', quantity: 6, amount: 36000, shares: { [A]: 1, [B]: 1 } },
          { id: 'i_bc', name: 'Butter Chicken', quantity: 1, amount: 42000, shares: { [ME_ID]: 1 } },
        ],
        charges: [],
      },
    },
  });
}

function withData(): AppState {
  return run(
    makeState(),
    { type: 'expense/add', id: 'e_taxi', input: equalExpense({ description: 'Taxi', total: 30000, ids: [ME_ID, A, B] }), ...stamp() },
    { type: 'expense/add', id: 'e_dinner', input: dinnerBill(), ...stamp() },
    { type: 'expense/add', id: 'e_usd', input: equalExpense({ description: 'Snorkel', currency: 'USD', total: 4000, ids: [ME_ID, C] }), ...stamp() },
    { type: 'expense/add', id: 'e_gone', input: equalExpense({ description: 'Mistake', total: 1000 }), ...stamp() },
    { type: 'expense/delete', id: 'e_gone', ...stamp() },
    { type: 'payment/add', id: 'pay_1', input: payment({ fromId: C, toId: ME_ID, amount: 5000 }), ...stamp() },
  );
}

describe('accountData', () => {
  const state = withData();

  it('counts live records and what I paid and owe per currency', () => {
    const stats = accountStats(state);
    expect(stats.groups).toBe(1);
    expect(stats.archivedGroups).toBe(0);
    expect(stats.friends).toBe(3);
    expect(stats.expenses).toBe(3);
    expect(stats.youPaid).toEqual({ INR: 30000, USD: 4000 });
    expect(stats.yourShare).toEqual({ INR: 10000 + 42000, USD: 2000 });
  });

  it('counts archived groups separately', () => {
    const archived = run(state, { type: 'group/update', id: TRIP, patch: { archived: true }, ...stamp() });
    const stats = accountStats(archived);
    expect(stats.groups).toBe(0);
    expect(stats.archivedGroups).toBe(1);
  });

  it('exports everyone involved, me first, then by name', () => {
    expect(csvPersonIds(state)).toEqual([ME_ID, A, B, C]);
    const file = buildFullExport(state, '2026-10-15');
    expect(file?.filename).toBe('splitsnap-2026-10-15.csv');
    expect(file?.count).toBe(4);
    expect(file?.csv).toContain('Taxi');
    expect(file?.csv).not.toContain('Mistake');
    expect(buildFullExport(blankState('2026-10-01T00:00:00.000Z'), '2026-10-15')).toBeNull();
  });

  it('checks emails loosely and allows an empty one', () => {
    expect(emailError('')).toBeNull();
    expect(emailError('  priya@example.com ')).toBeNull();
    expect(emailError('priya@example')).toBeTruthy();
    expect(emailError('priya example.com')).toBeTruthy();
  });

  it('lists currencies with an unknown current code first', () => {
    const known = currencyOptions('INR');
    expect(known[0].value).toBe('INR');
    expect(known.some((o) => o.value === 'XYZ')).toBe(false);
    expect(currencyOptions('XYZ')[0]).toEqual({ value: 'XYZ', label: 'XYZ', subtitle: '' });
    expect(currencyLabel('INR')).toBe('INR · Indian Rupee');
    expect(currencyLabel('XYZ')).toBe('XYZ');
  });

  it('describes the OCR set-up and cleans pasted keys', () => {
    expect(hasOwnOcrKey({ ocrApiKey: '' })).toBe(false);
    expect(hasOwnOcrKey({ ocrApiKey: '  ' })).toBe(false);
    expect(scanningSummary({ ocrApiKey: '', ocrEngine: 2 })).toBe('Shared demo key · Engine 2');
    expect(scanningSummary({ ocrApiKey: 'K812345', ocrEngine: 3 })).toBe('Your OCR.space key · Engine 3');
    expect(cleanOcrKey(' K8123 45\n')).toBe('K812345');
  });
});

describe('searchHints', () => {
  const state = withData();

  it('splits a query into lower-case words', () => {
    expect(searchTerms('  Butter   CHICKEN ')).toEqual(['butter', 'chicken']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('cuts a snippet around the first match', () => {
    const text = 'Bhavna kept the paper bill in her wallet for the office reimbursement claim next month';
    const snippet = snippetAround(text, ['reimbursement'], 40);
    expect(snippet).toContain('reimbursement');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(42);
    expect(snippetAround('short text', ['x'])).toBe('short text');
  });

  it('explains why a result matched when the description does not', () => {
    const dinner = state.expenses.e_dinner;
    expect(matchHint(state, dinner, 'dinner')).toBeNull();
    expect(matchHint(state, dinner, 'naan')).toBe('Item: Naan');
    expect(matchHint(state, dinner, 'reimbursement')).toContain('Note: ');
    expect(matchHint(state, state.expenses.e_taxi, 'aarav')).toBe('With Aarav');
    expect(matchHint(state, state.expenses.e_taxi, '')).toBeNull();
  });

  it('agrees with searchExpenses on what matches', () => {
    expect(searchExpenses(state, 'naan').map((e) => e.id)).toEqual(['e_dinner']);
    expect(searchExpenses(state, 'mistake')).toEqual([]);
  });

  it('summarises who paid', () => {
    expect(paidByText(state, state.expenses.e_taxi)).toBe('You paid ₹300.00');
    expect(paidByText(state, state.expenses.e_dinner)).toBe('Bhavna paid ₹780.00');
  });
});
