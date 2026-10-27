import { buildRows } from '../../app/src/ocr/lineBuilder';
import { parseReceipt } from '../../app/src/ocr/receiptParser';
import type { OcrLine } from '../../app/src/ocr/types';
import { COLS, columnLines, makeLine, singleBoxes } from './fixtures/overlay';

const { name, qty, rate, amount } = COLS;

const BILL: [string, number][][] = [
  [['SPICE GARDEN', 200]],
  [['Bill No: 1047', name], ['Table: 12', 470]],
  [['Item', name], ['Qty', qty], ['Rate', rate], ['Amount', amount]],
  [['Naan', name], ['6', qty], ['60.00', rate], ['360.00', amount]],
  [['Butter Chicken', name], ['1', qty], ['420.00', rate], ['420.00', amount]],
  [['Chicken Lababdar', name], ['1', qty], ['450.00', rate], ['450.00', amount]],
  [['Gulab Jamun', name], ['2', qty], ['80.00', rate], ['160.00', amount]],
  [['Sub Total', name], ['1390.00', amount]],
  [['CGST 2.5%', name], ['34.75', amount]],
  [['SGST 2.5%', name], ['34.75', amount]],
  [['Round Off', name], ['0.50', amount]],
  [['Grand Total', name], ['1460.00', amount]],
];

const EXPECTED_ROWS = [
  'SPICE GARDEN',
  'Bill No: 1047  Table: 12',
  'Item  Qty  Rate  Amount',
  'Naan  6  60.00  360.00',
  'Butter Chicken  1  420.00  420.00',
  'Chicken Lababdar  1  450.00  450.00',
  'Gulab Jamun  2  80.00  160.00',
  'Sub Total  1390.00',
  'CGST 2.5%  34.75',
  'SGST 2.5%  34.75',
  'Round Off  0.50',
  'Grand Total  1460.00',
];

function expectSampleTotals(rows: string[]) {
  const r = parseReceipt(rows);
  expect(r.items.map((i) => i.name)).toEqual(['Naan', 'Butter Chicken', 'Chicken Lababdar', 'Gulab Jamun']);
  expect(r.items.map((i) => i.amount)).toEqual([36000, 42000, 45000, 16000]);
  expect(r.total).toBe(146000);
  expect(r.warnings).toEqual([]);
}

describe('buildRows', () => {
  it('puts columns returned as separate lines back into rows, with two spaces at column breaks', () => {
    const rows = buildRows(columnLines(BILL));
    expect(rows).toEqual(EXPECTED_ROWS);
    expectSampleTotals(rows);
  });

  it('straightens a tilted photo where the right-hand column sits higher than the names', () => {
    // −3° tilt: the amount column is ~30 px (almost a whole row) higher than the name column.
    const rows = buildRows(columnLines(BILL, { tilt: -0.052 }));
    expect(rows).toEqual(EXPECTED_ROWS);
    expectSampleTotals(rows);
  });

  it('handles a tilt the other way', () => {
    expect(buildRows(columnLines(BILL, { tilt: 0.045 }))).toEqual(EXPECTED_ROWS);
  });

  it('measures the tilt from the columns when every line is a single box (engine 3)', () => {
    // No multi-word lines to measure the slope from; the price column is ~25 px lower than the names.
    const rows = buildRows(singleBoxes(columnLines(BILL, { tilt: 0.045 })));
    expect(rows).toEqual(EXPECTED_ROWS);
    expectSampleTotals(rows);
    expect(buildRows(singleBoxes(columnLines(BILL, { tilt: -0.045 })))).toEqual(EXPECTED_ROWS);
  });

  it('pairs names and prices of a two-column receipt tilted by up to 4°, with or without word boxes', () => {
    const grocery: [string, number][][] = [
      [['FRESH MART', 200]],
      [['BANANAS', 40], ['1.29 N', 480]],
      [['ORGANIC MILK 1GAL', 40], ['5.49 N', 480]],
      [['GREEK YOGURT', 40], ['5.98 N', 480]],
      [['SOURDOUGH BREAD', 40], ['4.25 N', 480]],
      [['DISH SOAP', 40], ['3.49 T', 480]],
      [['SUBTOTAL', 40], ['20.50', 480]],
      [['TAX 8.25%', 40], ['1.69', 480]],
      [['TOTAL', 40], ['22.19', 480]],
    ];
    const expected = grocery.map((row) => row.map(([text]) => text).join('  '));
    for (const tilt of [0.07, 0.04, -0.04, -0.07]) {
      expect(buildRows(columnLines(grocery, { tilt }))).toEqual(expected);
      expect(buildRows(singleBoxes(columnLines(grocery, { tilt })))).toEqual(expected);
    }
  });

  it('splits one OCR line that spans several columns at the wide gaps', () => {
    const lines: OcrLine[] = [
      makeLine('Naan                6    60.00    360.00', 40, 100),
      makeLine('Butter Chicken      1   420.00    420.00', 40, 136),
    ];
    expect(buildRows(lines)).toEqual(['Naan  6  60.00  360.00', 'Butter Chicken  1  420.00  420.00']);
  });

  it('keeps single-spaced words together and glues punctuation that shares a word box', () => {
    const date: OcrLine = {
      text: 'Date: 03/10/2026',
      words: [
        { text: 'Date', left: 40, top: 100, width: 60, height: 24 },
        { text: ':', left: 40, top: 100, width: 60, height: 24 },
        { text: '03', left: 108, top: 100, width: 140, height: 24 },
        { text: '/', left: 108, top: 100, width: 140, height: 24 },
        { text: '10', left: 108, top: 100, width: 140, height: 24 },
        { text: '/', left: 108, top: 100, width: 140, height: 24 },
        { text: '2026', left: 108, top: 100, width: 140, height: 24 },
        { text: 'Time', left: 470, top: 100, width: 60, height: 24 },
        { text: ':', left: 470, top: 100, width: 60, height: 24 },
        { text: '21:14', left: 538, top: 100, width: 70, height: 24 },
      ],
    };
    expect(buildRows([date, makeLine('Family Restaurant & Bar', 120, 140)])).toEqual([
      'Date: 03/10/2026  Time: 21:14',
      'Family Restaurant & Bar',
    ]);
  });

  it('does not merge lines that are stacked in the same column', () => {
    const lines = [makeLine('Dal Makhani with', 40, 100), makeLine('Jeera Rice', 40, 112), makeLine('310.00', 560, 112)];
    expect(buildRows(lines)).toEqual(['Dal Makhani with', 'Jeera Rice  310.00']);
  });

  it('orders rows top to bottom whatever order the lines come in', () => {
    const lines = [makeLine('Total', 40, 300), makeLine('Tea', 40, 100), makeLine('20.00', 560, 300), makeLine('20.00', 560, 100)];
    expect(buildRows(lines)).toEqual(['Tea  20.00', 'Total  20.00']);
  });

  it('copes with empty, partial and malformed input', () => {
    expect(buildRows([])).toEqual([]);
    expect(buildRows(null as unknown as OcrLine[])).toEqual([]);
    expect(buildRows([{ text: '   ', words: [] }])).toEqual([]);
    const noBoxes: OcrLine[] = [
      { text: 'Hello', words: [] },
      { text: 'World', words: [{ text: 'World', left: NaN, top: 0, width: 10, height: 10 }] },
    ];
    expect(buildRows(noBoxes)).toEqual(['Hello', 'World']);
    const mixed: OcrLine[] = [makeLine('Tea        20.00', 40, 100), { text: 'loose text', words: [] }, null as unknown as OcrLine];
    expect(buildRows(mixed)).toEqual(['Tea  20.00', 'loose text']);
    const wordsOnly: OcrLine[] = [{ text: '', words: makeLine('Masala Chai', 40, 100).words }];
    expect(buildRows(wordsOnly)).toEqual(['Masala Chai']);
  });
});
