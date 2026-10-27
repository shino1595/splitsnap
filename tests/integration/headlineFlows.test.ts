// The two headline flows, end to end through the same pure code the screens call:
// seed → draft → (scan review) → item-by-item split → AddExpense → reducer → balances.
import { ME_ID } from '../../app/src/types';
import type { AppState, BillItem, ExpenseDraft, ID, ItemizedBill } from '../../app/src/types';
import { createDemoState, DEMO_IDS } from '../../app/src/store/seed';
import { applyDraftPatch, evaluateDraft, newDraft } from '../../app/src/store/draftLogic';
import { appReducer } from '../../app/src/store/reducer';
import { friendBalance, myGroupBalance } from '../../app/src/store/selectors';
import { receiptToBill, sampleReceipt } from '../../app/src/ocr/bill';
import { billDate, evaluateReview, reviewFromReceipt } from '../../app/src/screens/scan/scanReview';
import { billFromSplit, buildSummary, itemFromFields } from '../../app/src/screens/itemized/itemizedEditor';
import { itemizedTotal, togglePerson } from '../../app/src/lib/itemized';
import { minorToInputText } from '../../app/src/lib/money';

const TODAY = '2026-10-15';
const AT = '2026-10-15T12:00:00.000Z';
const { aarav: A, bhavna: B, chirag: C, diya: D, goa: GOA } = DEMO_IDS;

/** Untaps `ids` on the item called `name` (as on the ItemizedSplit chips). */
function untap(bill: ItemizedBill, name: string, ids: ID[]): ItemizedBill {
  const items = bill.items.map((item) => (item.name === name ? ids.reduce((it: BillItem, id) => togglePerson(it, id), item) : item));
  return { ...bill, items };
}

function sharers(bill: ItemizedBill, name: string): ID[] {
  const item = bill.items.find((i) => i.name === name);
  return item ? Object.keys(item.shares).filter((id) => item.shares[id] > 0) : [];
}

function totalOf(summary: ReturnType<typeof buildSummary>, id: ID): number {
  const p = summary.people.find((x) => x.personId === id);
  return p ? p.total : 0;
}

function save(state: AppState, draft: ExpenseDraft, id: string): AppState {
  const { input, errors } = evaluateDraft(draft);
  expect(errors).toEqual([]);
  if (!input) throw new Error('draft not ready');
  return appReducer(state, { type: 'expense/add', id, input, at: AT, activityId: `act_${id}` });
}

describe('flow (a): Goa Trip → Scan bill → sample bill → split by item → save', () => {
  const state = createDemoState(TODAY);
  let draft = newDraft(state, { groupId: GOA }, TODAY);

  it('starts the draft with the whole group', () => {
    expect(draft.participantIds).toEqual([ME_ID, A, B, C, D]);
    expect(draft.currency).toBe('INR');
  });

  it('reviews the sample bill and continues to the split like ScanBillScreen does', () => {
    const receipt = sampleReceipt(draft.currency);
    const review = reviewFromReceipt(receipt, receipt.currency ?? draft.currency);
    const evaluation = evaluateReview(receipt, review, receipt.currency ?? draft.currency);
    expect(evaluation.canContinue).toBe(true);
    expect(evaluation.computedTotal).toBe(146000);
    expect(evaluation.printedTotal).toBe(146000);

    const edited = evaluation.receipt;
    const bill = receiptToBill(edited, draft.participantIds);
    const currency = edited.currency ?? draft.currency;
    draft = applyDraftPatch(
      draft,
      {
        split: { method: 'itemized', bill },
        description: draft.description.trim() || edited.merchant || 'Restaurant bill',
        category: draft.category === 'general' ? 'food' : draft.category,
        date: billDate(edited.date, draft.date, TODAY),
        currency,
        amountText: minorToInputText(itemizedTotal(bill), currency),
      },
      state,
    );
    expect(bill.items.map((i) => i.name)).toEqual(['Naan', 'Butter Chicken', 'Chicken Lababdar', 'Gulab Jamun']);
    expect(sharers(bill, 'Naan')).toEqual([ME_ID, A, B, C, D]);
    expect(draft.description.trim().length).toBeGreaterThan(0);
    expect(draft.date).toBe('2026-10-03');
  });

  it("splits per the user's example and reaches ₹1,460.00 exactly", () => {
    let bill = billFromSplit(draft.split);
    bill = untap(bill, 'Naan', [ME_ID]);
    bill = untap(bill, 'Butter Chicken', [ME_ID, B, D]);
    bill = untap(bill, 'Chicken Lababdar', [ME_ID, A]);
    bill = untap(bill, 'Gulab Jamun', [ME_ID, A, C]);
    expect(sharers(bill, 'Naan')).toEqual([A, B, C, D]);
    expect(sharers(bill, 'Butter Chicken')).toEqual([A, C]);
    expect(sharers(bill, 'Chicken Lababdar')).toEqual([B, C, D]);
    expect(sharers(bill, 'Gulab Jamun')).toEqual([B, D]);

    const summary = buildSummary(bill, draft.participantIds, draft.currency);
    expect(summary.canFinish).toBe(true);
    expect(summary.total).toBe(146000);
    expect(summary.warnings).toEqual([]);
    // Items 300/320/450/320, GST 2.5% + 2.5% → 315/336/472.50/336, plus the ₹0.50 round-off.
    expect(totalOf(summary, A)).toBe(31511);
    expect(totalOf(summary, B)).toBe(33612);
    expect(totalOf(summary, C)).toBe(47266);
    expect(totalOf(summary, D)).toBe(33611);
    expect(totalOf(summary, ME_ID)).toBe(0);

    // Done
    draft = applyDraftPatch(draft, { split: { method: 'itemized', bill }, amountText: minorToInputText(summary.total, draft.currency) }, state);
    const evaluation = evaluateDraft(draft);
    expect(evaluation.total).toBe(146000);
    expect(evaluation.errors).toEqual([]);
  });

  it('saves the expense and moves the Goa Trip balances by the bill', () => {
    const before = myGroupBalance(state, GOA).INR || 0;
    const next = save(state, draft, 'e_flow_a');
    const expense = next.expenses.e_flow_a;
    expect(expense.total).toBe(146000);
    expect(expense.groupId).toBe(GOA);
    expect(expense.payers).toEqual([{ personId: ME_ID, amount: 146000 }]);
    const owed: Record<ID, number> = {};
    for (const o of expense.owed) owed[o.personId] = o.amount;
    expect(owed).toEqual({ [A]: 31511, [B]: 33612, [C]: 47266, [D]: 33611 });
    expect((myGroupBalance(next, GOA).INR || 0) - before).toBe(146000);
    expect(next.activity[0].type).toBe('expense_added');
    expect(next.activity[0].summary).toContain('Goa Trip');
  });
});

describe('flow (b): AddExpense → Split item by item → manual items → save', () => {
  const state = createDemoState(TODAY);
  let draft = newDraft(state, {}, TODAY);

  it('opens an empty item-by-item bill that cannot be saved yet', () => {
    expect(draft.participantIds).toEqual([ME_ID]);
    draft = applyDraftPatch(draft, { split: { method: 'itemized', bill: { items: [], charges: [] } } }, state);
    draft = applyDraftPatch(draft, { participantIds: [...draft.participantIds, D] }, state);
    expect(draft.split.method).toBe('itemized');
    expect(evaluateDraft(draft).errors).toContain('Add at least one item');
  });

  it('adds items, assigns them, and saves a non-group expense with Diya', () => {
    let bill = billFromSplit(draft.split);
    const popcorn = itemFromFields({ name: 'Popcorn', qty: '1', amount: '250' }, draft.currency, draft.participantIds);
    const nachos = itemFromFields({ name: 'Nachos', qty: '1', amount: '180.50' }, draft.currency, draft.participantIds);
    if (!popcorn.item || !nachos.item) throw new Error(popcorn.error || nachos.error || 'item');
    bill = { ...bill, items: [popcorn.item, togglePerson(nachos.item, ME_ID)] };

    const summary = buildSummary(bill, draft.participantIds, draft.currency);
    expect(summary.canFinish).toBe(true);
    expect(summary.total).toBe(43050);
    expect(totalOf(summary, ME_ID)).toBe(12500);
    expect(totalOf(summary, D)).toBe(30550);

    draft = applyDraftPatch(
      draft,
      { split: { method: 'itemized', bill }, amountText: minorToInputText(summary.total, draft.currency), description: 'Movie snacks' },
      state,
    );
    const before = friendBalance(state, D).INR || 0;
    const next = save(state, draft, 'e_flow_b');
    expect(next.expenses.e_flow_b.groupId).toBeNull();
    expect((friendBalance(next, D).INR || 0) - before).toBe(30550);
  });
});
