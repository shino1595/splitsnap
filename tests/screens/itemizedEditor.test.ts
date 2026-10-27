import type { BillItem, ItemizedBill } from '../../app/src/types';
import { assignEqually, assignUnassignedToAll, newBillItem, setPortions, togglePerson } from '../../app/src/lib/itemized';
import {
  applyChargeFields,
  applyItemFields,
  billFromSplit,
  buildSummary,
  chargeFromForm,
  chargesSuffix,
  displayNames,
  evaluateChargeForm,
  firstName,
  hasUnequalPortions,
  isSharedByAll,
  itemFromFields,
  itemShares,
  itemSplitCaption,
  listNames,
  parsePercentInput,
  parseQuantity,
  percentFromLabel,
  percentOf,
  percentRecalculation,
  portionLabel,
  portionsHint,
  removeItemFrom,
  sameBill,
  unitPriceCaption,
  updateItemIn,
} from '../../app/src/screens/itemized/itemizedEditor';

const A = 'A';
const B = 'B';
const C = 'C';
const D = 'D';
const PEOPLE = [A, B, C, D];
const NAMES: Record<string, string> = { A: 'Aarav', B: 'Bhavna', C: 'Chirag', D: 'Diya' };

/** The user's example: 6 Naan by all 4, Butter Chicken by A & C, Chicken Lababdar by B, C & D, Gulab Jamun by B & D. */
function userDinner(): ItemizedBill {
  const everyone = (item: BillItem) => assignEqually(item, PEOPLE);
  const naan = everyone(newBillItem('Naan', 36000, 6));
  let butterChicken = everyone(newBillItem('Butter Chicken', 42000));
  let lababdar = everyone(newBillItem('Chicken Lababdar', 45000));
  let gulabJamun = everyone(newBillItem('Gulab Jamun', 16000, 2));
  // Untap people exactly as the user would on the screen.
  butterChicken = togglePerson(togglePerson(butterChicken, B), D);
  lababdar = togglePerson(lababdar, A);
  gulabJamun = togglePerson(togglePerson(gulabJamun, A), C);
  return { items: [naan, butterChicken, lababdar, gulabJamun], charges: [] };
}

function totalsOf(bill: ItemizedBill): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of buildSummary(bill, PEOPLE, 'INR').people) out[p.personId] = p.total;
  return out;
}

describe("itemizedEditor: the user's A, B, C, D dinner", () => {
  it('shows what each person pays per item', () => {
    const [naan, butterChicken, lababdar, gulabJamun] = userDinner().items;
    expect(itemSplitCaption(naan, 'INR', NAMES)).toEqual({ text: '₹90.00 each · 4 people', tone: 'muted' });
    expect(itemSplitCaption(butterChicken, 'INR', NAMES).text).toBe('₹210.00 each · 2 people');
    expect(itemSplitCaption(lababdar, 'INR', NAMES).text).toBe('₹150.00 each · 3 people');
    expect(itemSplitCaption(gulabJamun, 'INR', NAMES).text).toBe('₹80.00 each · 2 people');
    expect(itemShares(butterChicken).map((s) => s.personId)).toEqual([A, C]);
    expect(itemShares(lababdar).map((s) => s.personId)).toEqual([B, C, D]);
    expect(itemShares(gulabJamun).map((s) => s.personId)).toEqual([B, D]);
  });

  it('adds up to ₹1,390.00 with the right total per person', () => {
    const summary = buildSummary(userDinner(), PEOPLE, 'INR');
    expect(summary.total).toBe(139000);
    expect(summary.canFinish).toBe(true);
    expect(summary.blockers).toEqual([]);
    // A: 90 + 210 · B: 90 + 150 + 80 · C: 90 + 210 + 150 · D: 90 + 150 + 80
    expect(totalsOf(userDinner())).toEqual({ A: 30000, B: 32000, C: 45000, D: 32000 });
    expect(summary.assignedTotal).toBe(139000);
  });

  it('spreads CGST + SGST 2.5% and a round-off in proportion, to the paisa', () => {
    const dinner = userDinner();
    const cgst = chargeFromForm({ preset: 'tax', label: 'CGST', value: '2.5', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    const sgst = chargeFromForm({ preset: 'tax', label: 'SGST', value: '2.5%', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    expect(cgst.label).toBe('CGST 2.5%');
    expect(cgst.amount).toBe(3475);
    expect(sgst.amount).toBe(3475);
    expect(cgst.allocation).toBe('proportional');

    const withTax: ItemizedBill = { ...dinner, charges: [cgst, sgst] };
    expect(totalsOf(withTax)).toEqual({ A: 31500, B: 33600, C: 47250, D: 33600 });

    const roundOff = { id: 'ro', kind: 'roundoff' as const, label: 'Round Off', amount: 50, allocation: 'proportional' as const };
    const full: ItemizedBill = { ...withTax, charges: [cgst, sgst, roundOff], printedTotal: 146000 };
    const summary = buildSummary(full, PEOPLE, 'INR');
    expect(summary.total).toBe(146000);
    expect(summary.assignedTotal).toBe(146000);
    expect(summary.warnings).toEqual([]);
    expect(totalsOf(full)).toEqual({ A: 31511, B: 33612, C: 47266, D: 33611 });
  });

  it('lists item portions per person', () => {
    const summary = buildSummary(userDinner(), PEOPLE, 'INR');
    const bhavna = summary.people.find((p) => p.personId === B)!;
    expect(bhavna.lines.map(portionLabel)).toEqual(['1/4 of Naan', '1/3 of Chicken Lababdar', '1/2 of Gulab Jamun']);
    expect(bhavna.lines.map((l) => l.amount)).toEqual([9000, 15000, 8000]);
  });

  it('handles "A ate 2 of the 6 naan" with portions', () => {
    let naan = assignEqually(newBillItem('Naan', 36000, 6), PEOPLE);
    naan = setPortions(setPortions(naan, A, 2), C, 2);
    expect(hasUnequalPortions(naan)).toBe(true);
    expect(itemSplitCaption(naan, 'INR', NAMES).text).toBe('Aarav ₹120.00 · Bhavna ₹60.00 · Chirag ₹120.00 · Diya ₹60.00');
    expect(unitPriceCaption(naan, 'INR')).toBe('6 × ₹60.00');
  });
});

describe('itemizedEditor: item captions and names', () => {
  it('flags unassigned items and single sharers', () => {
    const item = newBillItem('Lassi', 12000);
    expect(itemSplitCaption(item, 'INR', NAMES)).toEqual({ text: 'Tap who shared this', tone: 'warning' });
    expect(itemSplitCaption(togglePerson(item, B), 'INR', NAMES).text).toBe('Bhavna pays ₹120.00');
    expect(itemSplitCaption(togglePerson(item, 'me'), 'INR', { me: 'You' }).text).toBe('You pay ₹120.00');
  });

  it('marks uneven paise with ≈', () => {
    const item = assignEqually(newBillItem('Dal', 10000), [A, B, C]);
    expect(itemSplitCaption(item, 'INR', NAMES).text).toBe('≈ ₹33.33 each · 3 people');
    expect(itemShares(item).map((s) => s.amount)).toEqual([3334, 3333, 3333]);
  });

  it('knows when everyone shares an item', () => {
    const item = assignEqually(newBillItem('Naan', 36000, 6), PEOPLE);
    expect(isSharedByAll(item, PEOPLE)).toBe(true);
    expect(isSharedByAll(togglePerson(item, D), PEOPLE)).toBe(false);
  });

  it('uses first names unless two people share one', () => {
    expect(firstName('  Aarav Shah ')).toBe('Aarav');
    expect(displayNames([
      { id: 'me', name: 'You' },
      { id: 'x', name: 'Aarav Shah' },
      { id: 'y', name: 'Aarav Mehta' },
      { id: 'z', name: 'Diya' },
    ])).toEqual({ me: 'You', x: 'Aarav Shah', y: 'Aarav Mehta', z: 'Diya' });
  });

  it('only shows a unit price when it divides evenly', () => {
    expect(unitPriceCaption(newBillItem('Roti', 10000, 3), 'INR')).toBeNull();
    expect(unitPriceCaption(newBillItem('Soup', 10000, 1), 'INR')).toBeNull();
  });

  it('joins names for messages', () => {
    expect(listNames(['Naan'])).toBe('"Naan"');
    expect(listNames(['Naan', 'Dal'])).toBe('"Naan" and "Dal"');
    expect(listNames(['A', 'B', 'C', 'D', 'E'])).toBe('"A", "B" and 3 more');
  });
});

describe('itemizedEditor: item entry', () => {
  it('parses quantities', () => {
    expect(parseQuantity('')).toBe(1);
    expect(parseQuantity(' 6 ')).toBe(6);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('1.5')).toBeNull();
    expect(parseQuantity('1000')).toBeNull();
  });

  it('creates a manual item shared by everyone', () => {
    const { item, error } = itemFromFields({ name: ' Naan ', qty: '6', amount: '360' }, 'INR', PEOPLE);
    expect(error).toBeNull();
    expect(item!.name).toBe('Naan');
    expect(item!.quantity).toBe(6);
    expect(item!.amount).toBe(36000);
    expect(item!.shares).toEqual({ A: 1, B: 1, C: 1, D: 1 });
  });

  it('explains invalid item fields', () => {
    expect(itemFromFields({ name: '', qty: '1', amount: '10' }, 'INR', PEOPLE).error).toBe('Enter the item name');
    expect(itemFromFields({ name: 'Tea', qty: 'x', amount: '10' }, 'INR', PEOPLE).error).toBe('Quantity must be a whole number from 1 to 999');
    expect(itemFromFields({ name: 'Tea', qty: '1', amount: '' }, 'INR', PEOPLE).error).toBe('Enter the price');
    expect(itemFromFields({ name: 'Tea', qty: '1', amount: 'abc' }, 'INR', PEOPLE).error).toBe('Enter a valid price, e.g. 360 or 360.50');
    expect(itemFromFields({ name: 'Tea', qty: '1', amount: '0' }, 'INR', PEOPLE).error).toBe('The price must be more than zero');
  });

  it('edits an item and keeps who shared it', () => {
    const item = assignEqually(newBillItem('Nan', 30000, 5), [A, C]);
    const { item: edited } = applyItemFields(item, { name: 'Naan', qty: '6', amount: '360.00' }, 'INR');
    expect(edited).toEqual({ ...item, name: 'Naan', quantity: 6, amount: 36000 });
  });

  it('updates and removes items immutably', () => {
    const bill = userDinner();
    const id = bill.items[1].id;
    const updated = updateItemIn(bill, id, (i) => assignEqually(i, [A]));
    expect(updated.items[1].shares).toEqual({ A: 1 });
    expect(bill.items[1].shares).toEqual({ A: 1, C: 1 });
    expect(removeItemFrom(bill, id).items).toHaveLength(3);
    expect(sameBill(bill, userDinner())).toBe(false); // new ids each time
    expect(sameBill(bill, JSON.parse(JSON.stringify(bill)))).toBe(true);
  });

  it('copies the draft bill or starts empty', () => {
    const bill = userDinner();
    const copy = billFromSplit({ method: 'itemized', bill });
    expect(copy).toEqual(bill);
    copy.items[0].shares[A] = 3;
    expect(bill.items[0].shares[A]).toBe(1);
    expect(billFromSplit({ method: 'equal', participantIds: PEOPLE })).toEqual({ items: [], charges: [] });
  });
});

describe('itemizedEditor: tax, service, tip and discount', () => {
  it('parses percentages', () => {
    expect(parsePercentInput('2.5')).toBe(2.5);
    expect(parsePercentInput('2,5 %')).toBe(2.5);
    expect(parsePercentInput('18%')).toBe(18);
    expect(parsePercentInput('.5')).toBe(0.5);
    expect(parsePercentInput('0')).toBeNull();
    expect(parsePercentInput('101')).toBeNull();
    expect(parsePercentInput('abc')).toBeNull();
  });

  it('rounds percentages half away from zero', () => {
    expect(percentOf(139000, 2.5)).toBe(3475);
    expect(percentOf(139010, 2.5)).toBe(3475);
    expect(percentOf(139020, 2.5)).toBe(3476); // 3475.5 → 3476
    expect(percentOf(100, 5)).toBe(5);
  });

  it('reads the percentage from a label', () => {
    expect(percentFromLabel('CGST 2.5%')).toBe(2.5);
    expect(percentFromLabel('Service Charge @ 10 %')).toBe(10);
    expect(percentFromLabel('Packing')).toBeNull();
  });

  it('offers to recalculate a % charge after the items change', () => {
    const cgst = chargeFromForm({ preset: 'tax', label: 'CGST', value: '2.5', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    expect(percentRecalculation(cgst, 139000)).toBeNull();
    expect(percentRecalculation(cgst, 151000)).toEqual({ percent: 2.5, amount: 3775 });
    const discount = chargeFromForm({ preset: 'discount', label: 'Happy hours 10%', value: '10%', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    expect(discount.amount).toBe(-13900);
    expect(percentRecalculation(discount, 100000)).toEqual({ percent: 10, amount: -10000 });
  });

  it('builds service charge, tip, discount and other charges', () => {
    const service = evaluateChargeForm({ preset: 'service', label: '', value: '10', itemsSubtotal: 139000, currency: 'INR' });
    expect(service).toEqual({ amount: 13900, label: 'Service charge 10%', error: null });
    const tip = evaluateChargeForm({ preset: 'tip', label: '', value: '100', itemsSubtotal: 139000, currency: 'INR' });
    expect(tip).toEqual({ amount: 10000, label: 'Tip', error: null });
    const tipPercent = evaluateChargeForm({ preset: 'tip', label: 'Tip', value: '5%', itemsSubtotal: 139000, currency: 'INR' });
    expect(tipPercent).toEqual({ amount: 6950, label: 'Tip 5%', error: null });
    const discount = chargeFromForm({ preset: 'discount', label: 'Coupon', value: '200', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    expect(discount.kind).toBe('discount');
    expect(discount.amount).toBe(-20000);
    const packing = chargeFromForm({ preset: 'other', label: 'Packing', value: '-30', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    expect(packing.amount).toBe(3000);
    expect(packing.kind).toBe('other');
  });

  it('explains invalid charge input', () => {
    const base = { label: '', itemsSubtotal: 139000, currency: 'INR' };
    expect(evaluateChargeForm({ ...base, preset: 'tax', value: '' }).error).toBe('Enter the percentage');
    expect(evaluateChargeForm({ ...base, preset: 'tip', value: '' }).error).toBe('Enter the amount');
    expect(evaluateChargeForm({ ...base, preset: 'tax', value: '150' }).error).toBe('Enter a percentage between 0 and 100');
    expect(evaluateChargeForm({ ...base, preset: 'tip', value: 'lots' }).error).toBe('Enter a valid amount, e.g. 50 or 49.50');
    expect(evaluateChargeForm({ ...base, preset: 'tip', value: '0' }).error).toBe('The amount must be more than zero');
    expect(evaluateChargeForm({ ...base, preset: 'tax', value: '5', itemsSubtotal: 0 }).error).toBe(
      'Add items first so the percentage has something to apply to',
    );
  });

  it('edits a charge, keeping discounts negative', () => {
    const discount = chargeFromForm({ preset: 'discount', label: 'Coupon', value: '200', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    expect(applyChargeFields(discount, { label: 'Coupon', amount: '150' }, 'INR').charge!.amount).toBe(-15000);
    const roundOff = { id: 'r', kind: 'roundoff' as const, label: 'Round off', amount: 50, allocation: 'proportional' as const };
    expect(applyChargeFields(roundOff, { label: '', amount: '-0.40' }, 'INR').charge).toEqual({ ...roundOff, label: 'Round off', amount: -40 });
    expect(applyChargeFields(roundOff, { label: 'x', amount: '0' }, 'INR').error).toMatch(/zero/);
  });
});

describe('itemizedEditor: summary', () => {
  it('blocks Done while items are unassigned and offers everyone', () => {
    const dinner = userDinner();
    const bill = updateItemIn(dinner, dinner.items[1].id, (i) => assignEqually(i, []));
    const summary = buildSummary(bill, PEOPLE, 'INR');
    expect(summary.canFinish).toBe(false);
    expect(summary.unassignedAmount).toBe(42000);
    expect(summary.blockers).toEqual(['1 item not assigned yet (₹420.00): "Butter Chicken"']);
    expect(summary.assignedTotal).toBe(97000);
    const fixed = buildSummary(assignUnassignedToAll(bill, PEOPLE), PEOPLE, 'INR');
    expect(fixed.canFinish).toBe(true);
    // Butter Chicken now ₹105.00 each: A 90 + 105, B 90 + 150 + 80 + 105, C 90 + 150 + 105, D like B.
    expect(fixed.people.map((p) => p.total)).toEqual([19500, 42500, 34500, 42500]);
  });

  it('blocks an empty bill', () => {
    const summary = buildSummary({ items: [], charges: [] }, PEOPLE, 'INR');
    expect(summary.blockers).toEqual(['Add at least one item']);
    expect(summary.people.map((p) => p.total)).toEqual([0, 0, 0, 0]);
  });

  it('keeps participants with nothing at zero and in order', () => {
    const bill: ItemizedBill = { items: [assignEqually(newBillItem('Tea', 4000), [C, 'me'])], charges: [] };
    const summary = buildSummary(bill, ['me', A, B, C, D], 'INR');
    expect(summary.people.map((p) => [p.personId, p.total])).toEqual([['me', 2000], [A, 0], [B, 0], [C, 2000], [D, 0]]);
  });

  it('warns when the printed total differs, without blocking', () => {
    const bill: ItemizedBill = { ...userDinner(), printedTotal: 146000 };
    const summary = buildSummary(bill, PEOPLE, 'INR');
    expect(summary.canFinish).toBe(true);
    expect(summary.printedDifference).toBe(7000);
    expect(summary.warnings).toEqual([
      'The bill says ₹1,460.00, but items and charges add up to ₹1,390.00 (₹70.00 less). Check the amounts or add the missing charge.',
    ]);
  });

  it('blocks a discount bigger than the bill', () => {
    const big = chargeFromForm({ preset: 'discount', label: 'Voucher', value: '2000', itemsSubtotal: 139000, currency: 'INR' }).charge!;
    const summary = buildSummary({ ...userDinner(), charges: [big] }, PEOPLE, 'INR');
    expect(summary.canFinish).toBe(false);
    expect(summary.blockers[0]).toBe('The bill total must be more than zero');
  });
});

describe('itemizedEditor: portions, charges text and whole-bill amounts', () => {
  it('flags portions that do not add up to the quantity', () => {
    const naan = setPortions(setPortions(assignEqually(newBillItem('Naan', 36000, 6), PEOPLE), A, 2), C, 2);
    expect(portionsHint(naan)).toEqual({ text: 'How many of the 6 did each person have?', tone: 'muted' });
    const fewer = { ...naan, quantity: 4 };
    expect(portionsHint(fewer).tone).toBe('warning');
    expect(portionsHint(fewer).text).toContain('These add up to 6');
    const single = setPortions(assignEqually(newBillItem('Biryani', 30000), [A, B]), A, 2);
    expect(portionsHint(single).text).toBe('Portions per person — 2 pays twice as much as 1 (3 in all)');
    // 2 chai shared by 4 people can't be counted in whole cups.
    const chai = assignEqually(newBillItem('Chai', 12000, 2), PEOPLE);
    expect(portionsHint(chai)).toEqual({ text: 'Portions per person — 2 pays twice as much as 1 (4 in all)', tone: 'muted' });
  });

  it('writes net charges with a real minus sign', () => {
    expect(chargesSuffix(6612, 'INR')).toBe(' + ₹66.12 charges');
    expect(chargesSuffix(-669, 'INR')).toBe(' − ₹6.69 charges');
    expect(chargesSuffix(0, 'INR')).toBe('');
  });

  it('shows the same per-item amounts on the card as in the totals', () => {
    const items = [129, 549, 598].map((a, i) => assignEqually(newBillItem(`Item ${i}`, a), ['me', A, B, C, D]));
    const summary = buildSummary({ items, charges: [] }, ['me', A, B, C, D], 'USD');
    for (const item of items) {
      const fromCard = itemShares(item, summary.itemAmounts[item.id]).map((s) => s.amount);
      const fromTotals = summary.people.map((p) => p.lines.find((l) => l.itemId === item.id)?.amount ?? 0);
      expect(fromCard).toEqual(fromTotals);
      expect(fromCard.reduce((s, v) => s + v, 0)).toBe(item.amount);
    }
    // Without whole-bill amounts the card falls back to splitting the item on its own.
    expect(itemShares(items[0]).map((s) => s.amount)).toEqual([26, 26, 26, 26, 25]);
    expect(itemShares(items[0], { me: 26 }).map((s) => s.amount)).toEqual([26, 26, 26, 26, 25]);
  });
});