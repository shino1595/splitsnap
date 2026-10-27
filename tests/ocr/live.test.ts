// Real OCR.space responses (engines 1, 2 and 3, isTable, overlay) for the synthetic bills in tools/ocr-live,
// pushed through the same code the app uses: rows from the word boxes (or ParsedText) → parser.
import { receiptFromOcr } from '../../app/src/ocr/bill';
import { parsedText, readOcrSpaceResponse, rowsFromParsedText, rowsFromResponse } from '../../app/src/ocr/ocrSpace';
import { parseReceipt } from '../../app/src/ocr/receiptParser';
import type { ParsedReceipt } from '../../app/src/ocr/types';
import { response as billA } from './fixtures/live_bill_a';
import { response as billB } from './fixtures/live_bill_b';
import { response as billC } from './fixtures/live_bill_c';
import { response as billD } from './fixtures/live_bill_d';
import { response as billAEngine1 } from './fixtures/live_bill_a_e1';
import { response as billDEngine1 } from './fixtures/live_bill_d_e1';
import { response as billBEngine3 } from './fixtures/live_bill_b_e3';
import { response as billDEngine3 } from './fixtures/live_bill_d_e3';

const summary = (r: ParsedReceipt) => ({
  items: r.items.map((i) => `${i.name} | ${i.quantity} | ${i.amount}`),
  charges: r.charges.map((c) => `${c.kind} | ${c.amount}`),
  subtotal: r.subtotal,
  total: r.total,
  computedTotal: r.computedTotal,
  currency: r.currency,
  warnings: r.warnings,
});

/** Both routes: rows rebuilt from TextOverlay boxes, and OCR.space's tab-separated ParsedText. */
function readings(response: unknown): { name: string; receipt: ParsedReceipt }[] {
  return [
    { name: 'overlay rows', receipt: parseReceipt(rowsFromResponse(response as never)) },
    { name: 'ParsedText rows', receipt: parseReceipt(rowsFromParsedText(parsedText(response as never))) },
  ];
}

describe('live OCR.space: bill A (Indian restaurant, sample items)', () => {
  const expected = {
    items: ['Naan | 6 | 36000', 'Butter Chicken | 1 | 42000', 'Chicken Lababdar | 1 | 45000', 'Gulab Jamun | 2 | 16000'],
    charges: ['tax | 3475', 'tax | 3475', 'roundoff | 50'],
    subtotal: 139000,
    total: 146000,
    computedTotal: 146000,
    currency: 'INR',
    warnings: [],
  };

  it('recovers items, charges and the grand total from both readings', () => {
    for (const { receipt } of readings(billA)) expect(summary(receipt)).toEqual(expected);
  });

  it('reads merchant and date, and ignores the noise lines', () => {
    const r = parseReceipt(rowsFromResponse(billA as never));
    expect(r.merchant).toBe('SPICE GARDEN');
    expect(r.date).toBe('2026-10-03');
    const sources = r.items.map((i) => i.sourceLine).join(' ');
    expect(sources).not.toMatch(/Total Qty|GSTIN|Thousand|Table/);
  });

  it('rebuilds the column rows from the word boxes', () => {
    const rows = rowsFromResponse(billA as never);
    expect(rows).toContain('Item  Qty  Rate  Amount');
    expect(rows).toContain('Naan  6  60.00  360.00');
    expect(rows).toContain('Bill No: 1047  Table: 12');
  });
});

describe('live OCR.space: bill B (wrapped names, discount, service charge)', () => {
  const expected = {
    items: [
      'Paneer Tikka | 1 | 28000',
      'Hyderabadi Chicken Dum Biryani (Full) | 1 | 52000',
      'Masala Papad | 2 | 12000',
      'Fresh Lime Soda | 3 | 27000',
      'Dal Makhani with Jeera Rice | 1 | 31000',
    ],
    charges: ['discount | -15000', 'service | 6750', 'tax | 3544', 'tax | 3544', 'roundoff | -38'],
    subtotal: 150000,
    total: 148800,
    computedTotal: 148800,
    currency: 'INR',
    warnings: [],
  };

  it('merges wrapped names and reads every charge from both readings', () => {
    for (const { receipt } of readings(billB)) expect(summary(receipt)).toEqual(expected);
  });

  it('reads merchant and the dd-mm-yy date', () => {
    const r = parseReceipt(rowsFromResponse(billB as never));
    expect(r.merchant).toBe('THE CURRY LEAF');
    expect(r.date).toBe('2026-10-05');
  });
});

describe('live OCR.space: bill C (US grocery receipt, tilted photo)', () => {
  const expected = {
    items: [
      'BANANAS | 1 | 129',
      'ORGANIC MILK 1GAL | 1 | 549',
      'GREEK YOGURT | 2 | 598',
      'SOURDOUGH BREAD | 1 | 425',
      'CHEDDAR CHEESE 80Z | 1 | 379',
      'PAPER TOWELS 6PK | 1 | 899',
      'DISH SOAP | 1 | 349',
    ],
    charges: ['discount | -100', 'tax | 95'],
    subtotal: 3228,
    total: 3323,
    computedTotal: 3323,
    currency: 'USD',
    warnings: [],
  };

  it('pairs names with prices even though the price column is higher on the photo', () => {
    for (const { receipt } of readings(billC)) expect(summary(receipt)).toEqual(expected);
  });

  it('reads the quantity line, the month-first date and the store name', () => {
    const r = parseReceipt(rowsFromResponse(billC as never));
    expect(r.items[2].unitPrice).toBe(299);
    expect(r.date).toBe('2026-10-05');
    expect(r.merchant).toBe('FRESH MART');
  });

  it('straightens the tilt so every price lands on its own name row', () => {
    const rows = rowsFromResponse(billC as never);
    expect(rows).toContain('BANANAS  1.29 N');
    expect(rows).toContain('DISH SOAP  3.49T');
    expect(rows).toContain('BALANCE DUE  $33.23');
  });
});

describe('live OCR.space: bill D (angled, blurred cafe photo; rupee sign misread)', () => {
  const expected = {
    items: [
      'Masala Chai (Regular) | 2 | 12000',
      'Bun Maska | 1 | 6000',
      'Samosa | 3 | 9000',
      'Paneer Kathi Roll | 1 | 18000',
      'Cold Coffee with Ice Cream | 1 | 15000',
    ],
    charges: ['discount | -5000', 'other | 2000', 'tax | 2850'],
    subtotal: 60000,
    total: 59850,
    computedTotal: 59850,
    currency: 'INR',
    warnings: [],
  };

  it("reads '¥120.00', '￥60.00' and '＜90.00' as rupee amounts in both readings", () => {
    for (const { receipt } of readings(billD)) expect(summary(receipt)).toEqual(expected);
  });

  it('reads the same bill when engine 1 was requested', () => {
    expect(summary(parseReceipt(rowsFromResponse(billDEngine1 as never)))).toEqual(expected);
  });

  it("reads merchant and the '14-Oct-2026' date", () => {
    const r = parseReceipt(rowsFromResponse(billD as never));
    expect(r.merchant).toBe('CHAI POINT EXPRESS');
    expect(r.date).toBe('2026-10-14');
  });
});

describe('live OCR.space: bill A read by engine 1', () => {
  it('rebuilds the rows from engine 1 word boxes even though its ParsedText is scrambled', () => {
    const rows = rowsFromResponse(billAEngine1 as never);
    expect(rows).toContain('Item  Qty  Rate  Amount');
    expect(rows).toContain('Naan  6  60.00  360.00');
    const r = parseReceipt(rows);
    expect(r.items.map((i) => i.amount)).toEqual([36000, 42000, 45000, 16000]);
    expect(r.total).toBe(146000);
    expect(r.warnings).toEqual([]);
  });

  it('receiptFromOcr picks the reading that adds up', () => {
    const { lines, rawText } = readOcrSpaceResponse(billAEngine1 as never);
    expect(parseReceipt(rowsFromParsedText(rawText)).warnings.length).toBeGreaterThan(0);
    const r = receiptFromOcr({ lines, rawText });
    expect(r.computedTotal).toBe(146000);
    expect(r.warnings).toEqual([]);
  });
});

describe('live OCR.space: engine 3 (one box per line, Markdown-table ParsedText)', () => {
  it('reads bill B from both readings', () => {
    for (const { receipt } of readings(billBEngine3)) {
      expect(receipt.items.map((i) => i.name)).toEqual([
        'Paneer Tikka',
        'Hyderabadi Chicken Dum Biryani (Full)',
        'Masala Papad',
        'Fresh Lime Soda',
        'Dal Makhani with Jeera Rice',
      ]);
      expect(receipt.total).toBe(148800);
      expect(receipt.computedTotal).toBe(148800);
      expect(receipt.warnings).toEqual([]);
    }
  });

  it('straightens the angled bill D without multi-word lines to measure the tilt from', () => {
    const rows = rowsFromResponse(billDEngine3 as never);
    expect(rows).toContain('Item Total  ₹600.00');
    expect(rows).toContain('IGST 5%  28.50');
    for (const { receipt } of readings(billDEngine3)) {
      expect(receipt.items.map((i) => i.amount)).toEqual([12000, 6000, 9000, 18000, 15000]);
      expect(receipt.charges.map((c) => c.amount)).toEqual([-5000, 2000, 2850]);
      expect(receipt.total).toBe(59850);
      expect(receipt.warnings).toEqual([]);
    }
  });

  it('turns the Markdown table into column rows', () => {
    const rows = rowsFromParsedText(parsedText(billBEngine3 as never));
    expect(rows).toContain('Description  Qty  Price  Total');
    expect(rows).toContain('Paneer Tikka  1  280.00  280.00');
    expect(rows.some((r) => /^[-|\s]+$/.test(r))).toBe(false);
  });
});

describe('live OCR.space: app pipeline', () => {
  it('readOcrSpaceResponse + receiptFromOcr give the same answer as the tests above', () => {
    for (const [response, total] of [
      [billA, 146000],
      [billB, 148800],
      [billC, 3323],
      [billD, 59850],
      [billAEngine1, 146000],
      [billDEngine1, 59850],
      [billBEngine3, 148800],
      [billDEngine3, 59850],
    ] as const) {
      const { lines, rawText } = readOcrSpaceResponse(response as never);
      expect(lines.length).toBeGreaterThan(10);
      expect(rawText.length).toBeGreaterThan(100);
      const receipt = receiptFromOcr({ lines, rawText });
      expect(receipt.total).toBe(total);
      expect(receipt.computedTotal).toBe(total);
      expect(receipt.warnings).toEqual([]);
    }
  });
});
