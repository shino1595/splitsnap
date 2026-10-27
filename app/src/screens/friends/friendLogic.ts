// Pure helpers for the Friends screens (no React): list rows and filters, the balance
// between me and a friend on one expense, the reminder message and light field checks.
import { ME_ID } from '../../types';
import type { AppState, CurrencyAmounts, CurrencyCode, Expense, ID, Minor, Person } from '../../types';
import { balanceBetween, isSettled, pairwiseDebts } from '../../lib/balances';
import { compareCurrencyCodes, formatCurrencyAmounts, formatMoney } from '../../lib/money';
import { balancesWithEveryone, expenseGroupName, listFriends, personName } from '../../store/selectors';

export type FriendFilter = 'all' | 'owesYou' | 'youOwe' | 'settled';

export const FRIEND_FILTERS: { value: FriendFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owesYou', label: 'Owe you' },
  { value: 'youOwe', label: 'You owe' },
  { value: 'settled', label: 'Settled' },
];

export interface FriendRow {
  person: Person;
  /** + = they owe me, per currency (zero currencies dropped). */
  balance: CurrencyAmounts;
}

/**
 * Friends by name, plus anyone else I still have a balance with (e.g. a removed friend
 * who is in a shared group), so the list always adds up to the overall balance.
 */
export function friendRows(state: AppState): FriendRow[] {
  const balances = balancesWithEveryone(state);
  const rows: FriendRow[] = listFriends(state).map((person) => ({ person, balance: balances[person.id] || {} }));
  const listed = new Set(rows.map((r) => r.person.id));
  const extra = Object.keys(balances)
    .filter((id) => id !== ME_ID && !listed.has(id) && !!state.people[id])
    .map((id) => ({ person: state.people[id], balance: balances[id] }))
    .sort((a, b) => a.person.name.toLowerCase().localeCompare(b.person.name.toLowerCase()));
  return rows.concat(extra);
}

export function matchesFilter(balance: CurrencyAmounts, filter: FriendFilter): boolean {
  const values = Object.keys(balance).map((c) => balance[c]);
  switch (filter) {
    case 'owesYou':
      return values.some((v) => v > 0);
    case 'youOwe':
      return values.some((v) => v < 0);
    case 'settled':
      return isSettled(balance);
    default:
      return true;
  }
}

export function filterCounts(rows: FriendRow[]): Record<FriendFilter, number> {
  const counts: Record<FriendFilter, number> = { all: 0, owesYou: 0, youOwe: 0, settled: 0 };
  for (const row of rows) {
    for (const f of FRIEND_FILTERS) if (matchesFilter(row.balance, f.value)) counts[f.value] += 1;
  }
  return counts;
}

/** Only the positive (sign 1) or negative (sign −1) amounts, as absolute values. */
export function sidePart(amounts: CurrencyAmounts, sign: number): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const c of Object.keys(amounts)) if (amounts[c] * sign > 0) out[c] = Math.abs(amounts[c]);
  return out;
}

/**
 * Amounts as display lines, one per currency, so a narrow column never breaks in the middle
 * of '₹3,355.11 + $18.00': ['₹3,355.11', '+ $18.00']. Absolute values; zeros skipped.
 */
export function amountLines(amounts: CurrencyAmounts): string[] {
  return formatCurrencyAmounts(amounts, { abs: true })
    .split(' + ')
    .filter(Boolean)
    .map((text, index) => (index === 0 ? text : `+ ${text}`));
}

/**
 * The currency to settle first: the largest absolute balance; on a tie the preferred
 * currency, then the usual currency order. null when everything is settled.
 */
export function mainCurrency(amounts: CurrencyAmounts, preferred?: CurrencyCode): CurrencyCode | null {
  const codes = Object.keys(amounts).filter((c) => amounts[c] !== 0);
  if (codes.length === 0) return null;
  codes.sort((a, b) => {
    const diff = Math.abs(amounts[b]) - Math.abs(amounts[a]);
    if (diff !== 0) return diff;
    if (a === preferred) return -1;
    if (b === preferred) return 1;
    return compareCurrencyCodes(a, b);
  });
  return codes[0];
}

/** What `friendId` owes me because of this one expense (+), or I owe them (−); 0 if it doesn't touch us both. */
export function pairAmountForExpense(expense: Expense, friendId: ID): Minor {
  const debts = pairwiseDebts([expense], []);
  return balanceBetween(debts, ME_ID, friendId)[expense.currency] || 0;
}

/** 'Aarav paid ₹1,460.00' / 'you paid ₹600.00' / '2 people paid ₹900.00'. */
export function payerSummary(state: AppState, expense: Expense): string {
  const total = formatMoney(expense.total, expense.currency);
  if (expense.payers.length === 1) return `${personName(state, expense.payers[0].personId, { you: 'you' })} paid ${total}`;
  if (expense.payers.length > 1) return `${expense.payers.length} people paid ${total}`;
  return total;
}

/** Group label for a timeline row: the group name, or '' for non-group expenses. */
export function groupLabel(state: AppState, groupId: ID | null): string {
  return groupId === null ? '' : expenseGroupName(state, { groupId });
}

/**
 * Friendly reminder for what `friendId` owes me (only the currencies they owe in), with the
 * per-group breakdown and my UPI ID when I have one. null when they don't owe me anything.
 */
export function reminderMessage(
  state: AppState,
  friendId: ID,
  balance: CurrencyAmounts,
  byGroup: { groupId: ID | null; amounts: CurrencyAmounts }[],
): string | null {
  const owed = sidePart(balance, 1);
  const total = formatCurrencyAmounts(owed);
  if (!total) return null;
  const first = personName(state, friendId).split(/\s+/)[0] || 'there';
  const lines = [`Hi ${first}! Just a friendly reminder that you owe me ${total} on SplitSnap.`];

  const parts = byGroup
    .map((row) => ({ name: row.groupId === null ? 'non-group expenses' : expenseGroupName(state, row), text: formatCurrencyAmounts(sidePart(row.amounts, 1)) }))
    .filter((p) => p.text !== '');
  if (parts.length > 1) lines.push(`(${parts.map((p) => `${p.name}: ${p.text}`).join(', ')})`);

  const me = state.people[ME_ID];
  const myUpi = me && me.upiId ? me.upiId.trim() : '';
  if (myUpi && owed.INR) lines.push(`You can pay me by UPI at ${myUpi}.`);
  lines.push('Thanks!');
  return lines.join('\n');
}

// ---------- Field checks (deliberately light) ----------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** UPI VPA: handle@bank, e.g. 'aarav@okicici', 'name.surname-1@ybl', '9820011111@paytm'. */
const UPI_ID = /^[a-zA-Z0-9._-]{1,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const PHONE_CHARS = /^[0-9+()\-.\s]{5,20}$/;

export function isValidEmail(text: string): boolean {
  return EMAIL.test(text.trim());
}

export function isValidUpiId(text: string): boolean {
  return UPI_ID.test(text.trim());
}

export function isValidPhone(text: string): boolean {
  const t = text.trim();
  return PHONE_CHARS.test(t) && t.replace(/\D/g, '').length >= 5;
}

export interface FriendForm {
  name: string;
  email: string;
  phone: string;
  upiId: string;
}

export type FriendFormErrors = Partial<Record<keyof FriendForm, string>>;

/** Field errors for the add / edit friend form; empty optional fields are fine. */
export function validateFriendForm(form: FriendForm): FriendFormErrors {
  const errors: FriendFormErrors = {};
  if (!form.name.trim()) errors.name = 'Enter a name';
  if (form.email.trim() && !isValidEmail(form.email)) errors.email = 'This doesn’t look like an email address';
  if (form.phone.trim() && !isValidPhone(form.phone)) errors.phone = 'Use digits, spaces and + only';
  if (form.upiId.trim() && !isValidUpiId(form.upiId)) errors.upiId = 'A UPI ID looks like name@bank';
  return errors;
}

/** Label for the remove button: the full name when it fits, else a generic one. */
export function removeButtonTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed && trimmed.length <= 18 ? `Remove ${trimmed}` : 'Remove this friend';
}

/** Another friend with the same name (case-insensitive), to warn about duplicates. */
export function sameNameFriend(state: AppState, name: string, exceptId?: ID): Person | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  return listFriends(state).find((p) => p.id !== exceptId && p.name.trim().toLowerCase() === wanted);
}
