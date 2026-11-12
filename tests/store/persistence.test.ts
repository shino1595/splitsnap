import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDemoState } from '../../app/src/store/seed';
import { STORAGE_KEY } from '../../app/src/store/stateShape';
import { keepUnreadableCopy, loadSavedState, readRawSavedState, saveState } from '../../app/src/store/persistence';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('loadSavedState', () => {
  it('says none when nothing is saved, and writes nothing', async () => {
    expect(await loadSavedState()).toEqual({ kind: 'none' });
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('returns a good saved state', async () => {
    const state = createDemoState('2026-10-19');
    await saveState(state);
    const outcome = await loadSavedState();
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') expect(Object.keys(outcome.state.groups)).toEqual(Object.keys(state.groups));
  });

  it('returns damaged data with its raw text and leaves the stored value untouched', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{broken');
    expect(await loadSavedState()).toEqual({ kind: 'damaged', raw: '{broken', reason: 'not-json' });
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('{broken');

    const newer = JSON.stringify({ ...createDemoState('2026-10-19'), schemaVersion: 9 });
    await AsyncStorage.setItem(STORAGE_KEY, newer);
    expect(await loadSavedState()).toEqual({ kind: 'damaged', raw: newer, reason: 'newer-version' });
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(newer);
  });

  it('reports storage that throws as unreadable', async () => {
    const original = AsyncStorage.getItem;
    AsyncStorage.getItem = () => Promise.reject(new Error('disk gone'));
    try {
      expect(await loadSavedState()).toEqual({ kind: 'unreadable', message: 'disk gone' });
    } finally {
      AsyncStorage.getItem = original;
    }
  });
});

describe('readRawSavedState', () => {
  it('returns the text exactly as stored, or null', async () => {
    expect(await readRawSavedState()).toBeNull();
    await AsyncStorage.setItem(STORAGE_KEY, ' {"a": 1} ');
    expect(await readRawSavedState()).toBe(' {"a": 1} ');
  });
});

describe('keepUnreadableCopy', () => {
  it('writes the copy under its own key and leaves the saved state alone', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'bad data');
    const key = await keepUnreadableCopy('bad data', '2026-11-12T10:00:00.000Z');
    expect(key).toBe('splitsnap/state/kept/2026-11-12T10:00:00.000Z');
    expect(await AsyncStorage.getItem(key)).toBe('bad data');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('bad data');
  });

  it('rejects when the write fails', async () => {
    const original = AsyncStorage.setItem;
    AsyncStorage.setItem = () => Promise.reject(new Error('full'));
    try {
      let failed = false;
      await keepUnreadableCopy('x', 'now').catch(() => {
        failed = true;
      });
      expect(failed).toBe(true);
    } finally {
      AsyncStorage.setItem = original;
    }
  });
});
