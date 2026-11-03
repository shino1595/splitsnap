// Pure logic for the Scan bill screen: editable review rows, error copy and draft values.
// No React here so it can be unit-tested.
import type { ChargeKind, CurrencyCode, ISODate, Minor } from '../../types';
import type { OcrKeySource } from '../../ocr/ocrKey';
import type { ParsedCharge, ParsedItem, ParsedReceipt } from '../../ocr/types';
import { isValidISODate } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { formatMoney, minorToInputText, parseAmountInput } from '../../lib/money';
import { chargeKindLabel, clampChargeLabel, clampText, ITEM_NAME_MAX, parseQuantity } from '../itemized/itemizedEditor';

// ---------- Scanning stages and errors ----------

export type ScanStage = 'preparing' | 'uploading' | 'parsing';

export function stageText(stage: ScanStage): string {
  switch (stage) {
    case 'preparing':
      return 'Shrinking photo…';
    case 'uploading':
      return 'Reading the bill…';
    default:
      return 'Finding items…';
  }
}

export type ScanErrorCode = 'network' | 'quota' | 'too_large' | 'bad_key' | 'no_text' | 'timeout' | 'unknown';

export interface ErrorCopy {
  title: string;
  message: string;
  /** The fix lives in Settings (API key). */
  settingsAction: boolean;
}

const ERROR_COPY: Record<ScanErrorCode, ErrorCopy> = {
  network: {
    title: 'No connection',
    message: "Couldn't reach the scanning service. Check your internet connection and try again.",
    settingsAction: false,
  },
  quota: {
    title: 'Scanning limit reached',
    message:
      'The free scanning service is busy or its limit was reached. Wait a minute and retry, or add your own free OCR.space key in Settings.',
    settingsAction: true,
  },
  too_large: {
    title: 'Photo too large',
    message: 'This photo is too big to scan, even after shrinking it. Crop it or take the photo a little closer.',
    settingsAction: false,
  },
  bad_key: {
    title: 'API key not accepted',
    message: 'OCR.space rejected the API key in Settings. Check it, or clear it to scan without your own key.',
    settingsAction: true,
  },
  no_text: {
    title: 'No text found',
    message: "We couldn't read any text in this photo. Lay the bill flat in good light and fill the frame with it.",
    settingsAction: false,
  },
  timeout: {
    title: 'Scanning timed out',
    message: 'The scan took too long. Try again — a sharper, closer photo usually helps.',
    settingsAction: false,
  },
  unknown: {
    title: "Couldn't scan this bill",
    message: 'Something went wrong while scanning. Try again, or enter the items yourself.',
    settingsAction: false,
  },
};

/** With no key in Settings the rejected key isn't the user's, so "check your key" would mislead. */
const OTHER_KEY_REJECTED: Record<Exclude<OcrKeySource, 'own'>, ErrorCopy> = {
  built_in: {
    title: 'Built-in key not accepted',
    message:
      "OCR.space didn't accept SplitSnap's built-in key just now. Add your own free key in Settings, or try again later.",
    settingsAction: true,
  },
  demo: {
    title: 'Demo key not accepted',
    message:
      "OCR.space didn't accept the shared demo key just now. Add your own free key in Settings, or try again in a few minutes.",
    settingsAction: true,
  },
};

/** The user's own key is already in Settings, so "add your own key" would send them in a circle. */
const OWN_KEY_QUOTA: ErrorCopy = {
  title: 'Scanning limit reached',
  message: 'OCR.space is busy or your free key reached its limit for now. Wait a while and retry, or enter the items yourself.',
  settingsAction: false,
};

/** Friendly title and message for an OcrError code (unknown codes get the generic copy).
 *  keySource says whose key the scan sent (ocrKeySource); omitted = the generic copy. */
export function ocrErrorCopy(code: string, opts?: { keySource?: OcrKeySource }): ErrorCopy {
  const source = opts?.keySource;
  if (code === 'bad_key' && (source === 'built_in' || source === 'demo')) return OTHER_KEY_REJECTED[source];
  if (code === 'quota' && source === 'own') return OWN_KEY_QUOTA;
  return ERROR_COPY[code as ScanErrorCode] ?? ERROR_COPY.unknown;
}

/** Retrying the same photo can't help when it has no readable text or is too big. */
export function retryHelps(code: string): boolean {
  return code !== 'no_text' && code !== 'too_large';
}

/** Reads `code` from an OcrError-like value; anything else is 'unknown'. */
export function errorCodeOf(error: unknown): ScanErrorCode {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code in ERROR_COPY ? (code as ScanErrorCode) : 'unknown';
}

// ---------- Values written to the draft ----------

/** Large inline photos (web data: URIs) would bloat saved state; keep only references that stay small. */
export function persistableReceiptUri(uri: string | undefined, maxDataUriLength: number = 600000): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith('data:') && uri.length > maxDataUriLength) return undefined;
  return uri;
}

/** The bill's printed date when it is a real date that is not in the future, else `fallback`. */
export function billDate(receiptDate: ISODate | undefined, fallback: ISODate, today: ISODate): ISODate {
  if (!receiptDate || !isValidISODate(receiptDate)) return fallback;
  if (receiptDate > today || receiptDate < '2000-01-01') return fallback;
  return receiptDate;
}

/** 'Found 4 items and 3 charges' / 'No items found'. */
export function foundText(itemCount: number, chargeCount: number): string {
  if (itemCount === 0) return 'No items found';
  const items = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  if (chargeCount === 0) return `Found ${items}`;
  return `Found ${items} and ${chargeCount} ${chargeCount === 1 ? 'charge' : 'charges'}`;
}

// ---------- Review rows ----------

export interface ReviewItemRow {
  key: string;
  name: string;
  qty: string;
  amount: string;
  confidence: number;
  sourceLine: string;
}

export interface ReviewChargeRow {
  key: string;
  kind: ChargeKind;
  label: string;
  amount: string;
  sourceLine: string;
}

export interface ReviewDraft {
  merchant: string;
  items: ReviewItemRow[];
  charges: ReviewChargeRow[];
}

/** Below this the parser was unsure (e.g. qty × rate ≠ amount); the row gets a "check this" hint. */
export const LOW_CONFIDENCE = 0.7;

export const CHARGE_KIND_CHOICES: { kind: ChargeKind; label: string }[] = (
  ['tax', 'service', 'tip', 'discount', 'roundoff', 'other'] as ChargeKind[]
).map((kind) => ({ kind, label: chargeKindLabel(kind) }));

/** Longest restaurant name the review field takes. */
export const MERCHANT_MAX = 60;

/**
 * The review rows for a scanned bill. Text longer than its field is cut to fit (clampText): on
 * iPhone an over-long name could not be edited at all. A cut name gets the "Please check" hint,
 * which shows the whole line as read.
 */
export function reviewFromReceipt(receipt: ParsedReceipt, currency: CurrencyCode): ReviewDraft {
  return {
    merchant: clampText(receipt.merchant ?? '', MERCHANT_MAX),
    items: receipt.items.map((item) => {
      const name = clampText(item.name, ITEM_NAME_MAX);
      return {
        key: newId('row'),
        name,
        qty: String(item.quantity > 0 ? item.quantity : 1),
        amount: minorToInputText(item.amount, currency),
        confidence: name === item.name ? item.confidence : Math.min(item.confidence, LOW_CONFIDENCE / 2),
        sourceLine: item.sourceLine,
      };
    }),
    charges: receipt.charges.map((charge) => ({
      key: newId('row'),
      kind: charge.kind,
      label: clampChargeLabel(charge.label),
      amount: minorToInputText(charge.amount, currency),
      sourceLine: charge.sourceLine,
    })),
  };
}

export function blankItemRow(): ReviewItemRow {
  return { key: newId('row'), name: '', qty: '1', amount: '', confidence: 1, sourceLine: '' };
}

export function blankChargeRow(kind: ChargeKind = 'tax'): ReviewChargeRow {
  return { key: newId('row'), kind, label: '', amount: '', sourceLine: '' };
}

export interface ReviewResult {
  /** The receipt with the user's edits (blank rows dropped); valid only when canContinue. */
  receipt: ParsedReceipt;
  itemErrors: Record<string, string>;
  chargeErrors: Record<string, string>;
  itemsSubtotal: Minor;
  chargesTotal: Minor;
  computedTotal: Minor;
  printedTotal: Minor | null;
  /** Printed total − computed total; 0 when there is no printed total. */
  mismatch: Minor;
  canContinue: boolean;
}

function isBlank(...values: string[]): boolean {
  return values.every((v) => !v.trim());
}

/** Validates the edited rows and rebuilds a ParsedReceipt from them. */
export function evaluateReview(base: ParsedReceipt, review: ReviewDraft, currency: CurrencyCode): ReviewResult {
  const itemErrors: Record<string, string> = {};
  const chargeErrors: Record<string, string> = {};
  const items: ParsedItem[] = [];
  const charges: ParsedCharge[] = [];

  review.items.forEach((row) => {
    if (isBlank(row.name, row.amount)) return;
    const quantity = parseQuantity(row.qty);
    const amount = row.amount.trim() ? parseAmountInput(row.amount, currency) : null;
    if (!row.amount.trim()) itemErrors[row.key] = 'Enter the price';
    else if (amount === null) itemErrors[row.key] = 'Not a valid amount';
    else if (amount <= 0) itemErrors[row.key] = 'The price must be more than zero';
    else if (quantity === null) itemErrors[row.key] = 'Qty must be a whole number from 1 to 999';
    if (amount === null || amount <= 0 || quantity === null) return;
    items.push({
      name: row.name.trim().replace(/\s+/g, ' ') || `Item ${items.length + 1}`,
      quantity,
      amount,
      confidence: row.confidence,
      sourceLine: row.sourceLine,
    });
  });

  review.charges.forEach((row) => {
    if (isBlank(row.label, row.amount)) return;
    const parsed = row.amount.trim() ? parseAmountInput(row.amount, currency, { allowNegative: true }) : null;
    if (!row.amount.trim()) chargeErrors[row.key] = 'Enter the amount';
    else if (parsed === null) chargeErrors[row.key] = 'Not a valid amount';
    else if (parsed === 0) chargeErrors[row.key] = 'Enter an amount or remove this line';
    if (parsed === null || parsed === 0) return;
    charges.push({
      kind: row.kind,
      label: row.label.trim().replace(/\s+/g, ' ') || chargeKindLabel(row.kind),
      amount: row.kind === 'discount' ? -Math.abs(parsed) : parsed,
      sourceLine: row.sourceLine,
    });
  });

  const itemsSubtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const chargesTotal = charges.reduce((sum, c) => sum + c.amount, 0);
  const computedTotal = itemsSubtotal + chargesTotal;
  const printedTotal = typeof base.total === 'number' && base.total > 0 ? base.total : null;
  const merchant = review.merchant.trim().replace(/\s+/g, ' ');

  const receipt: ParsedReceipt = { ...base, items, charges, computedTotal };
  if (merchant) receipt.merchant = merchant;
  else delete receipt.merchant;

  return {
    receipt,
    itemErrors,
    chargeErrors,
    itemsSubtotal,
    chargesTotal,
    computedTotal,
    printedTotal,
    mismatch: printedTotal === null ? 0 : printedTotal - computedTotal,
    canContinue: Object.keys(itemErrors).length === 0 && Object.keys(chargeErrors).length === 0,
  };
}

/** Footer note while Continue is blocked: 'Fix the highlighted line to continue'. */
export function blockedText(result: Pick<ReviewResult, 'itemErrors' | 'chargeErrors'>): string {
  const n = Object.keys(result.itemErrors).length + Object.keys(result.chargeErrors).length;
  return n > 1 ? `Fix the ${n} highlighted lines to continue` : 'Fix the highlighted line to continue';
}

/** 'The bill says ₹1,460.00 but the lines add up to ₹1,459.50 (₹0.50 less).' */
export function mismatchText(printed: Minor, computed: Minor, currency: CurrencyCode): string {
  const diff = computed - printed;
  return `The bill says ${formatMoney(printed, currency)} but these lines add up to ${formatMoney(computed, currency)} (${formatMoney(
    Math.abs(diff),
    currency,
  )} ${diff > 0 ? 'more' : 'less'}). Fix any misread amounts, or add a missing charge.`;
}
