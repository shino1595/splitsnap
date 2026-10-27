// Seeded pseudo-random property tests: the same seed always generates the same cases,
// so any failure is reproducible.
import type { BillCharge, BillItem, Debt, Expense, SplitInput } from '../../app/src/types';
import { allocate, splitEvenly } from '../../app/src/lib/money';
import { computeOwed } from '../../app/src/lib/split';
import { computeItemized } from '../../app/src/lib/itemized';
import { simplifyDebts } from '../../app/src/lib/simplify';
import { computeNets, pairwiseDebts } from '../../app/src/lib/balances';
import { applyDebts, lcg, makeExpense } from './helpers';

const PEOPLE = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function randomPeople(rng: ReturnType<typeof lcg>, min = 1): string[] {
  const out = PEOPLE.filter(() => rng.bool(0.6));
  while (out.length < min) {
    const p = rng.pick(PEOPLE);
    if (out.indexOf(p) < 0) out.push(p);
  }
  return out;
}

describe('property: allocate', () => {
  it('always sums exactly and stays within one unit of the exact share', () => {
    const rng = lcg(20261003);
    for (let run = 0; run < 600; run++) {
      const total = rng.int(-10000000, 10000000);
      const n = rng.int(1, 8);
      const decimals = rng.bool(0.3);
      const weights: number[] = [];
      for (let i = 0; i < n; i++) weights.push(rng.bool(0.2) ? 0 : decimals ? rng.int(1, 10000) / 100 : rng.int(1, 1000));
      if (sum(weights) === 0) weights[0] = 1;

      const result = allocate(total, weights);
      expect(result).toHaveLength(n);
      expect(sum(result)).toBe(total);
      const W = sum(weights);
      result.forEach((r, i) => {
        expect(Number.isInteger(r)).toBe(true);
        expect(Math.abs(r - (total * weights[i]) / W)).toBeLessThan(1);
        if (weights[i] === 0) expect(r).toBe(0);
      });
    }
  });

  it('splitEvenly never differs by more than one unit', () => {
    const rng = lcg(42);
    for (let run = 0; run < 200; run++) {
      const parts = splitEvenly(rng.int(0, 5000000), rng.int(1, 12));
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    }
  });
});

describe('property: computeOwed', () => {
  it('owed always sums to the total for valid splits of every method', () => {
    const rng = lcg(7);
    const methods = ['equal', 'exact', 'percent', 'shares', 'adjustment', 'itemized'] as const;
    for (let run = 0; run < 600; run++) {
      const total = rng.int(1, 5000000);
      const people = randomPeople(rng);
      const method = methods[run % methods.length];
      let split: SplitInput;
      switch (method) {
        case 'equal':
          split = { method, participantIds: people };
          break;
        case 'exact': {
          const parts = allocate(total, people.map(() => rng.int(0, 100)).map((w, i) => (i === 0 ? w + 1 : w)));
          const amounts: Record<string, number> = {};
          people.forEach((p, i) => (amounts[p] = parts[i]));
          split = { method, amounts };
          break;
        }
        case 'percent': {
          const bp = allocate(10000, people.map(() => rng.int(1, 100)));
          const percents: Record<string, number> = {};
          people.forEach((p, i) => (percents[p] = bp[i] / 100));
          split = { method, percents };
          break;
        }
        case 'shares': {
          const s: Record<string, number> = {};
          people.forEach((p) => (s[p] = rng.int(1, 6) / (rng.bool(0.3) ? 2 : 1)));
          split = { method, shares: s };
          break;
        }
        case 'adjustment': {
          const adjustments: Record<string, number> = {};
          let remaining = total;
          for (const p of PEOPLE) {
            if (rng.bool(0.3)) {
              const adj = rng.int(0, Math.floor(remaining / 4));
              adjustments[p] = adj;
              remaining -= adj;
            }
          }
          split = { method, participantIds: people, adjustments };
          break;
        }
        default: {
          const items: BillItem[] = [];
          const count = rng.int(1, 6);
          const itemAmounts = allocate(total, Array.from({ length: count }, () => rng.int(1, 50)));
          itemAmounts.forEach((amount, i) => {
            const sh: Record<string, number> = {};
            randomPeople(rng).forEach((p) => (sh[p] = rng.int(1, 3)));
            items.push({ id: `i${i}`, name: `Item ${i}`, quantity: 1, amount, shares: sh });
          });
          split = { method: 'itemized', bill: { items, charges: [] } };
        }
      }
      const r = computeOwed(total, split, 'INR');
      expect(r.errors).toEqual([]);
      expect(sum(r.owed.map((o) => o.amount))).toBe(total);
      for (const o of r.owed) {
        expect(Number.isInteger(o.amount)).toBe(true);
        expect(o.amount).not.toBe(0);
      }
    }
  });
});

describe('property: computeItemized', () => {
  it('allocates everything except unassigned items, exactly', () => {
    const rng = lcg(1390);
    for (let run = 0; run < 400; run++) {
      const items: BillItem[] = [];
      const count = rng.int(1, 8);
      for (let i = 0; i < count; i++) {
        const sh: Record<string, number> = {};
        if (!rng.bool(0.15)) randomPeople(rng).forEach((p) => (sh[p] = rng.int(1, 4)));
        items.push({ id: `i${i}`, name: `Item ${i}`, quantity: rng.int(1, 6), amount: rng.int(1, 200000), shares: sh });
      }
      const charges: BillCharge[] = [];
      const chargeCount = rng.int(0, 4);
      for (let c = 0; c < chargeCount; c++) {
        charges.push({
          id: `c${c}`,
          kind: 'tax',
          label: `Charge ${c}`,
          amount: rng.int(-500, 5000),
          allocation: rng.bool(0.3) ? 'equal' : 'proportional',
        });
      }
      const r = computeItemized({ items, charges });
      const unassigned = sum(items.filter((it) => r.unassignedItemIds.indexOf(it.id) >= 0).map((it) => it.amount));
      const allocated = sum(r.perPerson.map((p) => p.total));
      const anyoneHasItems = items.some((it) => Object.keys(it.shares).length > 0);
      if (anyoneHasItems) expect(allocated).toBe(r.total - unassigned);
      expect(r.total).toBe(sum(items.map((it) => it.amount)) + sum(charges.map((c) => c.amount)));
      for (const p of r.perPerson) {
        expect(p.total).toBe(p.itemsSubtotal + p.charges);
        expect(sum(p.lines.map((l) => l.amount))).toBe(p.itemsSubtotal);
        expect(sum(p.chargeLines.map((l) => l.amount))).toBe(p.charges);
      }
    }
  });
});

describe('property: simplifyDebts and balances', () => {
  it('simplifyDebts preserves every net with at most n − 1 transfers', () => {
    const rng = lcg(99);
    for (let run = 0; run < 400; run++) {
      const people = randomPeople(rng, 2);
      const nets: Record<string, number> = {};
      let balance = 0;
      people.slice(1).forEach((p) => {
        const v = rng.int(-100000, 100000);
        nets[p] = v;
        balance += v;
      });
      nets[people[0]] = -balance;
      const debts = simplifyDebts(nets, 'INR');
      const settled = applyDebts(nets, debts);
      Object.keys(settled).forEach((p) => expect(settled[p]).toBe(0));
      const nonZero = Object.keys(nets).filter((p) => nets[p] !== 0).length;
      expect(debts.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      for (const d of debts) expect(d.amount).toBeGreaterThan(0);
      // Same answer whatever the key order.
      const reversed: Record<string, number> = {};
      Object.keys(nets).reverse().forEach((p) => (reversed[p] = nets[p]));
      expect(simplifyDebts(reversed, 'INR')).toEqual(debts);
    }
  });

  it('pairwise debts and simplified debts both match computeNets', () => {
    const rng = lcg(555);
    for (let run = 0; run < 150; run++) {
      const expenses: Expense[] = [];
      const count = rng.int(1, 6);
      for (let e = 0; e < count; e++) {
        const total = rng.int(1, 300000);
        const payers = randomPeople(rng);
        const paid = allocate(total, payers.map(() => rng.int(1, 5)));
        const debtors = randomPeople(rng);
        const owed = splitEvenly(total, debtors.length);
        expenses.push(
          makeExpense({
            payers: payers.map((p, i) => ({ personId: p, amount: paid[i] })),
            owed: debtors.map((p, i) => ({ personId: p, amount: owed[i] })),
            currency: rng.bool(0.2) ? 'USD' : 'INR',
            deleted: rng.bool(0.1),
          }),
        );
      }
      const nets = computeNets(expenses, []);
      const simplified = ([] as Debt[]).concat(...Object.keys(nets).map((c) => simplifyDebts(nets[c], c)));
      for (const debts of [pairwiseDebts(expenses, []), simplified]) {
        const fromDebts: Record<string, Record<string, number>> = {};
        for (const d of debts) {
          const bucket = fromDebts[d.currency] ?? (fromDebts[d.currency] = {});
          bucket[d.fromId] = (bucket[d.fromId] ?? 0) - d.amount;
          bucket[d.toId] = (bucket[d.toId] ?? 0) + d.amount;
        }
        const currencies = Object.keys(fromDebts).concat(Object.keys(nets));
        for (const currency of currencies) {
          const people = Object.keys(fromDebts[currency] ?? {}).concat(Object.keys(nets[currency] ?? {}));
          for (const p of people) expect(fromDebts[currency]?.[p] ?? 0).toBe(nets[currency]?.[p] ?? 0);
        }
      }
    }
  });
});
