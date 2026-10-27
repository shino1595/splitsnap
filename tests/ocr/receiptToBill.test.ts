import { computeItemized, itemizedTotal, assignEqually } from '../../app/src/lib/itemized';
import { receiptFromOcr, receiptToBill, sampleReceipt } from '../../app/src/ocr/bill';
import type { ParsedReceipt } from '../../app/src/ocr/types';

const PEOPLE = ['me', 'p_a', 'p_b', 'p_c'];

describe('sampleReceipt', () => {
  it('parses the built-in sample bill offline', () => {
    const r = sampleReceipt('INR');
    expect(r.items.map((i) => i.amount)).toEqual([36000, 42000, 45000, 16000]);
    expect(r.total).toBe(146000);
    expect(r.warnings).toEqual([]);
  });

  it('keeps the rupee currency printed on the bill whatever the hint', () => {
    expect(sampleReceipt('USD').currency).toBe('INR');
  });
});

describe('receiptToBill', () => {
  it('shares every item equally among all participants and keeps charges proportional', () => {
    const bill = receiptToBill(sampleReceipt('INR'), PEOPLE);
    expect(bill.items.map((i) => [i.name, i.quantity, i.amount])).toEqual([
      ['Naan', 6, 36000],
      ['Butter Chicken', 1, 42000],
      ['Chicken Lababdar', 1, 45000],
      ['Gulab Jamun', 2, 16000],
    ]);
    for (const item of bill.items) expect(item.shares).toEqual({ me: 1, p_a: 1, p_b: 1, p_c: 1 });
    expect(bill.charges.map((c) => [c.kind, c.label, c.amount, c.allocation])).toEqual([
      ['tax', 'CGST 2.5%', 3475, 'proportional'],
      ['tax', 'SGST 2.5%', 3475, 'proportional'],
      ['roundoff', 'Round Off', 50, 'proportional'],
    ]);
    expect(bill.printedTotal).toBe(146000);
    expect(bill.scanned).toBe(true);
    expect(bill.merchant).toBe('SPICE GARDEN');
    expect(itemizedTotal(bill)).toBe(146000);
  });

  it('gives items and charges unique ids and independent share objects', () => {
    const bill = receiptToBill(sampleReceipt('INR'), PEOPLE);
    const ids = [...bill.items.map((i) => i.id), ...bill.charges.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
    bill.items[0].shares.me = 5;
    expect(bill.items[1].shares.me).toBe(1);
  });

  it("splits the user's example exactly: every person's total adds up to the bill", () => {
    const bill = receiptToBill(sampleReceipt('INR'), PEOPLE);
    const [A, B, C, D] = PEOPLE;
    bill.items = [
      assignEqually(bill.items[0], [A, B, C, D]),
      assignEqually(bill.items[1], [A, C]),
      assignEqually(bill.items[2], [B, C, D]),
      assignEqually(bill.items[3], [B, D]),
    ];
    const result = computeItemized(bill);
    expect(result.errors).toEqual([]);
    const subtotal = (id: string) => result.perPerson.find((p) => p.personId === id)?.itemsSubtotal;
    expect([subtotal(A), subtotal(B), subtotal(C), subtotal(D)]).toEqual([30000, 32000, 45000, 32000]);
    expect(result.perPerson.reduce((s, p) => s + p.total, 0)).toBe(146000);
  });

  it('dedupes participants and handles an empty list', () => {
    const r = sampleReceipt('INR');
    expect(receiptToBill(r, ['me', 'me', 'p_a']).items[0].shares).toEqual({ me: 1, p_a: 1 });
    expect(receiptToBill(r, []).items[0].shares).toEqual({});
  });

  it('skips zero amounts, names blanks and leaves printedTotal out when the bill had none', () => {
    const receipt: ParsedReceipt = {
      items: [
        { name: '  ', quantity: 0, amount: 25000, confidence: 0.5, sourceLine: '' },
        { name: 'Free water', quantity: 1, amount: 0, confidence: 0.5, sourceLine: '' },
      ],
      charges: [
        { kind: 'discount', label: 'Discount', amount: -2500, sourceLine: '' },
        { kind: 'tip', label: '', amount: 0, sourceLine: '' },
      ],
      computedTotal: 22500,
      warnings: [],
    };
    const bill = receiptToBill(receipt, ['me']);
    expect(bill.items.map((i) => [i.name, i.quantity, i.amount])).toEqual([['Item', 1, 25000]]);
    expect(bill.charges.map((c) => c.amount)).toEqual([-2500]);
    expect(bill.printedTotal).toBeUndefined();
    expect(bill.merchant).toBeUndefined();
    expect(itemizedTotal(bill)).toBe(22500);
  });
});

describe('receiptFromOcr', () => {
  it("prefers OCR.space's own text when the rebuilt rows do not add up", () => {
    const r = receiptFromOcr({
      lines: ['Tea  20.00', 'Coffee', 'Total  50.00', '30.00'],
      rawText: 'Tea\t20.00\nCoffee\t30.00\nTotal\t50.00\n',
    });
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([
      ['Tea', 2000],
      ['Coffee', 3000],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('keeps the rebuilt rows when they are as good', () => {
    const r = receiptFromOcr({ lines: ['Tea  20.00', 'Total  20.00'], rawText: '' }, 'USD');
    expect(r.currency).toBe('USD');
    expect(r.total).toBe(2000);
  });
});
