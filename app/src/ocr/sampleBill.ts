// A realistic Indian restaurant bill as OCR rows (columns separated by two spaces, the way
// buildRows joins them). Used by "Try a sample bill" on the scan screen and by the tests.

/** OCR-style rows of a realistic Indian restaurant bill used by "Try a sample bill" and tests:
 *  6 Naan (₹360), Butter Chicken (₹420), Chicken Lababdar (₹450), Gulab Jamun ×2 (₹160),
 *  Sub Total 1390.00, CGST 2.5% 34.75, SGST 2.5% 34.75, Round Off +0.50, Grand Total 1460.00,
 *  plus header/footer noise (restaurant name, GSTIN, Bill No, Table, date, Thank you). */
export const SAMPLE_BILL_ROWS: string[] = [
  'SPICE GARDEN',
  'Family Restaurant & Bar',
  '12, MG Road, Bengaluru 560001',
  'Ph: +91 98765 43210',
  'GSTIN: 29ABCDE1234F1Z5',
  'FSSAI: 11223344556677',
  'TAX INVOICE',
  'Bill No: 1047  Table: 12',
  'Date: 03/10/2026  Time: 21:14',
  'Steward: Ravi  Covers: 4',
  '------------------------------------------',
  'Item  Qty  Rate  Amount',
  '------------------------------------------',
  'Naan  6  60.00  360.00',
  'Butter Chicken  1  420.00  420.00',
  'Chicken Lababdar  1  450.00  450.00',
  'Gulab Jamun  2  80.00  160.00',
  '------------------------------------------',
  'Total Qty: 10',
  'Sub Total  1,390.00',
  'CGST @ 2.5%  34.75',
  'SGST @ 2.5%  34.75',
  'Round Off  0.50',
  '------------------------------------------',
  'Grand Total  ₹ 1,460.00',
  '------------------------------------------',
  'Rs. One Thousand Four Hundred Sixty Only',
  'Thank you! Visit again',
  'www.spicegarden.example',
];
