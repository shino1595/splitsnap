import type { BillCharge, BillItem } from '../../app/src/types';
import { computeItemized } from '../../app/src/lib/itemized';

const FIVE = ['me', 'A', 'B', 'C', 'D'];

function shared(id: string, amount: number, people: string[] = FIVE): BillItem {
  const shares: Record<string, number> = {};
  for (const p of people) shares[p] = 1;
  return { id, name: id, quantity: 1, amount, shares };
}

function charge(id: string, amount: number, allocation: 'proportional' | 'equal'): BillCharge {
  return { id, kind: amount < 0 ? 'discount' : 'tax', label: id, amount, allocation };
}

function totals(items: BillItem[], charges: BillCharge[] = []): number[] {
  const r = computeItemized({ items, charges });
  return FIVE.map((id) => r.perPerson.find((p) => p.personId === id)?.total ?? 0);
}

describe('computeItemized: leftover paise are spread fairly', () => {
  it('does not give every spare cent of a long equal bill to the same people', () => {
    // The real FRESH MART receipt: 7 items, everyone shares everything.
    const amounts = [129, 549, 598, 425, 379, 899, 349];
    const items = amounts.map((a, i) => shared(`i${i}`, a));
    const t = totals(items, [charge('coupon', -100, 'proportional'), charge('tax', 95, 'proportional')]);
    expect(t.reduce((s, v) => s + v, 0)).toBe(3323);
    // Exact share is 664.6 cents each; nobody may be more than a cent away from the others.
    expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(1);
  });

  it('keeps an equal charge fair after uneven items', () => {
    const items = [shared('a', 101), shared('b', 101), shared('c', 101)];
    const t = totals(items, [charge('tip', 3, 'equal')]);
    expect(t.reduce((s, v) => s + v, 0)).toBe(306);
    expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(1);
  });

  it('gives the odd paisa of a discount to the person who paid the odd paisa of an item', () => {
    // Order of first appearance is me, A; A is rounded up on the 1-paisa item.
    const items = [shared('x', 1000, ['me', 'A']), shared('y', 1, ['A', 'me'])];
    const r = computeItemized({ items, charges: [charge('disc', -1, 'equal')] });
    expect(r.perPerson.map((p) => [p.personId, p.total])).toEqual([
      ['me', 500],
      ['A', 500],
    ]);
  });

  it('still splits exact amounts exactly and keeps first-appearance order', () => {
    const r = computeItemized({ items: [shared('naan', 36000, ['A', 'B', 'C', 'D'])], charges: [] });
    expect(r.perPerson.map((p) => [p.personId, p.total])).toEqual([
      ['A', 9000],
      ['B', 9000],
      ['C', 9000],
      ['D', 9000],
    ]);
  });

  it('is deterministic', () => {
    const items = [shared('a', 1001), shared('b', 2002), shared('c', 999)];
    expect(totals(items, [charge('t', 77, 'proportional')])).toEqual(totals(items, [charge('t', 77, 'proportional')]));
  });
});
