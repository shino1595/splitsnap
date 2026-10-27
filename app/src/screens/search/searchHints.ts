// Pure helpers for the Search screen. No React / React Native imports.
import { ME_ID } from '../../types';
import type { AppState, Expense } from '../../types';
import { formatMoney } from '../../lib/money';
import { personName } from '../../store/selectors';

export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

const includesAny = (text: string, terms: string[]): boolean => {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.indexOf(t) >= 0);
};

/** ~60 characters of `text` around the first matching term, with ellipses where cut. */
export function snippetAround(text: string, terms: string[], width = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= width) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - Math.floor(width / 3), flat.length - width));
  const end = Math.min(flat.length, start + width);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/**
 * Why an expense matched when its description alone does not explain it:
 * 'Items: Naan, Butter Chicken', 'Note: …', 'Bill from Punjab Grill' or 'With Aarav'.
 * Null when the description already contains every term.
 */
export function matchHint(state: AppState, expense: Expense, query: string): string | null {
  const terms = searchTerms(query);
  if (terms.length === 0) return null;
  const description = expense.description.toLowerCase();
  const missing = terms.filter((t) => description.indexOf(t) < 0);
  if (missing.length === 0) return null;

  if (expense.split.method === 'itemized') {
    const items = expense.split.bill.items.filter((item) => includesAny(item.name, missing)).map((item) => item.name.trim());
    if (items.length > 0) {
      const shown = items.slice(0, 3).join(', ');
      return `${items.length === 1 ? 'Item' : 'Items'}: ${shown}${items.length > 3 ? ` +${items.length - 3}` : ''}`;
    }
    const merchant = expense.split.bill.merchant;
    if (merchant && includesAny(merchant, missing)) return `Bill from ${merchant.trim()}`;
  }
  if (expense.notes && includesAny(expense.notes, missing)) return `Note: ${snippetAround(expense.notes, missing)}`;

  const people = new Set<string>();
  for (const share of [...expense.payers, ...expense.owed]) {
    const name = personName(state, share.personId, { you: false });
    if (share.personId === ME_ID) {
      if (includesAny(name, missing) || includesAny('you', missing)) people.add('you');
    } else if (includesAny(name, missing)) {
      people.add(name);
    }
  }
  if (people.size > 0) return `With ${Array.from(people).slice(0, 3).join(', ')}`;
  return null;
}

/** 'Bhavna paid ₹1,460.00', 'You paid ₹500.00' or '2 people paid ₹3,000.00'. */
export function paidByText(state: AppState, expense: Expense): string {
  const total = formatMoney(expense.total, expense.currency);
  const payers = expense.payers.filter((p) => p.amount !== 0);
  if (payers.length === 1) return `${personName(state, payers[0].personId)} paid ${total}`;
  return `${payers.length} people paid ${total}`;
}
