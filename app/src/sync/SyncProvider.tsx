// Shared-group sync for the screens (docs/SYNC_DESIGN.md). PLACEHOLDER: sharing is "off" until the
// sync engine replaces this file (roadmap 05, A2). The API (SyncApi in types.ts) stays the same.
import * as React from 'react';
import type { SyncApi } from './types';

const notReady = (): Promise<never> => Promise.reject(new Error('Shared groups are not available yet.'));

const OFF: SyncApi = {
  status: 'off',
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

const SyncContext = React.createContext<SyncApi>(OFF);

export function SyncProvider(props: { children: React.ReactNode }): React.JSX.Element {
  return <SyncContext.Provider value={OFF}>{props.children}</SyncContext.Provider>;
}

export function useSync(): SyncApi {
  return React.useContext(SyncContext);
}
