// Static data and small helpers shared by the group screens.
import { ME_ID } from '../../../types';
import type { CurrencyAmounts, Debt, GroupType } from '../../../types';
import { colors } from '../../../theme';

export interface GroupTypeInfo {
  value: GroupType;
  label: string;
  icon: string;
  /** Picture used for a new group of this type until the user picks one. */
  emoji: string;
  /** Background of the emoji tile. */
  tint: string;
}

export const GROUP_TYPES: GroupTypeInfo[] = [
  { value: 'trip', label: 'Trip', icon: 'airplane-outline', emoji: '✈️', get tint() { return colors.infoSoft; } },
  { value: 'home', label: 'Home', icon: 'home-outline', emoji: '🏠', get tint() { return colors.warningSoft; } },
  { value: 'couple', label: 'Couple', icon: 'heart-outline', emoji: '❤️', get tint() { return colors.dangerSoft; } },
  { value: 'other', label: 'Other', icon: 'people-outline', emoji: '👥', get tint() { return colors.primarySoft; } },
];

export function groupTypeInfo(type: GroupType): GroupTypeInfo {
  return GROUP_TYPES.find((t) => t.value === type) ?? GROUP_TYPES[GROUP_TYPES.length - 1];
}

/** Choices for the group picture grid (single code points or VS16 pairs that render everywhere). */
export const GROUP_EMOJIS: string[] = [
  '✈️', '🏖️', '🏔️', '🏕️', '🚗', '🌴',
  '🏠', '🏢', '🛋️', '🔑', '❤️', '💑',
  '👥', '🎉', '🍕', '🍻', '☕', '🎬',
  '⚽', '🎓', '💼', '🛒', '🎁', '🐶',
];

export function plural(n: number, word: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? word : pluralWord ?? `${word}s`}`;
}

export function memberCountLabel(n: number): string {
  return plural(n, 'person', 'people');
}

/** 'Goa Trip 🏖️' → 'goa-trip'; empty → 'group'. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'group';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Your row in a member list: 'Sam (you)', or just 'You' when that is your name. */
export function meLabel(name: string | undefined): string {
  const n = (name ?? '').trim();
  return !n || n.toLowerCase() === 'you' ? 'You' : `${n} (you)`;
}

/** Only the amounts above zero (what you are owed). */
export function positivePart(amounts: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const code of Object.keys(amounts)) if (amounts[code] > 0) out[code] = amounts[code];
  return out;
}

/** Only the amounts below zero, made positive (what you owe). */
export function negativePart(amounts: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const code of Object.keys(amounts)) if (amounts[code] < 0) out[code] = -amounts[code];
  return out;
}

export function involvesMe(debt: Debt): boolean {
  return debt.fromId === ME_ID || debt.toId === ME_ID;
}

/** Debts involving me first, then largest amount first; stable by names' ids. */
export function sortDebtsForMe(debts: Debt[]): Debt[] {
  return [...debts].sort((a, b) => {
    const mine = Number(involvesMe(b)) - Number(involvesMe(a));
    if (mine !== 0) return mine;
    if (a.amount !== b.amount) return b.amount - a.amount;
    const ka = `${a.fromId}>${a.toId}>${a.currency}`;
    const kb = `${b.fromId}>${b.toId}>${b.currency}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * The few debt lines a header has room for, in `debts` order (as sortDebtsForMe gives them),
 * but first one line for each currency and direction: amounts in different currencies can't be
 * compared, so a lone 'You owe Aarav $28.00' is not hidden behind larger rupee lines.
 */
export function headerDebtLines(debts: Debt[], max: number): Debt[] {
  const kind = (d: Debt) => `${d.currency}|${d.fromId === ME_ID ? 'owe' : 'owed'}`;
  const seen: string[] = [];
  const picked: Debt[] = [];
  for (const d of debts) {
    if (picked.length < max && seen.indexOf(kind(d)) < 0) {
      seen.push(kind(d));
      picked.push(d);
    }
  }
  for (const d of debts) if (picked.length < max && picked.indexOf(d) < 0) picked.push(d);
  return debts.filter((d) => picked.indexOf(d) >= 0);
}
