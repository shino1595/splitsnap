// Receipt parser: other real-world layouts and the OCR misreads seen on phone photos.
import { normalizeLine, parseReceipt } from '../../app/src/ocr/receiptParser';
import type { ParsedReceipt } from '../../app/src/ocr/types';

const summary = (r: ParsedReceipt) => ({
  items: r.items.map((i) => `${i.name} | ${i.quantity} | ${i.amount}`),
  charges: r.charges.map((c) => `${c.kind} | ${c.amount}`),
  subtotal: r.subtotal,
  total: r.total,
  warnings: r.warnings,
});

describe('delivery-app and international layouts', () => {
  it("reads a food-delivery summary ('Paneer Butter Masala x 1  ₹289')", () => {
    const r = parseReceipt([
      'Order Summary',
      'Paneer Butter Masala x 1   ₹289',
      'Garlic Naan x 2   ₹118',
      'Item Total   ₹407',
      'Delivery partner fee   ₹30',
      'Taxes   ₹20.35',
      'Grand Total   ₹457.35',
    ]);
    expect(summary(r)).toEqual({
      items: ['Paneer Butter Masala | 1 | 28900', 'Garlic Naan | 2 | 11800'],
      charges: ['other | 3000', 'tax | 2035'],
      subtotal: 40700,
      total: 45735,
      warnings: [],
    });
    expect(r.currency).toBe('INR');
  });

  it('reads a US restaurant check with leading quantities, tax and a tip percentage', () => {
    const r = parseReceipt(['THE DINER', '1 Cheeseburger    $12.99', '2 Fries    $7.98', 'Subtotal    $20.97', 'Tax    $1.86', 'Tip (18%)    $3.77', 'Total    $26.60']);
    expect(summary(r)).toEqual({
      items: ['Cheeseburger | 1 | 1299', 'Fries | 2 | 798'],
      charges: ['tax | 186', 'tip | 377'],
      subtotal: 2097,
      total: 2660,
      warnings: [],
    });
    expect(r.currency).toBe('USD');
  });

  it("reads a UK bill with '£', a 12.5% service charge and 'Total to pay'", () => {
    const r = parseReceipt(['THE RED LION', '2 Fish & Chips  £25.00', '1 Pint Lager  £5.50', 'Service charge 12.5%  £3.81', 'Total to pay  £34.31']);
    expect(summary(r)).toEqual({
      items: ['Fish & Chips | 2 | 2500', 'Pint Lager | 1 | 550'],
      charges: ['service | 381'],
      subtotal: undefined,
      total: 3431,
      warnings: [],
    });
    expect(r.currency).toBe('GBP');
  });

  it("reads a Singapore bill with 'Svc Chg 10%' and 'GST 9%'", () => {
    const r = parseReceipt(['Chicken Rice  2  5.50  11.00', 'Kopi  2  1.80  3.60', 'Subtotal  14.60', 'Svc Chg 10%  1.46', 'GST 9%  1.45', 'Total S$  17.51']);
    expect(summary(r).charges).toEqual(['service | 146', 'tax | 145']);
    expect(r.total).toBe(1751);
    expect(r.currency).toBe('SGD');
    expect(r.warnings).toEqual([]);
  });

  it('reads a hotel bill and keeps complimentary (0.00) lines out', () => {
    const r = parseReceipt([
      'Room Charges  2  2500.00  5000.00',
      'Masala Chai  2  0.00  0.00',
      'Food  1  800.00  800.00',
      'CGST 6%  348.00',
      'SGST 6%  348.00',
      'Total Amount  6496.00',
    ]);
    expect(summary(r).items).toEqual(['Room Charges | 2 | 500000', 'Food | 1 | 80000']);
    expect(r.total).toBe(649600);
    expect(r.warnings).toEqual([]);
  });

  it("drops item codes before the name and reads 'Less: Discount'", () => {
    const r = parseReceipt(['1023 Butter Chicken 1 420.00 420.00', '1045 Naan 6 60.00 360.00', 'Less: Discount 10%  78.00', 'Net Amt  702.00']);
    expect(summary(r)).toEqual({
      items: ['Butter Chicken | 1 | 42000', 'Naan | 6 | 36000'],
      charges: ['discount | -7800'],
      subtotal: undefined,
      total: 70200,
      warnings: [],
    });
  });
});

describe('OCR misreads', () => {
  it("still finds 'Sub Tota1', 'GRAND T0TAL', 'CGST2.5%' and 'SGST 2.5 %'", () => {
    const r = parseReceipt(['Butter Chicken 1 420.00 420.00', 'Naan 6 60.00 360.00', 'Sub Tota1 780.00', 'CGST2.5% 19.50', 'SGST 2.5 % 19.50', 'GRAND T0TAL 819.00']);
    expect(summary(r)).toEqual({
      items: ['Butter Chicken | 1 | 42000', 'Naan | 6 | 36000'],
      charges: ['tax | 1950', 'tax | 1950'],
      subtotal: 78000,
      total: 81900,
      warnings: [],
    });
  });

  it("reads '1, 300.00' and '1.300.00' as one thousand three hundred", () => {
    expect(normalizeLine('Total  1, 300.00')).toBe('Total 1300.00');
    expect(normalizeLine('Total 1.300.00')).toBe('Total 1300.00');
    const r = parseReceipt(['Thali  2  650.00  1, 300.00', 'Sub Total  1.300.00', 'Total  1,300.00']);
    expect(summary(r).items).toEqual(['Thali | 2 | 130000']);
    expect(r.subtotal).toBe(130000);
    expect(r.warnings).toEqual([]);
  });

  it("reads amounts with letters for digits ('36O.OO', 'l20.00')", () => {
    const r = parseReceipt(['Naan  6  6O.00  36O.OO', 'Lassi  1  l20.00  l20.00', 'Total  48O.00']);
    expect(summary(r).items).toEqual(['Naan | 6 | 36000', 'Lassi | 1 | 12000']);
    expect(r.total).toBe(48000);
  });

  it("reads the rupee sign misread as '¥', '￥', '＜', 'Z' or '?'", () => {
    const r = parseReceipt(['Masala Chai  ¥120.00', 'Bun Maska  ￥60.00', 'Samosa  ＜90.00', 'Kathi Roll  Z180.00', 'Discount  -?50.00', 'Total  ?400.00']);
    expect(r.currency).toBe('INR');
    expect(summary(r).items).toEqual(['Masala Chai | 1 | 12000', 'Bun Maska | 1 | 6000', 'Samosa | 1 | 9000', 'Kathi Roll | 1 | 18000']);
    expect(summary(r).charges).toEqual(['discount | -5000']);
    expect(r.warnings).toEqual([]);
  });

  it('keeps a real yen bill (no decimals) in JPY and honours a yuan hint', () => {
    expect(parseReceipt(['Ramen  ¥980', 'Total  ¥980']).currency).toBe('JPY');
    expect(parseReceipt(['Noodles  ¥28.00', 'Total  ¥28.00'], { currencyHint: 'CNY' }).currency).toBe('CNY');
  });

  it("uses a quantity printed on its own row ('2 x') and skips a column title on its own row", () => {
    const r = parseReceipt(['Qty Item', 'Amount', '2 x', 'Masala Chai  120.00', '1 x  Bun Maska', '60.00', 'Item Total  180.00']);
    expect(summary(r).items).toEqual(['Masala Chai | 2 | 12000', 'Bun Maska | 1 | 6000']);
    expect(r.subtotal).toBe(18000);
  });

  it('reads a numbers row printed above its name on a tilted photo', () => {
    const r = parseReceipt(['FRESH MART', '1.29 N', 'BANANAS', 'ORGANIC MILK 1GAL  5.49 N', '32.28', 'SUBTOTAL', '0.95', 'TAX 8.25%', '7.73', 'TOTAL']);
    expect(summary(r).items).toEqual(['BANANAS | 1 | 129', 'ORGANIC MILK 1GAL | 1 | 549']);
  });
});
