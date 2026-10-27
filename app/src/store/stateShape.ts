// Shape of the persisted AppState: defaults, a blank state and a defensive parser for
// whatever comes back from storage. Pure (no React / React Native).
import { ME_ID } from '../types';
import type { AppState, ISODateTime, Person, Settings } from '../types';
import { avatarPalette } from '../theme';

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
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
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

/** JSON from storage → AppState, or null when missing, unparseable, from another schema or damaged. */
export function parsePersistedState(raw: string | null | undefined): AppState | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isAppState(value)) return null;
  // Fill settings added after the state was saved.
  return { ...value, settings: { ...DEFAULT_SETTINGS, ...value.settings } };
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
