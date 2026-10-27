// Pure rules for the expense being edited (used by draft.tsx and unit tests).
import { ME_ID } from '../types';
import type { AppState, CurrencyCode, Expense, ExpenseDraft, ExpenseInput, ID, ISODate, Minor, MoneyShare, SplitInput } from '../types';
import { computeOwed, defaultSplit, participantsOf, validatePayers } from '../lib/split';
import { computeItemized, itemizedTotal } from '../lib/itemized';
import { formatMoney, minorToInputText, parseAmountInput, sumMinor } from '../lib/money';

/** ME first, then everyone else once, in the given order. */
export function normalizeParticipants(ids: ID[]): ID[] {
  const out: ID[] = [ME_ID];
  for (const id of ids) if (id && out.indexOf(id) < 0) out.push(id);
  return out;
}

function sameMembers(a: ID[], b: ID[]): boolean {
  return a.length === b.length && a.every((id) => b.indexOf(id) >= 0);
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function blankDraft(today: ISODate, currency: CurrencyCode): ExpenseDraft {
  return {
    groupId: null,
    participantIds: [ME_ID],
    description: '',
    amountText: '',
    currency,
    category: 'general',
    date: today,
    notes: '',
    payers: null,
    split: defaultSplit([ME_ID]),
  };
}

/** Participants = the group's members, or me + the friend; currency = group default or settings default. */
export function newDraft(state: AppState, args: { groupId?: ID | null; friendId?: ID }, today: ISODate): ExpenseDraft {
  const group = args.groupId ? state.groups[args.groupId] : undefined;
  const friendId = args.friendId && state.people[args.friendId] ? args.friendId : undefined;
  const ids = group ? [...group.memberIds] : [];
  if (friendId) ids.push(friendId);
  const participantIds = normalizeParticipants(ids);
  return {
    ...blankDraft(today, group ? group.defaultCurrency : state.settings.defaultCurrency),
    groupId: group ? group.id : null,
    participantIds,
    split: defaultSplit(participantIds),
  };
}

/**
 * Draft for editing an existing expense. Participants are the group's current members
 * (when given) plus everyone the expense involves. A lone payer who is me becomes
 * `payers: null` ("paid by you").
 */
export function draftFromExpense(expense: Expense, groupMemberIds?: ID[]): ExpenseDraft {
  const participantIds = normalizeParticipants([
    ...(groupMemberIds || []),
    ...participantsOf(expense.split),
    ...expense.payers.map((p) => p.personId),
    ...expense.owed.map((o) => o.personId),
  ]);
  const paidByMeOnly = expense.payers.length === 1 && expense.payers[0].personId === ME_ID;
  const draft: ExpenseDraft = {
    editingId: expense.id,
    groupId: expense.groupId,
    participantIds,
    description: expense.description,
    amountText: minorToInputText(expense.total, expense.currency),
    currency: expense.currency,
    category: expense.category,
    date: expense.date,
    notes: expense.notes || '',
    payers: paidByMeOnly ? null : expense.payers.map((p) => ({ personId: p.personId, amount: p.amount })),
    split: clonePlain(expense.split),
  };
  if (expense.receiptUri) draft.receiptUri = expense.receiptUri;
  if (expense.recurrence) draft.recurrence = { ...expense.recurrence };
  return draft;
}

/** Split for a new participant list: itemized keeps its items minus removed people; anything else goes back to equal. */
export function resplitFor(split: SplitInput, participantIds: ID[]): SplitInput {
  if (split.method !== 'itemized') return defaultSplit(participantIds);
  const items = split.bill.items.map((item) => {
    const shares: Record<ID, number> = {};
    for (const id of Object.keys(item.shares)) {
      if (participantIds.indexOf(id) >= 0) shares[id] = item.shares[id];
    }
    return { ...item, shares };
  });
  return { method: 'itemized', bill: { ...split.bill, items } };
}

/** Explicit payers who are still participants; null ("paid by you") when none remain. */
function payersFor(payers: MoneyShare[] | null, participantIds: ID[]): MoneyShare[] | null {
  if (!payers) return null;
  const kept = payers.filter((p) => participantIds.indexOf(p.personId) >= 0);
  return kept.length > 0 ? kept : null;
}

/** The draft with a new participant list (ME always kept), re-splitting as described in resplitFor. */
export function withParticipants(draft: ExpenseDraft, participantIds: ID[]): ExpenseDraft {
  const ids = normalizeParticipants(participantIds);
  if (sameMembers(ids, draft.participantIds)) return { ...draft, participantIds: ids };
  return {
    ...draft,
    participantIds: ids,
    split: resplitFor(draft.split, ids),
    payers: payersFor(draft.payers, ids),
  };
}

/**
 * Shallow-merges `patch` into the draft. Switching to another group brings in that
 * group's members (unless the patch sets participants) and, while no amount has been
 * typed yet, its default currency. When the participants change and the patch does not
 * set split/payers itself, they are adjusted to the new participants.
 */
export function applyDraftPatch(draft: ExpenseDraft, patch: Partial<ExpenseDraft>, state: AppState): ExpenseDraft {
  let participantIds = patch.participantIds;
  const merged: ExpenseDraft = { ...draft, ...patch };
  const newGroup =
    patch.groupId !== undefined && patch.groupId !== null && patch.groupId !== draft.groupId ? state.groups[patch.groupId] : undefined;
  if (newGroup) {
    if (participantIds === undefined) participantIds = newGroup.memberIds;
    if (patch.currency === undefined && !merged.amountText.trim()) merged.currency = newGroup.defaultCurrency;
  }
  if (participantIds === undefined) return merged;

  const ids = normalizeParticipants(participantIds);
  if (sameMembers(ids, draft.participantIds)) return { ...merged, participantIds: ids };
  return {
    ...merged,
    participantIds: ids,
    split: patch.split !== undefined ? patch.split : resplitFor(draft.split, ids),
    payers: patch.payers !== undefined ? patch.payers : payersFor(draft.payers, ids),
  };
}

function hasBillLines(split: SplitInput): boolean {
  return split.method === 'itemized' && (split.bill.items.length > 0 || split.bill.charges.length > 0);
}

/**
 * Total in minor units, or null when blank / invalid / not positive. For an itemized
 * split with lines the total is the bill's total (the amount box is read-only then).
 */
export function draftTotal(draft: ExpenseDraft): Minor | null {
  if (draft.split.method === 'itemized' && hasBillLines(draft.split)) {
    const total = itemizedTotal(draft.split.bill);
    return total > 0 ? total : null;
  }
  const parsed = parseAmountInput(draft.amountText, draft.currency);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/** null/empty → me paid everything; a single payer always covers the whole total. */
export function resolvePayers(payers: MoneyShare[] | null, total: Minor | null): MoneyShare[] {
  if (!payers || payers.length === 0) return [{ personId: ME_ID, amount: total ?? 0 }];
  if (payers.length === 1) return [{ personId: payers[0].personId, amount: total ?? payers[0].amount }];
  return payers.map((p) => ({ personId: p.personId, amount: p.amount }));
}

function formatPercent(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Friendly messages for the split, e.g. '₹40.00 left to assign'; falls back to computeOwed's errors. */
export function splitErrors(total: Minor, split: SplitInput, currency: CurrencyCode): string[] {
  switch (split.method) {
    case 'equal':
      if (split.participantIds.length === 0) return ['Choose who to split with'];
      break;
    case 'exact': {
      const amounts = split.amounts;
      const diff = total - sumMinor(Object.keys(amounts).map((id) => amounts[id]));
      if (diff > 0) return [`${formatMoney(diff, currency)} left to assign`];
      if (diff < 0) return [`${formatMoney(-diff, currency)} over the total`];
      break;
    }
    case 'percent': {
      const percents = split.percents;
      const sum = Object.keys(percents).reduce((acc, id) => acc + percents[id], 0);
      const diff = 100 - sum;
      if (diff > 0.001) return [`${formatPercent(diff)}% left to assign`];
      if (diff < -0.001) return [`${formatPercent(-diff)}% over 100%`];
      break;
    }
    case 'itemized': {
      const result = computeItemized(split.bill);
      const unassigned = split.bill.items.filter((item) => result.unassignedItemIds.indexOf(item.id) >= 0);
      if (unassigned.length > 0) {
        const amount = sumMinor(unassigned.map((item) => item.amount));
        const names = unassigned.map((item) => item.name.trim() || 'Untitled item').join(', ');
        return [`${formatMoney(amount, currency)} left to assign (${names})`];
      }
      break;
    }
    default:
      break;
  }
  return computeOwed(total, split, currency).errors;
}

/** Messages for "Paid by", e.g. "The payers' amounts are ₹40.00 short of the total". */
export function payerErrors(total: Minor, payers: MoneyShare[] | null, currency: CurrencyCode): string[] {
  return validatePayers(total, resolvePayers(payers, total), currency);
}

/** Everything that blocks Save, in plain English, most basic first. Empty = ready. */
export function draftErrors(draft: ExpenseDraft): string[] {
  const errors: string[] = [];
  if (!draft.description.trim()) errors.push('Enter a description');
  const total = draftTotal(draft);
  const emptyBill = draft.split.method === 'itemized' && draft.split.bill.items.length === 0;
  if (emptyBill) errors.push('Add at least one item');
  else if (total === null) errors.push('Enter an amount');
  if (draft.participantIds.every((id) => id === ME_ID)) errors.push('Add at least one person to split with');
  if (total !== null && !emptyBill) {
    errors.push(...splitErrors(total, draft.split, draft.currency));
    errors.push(...payerErrors(total, draft.payers, draft.currency));
  }
  return errors.filter((e, i) => errors.indexOf(e) === i);
}

/** Ready-to-save input, or null while there are errors. */
export function draftToInput(draft: ExpenseDraft): ExpenseInput | null {
  if (draftErrors(draft).length > 0) return null;
  const total = draftTotal(draft);
  return total === null ? null : inputFrom(draft, total);
}

function inputFrom(draft: ExpenseDraft, total: Minor): ExpenseInput {
  const input: ExpenseInput = {
    groupId: draft.groupId,
    description: draft.description.trim(),
    category: draft.category,
    currency: draft.currency,
    total,
    date: draft.date,
    payers: resolvePayers(draft.payers, total),
    split: clonePlain(draft.split),
  };
  const notes = draft.notes.trim();
  if (notes) input.notes = notes;
  if (draft.receiptUri) input.receiptUri = draft.receiptUri;
  if (draft.recurrence) input.recurrence = { ...draft.recurrence };
  return input;
}

export interface DraftEvaluation {
  total: Minor | null;
  resolvedPayers: MoneyShare[];
  errors: string[];
  input: ExpenseInput | null;
}

/** Everything DraftApi derives from the draft, computed once per draft change. */
export function evaluateDraft(draft: ExpenseDraft): DraftEvaluation {
  const total = draftTotal(draft);
  const errors = draftErrors(draft);
  return {
    total,
    resolvedPayers: resolvePayers(draft.payers, total),
    errors,
    input: errors.length === 0 && total !== null ? inputFrom(draft, total) : null,
  };
}
