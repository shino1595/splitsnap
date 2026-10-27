// App-wide state: one context for the state, one for readiness and one for actions.
// The pure reducer (reducer.ts) does the work; this file adds ids, timestamps,
// validation results, AsyncStorage loading and the debounced save.
import * as React from 'react';
import { ME_ID } from '../types';
import type { AppState, CurrencyCode, Expense, ExpenseInput, Group, GroupType, ID, ISODate, Payment, PaymentInput, Person, Settings } from '../types';
import { newId } from '../lib/ids';
import { todayISO } from '../lib/dates';
import { appReducer, buildExpense, validatePaymentInput } from './reducer';
import type { AppAction } from './reducer';
import { canDeleteGroup, canRemoveFriend, canRemoveGroupMember } from './selectors';
import { createDemoState, createEmptyState } from './seed';
import { loadState, saveState } from './persistence';
import { demoKeepingProfile } from './stateShape';

export interface StoreActions {
  addFriend(input: { name: string; email?: string; phone?: string; upiId?: string }): Person;
  updatePerson(id: ID, patch: Partial<Omit<Person, 'id' | 'createdAt'>>): void;
  /** Refuses if any unsettled balance or shared group. */
  removeFriend(id: ID): { ok: boolean; reason?: string };
  /** Puts a removed friend back on the friends list (no-op for current friends and unknown ids). */
  restoreFriend(id: ID): void;
  /** ME_ID is always added. */
  createGroup(input: { name: string; type: GroupType; emoji: string; memberIds: ID[]; defaultCurrency: CurrencyCode; simplifyDebts: boolean }): Group;
  /** A memberIds patch never drops a member who still has a balance (use removeGroupMember for the reason). */
  updateGroup(id: ID, patch: Partial<Omit<Group, 'id' | 'createdAt'>>): void;
  addGroupMember(groupId: ID, personId: ID): void;
  /** Refuses if the member has a non-zero balance in the group. */
  removeGroupMember(groupId: ID, personId: ID): { ok: boolean; reason?: string };
  /** Refuses unless everyone is settled; deletes the group's expenses and payments. */
  deleteGroup(id: ID): { ok: boolean; reason?: string };
  /** Validates payers + computeOwed; nothing is saved when there are errors. */
  addExpense(input: ExpenseInput): { expense?: Expense; errors: string[] };
  updateExpense(id: ID, input: ExpenseInput): { expense?: Expense; errors: string[] };
  /** Soft delete. */
  deleteExpense(id: ID): void;
  restoreExpense(id: ID): void;
  addComment(expenseId: ID, text: string): void;
  /** Throws if the input is invalid (amount ≤ 0, same person twice, unknown group); check validatePaymentInput first. */
  addPayment(input: PaymentInput): Payment;
  /** Soft delete. */
  deletePayment(id: ID): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Demo data again; your profile, the OCR key and engine are kept. */
  resetToDemo(): void;
  /** Empty state with just ME_ID (your profile and settings are kept). */
  clearAllData(): void;
}

const SAVE_DELAY_MS = 300;

const StateContext = React.createContext<AppState | null>(null);
const ReadyContext = React.createContext<boolean>(false);
const ActionsContext = React.createContext<StoreActions | null>(null);

const nowISO = (): string => new Date().toISOString();

/** Demo data, or an empty state if building the demo ever fails. */
function demoOrEmpty(today: ISODate): AppState {
  try {
    return createDemoState(today);
  } catch {
    return createEmptyState();
  }
}

export function AppStoreProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = React.useState<AppState>(createEmptyState);
  const [ready, setReady] = React.useState(false);
  // Source of truth between renders. dispatch updates it synchronously, so an action
  // can return its result at once and several actions in one handler build on each other.
  const stateRef = React.useRef(state);
  const readyRef = React.useRef(false);
  const savedRef = React.useRef<AppState | null>(null);

  const dispatch = React.useCallback((action: AppAction): void => {
    const next = appReducer(stateRef.current, action);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  const processDueRecurring = React.useCallback((): void => {
    try {
      dispatch({ type: 'recurring/process', today: todayISO(), at: nowISO(), idBase: newId('rec') });
    } catch {
      // A broken recurrence must never block the app; the copies are retried on next load.
    }
  }, [dispatch]);

  // Load once: saved state, else demo data; then create any recurring copies that are due.
  React.useEffect(() => {
    let cancelled = false;
    loadState()
      .catch(() => null)
      .then((saved) => {
        if (cancelled) return;
        dispatch({ type: 'state/replace', state: saved || demoOrEmpty(todayISO()) });
        processDueRecurring();
        readyRef.current = true;
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, processDueRecurring]);

  // Debounced save: every change restarts the 300 ms timer.
  React.useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => {
      savedRef.current = state;
      saveState(state).catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, ready]);

  // Flush a pending save if the provider unmounts inside the debounce window.
  React.useEffect(
    () => () => {
      if (readyRef.current && savedRef.current !== stateRef.current) {
        saveState(stateRef.current).catch(() => undefined);
      }
    },
    [],
  );

  const actions = React.useMemo<StoreActions>(() => {
    const current = (): AppState => stateRef.current;
    const stamp = () => ({ at: nowISO(), activityId: newId('act') });

    return {
      addFriend(input) {
        const id = newId('per');
        dispatch({ type: 'friend/add', id, input, ...stamp() });
        return current().people[id];
      },

      updatePerson(id, patch) {
        dispatch({ type: 'person/update', id, patch, ...stamp() });
      },

      removeFriend(id) {
        const check = canRemoveFriend(current(), id);
        if (check.ok) dispatch({ type: 'friend/remove', id, ...stamp() });
        return check;
      },

      restoreFriend(id) {
        dispatch({ type: 'friend/restore', id, ...stamp() });
      },

      createGroup(input) {
        const id = newId('grp');
        dispatch({ type: 'group/create', id, input, ...stamp() });
        return current().groups[id];
      },

      updateGroup(id, patch) {
        dispatch({ type: 'group/update', id, patch, ...stamp() });
      },

      addGroupMember(groupId, personId) {
        dispatch({ type: 'group/addMember', groupId, personId, ...stamp() });
      },

      removeGroupMember(groupId, personId) {
        const check = canRemoveGroupMember(current(), groupId, personId);
        if (check.ok) dispatch({ type: 'group/removeMember', groupId, personId, ...stamp() });
        return check;
      },

      deleteGroup(id) {
        const check = canDeleteGroup(current(), id);
        if (check.ok) dispatch({ type: 'group/delete', id, ...stamp() });
        return check;
      },

      addExpense(input) {
        const id = newId('exp');
        const s = stamp();
        const result = buildExpense(current(), input, { id, at: s.at, createdBy: ME_ID });
        if (!result.expense) return { errors: result.errors };
        dispatch({ type: 'expense/add', id, input, ...s });
        processDueRecurring();
        return { expense: current().expenses[id] || result.expense, errors: [] };
      },

      updateExpense(id, input) {
        const existing = current().expenses[id];
        if (!existing) return { errors: ['This expense no longer exists'] };
        const s = stamp();
        const result = buildExpense(current(), input, { id, at: s.at, createdBy: ME_ID }, existing);
        if (!result.expense) return { errors: result.errors };
        dispatch({ type: 'expense/update', id, input, ...s });
        processDueRecurring();
        return { expense: current().expenses[id] || result.expense, errors: [] };
      },

      deleteExpense(id) {
        dispatch({ type: 'expense/delete', id, ...stamp() });
      },

      restoreExpense(id) {
        dispatch({ type: 'expense/restore', id, ...stamp() });
        processDueRecurring();
      },

      addComment(expenseId, text) {
        dispatch({ type: 'comment/add', expenseId, commentId: newId('cmt'), text, ...stamp() });
      },

      addPayment(input) {
        const errors = validatePaymentInput(current(), input);
        if (errors.length > 0) throw new Error(`Can't record this payment: ${errors.join(', ')}.`);
        const id = newId('pay');
        dispatch({ type: 'payment/add', id, input, ...stamp() });
        return current().payments[id];
      },

      deletePayment(id) {
        dispatch({ type: 'payment/delete', id, ...stamp() });
      },

      updateSettings(patch) {
        dispatch({ type: 'settings/update', patch, ...stamp() });
      },

      resetToDemo() {
        dispatch({ type: 'state/replace', state: demoKeepingProfile(demoOrEmpty(todayISO()), current()) });
        processDueRecurring();
      },

      clearAllData() {
        dispatch({ type: 'state/clear', at: nowISO() });
      },
    };
  }, [dispatch, processDueRecurring]);

  return (
    <ReadyContext.Provider value={ready}>
      <ActionsContext.Provider value={actions}>
        <StateContext.Provider value={state}>{props.children}</StateContext.Provider>
      </ActionsContext.Provider>
    </ReadyContext.Provider>
  );
}

export function useAppState(): AppState {
  const state = React.useContext(StateContext);
  if (!state) throw new Error('useAppState must be used inside <AppStoreProvider>.');
  return state;
}

/** False until the saved state (or the demo data) has been loaded. */
export function useStoreReady(): boolean {
  return React.useContext(ReadyContext);
}

export function useActions(): StoreActions {
  const actions = React.useContext(ActionsContext);
  if (!actions) throw new Error('useActions must be used inside <AppStoreProvider>.');
  return actions;
}
