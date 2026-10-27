// Item-by-item bill splitting: each item is shared by any subset of people (optionally in
// unequal portions), then tax / service / tip / discount / round-off charges are spread
// over the people who had items. Every split uses allocate(), so totals are exact.
import type { BillCharge, BillItem, ChargeKind, ID, ItemizedBill, Minor } from '../types';
import { allocate } from './money';
import { newId } from './ids';

export interface PersonItemLine {
  itemId: ID;
  name: string;
  amount: Minor;
  /** Reduced fraction of the item this person had, e.g. '1/4', '1/3'. */
  portion: string;
}

export interface PersonBreakdown {
  personId: ID;
  itemsSubtotal: Minor;
  charges: Minor;
  total: Minor;
  lines: PersonItemLine[];
  chargeLines: { chargeId: ID; label: string; amount: Minor }[];
}

export interface ItemizedResult {
  /** Σ items + Σ charges. */
  total: Minor;
  itemsSubtotal: Minor;
  chargesTotal: Minor;
  /** Only people with a non-zero total, ordered by first appearance. */
  perPerson: PersonBreakdown[];
  /** Items with no shares (their amount is NOT allocated). */
  unassignedItemIds: ID[];
  errors: string[];
}

/** Amounts come from user input and storage; treat anything non-integer defensively. */
function safeMinor(v: number): Minor {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

function isPortion(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
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

function trimNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function formatPortion(portion: number, totalPortions: number): string {
  if (Number.isInteger(portion) && Number.isInteger(totalPortions)) {
    const g = gcd(portion, totalPortions) || 1;
    return `${portion / g}/${totalPortions / g}`;
  }
  return `${trimNumber(portion)}/${trimNumber(totalPortions)}`;
}

function itemLabel(item: BillItem): string {
  return item.name && item.name.trim() ? item.name.trim() : 'Untitled item';
}

/** People sharing an item (positive portions), in key order of `shares`. */
function sharersOf(item: BillItem): ID[] {
  const shares = item.shares ?? {};
  return Object.keys(shares).filter((id) => id && isPortion(shares[id]));
}

/**
 * allocate() gives tied leftover paise to the lowest index, so with the same people on every
 * item the first sharer would collect every spare paisa of a long bill (5 people, 7 items: one
 * pays $6.66, another $6.60). Here ties go to whoever has been rounded up least so far (for a
 * negative amount, the credit goes to whoever has been rounded up most), which keeps everyone
 * within about a paisa of their exact share. `drift` (paid − exact, per person) is updated.
 */
function fairAllocate(amount: Minor, ids: ID[], weights: number[], drift: Map<ID, number>): Minor[] {
  const driftOf = (i: number) => Math.round((drift.get(ids[i]) ?? 0) * 1e6);
  const direction = amount < 0 ? -1 : 1;
  const order = ids.map((_, i) => i).sort((a, b) => direction * (driftOf(a) - driftOf(b)) || a - b);
  const sorted = allocate(amount, order.map((i) => weights[i]));
  const parts: Minor[] = ids.map(() => 0);
  order.forEach((i, k) => {
    parts[i] = sorted[k];
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  ids.forEach((id, i) => drift.set(id, (drift.get(id) ?? 0) + parts[i] - (amount * weights[i]) / weightSum));
  return parts;
}

export function computeItemized(bill: ItemizedBill): ItemizedResult {
  const items = bill?.items ?? [];
  const charges = bill?.charges ?? [];
  const errors: string[] = [];
  const unassignedItemIds: ID[] = [];
  const order: ID[] = [];
  const byPerson = new Map<ID, PersonBreakdown>();
  const drift = new Map<ID, number>();

  const personFor = (id: ID): PersonBreakdown => {
    let p = byPerson.get(id);
    if (!p) {
      p = { personId: id, itemsSubtotal: 0, charges: 0, total: 0, lines: [], chargeLines: [] };
      byPerson.set(id, p);
      order.push(id);
    }
    return p;
  };

  if (items.length === 0) errors.push('Add at least one item');

  let itemsSubtotal = 0;
  for (const item of items) {
    const amount = safeMinor(item.amount);
    if (amount !== item.amount) errors.push(`"${itemLabel(item)}" has an invalid amount`);
    itemsSubtotal += amount;

    const sharers = sharersOf(item);
    if (sharers.length === 0) {
      unassignedItemIds.push(item.id);
      errors.push(`Assign "${itemLabel(item)}" to at least one person`);
      continue;
    }
    const portions = sharers.map((id) => item.shares[id]);
    const totalPortions = portions.reduce((a, b) => a + b, 0);
    const parts = fairAllocate(amount, sharers, portions, drift);
    sharers.forEach((id, i) => {
      const p = personFor(id);
      p.itemsSubtotal += parts[i];
      p.lines.push({ itemId: item.id, name: item.name, amount: parts[i], portion: formatPortion(portions[i], totalPortions) });
    });
  }

  // Charges go to people who actually have items: proportional to their item subtotal, or equally.
  const withItems = order.filter((id) => byPerson.get(id)!.itemsSubtotal !== 0);
  const positive = withItems.filter((id) => byPerson.get(id)!.itemsSubtotal > 0);
  let chargesTotal = 0;
  let chargesUnallocated = false;
  for (const charge of charges) {
    const amount = safeMinor(charge.amount);
    if (amount !== charge.amount) errors.push(`"${charge.label || 'Charge'}" has an invalid amount`);
    chargesTotal += amount;
    if (amount === 0) continue;
    if (withItems.length === 0) {
      chargesUnallocated = true;
      continue;
    }
    // Proportional needs a positive subtotal to weigh by; otherwise fall back to equal.
    const proportional = charge.allocation !== 'equal' && positive.length > 0;
    const ids = proportional ? positive : withItems;
    const weights = proportional ? ids.map((id) => byPerson.get(id)!.itemsSubtotal) : ids.map(() => 1);
    const parts = fairAllocate(amount, ids, weights, drift);
    ids.forEach((id, i) => {
      if (parts[i] === 0) return;
      const p = byPerson.get(id)!;
      p.charges += parts[i];
      p.chargeLines.push({ chargeId: charge.id, label: charge.label, amount: parts[i] });
    });
  }
  if (chargesUnallocated && items.length > 0 && unassignedItemIds.length === 0) {
    errors.push('Assign items to people before splitting tax and charges');
  }

  const perPerson = order
    .map((id) => {
      const p = byPerson.get(id)!;
      p.total = p.itemsSubtotal + p.charges;
      return p;
    })
    .filter((p) => p.total !== 0);

  const total = itemsSubtotal + chargesTotal;
  if (total < 0) errors.push("The bill total can't be negative");
  else if (perPerson.some((p) => p.total < 0)) errors.push("A discount makes someone's share negative");

  return { total, itemsSubtotal, chargesTotal, perPerson, unassignedItemIds, errors };
}

/** Σ item amounts + Σ charge amounts. */
export function itemizedTotal(bill: ItemizedBill): Minor {
  let total = 0;
  for (const item of bill?.items ?? []) total += safeMinor(item.amount);
  for (const charge of bill?.charges ?? []) total += safeMinor(charge.amount);
  return total;
}

export function newBillItem(name: string, amount: Minor, quantity: number = 1, shares: Record<ID, number> = {}): BillItem {
  return { id: newId('itm'), name, quantity, amount, shares: { ...shares } };
}

export function newBillCharge(kind: ChargeKind, label: string, amount: Minor): BillCharge {
  return { id: newId('chg'), kind, label, amount, allocation: 'proportional' };
}

/** Set an item to be shared equally by exactly `personIds` (1 portion each). */
export function assignEqually(item: BillItem, personIds: ID[]): BillItem {
  const shares: Record<ID, number> = {};
  for (const id of personIds) {
    if (id) shares[id] = 1;
  }
  return { ...item, shares };
}

/** Toggle a person on/off an item (on = 1 portion). */
export function togglePerson(item: BillItem, personId: ID): BillItem {
  const current = item.shares ?? {};
  if (isPortion(current[personId])) return setPortions(item, personId, 0);
  return setPortions(item, personId, 1);
}

/** Set a person's portions on an item (0 removes them). */
export function setPortions(item: BillItem, personId: ID, portions: number): BillItem {
  const shares: Record<ID, number> = { ...(item.shares ?? {}) };
  if (isPortion(portions)) shares[personId] = portions;
  else delete shares[personId];
  return { ...item, shares };
}

/** Assign every unassigned item to all `personIds`. */
export function assignUnassignedToAll(bill: ItemizedBill, personIds: ID[]): ItemizedBill {
  return {
    ...bill,
    items: bill.items.map((item) => (sharersOf(item).length === 0 ? assignEqually(item, personIds) : item)),
  };
}
