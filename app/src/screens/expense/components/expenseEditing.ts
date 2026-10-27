// Pure helpers for the expense editor screens (AddExpense, SplitOptions, PaidBy).
// No React or react-native here, so everything can be unit-tested.
import { ME_ID } from '../../../types';
import type {
  AppState,
  CurrencyCode,
  ID,
  ISODate,
  Minor,
  MoneyShare,
  Person,
  Recurrence,
  RecurrenceFrequency,
  SplitInput,
  SplitMethod,
} from '../../../types';
import { computeItemized, itemizedTotal } from '../../../lib/itemized';
import { formatMoney, minorToInputText, parseAmountInput, splitEvenly, sumMinor } from '../../../lib/money';
import { nextOccurrenceAfter } from '../../../lib/recurrence';
import { computeOwed } from '../../../lib/split';
import { listFriends } from '../../../store/selectors';
import { splitErrors } from '../../../store/draftLogic';

// ---------- Navigation ----------

/** Routes that belong to the expense editor flow. */
export const EDITOR_ROUTES: readonly string[] = ['AddExpense', 'SplitOptions', 'PaidBy', 'ScanBill', 'ItemizedSplit'];

/**
 * How many routes to pop, from the focused route at `index`, to get back to the screen the
 * editor was opened from (GroupDetail, FriendDetail, ExpenseDetail, the tabs…).
 * -1 when every route down to the bottom of the stack belongs to the editor.
 */
export function editorExitCount(routeNames: readonly string[], index: number): number {
  let target = index;
  while (target >= 0 && EDITOR_ROUTES.indexOf(routeNames[target]) >= 0) target -= 1;
  return target < 0 ? -1 : index - target;
}

// ---------- Numbers in text boxes ----------

/** '12.5', '12,5', ' 3 ' → number; '' → 0; anything unreadable → null. */
export function parseDecimal(text: string): number | null {
  const s = text.replace(/\s+/g, '').replace(',', '.');
  if (!s) return 0;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}

/** 12.5 → '12.5', 33.3333 → '33.333', 0 → '' (blank box). */
export function decimalText(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '';
  return String(Math.round(n * 1000) / 1000);
}

export { limitDecimals } from '../../../lib/money';

/** Why the typed total can't be used, in plain words; null when it is a valid amount above zero. */
export function amountProblem(text: string, currency: CurrencyCode): string | null {
  if (!text.trim()) return 'Enter an amount';
  const parsed = parseAmountInput(text, currency);
  if (parsed === null) {
    const whole = text.split(/[.]/)[0].replace(/\D/g, '').replace(/^0+/, '');
    return whole.length > 13 ? 'That amount is too large' : 'Enter a valid amount, like 1250.50';
  }
  return parsed > 0 ? null : 'Enter an amount above zero';
}

/** Minor units from an amount box: '' → 0, unreadable → null. '+'/'-' only when allowNegative. */
export function parseMinorText(text: string, currency: CurrencyCode, allowNegative = false): Minor | null {
  if (!text.trim()) return 0;
  return parseAmountInput(text, currency, { allowNegative });
}

function sumValues(record: Record<ID, number>): number {
  return Object.keys(record).reduce((acc, id) => acc + (Number.isFinite(record[id]) ? record[id] : 0), 0);
}

/** Drops repeated messages, keeping the first occurrence (draft and store errors overlap). */
export function uniqueMessages(messages: string[]): string[] {
  return messages.filter((m, i) => !!m && messages.indexOf(m) === i);
}

/** True for the messages validatePayers produces. */
export function isPayerMessage(message: string): boolean {
  return /payer|who paid/i.test(message);
}

// ---------- Split editing (SplitOptions) ----------

export type NumericMethod = 'exact' | 'percent' | 'shares' | 'adjustment';
export type SplitTexts = Record<ID, string>;

export function isNumericMethod(method: SplitMethod): method is NumericMethod {
  return method === 'exact' || method === 'percent' || method === 'shares' || method === 'adjustment';
}

/** Box text for each person when a split is opened in the editor (blank = zero). */
export function textsFromSplit(split: SplitInput, ids: ID[], currency: CurrencyCode): SplitTexts {
  const texts: SplitTexts = {};
  for (const id of ids) {
    let text = '';
    if (split.method === 'exact') {
      const v = split.amounts[id] ?? 0;
      text = v ? minorToInputText(v, currency) : '';
    } else if (split.method === 'percent') {
      text = decimalText(split.percents[id] ?? 0);
    } else if (split.method === 'shares') {
      text = decimalText(split.shares[id] ?? 0);
    } else if (split.method === 'adjustment') {
      const v = split.adjustments[id] ?? 0;
      text = v ? `${v > 0 ? '+' : ''}${minorToInputText(v, currency)}` : '';
    }
    texts[id] = text;
  }
  return texts;
}

export interface EditedSplit {
  split: SplitInput;
  /** People whose box holds something that is not a number. */
  invalidIds: ID[];
}

/** The split described by the editor's boxes. Blank boxes count as zero and are left out. */
export function splitFromTexts(method: NumericMethod, texts: SplitTexts, ids: ID[], currency: CurrencyCode): EditedSplit {
  const invalidIds: ID[] = [];
  const values: Record<ID, number> = {};
  for (const id of ids) {
    const text = texts[id] ?? '';
    const value =
      method === 'exact' || method === 'adjustment'
        ? parseMinorText(text, currency, method === 'adjustment')
        : parseDecimal(text);
    if (value === null) invalidIds.push(id);
    else if (value !== 0) values[id] = value;
  }
  switch (method) {
    case 'exact':
      return { split: { method: 'exact', amounts: values }, invalidIds };
    case 'percent':
      return { split: { method: 'percent', percents: values }, invalidIds };
    case 'shares':
      return { split: { method: 'shares', shares: values }, invalidIds };
    default:
      return { split: { method: 'adjustment', participantIds: [...ids], adjustments: values }, invalidIds };
  }
}

/** Adds or removes `id`, keeping the participants' display order. */
export function toggleInOrder(selected: ID[], id: ID, order: ID[]): ID[] {
  const on = selected.indexOf(id) >= 0;
  return order.filter((x) => (x === id ? !on : selected.indexOf(x) >= 0));
}

export type StatusTone = 'ok' | 'warn' | 'neutral';

export interface EditorStatus {
  /** Short live footer text, e.g. '₹40.00 left', '10% left', 'Total shares: 5'. */
  text: string;
  tone: StatusTone;
  valid: boolean;
  /** Why Done is disabled. */
  reason?: string;
}

function ok(text: string, tone: StatusTone = 'ok'): EditorStatus {
  return { text, tone, valid: true };
}

function blocked(text: string, reason: string): EditorStatus {
  return { text, tone: 'warn', valid: false, reason };
}

function people(n: number): string {
  return n === 1 ? '1 person' : `${n} people`;
}

/** The live footer for one split method (before input errors are considered). */
function methodStatus(split: SplitInput, total: Minor | null, currency: CurrencyCode): EditorStatus {
  const money = (v: Minor) => formatMoney(v, currency);
  switch (split.method) {
    case 'equal': {
      const n = split.participantIds.length;
      if (n === 0) return blocked('No one selected', 'Choose at least one person to split with');
      if (total === null) return ok(people(n), 'neutral');
      const parts = splitEvenly(total, n);
      const hi = parts[0];
      const lo = parts[n - 1];
      return ok(hi === lo ? `${money(hi)} per person` : `${money(lo)}–${money(hi)} per person`);
    }
    case 'exact': {
      const sum = sumValues(split.amounts);
      if (total === null) {
        return sum > 0 ? ok(`Total ${money(sum)}`, 'neutral') : blocked('Nothing entered yet', 'Enter at least one amount');
      }
      const diff = total - sum;
      if (diff > 0) return blocked(`${money(diff)} left`, `${money(diff)} left to assign`);
      if (diff < 0) return blocked(`${money(-diff)} over`, `${money(-diff)} over the total`);
      return ok(`${money(sum)} of ${money(total)}`);
    }
    case 'percent': {
      const diff = 100 - sumValues(split.percents);
      if (diff > 0.001) return blocked(`${decimalText(diff)}% left`, `${decimalText(diff)}% left to assign`);
      if (diff < -0.001) return blocked(`${decimalText(-diff)}% over`, `${decimalText(-diff)}% over 100%`);
      return ok('100% assigned');
    }
    case 'shares': {
      const sum = sumValues(split.shares);
      if (!(sum > 0)) return blocked('Total shares: 0', 'Give at least one person a share');
      return ok(`Total shares: ${decimalText(sum)}`);
    }
    case 'adjustment': {
      if (total === null) return blocked('No total yet', 'Enter the total amount first');
      const base = total - sumValues(split.adjustments);
      if (base < 0) return blocked(`${money(-base)} over`, `Adjustments are ${money(-base)} more than the total`);
      return ok(`${money(base)} shared equally by ${people(split.participantIds.length)}`, 'neutral');
    }
    case 'itemized': {
      if (split.bill.items.length === 0) return blocked('No items yet', 'Add the bill items first');
      const result = computeItemized(split.bill);
      if (result.unassignedItemIds.length > 0) {
        const left = sumMinor(
          split.bill.items.filter((i) => result.unassignedItemIds.indexOf(i.id) >= 0).map((i) => i.amount),
        );
        return blocked(`${money(left)} not assigned`, 'Assign every item to at least one person');
      }
      return ok(`Bill total ${money(result.total)}`);
    }
    default:
      return blocked('', 'Choose how to split');
  }
}

/**
 * The amount a split is checked against: the bill total when itemized, the typed sum for
 * exact amounts entered before any total, otherwise the draft total (null = none yet).
 */
export function effectiveSplitTotal(split: SplitInput, total: Minor | null): Minor | null {
  if (split.method === 'itemized') return split.bill.items.length > 0 ? itemizedTotal(split.bill) : null;
  if (split.method === 'exact' && total === null) {
    const sum = sumValues(split.amounts);
    return sum > 0 ? sum : null;
  }
  return total;
}

/** Footer text plus whether Done is allowed (and why not), for the split being edited. */
export function splitEditorStatus(
  split: SplitInput,
  total: Minor | null,
  currency: CurrencyCode,
  invalidNames: string[] = [],
): EditorStatus {
  const status = methodStatus(split, total, currency);
  if (invalidNames.length > 0) {
    return { ...status, tone: 'warn', valid: false, reason: `Check the number for ${invalidNames.join(', ')}` };
  }
  if (!status.valid) return status;
  const checkTotal = effectiveSplitTotal(split, total);
  if (checkTotal === null) return status;
  const errors = splitErrors(checkTotal, split, currency);
  return errors.length > 0 ? { ...status, tone: 'warn', valid: false, reason: errors[0] } : status;
}

/**
 * What each person owes under `split` (for row captions); empty without a total, and empty when
 * the best-effort result has negative amounts (e.g. adjustments larger than the total).
 */
export function owedPreview(split: SplitInput, total: Minor | null, currency: CurrencyCode): Record<ID, Minor> {
  const out: Record<ID, Minor> = {};
  const checkTotal = effectiveSplitTotal(split, total);
  if (checkTotal === null) return out;
  const owed = computeOwed(checkTotal, split, currency).owed;
  if (owed.some((share) => share.amount < 0)) return out;
  for (const share of owed) out[share.personId] = share.amount;
  return out;
}

// ---------- Paid by ----------

/** Box text per person for "Multiple people", starting from the draft's payers. */
export function payerTexts(payers: MoneyShare[] | null, ids: ID[], total: Minor | null, currency: CurrencyCode): SplitTexts {
  const texts: SplitTexts = {};
  for (const id of ids) texts[id] = '';
  const list = payers && payers.length > 0 ? payers : [{ personId: ME_ID, amount: total ?? 0 }];
  if (list.length === 1) {
    const amount = total ?? list[0].amount;
    texts[list[0].personId] = amount > 0 ? minorToInputText(amount, currency) : '';
    return texts;
  }
  for (const p of list) texts[p.personId] = p.amount ? minorToInputText(p.amount, currency) : '';
  return texts;
}

export interface EditedPayers {
  /** Only people who paid something. */
  payers: MoneyShare[];
  sum: Minor;
  invalidIds: ID[];
}

export function payersFromTexts(texts: SplitTexts, ids: ID[], currency: CurrencyCode): EditedPayers {
  const payers: MoneyShare[] = [];
  const invalidIds: ID[] = [];
  for (const id of ids) {
    const amount = parseMinorText(texts[id] ?? '', currency);
    if (amount === null) invalidIds.push(id);
    else if (amount > 0) payers.push({ personId: id, amount });
  }
  return { payers, sum: sumMinor(payers.map((p) => p.amount)), invalidIds };
}

/** Draft form of a payer list: nobody or just me → null ("paid by you"). */
export function normalizePayers(payers: MoneyShare[]): MoneyShare[] | null {
  if (payers.length === 0) return null;
  if (payers.length === 1 && payers[0].personId === ME_ID) return null;
  return payers.map((p) => ({ personId: p.personId, amount: p.amount }));
}

/** Live footer for "Multiple people": '₹40.00 left' / '₹10.00 over' / 'Adds up to ₹1,000.00'. */
export function payerEditorStatus(
  edited: EditedPayers,
  total: Minor | null,
  currency: CurrencyCode,
  invalidNames: string[] = [],
): EditorStatus {
  const money = (v: Minor) => formatMoney(v, currency);
  let status: EditorStatus;
  if (total === null) {
    status = edited.sum > 0 ? ok(`Total paid ${money(edited.sum)}`, 'neutral') : blocked('Nothing entered yet', 'Enter how much each person paid');
  } else {
    const diff = total - edited.sum;
    if (diff > 0) status = blocked(`${money(diff)} left`, `${money(diff)} of the total still needs a payer`);
    else if (diff < 0) status = blocked(`${money(-diff)} over`, `${money(-diff)} over the total`);
    else status = ok(`Adds up to ${money(total)}`);
  }
  if (invalidNames.length > 0) {
    return { ...status, tone: 'warn', valid: false, reason: `Check the amount for ${invalidNames.join(', ')}` };
  }
  return status;
}

// ---------- The "Paid by you and split equally" sentence ----------

const SPLIT_WORDS: Record<SplitMethod, string> = {
  equal: 'equally',
  exact: 'by exact amounts',
  percent: 'by percentages',
  shares: 'by shares',
  adjustment: 'with adjustments',
  itemized: 'item by item',
};

export function splitWord(split: SplitInput): string {
  return SPLIT_WORDS[split.method] ?? 'equally';
}

/** 'you', 'Aarav' or '3 people'. */
export function payerWord(payers: MoneyShare[] | null, nameOf: (id: ID) => string): string {
  if (!payers || payers.length === 0) return 'you';
  if (payers.length === 1) return payers[0].personId === ME_ID ? 'you' : nameOf(payers[0].personId);
  return `${payers.length} people`;
}

export interface MyImpact {
  paid: Minor;
  owed: Minor;
  net: Minor;
}

/** What the expense means for me, or null when the split can't be computed yet. */
export function myImpact(total: Minor | null, payers: MoneyShare[], split: SplitInput, currency: CurrencyCode): MyImpact | null {
  if (total === null) return null;
  const result = computeOwed(total, split, currency);
  if (result.errors.length > 0) return null;
  const paid = sumMinor(payers.filter((p) => p.personId === ME_ID).map((p) => p.amount));
  const owed = sumMinor(result.owed.filter((o) => o.personId === ME_ID).map((o) => o.amount));
  return { paid, owed, net: paid - owed };
}

export function impactText(impact: MyImpact, currency: CurrencyCode): { text: string; tone: 'owed' | 'owe' | 'neutral' } {
  if (impact.net > 0) return { text: `You lent ${formatMoney(impact.net, currency)}`, tone: 'owed' };
  if (impact.net < 0) return { text: `You borrowed ${formatMoney(-impact.net, currency)}`, tone: 'owe' };
  if (impact.paid === 0 && impact.owed === 0) return { text: 'You are not involved', tone: 'neutral' };
  return { text: 'You paid exactly your share', tone: 'neutral' };
}

// ---------- Repeat ----------

export type RepeatChoice = 'never' | RecurrenceFrequency;

/**
 * First date of the repeat schedule that starts on `date` (date + 1 period, + 2 periods, …),
 * skipping every date up to and including `copiedUntil` — the latest copy that already exists —
 * so editing a recurring expense never creates the same copy twice.
 */
export function nextRepeatDate(date: ISODate, frequency: RecurrenceFrequency, copiedUntil?: ISODate): ISODate {
  return nextOccurrenceAfter(date, frequency, copiedUntil && copiedUntil > date ? copiedUntil : date);
}

export function recurrenceFor(choice: RepeatChoice, date: ISODate, copiedUntil?: ISODate): Recurrence | undefined {
  return choice === 'never' ? undefined : { frequency: choice, nextDate: nextRepeatDate(date, choice, copiedUntil) };
}

/** Date of the latest copy (deleted ones too) made from the recurring expense `expenseId`. */
export function lastCopyDate(state: AppState, expenseId: ID | undefined): ISODate | undefined {
  if (!expenseId) return undefined;
  let last: ISODate | undefined;
  for (const id of Object.keys(state.expenses)) {
    const e = state.expenses[id];
    if (e.recurringParentId === expenseId && e.id !== expenseId && (!last || e.date > last)) last = e.date;
  }
  return last;
}

// ---------- People ----------

/** Friends who can be added to a non-group expense, plus anyone already on it. */
export function participantCandidates(state: AppState, participantIds: ID[]): Person[] {
  const friends = listFriends(state);
  const extra = participantIds
    .filter((id) => id !== ME_ID && !friends.some((f) => f.id === id))
    .map((id) => state.people[id])
    .filter((p): p is Person => !!p);
  return [...friends, ...extra];
}
