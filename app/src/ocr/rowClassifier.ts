// Splits each receipt row into label + numbers and decides what kind of row it is (pure).
import type { ChargeKind } from '../types';
import { isMoneyToken, isTrailingFlag, normalizeLine, tokenize, type NumberToken, type Token } from './tokens';

export type RowKind =
  | 'blank'
  | 'noise' // header/footer: GSTIN, bill no, table, date, phone, thank you, payment lines, 'Total Qty: 7'
  | 'header' // column header 'Item Qty Rate Amount'
  | 'subtotal'
  | 'total'
  | 'summary' // 'Total Tax 69.50' / 'Total Discount' — only used when no detailed lines exist
  | 'charge'
  | 'item' // label + trailing amount
  | 'text' // label without amount (merchant, wrapped item name, heading)
  | 'numbers' // amounts without a label (the numbers of a wrapped item)
  | 'qty'; // only a quantity ('2 x') — the next item's quantity, printed on its own row

export interface Row {
  index: number;
  source: string;
  text: string;
  /** Numbers before the first word ('6 x Naan', '2 Gulab Jamun'). */
  lead: NumberToken[];
  /** Numbers after the last word, trailing flags such as 'T'/'N' skipped. */
  tail: NumberToken[];
  /** Whole numbers written in the name column ('Chicken 65', or a quantity the OCR glued to the name). */
  glued: NumberToken[];
  label: string;
  /** Last non-percent number of the tail, when it can be money. */
  amount?: NumberToken;
  percent?: number;
  /** '--- Starters ---', '*** FOOD ***' */
  decorated: boolean;
  kind: RowKind;
  strongTotal?: boolean;
  chargeKind?: ChargeKind;
}

const LETTER = /[A-Za-zÀ-ɏऀ-ॿ]/g;

export function letterCount(s: string): number {
  return (s.match(LETTER) ?? []).length;
}

function isFlagToken(t: Token): boolean {
  return (t.kind === 'word' && isTrailingFlag(t.text)) || (t.kind === 'marker' && t.marker === 'other');
}

function isNumericPart(t: Token): boolean {
  return t.kind === 'number' || (t.kind === 'marker' && t.marker !== 'other');
}

/** 'Chicken 65', 'Service Charge 10%' — whole numbers or percentages written inside the name cell. */
function isGluedNumber(t: Token): boolean {
  const n = t.num;
  return t.kind === 'number' && !!n && !n.qtyMark && !n.rateMark && (n.percent || (n.decimals === 0 && n.value > 0));
}

/**
 * When the row has column breaks (tabs or 2+ spaces, see buildRows), the cells up to the last
 * one with a word form the name: numbers inside them belong to the name ('Chicken 65  250.00').
 * Returns how many tokens of the normalised row the name cells cover (0 = unknown).
 */
function nameCellEnd(source: string, text: string): number {
  if (typeof source !== 'string') return 0;
  const cells = source
    .split(/\t|\s{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (cells.length < 2) return 0;
  let last = -1;
  cells.forEach((cell, k) => {
    const words = tokenize(normalizeLine(cell)).filter((t) => t.kind === 'word' && !isTrailingFlag(t.text));
    if (words.some((t) => letterCount(t.text) > 0)) last = k;
  });
  if (last < 0 || last === cells.length - 1) return 0;
  const nameText = normalizeLine(cells.slice(0, last + 1).join(' '));
  if (!nameText || !(text === nameText || text.startsWith(`${nameText} `))) return 0;
  return tokenize(nameText).length;
}

function cleanLabel(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:.,;*#=~_\/+]+/, '')
    .replace(/[\s\-:.,;*#=~_\/+@]+$/, '')
    .trim();
}

export function analyzeRow(source: string, index: number): Row {
  const text = normalizeLine(source);
  const tokens = tokenize(text);

  let end = tokens.length;
  let j = tokens.length - 1;
  while (j >= 0 && isFlagToken(tokens[j])) j--;
  if (j >= 0 && j < tokens.length - 1 && tokens[j].kind === 'number') end = j + 1;

  let tailStart = end;
  while (tailStart > 0 && isNumericPart(tokens[tailStart - 1])) tailStart--;
  let leadEnd = 0;
  const hasWord = tokens.slice(0, end).some((t) => t.kind === 'word');
  if (hasWord) {
    while (leadEnd < tailStart && isNumericPart(tokens[leadEnd])) leadEnd++;
  } else {
    tailStart = 0;
  }

  const numbersIn = (from: number, to: number) =>
    tokens.slice(from, to).filter((t) => t.kind === 'number' && t.num).map((t) => t.num as NumberToken);
  let glued: NumberToken[] = [];
  if (hasWord) {
    const nameEnd = nameCellEnd(source, text);
    if (nameEnd > tailStart && nameEnd < end && tokens.slice(tailStart, nameEnd).every(isGluedNumber)) {
      glued = numbersIn(tailStart, nameEnd).filter((n) => !n.percent);
      tailStart = nameEnd;
    }
  }
  const lead = numbersIn(0, leadEnd);
  const tail = numbersIn(tailStart, end);
  const label = cleanLabel(
    tokens
      .slice(leadEnd, tailStart)
      .map((t) => t.text)
      .join(' '),
  );

  const lastPlain = tail.filter((n) => !n.percent).pop();
  const percentToken = tokens.find((t) => t.num?.percent)?.num;

  const row: Row = {
    index,
    source: typeof source === 'string' ? source.trim() : '',
    text,
    lead,
    tail,
    glued,
    label,
    amount: isMoneyToken(lastPlain) && !lastPlain.qtyMark ? lastPlain : undefined,
    percent: percentToken ? Math.abs(percentToken.value) : undefined,
    decorated: /^\s*[-=*~_#]{2,}|[-=*~_#]{2,}\s*$/.test(typeof source === 'string' ? source : ''),
    kind: 'blank',
  };
  classifyRow(row);
  return row;
}

// ---------------------------------------------------------------------------------------------
// Keyword tables (matched against lower-case text)

const NOISE_ANYWHERE: RegExp[] = [
  /\b(gstin|gst\s*(in|no|number|reg\w*)|fssai|lic(ence|ense)?\s*no|cin|pan\s*(no|number)|tin\s*(no|number)|vat\s*(no|reg\w*|number|id)|tax\s*(id|invoice|inv)|hsn(\s*code)?|sac(\s*code)?|reg(istration)?\s*no)\b/,
  /\b(kot|bot)\b/,
  /(www\.|https?:|\.com\b|\.co\.in\b|\.in\/|\.net\b|\.org\b|\.example\b|@[a-z0-9-]+\.[a-z])/,
  /\b(thank|thanks|thankyou|visit\s*again|welcome|have\s*a\s*(nice|great|good)|see\s*you|powered\s*by|customer\s*copy|merchant\s*copy|duplicate\s*(bill|copy)|reprint|e\s*\.?\s*&\s*o\s*\.?\s*e|goods\s*once\s*sold|subject\s*to|jurisdiction|you\s*saved|total\s*savings|follow\s*us|feedback|wi-?fi|password|terms\s*(and|&)\s*conditions|customer\s*care|toll\s*free)\b/,
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-](\d{4}|\d{2})\b/,
  /\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm|hrs)?\b/,
];

const NOISE_START: RegExp[] = [
  /^(bill|invoice|inv|receipt|rcpt|order|ord|txn|transaction|trans|chk|check|ticket|token|ref|serial|kot|bot|table|tbl|tab|cover|covers|pax|guests?|persons?|seat|room|counter|pos|till|terminal|store|shop|branch|outlet)\s*(no\.?|num(ber)?|#|id|code)?\s*[:#.\-]*\s*[#a-z\/\-]*\d/,
  /^(cashier|steward|stwd|server|waiter|captain|operator|clerk|attendant|host|served\s*by|staff|user|biller|bill\s*by|salesman|sales\s*person|associate|guest\s*name|customer|cust|name|address|addr)\b\s*(name|id|no\.?|number)?\s*[:#\-]/,
  /^(date|dt|dated|time|tm|bill\s*date|inv(oice)?\s*date|printed(\s*on)?)\b\s*([:.\-]|\d)/,
  /^(ph|phone|tel|telephone|mob|mobile|cell|contact|call|whatsapp|fax|email|e-mail|web|website)\b\s*([:.\-+#(]|\d|no)/,
  /^(cash|card|credit\s*card|debit\s*card|cc|visa|master\s*card|mastercard|amex|rupay|maestro|upi|bhim|paytm|g\s*pay|gpay|google\s*pay|phone\s*pe|phonepe|wallet|tender\w*|tend|change|paid|payment|pay\s*mode|mode\s*of\s*payment|settled|auth\w*|approval|appr|acct|account|a\/c|rrn|trace|batch|tid|mid|card\s*no)\b/,
];

const SUMMARY_LINE =
  /^#?\s*(total\s*)?(no\.?\s*of\s*)?(qty|qnty|quantity|items?(\(s\))?|item\s*count|pcs|pieces|units|articles|nos)\s*(sold|purchased|count)?\s*[:#=.\-]?\s*\d+(\.\d+)?$/;

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|crores?|million)\b/g;

const SUBTOTAL_RE =
  /\b(sub\s*-?\s*total|subtotal|sub\s*ttl|s\/\s*total|items?\s*total|food\s*total|basic\s*(amount|amt|total|value)|taxable\s*(amount|amt|value|total)|gross\s*(amount|amt|total|value)|total\s*before\s*tax(es)?|amount\s*before\s*tax(es)?|net\s*sales|merchandise\s*total)\b/;
const SUMMARY_TAX_RE = /\b(total\s*(tax|taxes|gst|vat)|(tax|gst|vat)\s*total)\b/;
const SUMMARY_DISCOUNT_RE = /\b(total\s*(discount|disc)|discount\s*total)\b/;
const NOT_A_TOTAL_RE = /\btotal\s*(qty|qnty|quantity|items?|pcs|pieces|weight|units|count|savings?)\b/;
const STRONG_TOTAL_RE =
  /\b(grand\s*-?\s*total|g\.?\s*total|net\s*(amount|amt|payable|total|bill|value|due)|(total\s*)?amount\s*payable|amt\s*payable|payable(\s*(amount|amt))?|total\s*payable|bill\s*(amount|amt|total|value)|total\s*(due|amount|amt|bill|value|inr|rs|usd)|balance\s*due|amount\s*due|amt\s*due|invoice\s*(total|amount|amt|value)|final\s*(amount|total|bill)|to\s*pay|you\s*pay|pay\s*this\s*amount|total\s*incl\w*)\b/;
const WEAK_TOTAL_RE = /\b(total|ttl|tot|totaal|totale|gesamt|summe)\b/;

/** Order matters: 'GST on Service Charge' is a tax, 'Discount on Service Charge' a discount. */
const CHARGE_RULES: { kind: ChargeKind; re: RegExp }[] = [
  { kind: 'roundoff', re: /\b(round\s*-?\s*off|rounding(\s*(off|adj\w*))?|round(ed)?\s*(adj\w*|amount|amt)|r\s*\/\s*off|rnd\s*off|roff)\b/ },
  { kind: 'discount', re: /\b(discount|disc|coupon|promo\w*|voucher|savings?|cashback|deduction|loyalty|redeem\w*|less\s*:|offer\s*discount|markdown)\b/ },
  { kind: 'tax', re: /\b(service\s*tax|(c|s|i|ut)\s*-?\s*gst|gst|vat|tax(es)?|cess|kkc|sbc|hst|pst|qst|mwst|iva|tva|excise)\b/ },
  { kind: 'service', re: /(\bservice\s*(charge|chg|chrg|fee)s?\b|\bsvc\s*(charge|chg)?\b|\bserv\s*(charge|chg)\b|\bs\s*\.\s*c\s*\.?(?=\s|$|@|\d)|^sc\b)/ },
  { kind: 'tip', re: /\b(tip|tips|gratuity|grat)\b/ },
  {
    kind: 'other',
    re: /\b(packing|packaging|pack\s*charges?|parcel(\s*charges?)?|container(\s*charges?)?|delivery(\s*(charges?|fee))?|del\s*charges?|convenience(\s*fee)?|platform\s*fee|handling(\s*(charges?|fee))?|surcharge|carry\s*bag|bag\s*(charge|fee)|corkage|cover\s*charge|bottle\s*deposit|crv|extra\s*charges?)\b/,
  },
];

const HEADER_WORDS = new Set([
  'item', 'items', 'description', 'desc', 'particulars', 'particular', 'product', 'products', 'qty', 'qnty',
  'quantity', 'rate', 'price', 'unit', 'amount', 'amt', 'total', 'value', 'mrp', 'sl', 's.no', 'sno', 'no',
  'sr', 'hsn', 'disc', 'uom', 'name', 'details', 'each', 'net', 'pcs', 'code',
]);

function isNoise(row: Row, lower: string): boolean {
  const head = lower.replace(/^[^a-z0-9#]+/, '');
  if (NOISE_ANYWHERE.some((re) => re.test(lower))) return true;
  if (NOISE_START.some((re) => re.test(head))) return true;
  if (SUMMARY_LINE.test(head)) return true;
  if ((lower.match(/#/g) ?? []).length >= 2) return true;
  if (isPhoneNumber(lower)) return true;
  const numberWords = (lower.match(NUMBER_WORDS) ?? []).length;
  if (numberWords >= 2 && /\b(only|rupees|dollars|paise|cents|euros?)\b/.test(lower)) return true;
  return NOT_A_TOTAL_RE.test(lower) && !row.amount;
}

function isPhoneNumber(lower: string): boolean {
  const runs = lower.match(/[+(]?\d[\d\s\-()]{7,}\d/g) ?? [];
  return runs.some((run) => /[+(\-]/.test(run) && run.replace(/\D/g, '').length >= 9);
}

function isColumnHeader(row: Row, lower: string): boolean {
  if (row.lead.length || row.tail.length) return false;
  const words = lower
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z.]/g, '').replace(/\.$/, ''))
    .filter(Boolean);
  if (words.length < 2) return false;
  const known = words.filter((w) => HEADER_WORDS.has(w)).length;
  if (known < 2 || known / words.length < 0.6) return false;
  return known >= 3 || !(SUBTOTAL_RE.test(lower) || STRONG_TOTAL_RE.test(lower));
}

const COLUMN_TITLES = new Set([
  'item', 'items', 'description', 'desc', 'particulars', 'product', 'qty', 'qnty', 'quantity', 'rate', 'price',
  'amount', 'amt', 'mrp', 'uom', 'hsn', 'unit',
]);

/** A column title the OCR put on a row of its own ('Amount' under 'Qty Item'). */
function isLoneColumnTitle(row: Row, lower: string): boolean {
  if (row.lead.length || row.tail.length) return false;
  const words = lower.split(/\s+/).map((w) => w.replace(/[^a-z]/g, '')).filter(Boolean);
  return words.length >= 1 && words.length <= 2 && words.every((w) => COLUMN_TITLES.has(w));
}

export function chargeKindOf(labelLower: string): ChargeKind | undefined {
  for (const rule of CHARGE_RULES) {
    if (rule.re.test(labelLower)) return rule.kind;
  }
  return undefined;
}

/** Undo OCR digit/letter swaps inside words before keyword matching: 'Tota1', 'T0TAL', 'Disc0unt', 'TOTAI'. */
export function keywordForm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[a-z]*[01|][a-z01|]*/g, (w) => ((w.match(/[a-z]/g) ?? []).length >= 3 && /^[a-z01|]+$/.test(w) ? w.replace(/0/g, 'o').replace(/[1|]/g, 'l') : w))
    .replace(/\btota[il]\b|\btota l\b/g, 'total');
}

function classifyRow(row: Row): void {
  const lower = keywordForm(row.text);
  const labelLower = keywordForm(row.label);
  if (!row.text || (!row.tail.length && !row.lead.length && letterCount(row.label) === 0)) {
    row.kind = 'blank';
  } else if (isNoise(row, lower)) {
    row.kind = 'noise';
  } else if (isColumnHeader(row, lower) || isLoneColumnTitle(row, lower)) {
    row.kind = 'header';
  } else if (SUBTOTAL_RE.test(labelLower)) {
    row.kind = 'subtotal';
  } else if (SUMMARY_TAX_RE.test(labelLower) || SUMMARY_DISCOUNT_RE.test(labelLower)) {
    row.kind = 'summary';
    row.chargeKind = SUMMARY_TAX_RE.test(labelLower) ? 'tax' : 'discount';
  } else if (STRONG_TOTAL_RE.test(labelLower) || WEAK_TOTAL_RE.test(labelLower)) {
    row.kind = 'total';
    row.strongTotal = STRONG_TOTAL_RE.test(labelLower);
  } else if ((row.chargeKind = chargeKindOf(labelLower))) {
    row.kind = 'charge';
  } else if (letterCount(row.label) >= 2) {
    row.kind = row.amount ? 'item' : 'text';
  } else {
    const onlyQty = !row.lead.length && row.tail.length === 1 && row.tail[0].qtyMark && row.tail[0].value > 0;
    row.kind = row.amount ? 'numbers' : onlyQty ? 'qty' : 'blank';
  }
  if (row.kind !== 'charge' && row.kind !== 'summary') row.chargeKind = undefined;
}

/** Keyword rows (subtotal / total / charge) that are still waiting for their amount. */
export function needsAmount(row: Row): boolean {
  if (row.amount) return false;
  return row.kind === 'subtotal' || row.kind === 'total' || row.kind === 'summary' || row.kind === 'charge';
}
