// AsyncStorage glue. Parsing and validation live in stateShape.ts (pure, unit-tested).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppState } from '../types';
import { STORAGE_KEY, parsePersistedState } from './stateShape';

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
