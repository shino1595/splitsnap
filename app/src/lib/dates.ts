// Calendar dates are 'YYYY-MM-DD' strings in local time. Date arithmetic is done on
// day numbers (no Date objects), so it is immune to time zones and DST. No Intl.
import type { ISODate, ISODateTime } from '../types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface YMD {
  y: number;
  m: number; // 1–12
  d: number; // 1–31
}

function pad(n: number, width: number): string {
  let s = String(Math.abs(n));
  while (s.length < width) s = '0' + s;
  return n < 0 ? '-' + s : s;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** 'YYYY-MM-DD' (anything after the date, such as a time, is ignored) → parts, or null if not a real date. */
function parseParts(d: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof d === 'string' ? d : '');
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  if (m < 1 || m > 12 || day < 1 || day > daysInMonth(y, m)) return null;
  return { y, m, d: day };
}

function formatParts(p: YMD): ISODate {
  return `${pad(p.y, 4)}-${pad(p.m, 2)}-${pad(p.d, 2)}`;
}

// Day-number conversions (proleptic Gregorian, day 0 = 1970-01-01), after Howard Hinnant.
function daysFromCivil({ y, m, d }: YMD): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): YMD {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d };
}

/** True for a real calendar date in 'YYYY-MM-DD' form. */
export function isValidISODate(d: string): boolean {
  return typeof d === 'string' && d.length === 10 && parseParts(d) !== null;
}

/** Local date. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** Local midnight; an Invalid Date if `d` is not a date. */
export function parseISODate(d: ISODate): Date {
  const p = parseParts(d);
  if (!p) return new Date(NaN);
  const date = new Date(2000, 0, 1);
  date.setFullYear(p.y, p.m - 1, p.d);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Local calendar date of `d`; '' for an Invalid Date. */
export function toISODate(d: Date): ISODate {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return formatParts({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}

/** Invalid input is returned unchanged. */
export function addDays(d: ISODate, n: number): ISODate {
  const p = parseParts(d);
  if (!p || !Number.isFinite(n)) return d;
  return formatParts(civilFromDays(daysFromCivil(p) + Math.trunc(n)));
}

/** Clamps the day: 31 Jan + 1 month → 28 Feb (29 in leap years). Invalid input is returned unchanged. */
export function addMonths(d: ISODate, n: number): ISODate {
  const p = parseParts(d);
  if (!p || !Number.isFinite(n)) return d;
  const index = p.y * 12 + (p.m - 1) + Math.trunc(n);
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return formatParts({ y, m, d: Math.min(p.d, daysInMonth(y, m)) });
}

/** 'Oct 3' / 'Oct 3, 2026'. The short style shows the year only when it isn't the current year
 *  (`now` defaults to the current time). Invalid input is returned unchanged. */
export function formatDate(d: ISODate, style: 'short' | 'long' = 'short', now: Date = new Date()): string {
  const p = parseParts(d);
  if (!p) return d;
  const base = `${MONTHS_SHORT[p.m - 1]} ${p.d}`;
  return style === 'long' || p.y !== now.getFullYear() ? `${base}, ${p.y}` : base;
}

/** '2026-10'. */
export function monthKey(d: ISODate): string {
  return typeof d === 'string' ? d.slice(0, 7) : '';
}

/** '2026-10' → 'October 2026'; anything else is returned unchanged. */
export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  const m = match ? Number(match[2]) : 0;
  if (!match || m < 1 || m > 12) return key;
  return `${MONTHS_LONG[m - 1]} ${match[1]}`;
}

/** 'just now', '5 min ago', '3 hours ago' (same day), 'yesterday', then 'Oct 3' / 'Oct 3, 2025'. */
export function relativeTime(iso: ISODateTime, now: Date = new Date()): string {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return '';
  const diffMs = now.getTime() - t.getTime();
  const day = toISODate(t);
  if (diffMs < 60 * 1000) {
    if (diffMs > -60 * 1000) return 'just now';
    return formatDate(day, 'short', now);
  }
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const today = toISODate(now);
  if (day === today) {
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (day === addDays(today, -1)) return 'yesterday';
  return formatDate(day, 'short', now);
}

/** Sort comparator: newest date first. */
export function compareDesc(a: ISODate, b: ISODate): number {
  return a > b ? -1 : a < b ? 1 : 0;
}
