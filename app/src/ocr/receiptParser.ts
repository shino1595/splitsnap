// Turns OCR rows of a bill into items, charges and totals (pure; never throws).
//
// 1. Every row is normalised and classified (noise, column header, item, wrapped-name text,
//    bare numbers, charge, subtotal, total) — see rowClassifier.ts.
// 2. The item section runs from the column header (or the first convincing item row) to the
//    first subtotal/total row. Wrapped names are merged: a text row followed (or, on tilted
//    photos, preceded) by a numbers-only row, or a name continuing on the next row.
// 3. Charges and totals are read up to the chosen grand total; Σ items + charges is checked
//    against the printed subtotal/total.
// Rows that are out of order (tilted photos) are parsed twice — pairing loose numbers with the
// row below and with the row above — and the reading whose sums reconcile wins.
import { currencyDecimals, formatMoney, toMinor } from '../lib/money';
import type { ChargeKind, CurrencyCode, Minor } from '../types';
import { canBeQty, consistent, interpretAmounts } from './itemAmounts';
import { detectCurrency, detectDate, isMonthFirstCurrency } from './receiptMeta';
import { analyzeRow, letterCount, needsAmount, type Row } from './rowClassifier';
import type { NumberToken } from './tokens';
import type { ParsedCharge, ParsedItem, ParsedReceipt } from './types';

export { extractNumbers, normalizeLine } from './tokens';

type Mode = 'next' | 'prev';

interface DraftItem {
  name: string;
  quantity: number;
  unitPrice?: number;
  amount: number;
  confidence: number;
  sources: string[];
  lastRow: number;
}

interface DraftCharge {
  row: number;
  kind: ChargeKind;
  label: string;
  value?: number;
  percent?: number;
  source: string;
}

interface WalkResult {
  items: DraftItem[];
  /** Keyword rows (subtotal / total / summary / charge) in order, with their amounts. */
  keywordRows: number[];
  amounts: Map<number, NumberToken>;
  /** Negative lines inside the item section (coupons, voids) → discounts. */
  credits: DraftCharge[];
  /** Label + amount rows after the item section: unknown charges when a total follows them. */
  afterItems: number[];
  /** Numbers-only rows in the item section nobody claimed. */
  orphans: number[];
}

const ENDS_WITH_CONNECTOR = /(\b(with|and|n|of|in|on|w\/|style)|[&+,\-\/(])$/i;
const STARTS_AS_CONTINUATION = /^([a-z(]|(with|and|&|\+|-|w\/)(\s|$))/;
const NOT_A_MERCHANT = /\b(tax\s*invoice|invoice|receipt|bill|cash\s*memo|estimate|original|duplicate|copy|order|kot)\b/i;

function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function tidyName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:.,;*#=~_\/@+]+/, '')
    .replace(/[\s\-:.,;*#=~_\/@+]+$/, '')
    .trim();
}

function joinText(a: string, b: string): string {
  return tidyName(a && b ? `${a} ${b}` : a || b);
}

// ---------------------------------------------------------------------------------------------
// Section bounds

function isStrongItem(row: Row): boolean {
  if (!row.amount) return false;
  if (row.amount.decimals > 0) return true;
  if (row.tail.some((n) => n.qtyMark || n.rateMark) || row.lead.some((n) => n.qtyMark)) return true;
  return row.tail.filter((n) => !n.percent).length >= 3;
}

function findItemsStart(rows: Row[]): number {
  const header = rows.findIndex((r) => r.kind === 'header');
  if (header >= 0) return header + 1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'subtotal' || r.kind === 'total') return i;
    if (r.kind === 'item' && isStrongItem(r)) return i;
    if (r.kind === 'numbers' && isStrongItem(r)) {
      if (i > 1 && rows[i - 1].kind === 'text') return i - 1;
      if (rows[i + 1]?.kind === 'text') return i;
    }
  }
  const lenient = rows.findIndex((r, i) => i > 0 && r.kind === 'item');
  return lenient >= 0 ? lenient : rows.length;
}

function findItemsEnd(rows: Row[], start: number): number {
  for (let i = start; i < rows.length; i++) {
    const kind = rows[i].kind;
    if (kind === 'subtotal' || kind === 'total' || kind === 'summary') return i;
  }
  return rows.length;
}

/** '1 Naan …', '2 Butter Chicken …' — numbers before the names are line numbers, not quantities. */
function leadIsSerial(rows: Row[], start: number, end: number): boolean {
  const withLead = rows.slice(start, end).filter((r) => r.kind === 'item' && r.lead.length > 0);
  const firsts = withLead.map((r) => r.lead[0]);
  if (!firsts.length) return false;
  if (firsts.every((n) => n.listMark)) return true;
  if (firsts.length < 2 || !firsts.every((n, k) => n.value === k + 1 && !n.qtyMark)) return false;
  // '1 Cheeseburger 12.99' / '2 Fries 7.98' are quantities; a 1, 2, 3, 4 run or rows that also
  // print qty/rate columns after the name are line numbers.
  return firsts.length >= 4 || withLead.every((r) => r.tail.filter((n) => !n.percent).length >= 2);
}

/** Do most item names use lower-case letters? Then an ALL-CAPS text row is a section heading. */
function itemsAreMixedCase(rows: Row[], start: number, end: number): boolean {
  const named = rows.slice(start, end).filter((r) => r.kind === 'item' && letterCount(r.label) >= 3);
  const mixed = named.filter((r) => /[a-z]/.test(r.label)).length;
  return named.length > 0 && mixed * 2 >= named.length;
}

function isHeading(row: Row, mixedCase: boolean): boolean {
  if (row.decorated || /:\s*$/.test(row.text)) return true;
  return mixedCase && letterCount(row.label) >= 3 && row.label === row.label.toUpperCase();
}

// ---------------------------------------------------------------------------------------------
// Walking the rows

function walk(rows: Row[], start: number, end: number, mode: Mode): WalkResult {
  const consumed = new Set<number>();
  const items: DraftItem[] = [];
  const keywordRows: number[] = [];
  const amounts = new Map<number, NumberToken>();
  const credits: DraftCharge[] = [];
  const afterItems: number[] = [];
  const serial = leadIsSerial(rows, start, end);
  const mixedCase = itemsAreMixedCase(rows, start, end);
  let pending: Row[] = [];

  const lastItem = (): DraftItem | undefined => items[items.length - 1];

  const numbersRowAt = (i: number, single: boolean): number | undefined => {
    const r = rows[i];
    if (!r || i < start || consumed.has(i) || r.kind !== 'numbers' || !r.amount) return undefined;
    if (single && (r.amount.rateMark || r.tail.filter((n) => !n.percent).length !== 1)) return undefined;
    return i;
  };
  /** A loose numbers row next to row i: below it first ('next') or above it first ('prev'). */
  const claimNumbers = (i: number, single: boolean): Row | undefined => {
    const prev = numbersRowAt(i - 1, single);
    const next = numbersRowAt(i + 1, single);
    const j = mode === 'next' ? next ?? prev : prev ?? next;
    if (j === undefined) return undefined;
    consumed.add(j);
    return rows[j];
  };

  const appendToLast = (text: string, used: Row[]) => {
    const last = lastItem();
    if (!last) return;
    last.name = joinText(last.name, text);
    last.sources.push(...used.map((r) => r.source));
    last.lastRow = Math.max(last.lastRow, ...used.map((r) => r.index));
    last.confidence = clamp01(last.confidence - 0.05);
  };

  /** Quantity printed on its own row ('2 x') before the item it belongs to. */
  let pendingQty: NumberToken[] = [];
  const leadFor = (own: NumberToken[], prefixLead: NumberToken[]): NumberToken[] => {
    const lead = own.length ? own : prefixLead.length ? prefixLead : pendingQty;
    pendingQty = [];
    return lead;
  };

  /** Pending text rows become the start of the next item's name, or the end of the previous one. */
  const takePending = (): { text: string; rows: Row[]; lead: NumberToken[] } => {
    if (!pending.length) return { text: '', rows: [], lead: [] };
    const used = pending;
    pending = [];
    const text = tidyName(used.map((r) => r.label).join(' '));
    const last = lastItem();
    // '1 x Cold Coffee with Ice' / 'Cream 150.00': a quantity in front starts a new item.
    const startsNew = used[0].lead.length > 0 || pendingQty.length > 0;
    const continues =
      !!last &&
      !startsNew &&
      !ENDS_WITH_CONNECTOR.test(text) &&
      (STARTS_AS_CONTINUATION.test(text) || last.lastRow === used[0].index - 1);
    if (continues) {
      appendToLast(text, used);
      return { text: '', rows: [], lead: [] };
    }
    return { text, rows: used, lead: used[0].lead };
  };

  /** At the end of the item section (or before a charge) a pending name can only finish the previous item. */
  const settlePending = () => {
    if (!pending.length) return;
    const used = pending;
    pending = [];
    const text = tidyName(used.map((r) => r.label).join(' '));
    const last = lastItem();
    if (last && !ENDS_WITH_CONNECTOR.test(text) && (STARTS_AS_CONTINUATION.test(text) || last.lastRow === used[0].index - 1)) {
      appendToLast(text, used);
    }
  };

  const pushItem = (label: string, lead: NumberToken[], tail: NumberToken[], used: Row[], merged: boolean, glued: NumberToken[] = []) => {
    const read = interpretAmounts(lead, tail, serial);
    if (!read) return;
    const lastRow = Math.max(...used.map((r) => r.index));
    const sources = used.map((r) => r.source);
    if (read.amount < 0) {
      credits.push({ row: lastRow, kind: 'discount', label: tidyName(label) || 'Discount', value: read.amount, source: sources.join(' / ') });
      return;
    }
    if (read.amount === 0) return;
    let name = label;
    // 'Gulab Jamun 2  80.00  160.00': the OCR glued the quantity column to the name.
    const gluedQty = glued[glued.length - 1];
    if (gluedQty && !read.qtyPrinted && gluedQty.value === read.quantity && name.endsWith(` ${gluedQty.raw}`)) {
      name = name.slice(0, name.length - gluedQty.raw.length - 1);
    }
    if (read.nameNumbers.length) name = `${name} ${read.nameNumbers.map((n) => n.raw).join(' ')}`;
    const leadUnused = lead.length > 0 && !read.usedLead && !serial && !(lead.length === 1 && lead[0].value === read.quantity);
    if (leadUnused) {
      const prefix = lead.filter((n) => !n.listMark && n.intDigits < 4 && !n.qtyMark).map((n) => n.raw);
      if (prefix.length) name = `${prefix.join(' ')} ${name}`;
    }
    const plainAmount = tail.length > 0 && tail[tail.length - 1].decimals === 0;
    items.push({
      name: tidyName(name) || 'Item',
      quantity: read.quantity,
      unitPrice: read.unitPrice,
      amount: read.amount,
      confidence: clamp01(read.confidence - (merged ? 0.05 : 0) - (plainAmount ? 0.05 : 0)),
      sources,
      lastRow,
    });
  };

  /** '2 @ 2.99' under 'GREEK YOGURT 5.98': quantity and unit price of the item above. */
  const applyQtyDetail = (row: Row): boolean => {
    const last = lastItem();
    if (!last || last.lastRow !== row.index - 1) return false;
    const nums = row.tail.filter((n) => !n.percent);
    const rate = nums.find((n) => n.rateMark);
    if (!rate) return false;
    const qty = nums.find((n) => n !== rate && n.qtyMark) ?? nums.filter((n) => n !== rate && n.index < rate.index && canBeQty(n)).pop();
    if (!qty || !consistent(qty.value, rate.value, last.amount)) return false;
    last.quantity = qty.value;
    last.unitPrice = rate.value;
    last.confidence = Math.max(last.confidence, 0.9);
    last.sources.push(row.source);
    last.lastRow = row.index;
    return true;
  };

  for (let i = start; i < rows.length; i++) {
    if (i >= end) settlePending();
    if (consumed.has(i)) continue;
    const row = rows[i];
    const inItems = i < end;

    if (row.kind === 'subtotal' || row.kind === 'total' || row.kind === 'summary' || row.kind === 'charge') {
      if (inItems) settlePending();
      pendingQty = [];
      keywordRows.push(i);
      if (needsAmount(row)) {
        const numbers = claimNumbers(i, true);
        if (numbers?.amount) amounts.set(i, numbers.amount);
      } else if (row.amount) {
        amounts.set(i, row.amount);
      }
      continue;
    }
    if (!inItems) {
      if (row.kind === 'item') afterItems.push(i);
      continue;
    }

    if (row.kind === 'item') {
      const prefix = takePending();
      const lead = leadFor(row.lead, prefix.lead);
      pushItem(joinText(prefix.text, row.label), lead, row.tail, [...prefix.rows, row], prefix.rows.length > 0, row.glued);
    } else if (row.kind === 'text') {
      if (isHeading(row, mixedCase)) {
        settlePending();
        continue;
      }
      const numbers = claimNumbers(i, false);
      if (numbers) {
        const prefix = takePending();
        // 'Naan x6' over '360.00': the quantity sits after the name on the text row.
        const ownQty = row.tail.filter((n) => n.qtyMark);
        const lead = leadFor(row.lead.length ? row.lead : ownQty, prefix.lead);
        pushItem(joinText(prefix.text, row.label), lead, numbers.tail, [...prefix.rows, row, numbers], true);
      } else {
        pending.push(row);
      }
    } else if (row.kind === 'qty') {
      settlePending();
      pendingQty = row.tail;
    } else if (row.kind === 'numbers') {
      if (applyQtyDetail(row)) consumed.add(i);
    }
  }
  settlePending();

  const orphans: number[] = [];
  for (let i = start; i < end; i++) {
    if (rows[i].kind === 'numbers' && !consumed.has(i) && rows[i].amount) orphans.push(i);
  }
  return { items, keywordRows, amounts, credits, afterItems, orphans };
}

// ---------------------------------------------------------------------------------------------
// Totals, charges and checks

const DEFAULT_CHARGE_LABELS: Record<ChargeKind, string> = {
  tax: 'Tax',
  service: 'Service charge',
  tip: 'Tip',
  discount: 'Discount',
  roundoff: 'Round off',
  other: 'Other charges',
};

function chargeLabel(row: Row): string {
  const base = row.label.replace(/\s*@\s*/g, ' ').trim() || DEFAULT_CHARGE_LABELS[row.chargeKind ?? 'other'];
  if (row.percent === undefined || /%/.test(base)) return base;
  return `${base} ${Number(row.percent.toFixed(3))}%`;
}

function signedCharge(kind: ChargeKind, amount: NumberToken): number {
  if (kind === 'discount') return -Math.abs(amount.value);
  return amount.paren ? -Math.abs(amount.value) : amount.value;
}

/** The last 'Grand Total'-style row, else the largest plain 'Total'. -1 if none. */
function chooseTotal(rows: Row[], w: WalkResult): number {
  const totals = w.keywordRows.filter((i) => rows[i].kind === 'total' && (w.amounts.get(i)?.value ?? 0) > 0);
  const strong = totals.filter((i) => rows[i].strongTotal);
  if (strong.length) return strong[strong.length - 1];
  let best = -1;
  for (const i of totals) {
    if (best < 0 || (w.amounts.get(i) as NumberToken).value >= (w.amounts.get(best) as NumberToken).value) best = i;
  }
  return best;
}

function collectCharges(rows: Row[], w: WalkResult, limit: number, hasTotal: boolean): DraftCharge[] {
  const drafts: DraftCharge[] = [];
  for (const i of w.keywordRows) {
    const row = rows[i];
    if (row.kind !== 'charge' || i >= limit) continue;
    const kind = row.chargeKind ?? 'other';
    const amount = w.amounts.get(i);
    drafts.push({ row: i, kind, label: chargeLabel(row), value: amount && signedCharge(kind, amount), percent: row.percent, source: row.source });
  }
  drafts.push(...w.credits.filter((c) => c.row < limit));
  if (hasTotal) {
    for (const i of w.afterItems) {
      const amount = rows[i].amount;
      if (i >= limit || !amount) continue;
      const kind: ChargeKind = amount.value < 0 ? 'discount' : 'other';
      drafts.push({ row: i, kind, label: rows[i].label, value: signedCharge(kind, amount), source: rows[i].source });
    }
  }
  for (const i of w.keywordRows) {
    const row = rows[i];
    const kind = row.chargeKind;
    const amount = w.amounts.get(i);
    if (row.kind !== 'summary' || !kind || !amount || i >= limit || drafts.some((d) => d.kind === kind)) continue;
    drafts.push({ row: i, kind, label: chargeLabel(row), value: signedCharge(kind, amount), source: row.source });
  }
  return drafts.sort((a, b) => a.row - b.row);
}

/** Loose amounts in the item section whose names were lost: kept only when they close the gap to the total exactly. */
function orphanItems(rows: Row[], w: WalkResult, known: Minor, total: Minor, limit: number, currency: CurrencyCode): ParsedItem[] {
  const orphans = w.orphans.filter((i) => i < limit);
  const loose = orphans.map((i) => toMinor((rows[i].amount as NumberToken).value, currency));
  if (!orphans.length || loose.some((v) => v <= 0) || known + sum(loose) !== total) return [];
  return orphans.map((i, k) => ({ name: 'Item', quantity: 1, amount: loose[k], confidence: 0.3, sourceLine: rows[i].source }));
}

function assemble(rows: Row[], w: WalkResult, currency: CurrencyCode): ParsedReceipt {
  const amountAt = (i: number) => w.amounts.get(i) as NumberToken;
  const totalRow = chooseTotal(rows, w);
  const limit = totalRow >= 0 ? totalRow : rows.length;
  const total = totalRow >= 0 ? toMinor(amountAt(totalRow).value, currency) : undefined;

  let subtotalRow = w.keywordRows.find((i) => rows[i].kind === 'subtotal' && w.amounts.has(i) && i < limit) ?? -1;
  if (subtotalRow < 0 && total !== undefined) {
    // 'Total 1390.00' … taxes … 'Grand Total 1460.00': the smaller earlier total is the subtotal.
    subtotalRow =
      w.keywordRows.find((i) => rows[i].kind === 'total' && i < totalRow && w.amounts.has(i) && toMinor(amountAt(i).value, currency) < total) ?? -1;
  }
  const subtotal = subtotalRow >= 0 ? toMinor(amountAt(subtotalRow).value, currency) : undefined;

  const items: ParsedItem[] = w.items.map((d) => ({
    name: d.name,
    quantity: d.quantity,
    unitPrice: d.unitPrice !== undefined ? toMinor(d.unitPrice, currency) : undefined,
    amount: toMinor(d.amount, currency),
    confidence: d.confidence,
    sourceLine: d.sources.join(' / '),
  }));

  const charges: ParsedCharge[] = [];
  const chargeRows: number[] = [];
  const draftItemsSum = sum(items.map((i) => i.amount));
  let discounts = 0;
  for (const d of collectCharges(rows, w, limit, totalRow >= 0)) {
    let amount: Minor;
    if (d.value !== undefined) {
      amount = toMinor(d.value, currency);
    } else if (d.percent !== undefined) {
      const base = d.kind === 'discount' ? draftItemsSum : draftItemsSum + discounts;
      amount = Math.round((base * d.percent) / 100);
      if (d.kind === 'discount') amount = -Math.abs(amount);
    } else {
      continue;
    }
    if (amount === 0) continue;
    if (d.kind === 'discount') discounts += amount;
    charges.push({ kind: d.kind, label: d.label, amount, sourceLine: d.source });
    chargeRows.push(d.row);
  }

  if (total !== undefined) {
    items.push(...orphanItems(rows, w, draftItemsSum + sum(charges.map((c) => c.amount)), total, limit, currency));
  }
  const itemsSum = sum(items.map((i) => i.amount));
  let computedTotal = itemsSum + sum(charges.map((c) => c.amount));

  // Bills rounded to a whole rupee/dollar without printing the round-off line.
  const unit = Math.pow(10, currencyDecimals(currency));
  if (total !== undefined && unit > 1 && items.length && total % unit === 0 && !charges.some((c) => c.kind === 'roundoff')) {
    const diff = total - computedTotal;
    if (diff !== 0 && Math.abs(diff) * 2 <= unit) {
      charges.push({ kind: 'roundoff', label: 'Round off', amount: diff, sourceLine: '' });
      chargeRows.push(limit);
      computedTotal = total;
    }
  }

  const fmt = (m: Minor) => formatMoney(m, currency);
  const warnings: string[] = [];
  if (!items.length) {
    warnings.push("Couldn't find any items on this bill. Add them by hand, or retake the photo flat and in good light.");
  }
  if (subtotal !== undefined && items.length) {
    const beforeSubtotal = itemsSum + sum(charges.filter((_c, k) => chargeRows[k] < subtotalRow).map((c) => c.amount));
    if (itemsSum !== subtotal && beforeSubtotal !== subtotal) {
      warnings.push(`Items add up to ${fmt(beforeSubtotal)} but the bill subtotal says ${fmt(subtotal)}`);
    }
  }
  if (total !== undefined && computedTotal !== total) {
    warnings.push(`Items and charges add up to ${fmt(computedTotal)} but the bill total says ${fmt(total)}`);
  } else if (total === undefined && items.length) {
    warnings.push("Couldn't find the bill total. Check the amounts before splitting.");
  }

  return { currency, items, charges, subtotal, total, computedTotal, warnings };
}

/** How plausible a parse is: sums that reconcile with the printed subtotal/total count most. */
export function receiptScore(receipt: ParsedReceipt): number {
  const itemsSum = sum(receipt.items.map((i) => i.amount));
  let score = 0;
  if (receipt.total !== undefined) {
    score += 10;
    if (receipt.computedTotal === receipt.total) score += 100;
    else score -= Math.min(60, (Math.abs(receipt.computedTotal - receipt.total) / Math.max(1, Math.abs(receipt.total))) * 100);
  }
  if (receipt.subtotal !== undefined) {
    score += 5;
    const discounts = sum(receipt.charges.filter((c) => c.kind === 'discount').map((c) => c.amount));
    if (itemsSum === receipt.subtotal || itemsSum + discounts === receipt.subtotal) score += 30;
  }
  score += receipt.items.length * 3;
  score += sum(receipt.items.map((i) => i.confidence)) * 2;
  score -= receipt.warnings.length * 5;
  return score;
}

function detectMerchant(rows: Row[], start: number): string | undefined {
  const limit = Math.min(start, 8);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (row.kind !== 'text') continue;
    const label = row.label;
    const compact = label.replace(/\s+/g, '');
    if (letterCount(label) < 3 || NOT_A_MERCHANT.test(label)) continue;
    if (letterCount(compact) / compact.length < 0.6) continue;
    return label.length > 48 ? label.slice(0, 48).trim() : label;
  }
  return undefined;
}

function emptyReceipt(currency: CurrencyCode, warning: string): ParsedReceipt {
  return { currency, items: [], charges: [], computedTotal: 0, warnings: [warning] };
}

export function parseReceipt(lines: string[], opts?: { currencyHint?: CurrencyCode }): ParsedReceipt {
  const hint = opts?.currencyHint;
  try {
    const source = (Array.isArray(lines) ? lines : [])
      .filter((l): l is string => typeof l === 'string')
      .flatMap((l) => l.split(/\r?\n/));
    const rows = source.map((line, i) => analyzeRow(line, i)).filter((r) => r.kind !== 'blank');
    rows.forEach((r, k) => {
      r.index = k;
    });
    const currency = detectCurrency(source, hint);
    if (!rows.length) return emptyReceipt(currency, 'No text was found on this bill.');

    const start = findItemsStart(rows);
    const end = findItemsEnd(rows, start);
    let best: ParsedReceipt | null = null;
    let bestScore = -Infinity;
    for (const mode of ['next', 'prev'] as Mode[]) {
      const receipt = assemble(rows, walk(rows, start, end, mode), currency);
      const score = receiptScore(receipt);
      if (score > bestScore) {
        best = receipt;
        bestScore = score;
      }
    }
    const result = best as ParsedReceipt;
    const merchant = detectMerchant(rows, start);
    const date = detectDate(source, isMonthFirstCurrency(currency));
    if (merchant) result.merchant = merchant;
    if (date) result.date = date;
    return result;
  } catch {
    return emptyReceipt(hint && hint.trim() ? hint : 'INR', "Couldn't read this bill. Enter the items by hand.");
  }
}
