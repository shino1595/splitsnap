// Reads quantity / unit price / line total from the numbers around an item name (pure).
// Columns are not labelled in OCR text, so roles are inferred from qty × rate = amount.
import { isMoneyToken, type NumberToken } from './tokens';

/** Another way to read the numbers of a row when some digits were misread. */
export interface AmountReading {
  quantity: number;
  unitPrice?: number;
  amount: number;
  /** About one per misread digit (see MISREAD); lower is likelier. */
  cost: number;
  /** The amount as printed, on a row whose repair changed it. */
  printed?: boolean;
}

export interface ItemAmounts {
  quantity: number;
  /** Major units (e.g. rupees), when printed or safely derivable. */
  unitPrice?: number;
  /** Line total in major units. */
  amount: number;
  confidence: number;
  /** True when the number before the name ('2 Gulab Jamun …') was used as the quantity. */
  usedLead: boolean;
  /** Whole numbers between the name and the price columns that are part of the name ('Chicken 65', 'Room 101'). */
  nameNumbers: NumberToken[];
  /** True when the quantity was printed as its own number (not derived from amount ÷ rate). */
  qtyPrinted: boolean;
  /** Only for a row whose printed numbers do not multiply out: its other readings, cheapest
   *  first, including the amount as printed when the repair changed it. The bill's subtotal or
   *  total chooses between them ('199.00 189.00' is a misread 199 or a ₹10 discount). A row that
   *  multiplies out as printed has none: nothing on it suggests a misread. */
  alternatives: AmountReading[];
  /** True when misread digits were fixed to make qty × rate = amount ('3581.8' → 3591.00). */
  repaired: boolean;
}

const MAX_QTY = 999;

/**
 * Digits receipt fonts get misread as (read → printed, cost). Thermal-printer 9s often come back
 * as 8s: '3581.8' for 3591.00, '648.00' for 649.00. 8 → 9 is a little cheaper than the other way
 * round, so '548.00  549.00' is read as 549, the way menus usually price.
 */
const MISREAD: Record<string, [string, number][]> = {
  '8': [['9', 0.9], ['0', 1], ['3', 1], ['6', 1]],
  '9': [['8', 1]],
  '0': [['8', 1]],
  '3': [['8', 1]],
  '6': [['8', 1], ['5', 1]],
  '5': [['6', 1]],
  '1': [['7', 1]],
  '7': [['1', 1]],
};
/** A repaired reading may cost at most this much (e.g. two misread digits and a cut-off decimal). */
const MAX_REPAIR = 3;
/** Extra cost of a misread digit in the amount rather than in the rate: the amount is what the
 *  subtotal adds up, so '1  199.00  189.00' reads as a misread rate (189) unless the sums say 199. */
const AMOUNT_EDIT = 0.3;
/** Alternatives kept for the subtotal check: at most this many, costing at most MAX_ALTERNATIVE. */
const MAX_ALTERNATIVES = 6;
const MAX_ALTERNATIVE = 2;
/** Cost of going back to the amount as printed (the row's numbers really differ: a discount). */
const PRINTED_COST = 1;
/** A repair that changed the printed amount asks to be checked until the bill's sums confirm it. */
const CHANGED_AMOUNT_CONFIDENCE = 0.65;
/** Role cost that rules a reading out (a weight read as the price). */
const IMPOSSIBLE = 9;

interface Variant {
  value: number;
  cost: number;
}

/** The value of the token, and the values it has if one digit was misread. For an amount with
 *  one decimal ('1947.8': the second decimal printed over the paper's edge and read as 8 or g),
 *  also its whole part. A quantity only varies in its whole part ('2.0' never means 2.8). */
function variants(n: NumberToken, role: 'qty' | 'rate' | 'amount'): Variant[] {
  const out: Variant[] = [{ value: n.value, cost: 0 }];
  const body = /\d+(?:\.\d+)?/.exec(n.raw)?.[0];
  if (!body) return out;
  const sign = n.value < 0 ? -1 : 1;
  const dot = body.indexOf('.');
  const last = role === 'qty' && dot >= 0 ? dot : body.length;
  const extra = role === 'amount' ? AMOUNT_EDIT : 0;
  for (let i = 0; i < last; i++) {
    for (const [printed, cost] of MISREAD[body[i]] ?? []) {
      const value = Number(body.slice(0, i) + printed + body.slice(i + 1));
      if (Number.isFinite(value) && value !== 0) out.push({ value: sign * value, cost: cost + extra });
    }
  }
  if (role === 'amount' && n.decimals === 1) {
    for (const v of out.slice()) {
      if (!Number.isInteger(v.value)) out.push({ value: Math.trunc(v.value), cost: v.cost + 0.5 });
    }
  }
  return out;
}

/** How unlikely `q` is the quantity next to `r`. A weight ('1.250') is never the price. A number
 *  printed like a price ('649.00') next to one printed like a count ('3.0', '3') is the rate, and
 *  so is a price over 99 next to a whole count ('1.00  109.00': not 109 × ₹1). */
function qtyRoleCost(q: NumberToken, r: NumberToken): number {
  if (r.decimals === 3 && q.decimals !== 3) return IMPOSSIBLE;
  let cost = q.decimals >= 2 && r.decimals < 2 ? 1 : 0;
  if (q.value > 99) cost += r.value <= 99 && Number.isInteger(r.value) ? 2 : 0.5;
  return cost;
}

/** qty × rate = amount for a repaired reading: rounding of the rate only, with the quantity's
 *  share capped so that a large swapped 'quantity' can't absorb a misread ('109 × 1 ≈ 108.55'). */
function multipliesOut(qty: number, rate: number, amount: number): boolean {
  return Math.abs(qty * rate - amount) <= 0.006 * Math.min(qty, 10) + 0.011;
}

/** A reading and how much of its cost is misread digits (the rest is an unlikely quantity). */
interface Repair extends AmountReading {
  edits: number;
}

/** Readings of qty × rate = amount with up to MAX_REPAIR worth of misread digits, cheapest first.
 *  Without a quantity token (`q` null: 'Naan  60.00  60.00') the quantity is 1. */
function repairs(q: NumberToken | null, r: NumberToken, amount: NumberToken, extraCost: number): Repair[] {
  const out: Repair[] = [];
  const amounts = variants(amount, 'amount');
  const rates = variants(r, 'rate');
  for (const qv of q ? variants(q, 'qty') : [{ value: 1, cost: 0 }]) {
    if (!(qv.value > 0 && qv.value <= MAX_QTY)) continue;
    for (const rv of rates) {
      const base = extraCost + qv.cost + rv.cost;
      if (base > MAX_REPAIR || !(rv.value > 0)) continue;
      for (const av of amounts) {
        const cost = base + av.cost;
        if (cost > MAX_REPAIR || !(av.value > 0)) continue;
        if (multipliesOut(qv.value, rv.value, av.value)) {
          const edits = Math.round((qv.cost + rv.cost + av.cost) * 100) / 100;
          out.push({ quantity: qv.value, unitPrice: round2(rv.value), amount: round2(av.value), cost: Math.round(cost * 100) / 100, edits });
        }
      }
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

/** Cheapest readings with an amount other than `amount`, one per amount. */
function otherReadings(readings: AmountReading[], amount: number): AmountReading[] {
  const seen = new Set<number>([round2(amount)]);
  const out: AmountReading[] = [];
  for (const r of readings) {
    if (r.cost > MAX_ALTERNATIVE || seen.has(r.amount)) continue;
    seen.add(r.amount);
    out.push({ quantity: r.quantity, unitPrice: r.unitPrice, amount: r.amount, cost: r.cost });
    if (out.length >= MAX_ALTERNATIVES) break;
  }
  return out;
}

/** Could be a quantity (weights such as 1.250 included). */
export function canBeQty(n: NumberToken): boolean {
  return n.value > 0 && n.value <= MAX_QTY && !n.percent && n.decimals <= 3;
}

/** A whole number of portions such as '6' or '2.00'. */
export function looksLikeQty(n: NumberToken): boolean {
  return canBeQty(n) && Number.isInteger(n.value) && n.value <= 99;
}

export function consistent(qty: number, rate: number, amount: number): boolean {
  return Math.abs(qty * rate - amount) <= 0.006 * qty + 0.011;
}

/** How much a number looks like the quantity column: '6' > '1.250' (weight) > '2.00' > '60.50'. */
function qtyLikeness(n: NumberToken): number {
  if (n.decimals === 0) return 3;
  if (n.decimals === 3) return 2;
  return Number.isInteger(n.value) ? 1 : 0;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function wholeRatio(amount: number, rate: number): number | undefined {
  if (!(rate > 0)) return undefined;
  const ratio = amount / rate;
  const rounded = Math.round(ratio);
  return Math.abs(ratio - rounded) < 0.001 && rounded >= 2 && rounded <= MAX_QTY ? rounded : undefined;
}

/** Rate only when it is a whole number of cents (360 / 6 = 60, but not 350 / 6). */
function derivedRate(amount: number, qty: number): number | undefined {
  if (!(qty > 0)) return undefined;
  const rate = amount / qty;
  return Math.abs(rate * 100 - Math.round(rate * 100)) < 1e-6 ? Math.round(rate * 100) / 100 : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Plain whole numbers before every number we read as qty/rate: they belong to the item name. */
function leftovers(before: NumberToken[], used: NumberToken[]): NumberToken[] {
  const firstUsed = used.length ? Math.min(...used.map((n) => n.index)) : Infinity;
  return before.filter(
    (n) => used.indexOf(n) < 0 && n.index < firstUsed && n.decimals === 0 && n.value > 0 && n.intDigits <= 4 && !n.qtyMark && !n.rateMark,
  );
}

/**
 * `lead` = numbers before the name, `tail` = numbers after it (last one = line total).
 * Handles 'Naan 6 60.00 360.00', 'Naan 60.00 6 360.00', '6 x Naan 360', 'Naan x6 360.00',
 * '2 Gulab Jamun @80 160', '90.00 270.00' (qty 3 missing), '2 @ 2.99' (no line total).
 */
export function interpretAmounts(lead: NumberToken[], tail: NumberToken[], leadIsSerial: boolean): ItemAmounts | null {
  const nums = tail.filter((n) => !n.percent);
  const last = nums[nums.length - 1];
  if (!last || !isMoneyToken(last)) return null;
  const before = nums.slice(0, -1);

  const markedQty = before.find((n) => n.qtyMark) ?? lead.find((n) => n.qtyMark);
  const rateTok = before.find((n) => n.rateMark);
  const leadCandidate =
    !leadIsSerial && lead.length === 1 && looksLikeQty(lead[0]) && !lead[0].listMark ? lead[0] : undefined;
  const result = (
    quantity: number,
    amount: number,
    confidence: number,
    unitPrice: number | undefined,
    qtyToken: NumberToken | undefined,
    used: (NumberToken | undefined)[],
    alternatives: AmountReading[] = [],
    fixed = false,
  ): ItemAmounts => {
    const usedTokens = used.filter((n): n is NumberToken => !!n);
    return {
      quantity,
      unitPrice: unitPrice ?? derivedRate(amount, quantity),
      amount,
      confidence,
      usedLead: !!qtyToken && lead.indexOf(qtyToken) >= 0,
      nameNumbers: leftovers(before, usedTokens),
      qtyPrinted: !!qtyToken,
      alternatives,
      repaired: fixed,
    };
  };

  if (last.rateMark) {
    const q = markedQty ?? before.filter(canBeQty).pop() ?? leadCandidate;
    const qty = q ? q.value : 1;
    return result(qty, round2(qty * last.value), 0.75, last.value, q, [q]);
  }

  const amount = last.value;
  const free = before.filter((n) => n !== markedQty && n !== rateTok);
  /** Cheapest first; on a tie the reading that keeps the printed amount ('180.00 160.00' stays 160). */
  const cheapest = (x: AmountReading, y: AmountReading) =>
    x.cost - y.cost || (approxEqual(x.amount, amount) ? 0 : 1) - (approxEqual(y.amount, amount) ? 0 : 1);
  /**
   * A row whose printed numbers don't multiply out, read with misread digits fixed. Its other
   * readings — and the amount as printed, when the repair changed it — stay as alternatives for
   * the bill's subtotal or total to choose from ('199.00 189.00' may be a ₹10 discount). A changed
   * amount asks to be checked until those sums confirm it.
   */
  const repaired = (r: AmountReading, qtyToken: NumberToken | undefined, used: NumberToken[], readings: AmountReading[], printedQty: number) => {
    const changed = !approxEqual(r.amount, amount);
    // '1947.8' → 1947.00 only drops the digit printed over the edge: not a new amount to check.
    const newDigits = changed && !(last.decimals === 1 && Math.trunc(amount) === Math.trunc(r.amount));
    const confidence = newDigits ? CHANGED_AMOUNT_CONFIDENCE : Math.max(0.5, round2(0.9 - 0.12 * r.cost));
    const others = otherReadings(readings, r.amount).filter((o) => !changed || !approxEqual(o.amount, amount));
    const printed: AmountReading = { quantity: printedQty, amount, cost: PRINTED_COST, printed: true };
    const alternatives = (changed ? [printed, ...others] : others).slice(0, MAX_ALTERNATIVES);
    return result(r.quantity, r.amount, confidence, r.unitPrice, qtyToken, used, alternatives, true);
  };

  if (markedQty || rateTok) {
    if (markedQty && rateTok) {
      const ok = consistent(markedQty.value, rateTok.value, amount);
      return result(markedQty.value, amount, ok ? 0.95 : 0.45, rateTok.value, markedQty, [markedQty, rateTok]);
    }
    if (markedQty) {
      const r = free[free.length - 1];
      if (r && consistent(markedQty.value, r.value, amount)) {
        return result(markedQty.value, amount, 0.95, r.value, markedQty, [markedQty, r]);
      }
      return result(markedQty.value, amount, 0.8, undefined, markedQty, [markedQty]);
    }
    const rate = (rateTok as NumberToken).value;
    const q = free.filter(canBeQty).pop() ?? leadCandidate;
    if (q && consistent(q.value, rate, amount)) return result(q.value, amount, 0.95, rate, q, [q, rateTok]);
    const ratio = approxEqual(rate, amount) ? 1 : wholeRatio(amount, rate);
    return ratio !== undefined
      ? result(ratio, amount, 0.85, rate, undefined, [rateTok])
      : result(1, amount, 0.5, rate, undefined, [rateTok]);
  }

  if (free.length >= 2) {
    const a = free[free.length - 2];
    const b = free[free.length - 1];
    // A price read as the quantity ('1.00  109.00  108.55' as 109 × 1) gets no rounding allowance.
    const exactAs = (q: NumberToken, r: NumberToken) =>
      canBeQty(q) && (qtyRoleCost(q, r) >= 2 ? multipliesOut(q.value, r.value, amount) : consistent(q.value, r.value, amount));
    const aQty = exactAs(a, b);
    const bQty = exactAs(b, a);
    // The same numbers with misread digits fixed, `a` or `b` as the quantity.
    const asA = canBeQty(a) ? repairs(a, b, last, qtyRoleCost(a, b)) : [];
    const asB = canBeQty(b) ? repairs(b, a, last, qtyRoleCost(b, a)) : [];
    const all = [...asA, ...asB].sort(cheapest);
    const qtyOf = (r: Repair) => (asA.indexOf(r) >= 0 ? a : b);
    if (aQty || bQty) {
      // Both readings multiply out ('2 × 120 = 120 × 2'): the quantity is the one that looks like a count.
      const qtyIsB = bQty && (!aQty || qtyLikeness(b) > qtyLikeness(a) || (qtyLikeness(b) === qtyLikeness(a) && b.value < a.value));
      // '3.0  649.00  1947.8': 649 × 3 is within rounding of 1947.8, but the count is 3.0 and the
      // amount lost its last digit. A cheaper repaired reading with the other number as the
      // quantity wins (the other exact reading, if any, was already weighed just above).
      const other = (qtyIsB ? asA : asB).find((r) => r.edits > 0);
      const exactCost = qtyIsB ? qtyRoleCost(b, a) : qtyRoleCost(a, b);
      if (other && other.cost < exactCost) return repaired(other, qtyIsB ? a : b, [a, b], all, (qtyIsB ? a : b).value);
      return qtyIsB ? result(b.value, amount, 0.95, a.value, b, [a, b]) : result(a.value, amount, 0.95, b.value, a, [a, b]);
    }
    // '9.0  399.00  3581.8' (3591.00), '1.0  548.00  549.00' (549.00): misread digits.
    const best = all.find((r) => r.edits > 0);
    const printedQty = looksLikeQty(a) ? a.value : looksLikeQty(b) ? b.value : 1;
    if (best) return repaired(best, qtyOf(best), [a, b], all, printedQty);
    if (looksLikeQty(a)) return result(a.value, amount, 0.45, b.value, a, [a, b]);
    if (looksLikeQty(b) && !Number.isInteger(a.value)) return result(b.value, amount, 0.45, a.value, b, [a, b]);
    return result(1, amount, 0.4, undefined, undefined, []);
  }

  if (free.length === 1) {
    const a = free[0];
    const asRate = looksLikeQty(a) ? [] : repairs(null, a, last, 0).sort(cheapest);
    if (approxEqual(a.value, amount)) return result(1, amount, 0.9, a.value, undefined, [a]);
    const ratio = wholeRatio(amount, a.value);
    if (looksLikeQty(a)) {
      // 'Naan 6 360' → 6 × 60, 'Tea 20 60' → 3 × 20: the smaller reading is the quantity.
      if (ratio !== undefined && ratio < a.value) return result(ratio, amount, 0.85, a.value, undefined, [a]);
      return result(a.value, amount, 0.85, undefined, a, [a]);
    }
    if (ratio !== undefined) return result(ratio, amount, 0.85, a.value, undefined, [a]);
    // 'Peri Peri Fries  239.00  238.00' (the quantity column lost): one of them was misread.
    const fixed = asRate.find((r) => r.edits > 0);
    if (fixed && !leadCandidate) return repaired(fixed, undefined, [a], asRate, 1);
    return leadCandidate
      ? result(leadCandidate.value, amount, 0.5, undefined, leadCandidate, [leadCandidate])
      : result(1, amount, 0.5, undefined, undefined, []);
  }

  if (leadCandidate) return result(leadCandidate.value, amount, 0.75, undefined, leadCandidate, [leadCandidate]);
  return result(1, amount, last.decimals > 0 ? 0.8 : 0.7, undefined, undefined, []);
}
