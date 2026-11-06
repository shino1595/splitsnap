// Long bills photographed cut or folded into strips that lie side by side, with the misreads a
// real one showed: rate and amount glued together, the last decimal printed over the paper's edge,
// 9s read as 8s, and a curled strip whose rows tilt more towards the bottom. (Made-up bills; the
// layout and the misreads copy a real 54-item restaurant bill.)
import { buildRows } from '../../app/src/ocr/lineBuilder';
import { overlayLines } from '../../app/src/ocr/ocrSpace';
import { normalizeLine, parseReceipt, receiptScore } from '../../app/src/ocr/receiptParser';
import { analyzeRow } from '../../app/src/ocr/rowClassifier';
import type { OcrLine, ParsedReceipt } from '../../app/src/ocr/types';
import { response as groceryResponse } from './fixtures/live_bill_c';
import { columnLines, makeLine, singleBoxes, stripLines } from './fixtures/overlay';

type Cells = [string, number][][];

const TOP_HALF: Cells = [
  [['SAMPLE BISTRO', 150]],
  [['Bill No: 2231', 0], ['Table: 7', 330]],
  [['Particulars', 0], ['Qty', 300], ['Rate', 380], ['Amt', 470]],
  [['Paneer Tikka', 0], ['2.0', 300], ['280.00560.00', 370]],
  [['Masala Papad', 0], ['1.0', 300], ['99.00 89.00', 370]], // ₹10 off, or a rate misread: the amount stands
  [['Veg Hakka', 0], ['1.0', 300], ['249.00 249.00', 370]],
  [['Noodles', 0]],
  [['Dal Makhani', 0], ['3.0', 300], ['329.00 987.8', 370]],
  [['Garlic Naan', 0], ['4.0', 300], ['89.00 356.00', 370]],
  [['Fresh Lime', 0], ['2.0', 300], ['119.00 238.00', 370]],
  [['Soda', 0]],
];

const BOTTOM_HALF: Cells = [
  [['Jeera Rice', 0], ['1.0', 300], ['179.00 178.00', 370]], // the amount's 9 read as 8: the subtotal says so
  [['Gulab Jamun', 0], ['2.0', 300], ['148.00 298.00', 370]],
  [['Sub Total', 0], ['2956.00', 420]],
  [['CGST @2.5%', 0], ['73.90', 440]],
  [['SGST @2.5%', 0], ['73.90', 440]],
  [['Staff Welfare @5.0%', 0], ['147.80', 420]],
  [['Grand Total : 3252.00', 0]],
  [['Thank you', 100]],
];

const rowsOf = (cells: Cells) => cells.map((row) => row.map(([text]) => text).join('  '));

const summary = (r: ParsedReceipt) => ({
  items: r.items.map((i) => `${i.name} | ${i.quantity} | ${i.amount}`),
  charges: r.charges.map((c) => `${c.kind} | ${c.amount}`),
  subtotal: r.subtotal,
  total: r.total,
  computedTotal: r.computedTotal,
  warnings: r.warnings,
});

const EXPECTED = {
  items: [
    'Paneer Tikka | 2 | 56000',
    'Masala Papad | 1 | 8900',
    'Veg Hakka Noodles | 1 | 24900',
    'Dal Makhani | 3 | 98700',
    'Garlic Naan | 4 | 35600',
    'Fresh Lime Soda | 2 | 23800',
    'Jeera Rice | 1 | 17900',
    'Gulab Jamun | 2 | 29800',
  ],
  charges: ['tax | 7390', 'tax | 7390', 'service | 14780', 'roundoff | 40'],
  subtotal: 295600,
  total: 325200,
  computedTotal: 325200,
  warnings: ["The items didn't add up to the bill's subtotal as read, so Jeera Rice was changed to match. Check it against the bill."],
};

/** Both halves on one photo: each tilted its own way, the top half curling at its bottom end. */
function twoStrips(order: 'top-left' | 'top-right'): OcrLine[] {
  const [topLeft, bottomLeft] = order === 'top-left' ? [0, 640] : [640, 0];
  return [
    ...stripLines(TOP_HALF, { left: topLeft, top: 100, tilt: 0.01, curl: -0.05 }),
    ...stripLines(BOTTOM_HALF, { left: bottomLeft, top: 120, tilt: -0.02 }),
  ];
}

describe('long bills photographed as two strips side by side', () => {
  it('reads each strip on its own, the top half first', () => {
    expect(buildRows(twoStrips('top-left'))).toEqual([...rowsOf(TOP_HALF), ...rowsOf(BOTTOM_HALF)]);
  });

  it('still reads the top half first when it lies on the right', () => {
    expect(buildRows(twoStrips('top-right'))).toEqual([...rowsOf(TOP_HALF), ...rowsOf(BOTTOM_HALF)]);
  });

  it('finds every item, fixes the misreads and adds up to the printed total', () => {
    const receipt = parseReceipt(buildRows(twoStrips('top-left')));
    expect(summary(receipt)).toEqual(EXPECTED);
    expect(receipt.merchant).toBe('SAMPLE BISTRO');
  });

  it('keeps "Please check" only on the line the subtotal decided', () => {
    const receipt = parseReceipt(buildRows(twoStrips('top-left')));
    const unsure = receipt.items.filter((i) => i.confidence < 0.7).map((i) => i.name);
    // '1.0 179.00 178.00' keeps its printed amount until the subtotal shows ₹1 missing. The other
    // fixed lines ('99.00 89.00', '987.8', '148.00') are confirmed by the subtotal.
    expect(unsure).toEqual(['Jeera Rice']);
  });

  it('works with engine 3 boxes (one per line) too', () => {
    expect(summary(parseReceipt(buildRows(singleBoxes(twoStrips('top-left')))))).toEqual(EXPECTED);
  });

  it('reads a bill cut into three strips, without cutting a strip between its rate and amount columns', () => {
    const rows: Cells = [[['MADE UP KITCHEN', 120]], [['Particulars', 0], ['Qty', 300], ['Rate', 380], ['Amt', 470]]];
    let sub = 0;
    for (let k = 0; k < 45; k++) {
      const q = (k % 3) + 1;
      sub += q * (100 + k);
      rows.push([[`Dish ${k}`, 0], [`${q}.0`, 300], [`${100 + k}.00`, 370], [`${q * (100 + k)}.00`, 480]]);
    }
    rows.push([['Sub Total', 0], [`${sub}.00`, 470]], [['Grand Total', 0], [`${sub}.00`, 470]]);
    const thirds = [rows.slice(0, 17), rows.slice(17, 33), rows.slice(33)];
    const lines = thirds.flatMap((part, s) => stripLines(part, { left: s * 660, top: 100, tilt: s % 2 ? -0.02 : 0.01, curl: s % 2 ? 0 : -0.05 }));
    for (const input of [lines, singleBoxes(lines)]) {
      expect(buildRows(input)).toEqual(rowsOf(rows));
    }
  });
});

describe('strips: what is not cut, and paper beside the bill', () => {
  it('never cuts a tilted single receipt, even with the totals labelled in its right half', () => {
    const bill: Cells = [
      [['CHAI POINT', 200]],
      [['Masala Chai', 40], ['2', 330], ['40.00', 420], ['80.00', 560]],
      [['Bun Maska', 40], ['1', 330], ['60.00', 420], ['60.00', 560]],
      [['Samosa', 40], ['3', 330], ['30.00', 420], ['90.00', 560]],
      [['Sub Total', 380], ['230.00', 560]],
      [['GST 5%', 380], ['11.50', 560]],
      [['Total', 380], ['241.50', 560]],
    ];
    for (const tilt of [0.06, 0.03, -0.03, -0.06]) {
      expect(buildRows(columnLines(bill, { tilt }))).toEqual(rowsOf(bill));
    }
  });

  it('follows a strip that curls more and more towards its bottom end', () => {
    const items: Cells = Array.from({ length: 24 }, (_v, k) => [
      [`Dish number ${String.fromCharCode(65 + k)}`, 0],
      [`${(k % 3) + 1}`, 300],
      [`${100 + k}.00`, 360],
      [`${((k % 3) + 1) * (100 + k)}.00`, 470],
    ]);
    // From flat at the top to about −5° at the bottom: there the prices sit a whole row higher
    // than their names, so no single tilt fits the strip.
    const rows = buildRows(stripLines(items, { left: 40, curl: -0.09 }));
    expect(rows).toEqual(rowsOf(items));
  });

  it('moves text lying right of the prices (a cheque under the bill) after the bill', () => {
    const bill: Cells = [
      [['Item', 0], ['Qty', 290], ['Rate', 370], ['Amount', 460]],
      [['Paneer Tikka', 0], ['1', 300], ['280.00', 360], ['280.00', 470]],
      [['Dal Makhani', 0], ['2', 300], ['300.00', 360], ['600.00', 470]],
      [['Butter Naan', 0], ['4', 300], ['60.00', 360], ['240.00', 470]],
      [['Jeera Rice', 0], ['1', 300], ['180.00', 360], ['180.00', 470]],
      [['Total', 0], ['1300.00', 470]],
    ];
    const lines = [
      ...stripLines(bill, { left: 0 }),
      makeLine('Pay', 620, 136),
      makeLine('Bank of Nowhere', 640, 172),
      makeLine('fifty thousand', 630, 244),
    ];
    const rows = buildRows(lines);
    expect(rows.slice(0, bill.length)).toEqual(rowsOf(bill));
    expect(rows.slice(bill.length)).toEqual(['Pay', 'Bank of Nowhere', 'fifty thousand']);
    const receipt = parseReceipt(rows);
    expect(receipt.items.map((i) => i.amount)).toEqual([28000, 60000, 24000, 18000]);
    expect(receipt.warnings).toEqual([]);
  });

  it('keeps tax flags printed just right of the prices', () => {
    const bill: Cells = [
      [['BANANAS', 0], ['1.29', 420], ['N', 520]],
      [['DISH SOAP', 0], ['3.49', 420], ['T', 520]],
      [['ORGANIC MILK', 0], ['5.49', 420], ['N', 520]],
      [['BREAD', 0], ['4.25', 420], ['N', 520]],
      [['TOTAL', 0], ['14.52', 420]],
    ];
    expect(buildRows(stripLines(bill))).toEqual(rowsOf(bill));
  });

  it('joins engine 3 word boxes of one line even where the estimated boxes overlap', () => {
    const line = (text: string, left: number, width: number) => ({ text, words: [{ text, left, top: 200, width, height: 22 }] });
    const lines: OcrLine[] = [
      line('Beetroot, Orange', 651, 184),
      line('1.0', 793, 26),
      line('399.00', 829, 58),
      line('399.00', 892, 58),
      { text: 'And Goat', words: [{ text: 'And Goat', left: 651, top: 223, width: 86, height: 22 }] },
    ];
    expect(buildRows(lines)).toEqual(['Beetroot, Orange 1.0 399.00 399.00', 'And Goat']);
  });
});

describe('misread prices', () => {
  it('splits a rate and an amount printed without a space, and leaves grouped numbers alone', () => {
    expect(normalizeLine('Chicken  2.0  299.00598.00')).toBe('Chicken 2.0 299.00 598.00');
    expect(normalizeLine('Chicken  2.0  299,00598.00')).toBe('Chicken 2.0 299.00 598.00');
    expect(normalizeLine('Shrimp 3.0 649.001947.8')).toBe('Shrimp 3.0 649.00 1947.8');
    expect(normalizeLine('Lollipop 3.0 499.001497.g')).toBe('Lollipop 3.0 499.00 1497.9');
    expect(normalizeLine('Total 1,234.56')).toBe('Total 1234.56');
    expect(normalizeLine('Total 12,34,567.00')).toBe('Total 1234567.00');
    expect(normalizeLine('Paneer 250g')).toBe('Paneer 250g');
  });

  const item = (line: string) => {
    const r = parseReceipt(['Item  Qty  Rate  Amount', line]).items[0];
    return r && `${r.quantity} × ${(r.unitPrice ?? 0) / 100} = ${r.amount / 100}`;
  };

  it('fixes digits so that qty × rate = amount', () => {
    expect(item('Orange and  9.0  399.00 3581.8')).toBe('9 × 399 = 3591');
    expect(item('Butter Garlic  2.0  648.00 1288.8')).toBe('2 × 649 = 1298');
    expect(item('Quinoa Kale  1.0  548.00 549.00')).toBe('1 × 549 = 549');
    expect(item('Chocolate  2.0  328.00 658.00')).toBe('2 × 329 = 658');
  });

  it('keeps the printed amount when the rate may as well be the misread one', () => {
    // The amount is what the subtotal adds up; only the bill's sums may change it (see below).
    expect(item('Fresh lime soda  1.0  219.00 218.00')).toBe('1 × 218 = 218');
    expect(item('Peri Peri French  239.00 238.00')).toBe('1 × 238 = 238');
    expect(item('Cappuccino  1  199.00  189.00')).toBe('1 × 189 = 189');
  });

  it('reads the count as the quantity when the amount lost its last digit', () => {
    // 649 × 3 is within rounding of 1947.8, but '3.0' is the count and '649.00' the rate.
    expect(item('Shrimp Tempura  3.0  649.00 1947.8')).toBe('3 × 649 = 1947');
    expect(item('Murgh Biryani  2.0  599.00 1198.g')).toBe('2 × 599 = 1198');
  });

  it('keeps the printed amount when fixing the rate is just as likely', () => {
    expect(item('Soup  1  180.00  160.00')).toBe('1 × 160 = 160');
  });

  it('leaves rows that multiply out alone', () => {
    expect(item('Paper  100.00  0.50  50.00')).toBe('100 × 0.5 = 50');
    expect(item('Naan  6  60.00  360.00')).toBe('6 × 60 = 360');
    expect(item('Rice  1.250  80.00  100.00')).toBe('1.25 × 80 = 100');
  });
});

describe("the bill's sums choose between a line's readings", () => {
  const amounts = (r: ParsedReceipt) => r.items.map((i) => i.amount);
  const unsure = (r: ParsedReceipt) => r.items.filter((i) => i.confidence < 0.7).map((i) => i.name);

  it('keeps a real discount the total confirms', () => {
    // '199.00 189.00': ₹10 off (or a misread rate). The amount stands, and the total agrees.
    const r = parseReceipt(['BEAN CAFE', 'Item  Qty  Rate  Amount', 'Cappuccino  1  199.00  189.00', 'Croissant  2  120.00  240.00', 'Total  429.00']);
    expect(amounts(r)).toEqual([18900, 24000]);
    expect(unsure(r)).toEqual([]);
    expect(r.warnings).toEqual([]);
    // '5 × 160 = 800' only by reading 600 as a misread 800; the total says 600 as printed.
    const muffins = parseReceipt(['Item  Qty  Rate  Amount', 'Muffin  5  160.00  600.00', 'Tea  2  30.00  60.00', 'Total  660.00']);
    expect(amounts(muffins)).toEqual([60000, 6000]);
    expect(muffins.warnings).toEqual([]);
  });

  it('reads a misread amount when the subtotal shows it, and says so', () => {
    const r = parseReceipt(['Item  Qty  Rate  Amount', 'Cappuccino  1  199.00  189.00', 'Croissant  2  120.00  240.00', 'Sub Total  439.00', 'Total  439.00']);
    expect(amounts(r)).toEqual([19900, 24000]);
    expect(unsure(r)).toEqual(['Cappuccino']);
    expect(r.warnings).toEqual(["The items didn't add up to the bill's subtotal as read, so Cappuccino was changed to match. Check it against the bill."]);
  });

  it('keeps three printed amounts when only a rate was misread', () => {
    // Two lines with ₹10 off and a croissant whose rate 90 was read as 80: all as printed.
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      'Cappuccino  1  199.00  189.00',
      'Cold Coffee  1  299.00  289.00',
      'Butter Croissant  2  80.00  180.00',
      'Paneer Wrap  1  260.00  260.00',
      'Sub Total  918.00',
      'Total  918.00',
    ]);
    expect(amounts(r)).toEqual([18900, 28900, 18000, 26000]);
    expect(r.warnings).toEqual([]);
  });

  it('never changes a line that multiplies out as printed: a gap is a missing line, and is reported', () => {
    // '1.0 289.00 289.00' may be a misread 299, or a ₹10 line may be missing: say so, change nothing.
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      'Cold coffee  1.0  179.00  179.00',
      'Virgin Mojito  1.0  289.00  289.00',
      'Lemon Ice Tea  1.0  249.00  249.00',
      'Sub Total  727.00',
      'Grand Total  727.00',
    ]);
    expect(amounts(r)).toEqual([17900, 28900, 24900]);
    expect(r.warnings[0]).toMatch(/subtotal/);
  });

  it('leaves correct lines alone when a line is lost or a charge sits above the subtotal', () => {
    const items = [
      'Particulars  Qty  Rate  Amt',
      'Paneer Tikka  1.0  250.00  250.00',
      'Masala Lassi  1.0  180.00  180.00',
      'Dal Makhani  1.0  320.00  320.00',
      'Garlic Naan  4.0  60.00  240.00',
      'Jeera Rice  1.0  220.00  220.00',
      'Veg Biryani  1.0  360.00  360.00',
      'Fresh Lime Soda  2.0  100.00  200.00',
    ];
    const printed = [25000, 18000, 32000, 24000, 22000, 36000, 20000];
    // A ₹20 'Mineral Water' line was lost on the fold: both sums say so.
    const lost = parseReceipt([...items, 'Sub Total  1790.00', 'CGST @2.5%  44.75', 'SGST @2.5%  44.75', 'Grand Total  1879.50']);
    expect(amounts(lost)).toEqual(printed);
    expect(lost.warnings).toHaveLength(2);
    // A discount and a packing charge above the subtotal: everything adds up as printed.
    for (const [charge, sub, tax, total] of [['Discount  20.00', '1750.00', '43.75', '1837.50'], ['Packing Charges  20.00', '1790.00', '44.75', '1879.50']]) {
      const r = parseReceipt([...items, charge, `Sub Total  ${sub}`, `CGST @2.5%  ${tax}`, `SGST @2.5%  ${tax}`, `Grand Total  ${total}`]);
      expect(amounts(r)).toEqual(printed);
      expect(r.warnings).toEqual([]);
    }
  });

  it('changes nothing when the items already add up to the subtotal less a charge above it', () => {
    const r = parseReceipt([
      'Particulars  Qty  Rate  Amt',
      'Paneer Tikka  1.0  250.00  250.00',
      'Masala Lassi  1.0  189.00  180.00',
      'Dal Makhani  1.0  320.00  320.00',
      'Discount  10.00',
      'Sub Total  740.00',
      'Grand Total  740.00',
    ]);
    // Lassi reads as a misread (180 for 189) at first; the subtotal says the bill had 180.
    expect(amounts(r)).toEqual([25000, 18000, 32000]);
    expect(r.warnings).toEqual([]);
  });

  it('trusts the total over a misread subtotal', () => {
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      'Jeera Rice  1.0  179.00  179.00',
      'Dal Makhani  1.0  321.00  320.00',
      'Sub Total  489.00',
      'Grand Total  499.00',
    ]);
    // The items add up to the total as printed: the subtotal's 9 was read as 8. Nothing changes.
    expect(amounts(r)).toEqual([17900, 32000]);
    expect(r.warnings).toEqual(['Items add up to ₹499.00 but the bill subtotal says ₹489.00']);
  });

  it('changes nothing when two lines could close the gap equally well, and asks to check both', () => {
    const r = parseReceipt(['Item  Qty  Rate  Amount', 'Tea  1.0  29.00  28.00', 'Coffee  1.0  39.00  38.00', 'Sub Total  67.00']);
    expect(amounts(r)).toEqual([2800, 3800]);
    expect(unsure(r)).toEqual(['Tea', 'Coffee']);
    expect(r.warnings[0]).toMatch(/subtotal/);
  });
});

describe('ordinary bills the strip search and the price column must leave alone', () => {
  it('does not cut a bill whose quantities and prices sit either side of a gap', () => {
    // 'Paneer Tikka  2' is a quantity, not a price; 'Bill No | Table' and 'Total Qty | Sub Total'
    // are not priced lines.
    const bill: Cells = [
      [['SPICE GARDEN', 200]],
      [['Bill No: 2231', 40], ['Table: 7', 400]],
      [['Item', 40], ['Qty', 330], ['Rate', 420], ['Amount', 560]],
      [['Paneer Tikka', 40], ['2', 330], ['280.00', 420], ['560.00', 560]],
      [['Dal Makhani', 40], ['1', 330], ['300.00', 420], ['300.00', 560]],
      [['Butter Naan', 40], ['4', 330], ['60.00', 420], ['240.00', 560]],
      [['Jeera Rice', 40], ['1', 330], ['180.00', 420], ['180.00', 560]],
      [['Total Qty: 8', 40], ['Sub Total', 380], ['1280.00', 560]],
      [['CGST 2.5%', 380], ['32.00', 560]],
      [['SGST 2.5%', 380], ['32.00', 560]],
      [['Grand Total', 380], ['1344.00', 560]],
    ];
    expect(buildRows(columnLines(bill))).toEqual(rowsOf(bill));
    expect(buildRows(singleBoxes(columnLines(bill, { tilt: -0.035 })))).toEqual(rowsOf(bill));
  });

  it('does not cut a bill with a unit column after the quantity', () => {
    const bill: Cells = [
      [['Paneer Tikka', 0], ['2', 300], ['Plt', 350], ['280.00', 420], ['560.00', 510]],
      [['Butter Naan', 0], ['4', 300], ['Pcs', 350], ['60.00', 434], ['240.00', 510]],
      [['Dal Makhani', 0], ['1', 300], ['Bowl', 350], ['300.00', 420], ['300.00', 510]],
      [['Sweet Lassi', 0], ['2', 300], ['Gls', 350], ['90.00', 434], ['180.00', 510]],
      [['Sub Total', 0], ['1280.00', 496]],
      [['Grand Total', 0], ['1280.00', 496]],
    ];
    const receipt = parseReceipt(buildRows(stripLines(bill, { left: 40 })));
    expect(receipt.items.map((i) => i.amount)).toEqual([56000, 24000, 30000, 18000]);
    expect(receipt.warnings).toEqual([]);
  });

  it('keeps totals and prices on short bills with "label: number" lines at one end', () => {
    const shop: Cells = [
      [['QUICK MART', 160]],
      [['MILK', 40], ['3.49', 420]],
      [['EGGS', 40], ['4.99', 420]],
      [['BREAD', 40], ['2.99', 420]],
      [['SUBTOTAL', 250], ['11.47', 420]],
      [['TAX', 250], ['0.83', 420]],
      [['TOTAL', 250], ['12.30', 420]],
      [['ITEMS SOLD 3', 120]],
      [['STORE 1234', 40]],
      [['LANE 3', 40]],
    ];
    expect(buildRows(columnLines(shop))).toEqual(rowsOf(shop));
    const dhaba: Cells = [
      [['THE CURRY HOUSE', 180]],
      [['Bill No: 2231', 40]],
      [['Table: 7', 40]],
      [['Item', 40], ['Qty', 330], ['Rate', 420], ['Amount', 560]],
      [['Paneer Tikka', 40], ['2', 330], ['280.00', 420], ['560.00', 560]],
      [['Dal Makhani', 40], ['1', 330], ['300.00', 420], ['300.00', 560]],
      [['Butter Naan', 40], ['4', 330], ['60.00', 420], ['240.00', 560]],
      [['Total', 40], ['1100.00', 560]],
    ];
    for (const tilt of [0, 0.03]) expect(buildRows(columnLines(dhaba, { tilt }))).toEqual(rowsOf(dhaba));
  });

  it('keeps percent, currency and Cr columns printed after the price', () => {
    for (const flag of ['5%', 'Cr', 'USD', '€']) {
      const bill: Cells = [
        [['Coffee Beans', 40], ['12.99', 420], [flag, 520]],
        [['Oat Milk', 40], ['4.49', 420], [flag, 520]],
        [['Croissant', 40], ['3.25', 420], [flag, 520]],
        [['Bagel', 40], ['2.10', 420], [flag, 520]],
        [['TOTAL', 40], ['22.83', 420]],
      ];
      expect(buildRows(columnLines(bill))).toEqual(rowsOf(bill));
    }
  });

  it('reads the top half first even when the bottom half has a "Total Items" line', () => {
    const bottom: Cells = [BOTTOM_HALF[0], BOTTOM_HALF[1], [['Total Items: 8', 0], ['Total Qty: 16', 260]], ...BOTTOM_HALF.slice(2)];
    const lines = [...stripLines(TOP_HALF, { left: 640, top: 100, tilt: 0.01 }), ...stripLines(bottom, { left: 0, top: 120, tilt: -0.02 })];
    expect(buildRows(lines)).toEqual([...rowsOf(TOP_HALF), ...rowsOf(bottom)]);
  });
});

describe('other paper in the photo, and strips that sit out of line', () => {
  // A bill without a column-title row (most US and many Indian POS bills).
  const BILL: Cells = [
    [['SPICE GARDEN', 120]],
    [['12 MG Road Bengaluru', 60]],
    [['Paneer Tikka', 0], ['2', 300], ['280.00', 360], ['560.00', 470]],
    [['Dal Makhani', 0], ['1', 300], ['300.00', 360], ['300.00', 470]],
    [['Butter Naan', 0], ['4', 300], ['60.00', 360], ['240.00', 470]],
    [['Jeera Rice', 0], ['1', 300], ['180.00', 360], ['180.00', 470]],
    [['Veg Biryani', 0], ['1', 300], ['260.00', 360], ['260.00', 470]],
    [['Fresh Lime Soda', 0], ['1', 300], ['80.00', 360], ['80.00', 470]],
    [['Sub Total', 0], ['1620.00', 460]],
    [['CGST @2.5%', 0], ['40.50', 470]],
    [['SGST @2.5%', 0], ['40.50', 470]],
    [['Grand Total', 0], ['1701.00', 460]],
  ];
  const billAmounts = [56000, 30000, 24000, 18000, 26000, 8000];

  it('reads a card slip lying left of the bill after the bill', () => {
    const slip: Cells = [
      [['CARD SALE', 0]],
      [['VISA XXXX1234', 0]],
      [['AMOUNT', 0], ['1,460.00', 190]],
      [['AUTH 049121', 0]],
      [['TOTAL', 0], ['1,460.00', 190]],
      [['CUSTOMER COPY', 0]],
    ];
    const rows = buildRows([...stripLines(slip, { left: 0 }), ...stripLines(BILL, { left: 420 })]);
    expect(rows.slice(0, BILL.length)).toEqual(rowsOf(BILL));
    const r = parseReceipt(rows);
    expect(r.items.map((i) => i.amount)).toEqual(billAmounts);
    expect(r.total).toBe(170100);
    expect(r.warnings).toEqual([]);
  });

  it('reads a parking ticket lying right of the bill after the bill', () => {
    const ticket: Cells = [[['CITY PARKING', 0]], [['Entry 18:02', 0]], [['Car 2 hrs', 0], ['60.00', 220]], [['GST 18%', 0], ['10.80', 220]], [['Paid', 0], ['70.80', 220]]];
    const r = parseReceipt(buildRows([...stripLines(BILL, { left: 0 }), ...stripLines(ticket, { left: 640 })]));
    expect(r.items.map((i) => i.amount)).toEqual(billAmounts);
    expect(r.warnings).toEqual([]);
  });

  it('cuts two strips whose rows sit up to a row out of line with each other', () => {
    // The real OCR.space response of a made-up grocery receipt, cut before 'CHEDDAR' and its lower
    // part laid right of the upper part, from level with it to almost a row lower.
    const lines = overlayLines(groceryResponse as never).filter((l) => l.words.length);
    const slope = -0.026;
    const cy = (l: OcrLine) => l.words.reduce((s, w) => s + w.top + w.height / 2 - slope * (w.left + w.width / 2), 0) / l.words.length;
    const cut = cy(lines.find((l) => l.text.startsWith('CHEDDAR')) as OcrLine) - 14;
    const upper = lines.filter((l) => cy(l) < cut);
    const lower = lines.filter((l) => cy(l) >= cut);
    const dx = Math.max(...upper.flatMap((l) => l.words.map((w) => w.left + w.width))) - Math.min(...lower.flatMap((l) => l.words.map((w) => w.left))) + 40;
    const whole = parseReceipt(buildRows(lines));
    expect(whole.computedTotal).toBe(whole.total);
    for (const rowsLower of [0, 0.3, 0.5, 0.8]) {
      const dy = Math.min(...upper.map(cy)) - Math.min(...lower.map(cy)) + rowsLower * 28;
      const moved = lower.map((l) => ({ text: l.text, words: l.words.map((w) => ({ ...w, left: w.left + dx, top: Math.round(w.top + dy + slope * dx) })) }));
      const r = parseReceipt(buildRows([...upper, ...moved]));
      expect(summary(r)).toEqual(summary(whole));
    }
  });

  it('cuts a tilted engine 3 photo of two strips', () => {
    const lines = [
      ...stripLines(TOP_HALF, { left: 0, top: 100, tilt: 0.06 }),
      ...stripLines(BOTTOM_HALF, { left: 640, top: 120, tilt: 0.06 }),
    ];
    expect(buildRows(singleBoxes(lines))).toEqual([...rowsOf(TOP_HALF), ...rowsOf(BOTTOM_HALF)]);
  });
});

describe('sums, rounding and readings', () => {
  it('keeps an amount whose name was lost, instead of changing another line to cover it', () => {
    const r = parseReceipt(['SPICE GARDEN', 'Particulars  Qty  Rate  Amt', 'Tomato Soup  1  190.00  180.00', 'Paneer Tikka  2  280.00  560.00', 'Dal Makhani  1  320.00  320.00', '1  10.00  10.00', 'Grand Total  1070.00']);
    expect(r.items.map((i) => i.amount)).toEqual([18000, 56000, 32000, 1000]);
    expect(r.warnings).toEqual([]);
  });

  it('keeps a $0.50 discount on a bill rounded to whole dollars, without inventing a round-off', () => {
    const r = parseReceipt(['JOES DINER  USD', 'Item  Qty  Rate  Amount', 'Burger  1  6.75  6.75', 'Soup  1  9.49  9.49', 'Pizza  1  16.39  15.89', 'Salad  1  3.69  3.69', 'Sales Tax 8.875%  3.18', 'TOTAL  39.00']);
    expect(r.items.map((i) => i.amount)).toEqual([675, 949, 1589, 369]);
    expect(r.charges.map((c) => c.kind)).toEqual(['tax']);
    expect(r.computedTotal).toBe(3900);
  });

  it('prefers a reading whose totals block adds up over one with no items or a shifted total', () => {
    // One amount was missed, but subtotal + taxes + round-off = total: the totals were read right.
    const nearly = parseReceipt(['Item  Qty  Rate  Amount', 'Naan  6  60.00', 'Butter Chicken  1  420.00  420.00', 'Chicken Lababdar  1  450.00  450.00', 'Gulab Jamun  2  80.00  160.00', 'Sub Total  1390.00', 'CGST 2.5%  34.75', 'SGST 2.5%  34.75', 'Round Off  0.50', 'Grand Total  1460.00']);
    const shifted = parseReceipt(['Item  Qty  Rate  Amount', 'Naan  420.00  420.00', 'Butter Chicken  450.00', 'Chicken Lababdar  160.00', 'Gulab Jamun  80.00', 'Total Qty: 10  1390.00', 'Sub Total  34.75']);
    const empty = parseReceipt(['Item  Qty  Rate  Amount', 'Service charge is optional', 'Thank you']);
    expect(receiptScore(nearly)).toBeGreaterThan(receiptScore(shifted));
    expect(receiptScore(nearly)).toBeGreaterThan(receiptScore(empty));
  });
});

describe('rows that must not be "repaired"', () => {
  const read = (line: string) => {
    const r = parseReceipt(['Item  Qty  Rate  Amount', line]).items[0];
    return r && `${r.quantity} × ${(r.unitPrice ?? 0) / 100} = ${r.amount / 100}`;
  };

  it('never takes a price as the quantity next to a count', () => {
    // 5% off, as printed (not 109 × ₹1 = 108.55).
    expect(read('Shampoo  1.00  109.00  103.55')).toBe('1 × 109 = 103.55');
    expect(read('Paneer  3.00  649.00  1947.8')).toBe('3 × 649 = 1947');
    expect(read('Paneer  1.00  289.00  288.00')).toBe('1 × 288 = 288');
  });

  it('never reads a weight as the price', () => {
    const r = parseReceipt(['Item  Qty  Rate  Amount', 'Tomato  0.455  219.00  99.65', 'Onion  1.235  45.00  55.58', 'Sub Total  155.22', 'Total  155.22']);
    expect(r.items.map((i) => `${i.quantity} × ${(i.unitPrice ?? 0) / 100} = ${i.amount / 100}`)).toEqual(['0.455 × 219 = 99.65', '1.235 × 45 = 55.58']);
  });
});

describe('charges and readings', () => {
  it('reads "Staff Welfare" as a service charge', () => {
    expect(analyzeRow('Staff Welfare @5.0%  1763.20', 0)).toMatchObject({ kind: 'charge', chargeKind: 'service' });
  });

  it('prefers a reading that adds up over one that tears rows into more "items"', () => {
    const good = parseReceipt(['Item  Qty  Rate  Amount', 'Naan  6  60.00  360.00', 'Dal  1  250.00  250.00', 'Total  610.00']);
    const torn = parseReceipt(['Item  Qty  Rate  Amount', 'Naan', '6', 'Dal', '1', 'Raita', '2', 'Soda', '3', 'Total  610.00']);
    expect(torn.items.length).toBeGreaterThan(good.items.length);
    expect(receiptScore(good)).toBeGreaterThan(receiptScore(torn));
  });
});
