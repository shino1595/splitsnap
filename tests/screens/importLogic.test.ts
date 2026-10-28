import type { Group } from '../../app/src/types';
import {
  balancePhrase,
  dateRangeText,
  findGroupByName,
  groupNameFromFileName,
  guessMeIndex,
} from '../../app/src/screens/import/importLogic';

const PEOPLE = ['Aarav Shah', 'Bhavna Rao', 'Chirag Mehta', 'Chirag Jain'];

describe('guessMeIndex', () => {
  it('matches the full name, ignoring case and spaces', () => {
    expect(guessMeIndex(PEOPLE, '  bhavna   RAO ')).toBe(1);
  });

  it('falls back to a first name only when exactly one column has it', () => {
    expect(guessMeIndex(PEOPLE, 'Aarav')).toBe(0);
    expect(guessMeIndex(PEOPLE, 'Chirag')).toBe(-1);
  });

  it('gives up for the default profile name or no match', () => {
    expect(guessMeIndex(PEOPLE, 'You')).toBe(-1);
    expect(guessMeIndex(PEOPLE, '')).toBe(-1);
    expect(guessMeIndex(PEOPLE, 'Diya')).toBe(-1);
  });
});

describe('groupNameFromFileName', () => {
  it("reads the group from the website's file name", () => {
    expect(groupNameFromFileName('goa-trip_2026-10-28_export.csv')).toBe('Goa trip');
    expect(groupNameFromFileName('flat_302_2026-01-02_export.csv')).toBe('Flat 302');
  });

  it('returns nothing for other names', () => {
    expect(groupNameFromFileName('Splitwise expenses Oct 28.csv')).toBe('');
    expect(groupNameFromFileName('Pasted text')).toBe('');
  });
});

describe('findGroupByName', () => {
  const group = (id: string, name: string): Group => ({
    id,
    name,
    type: 'other',
    emoji: '🧾',
    memberIds: ['me'],
    simplifyDebts: true,
    defaultCurrency: 'INR',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('finds a group with the same name, ignoring case and spaces', () => {
    const groups = { g1: group('g1', 'Goa Trip'), g2: group('g2', 'Chai  Club') };
    expect(findGroupByName(groups, ' chai club')!.id).toBe('g2');
    expect(findGroupByName(groups, 'Chai')).toBeUndefined();
    expect(findGroupByName(groups, '  ')).toBeUndefined();
  });
});

describe('balancePhrase and dateRangeText', () => {
  it('describes a final balance', () => {
    expect(balancePhrase(547653, 'INR')).toBe('gets back ₹5,476.53');
    expect(balancePhrase(-136903, 'INR')).toBe('owes ₹1,369.03');
    expect(balancePhrase(0, 'INR')).toBe('settled up');
  });

  it('shows the span of the export', () => {
    expect(dateRangeText('2026-01-23', '2026-10-28')).toBe('Jan 23, 2026 – Oct 28, 2026');
    expect(dateRangeText('2026-01-23', '2026-01-23')).toBe('Jan 23, 2026');
    expect(dateRangeText(undefined, '2026-01-23')).toBe('');
  });
});
