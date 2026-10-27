// Types shared by the bill-scanning pipeline: OCR.space result → rows → parsed receipt.
import type { ChargeKind, CurrencyCode, ISODate, Minor, OcrEngine } from '../types';

/** One word box from OCR.space's TextOverlay (pixels of the uploaded image). */
export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One OCR.space TextOverlay line: a run of words the engine read together. */
export interface OcrLine {
  text: string;
  words: OcrWord[];
}

export interface OcrResult {
  /** Visual rows of the bill, top to bottom (see buildRows). */
  lines: string[];
  /** OCR.space ParsedText as returned (rows separated by newlines, columns by tabs). */
  rawText: string;
  engine: OcrEngine;
  /** Round-trip time of the OCR request. */
  ms: number;
}

export interface ParsedItem {
  name: string;
  quantity: number;
  unitPrice?: Minor;
  /** Line total. */
  amount: Minor;
  /** 0..1 — how sure the parser is about name/qty/amount (1 = qty × rate = amount on the bill). */
  confidence: number;
  sourceLine: string;
}

export interface ParsedCharge {
  kind: ChargeKind;
  label: string;
  /** Positive adds to the bill; discounts and round-off down are negative. */
  amount: Minor;
  sourceLine: string;
}

export interface ParsedReceipt {
  merchant?: string;
  date?: ISODate;
  currency?: CurrencyCode;
  items: ParsedItem[];
  charges: ParsedCharge[];
  /** Printed subtotal, if found. */
  subtotal?: Minor;
  /** Printed grand total, if found. */
  total?: Minor;
  /** Σ items + Σ charges. */
  computedTotal: Minor;
  /** e.g. 'Items add up to ₹1,390.00 but the bill subtotal says ₹1,400.00'. */
  warnings: string[];
}

export type OcrErrorCode = 'network' | 'quota' | 'too_large' | 'bad_key' | 'no_text' | 'timeout' | 'unknown';

/** Friendly, user-facing text for each error code (for Banners on the scan screen). */
export const OCR_ERROR_MESSAGES: Record<OcrErrorCode, string> = {
  network: "Couldn't reach the bill-reading service. Check your internet connection and try again.",
  quota:
    'The free bill-reading service is busy or its daily limit was reached. Try again in a while, or add your own free OCR.space key in Settings.',
  too_large: 'This photo is too large to read. Try again, or crop it closer to the bill.',
  bad_key: 'The OCR.space API key was not accepted. Check it in Settings, or clear it to use the shared demo key.',
  no_text: 'No text was found in the photo. Lay the bill flat in good light and keep it in focus.',
  timeout: 'Reading the bill took too long. Try again, ideally with a closer, sharper photo.',
  unknown: 'Something went wrong while reading the bill. Try again or enter the items by hand.',
};

export class OcrError extends Error {
  code: OcrErrorCode;

  constructor(code: OcrErrorCode, message?: string) {
    super(message || OCR_ERROR_MESSAGES[code]);
    this.name = 'OcrError';
    this.code = code;
    // Keeps `instanceof OcrError` working when Error subclasses are transpiled to ES5.
    Object.setPrototypeOf(this, OcrError.prototype);
  }
}

export function isOcrError(error: unknown): error is OcrError {
  if (error instanceof OcrError) return true;
  const e = error as { name?: unknown; code?: unknown } | null;
  return !!e && typeof e === 'object' && e.name === 'OcrError' && typeof e.code === 'string' && e.code in OCR_ERROR_MESSAGES;
}

/** User-facing message for any error thrown by the scan pipeline. */
export function ocrErrorMessage(error: unknown): string {
  return isOcrError(error) ? OCR_ERROR_MESSAGES[error.code] : OCR_ERROR_MESSAGES.unknown;
}
