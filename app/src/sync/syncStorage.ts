// Sync bookkeeping in its own AsyncStorage key, never inside AppState (docs/SYNC_DESIGN.md §3).
// Loading never throws: damaged or old data means "nothing shared on this phone".
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ID } from '../types';
import { EMPTY_SYNC_STATE, SYNC_STATE_VERSION } from './types';
import type { OutboxKey, OutboxKind, SharedGroupInfo, SharedMemberInfo, SyncState } from './types';

export const SYNC_STORAGE_KEY = 'splitsnap/sync/v1';

const KINDS: OutboxKind[] = ['group', 'member', 'expense', 'payment', 'comment', 'activity', 'group-delete'];

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isId(v: unknown): v is ID {
  return typeof v === 'string' && v.length > 0;
}

function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readMembers(v: unknown): Record<ID, SharedMemberInfo> {
  const out: Record<ID, SharedMemberInfo> = {};
  if (!isRecord(v)) return out;
  for (const id of Object.keys(v)) {
    const m = v[id];
    if (!isId(id) || id === '__proto__' || !isRecord(m)) continue;
    out[id] = { userId: textOrNull(m.userId), leftAt: textOrNull(m.leftAt) };
  }
  return out;
}

function readGroup(id: ID, v: unknown): SharedGroupInfo | null {
  if (!isRecord(v) || v.groupId !== id || !isId(v.myMemberId)) return null;
  return {
    groupId: id,
    myMemberId: v.myMemberId,
    joinCode: textOrNull(v.joinCode),
    joinEnabled: typeof v.joinEnabled === 'boolean' ? v.joinEnabled : true,
    members: readMembers(v.members),
    cursor: textOrNull(v.cursor),
  };
}

function readKey(v: unknown): OutboxKey | null {
  if (!isRecord(v) || KINDS.indexOf(v.kind as OutboxKind) < 0 || !isId(v.groupId) || !isId(v.id)) return null;
  const key: OutboxKey = { kind: v.kind as OutboxKind, groupId: v.groupId, id: v.id };
  if (key.kind === 'comment') {
    // A comment is found through its expense; without one it can never be sent.
    if (!isId(v.expenseId)) return null;
    key.expenseId = v.expenseId;
  }
  return key;
}

/** The saved text → SyncState. Unreadable or another version → EMPTY_SYNC_STATE; bad entries are dropped. */
export function parseSyncState(raw: string | null | undefined): SyncState {
  if (typeof raw !== 'string' || !raw) return EMPTY_SYNC_STATE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_SYNC_STATE;
  }
  if (!isRecord(value) || value.version !== SYNC_STATE_VERSION) return EMPTY_SYNC_STATE;
  const groups: Record<ID, SharedGroupInfo> = {};
  if (isRecord(value.groups)) {
    for (const id of Object.keys(value.groups)) {
      const info = id === '__proto__' ? null : readGroup(id, value.groups[id]);
      if (info) groups[id] = info;
    }
  }
  const outbox: OutboxKey[] = [];
  if (Array.isArray(value.outbox)) {
    for (const item of value.outbox) {
      const key = readKey(item);
      if (key) outbox.push(key);
    }
  }
  return {
    version: SYNC_STATE_VERSION,
    userId: textOrNull(value.userId),
    displayName: textOrNull(value.displayName),
    groups,
    outbox,
  };
}

// The shared groups this phone last loaded or saved. AppStore reads it for 'recurring/process', which
// runs before the sync engine starts, so it is also filled by the first load.
let lastSharedGroupIds: ID[] = [];

/** Ids of the groups shared on this phone, as last loaded or saved. */
export function sharedGroupIdsNow(): ID[] {
  return lastSharedGroupIds;
}

export async function loadSyncState(): Promise<SyncState> {
  let state = EMPTY_SYNC_STATE;
  try {
    state = parseSyncState(await AsyncStorage.getItem(SYNC_STORAGE_KEY));
  } catch {
    // Storage can't be read: start with nothing shared.
  }
  lastSharedGroupIds = Object.keys(state.groups);
  return state;
}

export async function saveSyncState(state: SyncState): Promise<void> {
  // Before the write, so a recurring check right after a change already sees it.
  lastSharedGroupIds = Object.keys(state.groups);
  await AsyncStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state));
}

/** What the engine's `storage` option expects. */
export const syncStorage = { load: loadSyncState, save: saveSyncState };
