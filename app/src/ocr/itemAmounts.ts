// Reads quantity / unit price / line total from the numbers around an item name (pure).
// Columns are not labelled in OCR text, so roles are inferred from qty × rate = amount.
import { isMoneyToken, type NumberToken } from './tokens';

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
}

const MAX_QTY = 999;

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
    };
  };

  if (last.rateMark) {
    const q = markedQty ?? before.filter(canBeQty).pop() ?? leadCandidate;
    const qty = q ? q.value : 1;
    return result(qty, round2(qty * last.value), 0.75, last.value, q, [q]);
  }

  const amount = last.value;
  const free = before.filter((n) => n !== markedQty && n !== rateTok);

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
    const aQty = canBeQty(a) && consistent(a.value, b.value, amount);
    const bQty = canBeQty(b) && consistent(b.value, a.value, amount);
    if (aQty || bQty) {
      // Both readings multiply out ('2 × 120 = 120 × 2'): the quantity is the one that looks like a count.
      const qtyIsB = bQty && (!aQty || qtyLikeness(b) > qtyLikeness(a) || (qtyLikeness(b) === qtyLikeness(a) && b.value < a.value));
      return qtyIsB ? result(b.value, amount, 0.95, a.value, b, [a, b]) : result(a.value, amount, 0.95, b.value, a, [a, b]);
    }
    if (looksLikeQty(a)) return result(a.value, amount, 0.45, b.value, a, [a, b]);
    if (looksLikeQty(b) && !Number.isInteger(a.value)) return result(b.value, amount, 0.45, a.value, b, [a, b]);
    return result(1, amount, 0.4, undefined, undefined, []);
  }

  if (free.length === 1) {
    const a = free[0];
    if (approxEqual(a.value, amount)) return result(1, amount, 0.9, a.value, undefined, [a]);
    const ratio = wholeRatio(amount, a.value);
    if (looksLikeQty(a)) {
      // 'Naan 6 360' → 6 × 60, 'Tea 20 60' → 3 × 20: the smaller reading is the quantity.
      if (ratio !== undefined && ratio < a.value) return result(ratio, amount, 0.85, a.value, undefined, [a]);
      return result(a.value, amount, 0.85, undefined, a, [a]);
    }
    if (ratio !== undefined) return result(ratio, amount, 0.85, a.value, undefined, [a]);
    return leadCandidate
      ? result(leadCandidate.value, amount, 0.5, undefined, leadCandidate, [leadCandidate])
      : result(1, amount, 0.5, undefined, undefined, []);
  }

  if (leadCandidate) return result(leadCandidate.value, amount, 0.75, undefined, leadCandidate, [leadCandidate]);
  return result(1, amount, last.decimals > 0 ? 0.8 : 0.7, undefined, undefined, []);
}
