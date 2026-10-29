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
import type { ImportPlan } from '../lib/splitwiseImport';
import type { LocalBatch } from '../sync/types';
import { loadSyncState, sharedGroupIdsNow } from '../sync/syncStorage';
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
  /** Adds a Splitwise export (see lib/splitwiseImport) in one step. Counts are what was actually added. */
  importFromSplitwise(plan: ImportPlan): { groupId: ID; expenses: number; payments: number };
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
  /** Changes from a shared group's server (sync engine only); logs no activity of its own. */
  applyRemote(batch: LocalBatch): void;
}

/** Called after every dispatch that changed the state, with the action that changed it. */
export type StoreListener = (prev: AppState, next: AppState, action: AppAction) => void;

/** For the sync engine: the latest state outside render, and every change as it happens. */
export interface StoreInternals {
  getState(): AppState;
  /** Returns the unsubscribe function. */
  subscribe(listener: StoreListener): () => void;
  /** Saves the current state now instead of after the debounce; rejects when the write fails. */
  flushSave(): Promise<void>;
}

const SAVE_DELAY_MS = 300;

const StateContext = React.createContext<AppState | null>(null);
const ReadyContext = React.createContext<boolean>(false);
const ActionsContext = React.createContext<StoreActions | null>(null);
const InternalsContext = React.createContext<StoreInternals | null>(null);

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
  // The write of savedRef.current (it may still be on its way).
  const savingRef = React.useRef<Promise<void>>(Promise.resolve());
  // Replaced, never mutated, so unsubscribing inside a listener can't disturb the loop below.
  const listenersRef = React.useRef<StoreListener[]>([]);

  const dispatch = React.useCallback((action: AppAction): void => {
    const prev = stateRef.current;
    const next = appReducer(prev, action);
    if (next !== prev) {
      stateRef.current = next;
      setState(next);
      for (const listener of listenersRef.current) {
        try {
          listener(prev, next, action);
        } catch {
          // Sync must never break a local action; the engine catches up on its next pull.
        }
      }
    }
  }, []);

  const processDueRecurring = React.useCallback((): void => {
    try {
      dispatch({ type: 'recurring/process', today: todayISO(), at: nowISO(), idBase: newId('rec'), sharedGroupIds: sharedGroupIdsNow() });
    } catch {
      // A broken recurrence must never block the app; the copies are retried on next load.
    }
  }, [dispatch]);

  // Load once: saved state, else demo data. The sync state is loaded first, so the recurring
  // check below knows which groups are shared on this phone.
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([loadState().catch(() => null), loadSyncState()])
      .then(([saved]) => {
        if (cancelled) return;
        dispatch({ type: 'state/replace', state: saved || demoOrEmpty(todayISO()) });
        readyRef.current = true;
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Recurring copies that fell due while the app was closed, once loaded. Not inside the load
  // above: SyncProvider (a child, so its effects run first in this commit) starts the sync engine
  // on `ready`, and the engine only sends what changed after it took its starting state.
  React.useEffect(() => {
    if (ready) processDueRecurring();
  }, [ready, processDueRecurring]);

  /** Writes `s` now; the debounced save, the unmount flush and flushSave all go through here. */
  const save = React.useCallback((s: AppState): Promise<void> => {
    savedRef.current = s;
    const write = saveState(s);
    savingRef.current = write;
    // A failed write leaves the state unsaved, so the next save or flushSave tries again.
    write.catch(() => {
      if (savingRef.current === write) savedRef.current = null;
    });
    return write;
  }, []);

  // Debounced save: every change restarts the 300 ms timer.
  React.useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => {
      if (savedRef.current !== state) save(state).catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, ready, save]);

  // Flush a pending save if the provider unmounts inside the debounce window.
  React.useEffect(
    () => () => {
      if (readyRef.current && savedRef.current !== stateRef.current) {
        save(stateRef.current).catch(() => undefined);
      }
    },
    [save],
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

      importFromSplitwise(plan) {
        dispatch({ type: 'import/apply', plan, ...stamp() });
        const state = current();
        const live = (groupId: ID | null) => groupId === plan.groupId;
        return {
          groupId: plan.groupId,
          expenses: Object.values(state.expenses).filter((e) => live(e.groupId)).length,
          payments: Object.values(state.payments).filter((p) => live(p.groupId)).length,
        };
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

      applyRemote(batch) {
        dispatch({ type: 'sync/applyRemote', batch, at: nowISO() });
      },
    };
  }, [dispatch, processDueRecurring]);

  const internals = React.useMemo<StoreInternals>(
    () => ({
      getState: () => stateRef.current,
      subscribe(listener) {
        listenersRef.current = [...listenersRef.current, listener];
        return () => {
          listenersRef.current = listenersRef.current.filter((l) => l !== listener);
        };
      },
      flushSave() {
        if (!readyRef.current) return Promise.resolve();
        // Already written, or on its way: wait for that write instead of starting another.
        return savedRef.current === stateRef.current ? savingRef.current : save(stateRef.current);
      },
    }),
    [save],
  );

  return (
    <ReadyContext.Provider value={ready}>
      <InternalsContext.Provider value={internals}>
        <ActionsContext.Provider value={actions}>
          <StateContext.Provider value={state}>{props.children}</StateContext.Provider>
        </ActionsContext.Provider>
      </InternalsContext.Provider>
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

/** Sync engine only: listeners run inside dispatch, after the new state is current. */
export function useStoreInternals(): StoreInternals {
  const internals = React.useContext(InternalsContext);
  if (!internals) throw new Error('useStoreInternals must be used inside <AppStoreProvider>.');
  return internals;
}
