import { createDemoState } from '../../app/src/store/seed';
import { MIGRATIONS, parsePersistedState, readSavedState, readSavedValue } from '../../app/src/store/stateShape';
import type { Migration } from '../../app/src/store/stateShape';

const demo = () => createDemoState('2026-10-19');
const BAD = { kind: 'damaged', reason: 'bad-shape' };

describe('readSavedState', () => {
  it('reads nothing as none', () => {
    expect(readSavedState(null)).toEqual({ kind: 'none' });
    expect(readSavedState(undefined)).toEqual({ kind: 'none' });
    expect(readSavedState('')).toEqual({ kind: 'none' });
  });

  it('reads a good state as ok, without upgradedFrom', () => {
    const result = readSavedState(JSON.stringify(demo()));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.upgradedFrom).toBeUndefined();
      expect(Object.keys(result.state.groups)).toHaveLength(2);
    }
  });

  it('calls text that is not JSON damaged', () => {
    expect(readSavedState('{oops')).toEqual({ kind: 'damaged', reason: 'not-json' });
  });

  it('calls the wrong shape damaged', () => {
    expect(readSavedState('5')).toEqual(BAD);
    expect(readSavedState('[]')).toEqual(BAD);
    expect(readSavedState('null')).toEqual(BAD);
    expect(readSavedState('{}')).toEqual(BAD);
    expect(readSavedState(JSON.stringify({ ...demo(), schemaVersion: 0 }))).toEqual(BAD);
    expect(readSavedState(JSON.stringify({ ...demo(), schemaVersion: 1.5 }))).toEqual(BAD);
    expect(readSavedState(JSON.stringify({ ...demo(), schemaVersion: '1' }))).toEqual(BAD);
    expect(readSavedState(JSON.stringify({ ...demo(), people: {} }))).toEqual(BAD);
  });

  it('calls a newer schema damaged and says why', () => {
    expect(readSavedState(JSON.stringify({ ...demo(), schemaVersion: 2 }))).toEqual({ kind: 'damaged', reason: 'newer-version' });
  });

  it('has no migrations while the schema is 1', () => {
    expect(Object.keys(MIGRATIONS)).toHaveLength(0);
  });
});

describe('migrations', () => {
  const to2: Migration = (old) => ({ ...old, note2: true });
  const to3: Migration = (old) => ({ ...old, note3: true });

  it('runs each step in order and reports where it started', () => {
    const result = readSavedState(JSON.stringify(demo()), { 1: to2, 2: to3 }, 3);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.upgradedFrom).toBe(1);
    expect(result.state.schemaVersion as number).toBe(3);
    const extra = result.state as unknown as Record<string, unknown>;
    expect(extra.note2).toBe(true);
    expect(extra.note3).toBe(true);
  });

  it('starts at the saved version', () => {
    const saved = { ...demo(), schemaVersion: 2 };
    const result = readSavedValue(saved, { 2: to3 }, 3);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.upgradedFrom).toBe(2);
  });

  it('calls a missing step damaged', () => {
    expect(readSavedState(JSON.stringify(demo()), { 1: to2 }, 3)).toEqual(BAD);
  });

  it('calls a step that throws damaged', () => {
    const boom: Migration = () => {
      throw new Error('nope');
    };
    expect(readSavedState(JSON.stringify(demo()), { 1: boom }, 2)).toEqual(BAD);
  });

  it('calls a step that returns junk damaged', () => {
    const junk = (() => 5) as unknown as Migration;
    expect(readSavedState(JSON.stringify(demo()), { 1: junk }, 2)).toEqual(BAD);
  });

  it('refuses a version above the target', () => {
    expect(readSavedState(JSON.stringify({ ...demo(), schemaVersion: 4 }), { 1: to2, 2: to3 }, 3)).toEqual({
      kind: 'damaged',
      reason: 'newer-version',
    });
  });
});

describe('parsePersistedState', () => {
  it('returns the state for good data and null for everything else', () => {
    expect(parsePersistedState(JSON.stringify(demo()))).not.toBeNull();
    expect(parsePersistedState(null)).toBeNull();
    expect(parsePersistedState('')).toBeNull();
    expect(parsePersistedState('nope')).toBeNull();
    expect(parsePersistedState(JSON.stringify({ ...demo(), schemaVersion: 2 }))).toBeNull();
    expect(parsePersistedState('{}')).toBeNull();
  });

  it('fills missing settings and drops unknown themes', () => {
    const state = demo() as unknown as Record<string, unknown>;
    state.settings = { defaultCurrency: 'USD' };
    const groups = state.groups as Record<string, Record<string, unknown>>;
    for (const id of Object.keys(groups)) groups[id].theme = 'space';
    const parsed = parsePersistedState(JSON.stringify(state));
    expect(parsed).not.toBeNull();
    expect(parsed!.settings.defaultCurrency).toBe('USD');
    expect(parsed!.settings.ocrEngine).toBe(2);
    for (const g of Object.values(parsed!.groups)) expect(g.theme).toBeUndefined();
  });
});
