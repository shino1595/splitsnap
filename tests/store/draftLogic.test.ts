import { ME_ID } from '../../app/src/types';
import type { ExpenseDraft, ItemizedBill } from '../../app/src/types';
import {
  applyDraftPatch,
  blankDraft,
  draftErrors,
  draftFromExpense,
  draftToInput,
  draftTotal,
  evaluateDraft,
  newDraft,
  normalizeParticipants,
  resolvePayers,
  withParticipants,
} from '../../app/src/store/draftLogic';
import { buildExpense } from '../../app/src/store/reducer';
import { createDemoState, DEMO_IDS, demoDinnerBill } from '../../app/src/store/seed';
import { A, B, C, TRIP, makeState } from './fixtures';

const TODAY = '2026-10-14';

function ready(overrides: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return {
    ...newDraft(makeState(), { groupId: TRIP }, TODAY),
    description: 'Dinner',
    amountText: '100',
    ...overrides,
  };
}

function itemizedDraft(bill: ItemizedBill): ExpenseDraft {
  return ready({ amountText: '', split: { method: 'itemized', bill }, participantIds: [ME_ID, A, B, C] });
}

describe('starting a draft', () => {
  it('starts a group expense with the members, the group currency and an equal split', () => {
    const state = makeState();
    const draft = newDraft(state, { groupId: TRIP }, TODAY);
    expect(draft.groupId).toBe(TRIP);
    expect(draft.participantIds).toEqual([ME_ID, A, B, C]);
    expect(draft.currency).toBe('INR');
    expect(draft.split).toEqual({ method: 'equal', participantIds: [ME_ID, A, B, C] });
    expect(draft.payers).toBeNull();
    expect(draft.date).toBe(TODAY);
    expect(draft.description).toBe('');
    expect(draft.editingId).toBeUndefined();
  });

  it('starts a friend expense with just me and the friend in the default currency', () => {
    const state = makeState();
    const draft = newDraft({ ...state, settings: { ...state.settings, defaultCurrency: 'USD' } }, { friendId: A }, TODAY);
    expect(draft.groupId).toBeNull();
    expect(draft.participantIds).toEqual([ME_ID, A]);
    expect(draft.currency).toBe('USD');
  });

  it('falls back to a non-group draft when the group is gone', () => {
    const draft = newDraft(makeState(), { groupId: 'g_missing' }, TODAY);
    expect(draft.groupId).toBeNull();
    expect(draft.participantIds).toEqual([ME_ID]);
  });

  it('opens an existing itemized expense for editing', () => {
    const state = createDemoState(TODAY);
    const dinner = state.expenses[DEMO_IDS.dinner];
    const draft = draftFromExpense(dinner, state.groups[DEMO_IDS.goa].memberIds);
    expect(draft.editingId).toBe(dinner.id);
    expect(draft.amountText).toBe('1460');
    expect(draft.payers).toBeNull();
    expect(draft.participantIds[0]).toBe(ME_ID);
    expect(draft.participantIds).toHaveLength(5);
    expect(draft.split).toEqual(dinner.split);
    expect(draft.split).not.toBe(dinner.split);
    expect(draftErrors(draft)).toEqual([]);
  });

  it('keeps explicit payers when editing a multi-payer expense', () => {
    const state = createDemoState(TODAY);
    const draft = draftFromExpense(state.expenses[DEMO_IDS.scuba]);
    expect(draft.payers).toHaveLength(2);
    expect(draft.participantIds).toContain(DEMO_IDS.chirag);
    expect(draftErrors(draft)).toEqual([]);
  });
});

describe('participants', () => {
  it('always keeps me, first and once', () => {
    expect(normalizeParticipants([A, ME_ID, A, B])).toEqual([ME_ID, A, B]);
  });

  it('re-defaults a non-itemized split to equal among the new participants', () => {
    const draft = ready({ split: { method: 'exact', amounts: { [ME_ID]: 5000, [A]: 5000 } } });
    const next = withParticipants(draft, [ME_ID, B]);
    expect(next.split).toEqual({ method: 'equal', participantIds: [ME_ID, B] });
  });

  it('keeps itemized items but drops removed people from their shares', () => {
    const bill: ItemizedBill = {
      items: [
        { id: 'i1', name: 'Naan', quantity: 6, amount: 36000, shares: { [A]: 2, [B]: 1, [C]: 1 } },
        { id: 'i2', name: 'Dal', quantity: 1, amount: 30000, shares: { [C]: 1 } },
      ],
      charges: [],
    };
    const next = withParticipants(itemizedDraft(bill), [ME_ID, A, B]);
    expect(next.split.method).toBe('itemized');
    if (next.split.method !== 'itemized') return;
    expect(next.split.bill.items).toHaveLength(2);
    expect(next.split.bill.items[0].shares).toEqual({ [A]: 2, [B]: 1 });
    expect(next.split.bill.items[1].shares).toEqual({});
    expect(draftErrors(next)).toEqual(['₹300.00 left to assign (Dal)']);
  });

  it('drops removed payers and falls back to "paid by you"', () => {
    const draft = ready({ payers: [{ personId: C, amount: 10000 }] });
    expect(withParticipants(draft, [ME_ID, A]).payers).toBeNull();
    const two = ready({ payers: [{ personId: A, amount: 6000 }, { personId: C, amount: 4000 }] });
    expect(withParticipants(two, [ME_ID, A]).payers).toEqual([{ personId: A, amount: 6000 }]);
  });

  it('does not touch the split when the same people are set again', () => {
    const draft = ready({ split: { method: 'shares', shares: { [ME_ID]: 2, [A]: 1 } } });
    expect(withParticipants(draft, [C, B, A, ME_ID]).split).toBe(draft.split);
  });
});

describe('setDraft patches', () => {
  it('shallow-merges plain fields', () => {
    const state = makeState();
    const next = applyDraftPatch(ready(), { description: 'Lunch', notes: 'x' }, state);
    expect(next.description).toBe('Lunch');
    expect(next.notes).toBe('x');
    expect(next.participantIds).toEqual([ME_ID, A, B, C]);
  });

  it('re-splits when participants change unless the patch sets the split too', () => {
    const state = makeState();
    const base = ready({ split: { method: 'exact', amounts: { [ME_ID]: 10000 } } });
    expect(applyDraftPatch(base, { participantIds: [ME_ID, A] }, state).split).toEqual({
      method: 'equal',
      participantIds: [ME_ID, A],
    });
    const explicit = { method: 'shares' as const, shares: { [ME_ID]: 1, [A]: 3 } };
    expect(applyDraftPatch(base, { participantIds: [ME_ID, A], split: explicit }, state).split).toBe(explicit);
  });

  it('brings in group members and the group currency when switching group before an amount is typed', () => {
    let state = makeState();
    state = { ...state, groups: { ...state.groups, g_us: { ...state.groups[TRIP], id: 'g_us', memberIds: [ME_ID, C], defaultCurrency: 'USD' } } };
    const blank = { ...blankDraft(TODAY, 'INR'), participantIds: [ME_ID, A] };
    const next = applyDraftPatch(blank, { groupId: 'g_us' }, state);
    expect(next.groupId).toBe('g_us');
    expect(next.participantIds).toEqual([ME_ID, C]);
    expect(next.currency).toBe('USD');
    expect(next.split).toEqual({ method: 'equal', participantIds: [ME_ID, C] });

    const typed = applyDraftPatch({ ...blank, amountText: '250' }, { groupId: 'g_us' }, state);
    expect(typed.currency).toBe('INR');
  });
});

describe('totals and payers', () => {
  it('parses the amount text and rejects blanks, zero and garbage', () => {
    expect(draftTotal(ready({ amountText: '1,390.50' }))).toBe(139050);
    expect(draftTotal(ready({ amountText: '' }))).toBeNull();
    expect(draftTotal(ready({ amountText: '0' }))).toBeNull();
    expect(draftTotal(ready({ amountText: 'abc' }))).toBeNull();
  });

  it('uses the bill total for itemized splits', () => {
    const draft = itemizedDraft(demoDinnerBill());
    expect(draftTotal({ ...draft, amountText: '5' })).toBe(146000);
  });

  it('resolves payers', () => {
    expect(resolvePayers(null, 5000)).toEqual([{ personId: ME_ID, amount: 5000 }]);
    expect(resolvePayers(null, null)).toEqual([{ personId: ME_ID, amount: 0 }]);
    expect(resolvePayers([{ personId: A, amount: 100 }], 5000)).toEqual([{ personId: A, amount: 5000 }]);
    const two = [
      { personId: A, amount: 3000 },
      { personId: B, amount: 2000 },
    ];
    expect(resolvePayers(two, 5000)).toEqual(two);
  });
});

describe('validation messages', () => {
  it('asks for a description and an amount first', () => {
    const errors = draftErrors(ready({ description: '  ', amountText: '' }));
    expect(errors).toContain('Enter a description');
    expect(errors).toContain('Enter an amount');
  });

  it('needs someone to split with', () => {
    const state = makeState();
    const solo = { ...newDraft(state, {}, TODAY), description: 'Coffee', amountText: '50' };
    expect(draftErrors(solo)).toEqual(['Add at least one person to split with']);
  });

  it('reports what is left to assign in exact and percent splits', () => {
    expect(draftErrors(ready({ split: { method: 'exact', amounts: { [ME_ID]: 3000, [A]: 3000 } } }))).toEqual([
      '₹40.00 left to assign',
    ]);
    expect(draftErrors(ready({ split: { method: 'exact', amounts: { [ME_ID]: 6000, [A]: 5000 } } }))).toEqual([
      '₹10.00 over the total',
    ]);
    expect(draftErrors(ready({ split: { method: 'percent', percents: { [ME_ID]: 50, [A]: 40 } } }))).toEqual([
      '10% left to assign',
    ]);
    expect(draftErrors(ready({ split: { method: 'percent', percents: { [ME_ID]: 33.33, [A]: 33.33, [B]: 33.34 } } }))).toEqual([]);
  });

  it('reports payers that do not add up', () => {
    const errors = draftErrors(
      ready({
        payers: [
          { personId: A, amount: 5000 },
          { personId: B, amount: 3000 },
        ],
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('₹20.00');
  });

  it('flags unassigned items and empty bills', () => {
    const bill = demoDinnerBill();
    bill.items[0] = { ...bill.items[0], shares: {} };
    expect(draftErrors(itemizedDraft(bill))).toEqual(['₹360.00 left to assign (Naan)']);
    expect(draftErrors(itemizedDraft({ items: [], charges: [] }))).toEqual(['Add at least one item']);
  });

  it('accepts the example itemized dinner', () => {
    expect(draftErrors(itemizedDraft(demoDinnerBill()))).toEqual([]);
  });
});

describe('turning a draft into input', () => {
  it('returns null while there are errors', () => {
    expect(draftToInput(ready({ description: '' }))).toBeNull();
    expect(evaluateDraft(ready({ description: '' })).input).toBeNull();
  });

  it('builds a trimmed ExpenseInput that the store accepts', () => {
    const state = makeState();
    const draft = ready({ description: '  Dinner  ', notes: '  ', payers: null });
    const input = draftToInput(draft);
    expect(input).not.toBeNull();
    if (!input) return;
    expect(input.description).toBe('Dinner');
    expect(input.total).toBe(10000);
    expect(input.notes).toBeUndefined();
    expect(input.payers).toEqual([{ personId: ME_ID, amount: 10000 }]);
    expect(input.groupId).toBe(TRIP);
    const built = buildExpense(state, input, { id: 'e1', at: '2026-10-14T10:00:00.000Z', createdBy: ME_ID });
    expect(built.errors).toEqual([]);
    expect(built.expense && built.expense.owed).toHaveLength(4);
  });

  it('evaluates total, payers, errors and input together', () => {
    const result = evaluateDraft(ready({ amountText: '80' }));
    expect(result.total).toBe(8000);
    expect(result.resolvedPayers).toEqual([{ personId: ME_ID, amount: 8000 }]);
    expect(result.errors).toEqual([]);
    expect(result.input && result.input.total).toBe(8000);
  });

  it('round-trips an itemized expense through the editor', () => {
    const state = createDemoState(TODAY);
    const dinner = state.expenses[DEMO_IDS.dinner];
    const input = draftToInput(draftFromExpense(dinner, state.groups[DEMO_IDS.goa].memberIds));
    expect(input).not.toBeNull();
    if (!input) return;
    const built = buildExpense(state, input, { id: dinner.id, at: dinner.updatedAt, createdBy: ME_ID }, dinner);
    expect(built.errors).toEqual([]);
    expect(built.expense && built.expense.owed).toEqual(dinner.owed);
  });
});
