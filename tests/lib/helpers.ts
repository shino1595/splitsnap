// Shared builders for the engine tests (not a test file itself).
import type { Expense, ID, MoneyShare, Payment, SplitInput } from '../../app/src/types';

let counter = 0;

export function makeExpense(args: {
  payers: MoneyShare[];
  owed: MoneyShare[];
  currency?: string;
  date?: string;
  description?: string;
  deleted?: boolean;
  id?: ID;
  groupId?: ID | null;
  split?: SplitInput;
}): Expense {
  counter += 1;
  const total = args.payers.reduce((s, p) => s + p.amount, 0);
  return {
    id: args.id ?? `exp_${counter}`,
    groupId: args.groupId ?? null,
    description: args.description ?? `Expense ${counter}`,
    category: 'general',
    currency: args.currency ?? 'INR',
    total,
    date: args.date ?? '2026-10-01',
    payers: args.payers,
    split: args.split ?? { method: 'exact', amounts: {} },
    owed: args.owed,
    comments: [],
    createdBy: 'me',
    createdAt: `2026-10-01T10:00:${String(counter % 60).padStart(2, '0')}.000Z`,
    updatedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: args.deleted ? '2026-10-02T10:00:00.000Z' : undefined,
  };
}

export function makePayment(args: {
  fromId: ID;
  toId: ID;
  amount: number;
  currency?: string;
  date?: string;
  deleted?: boolean;
}): Payment {
  counter += 1;
  return {
    id: `pay_${counter}`,
    groupId: null,
    fromId: args.fromId,
    toId: args.toId,
    amount: args.amount,
    currency: args.currency ?? 'INR',
    date: args.date ?? '2026-10-01',
    method: 'cash',
    createdAt: '2026-10-01T12:00:00.000Z',
    deletedAt: args.deleted ? '2026-10-02T10:00:00.000Z' : undefined,
  };
}

/** Shorthand: shares('A', 100, 'B', 200) → [{A,100},{B,200}]. */
export function shares(...pairs: (string | number)[]): MoneyShare[] {
  const out: MoneyShare[] = [];
  for (let i = 0; i < pairs.length; i += 2) out.push({ personId: String(pairs[i]), amount: Number(pairs[i + 1]) });
  return out;
}

/** Deterministic pseudo-random numbers (Numerical Recipes LCG), so property tests are repeatable. */
export function lcg(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    /** Float in [0, 1). */
    next,
    /** Integer in [min, max]. */
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick<T>(items: T[]): T {
      return items[Math.floor(next() * items.length)];
    },
    bool(probability = 0.5): boolean {
      return next() < probability;
    },
  };
}

/** Applies transfers to nets: after settling every debt, everyone should be at zero. */
export function applyDebts(nets: Record<string, number>, debts: { fromId: string; toId: string; amount: number }[]): Record<string, number> {
  const out: Record<string, number> = { ...nets };
  for (const d of debts) {
    out[d.fromId] = (out[d.fromId] ?? 0) + d.amount;
    out[d.toId] = (out[d.toId] ?? 0) - d.amount;
  }
  return out;
}
