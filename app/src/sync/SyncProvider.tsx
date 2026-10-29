// Shared-group sync for the screens (docs/SYNC_DESIGN.md): one SyncEngine, started once the saved
// state has loaded, behind useSync(). The API (SyncApi in types.ts) re-renders on every change.
import * as React from 'react';
import { useActions, useStoreInternals, useStoreReady } from '../store/AppStore';
import { isSyncConfigured } from './config';
import { SyncEngine } from './engine';
import { createSupabaseBackend } from './supabaseBackend';
import { syncStorage } from './syncStorage';
import { SyncError } from './types';
import type { SyncApi } from './types';

const notReady = (): Promise<never> =>
  Promise.reject(new SyncError('network', 'Shared groups are still starting. Try again in a moment.'));

/** Until the engine runs (the app shows its loading screen meanwhile). */
const WAITING: SyncApi = {
  status: isSyncConfigured() ? 'idle' : 'off',
  pending: 0,
  lastError: null,
  displayName: null,
  setDisplayName: notReady,
  shared: () => null,
  isOnSplitSnap: () => false,
  shareGroup: notReady,
  previewJoin: notReady,
  joinGroup: notReady,
  leaveGroup: notReady,
  resetJoinCode: notReady,
  syncNow: () => Promise.resolve(),
};

const SyncContext = React.createContext<SyncApi>(WAITING);

/** Goes inside AppStoreProvider: the engine follows the store and writes back through applyRemote. */
export function SyncProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const ready = useStoreReady();
  const internals = useStoreInternals();
  const { applyRemote } = useActions();
  const [api, setApi] = React.useState<SyncApi>(WAITING);

  React.useEffect(() => {
    if (!ready) return undefined;
    const engine: SyncEngine = new SyncEngine({
      backend: createSupabaseBackend(),
      store: { getState: internals.getState, subscribe: internals.subscribe, flushSave: internals.flushSave, applyRemote },
      storage: syncStorage,
      onChange: () => setApi(engine.getApi()),
      log: (message) => console.warn(`[sync] ${message}`),
    });
    setApi(engine.getApi());
    // start() takes its starting state and subscribes before it returns: AppStore makes the
    // start-up recurring copies in its own effect, which runs right after this one.
    void engine.start();
    return () => engine.stop();
  }, [ready, internals, applyRemote]);

  return <SyncContext.Provider value={api}>{props.children}</SyncContext.Provider>;
}

export function useSync(): SyncApi {
  return React.useContext(SyncContext);
}
