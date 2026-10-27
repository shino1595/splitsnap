import type { ItemizedBill, SplitInput, SplitMethod } from '../../app/src/types';
import {
  computeOwed,
  convertSplit,
  defaultSplit,
  describeSplit,
  participantsOf,
  splitMethodLabel,
  validatePayers,
} from '../../app/src/lib/split';
import { shares } from './helpers';

function owedMap(total: number, split: SplitInput, currency = 'INR'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of computeOwed(total, split, currency).owed) out[s.personId] = s.amount;
  return out;
}

function sumOwed(total: number, split: SplitInput): number {
  return computeOwed(total, split, 'INR').owed.reduce((s, o) => s + o.amount, 0);
}

const restaurantBill = (): ItemizedBill => ({
  items: [
    { id: 'naan', name: 'Naan', quantity: 6, amount: 36000, shares: { A: 1, B: 1, C: 1, D: 1 } },
    { id: 'bc', name: 'Butter Chicken', quantity: 1, amount: 42000, shares: { A: 1, C: 1 } },
    { id: 'cl', name: 'Chicken Lababdar', quantity: 1, amount: 45000, shares: { B: 1, C: 1, D: 1 } },
    { id: 'gj', name: 'Gulab Jamun', quantity: 2, amount: 16000, shares: { B: 1, D: 1 } },
  ],
  charges: [
    { id: 'cgst', kind: 'tax', label: 'CGST 2.5%', amount: 3475, allocation: 'proportional' },
    { id: 'sgst', kind: 'tax', label: 'SGST 2.5%', amount: 3475, allocation: 'proportional' },
  ],
});

describe('computeOwed: equal', () => {
  it('splits evenly in the given order', () => {
    const r = computeOwed(100000, { method: 'equal', participantIds: ['A', 'B', 'C'] }, 'INR');
    expect(r.errors).toEqual([]);
    expect(r.owed).toEqual(shares('A', 33334, 'B', 33333, 'C', 33333));
  });

  it('ignores duplicate participants', () => {
    expect(owedMap(1000, { method: 'equal', participantIds: ['A', 'B', 'A'] })).toEqual({ A: 500, B: 500 });
  });

  it('needs at least one participant', () => {
    const r = computeOwed(1000, { method: 'equal', participantIds: [] }, 'INR');
    expect(r.owed).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it('omits zero entries', () => {
    expect(computeOwed(1, { method: 'equal', participantIds: ['A', 'B'] }, 'INR').owed).toEqual(shares('A', 1));
    expect(computeOwed(0, { method: 'equal', participantIds: ['A', 'B'] }, 'INR').owed).toEqual([]);
  });
});

describe('computeOwed: exact', () => {
  it('accepts amounts that add up', () => {
    const r = computeOwed(100000, { method: 'exact', amounts: { A: 60000, B: 40000, C: 0 } }, 'INR');
    expect(r.errors).toEqual([]);
    expect(r.owed).toEqual(shares('A', 60000, 'B', 40000));
  });

  it('reports what is left to assign', () => {
    const r = computeOwed(100000, { method: 'exact', amounts: { A: 60000, B: 36000 } }, 'INR');
    expect(r.errors).toEqual(['₹40.00 left to assign']);
    expect(r.owed).toEqual(shares('A', 60000, 'B', 36000));
  });

  it('reports amounts over the total', () => {
    const r = computeOwed(100000, { method: 'exact', amounts: { A: 60000, B: 41200 } }, 'INR');
    expect(r.errors).toEqual(['₹12.00 over the total']);
  });

  it('uses the currency in messages', () => {
    expect(computeOwed(5000, { method: 'exact', amounts: { A: 1000 } }, 'USD').errors).toEqual(['$40.00 left to assign']);
  });

  it('rejects negative amounts', () => {
    const r = computeOwed(1000, { method: 'exact', amounts: { A: 1500, B: -500 } }, 'INR');
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('computeOwed: percent', () => {
  it('allocates by percentage', () => {
    expect(owedMap(100000, { method: 'percent', percents: { A: 50, B: 25, C: 25 } })).toEqual({ A: 50000, B: 25000, C: 25000 });
    expect(owedMap(100000, { method: 'percent', percents: { A: 33.34, B: 33.33, C: 33.33 } })).toEqual({
      A: 33340,
      B: 33330,
      C: 33330,
    });
  });

  it('tolerates tiny rounding in the sum', () => {
    const r = computeOwed(1000, { method: 'percent', percents: { A: 33.3333, B: 33.3333, C: 33.3333 } }, 'INR');
    expect(r.errors).toEqual([]);
    expect(sumOwed(1000, { method: 'percent', percents: { A: 33.3333, B: 33.3333, C: 33.3333 } })).toBe(1000);
  });

  it('reports percentages left or over', () => {
    const under = computeOwed(100000, { method: 'percent', percents: { A: 50, B: 40 } }, 'INR');
    expect(under.errors).toEqual(['10% left to assign']);
    // Best effort: each person still sees their percent of the total.
    expect(under.owed).toEqual(shares('A', 50000, 'B', 40000));
    expect(computeOwed(100000, { method: 'percent', percents: { A: 60, B: 50 } }, 'INR').errors).toEqual(['10% over 100%']);
    expect(computeOwed(100000, { method: 'percent', percents: { A: 12.5, B: 50 } }, 'INR').errors).toEqual([
      '37.5% left to assign',
    ]);
  });

  it('needs at least one percentage', () => {
    expect(computeOwed(1000, { method: 'percent', percents: { A: 0 } }, 'INR').errors).toHaveLength(1);
    expect(computeOwed(1000, { method: 'percent', percents: {} }, 'INR').errors).toHaveLength(1);
  });

  it('rejects negative percentages', () => {
    const r = computeOwed(1000, { method: 'percent', percents: { A: 120, B: -20 } }, 'INR');
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('computeOwed: shares', () => {
  it('allocates by share weight', () => {
    expect(owedMap(30000, { method: 'shares', shares: { A: 2, B: 1 } })).toEqual({ A: 20000, B: 10000 });
    expect(owedMap(100, { method: 'shares', shares: { A: 1, B: 1, C: 1 } })).toEqual({ A: 34, B: 33, C: 33 });
    expect(owedMap(1000, { method: 'shares', shares: { A: 1.5, B: 0.5 } })).toEqual({ A: 750, B: 250 });
  });

  it('leaves out people with zero shares', () => {
    const r = computeOwed(1000, { method: 'shares', shares: { A: 1, B: 0 } }, 'INR');
    expect(r.errors).toEqual([]);
    expect(r.owed).toEqual(shares('A', 1000));
  });

  it('needs at least one positive share', () => {
    expect(computeOwed(1000, { method: 'shares', shares: { A: 0, B: 0 } }, 'INR').errors).toHaveLength(1);
  });
});

describe('computeOwed: adjustment', () => {
  it('splits the rest evenly, then adds adjustments', () => {
    const split: SplitInput = { method: 'adjustment', participantIds: ['A', 'B', 'C'], adjustments: { A: 10000 } };
    const r = computeOwed(100000, split, 'INR');
    expect(r.errors).toEqual([]);
    expect(r.owed).toEqual(shares('A', 40000, 'B', 30000, 'C', 30000));
  });

  it('handles negative adjustments and remainders', () => {
    const split: SplitInput = { method: 'adjustment', participantIds: ['A', 'B', 'C'], adjustments: { A: -6000 } };
    expect(owedMap(100000, split)).toEqual({ A: 29334, B: 35333, C: 35333 });
    expect(sumOwed(100000, split)).toBe(100000);
  });

  it('gives people outside the participants their adjustment', () => {
    const split: SplitInput = { method: 'adjustment', participantIds: ['A', 'B', 'C'], adjustments: { D: 10000 } };
    const r = computeOwed(100000, split, 'INR');
    expect(r.errors).toEqual([]);
    expect(r.owed).toEqual(shares('A', 30000, 'B', 30000, 'C', 30000, 'D', 10000));
  });

  it('errors when adjustments exceed the total', () => {
    const split: SplitInput = { method: 'adjustment', participantIds: ['A', 'B'], adjustments: { A: 120000 } };
    expect(computeOwed(100000, split, 'INR').errors).toEqual(['Adjustments are ₹200.00 more than the total']);
  });

  it('errors when an adjustment makes a share negative', () => {
    const split: SplitInput = { method: 'adjustment', participantIds: ['A', 'B', 'C'], adjustments: { A: -50000 } };
    expect(computeOwed(30000, split, 'INR').errors).toHaveLength(1);
  });
});

describe('computeOwed: itemized', () => {
  it('uses the per-person totals of the bill', () => {
    const r = computeOwed(145950, { method: 'itemized', bill: restaurantBill() }, 'INR');
    expect(r.errors).toEqual([]);
    expect(r.owed).toEqual(shares('A', 31500, 'B', 33600, 'C', 47250, 'D', 33600));
  });

  it('errors when the bill total differs from the expense total', () => {
    const r = computeOwed(146000, { method: 'itemized', bill: restaurantBill() }, 'INR');
    expect(r.errors).toEqual(['Items and charges add up to ₹1,459.50, not ₹1,460.00']);
  });

  it('passes on unassigned-item errors', () => {
    const bill = restaurantBill();
    bill.items[0] = { ...bill.items[0], shares: {} };
    const r = computeOwed(145950, { method: 'itemized', bill }, 'INR');
    expect(r.errors).toContain('Assign "Naan" to at least one person');
  });
});

describe('computeOwed: robustness', () => {
  it('never throws on malformed input', () => {
    const garbage = [
      { method: 'shares', shares: { A: NaN } },
      { method: 'percent', percents: { A: Infinity } },
      { method: 'exact', amounts: { A: 1.5 } },
      { method: 'equal' },
      { method: 'nope' },
      { method: 'itemized', bill: { items: [{ id: 'x', name: 'X', quantity: 1, amount: 100 }], charges: [] } },
    ] as unknown as SplitInput[];
    for (const split of garbage) {
      const r = computeOwed(1000, split, 'INR');
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects invalid totals', () => {
    expect(computeOwed(10.5, defaultSplit(['A']), 'INR').errors).toHaveLength(1);
    expect(computeOwed(-100, defaultSplit(['A']), 'INR').errors).toHaveLength(1);
  });
});

describe('labels and descriptions', () => {
  it('labels every method', () => {
    const expected: Record<SplitMethod, string> = {
      equal: 'Equally',
      exact: 'Exact amounts',
      percent: 'Percentages',
      shares: 'Shares',
      adjustment: 'Adjustment',
      itemized: 'Itemized',
    };
    (Object.keys(expected) as SplitMethod[]).forEach((m) => expect(splitMethodLabel(m)).toBe(expected[m]));
  });

  it('describes splits', () => {
    expect(describeSplit({ method: 'equal', participantIds: ['A', 'B', 'C', 'D'] })).toBe('Split equally among 4');
    expect(describeSplit({ method: 'equal', participantIds: [] })).toBe('No one selected');
    expect(describeSplit({ method: 'itemized', bill: restaurantBill() })).toBe('Itemized · 4 items');
    expect(describeSplit({ method: 'itemized', bill: { items: [restaurantBill().items[0]], charges: [] } })).toBe('Itemized · 1 item');
    expect(describeSplit({ method: 'exact', amounts: { A: 1, B: 2 } })).toBe('Exact amounts · 2 people');
    expect(describeSplit({ method: 'shares', shares: { A: 1 } })).toBe('Shares · 1 person');
  });
});

describe('defaultSplit / participantsOf', () => {
  it('defaults to equal among everyone', () => {
    expect(defaultSplit(['me', 'A', 'me'])).toEqual({ method: 'equal', participantIds: ['me', 'A'] });
  });

  it('lists participants for each method', () => {
    expect(participantsOf({ method: 'equal', participantIds: ['A', 'B'] })).toEqual(['A', 'B']);
    expect(participantsOf({ method: 'exact', amounts: { A: 1, B: 0 } })).toEqual(['A', 'B']);
    expect(participantsOf({ method: 'percent', percents: { C: 100 } })).toEqual(['C']);
    expect(participantsOf({ method: 'shares', shares: { A: 1, D: 2 } })).toEqual(['A', 'D']);
    expect(participantsOf({ method: 'adjustment', participantIds: ['A'], adjustments: { B: 5, A: 1 } })).toEqual(['A', 'B']);
    expect(participantsOf({ method: 'itemized', bill: restaurantBill() })).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('convertSplit', () => {
  const ids = ['A', 'B', 'C'];
  const equal: SplitInput = { method: 'equal', participantIds: ids };

  it('returns the same split for the same method', () => {
    expect(convertSplit(100000, equal, 'equal', ids, 'INR')).toBe(equal);
  });

  it('converts equal to the other methods', () => {
    expect(convertSplit(100000, equal, 'exact', ids, 'INR')).toEqual({ method: 'exact', amounts: { A: 33334, B: 33333, C: 33333 } });
    expect(convertSplit(100000, equal, 'percent', ids, 'INR')).toEqual({ method: 'percent', percents: { A: 33.34, B: 33.33, C: 33.33 } });
    expect(convertSplit(100000, equal, 'shares', ids, 'INR')).toEqual({ method: 'shares', shares: { A: 1, B: 1, C: 1 } });
    expect(convertSplit(100000, equal, 'adjustment', ids, 'INR')).toEqual({ method: 'adjustment', participantIds: ids, adjustments: {} });
    expect(convertSplit(100000, equal, 'itemized', ids, 'INR')).toEqual({ method: 'itemized', bill: { items: [], charges: [] } });
  });

  it('keeps the owed amounts for exact, shares and adjustment', () => {
    const from: SplitInput = { method: 'exact', amounts: { A: 50000, B: 30000, C: 20000 } };
    const before = owedMap(100000, from);
    for (const to of ['shares', 'adjustment', 'exact'] as SplitMethod[]) {
      const converted = convertSplit(100000, from, to, ids, 'INR');
      expect(converted.method).toBe(to);
      expect(computeOwed(100000, converted, 'INR').errors).toEqual([]);
      expect(owedMap(100000, converted)).toEqual(before);
    }
    expect(convertSplit(100000, from, 'shares', ids, 'INR')).toEqual({ method: 'shares', shares: { A: 5, B: 3, C: 2 } });
    expect(convertSplit(100000, from, 'adjustment', ids, 'INR')).toEqual({
      method: 'adjustment',
      participantIds: ids,
      adjustments: { A: 30000, B: 10000 },
    });
  });

  it('produces percentages that add up to 100', () => {
    const from: SplitInput = { method: 'shares', shares: { A: 2, B: 1, C: 0 } };
    const converted = convertSplit(90000, from, 'percent', ids, 'INR');
    expect(converted).toEqual({ method: 'percent', percents: { A: 66.67, B: 33.33, C: 0 } });
    expect(computeOwed(90000, converted, 'INR').errors).toEqual([]);
  });

  it('switches to equal among the people who owe something', () => {
    const from: SplitInput = { method: 'shares', shares: { A: 1, B: 1, C: 0 } };
    expect(convertSplit(1000, from, 'equal', ids, 'INR')).toEqual({ method: 'equal', participantIds: ['A', 'B'] });
  });

  it('keeps an itemized bill and converts it to amounts', () => {
    const itemized: SplitInput = { method: 'itemized', bill: restaurantBill() };
    expect(convertSplit(145950, equal, 'itemized', ids, 'INR')).toEqual({ method: 'itemized', bill: { items: [], charges: [] } });
    const exact = convertSplit(145950, itemized, 'exact', ['A', 'B', 'C', 'D'], 'INR');
    expect(exact).toEqual({ method: 'exact', amounts: { A: 31500, B: 33600, C: 47250, D: 33600 } });
  });

  it('falls back to defaults when the current split is invalid', () => {
    const invalid: SplitInput = { method: 'exact', amounts: { A: 100 } };
    expect(convertSplit(1000, invalid, 'shares', ids, 'INR')).toEqual({ method: 'shares', shares: { A: 1, B: 1, C: 1 } });
    expect(convertSplit(1000, invalid, 'equal', ids, 'INR')).toEqual({ method: 'equal', participantIds: ids });
    expect(convertSplit(0, equal, 'exact', ids, 'INR')).toEqual({ method: 'exact', amounts: { A: 0, B: 0, C: 0 } });
  });
});

describe('validatePayers', () => {
  it('accepts payers that cover the total', () => {
    expect(validatePayers(100000, shares('me', 100000), 'INR')).toEqual([]);
    expect(validatePayers(100000, shares('A', 60000, 'B', 40000), 'INR')).toEqual([]);
  });

  it('requires a payer and a positive total', () => {
    expect(validatePayers(100000, [], 'INR')).toEqual(['Choose who paid']);
    expect(validatePayers(0, shares('me', 0), 'INR')).toEqual(['Enter an amount greater than zero']);
  });

  it('reports shortfalls and excess with amounts', () => {
    expect(validatePayers(100000, shares('A', 60000, 'B', 36000), 'INR')).toEqual([
      "The payers' amounts are ₹40.00 short of the total",
    ]);
    expect(validatePayers(100000, shares('A', 60000, 'B', 41200), 'INR')).toEqual([
      "The payers' amounts are ₹12.00 over the total",
    ]);
  });

  it('rejects zero amounts and duplicate payers', () => {
    expect(validatePayers(100000, shares('A', 100000, 'B', 0), 'INR')).toEqual(['Each payer must pay more than zero']);
    expect(validatePayers(100000, shares('A', 50000, 'A', 50000), 'INR')).toEqual([
      'Each person can be listed only once as a payer',
    ]);
  });
});
