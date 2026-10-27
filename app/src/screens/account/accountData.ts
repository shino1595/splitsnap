// Pure helpers for the Account and Settings screens. No React / React Native imports.
import { ME_ID } from '../../types';
import type { AppState, CurrencyAmounts, ID, ISODate, OcrEngine, Settings } from '../../types';
import { addAmounts } from '../../lib/balances';
import { buildCsv } from '../../lib/csv';
import { CURRENCIES, currencyInfo } from '../../lib/money';
import { liveExpenses, livePayments } from '../../store/selectors';

export interface AccountStats {
  groups: number;
  archivedGroups: number;
  friends: number;
  expenses: number;
  /** What I paid towards live expenses, per currency (settle-up payments excluded). */
  youPaid: CurrencyAmounts;
  /** My share of live expenses, per currency. */
  yourShare: CurrencyAmounts;
}

export function accountStats(state: AppState): AccountStats {
  const groups = Object.values(state.groups);
  const expenses = liveExpenses(state);
  let youPaid: CurrencyAmounts = {};
  let yourShare: CurrencyAmounts = {};
  for (const e of expenses) {
    for (const p of e.payers) if (p.personId === ME_ID) youPaid = addAmounts(youPaid, { [e.currency]: p.amount });
    for (const o of e.owed) if (o.personId === ME_ID) yourShare = addAmounts(yourShare, { [e.currency]: o.amount });
  }
  return {
    groups: groups.filter((g) => !g.archived).length,
    archivedGroups: groups.filter((g) => !!g.archived).length,
    friends: state.friendIds.filter((id) => id !== ME_ID && !!state.people[id]).length,
    expenses: expenses.length,
    youPaid,
    yourShare,
  };
}

/** Everyone who appears in a live expense or payment: you first, then by name. */
export function csvPersonIds(state: AppState): ID[] {
  const ids = new Set<ID>();
  for (const e of liveExpenses(state)) {
    e.payers.forEach((p) => ids.add(p.personId));
    e.owed.forEach((o) => ids.add(o.personId));
  }
  for (const p of livePayments(state)) {
    ids.add(p.fromId);
    ids.add(p.toId);
  }
  ids.delete(ME_ID);
  const nameOf = (id: ID) => (state.people[id]?.name ?? '').toLowerCase();
  const others = Array.from(ids).sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : a < b ? -1 : 1));
  return [ME_ID, ...others];
}

export interface CsvExport {
  filename: string;
  csv: string;
  /** Expenses + payments included. */
  count: number;
}

/** All live expenses and payments across every group, or null when there is nothing to export. */
export function buildFullExport(state: AppState, today: ISODate): CsvExport | null {
  const expenses = liveExpenses(state);
  const payments = livePayments(state);
  const count = expenses.length + payments.length;
  if (count === 0) return null;
  const csv = buildCsv({ expenses, payments, people: state.people, personIds: csvPersonIds(state) });
  return { filename: `splitsnap-${today}.csv`, csv, count };
}

/** Loose check, enough to catch typos like a missing '@' or domain. Empty is allowed (email is optional). */
export function emailError(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'That doesn’t look like an email address';
}

export const OCR_FREE_KEY_URL = 'https://ocr.space/ocrapi/freekey';

export interface EngineOption {
  engine: OcrEngine;
  title: string;
  description: string;
}

export const OCR_ENGINES: EngineOption[] = [
  { engine: 1, title: 'Engine 1', description: 'Fastest. Fine for clean, high-contrast printed text.' },
  { engine: 2, title: 'Engine 2', description: 'Recommended for receipts: best with numbers, prices and columns. Default.' },
  { engine: 3, title: 'Engine 3', description: 'Most accurate, but slower and with a smaller free quota.' },
];

export interface CurrencyOption {
  value: string;
  label: string;
  subtitle: string;
}

/** Rows for a currency OptionPicker, with the current code first if it is not a known currency. */
export function currencyOptions(current?: string): CurrencyOption[] {
  const options = CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}`, subtitle: c.symbol.trim() }));
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current, subtitle: '' });
  return options;
}

/** 'INR · Indian Rupee' (or just the code when unknown). */
export function currencyLabel(code: string): string {
  const info = currencyInfo(code);
  return info.name && info.name !== code ? `${code} · ${info.name}` : code;
}

/** True when the user has entered their own OCR.space key (otherwise the shared demo key is used). */
export function hasOwnOcrKey(settings: Pick<Settings, 'ocrApiKey'>): boolean {
  return settings.ocrApiKey.trim().length > 0;
}

/** One line for the Account screen: 'Your OCR.space key · Engine 2' or 'Shared demo key · Engine 2'. */
export function scanningSummary(settings: Pick<Settings, 'ocrApiKey' | 'ocrEngine'>): string {
  return `${hasOwnOcrKey(settings) ? 'Your OCR.space key' : 'Shared demo key'} · Engine ${settings.ocrEngine}`;
}

/** Keys are pasted from an email or web page: drop spaces and line breaks picked up on the way. */
export function cleanOcrKey(text: string): string {
  return text.replace(/\s+/g, '');
}
