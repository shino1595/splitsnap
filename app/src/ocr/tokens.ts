// Line clean-up and number tokenising for receipt rows (pure).

export interface NumberToken {
  /** Signed value ('-150.00' → -150; accounting parentheses are only flagged, see `paren`). */
  value: number;
  /** Token text as it appears in the normalised line, e.g. '360.00', 'x6', '@80', '2.5%'. */
  raw: string;
  index: number;
  /** Digits after the decimal point. */
  decimals: number;
  /** Digits before the decimal point. */
  intDigits: number;
  percent: boolean;
  /** Quantity marker: 'x6', '6x', '6 x Naan', 'Naan x 6'. */
  qtyMark: boolean;
  /** Rate marker: '@80', '@ 80'. */
  rateMark: boolean;
  /** '(150.00)' */
  paren: boolean;
  /** List numbering such as '1.' or '1)'. */
  listMark: boolean;
}

export interface Token {
  text: string;
  index: number;
  kind: 'word' | 'number' | 'marker';
  num?: NumberToken;
  marker?: 'qty' | 'rate' | 'percent' | 'minus' | 'other';
}

const FULLWIDTH_START = 0xff01;
const FULLWIDTH_END = 0xff5e;

/** Fullwidth currency signs (U+FFE0–FFE6) → their normal forms. */
const FULLWIDTH_SIGNS: Record<number, string> = { 0xffe0: '¢', 0xffe1: '£', 0xffe5: '¥', 0xffe6: '₩' };

/** Fullwidth letters/digits/punctuation → ASCII, odd spaces and tabs → ' '. */
export function toAsciiForms(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= FULLWIDTH_START && code <= FULLWIDTH_END) out += String.fromCharCode(code - 0xfee0);
    else if (FULLWIDTH_SIGNS[code]) out += FULLWIDTH_SIGNS[code];
    else if (code === 0x3000 || code === 0x00a0 || code === 0x2007 || code === 0x202f || code === 0x09) out += ' ';
    else out += s[i];
  }
  return out;
}

/** Leading currency markers glued to (or one space before) an amount. */
const CURRENCY_PREFIX =
  /(^|[\s(:=\/-])(?:₹|rs\.?|re\.?|inr|us\$|s\$|sgd|hk\$|a\$|c\$|nz\$|usd|eur|gbp|jpy|aed|dhs?\.?|sar|qar|rm|chf|thb|\$|€|£|¥|฿)\s?(?=[-(]?\d)/gi;
const CURRENCY_SYMBOL = /[₹€£¥฿$]\s?(?=[-(]?\d)/g;
const CURRENCY_SUFFIX = /(\d)\s?(?:₹|€|£|\/-|inr|usd|eur|gbp|aed|sgd|rs\.?)(?=\s|$|\))/gi;

function countChar(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

/** '1,390' / '1,23,456': first group 1–3 digits, middle groups 2–3, last group exactly 3. */
function validGroups(groups: string[]): boolean {
  if (groups.length < 2 || !/^\d{1,3}$/.test(groups[0])) return false;
  for (let i = 1; i < groups.length; i++) {
    const last = i === groups.length - 1;
    if (last ? !/^\d{3}$/.test(groups[i]) : !/^\d{2,3}$/.test(groups[i])) return false;
  }
  return true;
}

/** '1,390.00' → '1390.00', '1.234,56' → '1234.56', '34,75' → '34.75'. Ambiguous runs (dates) are left alone. */
function canonicalNumber(run: string): string {
  const dots = countChar(run, '.');
  const commas = countChar(run, ',');
  if (!dots && !commas) return run;
  if (dots && commas) {
    const decimal = run.lastIndexOf('.') > run.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    if (countChar(run, decimal) > 1) return run;
    const at = run.lastIndexOf(decimal);
    const groups = run.slice(0, at).split(group);
    if (!validGroups(groups)) return run;
    return `${groups.join('')}.${run.slice(at + 1)}`;
  }
  if (commas) {
    const parts = run.split(',');
    if (commas === 1 && parts[1].length <= 2) return `${parts[0]}.${parts[1]}`;
    return validGroups(parts) ? parts.join('') : run;
  }
  if (dots === 1) return run;
  const parts = run.split('.');
  if (parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3)) return parts.join('');
  // '1.390.00': the thousands comma was read as a dot.
  const last = parts[parts.length - 1];
  if (last.length === 2 && validGroups(parts.slice(0, -1).concat('000'))) return `${parts.slice(0, -1).join('')}.${last}`;
  return run;
}

/** 'O'/'o' → 0 and 'l'/'I' → 1 inside number-looking tokens ('6O.00', 'l20.00', '1OO'). */
function fixDigitConfusions(token: string): string {
  const m = /^([-(]?)([0-9OolI]+(?:[.,][0-9OolI]{1,2})?)([%)]?)$/.exec(token);
  if (!m) return token;
  const body = m[2];
  if (!/\d/.test(body) || !/[OolI]/.test(body)) return token;
  const hasDecimal = /[.,]/.test(body);
  if (!hasDecimal && (body.length < 2 || /[lI]$/.test(body))) return token;
  return m[1] + body.replace(/[Oo]/g, '0').replace(/[lI]/g, '1') + m[3];
}

/** Fix OCR noise around numbers so they can be read reliably: unicode forms, stray bullets,
 *  dotted/dashed rules, currency markers ('₹ 1,390.00' → '1390.00'), decimal commas, US credit
 *  amounts ('1.00-T' → '-1.00 T'), glued flags ('5.49N'), 'O'/'l' read for 0/1 inside digits. */
export function normalizeLine(line: string): string {
  if (typeof line !== 'string') return '';
  let s = toAsciiForms(line);
  s = s.replace(/[−‐-―]/g, '-');
  s = s.replace(/[·•●◦∙・|¦‖"`]/g, ' ');
  s = s.replace(/([-=*_~.:+])\1{2,}/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  s = s.replace(CURRENCY_PREFIX, '$1');
  s = s.replace(CURRENCY_SYMBOL, '');
  s = s.replace(CURRENCY_SUFFIX, '$1');
  // The rupee sign is often read as '<', '?', '%', '~' or 'Z' glued to the amount ('<90.00').
  s = s.replace(/(^|[\s(-])[<>?~%zZ]+(?=\d[\d,]*\.\d{2}(?![\d.]))/g, '$1');

  s = s.replace(/(\d)\. (\d{2})(?![\d.])/g, '$1.$2').replace(/(\d) \.(\d{2})(?![\d.])/g, '$1.$2');
  // '1, 390.00': a space read after the thousands comma.
  s = s.replace(/(^|\s)(\d{1,3}), (\d{3}\.\d{2})(?=\s|$)/g, '$1$2,$3');
  // 'CGST2.5%' → 'CGST 2.5%'.
  s = s.replace(/([A-Za-z])(\d+(?:\.\d+)?%)/g, '$1 $2');
  s = s
    .split(' ')
    .map(fixDigitConfusions)
    .join(' ');
  s = s.replace(/\d[\d.,]*\d/g, canonicalNumber);

  // Trailing minus (credits) — the tax flag after it is often misread as '1'.
  s = s.replace(/(^|\s)(\d+\.\d{2})-(?:([A-Za-z]{1,2})|[1|])?(?=\s|$)/g, (_m, pre: string, num: string, flag?: string) =>
    `${pre}-${num}${flag ? ` ${flag}` : ''}`,
  );
  s = s.replace(/(\d\.\d{2})([A-Z]{1,2})(?=\s|$)/g, '$1 $2');
  s = s.replace(/([A-Za-z)])([:=])(?=[-(]?\d)/g, '$1$2 ');
  s = s.replace(/([A-Za-z\d)])@/g, '$1 @');
  s = s.replace(/@\s+(?=[-(]?\d)/g, '@');
  s = s.replace(/(\d)\s+%/g, '$1%');
  return s.replace(/\s+/g, ' ').trim();
}

const NUMBER_TOKEN = /^([(\[]?)([-+]?)([x×@]?)(\d+(?:\.\d+)?)([x×%]?)([)\]]?)([.,:;]?)$/i;

function parseNumberToken(text: string, index: number): NumberToken | null {
  const m = NUMBER_TOKEN.exec(text);
  if (!m) return null;
  const [, open, sign, prefix, digits, suffix, close, trail] = m;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const dot = digits.indexOf('.');
  const pre = prefix.toLowerCase();
  const post = suffix.toLowerCase();
  return {
    value: sign === '-' ? -value : value,
    raw: text,
    index,
    decimals: dot < 0 ? 0 : digits.length - dot - 1,
    intDigits: dot < 0 ? digits.length : dot,
    percent: post === '%',
    qtyMark: pre === 'x' || pre === '×' || post === 'x' || post === '×',
    rateMark: pre === '@',
    paren: !!open && !!close,
    listMark: (!open && !!close) || (trail === '.' && dot < 0),
  };
}

function markerOf(text: string): Token['marker'] | null {
  if (/^[x×*]$/i.test(text)) return 'qty';
  if (text === '@') return 'rate';
  if (text === '%') return 'percent';
  if (text === '-' || text === '(-)' || text === '(-' || text === '-)') return 'minus';
  if (/^[-:=#/.,;()\[\]]+$/.test(text)) return 'other';
  return null;
}

/** Splits a normalised line into words, numbers and markers, applying markers to their numbers. */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const text = m[0];
    const num = parseNumberToken(text, m.index);
    if (num) {
      tokens.push({ text, index: m.index, kind: 'number', num });
      continue;
    }
    const marker = markerOf(text);
    if (marker) tokens.push({ text, index: m.index, kind: 'marker', marker });
    else tokens.push({ text, index: m.index, kind: 'word' });
  }

  tokens.forEach((t, i) => {
    if (t.kind !== 'marker') return;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (t.marker === 'percent' && prev?.num) prev.num.percent = true;
    else if (t.marker === 'rate' && next?.num) next.num.rateMark = true;
    else if (t.marker === 'minus' && next?.num && next.num.value > 0) next.num.value = -next.num.value;
    else if (t.marker === 'qty') {
      if (prev?.num && !prev.num.percent) prev.num.qtyMark = true;
      else if (next?.num) next.num.qtyMark = true;
    }
  });
  return tokens;
}

/** Numbers in a line (normalised first; `index` points into normalizeLine(line)). Dates, times,
 *  phone fragments and codes glued to letters ('8OZ', '29ABCDE1234F1Z5', '21:14') are skipped. */
export function extractNumbers(line: string): { value: number; raw: string; index: number }[] {
  return tokenize(normalizeLine(line))
    .filter((t) => t.kind === 'number' && t.num)
    .map((t) => ({ value: (t.num as NumberToken).value, raw: t.text, index: t.index }));
}

/** Can this number be a price or line total (not a percentage, pin code or phone fragment)? */
export function isMoneyToken(n: NumberToken | undefined): n is NumberToken {
  if (!n || n.percent || !Number.isFinite(n.value)) return false;
  if (n.decimals === 0 && n.intDigits >= 6) return false;
  return Math.abs(n.value) < 1e8;
}

/** Trailing receipt flags after an amount: US tax codes ('T', 'N', 'F'), '*', currency words. */
export function isTrailingFlag(text: string): boolean {
  if (/^(inr|usd|eur|gbp|aed|sgd|rs\.?|cr|dr|\/-)$/i.test(text)) return true;
  return /^([A-Z]{1,2}\*?|\*{1,3}|#)$/.test(text);
}
