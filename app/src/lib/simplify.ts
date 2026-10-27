import type { CurrencyCode, Debt, ID, Minor } from '../types';

interface Party {
  id: ID;
  amount: Minor;
}

/** Largest amount first; equal amounts → smaller id, so results never depend on input order. */
function largestIndex(parties: Party[]): number {
  let best = 0;
  for (let i = 1; i < parties.length; i++) {
    const p = parties[i];
    const b = parties[best];
    if (p.amount > b.amount || (p.amount === b.amount && p.id < b.id)) best = i;
  }
  return best;
}

/** Minimum-ish set of transfers that settles `nets` (Σ nets must be 0; ignores zero entries).
 *  Greedy: repeatedly match largest debtor with largest creditor; ties by id for determinism.
 *  Every step settles at least one person, so n people need at most n − 1 transfers.
 *  If Σ nets ≠ 0 the leftover on the larger side is simply left unsettled. */
export function simplifyDebts(nets: Record<ID, Minor>, currency: CurrencyCode): Debt[] {
  const creditors: Party[] = [];
  const debtors: Party[] = [];
  for (const id of Object.keys(nets)) {
    const v = nets[id];
    if (!Number.isFinite(v) || v === 0) continue;
    if (v > 0) creditors.push({ id, amount: v });
    else debtors.push({ id, amount: -v });
  }

  const debts: Debt[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    const ci = largestIndex(creditors);
    const di = largestIndex(debtors);
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amount, debtor.amount);
    debts.push({ fromId: debtor.id, toId: creditor.id, amount, currency });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditors.splice(ci, 1);
    if (debtor.amount === 0) debtors.splice(di, 1);
  }
  return debts;
}
