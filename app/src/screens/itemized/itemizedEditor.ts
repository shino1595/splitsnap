// Pure state logic for the item-by-item split editor (no React, so it can be unit-tested).
import type { BillCharge, BillItem, ChargeKind, CurrencyCode, ID, ItemizedBill, Minor, SplitInput } from '../../types';
import { allocate, formatMoney, parseAmountInput } from '../../lib/money';
import { computeItemized, newBillCharge, newBillItem } from '../../lib/itemized';
import type { ItemizedResult, PersonItemLine } from '../../lib/itemized';

// ---------- Bills ----------

export function emptyBill(): ItemizedBill {
  return { items: [], charges: [] };
}

/** A deep copy of the draft's bill, or an empty bill when the split is not itemized. */
export function billFromSplit(split: SplitInput): ItemizedBill {
  if (split.method !== 'itemized') return emptyBill();
  return JSON.parse(JSON.stringify(split.bill)) as ItemizedBill;
}

export function sameBill(a: ItemizedBill, b: ItemizedBill): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function updateItemIn(bill: ItemizedBill, itemId: ID, update: (item: BillItem) => BillItem): ItemizedBill {
  return { ...bill, items: bill.items.map((item) => (item.id === itemId ? update(item) : item)) };
}

export function removeItemFrom(bill: ItemizedBill, itemId: ID): ItemizedBill {
  return { ...bill, items: bill.items.filter((item) => item.id !== itemId) };
}

export function updateChargeIn(bill: ItemizedBill, chargeId: ID, update: (charge: BillCharge) => BillCharge): ItemizedBill {
  return { ...bill, charges: bill.charges.map((charge) => (charge.id === chargeId ? update(charge) : charge)) };
}

export function removeChargeFrom(bill: ItemizedBill, chargeId: ID): ItemizedBill {
  return { ...bill, charges: bill.charges.filter((charge) => charge.id !== chargeId) };
}

// ---------- Names ----------

export function firstName(name: string): string {
  const word = name.trim().split(/\s+/)[0];
  return word || name.trim() || '?';
}

/** Short labels for chips: first names, or the full name where two people share a first name. */
export function displayNames(people: { id: ID; name: string }[]): Record<ID, string> {
  const counts: Record<string, number> = {};
  for (const p of people) {
    const key = firstName(p.name).toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const out: Record<ID, string> = {};
  for (const p of people) {
    const first = firstName(p.name);
    out[p.id] = counts[first.toLowerCase()] > 1 ? p.name.trim() : first;
  }
  return out;
}

// ---------- Item sharing ----------

export interface ItemShare {
  personId: ID;
  portions: number;
  amount: Minor;
}

/** People on an item with positive portions, in the same order computeItemized uses. */
export function sharersOf(item: BillItem): ID[] {
  const shares = item.shares ?? {};
  return Object.keys(shares).filter((id) => {
    const v = shares[id];
    return !!id && typeof v === 'number' && Number.isFinite(v) && v > 0;
  });
}

/**
 * Each sharer's exact part of the item (largest remainder, so the parts add up to the amount).
 * `amounts` are the parts the whole-bill split gave this item (BillSummary.itemAmounts); when
 * they cover every sharer they are used, so a card never differs by a paisa from the totals.
 */
export function itemShares(item: BillItem, amounts?: Record<ID, Minor>): ItemShare[] {
  const ids = sharersOf(item);
  if (ids.length === 0 || !Number.isInteger(item.amount)) return [];
  const portions = ids.map((id) => item.shares[id]);
  const known = amounts && ids.every((id) => typeof amounts[id] === 'number') ? amounts : null;
  const parts = known ? ids.map((id) => known[id]) : allocate(item.amount, portions);
  return ids.map((personId, i) => ({ personId, portions: portions[i], amount: parts[i] }));
}

/** The hint above an item's portion steppers. A quantity that the portions don't add up to is flagged. */
export function portionsHint(item: BillItem): Caption {
  const total = totalPortions(item);
  const qty = item.quantity;
  // Counting whole pieces only makes sense when there are at least as many pieces as sharers.
  if (Number.isInteger(qty) && qty > 1 && sharersOf(item).length <= qty) {
    if (total === qty) return { text: `How many of the ${qty} did each person have?`, tone: 'muted' };
    return {
      text: `How many of the ${qty} did each person have? These add up to ${total}, so each pays in that ratio.`,
      tone: 'warning',
    };
  }
  return { text: `Portions per person — 2 pays twice as much as 1 (${total} in all)`, tone: 'muted' };
}

/** ' + ₹66.12 charges' / ' − ₹6.69 charges' (discounts outweigh tax) / '' when there are none. */
export function chargesSuffix(charges: Minor, currency: CurrencyCode): string {
  if (!charges) return '';
  return ` ${charges < 0 ? '−' : '+'} ${formatMoney(Math.abs(charges), currency)} charges`;
}

/** True when sharers have different numbers of portions (e.g. A had 2 of the naan, B 1). */
export function hasUnequalPortions(item: BillItem): boolean {
  const ids = sharersOf(item);
  return ids.some((id) => item.shares[id] !== item.shares[ids[0]]);
}

export function isSharedByAll(item: BillItem, personIds: ID[]): boolean {
  const ids = sharersOf(item);
  return personIds.length > 0 && personIds.every((id) => ids.indexOf(id) >= 0);
}

export function totalPortions(item: BillItem): number {
  return sharersOf(item).reduce((sum, id) => sum + item.shares[id], 0);
}

export interface Caption {
  text: string;
  tone: 'muted' | 'warning';
}

/** The line under an item's chips: '₹90.00 each · 4 people', 'Bhavna pays ₹450.00', 'Tap who shared this'. */
export function itemSplitCaption(
  item: BillItem,
  currency: CurrencyCode,
  names: Record<ID, string>,
  amounts?: Record<ID, Minor>,
): Caption {
  const shares = itemShares(item, amounts);
  if (shares.length === 0) return { text: 'Tap who shared this', tone: 'warning' };
  const nameOf = (id: ID) => names[id] ?? 'Someone';
  if (shares.length === 1) {
    const who = nameOf(shares[0].personId);
    const verb = who === 'You' ? 'pay' : 'pays';
    return { text: `${who} ${verb} ${formatMoney(shares[0].amount, currency)}`, tone: 'muted' };
  }
  if (!hasUnequalPortions(item)) {
    const amounts = shares.map((s) => s.amount);
    const min = Math.min(...amounts);
    const exact = amounts.every((a) => a === min);
    return { text: `${exact ? '' : '≈ '}${formatMoney(min, currency)} each · ${shares.length} people`, tone: 'muted' };
  }
  return {
    text: shares.map((s) => `${nameOf(s.personId)} ${formatMoney(s.amount, currency)}`).join(' · '),
    tone: 'muted',
  };
}

/** '6 × ₹60.00' when the quantity divides the line total evenly; otherwise null. */
export function unitPriceCaption(item: BillItem, currency: CurrencyCode): string | null {
  const qty = item.quantity;
  if (!Number.isInteger(qty) || qty <= 1 || !Number.isInteger(item.amount) || item.amount % qty !== 0) return null;
  return `${qty} × ${formatMoney(item.amount / qty, currency)}`;
}

// ---------- Item entry ----------

/** '' → 1; whole numbers 1–999; anything else null. */
export function parseQuantity(text: string): number | null {
  const t = text.trim();
  if (!t) return 1;
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

export interface ItemFields {
  name: string;
  qty: string;
  amount: string;
}

export interface ParsedItemFields {
  name: string;
  quantity: number;
  amount: Minor;
}

/** Validates the name / qty / price fields of the add-item row or an item being edited. */
export function parseItemFields(fields: ItemFields, currency: CurrencyCode): { value: ParsedItemFields | null; error: string | null } {
  const name = fields.name.trim().replace(/\s+/g, ' ');
  if (!name) return { value: null, error: 'Enter the item name' };
  const quantity = parseQuantity(fields.qty);
  if (quantity === null) return { value: null, error: 'Quantity must be a whole number from 1 to 999' };
  if (!fields.amount.trim()) return { value: null, error: 'Enter the price' };
  const amount = parseAmountInput(fields.amount, currency);
  if (amount === null) return { value: null, error: 'Enter a valid price, e.g. 360 or 360.50' };
  if (amount <= 0) return { value: null, error: 'The price must be more than zero' };
  return { value: { name, quantity, amount }, error: null };
}

/** A new item shared equally by `shareWith` (everyone, like scanned items). */
export function itemFromFields(
  fields: ItemFields,
  currency: CurrencyCode,
  shareWith: ID[],
): { item: BillItem | null; error: string | null } {
  const { value, error } = parseItemFields(fields, currency);
  if (!value) return { item: null, error };
  const shares: Record<ID, number> = {};
  for (const id of shareWith) shares[id] = 1;
  return { item: newBillItem(value.name, value.amount, value.quantity, shares), error: null };
}

/** Applies edited fields to an item, keeping who shared it. */
export function applyItemFields(
  item: BillItem,
  fields: ItemFields,
  currency: CurrencyCode,
): { item: BillItem | null; error: string | null } {
  const { value, error } = parseItemFields(fields, currency);
  if (!value) return { item: null, error };
  return { item: { ...item, name: value.name, quantity: value.quantity, amount: value.amount }, error: null };
}

// ---------- Percentages and charges ----------

/** '2.5', '2,5', '18 %' → number in (0, 100]; anything else null. */
export function parsePercentInput(text: string): number | null {
  const t = text.trim().replace(/\s*%$/, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,3})?$|^\.\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 100 ? n : null;
}

/** `percent` of `amount`, rounded half away from zero to whole minor units. */
export function percentOf(amount: Minor, percent: number): Minor {
  const raw = (amount * percent) / 100;
  // The epsilon absorbs float noise such as 34.749999… for 2.5% of 1,390.00.
  return Math.sign(raw) * Math.round(Math.abs(raw) + 1e-7);
}

/** 2.5 → '2.5', 18 → '18', 12.125 → '12.125'. */
export function formatPercent(percent: number): string {
  return String(Math.round(percent * 1000) / 1000);
}

/** The percentage printed in a charge label ('CGST 2.5%' → 2.5), or null. */
export function percentFromLabel(label: string): number | null {
  const m = /(\d{1,3}(?:[.,]\d{1,3})?)\s*%/.exec(label);
  return m ? parsePercentInput(m[1]) : null;
}

/**
 * For a charge labelled with a percentage, the amount that percentage gives on today's items
 * subtotal when it differs from the stored amount (e.g. after items were added); else null.
 */
export function percentRecalculation(charge: BillCharge, itemsSubtotal: Minor): { percent: number; amount: Minor } | null {
  if (charge.kind === 'roundoff' || itemsSubtotal <= 0) return null;
  const percent = percentFromLabel(charge.label);
  if (percent === null) return null;
  const magnitude = percentOf(itemsSubtotal, percent);
  const amount = charge.amount < 0 || charge.kind === 'discount' ? -magnitude : magnitude;
  return amount === charge.amount ? null : { percent, amount };
}

export type ChargePresetKey = 'tax' | 'service' | 'tip' | 'discount' | 'other';

export interface ChargePreset {
  key: ChargePresetKey;
  kind: ChargeKind;
  /** Chip text in the add-charge form. */
  chip: string;
  defaultLabel: string;
  /** The value is always a percentage of the items subtotal. */
  percent: boolean;
  placeholder: string;
}

export const CHARGE_PRESETS: ChargePreset[] = [
  { key: 'tax', kind: 'tax', chip: 'Tax %', defaultLabel: 'GST', percent: true, placeholder: '5' },
  { key: 'service', kind: 'service', chip: 'Service %', defaultLabel: 'Service charge', percent: true, placeholder: '10' },
  { key: 'tip', kind: 'tip', chip: 'Tip', defaultLabel: 'Tip', percent: false, placeholder: '100' },
  { key: 'discount', kind: 'discount', chip: 'Discount', defaultLabel: 'Discount', percent: false, placeholder: '200' },
  { key: 'other', kind: 'other', chip: 'Other', defaultLabel: 'Packing charge', percent: false, placeholder: '50' },
];

export function chargePreset(key: ChargePresetKey): ChargePreset {
  return CHARGE_PRESETS.find((p) => p.key === key) ?? CHARGE_PRESETS[0];
}

const KIND_INFO: Record<ChargeKind, { label: string; icon: string }> = {
  tax: { label: 'Tax', icon: 'receipt-outline' },
  service: { label: 'Service', icon: 'restaurant-outline' },
  tip: { label: 'Tip', icon: 'heart-outline' },
  discount: { label: 'Discount', icon: 'pricetag-outline' },
  roundoff: { label: 'Round off', icon: 'swap-horizontal' },
  other: { label: 'Other', icon: 'ellipsis-horizontal' },
};

export function chargeKindLabel(kind: ChargeKind): string {
  return (KIND_INFO[kind] ?? KIND_INFO.other).label;
}

export function chargeKindIcon(kind: ChargeKind): string {
  return (KIND_INFO[kind] ?? KIND_INFO.other).icon;
}

export interface ChargeDraft {
  /** Signed amount the charge would get (discounts negative), or null while the value is invalid. */
  amount: Minor | null;
  label: string;
  error: string | null;
}

/**
 * Evaluates the add-charge form. % presets (and any value ending in '%') take that percentage
 * of the items subtotal; discounts are stored negative, everything else positive.
 */
export interface ChargeFormInput {
  preset: ChargePresetKey;
  label: string;
  value: string;
  itemsSubtotal: Minor;
  currency: CurrencyCode;
}

export function evaluateChargeForm(args: ChargeFormInput): ChargeDraft {
  const preset = chargePreset(args.preset);
  const value = args.value.trim();
  const baseLabel = args.label.trim().replace(/\s+/g, ' ') || preset.defaultLabel;
  const sign = preset.kind === 'discount' ? -1 : 1;
  if (!value) {
    return { amount: null, label: baseLabel, error: preset.percent ? 'Enter the percentage' : 'Enter the amount' };
  }

  if (preset.percent || /%\s*$/.test(value)) {
    const percent = parsePercentInput(value);
    if (percent === null) return { amount: null, label: baseLabel, error: 'Enter a percentage between 0 and 100' };
    if (args.itemsSubtotal <= 0) {
      return { amount: null, label: baseLabel, error: 'Add items first so the percentage has something to apply to' };
    }
    const label = /%/.test(baseLabel) ? baseLabel : `${baseLabel} ${formatPercent(percent)}%`;
    const amount = percentOf(args.itemsSubtotal, percent);
    if (amount === 0) return { amount: null, label, error: 'That percentage rounds to zero' };
    return { amount: sign * amount, label, error: null };
  }

  const parsed = parseAmountInput(value.replace(/^[-−]/, ''), args.currency);
  if (parsed === null) return { amount: null, label: baseLabel, error: 'Enter a valid amount, e.g. 50 or 49.50' };
  if (parsed === 0) return { amount: null, label: baseLabel, error: 'The amount must be more than zero' };
  return { amount: sign * parsed, label: baseLabel, error: null };
}

export function chargeFromForm(args: ChargeFormInput): { charge: BillCharge | null; error: string | null } {
  const draft = evaluateChargeForm(args);
  if (draft.amount === null) return { charge: null, error: draft.error };
  return { charge: newBillCharge(chargePreset(args.preset).kind, draft.label, draft.amount), error: null };
}

/** Applies an edited label / amount to a charge. Discounts stay negative; round-off keeps its sign. */
export function applyChargeFields(
  charge: BillCharge,
  fields: { label: string; amount: string },
  currency: CurrencyCode,
): { charge: BillCharge | null; error: string | null } {
  const label = fields.label.trim().replace(/\s+/g, ' ') || chargeKindLabel(charge.kind);
  if (!fields.amount.trim()) return { charge: null, error: 'Enter the amount' };
  const parsed = parseAmountInput(fields.amount, currency, { allowNegative: true });
  if (parsed === null) return { charge: null, error: 'Enter a valid amount, e.g. 50 or -20' };
  if (parsed === 0) return { charge: null, error: 'The amount can’t be zero — delete the charge instead' };
  const amount = charge.kind === 'discount' ? -Math.abs(parsed) : parsed;
  return { charge: { ...charge, label, amount }, error: null };
}

// ---------- Summary ----------

export interface PersonSummary {
  personId: ID;
  itemsSubtotal: Minor;
  charges: Minor;
  total: Minor;
  lines: PersonItemLine[];
  chargeLines: { chargeId: ID; label: string; amount: Minor }[];
}

export interface BillSummary {
  result: ItemizedResult;
  total: Minor;
  itemsSubtotal: Minor;
  chargesTotal: Minor;
  /** Every participant in order (zero totals included), then anyone else sharing an item. */
  people: PersonSummary[];
  /** Item id → person id → that person's part of the item, as the whole-bill split allocated it. */
  itemAmounts: Record<ID, Record<ID, Minor>>;
  /** Σ people totals = total − unassigned items. */
  assignedTotal: Minor;
  unassignedItems: BillItem[];
  unassignedAmount: Minor;
  printedTotal: Minor | null;
  /** Printed total − computed total (0 when no printed total). */
  printedDifference: Minor;
  /** Non-blocking notes, e.g. a printed-total mismatch. */
  warnings: string[];
  /** Why Done is disabled; empty when the split can be saved. */
  blockers: string[];
  canFinish: boolean;
}

function itemTitle(item: BillItem): string {
  return item.name.trim() || 'Untitled item';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** '"Naan" and "Butter Chicken"', '"A", "B" and 2 more'. */
export function listNames(names: string[], max: number = 3): string {
  const quoted = names.map((n) => `"${n}"`);
  if (quoted.length <= 1) return quoted.join('');
  if (quoted.length <= max) return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  return `${quoted.slice(0, max - 1).join(', ')} and ${quoted.length - max + 1} more`;
}

export function unassignedMessage(items: BillItem[], amount: Minor, currency: CurrencyCode): string {
  return `${plural(items.length, 'item', 'items')} not assigned yet (${formatMoney(amount, currency)}): ${listNames(items.map(itemTitle))}`;
}

export function printedTotalMessage(printed: Minor, computed: Minor, currency: CurrencyCode): string {
  const diff = computed - printed;
  const direction = diff > 0 ? 'more' : 'less';
  return `The bill says ${formatMoney(printed, currency)}, but items and charges add up to ${formatMoney(computed, currency)} (${formatMoney(Math.abs(diff), currency)} ${direction}). Check the amounts or add the missing charge.`;
}

export function buildSummary(bill: ItemizedBill, participantIds: ID[], currency: CurrencyCode): BillSummary {
  const result = computeItemized(bill);
  const byId: Record<ID, PersonSummary> = {};
  for (const p of result.perPerson) {
    byId[p.personId] = {
      personId: p.personId,
      itemsSubtotal: p.itemsSubtotal,
      charges: p.charges,
      total: p.total,
      lines: p.lines,
      chargeLines: p.chargeLines,
    };
  }
  const order: ID[] = [];
  for (const id of participantIds) if (order.indexOf(id) < 0) order.push(id);
  for (const p of result.perPerson) if (order.indexOf(p.personId) < 0) order.push(p.personId);
  const people = order.map(
    (id) => byId[id] ?? { personId: id, itemsSubtotal: 0, charges: 0, total: 0, lines: [], chargeLines: [] },
  );
  const itemAmounts: Record<ID, Record<ID, Minor>> = {};
  for (const p of result.perPerson) {
    for (const line of p.lines) {
      if (!itemAmounts[line.itemId]) itemAmounts[line.itemId] = {};
      itemAmounts[line.itemId][p.personId] = line.amount;
    }
  }

  const unassignedItems = bill.items.filter((item) => result.unassignedItemIds.indexOf(item.id) >= 0);
  const unassignedAmount = unassignedItems.reduce((sum, item) => sum + item.amount, 0);
  const assignedTotal = people.reduce((sum, p) => sum + p.total, 0);

  const printedTotal = typeof bill.printedTotal === 'number' && bill.printedTotal > 0 ? bill.printedTotal : null;
  const printedDifference = printedTotal === null ? 0 : printedTotal - result.total;
  const warnings: string[] = [];
  if (printedTotal !== null && printedDifference !== 0 && bill.items.length > 0) {
    warnings.push(printedTotalMessage(printedTotal, result.total, currency));
  }

  const blockers: string[] = [];
  if (bill.items.length === 0) blockers.push('Add at least one item');
  if (unassignedItems.length > 0) blockers.push(unassignedMessage(unassignedItems, unassignedAmount, currency));
  if (bill.items.length > 0 && result.total <= 0) blockers.push('The bill total must be more than zero');
  for (const e of result.errors) {
    // Unassigned items and the empty bill are already explained above in friendlier words.
    if (e === 'Add at least one item' || /^Assign ".*" to at least one person$/.test(e)) continue;
    if (e === "The bill total can't be negative" && blockers.indexOf('The bill total must be more than zero') >= 0) continue;
    if (blockers.indexOf(e) < 0) blockers.push(e);
  }

  return {
    result,
    total: result.total,
    itemsSubtotal: result.itemsSubtotal,
    chargesTotal: result.chargesTotal,
    people,
    itemAmounts,
    assignedTotal,
    unassignedItems,
    unassignedAmount,
    printedTotal,
    printedDifference,
    warnings,
    blockers,
    canFinish: blockers.length === 0,
  };
}

/** '1/4 of Naan' — or just 'Naan' when the person had the whole item. */
export function portionLabel(line: PersonItemLine): string {
  const name = line.name.trim() || 'Untitled item';
  return line.portion === '1/1' ? name : `${line.portion} of ${name}`;
}

/** Done button text: 'Done', or what still has to happen first. */
export function doneLabel(summary: BillSummary): string {
  if (summary.canFinish) return 'Done';
  if (summary.blockers[0] === 'Add at least one item') return 'Add an item to continue';
  if (summary.unassignedItems.length > 0) return 'Assign every item to finish';
  return 'Fix the bill to continue';
}

/** Blockers other than the empty bill and unassigned items (those have their own UI). */
export function otherBlockers(summary: BillSummary, currency: CurrencyCode): string[] {
  const skip = ['Add at least one item'];
  if (summary.unassignedItems.length > 0) skip.push(unassignedMessage(summary.unassignedItems, summary.unassignedAmount, currency));
  return summary.blockers.filter((b) => skip.indexOf(b) < 0);
}
