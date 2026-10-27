import { ME_ID } from '../../app/src/types';
import type { AppState, Expense, SplitInput } from '../../app/src/types';
import {
  editorExitCount,
  amountProblem,
  effectiveSplitTotal,
  impactText,
  lastCopyDate,
  limitDecimals,
  myImpact,
  nextRepeatDate,
  normalizePayers,
  owedPreview,
  parseDecimal,
  participantCandidates,
  payerEditorStatus,
  payerTexts,
  payersFromTexts,
  payerWord,
  recurrenceFor,
  splitEditorStatus,
  splitFromTexts,
  splitWord,
  textsFromSplit,
  toggleInOrder,
  uniqueMessages,
} from '../../app/src/screens/expense/components/expenseEditing';
import { convertSplit } from '../../app/src/lib/split';
import { A, B, C, makeState } from '../store/fixtures';

const IDS = [ME_ID, A, B, C];

describe('editorExitCount', () => {
  it('pops every editor route above the opener', () => {
    expect(editorExitCount(['Tabs', 'GroupDetail', 'AddExpense'], 2)).toBe(1);
    expect(editorExitCount(['Tabs', 'GroupDetail', 'AddExpense', 'ItemizedSplit', 'AddExpense'], 4)).toBe(3);
    expect(editorExitCount(['Tabs', 'ExpenseDetail', 'AddExpense', 'SplitOptions'], 3)).toBe(2);
  });
  it('returns -1 when the whole stack is the editor', () => {
    expect(editorExitCount(['AddExpense', 'PaidBy'], 1)).toBe(-1);
  });
});

describe('number boxes', () => {
  it('parses decimals with comma or dot and treats blank as zero', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal(' 3 ')).toBe(3);
    expect(parseDecimal('')).toBe(0);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('1.2.3')).toBeNull();
    expect(parseDecimal('-2')).toBeNull();
  });
});

describe('split texts round trip', () => {
  it('exact amounts', () => {
    const split: SplitInput = { method: 'exact', amounts: { [ME_ID]: 25000, [A]: 75050 } };
    const texts = textsFromSplit(split, IDS, 'INR');
    expect(texts[ME_ID]).toBe('250');
    expect(texts[A]).toBe('750.50');
    expect(texts[B]).toBe('');
    const back = splitFromTexts('exact', texts, IDS, 'INR');
    expect(back.invalidIds).toEqual([]);
    expect(back.split).toEqual(split);
  });
  it('adjustments keep their sign and include every participant', () => {
    const texts = textsFromSplit({ method: 'adjustment', participantIds: IDS, adjustments: { [A]: 5000, [B]: -2000 } }, IDS, 'INR');
    expect(texts[A]).toBe('+50');
    expect(texts[B]).toBe('-20');
    const back = splitFromTexts('adjustment', texts, IDS, 'INR');
    expect(back.split).toEqual({ method: 'adjustment', participantIds: IDS, adjustments: { [A]: 5000, [B]: -2000 } });
  });
  it('reports unreadable boxes', () => {
    const back = splitFromTexts('percent', { [ME_ID]: '50', [A]: 'abc' }, IDS, 'INR');
    expect(back.invalidIds).toEqual([A]);
    expect(back.split).toEqual({ method: 'percent', percents: { [ME_ID]: 50 } });
  });
  it('toggles people in display order', () => {
    expect(toggleInOrder([C, ME_ID], A, IDS)).toEqual([ME_ID, A, C]);
    expect(toggleInOrder(IDS, B, IDS)).toEqual([ME_ID, A, C]);
  });
});

describe('splitEditorStatus', () => {
  it('equal shows the amount per person', () => {
    expect(splitEditorStatus({ method: 'equal', participantIds: IDS }, 100000, 'INR').text).toBe('₹250.00 per person');
    const uneven = splitEditorStatus({ method: 'equal', participantIds: [ME_ID, A, B] }, 10000, 'INR');
    expect(uneven.text).toBe('₹33.33–₹33.34 per person');
    expect(uneven.valid).toBe(true);
    const none = splitEditorStatus({ method: 'equal', participantIds: [] }, 10000, 'INR');
    expect(none.valid).toBe(false);
  });
  it('exact shows what is left or over', () => {
    const left = splitEditorStatus({ method: 'exact', amounts: { [ME_ID]: 6000 } }, 10000, 'INR');
    expect(left.text).toBe('₹40.00 left');
    expect(left.valid).toBe(false);
    expect(left.reason).toBe('₹40.00 left to assign');
    const over = splitEditorStatus({ method: 'exact', amounts: { [ME_ID]: 12000 } }, 10000, 'INR');
    expect(over.text).toBe('₹20.00 over');
    const exact = splitEditorStatus({ method: 'exact', amounts: { [ME_ID]: 4000, [A]: 6000 } }, 10000, 'INR');
    expect(exact.valid).toBe(true);
  });
  it('exact amounts without a total use their sum', () => {
    const status = splitEditorStatus({ method: 'exact', amounts: { [A]: 3000, [B]: 2000 } }, null, 'INR');
    expect(status.valid).toBe(true);
    expect(status.text).toBe('Total ₹50.00');
    expect(effectiveSplitTotal({ method: 'exact', amounts: { [A]: 3000, [B]: 2000 } }, null)).toBe(5000);
  });
  it('percent and shares', () => {
    expect(splitEditorStatus({ method: 'percent', percents: { [ME_ID]: 50, [A]: 40 } }, 10000, 'INR').text).toBe('10% left');
    expect(splitEditorStatus({ method: 'percent', percents: { [ME_ID]: 50, [A]: 50 } }, 10000, 'INR').valid).toBe(true);
    const shares = splitEditorStatus({ method: 'shares', shares: { [ME_ID]: 2, [A]: 3 } }, 10000, 'INR');
    expect(shares.text).toBe('Total shares: 5');
    expect(shares.valid).toBe(true);
  });
  it('invalid boxes block Done with a reason', () => {
    const status = splitEditorStatus({ method: 'shares', shares: { [ME_ID]: 1 } }, 10000, 'INR', ['Aarav']);
    expect(status.valid).toBe(false);
    expect(status.reason).toBe('Check the number for Aarav');
  });
  it('adjustments that exceed the total are blocked', () => {
    const status = splitEditorStatus({ method: 'adjustment', participantIds: IDS, adjustments: { [A]: 15000 } }, 10000, 'INR');
    expect(status.valid).toBe(false);
    expect(status.text).toBe('₹50.00 over');
  });
  it('itemized needs items, all assigned', () => {
    const empty = splitEditorStatus({ method: 'itemized', bill: { items: [], charges: [] } }, 10000, 'INR');
    expect(empty.valid).toBe(false);
    const bill = {
      items: [
        { id: 'i1', name: 'Naan', quantity: 6, amount: 36000, shares: { [A]: 1, [B]: 1 } },
        { id: 'i2', name: 'Dal', quantity: 1, amount: 20000, shares: {} },
      ],
      charges: [],
    };
    const unassigned = splitEditorStatus({ method: 'itemized', bill }, null, 'INR');
    expect(unassigned.text).toBe('₹200.00 not assigned');
    expect(unassigned.valid).toBe(false);
    bill.items[1].shares = { [C]: 1 };
    const done = splitEditorStatus({ method: 'itemized', bill }, null, 'INR');
    expect(done.valid).toBe(true);
    expect(owedPreview({ method: 'itemized', bill }, null, 'INR')).toEqual({ [A]: 18000, [B]: 18000, [C]: 20000 });
  });
  it('previews owed amounts that add up', () => {
    const split = convertSplit(10000, { method: 'equal', participantIds: [ME_ID, A, B] }, 'shares', [ME_ID, A, B], 'INR');
    const preview = owedPreview(split, 10000, 'INR');
    expect(preview[ME_ID] + preview[A] + preview[B]).toBe(10000);
  });
});

describe('paid by', () => {
  it('starts "multiple people" from the current payer', () => {
    expect(payerTexts(null, IDS, 10000, 'INR')).toEqual({ [ME_ID]: '100', [A]: '', [B]: '', [C]: '' });
    const texts = payerTexts([{ personId: A, amount: 4000 }, { personId: B, amount: 6000 }], IDS, 10000, 'INR');
    expect(texts[A]).toBe('40');
    expect(texts[B]).toBe('60');
  });
  it('reads boxes and checks them against the total', () => {
    const edited = payersFromTexts({ [ME_ID]: '60', [A]: '', [B]: '20', [C]: 'x' }, IDS, 'INR');
    expect(edited.payers).toEqual([{ personId: ME_ID, amount: 6000 }, { personId: B, amount: 2000 }]);
    expect(edited.sum).toBe(8000);
    expect(edited.invalidIds).toEqual([C]);
    const status = payerEditorStatus({ ...edited, invalidIds: [] }, 10000, 'INR');
    expect(status.text).toBe('₹20.00 left');
    expect(status.valid).toBe(false);
    expect(payerEditorStatus({ ...edited, invalidIds: [] }, 8000, 'INR').valid).toBe(true);
  });
  it('collapses a lone payer who is me', () => {
    expect(normalizePayers([{ personId: ME_ID, amount: 100 }])).toBeNull();
    expect(normalizePayers([{ personId: A, amount: 100 }])).toEqual([{ personId: A, amount: 100 }]);
    expect(normalizePayers([])).toBeNull();
  });
});

describe('sentence and impact', () => {
  it('words', () => {
    const nameOf = (id: string) => (id === A ? 'Aarav' : '?');
    expect(payerWord(null, nameOf)).toBe('you');
    expect(payerWord([{ personId: A, amount: 1 }], nameOf)).toBe('Aarav');
    expect(payerWord([{ personId: A, amount: 1 }, { personId: B, amount: 1 }], nameOf)).toBe('2 people');
    expect(splitWord({ method: 'equal', participantIds: IDS })).toBe('equally');
    expect(splitWord({ method: 'itemized', bill: { items: [], charges: [] } })).toBe('item by item');
  });
  it('what it means for me', () => {
    const impact = myImpact(10000, [{ personId: ME_ID, amount: 10000 }], { method: 'equal', participantIds: [ME_ID, A] }, 'INR');
    expect(impact).toEqual({ paid: 10000, owed: 5000, net: 5000 });
    expect(impactText(impact!, 'INR')).toEqual({ text: 'You lent ₹50.00', tone: 'owed' });
    const borrowed = myImpact(10000, [{ personId: A, amount: 10000 }], { method: 'equal', participantIds: [ME_ID, A] }, 'INR');
    expect(impactText(borrowed!, 'INR').text).toBe('You borrowed ₹50.00');
    expect(myImpact(null, [], { method: 'equal', participantIds: [ME_ID] }, 'INR')).toBeNull();
  });
});

describe('misc', () => {
  it('repeat choice', () => {
    expect(recurrenceFor('never', '2026-10-15')).toBeUndefined();
    expect(recurrenceFor('monthly', '2026-01-31')).toEqual({ frequency: 'monthly', nextDate: '2026-02-28' });
  });
  it('dedupes messages', () => {
    expect(uniqueMessages(['a', 'b', 'a', ''])).toEqual(['a', 'b']);
  });
  it('candidates include friends and current non-friend participants', () => {
    const state = makeState();
    const names = participantCandidates(state, [ME_ID, A]).map((p) => p.name);
    expect(names).toEqual(['Aarav', 'Bhavna', 'Chirag']);
  });
});

describe('amount boxes', () => {
  it('drops decimals the currency does not have', () => {
    expect(limitDecimals('12.345', 2)).toBe('12.34');
    expect(limitDecimals('0.005', 2)).toBe('0.00');
    expect(limitDecimals('12.3', 2)).toBe('12.3');
    expect(limitDecimals('12.', 2)).toBe('12.');
    expect(limitDecimals('1500.5', 0)).toBe('1500');
    expect(limitDecimals('-12.345', 2)).toBe('-12.34');
    expect(limitDecimals('1,00,000', 2)).toBe('1,00,000');
    expect(limitDecimals('1.2.3', 2)).toBe('1.2.3');
    expect(limitDecimals('1.234,56', 2)).toBe('1.234,56');
  });
  it('explains why a total cannot be used', () => {
    expect(amountProblem('', 'INR')).toBe('Enter an amount');
    expect(amountProblem('  ', 'INR')).toBe('Enter an amount');
    expect(amountProblem('0', 'INR')).toBe('Enter an amount above zero');
    expect(amountProblem('0.00', 'INR')).toBe('Enter an amount above zero');
    expect(amountProblem('1.2.3', 'INR')).toBe('Enter a valid amount, like 1250.50');
    expect(amountProblem('99999999999999999999', 'INR')).toBe('That amount is too large');
    expect(amountProblem('1,00,000', 'INR')).toBeNull();
    expect(amountProblem('12.5', 'INR')).toBeNull();
  });
});

describe('repeat schedule when editing', () => {
  it('starts one period after the date', () => {
    expect(nextRepeatDate('2026-08-31', 'monthly')).toBe('2026-09-30');
    expect(nextRepeatDate('2026-10-01', 'weekly')).toBe('2026-10-08');
  });
  it('skips dates that already have a copy', () => {
    expect(nextRepeatDate('2026-08-31', 'monthly', '2026-09-30')).toBe('2026-10-31');
    expect(nextRepeatDate('2026-08-31', 'weekly', '2026-09-30')).toBe('2026-10-05');
    expect(recurrenceFor('monthly', '2026-08-31', '2026-09-30')).toEqual({ frequency: 'monthly', nextDate: '2026-10-31' });
    expect(recurrenceFor('monthly', '2026-08-31', '2026-08-01')).toEqual({ frequency: 'monthly', nextDate: '2026-09-30' });
  });
  it('finds the latest copy, deleted ones included', () => {
    const base = makeState();
    const mk = (id: string, date: string, parent?: string, deletedAt?: string) =>
      ({ id, date, recurringParentId: parent, deletedAt }) as unknown as Expense;
    const state: AppState = {
      ...base,
      expenses: {
        p: mk('p', '2026-08-31'),
        c1: mk('c1', '2026-09-30', 'p'),
        c2: mk('c2', '2026-10-30', 'p', '2026-11-01T00:00:00.000Z'),
        other: mk('other', '2026-12-01', 'q'),
      },
    };
    expect(lastCopyDate(state, 'p')).toBe('2026-10-30');
    expect(lastCopyDate(state, 'c1')).toBeUndefined();
    expect(lastCopyDate(state, undefined)).toBeUndefined();
  });
});

describe('owed preview', () => {
  it('stays empty when adjustments are larger than the total', () => {
    const split: SplitInput = { method: 'adjustment', participantIds: IDS, adjustments: { [ME_ID]: 600000 } };
    expect(owedPreview(split, 500000, 'INR')).toEqual({});
  });
});
