import { simplifyDebts } from '../../app/src/lib/simplify';
import { applyDebts } from './helpers';

function allZero(nets: Record<string, number>): boolean {
  return Object.keys(nets).every((k) => nets[k] === 0);
}

describe('simplifyDebts', () => {
  it('returns nothing when everyone is settled', () => {
    expect(simplifyDebts({}, 'INR')).toEqual([]);
    expect(simplifyDebts({ A: 0, B: 0 }, 'INR')).toEqual([]);
  });

  it('settles two people with one transfer', () => {
    expect(simplifyDebts({ A: 500, B: -500 }, 'INR')).toEqual([{ fromId: 'B', toId: 'A', amount: 500, currency: 'INR' }]);
  });

  it('matches the largest debtor with the largest creditor', () => {
    expect(simplifyDebts({ A: 500, B: -300, C: -200 }, 'USD')).toEqual([
      { fromId: 'B', toId: 'A', amount: 300, currency: 'USD' },
      { fromId: 'C', toId: 'A', amount: 200, currency: 'USD' },
    ]);
    expect(simplifyDebts({ A: 700, B: 300, C: -600, D: -400 }, 'INR')).toEqual([
      { fromId: 'C', toId: 'A', amount: 600, currency: 'INR' },
      { fromId: 'D', toId: 'B', amount: 300, currency: 'INR' },
      { fromId: 'D', toId: 'A', amount: 100, currency: 'INR' },
    ]);
  });

  it('breaks ties by id, whatever the input order', () => {
    const expected = [
      { fromId: 'C', toId: 'A', amount: 100, currency: 'INR' },
      { fromId: 'D', toId: 'B', amount: 100, currency: 'INR' },
    ];
    expect(simplifyDebts({ A: 100, B: 100, C: -100, D: -100 }, 'INR')).toEqual(expected);
    expect(simplifyDebts({ D: -100, B: 100, C: -100, A: 100 }, 'INR')).toEqual(expected);
  });

  it('turns a chain of debts into a single transfer', () => {
    // B owes A 100, C owes B 100 → nets A +100, B 0, C −100.
    expect(simplifyDebts({ A: 10000, B: 0, C: -10000 }, 'INR')).toEqual([
      { fromId: 'C', toId: 'A', amount: 10000, currency: 'INR' },
    ]);
  });

  it('preserves every net and needs at most n − 1 transfers', () => {
    const nets = { A: 31511, B: -12000, C: 4489, D: -9000, E: -15000, F: 0 };
    const debts = simplifyDebts(nets, 'INR');
    expect(allZero(applyDebts(nets, debts))).toBe(true);
    expect(debts.length).toBeLessThanOrEqual(4);
    for (const d of debts) {
      expect(d.amount).toBeGreaterThan(0);
      expect(d.fromId).not.toBe(d.toId);
    }
  });

  it('does not loop forever when nets do not balance', () => {
    const debts = simplifyDebts({ A: 500, B: -300 }, 'INR');
    expect(debts).toEqual([{ fromId: 'B', toId: 'A', amount: 300, currency: 'INR' }]);
  });
});
