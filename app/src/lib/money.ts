// Money helpers. Every amount is an integer in the currency's minor unit (paise,
// cents); conversion to and from text happens only here. No Intl: grouping and
// symbols are done by hand so output is identical on iOS, Android and web.
import type { CurrencyAmounts, CurrencyCode, Minor } from '../types';

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimals: 2 },
  { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', decimals: 2 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', decimals: 2 },
  { code: 'AED', symbol: 'AED ', name: 'UAE Dirham', decimals: 2 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', decimals: 2 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', decimals: 2 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', decimals: 0 },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', decimals: 2 },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', decimals: 2 },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc', decimals: 2 },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', decimals: 2 },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', decimals: 2 },
  // Rupiah has 2 minor digits in ISO 4217 but sen are never used in practice.
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', decimals: 0 },
  { code: 'LKR', symbol: 'LKR ', name: 'Sri Lankan Rupee', decimals: 2 },
  { code: 'NPR', symbol: 'NPR ', name: 'Nepalese Rupee', decimals: 2 },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka', decimals: 2 },
  { code: 'SAR', symbol: 'SAR ', name: 'Saudi Riyal', decimals: 2 },
  { code: 'QAR', symbol: 'QAR ', name: 'Qatari Riyal', decimals: 2 },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese Yuan', decimals: 2 },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', decimals: 0 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', decimals: 0 },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', decimals: 2 },
  { code: 'ZAR', symbol: 'R ', name: 'South African Rand', decimals: 2 },
];

const BY_CODE: Record<string, CurrencyInfo> = {};
CURRENCIES.forEach((c) => {
  BY_CODE[c.code] = c;
});

/** Currencies whose amounts are grouped the Indian way (1,23,456). */
const INDIAN_GROUPING = new Set<string>(['INR']);

/** U+2212, used for negative amounts when opts.signed is set. */
const MINUS_SIGN = '−';

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  const key = (code || '').trim().toUpperCase();
  return BY_CODE[key] ?? { code, symbol: `${code} `, name: code, decimals: 2 };
}

export function currencyDecimals(code: CurrencyCode): number {
  return currencyInfo(code).decimals;
}

/**
 * Drops digits typed after the decimal point beyond what the currency has, so what is shown is
 * what gets saved ('12.345' → '12.34' for INR, '1500.5' → '1500' for JPY). Only a single '.'
 * followed by digits is treated as a decimal point; anything else is left for the parser.
 */
export function limitDecimals(text: string, decimals: number): string {
  const at = text.indexOf('.');
  if (at < 0 || text.indexOf('.', at + 1) >= 0) return text;
  const frac = text.slice(at + 1);
  if (!/^\d*$/.test(frac)) return text;
  if (decimals <= 0) return text.slice(0, at);
  return frac.length > decimals ? text.slice(0, at + 1 + decimals) : text;
}

function pow10(n: number): number {
  return Math.pow(10, n);
}

/** -0 → 0, so results compare cleanly with ===, toEqual and in JSON. */
function noNegZero(n: number): number {
  return n === 0 ? 0 : n;
}

function padStart(s: string, length: number, fill: string): string {
  let out = s;
  while (out.length < length) out = fill + out;
  return out;
}

export function toMinor(major: number, currency: CurrencyCode): Minor {
  if (!Number.isFinite(major)) return 0;
  const factor = pow10(currencyDecimals(currency));
  // toPrecision(15) removes binary noise first, so 1.005 → 100.5 → 101 (not 100).
  const scaled = Number((Math.abs(major) * factor).toPrecision(15));
  const rounded = Math.round(scaled);
  return noNegZero(major < 0 ? -rounded : rounded);
}

export function toMajor(minor: Minor, currency: CurrencyCode): number {
  return minor / pow10(currencyDecimals(currency));
}

// ---------------------------------------------------------------------------
// Parsing user input

/** Currency markers accepted around a typed amount (compared upper-case). */
const AMOUNT_MARKERS: string[] = (() => {
  const set = new Set<string>(['RS.', 'RS', 'RE.', 'RE', 'US$', '$', '¥', '/-']);
  CURRENCIES.forEach((c) => {
    set.add(c.code);
    set.add(c.symbol.trim().toUpperCase());
  });
  // Longest first, so 'RS.' wins over 'RS' and 'HK$' over '$'.
  return Array.from(set).sort((a, b) => b.length - a.length);
})();

function isSign(ch: string): boolean {
  return ch === '-' || ch === '+' || ch === MINUS_SIGN;
}

function stripLeadingMarker(s: string): string | null {
  const upper = s.toUpperCase();
  for (const m of AMOUNT_MARKERS) {
    if (upper.startsWith(m)) return s.slice(m.length);
  }
  return null;
}

function stripTrailingMarker(s: string): string | null {
  const upper = s.toUpperCase();
  for (const m of AMOUNT_MARKERS) {
    if (upper.endsWith(m)) return s.slice(0, s.length - m.length);
  }
  return null;
}

function countChar(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

/** Grouped integer part such as '1,23,456' or '1,390': groups after the first are 2–3 digits, the last is 3. */
function isValidGrouping(groups: string[]): boolean {
  if (groups.length === 1) return true;
  if (!/^\d{1,3}$/.test(groups[0])) return false;
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    const isLast = i === groups.length - 1;
    if (isLast ? !/^\d{3}$/.test(g) : !/^\d{2,3}$/.test(g)) return false;
  }
  return true;
}

/** Splits '1,234.56' / '1.234,56' / '12,5' into integer and fraction digits, or null if malformed. */
function splitNumber(n: string): { int: string; frac: string } | null {
  const dots = countChar(n, '.');
  const commas = countChar(n, ',');
  let decimalSep: '.' | ',' | null = null;
  let groupSep: '.' | ',' | null = null;

  if (dots > 0 && commas > 0) {
    if (n.lastIndexOf('.') > n.lastIndexOf(',')) {
      if (dots > 1) return null;
      decimalSep = '.';
      groupSep = ',';
    } else {
      if (commas > 1) return null;
      decimalSep = ',';
      groupSep = '.';
    }
  } else if (dots > 0) {
    if (dots > 1) return null;
    decimalSep = '.';
  } else if (commas > 0) {
    // One comma followed by 1–2 digits is a decimal comma ('12,5'); otherwise grouping ('1,390').
    const digitsAfter = n.length - n.lastIndexOf(',') - 1;
    if (commas === 1 && (digitsAfter === 1 || digitsAfter === 2)) decimalSep = ',';
    else groupSep = ',';
  }

  let intPart = n;
  let frac = '';
  if (decimalSep) {
    const at = n.lastIndexOf(decimalSep);
    intPart = n.slice(0, at);
    frac = n.slice(at + 1);
  }
  if (groupSep) {
    const groups = intPart.split(groupSep);
    if (!isValidGrouping(groups)) return null;
    intPart = groups.join('');
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  if (intPart === '' && frac === '') return null;
  return { int: intPart, frac };
}

export function parseAmountInput(
  text: string,
  currency: CurrencyCode,
  opts?: { allowNegative?: boolean },
): Minor | null {
  if (typeof text !== 'string') return null;
  let s = text.replace(/[\s  ]+/g, '');
  if (!s) return null;

  let negative = false;
  // Sign and currency marker may come in either order: '-₹50', '₹-50', 'Rs. 50', '50 INR', '50/-'.
  for (let pass = 0; pass < 2; pass++) {
    if (s && isSign(s[0])) {
      negative = negative || s[0] !== '+';
      s = s.slice(1);
    }
    const rest = stripLeadingMarker(s);
    if (rest !== null) s = rest;
  }
  for (let pass = 0; pass < 2; pass++) {
    const rest = stripTrailingMarker(s);
    if (rest !== null) s = rest;
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const parts = splitNumber(s);
  if (!parts) return null;

  const decimals = currencyDecimals(currency);
  const whole = parts.int.replace(/^0+(?=\d)/, '') || '0';
  if (whole.length > 13) return null; // beyond any sane bill; keeps us inside safe integers
  const fracDigits = parts.frac + '0'.repeat(decimals + 1);
  let minor = Number(whole) * pow10(decimals) + Number(fracDigits.slice(0, decimals) || '0');
  if (Number(fracDigits[decimals]) >= 5) minor += 1; // round half away from zero

  if (negative && minor !== 0) {
    if (!opts?.allowNegative) return null;
    return -minor;
  }
  return minor;
}

/** Amount → plain editable text without symbol/grouping, e.g. 139050 → '1390.50', 100000 → '1000'. */
export function minorToInputText(minor: Minor, currency: CurrencyCode): string {
  const decimals = currencyDecimals(currency);
  const factor = pow10(decimals);
  const value = Math.round(minor);
  const abs = Math.abs(value);
  const whole = Math.floor(abs / factor);
  const frac = abs - whole * factor;
  const sign = value < 0 ? '-' : '';
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${padStart(String(frac), decimals, '0')}`;
}

// ---------------------------------------------------------------------------
// Formatting

function groupDigits(digits: string, indian: boolean): string {
  if (digits.length <= 3) return digits;
  const size = indian ? 2 : 3;
  let rest = digits.slice(0, -3);
  const groups: string[] = [digits.slice(-3)];
  while (rest.length > size) {
    groups.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  if (rest) groups.unshift(rest);
  return groups.join(',');
}

/** Grouped absolute amount without symbol, e.g. 12345600 INR → '1,23,456.00'. */
function formatAbsolute(absMinor: number, info: CurrencyInfo, compact: boolean): string {
  const factor = pow10(info.decimals);
  const whole = Math.floor(absMinor / factor);
  const frac = absMinor - whole * factor;
  const grouped = groupDigits(String(whole), INDIAN_GROUPING.has(info.code));
  if (info.decimals === 0 || (compact && frac === 0)) return grouped;
  return `${grouped}.${padStart(String(frac), info.decimals, '0')}`;
}

/** 139050,'INR' → '₹1,390.50'; INR uses Indian grouping (₹1,23,456.00); others 3-digit groups.
 *  opts.signed adds '+'/'−'; opts.abs formats the absolute value; opts.compact drops '.00'. */
export function formatMoney(
  minor: Minor,
  currency: CurrencyCode,
  opts?: { signed?: boolean; abs?: boolean; compact?: boolean },
): string {
  const info = currencyInfo(currency);
  const rounded = Number.isFinite(minor) ? Math.round(minor) : 0;
  const value = opts?.abs ? Math.abs(rounded) : rounded;
  let sign = '';
  if (value < 0) sign = opts?.signed ? MINUS_SIGN : '-';
  else if (value > 0 && opts?.signed) sign = '+';
  return `${sign}${info.symbol}${formatAbsolute(Math.abs(value), info, !!opts?.compact)}`;
}

// ---------------------------------------------------------------------------
// Allocation

/**
 * Scales weights to integers (e.g. percents 33.34 → 3334) so remainders can be
 * compared exactly. Returns null when that is not possible within safe integers.
 */
function integerWeights(weights: number[], total: number): number[] | null {
  for (let k = 0; k <= 6; k++) {
    const f = pow10(k);
    const scaled = weights.map((w) => w * f);
    const exact = scaled.every((s) => Math.abs(s - Math.round(s)) <= 1e-9 * Math.max(1, s));
    if (!exact) continue;
    const ints = scaled.map((s) => Math.round(s));
    const sum = ints.reduce((a, b) => a + b, 0);
    return sum * total <= Number.MAX_SAFE_INTEGER ? ints : null;
  }
  return null;
}

/** Indices with a positive weight, best remainder first, ties to the lower index. */
function rankByRemainder(weights: number[], remainders: number[], tolerance: number): number[] {
  const idx: number[] = [];
  weights.forEach((w, i) => {
    if (w > 0) idx.push(i);
  });
  return idx.sort((a, b) => {
    const d = remainders[b] - remainders[a];
    return Math.abs(d) > tolerance ? d : a - b;
  });
}

function allocateExact(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const result: number[] = [];
  const remainders: number[] = [];
  let assigned = 0;
  weights.forEach((w) => {
    const num = total * w;
    const r = num % sum;
    const share = (num - r) / sum;
    result.push(share);
    remainders.push(r);
    assigned += share;
  });
  const order = rankByRemainder(weights, remainders, 0);
  for (let k = 0, left = total - assigned; left > 0; k++, left--) result[order[k % order.length]] += 1;
  return result;
}

function allocateFloat(total: number, weights: number[], sum: number): number[] {
  const exact = weights.map((w) => (total * w) / sum);
  const result = exact.map((q) => Math.floor(q));
  const remainders = exact.map((q, i) => q - result[i]);
  const order = rankByRemainder(weights, remainders, 1e-9);
  let left = total - result.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k++, left--) result[order[k % order.length]] += 1;
  for (let k = order.length - 1; left < 0 && k >= 0; k--) {
    if (result[order[k]] > 0) {
      result[order[k]] -= 1;
      left++;
    }
  }
  return result;
}

/** Largest-remainder allocation of `total` by non-negative `weights`. Result sums to total exactly.
 *  Ties broken by lower index first. All-zero weights → throws. Works for negative totals (mirror). */
export function allocate(total: Minor, weights: number[]): Minor[] {
  if (!Number.isInteger(total)) {
    throw new RangeError(`allocate: total must be an integer number of minor units (got ${total})`);
  }
  let sum = 0;
  for (const w of weights) {
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      throw new RangeError('allocate: weights must be finite, non-negative numbers');
    }
    sum += w;
  }
  if (!(sum > 0)) throw new RangeError('allocate: at least one weight must be positive');
  if (total < 0) return allocate(-total, weights).map((v) => noNegZero(-v));
  if (total === 0) return weights.map(() => 0);

  const ints = integerWeights(weights, total);
  return ints ? allocateExact(total, ints) : allocateFloat(total, weights, sum);
}

export function splitEvenly(total: Minor, n: number): Minor[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`splitEvenly: n must be a positive integer (got ${n})`);
  const weights: number[] = [];
  for (let i = 0; i < n; i++) weights.push(1);
  return allocate(total, weights);
}

export function sumMinor(values: Minor[]): Minor {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

/** Display order for currencies: the CURRENCIES list order, then unknown codes alphabetically. */
export function compareCurrencyCodes(a: CurrencyCode, b: CurrencyCode): number {
  const ia = CURRENCIES.findIndex((c) => c.code === a);
  const ib = CURRENCIES.findIndex((c) => c.code === b);
  const ra = ia < 0 ? CURRENCIES.length : ia;
  const rb = ib < 0 ? CURRENCIES.length : ib;
  if (ra !== rb) return ra - rb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** '₹500.00 + $12.00', skips zeros, '' if none. */
export function formatCurrencyAmounts(amounts: CurrencyAmounts, opts?: { abs?: boolean }): string {
  return Object.keys(amounts)
    .filter((code) => amounts[code] !== 0 && Number.isFinite(amounts[code]))
    .sort(compareCurrencyCodes)
    .map((code) => formatMoney(amounts[code], code, { abs: opts?.abs }))
    .join(' + ');
}
