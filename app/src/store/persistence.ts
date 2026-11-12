// AsyncStorage glue. Parsing and validation live in stateShape.ts (pure, unit-tested).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppState } from '../types';
import { STORAGE_KEY, parsePersistedState, readSavedState } from './stateShape';

/** The saved state, or null if nothing is saved, it can't be read, or it is corrupt / from an old schema. */
export async function loadState(): Promise<AppState | null> {
  try {
    return parsePersistedState(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function saveState(state: AppState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function clearSavedState(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export type LoadOutcome =
  | { kind: 'none' }
  | { kind: 'ok'; state: AppState }
  | { kind: 'damaged'; raw: string; reason: 'not-json' | 'newer-version' | 'bad-shape' }
  | { kind: 'unreadable'; message: string };

const BEFORE_UPGRADE_PREFIX = 'splitsnap/state/before-upgrade-v';
const KEPT_PREFIX = 'splitsnap/state/kept/';

/**
 * What is on the phone, told apart: nothing, a good state, data we can't read (kept as text so it
 * can be shared or set aside) or storage that failed. Never writes to STORAGE_KEY itself.
 */
export async function loadSavedState(): Promise<LoadOutcome> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return { kind: 'unreadable', message: e instanceof Error ? e.message : String(e) };
  }
  const result = readSavedState(raw);
  if (result.kind === 'none') return { kind: 'none' };
  if (result.kind === 'damaged') return { kind: 'damaged', raw: raw ?? '', reason: result.reason };
  if (result.upgradedFrom !== undefined && raw) {
    try {
      await AsyncStorage.setItem(`${BEFORE_UPGRADE_PREFIX}${result.upgradedFrom}`, raw);
    } catch {
      // The upgrade goes ahead without a copy of the old data.
    }
  }
  return { kind: 'ok', state: result.state };
}

/** The saved text exactly as stored (for the recovery and crash screens); null if none or unreadable. */
export async function readRawSavedState(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? raw : null;
  } catch {
    return null;
  }
}

/** Copies unreadable saved data to its own key before anything replaces it. Rejects if the write fails. Returns the key. */
export async function keepUnreadableCopy(raw: string, at: string): Promise<string> {
  const key = `${KEPT_PREFIX}${at}`;
  await AsyncStorage.setItem(key, raw);
  return key;
}
