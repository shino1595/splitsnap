// Turns the user's split input (equally, exact, percentages, shares, adjustment,
// itemized) into exact owed amounts that always add up to the expense total.
import type { CurrencyCode, ID, Minor, MoneyShare, SplitInput, SplitMethod } from '../types';
import { allocate, formatMoney, splitEvenly } from './money';
import { computeItemized } from './itemized';

/** owed omits zero entries; errors is empty when the split is valid. */
export interface SplitResult {
  owed: MoneyShare[];
  errors: string[];
}

const PERCENT_TOLERANCE = 0.001;

type Entry = [ID, number];

/** Drops empty ids and duplicates, keeping first-seen order. */
function uniqueIds(ids: ID[] | undefined): ID[] {
  const seen = new Set<ID>();
  const out: ID[] = [];
  for (const id of ids ?? []) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function entriesOf(record: Record<ID, number> | undefined): Entry[] {
  const r = record ?? {};
  return Object.keys(r)
    .filter((id) => !!id)
    .map((id): Entry => [id, r[id]]);
}

function toShares(entries: Entry[]): MoneyShare[] {
  return entries.filter(([, amount]) => amount !== 0).map(([personId, amount]) => ({ personId, amount }));
}

/** 12.5 → '12.5', 33.3333 → '33.333'. */
function formatPercent(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function differenceMessage(diff: Minor, currency: CurrencyCode): string | null {
  if (diff > 0) return `${formatMoney(diff, currency)} left to assign`;
  if (diff < 0) return `${formatMoney(-diff, currency)} over the total`;
  return null;
}

/** Non-negative finite weights; invalid values count as 0 and are reported once. */
function cleanWeights(entries: Entry[], errors: string[], message: string): Entry[] {
  let invalid = false;
  const out = entries.map(([id, v]): Entry => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      invalid = true;
      return [id, 0];
    }
    return [id, v];
  });
  if (invalid) errors.push(message);
  return out;
}

function computeEntries(total: Minor, split: SplitInput, currency: CurrencyCode, errors: string[]): Entry[] {
  switch (split.method) {
    case 'equal': {
      const ids = uniqueIds(split.participantIds);
      if (ids.length === 0) {
        errors.push('Choose at least one person to split with');
        return [];
      }
      const parts = splitEvenly(total, ids.length);
      return ids.map((id, i): Entry => [id, parts[i]]);
    }

    case 'exact': {
      let invalid = false;
      const entries = entriesOf(split.amounts).map(([id, v]): Entry => {
        if (!Number.isInteger(v) || v < 0) {
          invalid = true;
          return [id, Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0];
        }
        return [id, v];
      });
      if (invalid) errors.push("Amounts can't be negative");
      const assigned = entries.reduce((sum, [, v]) => sum + v, 0);
      const message = differenceMessage(total - assigned, currency);
      if (message) errors.push(message);
      return entries;
    }

    case 'percent': {
      const entries = cleanWeights(entriesOf(split.percents), errors, "Percentages can't be negative");
      const sum = entries.reduce((s, [, v]) => s + v, 0);
      if (!(sum > 0)) {
        errors.push('Enter a percentage for at least one person');
        return [];
      }
      const diff = 100 - sum;
      let target = total;
      if (Math.abs(diff) > PERCENT_TOLERANCE) {
        errors.push(diff > 0 ? `${formatPercent(diff)}% left to assign` : `${formatPercent(-diff)}% over 100%`);
        // Best effort for live previews: each person still gets their percent of the total.
        target = Math.round((total * sum) / 100);
      }
      const parts = allocate(target, entries.map(([, v]) => v));
      return entries.map(([id], i): Entry => [id, parts[i]]);
    }

    case 'shares': {
      const entries = cleanWeights(entriesOf(split.shares), errors, "Shares can't be negative");
      if (!entries.some(([, v]) => v > 0)) {
        errors.push('Give at least one person a share');
        return [];
      }
      const parts = allocate(total, entries.map(([, v]) => v));
      return entries.map(([id], i): Entry => [id, parts[i]]);
    }

    case 'adjustment': {
      const ids = uniqueIds(split.participantIds);
      let invalid = false;
      const adjustments = entriesOf(split.adjustments).map(([id, v]): Entry => {
        if (!Number.isInteger(v)) {
          invalid = true;
          return [id, Number.isFinite(v) ? Math.round(v) : 0];
        }
        return [id, v];
      });
      if (invalid) errors.push('Adjustments must be valid amounts');
      const base = total - adjustments.reduce((s, [, v]) => s + v, 0);
      if (base < 0) errors.push(`Adjustments are ${formatMoney(-base, currency)} more than the total`);

      const owed = new Map<ID, Minor>();
      if (ids.length > 0) {
        const parts = splitEvenly(base, ids.length);
        ids.forEach((id, i) => owed.set(id, parts[i]));
      } else if (base !== 0) {
        errors.push('Choose at least one person to split with');
      }
      // People with an adjustment but not in participantIds still get their adjustment.
      for (const [id, v] of adjustments) owed.set(id, (owed.get(id) ?? 0) + v);

      const entries = Array.from(owed.entries());
      if (base >= 0 && entries.some(([, v]) => v < 0)) errors.push("An adjustment makes someone's share negative");
      return entries;
    }

    case 'itemized': {
      const result = computeItemized(split.bill);
      errors.push(...result.errors);
      if (result.total !== total) {
        errors.push(
          `Items and charges add up to ${formatMoney(result.total, currency)}, not ${formatMoney(total, currency)}`,
        );
      }
      return result.perPerson.map((p): Entry => [p.personId, p.total]);
    }

    default:
      errors.push('Unknown split method');
      return [];
  }
}

/** Turns a SplitInput into exact owed amounts that sum to `total`. Never throws; invalid input → errors (and best-effort owed). */
export function computeOwed(total: Minor, split: SplitInput, currency: CurrencyCode): SplitResult {
  if (!Number.isInteger(total)) return { owed: [], errors: ['The total is not a valid amount'] };
  if (total < 0) return { owed: [], errors: ["The total can't be negative"] };
  const errors: string[] = [];
  try {
    const entries = computeEntries(total, split, currency, errors);
    return { owed: toShares(entries), errors };
  } catch {
    // Only reachable with malformed stored data; keep the UI alive.
    return { owed: [], errors: [...errors, 'This split could not be calculated'] };
  }
}

const METHOD_LABELS: Record<SplitMethod, string> = {
  equal: 'Equally',
  exact: 'Exact amounts',
  percent: 'Percentages',
  shares: 'Shares',
  adjustment: 'Adjustment',
  itemized: 'Itemized',
};

export function splitMethodLabel(method: SplitMethod): string {
  return METHOD_LABELS[method] ?? 'Equally';
}

function countPeople(n: number): string {
  return n === 1 ? '1 person' : `${n} people`;
}

/** Short human summary, e.g. 'Split equally among 4', 'Itemized · 5 items'. */
export function describeSplit(split: SplitInput): string {
  switch (split.method) {
    case 'equal': {
      const n = uniqueIds(split.participantIds).length;
      return n === 0 ? 'No one selected' : `Split equally among ${n}`;
    }
    case 'itemized': {
      const n = split.bill?.items?.length ?? 0;
      return `Itemized · ${n === 1 ? '1 item' : `${n} items`}`;
    }
    default:
      return `${splitMethodLabel(split.method)} · ${countPeople(participantsOf(split).length)}`;
  }
}

/** Default split for a participant list: equal among everyone. */
export function defaultSplit(participantIds: ID[]): SplitInput {
  return { method: 'equal', participantIds: uniqueIds(participantIds) };
}

/** Everyone the split mentions, in first-seen order. */
export function participantsOf(split: SplitInput): ID[] {
  switch (split.method) {
    case 'equal':
      return uniqueIds(split.participantIds);
    case 'exact':
      return uniqueIds(Object.keys(split.amounts ?? {}));
    case 'percent':
      return uniqueIds(Object.keys(split.percents ?? {}));
    case 'shares':
      return uniqueIds(Object.keys(split.shares ?? {}));
    case 'adjustment':
      return uniqueIds([...(split.participantIds ?? []), ...Object.keys(split.adjustments ?? {})]);
    case 'itemized': {
      const ids: ID[] = [];
      for (const item of split.bill?.items ?? []) ids.push(...Object.keys(item.shares ?? {}));
      return uniqueIds(ids);
    }
    default:
      return [];
  }
}

/** Percent values (2 decimals) that add up to exactly 100.00, proportional to `weights`. */
function percentsFor(weights: number[]): number[] {
  return allocate(10000, weights).map((bp) => bp / 100);
}

/** True when the amounts are an even split (they differ by at most one minor unit). */
function isEvenSplit(amounts: Minor[]): boolean {
  return amounts.length > 0 && Math.max(...amounts) - Math.min(...amounts) <= 1;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function defaultFor(total: Minor, from: SplitInput, to: SplitMethod, ids: ID[]): SplitInput {
  const ones = ids.map(() => 1);
  switch (to) {
    case 'equal':
      return { method: 'equal', participantIds: ids };
    case 'exact': {
      const parts = ids.length > 0 && total > 0 ? splitEvenly(total, ids.length) : ids.map(() => 0);
      const amounts: Record<ID, Minor> = {};
      ids.forEach((id, i) => (amounts[id] = parts[i]));
      return { method: 'exact', amounts };
    }
    case 'percent': {
      const pcts = ids.length > 0 ? percentsFor(ones) : [];
      const percents: Record<ID, number> = {};
      ids.forEach((id, i) => (percents[id] = pcts[i]));
      return { method: 'percent', percents };
    }
    case 'shares': {
      const shares: Record<ID, number> = {};
      ids.forEach((id) => (shares[id] = 1));
      return { method: 'shares', shares };
    }
    case 'adjustment':
      return { method: 'adjustment', participantIds: ids, adjustments: {} };
    case 'itemized':
    default:
      return { method: 'itemized', bill: from.method === 'itemized' ? from.bill : { items: [], charges: [] } };
  }
}

/** Convert the current split into another method for the same participants, keeping the
 *  same owed amounts where possible (used when switching tabs in SplitOptions).
 *  Switching to 'itemized' keeps an existing bill, otherwise starts an empty one. */
export function convertSplit(
  total: Minor,
  from: SplitInput,
  to: SplitMethod,
  participantIds: ID[],
  currency: CurrencyCode,
): SplitInput {
  if (from.method === to) return from;
  const ids = uniqueIds(participantIds);
  if (to === 'itemized') return defaultFor(total, from, to, ids);

  const { owed, errors } = computeOwed(total, from, currency);
  if (errors.length > 0 || total <= 0 || owed.length === 0) return defaultFor(total, from, to, ids);

  const owedBy = new Map<ID, Minor>();
  owed.forEach((s) => owedBy.set(s.personId, s.amount));
  // Participants first (zeros included so the editor shows them), then anyone else who owes.
  const everyone = uniqueIds([...ids, ...owed.map((s) => s.personId)]);
  const amounts = everyone.map((id) => owedBy.get(id) ?? 0);
  const involved = everyone.filter((id) => (owedBy.get(id) ?? 0) !== 0);
  const involvedAmounts = involved.map((id) => owedBy.get(id)!);

  switch (to) {
    case 'equal':
      return { method: 'equal', participantIds: involved.length > 0 ? involved : ids };

    case 'exact': {
      const record: Record<ID, Minor> = {};
      everyone.forEach((id, i) => (record[id] = amounts[i]));
      return { method: 'exact', amounts: record };
    }

    case 'percent': {
      if (amounts.some((a) => a < 0)) return defaultFor(total, from, to, ids);
      const pcts = percentsFor(amounts);
      const percents: Record<ID, number> = {};
      everyone.forEach((id, i) => (percents[id] = pcts[i]));
      return { method: 'percent', percents };
    }

    case 'shares': {
      if (amounts.some((a) => a < 0)) return defaultFor(total, from, to, ids);
      const shares: Record<ID, number> = {};
      if (isEvenSplit(involvedAmounts)) {
        everyone.forEach((id) => (shares[id] = (owedBy.get(id) ?? 0) !== 0 ? 1 : 0));
      } else {
        // Reduced integer shares reproduce the owed amounts exactly (e.g. 200/100 → 2/1).
        const g = involvedAmounts.reduce((acc, a) => gcd(acc, a), 0) || 1;
        everyone.forEach((id, i) => (shares[id] = amounts[i] / g));
      }
      return { method: 'shares', shares };
    }

    case 'adjustment': {
      // With n participants and base = n × min(owed), each adjustment is owed − min(owed),
      // which reproduces the current amounts exactly.
      const pids = ids.length > 0 ? ids : involved;
      const adjustments: Record<ID, Minor> = {};
      const even = pids.length > 0 ? splitEvenly(total, pids.length) : [];
      const alreadyEven = pids.every((id, i) => (owedBy.get(id) ?? 0) === even[i]) &&
        involved.every((id) => pids.indexOf(id) >= 0);
      if (!alreadyEven && pids.length > 0) {
        const min = Math.min(...pids.map((id) => owedBy.get(id) ?? 0));
        everyone.forEach((id, i) => {
          const adj = pids.indexOf(id) >= 0 ? amounts[i] - min : amounts[i];
          if (adj !== 0) adjustments[id] = adj;
        });
      }
      return { method: 'adjustment', participantIds: pids, adjustments };
    }

    default:
      return defaultFor(total, from, to, ids);
  }
}

/** Validates payers: non-empty, positive amounts, sum == total. Returns error strings. */
export function validatePayers(total: Minor, payers: MoneyShare[], currency: CurrencyCode): string[] {
  if (!Number.isInteger(total) || total <= 0) return ['Enter an amount greater than zero'];
  if (!payers || payers.length === 0) return ['Choose who paid'];
  const errors: string[] = [];
  if (payers.some((p) => !Number.isInteger(p.amount) || p.amount <= 0)) {
    errors.push('Each payer must pay more than zero');
  }
  const ids = payers.map((p) => p.personId);
  if (new Set(ids).size !== ids.length) errors.push('Each person can be listed only once as a payer');
  const paid = payers.reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  const diff = total - paid;
  if (diff > 0) errors.push(`The payers' amounts are ${formatMoney(diff, currency)} short of the total`);
  else if (diff < 0) errors.push(`The payers' amounts are ${formatMoney(-diff, currency)} over the total`);
  return errors;
}
