import { extractNumbers, normalizeLine, parseReceipt } from '../../app/src/ocr/receiptParser';
import { SAMPLE_BILL_ROWS } from '../../app/src/ocr/sampleBill';
import type { ParsedReceipt } from '../../app/src/ocr/types';

const names = (r: ParsedReceipt) => r.items.map((i) => i.name);
const amounts = (r: ParsedReceipt) => r.items.map((i) => i.amount);
const qtys = (r: ParsedReceipt) => r.items.map((i) => i.quantity);
const charge = (r: ParsedReceipt, kind: string) => r.charges.filter((c) => c.kind === kind);
const chargeSummary = (r: ParsedReceipt) => r.charges.map((c) => `${c.kind}:${c.amount}`);

describe('sample bill', () => {
  const r = parseReceipt(SAMPLE_BILL_ROWS);

  it('finds exactly the four items with their line totals', () => {
    expect(names(r)).toEqual(['Naan', 'Butter Chicken', 'Chicken Lababdar', 'Gulab Jamun']);
    expect(amounts(r)).toEqual([36000, 42000, 45000, 16000]);
    expect(qtys(r)).toEqual([6, 1, 1, 2]);
    expect(r.items[0].unitPrice).toBe(6000);
    expect(r.items[3].unitPrice).toBe(8000);
  });

  it('reads CGST, SGST and the round-off as charges', () => {
    expect(r.charges.map((c) => [c.kind, c.label, c.amount])).toEqual([
      ['tax', 'CGST 2.5%', 3475],
      ['tax', 'SGST 2.5%', 3475],
      ['roundoff', 'Round Off', 50],
    ]);
  });

  it('reads subtotal, grand total, currency, merchant and date with no warnings', () => {
    expect(r.subtotal).toBe(139000);
    expect(r.total).toBe(146000);
    expect(r.computedTotal).toBe(146000);
    expect(r.currency).toBe('INR');
    expect(r.merchant).toBe('SPICE GARDEN');
    expect(r.date).toBe('2026-10-03');
    expect(r.warnings).toEqual([]);
  });

  it('is fully confident about rows where qty × rate = amount', () => {
    for (const item of r.items) expect(item.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Indian restaurant bill with Item / Qty / Rate / Amount columns', () => {
  it('reads single-space separated columns', () => {
    const r = parseReceipt([
      'PUNJAB GRILL',
      'Item Qty Rate Amount',
      'Butter Chicken 1 420.00 420.00',
      'Naan 6 60.00 360.00',
      'Dal Makhani 1 380.00 380.00',
      'Total 1160.00',
    ]);
    expect(names(r)).toEqual(['Butter Chicken', 'Naan', 'Dal Makhani']);
    expect(amounts(r)).toEqual([42000, 36000, 38000]);
    expect(qtys(r)).toEqual([1, 6, 1]);
    expect(r.total).toBe(116000);
    expect(r.warnings).toEqual([]);
  });

  it('reads tab-separated OCR.space ParsedText rows and an S.No. column', () => {
    const r = parseReceipt([
      'S.No\tItem\tQty\tRate\tAmount',
      '1\tPaneer Tikka\t1\t280.00\t280.00',
      '2\tJeera Rice\t2\t150.00\t300.00',
      '3\tLassi\t3\t90.00\t270.00',
      'Grand Total\t850.00',
    ]);
    expect(names(r)).toEqual(['Paneer Tikka', 'Jeera Rice', 'Lassi']);
    expect(qtys(r)).toEqual([1, 2, 3]);
    expect(amounts(r)).toEqual([28000, 30000, 27000]);
    expect(r.total).toBe(85000);
  });

  it('accepts a Rate column printed before the Qty column', () => {
    const r = parseReceipt(['Item  Rate  Qty  Amount', 'Masala Dosa  120.00  2  240.00', 'Filter Coffee  40.00  3  120.00', 'Total  360.00']);
    expect(qtys(r)).toEqual([2, 3]);
    expect(r.items.map((i) => i.unitPrice)).toEqual([12000, 4000]);
    expect(amounts(r)).toEqual([24000, 12000]);
  });
});

describe('quantity markers', () => {
  it("reads '6 x Naan 360', 'Naan x6 360.00' and '2 Gulab Jamun @80 160'", () => {
    const r = parseReceipt(['6 x Naan 360', 'Naan x6 360.00', '2 Gulab Jamun @80 160', '3X Masala Chai 90', 'Total 970']);
    expect(names(r)).toEqual(['Naan', 'Naan', 'Gulab Jamun', 'Masala Chai']);
    expect(qtys(r)).toEqual([6, 6, 2, 3]);
    expect(amounts(r)).toEqual([36000, 36000, 16000, 9000]);
    expect(r.items[2].unitPrice).toBe(8000);
    expect(r.total).toBe(97000);
  });

  it("reads 'Naan 6 x 60.00 360.00' and 'Coke 2 @ 45.00 90.00'", () => {
    const r = parseReceipt(['Naan 6 x 60.00 360.00', 'Coke 2 @ 45.00 90.00', 'Total 450.00']);
    expect(qtys(r)).toEqual([6, 2]);
    expect(r.items.map((i) => i.unitPrice)).toEqual([6000, 4500]);
    expect(amounts(r)).toEqual([36000, 9000]);
  });

  it("reads a quantity line under the item ('2 @ 2.99')", () => {
    const r = parseReceipt(['GREEK YOGURT 5.98', '2 @ 2.99', 'BREAD 3.50', 'TOTAL 9.48'], { currencyHint: 'USD' });
    expect(names(r)).toEqual(['GREEK YOGURT', 'BREAD']);
    expect(qtys(r)).toEqual([2, 1]);
    expect(r.items[0].unitPrice).toBe(299);
    expect(r.total).toBe(948);
  });

  it('keeps the printed amount but lowers confidence when qty × rate ≠ amount', () => {
    const r = parseReceipt(['Paneer Butter Masala 2 180.00 340.00', 'Roti 4 20.00 80.00', 'Total 420.00']);
    expect(amounts(r)).toEqual([34000, 8000]);
    expect(r.items[0].quantity).toBe(2);
    expect(r.items[0].confidence).toBeLessThan(0.6);
    expect(r.items[1].confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.warnings).toEqual([]);
  });
});

describe('wrapped item names', () => {
  it('joins a name row with the numbers row below it', () => {
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      'Paneer Tikka  1  280.00  280.00',
      'Fresh Lime Soda',
      '3  90.00  270.00',
      'Sub Total  550.00',
    ]);
    expect(names(r)).toEqual(['Paneer Tikka', 'Fresh Lime Soda']);
    expect(qtys(r)).toEqual([1, 3]);
    expect(amounts(r)).toEqual([28000, 27000]);
  });

  it('joins a name that starts on one row and ends on the row with the numbers', () => {
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      'Dal Makhani with',
      'Jeera Rice  1  310.00  310.00',
      'Masala Papad  2  60.00  120.00',
      'Total  430.00',
    ]);
    expect(names(r)).toEqual(['Dal Makhani with Jeera Rice', 'Masala Papad']);
    expect(amounts(r)).toEqual([31000, 12000]);
  });

  it('appends a continuation row printed under the numbers', () => {
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      'Hyderabadi Chicken  1  520.00  520.00',
      'Dum Biryani (Full)',
      'Masala Papad  2  60.00  120.00',
      'Total  640.00',
    ]);
    expect(names(r)).toEqual(['Hyderabadi Chicken Dum Biryani (Full)', 'Masala Papad']);
    expect(amounts(r)).toEqual([52000, 12000]);
  });

  it('starts a new item at a wrapped name that has its own quantity in front', () => {
    const r = parseReceipt([
      'Qty  Item  Amount',
      '1 x  Paneer Kathi Roll  180.00',
      '1 x  Cold Coffee with Ice',
      'Cream  150.00',
      '2 x  Masala Chai  120.00',
      'Item Total  450.00',
    ]);
    expect(names(r)).toEqual(['Paneer Kathi Roll', 'Cold Coffee with Ice Cream', 'Masala Chai']);
    expect(qtys(r)).toEqual([1, 1, 2]);
    expect(amounts(r)).toEqual([18000, 15000, 12000]);
  });

  it('ignores section headings between items', () => {
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      '--- STARTERS ---',
      'Veg Spring Roll  1  220.00  220.00',
      'MAIN COURSE',
      'Kadai Paneer  1  340.00  340.00',
      'Total  560.00',
    ]);
    expect(names(r)).toEqual(['Veg Spring Roll', 'Kadai Paneer']);
    expect(r.warnings).toEqual([]);
  });
});

describe('taxes and service charge', () => {
  it('reads CGST/SGST/IGST/VAT/GST and service charge with or without a percentage', () => {
    const r = parseReceipt([
      'Pasta Alfredo  1  400.00  400.00',
      'Tiramisu  1  200.00  200.00',
      'Sub Total  600.00',
      'Service Charge 10%  60.00',
      'S.C. 5%  30.00',
      'CGST  15.00',
      'SGST @2.5%  15.00',
      'IGST 5% 30.00',
      'VAT 5%  30.00',
      'GST  10.00',
      'Grand Total  790.00',
    ]);
    expect(chargeSummary(r)).toEqual([
      'service:6000',
      'service:3000',
      'tax:1500',
      'tax:1500',
      'tax:3000',
      'tax:3000',
      'tax:1000',
    ]);
    expect(r.charges[0].label).toBe('Service Charge 10%');
    expect(r.charges[2].label).toBe('CGST');
    expect(r.total).toBe(79000);
    expect(r.warnings).toEqual([]);
  });

  it('computes a charge printed only as a percentage', () => {
    const r = parseReceipt(['Burger  2  150.00  300.00', 'Fries  1  100.00  100.00', 'Service Charge 10%', 'Total  440.00']);
    expect(charge(r, 'service')).toHaveLength(1);
    expect(charge(r, 'service')[0].amount).toBe(4000);
    expect(r.computedTotal).toBe(44000);
    expect(r.warnings).toEqual([]);
  });

  it("does not take the percentage itself as the amount ('CGST 2.5% 34.75')", () => {
    const r = parseReceipt(['Thali  1  500.00  500.00', 'CGST 2.5%  12.50', 'SGST 2.5%  12.50', 'Total  525.00']);
    expect(chargeSummary(r)).toEqual(['tax:1250', 'tax:1250']);
  });
});

describe('discounts', () => {
  it('makes discounts negative whether printed with a minus, in brackets or plain', () => {
    const r = parseReceipt([
      'Pizza  1  600.00  600.00',
      'Garlic Bread  1  200.00  200.00',
      'Sub Total  800.00',
      'Discount 10%  80.00',
      'Coupon  (20.00)',
      'Promo  -50.00',
      'Grand Total  650.00',
    ]);
    expect(chargeSummary(r)).toEqual(['discount:-8000', 'discount:-2000', 'discount:-5000']);
    expect(r.total).toBe(65000);
    expect(r.warnings).toEqual([]);
  });

  it('applies a percentage-only discount to the items subtotal', () => {
    const r = parseReceipt(['Coffee  2  150.00  300.00', 'Cake  1  200.00  200.00', 'Discount 20%', 'Total  400.00']);
    expect(chargeSummary(r)).toEqual(['discount:-10000']);
    expect(r.warnings).toEqual([]);
  });

  it('turns a negative line inside the item list into a discount', () => {
    const r = parseReceipt(['MILK  3.49', 'EGGS  4.99', 'COUPON EGGS  1.00-', 'TOTAL  7.48'], { currencyHint: 'USD' });
    expect(names(r)).toEqual(['MILK', 'EGGS']);
    expect(chargeSummary(r)).toEqual(['discount:-100']);
    expect(r.warnings).toEqual([]);
  });
});

describe('round off', () => {
  it('reads positive and negative round-off lines', () => {
    const up = parseReceipt(['Thali  1  299.50  299.50', 'Round Off  0.50', 'Total  300.00']);
    expect(chargeSummary(up)).toEqual(['roundoff:50']);
    const down = parseReceipt(['Thali  1  300.40  300.40', 'Rounding  -0.40', 'Net Amount  300.00']);
    expect(chargeSummary(down)).toEqual(['roundoff:-40']);
    const brackets = parseReceipt(['Thali  1  300.40  300.40', 'Round Off (0.40)', 'Bill Amount  300.00']);
    expect(chargeSummary(brackets)).toEqual(['roundoff:-40']);
    for (const r of [up, down, brackets]) expect(r.warnings).toEqual([]);
  });

  it('adds an unprinted round-off when the bill is rounded to a whole rupee', () => {
    const r = parseReceipt(['Thali  1  500.00  500.00', 'CGST 2.5%  12.63', 'SGST 2.5%  12.63', 'Grand Total  525.00']);
    expect(charge(r, 'roundoff').map((c) => c.amount)).toEqual([-26]);
    expect(r.computedTotal).toBe(52500);
    expect(r.warnings).toEqual([]);
  });
});

describe('packing, delivery and tips', () => {
  it("reads packing and delivery as kind 'other' and tips as 'tip'", () => {
    const r = parseReceipt([
      'Veg Biryani  1  250.00  250.00',
      'Raita  1  50.00  50.00',
      'Item Total  300.00',
      'Packing Charges  20.00',
      'Delivery Fee  30.00',
      'Tip  25.00',
      'Gratuity  10.00',
      'Amount Payable  385.00',
    ]);
    expect(chargeSummary(r)).toEqual(['other:2000', 'other:3000', 'tip:2500', 'tip:1000']);
    expect(r.subtotal).toBe(30000);
    expect(r.total).toBe(38500);
    expect(r.warnings).toEqual([]);
  });
});

describe('subtotal and total keywords', () => {
  const base = ['Idli  2  40.00  80.00', 'Vada  2  45.00  90.00'];

  it("reads 'Sub Total', 'Subtotal' and 'Sub-total'", () => {
    for (const label of ['Sub Total', 'Subtotal', 'Sub-total', 'SUBTOTAL']) {
      const r = parseReceipt([...base, `${label}  170.00`, 'GST 5%  8.50', 'Total  178.50']);
      expect(r.subtotal).toBe(17000);
      expect(r.total).toBe(17850);
      expect(names(r)).toEqual(['Idli', 'Vada']);
    }
  });

  it("reads 'Grand Total', 'Total', 'Net Amount', 'Amount Payable', 'Bill Amount', 'Total Due' and 'Balance Due'", () => {
    for (const label of ['Grand Total', 'Total', 'Net Amount', 'Amount Payable', 'Bill Amount', 'Total Due', 'Balance Due', 'NET PAYABLE']) {
      const r = parseReceipt([...base, `${label}  170.00`]);
      expect(r.total).toBe(17000);
      expect(r.items).toHaveLength(2);
      expect(r.warnings).toEqual([]);
    }
  });

  it('prefers the grand-total line over an earlier plain total', () => {
    const r = parseReceipt([...base, 'Total  170.00', 'CGST 2.5%  4.25', 'SGST 2.5%  4.25', 'Grand Total  178.50', 'Cash  200.00', 'Change  21.50']);
    expect(r.subtotal).toBe(17000);
    expect(r.total).toBe(17850);
    expect(chargeSummary(r)).toEqual(['tax:425', 'tax:425']);
    expect(r.warnings).toEqual([]);
  });

  it("takes the largest 'Total' when there is no grand-total line", () => {
    const r = parseReceipt([...base, 'Total  170.00', 'Tax  8.50', 'Total  178.50']);
    expect(r.total).toBe(17850);
  });

  it('stops collecting items at the subtotal', () => {
    const r = parseReceipt([...base, 'Sub Total  170.00', 'Extra Cheese  20.00', 'Total  190.00']);
    expect(names(r)).toEqual(['Idli', 'Vada']);
    expect(r.charges.map((c) => c.label)).toEqual(['Extra Cheese']);
    expect(r.computedTotal).toBe(19000);
  });

  it('reads a total whose amount is on the next row', () => {
    const r = parseReceipt([...base, 'Grand Total', '170.00']);
    expect(r.total).toBe(17000);
  });
});

describe('numbers inside item names', () => {
  it("keeps 'Chicken 65' and 'Paneer 65' as names when the columns say so", () => {
    const r = parseReceipt([
      'Item  Qty  Rate  Amount',
      'Chicken 65  1  250.00  250.00',
      'Chicken 65 2 250.00 500.00',
      'Paneer 65  220.00',
      'Total  970.00',
    ]);
    expect(names(r)).toEqual(['Chicken 65', 'Chicken 65', 'Paneer 65']);
    expect(qtys(r)).toEqual([1, 2, 1]);
    expect(amounts(r)).toEqual([25000, 50000, 22000]);
  });

  it('separates a quantity the OCR glued to the name column', () => {
    const r = parseReceipt(['Gulab Jamun 2\t80.00\t160.00', 'Butter Chicken 1\t420.00\t420.00', 'Total\t580.00']);
    expect(names(r)).toEqual(['Gulab Jamun', 'Butter Chicken']);
    expect(qtys(r)).toEqual([2, 1]);
  });

  it('keeps sizes and pack counts that are glued to letters', () => {
    const r = parseReceipt(['Pepsi 500ML  2  40.00  80.00', '7UP  1  40.00  40.00', 'Total  120.00']);
    expect(names(r)).toEqual(['Pepsi 500ML', '7UP']);
    expect(qtys(r)).toEqual([2, 1]);
  });
});
