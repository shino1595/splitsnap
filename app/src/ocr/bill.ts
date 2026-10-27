// Pure end of the scan pipeline: parsed receipt → itemized bill, and the offline sample bill.
import { newBillCharge, newBillItem } from '../lib/itemized';
import type { CurrencyCode, ID, ItemizedBill } from '../types';
import { rowsFromParsedText } from './ocrSpace';
import { parseReceipt, receiptScore } from './receiptParser';
import { SAMPLE_BILL_ROWS } from './sampleBill';
import type { OcrResult, ParsedReceipt } from './types';

/** Parses the rows rebuilt from the word boxes and, as a second opinion, OCR.space's own
 *  ParsedText rows; keeps the reading whose items and charges reconcile best with the bill. */
export function receiptFromOcr(ocr: Pick<OcrResult, 'lines' | 'rawText'>, currencyHint?: CurrencyCode): ParsedReceipt {
  const primary = parseReceipt(ocr.lines, { currencyHint });
  const alternative = rowsFromParsedText(ocr.rawText);
  if (!alternative.length || alternative.join('\n') === (ocr.lines ?? []).join('\n')) return primary;
  const second = parseReceipt(alternative, { currencyHint });
  return receiptScore(second) > receiptScore(primary) ? second : primary;
}

/** Sample bill without network (parseReceipt(SAMPLE_BILL_ROWS)). */
export function sampleReceipt(currencyHint: CurrencyCode): ParsedReceipt {
  return parseReceipt(SAMPLE_BILL_ROWS, { currencyHint });
}

/** Items/charges → ItemizedBill. Every item starts shared equally by all `participantIds`
 *  (the user then untaps people). printedTotal = receipt.total. scanned = true. */
export function receiptToBill(receipt: ParsedReceipt, participantIds: ID[]): ItemizedBill {
  const people = Array.from(new Set((participantIds ?? []).filter((id) => typeof id === 'string' && id)));
  const shares: Record<ID, number> = {};
  for (const id of people) shares[id] = 1;

  const items = (receipt?.items ?? [])
    .filter((item) => Number.isInteger(item.amount) && item.amount !== 0)
    .map((item) => {
      const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
      return newBillItem(item.name.trim() || 'Item', item.amount, quantity, shares);
    });
  const charges = (receipt?.charges ?? [])
    .filter((charge) => Number.isInteger(charge.amount) && charge.amount !== 0)
    .map((charge) => newBillCharge(charge.kind, charge.label.trim() || 'Charge', charge.amount));

  const bill: ItemizedBill = { items, charges, scanned: true };
  const merchant = receipt?.merchant?.trim();
  if (merchant) bill.merchant = merchant;
  if (receipt?.total !== undefined && Number.isInteger(receipt.total)) bill.printedTotal = receipt.total;
  return bill;
}
