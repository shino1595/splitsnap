// The expense being edited, shared by AddExpense, SplitOptions, PaidBy, ScanBill and
// ItemizedSplit. The rules live in draftLogic.ts; this file only holds the state.
import * as React from 'react';
import type { Expense, ExpenseDraft, ExpenseInput, ID, Minor, MoneyShare } from '../types';
import { todayISO } from '../lib/dates';
import { useAppState } from './AppStore';
import { applyDraftPatch, blankDraft, draftFromExpense, evaluateDraft, newDraft } from './draftLogic';

export interface DraftApi {
  draft: ExpenseDraft;
  /** Shallow merge. New participants re-default a non-itemized split; itemized bills keep their items. */
  setDraft(patch: Partial<ExpenseDraft>): void;
  /** participants = group members or [ME, friend]; currency = group default or settings default; equal split; today; paid by you. */
  startNew(args: { groupId?: ID | null; friendId?: ID }): void;
  startEdit(expense: Expense): void;
  /** Parsed total (amountText) in minor units, or null if blank/invalid. Itemized bills use the bill total. */
  total: Minor | null;
  /** Payers resolved (null payers → [{ME_ID, total}]; a single payer covers the whole total). */
  resolvedPayers: MoneyShare[];
  /** Validation for the Save button: description, amount, split and payers, in plain English. */
  errors: string[];
  /** Ready-to-save input, or null if errors. Always reflects the latest setDraft. */
  toInput(): ExpenseInput | null;
}

const DraftContext = React.createContext<DraftApi | null>(null);

export function DraftProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const appState = useAppState();
  const appStateRef = React.useRef(appState);
  React.useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const [draft, setDraftState] = React.useState<ExpenseDraft>(() =>
    blankDraft(todayISO(), appState.settings.defaultCurrency),
  );
  // Latest draft, so setDraft calls in one handler compose and toInput() is never stale.
  const draftRef = React.useRef(draft);

  const replace = React.useCallback((next: ExpenseDraft): void => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const setDraft = React.useCallback(
    (patch: Partial<ExpenseDraft>): void => replace(applyDraftPatch(draftRef.current, patch, appStateRef.current)),
    [replace],
  );

  const startNew = React.useCallback(
    (args: { groupId?: ID | null; friendId?: ID }): void => replace(newDraft(appStateRef.current, args, todayISO())),
    [replace],
  );

  const startEdit = React.useCallback(
    (expense: Expense): void => {
      const group = expense.groupId ? appStateRef.current.groups[expense.groupId] : undefined;
      replace(draftFromExpense(expense, group ? group.memberIds : undefined));
    },
    [replace],
  );

  const toInput = React.useCallback((): ExpenseInput | null => evaluateDraft(draftRef.current).input, []);

  const evaluation = React.useMemo(() => evaluateDraft(draft), [draft]);

  const api = React.useMemo<DraftApi>(
    () => ({
      draft,
      setDraft,
      startNew,
      startEdit,
      total: evaluation.total,
      resolvedPayers: evaluation.resolvedPayers,
      errors: evaluation.errors,
      toInput,
    }),
    [draft, evaluation, setDraft, startNew, startEdit, toInput],
  );

  return <DraftContext.Provider value={api}>{props.children}</DraftContext.Provider>;
}

export function useDraft(): DraftApi {
  const api = React.useContext(DraftContext);
  if (!api) throw new Error('useDraft must be used inside <DraftProvider>.');
  return api;
}
