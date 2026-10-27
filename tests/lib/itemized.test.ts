import type { BillCharge, BillItem, ItemizedBill } from '../../app/src/types';
import {
  assignEqually,
  assignUnassignedToAll,
  computeItemized,
  itemizedTotal,
  newBillCharge,
  newBillItem,
  setPortions,
  togglePerson,
} from '../../app/src/lib/itemized';

function item(id: string, name: string, amount: number, shares: Record<string, number>, quantity = 1): BillItem {
  return { id, name, quantity, amount, shares };
}

function charge(id: string, label: string, amount: number, allocation: 'proportional' | 'equal' = 'proportional', kind: BillCharge['kind'] = 'tax'): BillCharge {
  return { id, kind, label, amount, allocation };
}

/** The user's dinner: 6 Naan (A,B,C,D), Butter Chicken (A,C), Chicken Lababdar (B,C,D), Gulab Jamun (B,D). */
function dinnerItems(): BillItem[] {
  return [
    item('naan', 'Naan', 36000, { A: 1, B: 1, C: 1, D: 1 }, 6),
    item('bc', 'Butter Chicken', 42000, { A: 1, C: 1 }),
    item('cl', 'Chicken Lababdar', 45000, { B: 1, C: 1, D: 1 }),
    item('gj', 'Gulab Jamun', 16000, { B: 1, D: 1 }, 2),
  ];
}

const gst = (): BillCharge[] => [charge('cgst', 'CGST 2.5%', 3475), charge('sgst', 'SGST 2.5%', 3475)];

function totals(bill: ItemizedBill): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of computeItemized(bill).perPerson) out[p.personId] = p.total;
  return out;
}

function subtotals(bill: ItemizedBill): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of computeItemized(bill).perPerson) out[p.personId] = p.itemsSubtotal;
  return out;
}

describe("computeItemized: the user's restaurant bill", () => {
  it('gives the exact item subtotals', () => {
    const r = computeItemized({ items: dinnerItems(), charges: [] });
    expect(r.errors).toEqual([]);
    expect(r.itemsSubtotal).toBe(139000);
    expect(r.total).toBe(139000);
    expect(subtotals({ items: dinnerItems(), charges: [] })).toEqual({ A: 30000, B: 32000, C: 45000, D: 32000 });
    expect(r.perPerson.map((p) => p.personId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('adds CGST + SGST 2.5% proportionally', () => {
    const bill = { items: dinnerItems(), charges: gst() };
    const r = computeItemized(bill);
    expect(r.errors).toEqual([]);
    expect(r.chargesTotal).toBe(6950);
    expect(r.total).toBe(145950);
    expect(totals(bill)).toEqual({ A: 31500, B: 33600, C: 47250, D: 33600 });
    const a = r.perPerson[0];
    expect(a.itemsSubtotal).toBe(30000);
    expect(a.charges).toBe(1500);
    expect(a.chargeLines).toEqual([
      { chargeId: 'cgst', label: 'CGST 2.5%', amount: 750 },
      { chargeId: 'sgst', label: 'SGST 2.5%', amount: 750 },
    ]);
  });

  it('lists each person’s items with their portion', () => {
    const r = computeItemized({ items: dinnerItems(), charges: gst() });
    const a = r.perPerson.find((p) => p.personId === 'A')!;
    expect(a.lines).toEqual([
      { itemId: 'naan', name: 'Naan', amount: 9000, portion: '1/4' },
      { itemId: 'bc', name: 'Butter Chicken', amount: 21000, portion: '1/2' },
    ]);
    const c = r.perPerson.find((p) => p.personId === 'C')!;
    expect(c.lines.map((l) => [l.itemId, l.amount, l.portion])).toEqual([
      ['naan', 9000, '1/4'],
      ['bc', 21000, '1/2'],
      ['cl', 15000, '1/3'],
    ]);
  });

  it('handles a +₹0.50 round-off and still sums exactly to ₹1,460.00', () => {
    const bill = { items: dinnerItems(), charges: [...gst(), charge('ro', 'Round Off', 50, 'proportional', 'roundoff')] };
    const r = computeItemized(bill);
    expect(r.errors).toEqual([]);
    expect(r.total).toBe(146000);
    expect(totals(bill)).toEqual({ A: 31511, B: 33612, C: 47266, D: 33611 });
    expect(r.perPerson.reduce((s, p) => s + p.total, 0)).toBe(146000);
  });
});

describe('computeItemized: portions and charges', () => {
  it('splits by unequal portions (A ate 2 of 6 naan)', () => {
    const bill = { items: [item('naan', 'Naan', 36000, { A: 2, B: 1, C: 2, D: 1 }, 6)], charges: [] };
    expect(totals(bill)).toEqual({ A: 12000, B: 6000, C: 12000, D: 6000 });
    const lines = computeItemized(bill).perPerson.map((p) => p.lines[0].portion);
    expect(lines).toEqual(['1/3', '1/6', '1/3', '1/6']);
  });

  it('shares an equal-allocation charge evenly among people with items', () => {
    const bill = { items: dinnerItems(), charges: [charge('pack', 'Packing', 10001, 'equal', 'other')] };
    const r = computeItemized(bill);
    expect(r.errors).toEqual([]);
    expect(r.perPerson.map((p) => p.charges)).toEqual([2501, 2500, 2500, 2500]);
    expect(r.total).toBe(149001);
  });

  it('spreads a negative discount proportionally', () => {
    const bill = { items: dinnerItems(), charges: [charge('disc', 'Discount 10%', -13900, 'proportional', 'discount')] };
    const r = computeItemized(bill);
    expect(r.errors).toEqual([]);
    expect(r.chargesTotal).toBe(-13900);
    expect(r.perPerson.map((p) => p.charges)).toEqual([-3000, -3200, -4500, -3200]);
    expect(totals(bill)).toEqual({ A: 27000, B: 28800, C: 40500, D: 28800 });
  });

  it('allocates odd paise without losing any', () => {
    const bill = { items: [item('x', 'Dal', 10001, { A: 1, B: 1, C: 1 })], charges: [charge('t', 'Tax', 101)] };
    const r = computeItemized(bill);
    expect(r.perPerson.reduce((s, p) => s + p.total, 0)).toBe(10102);
    expect(r.perPerson.map((p) => p.itemsSubtotal)).toEqual([3334, 3334, 3333]);
  });

  it('orders people by first appearance', () => {
    const bill = { items: [item('a', 'Tea', 3000, { C: 1, A: 1 }), item('b', 'Bun', 2000, { B: 1, A: 1 })], charges: [] };
    expect(computeItemized(bill).perPerson.map((p) => p.personId)).toEqual(['C', 'A', 'B']);
  });

  it('ignores zero portions and leaves out people whose total is zero', () => {
    const bill = { items: [item('a', 'Water', 0, { Z: 1 }), item('b', 'Tea', 3000, { A: 1, B: 0 })], charges: [] };
    const r = computeItemized(bill);
    expect(r.errors).toEqual([]);
    expect(r.perPerson.map((p) => p.personId)).toEqual(['A']);
  });
});

describe('computeItemized: unassigned items and errors', () => {
  it('reports unassigned items and does not allocate them', () => {
    const items = dinnerItems();
    items[3] = { ...items[3], shares: {} };
    const bill = { items, charges: gst() };
    const r = computeItemized(bill);
    expect(r.unassignedItemIds).toEqual(['gj']);
    expect(r.errors).toEqual(['Assign "Gulab Jamun" to at least one person']);
    expect(r.total).toBe(145950);
    const allocated = r.perPerson.reduce((s, p) => s + p.total, 0);
    expect(allocated).toBe(r.total - 16000);
  });

  it('asks for at least one item', () => {
    const r = computeItemized({ items: [], charges: [] });
    expect(r.errors).toEqual(['Add at least one item']);
    expect(r.total).toBe(0);
    expect(r.perPerson).toEqual([]);
  });

  it('does not allocate charges when nobody has items', () => {
    const r = computeItemized({ items: [item('a', 'Free water', 0, { A: 1 })], charges: [charge('t', 'Tax', 500)] });
    expect(r.errors).toEqual(['Assign items to people before splitting tax and charges']);
    expect(r.perPerson).toEqual([]);
    expect(r.total).toBe(500);
  });

  it('flags negative totals', () => {
    const r = computeItemized({ items: [item('a', 'Tea', 1000, { A: 1 })], charges: [charge('d', 'Discount', -2000, 'proportional', 'discount')] });
    expect(r.errors).toEqual(["The bill total can't be negative"]);
  });

  it('names untitled items in errors', () => {
    const r = computeItemized({ items: [item('a', '  ', 1000, {})], charges: [] });
    expect(r.errors).toEqual(['Assign "Untitled item" to at least one person']);
  });
});

describe('itemizedTotal', () => {
  it('adds items and charges', () => {
    expect(itemizedTotal({ items: dinnerItems(), charges: gst() })).toBe(145950);
    expect(itemizedTotal({ items: [], charges: [] })).toBe(0);
  });

  it('ignores the printed total', () => {
    expect(itemizedTotal({ items: dinnerItems(), charges: [], printedTotal: 999 })).toBe(139000);
  });
});

describe('bill editing helpers', () => {
  it('creates items and charges with ids', () => {
    const shares = { A: 1 };
    const it1 = newBillItem('Naan', 36000, 6, shares);
    expect(it1.id).toMatch(/^itm_/);
    expect(it1.quantity).toBe(6);
    expect(it1.shares).toEqual({ A: 1 });
    expect(it1.shares).not.toBe(shares);
    const it2 = newBillItem('Tea', 3000);
    expect(it2.quantity).toBe(1);
    expect(it2.shares).toEqual({});
    expect(it2.id).not.toBe(it1.id);
    const c = newBillCharge('tax', 'CGST 2.5%', 3475);
    expect(c.id).toMatch(/^chg_/);
    expect(c.allocation).toBe('proportional');
  });

  it('assigns equally', () => {
    const it1 = item('x', 'Naan', 36000, { A: 3 });
    const assigned = assignEqually(it1, ['B', 'C', 'B']);
    expect(assigned.shares).toEqual({ B: 1, C: 1 });
    expect(it1.shares).toEqual({ A: 3 });
  });

  it('toggles people on and off without mutating', () => {
    const it1 = item('x', 'Naan', 36000, { A: 1 });
    const on = togglePerson(it1, 'B');
    expect(on.shares).toEqual({ A: 1, B: 1 });
    const off = togglePerson(on, 'A');
    expect(off.shares).toEqual({ B: 1 });
    expect(it1.shares).toEqual({ A: 1 });
  });

  it('sets portions; zero removes', () => {
    const it1 = item('x', 'Naan', 36000, { A: 1, B: 1 });
    expect(setPortions(it1, 'A', 2).shares).toEqual({ A: 2, B: 1 });
    expect(setPortions(it1, 'A', 0).shares).toEqual({ B: 1 });
    expect(setPortions(it1, 'C', 3).shares).toEqual({ A: 1, B: 1, C: 3 });
  });

  it('assigns only the unassigned items to everyone', () => {
    const items = dinnerItems();
    items[1] = { ...items[1], shares: {} };
    const bill = { items, charges: [] };
    const fixed = assignUnassignedToAll(bill, ['A', 'B', 'C', 'D']);
    expect(fixed.items[1].shares).toEqual({ A: 1, B: 1, C: 1, D: 1 });
    expect(fixed.items[0]).toBe(items[0]);
    expect(bill.items[1].shares).toEqual({});
    expect(computeItemized(fixed).unassignedItemIds).toEqual([]);
  });
});
