// Pure helpers for the Import from Splitwise screen (tested in tests/screens/importLogic.test.ts).
import type { CurrencyCode, Group, Minor } from '../../types';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';

/** Biggest file the screen reads (a 5-year group export is well under 1 MB). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The column that is probably the app user: the same full name, else the only column with the
 * same first name. -1 when unsure (the screen then asks).
 */
export function guessMeIndex(people: string[], myName: string): number {
  const mine = norm(myName);
  if (!mine || mine === 'you') return -1;
  const exact = people.findIndex((p) => norm(p) === mine);
  if (exact >= 0) return exact;
  const first = mine.split(' ')[0];
  const matches = people.map((p, i) => (norm(p).split(' ')[0] === first ? i : -1)).filter((i) => i >= 0);
  return matches.length === 1 ? matches[0] : -1;
}

/**
 * Splitwise's website names the file '<group-name>_<YYYY-MM-DD>_export.csv'; that gives the
 * group name ('goa-trip_2026-10-28_export.csv' → 'Goa trip'). '' for any other file name.
 */
export function groupNameFromFileName(fileName: string): string {
  const match = /^(.+?)_\d{4}-\d{2}-\d{2}_export(\.csv)?$/i.exec(fileName.trim());
  if (!match) return '';
  const words = match[1].replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** A group (archived ones too) with this name, ignoring case and extra spaces. */
export function findGroupByName(groups: Record<string, Group>, name: string): Group | undefined {
  const wanted = norm(name);
  if (!wanted) return undefined;
  return Object.values(groups).find((g) => norm(g.name) === wanted);
}

/** 'gets back ₹5,476.53' / 'owes ₹1,369.03' / 'settled up'. */
export function balancePhrase(net: Minor, currency: CurrencyCode): string {
  if (net > 0) return `gets back ${formatMoney(net, currency)}`;
  if (net < 0) return `owes ${formatMoney(net, currency, { abs: true })}`;
  return 'settled up';
}

/** 'Jan 23, 2026 – Oct 28, 2026' for the preview. */
export function dateRangeText(first?: string, last?: string): string {
  if (!first || !last) return '';
  return first === last ? formatDate(first, 'long') : `${formatDate(first, 'long')} – ${formatDate(last, 'long')}`;
}
