// Receipt parser: noise, currencies, merchant/date, total checks, robustness and the text helpers.
import { extractNumbers, normalizeLine, parseReceipt } from '../../app/src/ocr/receiptParser';
import type { ParsedReceipt } from '../../app/src/ocr/types';

const names = (r: ParsedReceipt) => r.items.map((i) => i.name);
const amounts = (r: ParsedReceipt) => r.items.map((i) => i.amount);
const qtys = (r: ParsedReceipt) => r.items.map((i) => i.quantity);
const chargeSummary = (r: ParsedReceipt) => r.charges.map((c) => `${c.kind}:${c.amount}`);

describe('header and footer noise', () => {
  it('ignores registration numbers, bill details, staff, dates, phones, URLs, summaries and amounts in words', () => {
    const r = parseReceipt([
      'HOTEL SARAVANA BHAVAN',
      'No. 21, Anna Salai, Chennai 600002',
      'Ph: 044-2345 6789',
      'Mob: +91 98400 12345',
      'GSTIN: 33AABCH1234M1Z2',
      'FSSAI Lic No. 12419001000123',
      'HSN/SAC: 996331',
      'Bill No: 4521   Table: 7',
      'Invoice No. INV/2026/0042',
      'KOT No: 118',
      'Cover: 2   Cashier: Suresh',
      'Steward: Anil',
      'Date: 12/10/2026   Time: 13:45',
      'Item  Qty  Rate  Amount',
      'Masala Dosa  2  90.00  180.00',
      'Filter Coffee  2  35.00  70.00',
      'Qty: 4',
      'Total Qty: 4',
      'Total Items: 2',
      'Sub Total  250.00',
      'CGST 2.5%  6.25',
      'SGST 2.5%  6.25',
      'Round Off  -0.50',
      'Grand Total  262.00',
      'Rupees Two Hundred Sixty Two Only',
      'Paid by UPI  262.00',
      'Thank you! Visit again',
      'www.saravanabhavan.example',
      'Follow us on instagram @hsb',
    ]);
    expect(names(r)).toEqual(['Masala Dosa', 'Filter Coffee']);
    expect(chargeSummary(r)).toEqual(['tax:625', 'tax:625', 'roundoff:-50']);
    expect(r.subtotal).toBe(25000);
    expect(r.total).toBe(26200);
    expect(r.merchant).toBe('HOTEL SARAVANA BHAVAN');
    expect(r.date).toBe('2026-10-12');
    expect(r.warnings).toEqual([]);
  });

  it('finds items without a column header when the header block is noisy', () => {
    const r = parseReceipt([
      'CAFE MOCHA',
      'Table 4  Covers 2',
      'Order No 77  21-09-26 19:05',
      'Cappuccino  2  160.00  320.00',
      'Brownie  1  180.00  180.00',
      'Total  500.00',
    ]);
    expect(names(r)).toEqual(['Cappuccino', 'Brownie']);
    expect(r.date).toBe('2026-09-21');
    expect(r.warnings).toEqual([]);
  });
});

describe('US and European receipts', () => {
  it('reads a US grocery receipt with $ amounts, tax flags and BALANCE DUE', () => {
    const r = parseReceipt([
      'FRESH MART',
      '(217) 555-0142',
      '10/05/2026 6:42 PM',
      'BANANAS  1.29 N',
      'ORGANIC MILK 1GAL  5.49 N',
      'PAPER TOWELS 6PK  8.99 T',
      'SUBTOTAL  15.77',
      'TAX 8.25%  0.74',
      'TOTAL  16.51',
      'BALANCE DUE  $16.51',
      'VISA TEND  16.51',
      'CHANGE DUE  0.00',
      '# ITEMS SOLD 3',
    ]);
    expect(r.currency).toBe('USD');
    expect(names(r)).toEqual(['BANANAS', 'ORGANIC MILK 1GAL', 'PAPER TOWELS 6PK']);
    expect(amounts(r)).toEqual([129, 549, 899]);
    expect(chargeSummary(r)).toEqual(['tax:74']);
    expect(r.subtotal).toBe(1577);
    expect(r.total).toBe(1651);
    expect(r.date).toBe('2026-10-05');
    expect(r.warnings).toEqual([]);
  });

  it('reads euro amounts with decimal commas and thousands dots', () => {
    const r = parseReceipt([
      'TRATTORIA ROMA',
      'Pizza Margherita  2  9,50  19,00',
      'Vino Rosso  1  1.234,56  1.234,56',
      'Tiramisu  1  6,50  6,50',
      'MwSt 10%  126,01',
      'Summe  € 1.386,07',
    ]);
    expect(r.currency).toBe('EUR');
    expect(amounts(r)).toEqual([1900, 123456, 650]);
    expect(qtys(r)).toEqual([2, 1, 1]);
    expect(chargeSummary(r)).toEqual(['tax:12601']);
    expect(r.total).toBe(138607);
    expect(r.warnings).toEqual([]);
  });

  it('reads totals that carry a currency symbol or code', () => {
    const lines = ['Momos  2  120.00  240.00'];
    expect(parseReceipt([...lines, 'Total: ₹240.00']).total).toBe(24000);
    expect(parseReceipt([...lines, 'Total Rs. 240/-']).total).toBe(24000);
    expect(parseReceipt([...lines, 'TOTAL INR 240.00']).total).toBe(24000);
    expect(parseReceipt(['Burger  12.50', 'Total  US$ 12.50']).total).toBe(1250);
  });
});

describe('currency detection', () => {
  const rows = (total: string) => ['Lunch  1  10.00  10.00', `Total  ${total}`];

  it('detects the currency from symbols and codes', () => {
    expect(parseReceipt(rows('₹10.00')).currency).toBe('INR');
    expect(parseReceipt(rows('Rs.10.00')).currency).toBe('INR');
    expect(parseReceipt(rows('INR 10.00')).currency).toBe('INR');
    expect(parseReceipt(rows('$10.00')).currency).toBe('USD');
    expect(parseReceipt(rows('€10.00')).currency).toBe('EUR');
    expect(parseReceipt(rows('£10.00')).currency).toBe('GBP');
    expect(parseReceipt(rows('S$10.00')).currency).toBe('SGD');
    expect(parseReceipt(rows('AED 10.00')).currency).toBe('AED');
  });

  it('falls back to the hint, then to INR', () => {
    expect(parseReceipt(rows('10.00'), { currencyHint: 'GBP' }).currency).toBe('GBP');
    expect(parseReceipt(rows('10.00')).currency).toBe('INR');
  });

  it('uses the currency for minor units (JPY has none)', () => {
    const r = parseReceipt(['Ramen  1  980  980', 'Gyoza  1  450  450', 'Total  ¥1,430']);
    expect(r.currency).toBe('JPY');
    expect(amounts(r)).toEqual([980, 450]);
    expect(r.total).toBe(1430);
  });
});

describe('merchant and date', () => {
  it('takes the first meaningful line near the top as the merchant', () => {
    const r = parseReceipt([
      'TAX INVOICE',
      '*** ',
      'Barbeque Nation',
      'GSTIN 29AAAAA0000A1Z5',
      'Item  Qty  Amount',
      'Buffet  2  1798.00',
      'Total  1798.00',
    ]);
    expect(r.merchant).toBe('Barbeque Nation');
  });

  it('reads dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd and month-name dates', () => {
    const dateOf = (line: string, hint?: string) =>
      parseReceipt(['SHOP', line, 'Tea  20.00', 'Total  20.00'], { currencyHint: hint }).date;
    expect(dateOf('Date: 03/10/2026')).toBe('2026-10-03');
    expect(dateOf('Dt: 05-10-26 14:32')).toBe('2026-10-05');
    expect(dateOf('2026-10-03 21:14')).toBe('2026-10-03');
    expect(dateOf('Oct 3, 2026 9:15 PM')).toBe('2026-10-03');
    expect(dateOf('3 Oct 2026')).toBe('2026-10-03');
    expect(dateOf('10/05/2026', 'USD')).toBe('2026-10-05');
  });
});

describe('total check', () => {
  it('warns with formatted money when items and charges do not add up to the printed total', () => {
    const r = parseReceipt(['Naan  6  60.00  360.00', 'Butter Chicken  1  420.00  420.00', 'Sub Total  780.00', 'Grand Total  1,000.00']);
    expect(r.total).toBe(100000);
    expect(r.computedTotal).toBe(78000);
    expect(r.warnings).toEqual(['Items and charges add up to ₹780.00 but the bill total says ₹1,000.00']);
  });

  it('warns when the items do not match the printed subtotal', () => {
    const r = parseReceipt(['Naan  6  60.00  360.00', 'Butter Chicken  1  420.00  420.00', 'Sub Total  800.00', 'Grand Total  780.00']);
    expect(r.warnings).toContain('Items add up to ₹780.00 but the bill subtotal says ₹800.00');
  });

  it('warns when no total or no items were found', () => {
    expect(parseReceipt(['Naan  6  60.00  360.00']).warnings.join(' ')).toMatch(/total/i);
    expect(parseReceipt(['HELLO', 'WORLD']).warnings.join(' ')).toMatch(/items/i);
  });
});

describe('robustness', () => {
  it('never throws on empty, odd or hostile input', () => {
    const odd: unknown[] = [
      [],
      [''],
      ['   ', '\t'],
      [null, undefined, 42, {}],
      ['Total'],
      ['-------', '=====', '*****'],
      ['1 2 3 4 5 6 7 8 9'],
      ['Total 1e309', 'Naan NaN Infinity'],
      [Array(3000).fill('Naan  6  60.00  360.00').join('\n')],
      ['∑∫≈ ₹₹₹ $$$ €€€ %%% @@@ xxx'],
    ];
    for (const input of odd) {
      const r = parseReceipt(input as string[]);
      expect(Array.isArray(r.items)).toBe(true);
      expect(Array.isArray(r.warnings)).toBe(true);
      expect(Number.isInteger(r.computedTotal)).toBe(true);
    }
    expect(() => parseReceipt(null as unknown as string[])).not.toThrow();
    expect(() => parseReceipt(undefined as unknown as string[])).not.toThrow();
  });

  it('only produces integer minor-unit amounts', () => {
    const r = parseReceipt(['Chai  3  13.33  39.99', 'Samosa  1  14.005  14.01', 'Total  54.00']);
    for (const item of r.items) expect(Number.isInteger(item.amount)).toBe(true);
    for (const c of r.charges) expect(Number.isInteger(c.amount)).toBe(true);
  });
});

describe('normalizeLine', () => {
  it('fixes letters read inside numbers', () => {
    expect(normalizeLine('Naan 6 6O.00 36O.OO')).toBe('Naan 6 60.00 360.00');
    expect(normalizeLine('Lassi 1 l20.00 l20.00')).toBe('Lassi 1 120.00 120.00');
    expect(normalizeLine('Coke 2 I5.00 3O.00')).toBe('Coke 2 15.00 30.00');
  });

  it('removes currency markers and thousands separators', () => {
    expect(normalizeLine('Grand Total  ₹ 1,390.00')).toBe('Grand Total 1390.00');
    expect(normalizeLine('Total Rs.1,23,456.50')).toBe('Total 123456.50');
    expect(normalizeLine('TOTAL $33.23')).toBe('TOTAL 33.23');
  });

  it('reads decimal commas and split decimals', () => {
    expect(normalizeLine('Summe 1.234,56')).toBe('Summe 1234.56');
    expect(normalizeLine('Pizza 9,50')).toBe('Pizza 9.50');
    expect(normalizeLine('Naan 360. 00')).toBe('Naan 360.00');
  });

  it('keeps words that merely contain O or l', () => {
    expect(normalizeLine('Old Monk Rum 1 450.00')).toBe('Old Monk Rum 1 450.00');
    expect(normalizeLine('Paneer Lollipop')).toBe('Paneer Lollipop');
  });

  it('cleans stray bullets and rules', () => {
    expect(normalizeLine('Grand Total\t· 1460.00')).toBe('Grand Total 1460.00');
    expect(normalizeLine('---------- Starters ----------')).toBe('Starters');
  });
});

describe('extractNumbers', () => {
  it('returns values with their raw text and position', () => {
    const nums = extractNumbers('Naan 6 60.00 360.00');
    expect(nums.map((n) => n.value)).toEqual([6, 60, 360]);
    expect(nums.map((n) => n.raw)).toEqual(['6', '60.00', '360.00']);
    expect(nums[0].index).toBe(5);
  });

  it('reads negatives, percentages, quantity and rate markers', () => {
    expect(extractNumbers('Discount -150.00').map((n) => n.value)).toEqual([-150]);
    expect(extractNumbers('CGST 2.5% 34.75').map((n) => n.value)).toEqual([2.5, 34.75]);
    expect(extractNumbers('Naan x6 360').map((n) => n.value)).toEqual([6, 360]);
    expect(extractNumbers('2 Gulab Jamun @80 160').map((n) => n.value)).toEqual([2, 80, 160]);
  });

  it('skips dates, times and codes glued to letters', () => {
    expect(extractNumbers('Date: 03/10/2026 Time: 21:14')).toEqual([]);
    expect(extractNumbers('GSTIN 29ABCDE1234F1Z5')).toEqual([]);
  });
});
