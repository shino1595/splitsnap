import type { ParsedReceipt } from '../../app/src/ocr/types';
import {
  billDate,
  blankChargeRow,
  blankItemRow,
  blockedText,
  errorCodeOf,
  evaluateReview,
  foundText,
  mismatchText,
  ocrErrorCopy,
  persistableReceiptUri,
  retryHelps,
  reviewFromReceipt,
  stageText,
} from '../../app/src/screens/scan/scanReview';

function sampleReceipt(): ParsedReceipt {
  return {
    merchant: 'Punjab Grill',
    date: '2026-10-03',
    currency: 'INR',
    items: [
      { name: 'Naan', quantity: 6, unitPrice: 6000, amount: 36000, confidence: 0.95, sourceLine: 'Naan 6 60.00 360.00' },
      { name: 'Butter Chicken', quantity: 1, amount: 42000, confidence: 0.95, sourceLine: 'Butter Chicken 1 420.00 420.00' },
      { name: 'Chicken Lababdar', quantity: 1, amount: 45000, confidence: 0.9, sourceLine: 'Chicken Lababdar 1 450.00 450.00' },
      { name: 'Gulab Jamun', quantity: 2, amount: 16000, confidence: 0.5, sourceLine: 'Gulab Jamun 2 80.00 160.00' },
    ],
    charges: [
      { kind: 'tax', label: 'CGST 2.5%', amount: 3475, sourceLine: 'CGST 2.5% 34.75' },
      { kind: 'tax', label: 'SGST 2.5%', amount: 3475, sourceLine: 'SGST 2.5% 34.75' },
      { kind: 'roundoff', label: 'Round Off', amount: 50, sourceLine: 'Round Off 0.50' },
    ],
    subtotal: 139000,
    total: 146000,
    computedTotal: 146000,
    warnings: [],
  };
}

describe('scanReview: rows', () => {
  it('turns the receipt into editable text rows', () => {
    const review = reviewFromReceipt(sampleReceipt(), 'INR');
    expect(review.merchant).toBe('Punjab Grill');
    expect(review.items.map((r) => [r.name, r.qty, r.amount])).toEqual([
      ['Naan', '6', '360'],
      ['Butter Chicken', '1', '420'],
      ['Chicken Lababdar', '1', '450'],
      ['Gulab Jamun', '2', '160'],
    ]);
    expect(review.charges.map((r) => [r.kind, r.label, r.amount])).toEqual([
      ['tax', 'CGST 2.5%', '34.75'],
      ['tax', 'SGST 2.5%', '34.75'],
      ['roundoff', 'Round Off', '0.50'],
    ]);
    expect(new Set(review.items.map((r) => r.key)).size).toBe(4);
  });

  it('round-trips an unedited receipt', () => {
    const base = sampleReceipt();
    const result = evaluateReview(base, reviewFromReceipt(base, 'INR'), 'INR');
    expect(result.canContinue).toBe(true);
    expect(result.itemsSubtotal).toBe(139000);
    expect(result.chargesTotal).toBe(7000);
    expect(result.computedTotal).toBe(146000);
    expect(result.mismatch).toBe(0);
    expect(result.receipt.items.map((i) => [i.name, i.quantity, i.amount])).toEqual([
      ['Naan', 6, 36000],
      ['Butter Chicken', 1, 42000],
      ['Chicken Lababdar', 1, 45000],
      ['Gulab Jamun', 2, 16000],
    ]);
    expect(result.receipt.total).toBe(146000);
    expect(result.receipt.merchant).toBe('Punjab Grill');
  });

  it('applies edits, drops blank rows and keeps discounts negative', () => {
    const base = sampleReceipt();
    const review = reviewFromReceipt(base, 'INR');
    review.merchant = '  ';
    review.items[0] = { ...review.items[0], name: 'Butter Naan', amount: '390' };
    review.items.push(blankItemRow());
    review.items.push({ ...blankItemRow(), name: '', amount: '50' });
    review.charges.push({ ...blankChargeRow('discount'), label: '', amount: '100' });
    review.charges.push(blankChargeRow());
    const result = evaluateReview(base, review, 'INR');
    expect(result.canContinue).toBe(true);
    expect(result.receipt.merchant).toBeUndefined();
    expect(result.receipt.items).toHaveLength(5);
    expect(result.receipt.items[0].name).toBe('Butter Naan');
    expect(result.receipt.items[4].name).toBe('Item 5');
    expect(result.receipt.charges[3]).toEqual({ kind: 'discount', label: 'Discount', amount: -10000, sourceLine: '' });
    expect(result.itemsSubtotal).toBe(139000 + 3000 + 5000);
    expect(result.computedTotal).toBe(146000 + 8000 - 10000);
    expect(result.mismatch).toBe(2000);
  });

  it('reports invalid rows by key', () => {
    const base = sampleReceipt();
    const review = reviewFromReceipt(base, 'INR');
    review.items[1] = { ...review.items[1], amount: 'abc' };
    review.items[2] = { ...review.items[2], amount: '' };
    review.items[3] = { ...review.items[3], qty: '0' };
    review.charges[0] = { ...review.charges[0], amount: '0' };
    const result = evaluateReview(base, review, 'INR');
    expect(result.canContinue).toBe(false);
    expect(result.itemErrors).toEqual({
      [review.items[1].key]: 'Not a valid amount',
      [review.items[2].key]: 'Enter the price',
      [review.items[3].key]: 'Qty must be a whole number from 1 to 999',
    });
    expect(result.chargeErrors).toEqual({ [review.charges[0].key]: 'Enter an amount or remove this line' });
  });

  it('describes a printed-total mismatch', () => {
    expect(mismatchText(146000, 145950, 'INR')).toBe(
      'The bill says ₹1,460.00 but these lines add up to ₹1,459.50 (₹0.50 less). Fix any misread amounts, or add a missing charge.',
    );
  });
});

describe('scanReview: copy and draft values', () => {
  it('names the scanning stages', () => {
    expect(stageText('preparing')).toBe('Shrinking photo…');
    expect(stageText('uploading')).toBe('Reading the bill…');
    expect(stageText('parsing')).toBe('Finding items…');
  });

  it('has friendly copy for every OCR error code', () => {
    for (const code of ['network', 'quota', 'too_large', 'bad_key', 'no_text', 'timeout', 'unknown']) {
      const copy = ocrErrorCopy(code);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(20);
    }
    expect(ocrErrorCopy('bad_key').settingsAction).toBe(true);
    expect(ocrErrorCopy('weird')).toEqual(ocrErrorCopy('unknown'));
  });

  it('does not blame a key in Settings when the shared demo key was rejected', () => {
    const demo = ocrErrorCopy('bad_key', { demoKey: true });
    expect(demo.title).toBe('Demo key not accepted');
    expect(demo.message).not.toContain('API key in Settings');
    expect(demo.settingsAction).toBe(true);
    expect(ocrErrorCopy('bad_key', { demoKey: false }).title).toBe('API key not accepted');
    expect(ocrErrorCopy('quota', { demoKey: true })).toEqual(ocrErrorCopy('quota'));
  });

  it('only offers Retry first when retrying the same photo can help', () => {
    expect(retryHelps('network')).toBe(true);
    expect(retryHelps('timeout')).toBe(true);
    expect(retryHelps('quota')).toBe(true);
    expect(retryHelps('no_text')).toBe(false);
    expect(retryHelps('too_large')).toBe(false);
  });

  it('counts the lines that block Continue', () => {
    expect(blockedText({ itemErrors: { a: 'x' }, chargeErrors: {} })).toBe('Fix the highlighted line to continue');
    expect(blockedText({ itemErrors: { a: 'x', b: 'y' }, chargeErrors: { c: 'z' } })).toBe('Fix the 3 highlighted lines to continue');
  });

  it('reads error codes defensively', () => {
    expect(errorCodeOf({ code: 'quota' })).toBe('quota');
    expect(errorCodeOf({ code: 'nope' })).toBe('unknown');
    expect(errorCodeOf(new Error('x'))).toBe('unknown');
    expect(errorCodeOf(null)).toBe('unknown');
  });

  it('only keeps the bill date when it is real and not in the future', () => {
    expect(billDate('2026-10-03', '2026-10-15', '2026-10-15')).toBe('2026-10-03');
    expect(billDate('2026-10-20', '2026-10-15', '2026-10-15')).toBe('2026-10-15');
    expect(billDate('2026-02-30', '2026-10-15', '2026-10-15')).toBe('2026-10-15');
    expect(billDate('1999-12-31', '2026-10-15', '2026-10-15')).toBe('2026-10-15');
    expect(billDate(undefined, '2026-10-15', '2026-10-15')).toBe('2026-10-15');
  });

  it('skips huge inline photos', () => {
    expect(persistableReceiptUri('file:///cache/bill.jpg')).toBe('file:///cache/bill.jpg');
    expect(persistableReceiptUri('data:image/jpeg;base64,' + 'A'.repeat(100), 50)).toBeUndefined();
    expect(persistableReceiptUri('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(persistableReceiptUri(undefined)).toBeUndefined();
  });

  it('summarises what was found', () => {
    expect(foundText(4, 3)).toBe('Found 4 items and 3 charges');
    expect(foundText(1, 0)).toBe('Found 1 item');
    expect(foundText(0, 2)).toBe('No items found');
  });
});
