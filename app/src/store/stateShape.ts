// Shape of the persisted AppState: defaults, a blank state and a defensive parser for
// whatever comes back from storage. Pure (no React / React Native).
import { ME_ID, SCHEMA_VERSION } from '../types';
import type { AppState, ISODateTime, Person, Settings } from '../types';
import { avatarPalette } from '../theme';
import { isGroupThemeId } from '../lib/groupThemes';

export const STORAGE_KEY = 'splitsnap/state/v1';

export const DEFAULT_SETTINGS: Settings = {
  defaultCurrency: 'INR',
  ocrApiKey: '',
  ocrEngine: 2,
  simplifyDebtsDefault: true,
  appearance: 'system',
};

export function makeMePerson(at: ISODateTime): Person {
  return { id: ME_ID, name: 'You', color: avatarPalette[0], createdAt: at };
}

/** A state with nobody but the user and no data. */
export function blankState(at: ISODateTime, me?: Person, settings?: Settings): AppState {
  return {
    schemaVersion: 1,
    people: { [ME_ID]: me ?? makeMePerson(at) },
    friendIds: [],
    groups: {},
    expenses: {},
    payments: {},
    activity: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordOf(value: unknown, check: (item: Record<string, unknown>) => boolean): boolean {
  if (!isRecord(value)) return false;
  return Object.keys(value).every((key) => {
    const item = value[key];
    return isRecord(item) && item.id === key && check(item);
  });
}

const isShareList = (v: unknown): boolean =>
  Array.isArray(v) && v.every((s) => isRecord(s) && typeof s.personId === 'string' && Number.isInteger(s.amount));

/**
 * Structural check of a saved state. It is deliberately strict about the fields the
 * engine relies on (ids, money integers, arrays) so a damaged save falls back to demo
 * data instead of crashing a screen.
 */
export function isAppState(value: unknown): value is AppState {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) return false;
  const { people, friendIds, groups, expenses, payments, activity, settings } = value;
  if (!isRecordOf(people, (p) => typeof p.name === 'string' && typeof p.color === 'string')) return false;
  if (!isRecord(people) || !isRecord(people[ME_ID])) return false;
  if (!Array.isArray(friendIds) || !friendIds.every((id) => typeof id === 'string')) return false;
  if (!isRecordOf(groups, (g) => typeof g.name === 'string' && Array.isArray(g.memberIds) && typeof g.defaultCurrency === 'string')) return false;
  if (
    !isRecordOf(
      expenses,
      (e) =>
        typeof e.description === 'string' &&
        typeof e.currency === 'string' &&
        Number.isInteger(e.total) &&
        typeof e.date === 'string' &&
        isShareList(e.payers) &&
        isShareList(e.owed) &&
        isRecord(e.split) &&
        Array.isArray(e.comments),
    )
  )
    return false;
  if (
    !isRecordOf(
      payments,
      (p) => typeof p.fromId === 'string' && typeof p.toId === 'string' && Number.isInteger(p.amount) && typeof p.currency === 'string',
    )
  )
    return false;
  if (!Array.isArray(activity) || !activity.every((a) => isRecord(a) && typeof a.summary === 'string')) return false;
  return isRecord(settings) && typeof settings.defaultCurrency === 'string';
}

/** A theme this version does not know (saved by a newer build) is dropped, which reads as the default theme. */
function withKnownThemes(groups: AppState['groups']): AppState['groups'] {
  const ids = Object.keys(groups);
  if (ids.every((id) => groups[id].theme === undefined || isGroupThemeId(groups[id].theme))) return groups;
  const out: AppState['groups'] = {};
  for (const id of ids) {
    const { theme, ...rest } = groups[id];
    out[id] = isGroupThemeId(theme) ? groups[id] : rest;
  }
  return out;
}

export type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] turns a saved state of schema n into schema n + 1. Empty while SCHEMA_VERSION is 1. */
export const MIGRATIONS: Record<number, Migration> = {};

export type SavedStateResult =
  | { kind: 'none' }
  | { kind: 'ok'; state: AppState; upgradedFrom?: number }
  | { kind: 'damaged'; reason: 'not-json' | 'newer-version' | 'bad-shape' };

const BAD_SHAPE: SavedStateResult = { kind: 'damaged', reason: 'bad-shape' };

/** A parsed value → state. Runs migrations from its schemaVersion up to `target`. */
export function readSavedValue(
  value: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): SavedStateResult {
  if (!isRecord(value)) return BAD_SHAPE;
  const version = value.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return BAD_SHAPE;
  if (version > target) return { kind: 'damaged', reason: 'newer-version' };

  let current: Record<string, unknown> = value;
  for (let v = version; v < target; v++) {
    const step = Object.prototype.hasOwnProperty.call(migrations, v) ? migrations[v] : undefined;
    if (!step) return BAD_SHAPE;
    try {
      const out = step(current);
      if (!isRecord(out)) return BAD_SHAPE;
      current = { ...out, schemaVersion: v + 1 };
    } catch {
      return BAD_SHAPE;
    }
  }

  // Another target only happens in tests of the upgrade step: the shape check is for this build's schema.
  if (target !== SCHEMA_VERSION) {
    if (current.schemaVersion !== target) return BAD_SHAPE;
    const upgraded = current as unknown as AppState;
    return version < target ? { kind: 'ok', state: upgraded, upgradedFrom: version } : { kind: 'ok', state: upgraded };
  }
  if (!isAppState(current)) return BAD_SHAPE;
  const state: AppState = current;
  // Fill settings added after the state was saved.
  const result: AppState = { ...state, groups: withKnownThemes(state.groups), settings: { ...DEFAULT_SETTINGS, ...state.settings } };
  return version < target ? { kind: 'ok', state: result, upgradedFrom: version } : { kind: 'ok', state: result };
}

/** JSON text from storage → state. null/undefined/'' → 'none'. */
export function readSavedState(
  raw: string | null | undefined,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): SavedStateResult {
  if (!raw) return { kind: 'none' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'damaged', reason: 'not-json' };
  }
  return readSavedValue(value, migrations, target);
}

/** JSON from storage → AppState, or null when missing, unparseable, from another schema or damaged. */
export function parsePersistedState(raw: string | null | undefined): AppState | null {
  const result = readSavedState(raw);
  return result.kind === 'ok' ? result.state : null;
}

/**
 * 'Reset demo data': the demo replaces groups, friends, expenses and payments, but the user's
 * own profile (name, email, avatar colour, UPI ID), their OCR key and engine, and the appearance carry over.
 */
export function demoKeepingProfile(demo: AppState, current: AppState): AppState {
  const me = current.people[ME_ID];
  const { ocrApiKey, ocrEngine, appearance } = current.settings;
  return {
    ...demo,
    people: me ? { ...demo.people, [ME_ID]: me } : demo.people,
    settings: { ...demo.settings, ocrApiKey, ocrEngine, appearance },
  };
}
