// Bill-level facts that do not depend on the item layout: currency and date (pure).
import type { CurrencyCode, ISODate } from '../types';
import { normalizeLine, toAsciiForms } from './tokens';

/** Explicit currency markers, most specific first ('S$' before '$'). */
const CURRENCY_MARKERS: { code: CurrencyCode; re: RegExp }[] = [
  { code: 'SGD', re: /S\$|\bSGD\b/g },
  { code: 'HKD', re: /HK\$|\bHKD\b/g },
  { code: 'NZD', re: /NZ\$|\bNZD\b/g },
  { code: 'AUD', re: /A\$|\bAUD\b/g },
  { code: 'CAD', re: /C\$|\bCAD\b/g },
  { code: 'USD', re: /US\$|\bUSD\b/g },
  { code: 'INR', re: /₹|\bINR\b|\bRs\.?(?=\s|\d|$)|\bRupees\b/gi },
  { code: 'EUR', re: /€|\bEUR\b/g },
  { code: 'GBP', re: /£|\bGBP\b/g },
  { code: 'AED', re: /\bAED\b|\bDhs?\.?(?=\s?\d)|\bDirhams?\b/gi },
  { code: 'JPY', re: /\bJPY\b|円/g },
  { code: 'THB', re: /฿|\bTHB\b|\bBaht\b/gi },
  { code: 'CHF', re: /\bCHF\b/g },
  { code: 'MYR', re: /\bRM\s?(?=\d)|\bMYR\b/g },
  { code: 'SAR', re: /\bSAR\b/g },
  { code: 'QAR', re: /\bQAR\b/g },
];

/** Indian tax registrations and GST lines mean rupees even when the ₹ sign was not read. */
const INDIAN_BILL = /\b(c|s|i|ut)gst\b|\bgstin\b|\bfssai\b|\bpaise\b/i;

/** Currency from symbols (₹/Rs/INR, $, €, £, S$, AED, …), else `hint`, else 'INR'. */
export function detectCurrency(lines: string[], hint?: CurrencyCode): CurrencyCode {
  let text = toAsciiForms(lines.join('\n'));
  const counts: Record<string, number> = {};
  for (const { code, re } of CURRENCY_MARKERS) {
    const found = text.match(re);
    if (found) {
      counts[code] = (counts[code] ?? 0) + found.length;
      text = text.replace(re, ' ');
    }
  }
  const dollars = (text.match(/\$/g) ?? []).length;
  if (dollars) counts.USD = (counts.USD ?? 0) + dollars;
  const yen = (text.match(/¥/g) ?? []).length;
  if (yen) {
    // Yen amounts have no decimals. '¥120.00' is OCR.space's usual misreading of '₹120.00'
    // (or a Chinese yuan bill, when that is the user's currency).
    const code = !/\d\.\d{2}(?!\d)/.test(text) ? 'JPY' : hint === 'CNY' ? 'CNY' : 'INR';
    counts[code] = (counts[code] ?? 0) + yen;
  }

  let best: CurrencyCode | null = null;
  for (const code of Object.keys(counts)) {
    if (counts[code] && (best === null || counts[code] > counts[best])) best = code;
  }
  if (best) return best;
  if (INDIAN_BILL.test(lines.join('\n'))) return 'INR';
  return hint && hint.trim() ? hint : 'INR';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAME = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

const DATE_PATTERNS: { re: RegExp; read: (m: RegExpExecArray, monthFirst: boolean) => ISODate | null }[] = [
  {
    re: /\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/,
    read: (m) => makeDate(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    re: /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})\b/,
    read: (m, monthFirst) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const y = fullYear(m[3]);
      if (a > 12) return makeDate(y, b, a);
      if (b > 12) return makeDate(y, a, b);
      return monthFirst ? makeDate(y, a, b) : makeDate(y, b, a);
    },
  },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-\\/.]*${MONTH_NAME}[\\s\\-\\/.,']*(\\d{4}|\\d{2})\\b`, 'i'),
    read: (m) => makeDate(fullYear(m[3]), monthIndex(m[2]), Number(m[1])),
  },
  {
    re: new RegExp(`\\b${MONTH_NAME}\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s*'?(\\d{4}|\\d{2})\\b`, 'i'),
    read: (m) => makeDate(fullYear(m[3]), monthIndex(m[1]), Number(m[2])),
  },
];

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function fullYear(text: string): number {
  const y = Number(text);
  return text.length <= 2 ? 2000 + y : y;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function makeDate(y: number, m: number, d: number): ISODate | null {
  if (!Number.isInteger(y) || y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > days) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** First date-like token (dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd, 'Oct 3, 2026', '3 Oct 2026').
 *  Ambiguous numeric dates are read day-first unless `monthFirst` (US bills). */
export function detectDate(lines: string[], monthFirst: boolean): ISODate | undefined {
  for (const line of lines) {
    const text = normalizeLine(line);
    let best: { index: number; date: ISODate } | null = null;
    for (const p of DATE_PATTERNS) {
      const m = p.re.exec(text);
      if (!m) continue;
      const date = p.read(m, monthFirst);
      if (date && (!best || m.index < best.index)) best = { index: m.index, date };
    }
    if (best) return best.date;
  }
  return undefined;
}

/** Currencies whose bills print dates month-first. */
export function isMonthFirstCurrency(code: CurrencyCode): boolean {
  return code === 'USD';
}
