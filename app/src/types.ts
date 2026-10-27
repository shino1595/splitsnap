// Shared domain types for SplitSnap. This file is the contract between the
// engine (src/lib), the OCR module (src/ocr), the store and the screens.
// All money is held as integers in the currency's minor unit (paise, cents).

import type { AppearancePreference } from './theme';

export type ID = string;
/** ISO 4217 code, e.g. 'INR', 'USD'. */
export type CurrencyCode = string;
/** Integer amount in minor units (e.g. 12345 = ₹123.45). Never a float. */
export type Minor = number;
/** Calendar date as 'YYYY-MM-DD' (local, no time zone). */
export type ISODate = string;
/** Timestamp as an ISO 8601 string (new Date().toISOString()). */
export type ISODateTime = string;

/** The person using the app always has this id. */
export const ME_ID = 'me';

export interface Person {
  id: ID;
  name: string;
  email?: string;
  phone?: string;
  /** UPI VPA such as 'aarav@okhdfc', used for "Pay via UPI" in settle up. */
  upiId?: string;
  /** Avatar background colour (hex). */
  color: string;
  createdAt: ISODateTime;
}

export type GroupType = 'trip' | 'home' | 'couple' | 'other';

export interface Group {
  id: ID;
  name: string;
  type: GroupType;
  /** Single emoji shown as the group's picture. */
  emoji: string;
  /** Always includes ME_ID. */
  memberIds: ID[];
  /** Splitwise "simplify group debts". */
  simplifyDebts: boolean;
  defaultCurrency: CurrencyCode;
  createdAt: ISODateTime;
  archived?: boolean;
}

export type CategoryId =
  | 'general'
  | 'food'
  | 'groceries'
  | 'drinks'
  | 'transport'
  | 'fuel'
  | 'parking'
  | 'travel'
  | 'hotel'
  | 'rent'
  | 'utilities'
  | 'internet'
  | 'entertainment'
  | 'shopping'
  | 'medical'
  | 'gifts'
  | 'sports'
  | 'other';

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares' | 'adjustment' | 'itemized';

/**
 * The user's raw split input, kept so the expense can be re-opened and edited.
 * `computeOwed` (src/lib/split.ts) turns it into exact owed amounts.
 */
export type SplitInput =
  | { method: 'equal'; participantIds: ID[] }
  /** Exact amount owed by each person. Must add up to the total. */
  | { method: 'exact'; amounts: Record<ID, Minor> }
  /** Percent owed by each person (may have decimals). Must add up to 100. */
  | { method: 'percent'; percents: Record<ID, number> }
  /** Share weights, e.g. { a: 2, b: 1 } = a pays two thirds. Zero/absent = not involved. */
  | { method: 'shares'; shares: Record<ID, number> }
  /**
   * Splitwise "adjustment": the total minus all adjustments is split equally among
   * participantIds, then each person's adjustment (may be negative) is added on top.
   */
  | { method: 'adjustment'; participantIds: ID[]; adjustments: Record<ID, Minor> }
  | { method: 'itemized'; bill: ItemizedBill };

export interface BillItem {
  id: ID;
  name: string;
  /** Quantity printed on the bill (e.g. 6 for "6 Naan"). Informational; amount is the line total. */
  quantity: number;
  /** Line total for this item in minor units. */
  amount: Minor;
  /**
   * Who shares this item and in what proportion. { a: 1, c: 1 } = a and c split it equally.
   * { a: 2, b: 1 } = a had two portions, b one. Empty object = not assigned yet.
   */
  shares: Record<ID, number>;
}

export type ChargeKind = 'tax' | 'service' | 'tip' | 'discount' | 'roundoff' | 'other';

export interface BillCharge {
  id: ID;
  kind: ChargeKind;
  /** As printed, e.g. 'CGST 2.5%', 'Service Charge'. */
  label: string;
  /** Positive adds to the bill; negative (discount, round-off down) reduces it. */
  amount: Minor;
  /**
   * 'proportional' = shared in proportion to each person's item subtotal (default, how
   * tax and service charge really work). 'equal' = shared equally by everyone who has items.
   */
  allocation: 'proportional' | 'equal';
}

export interface ItemizedBill {
  items: BillItem[];
  charges: BillCharge[];
  merchant?: string;
  /** True when the items came from a scanned bill photo. */
  scanned?: boolean;
  /** Grand total read from the bill, kept to warn about mismatches. */
  printedTotal?: Minor;
}

export interface MoneyShare {
  personId: ID;
  amount: Minor;
}

export type RecurrenceFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'yearly';

export interface Recurrence {
  frequency: RecurrenceFrequency;
  /** Next date a copy of this expense will be created. */
  nextDate: ISODate;
}

export interface Comment {
  id: ID;
  authorId: ID;
  text: string;
  createdAt: ISODateTime;
}

export interface Expense {
  id: ID;
  /** null = non-group expense between friends. */
  groupId: ID | null;
  description: string;
  category: CategoryId;
  currency: CurrencyCode;
  /** Positive total in minor units. */
  total: Minor;
  date: ISODate;
  notes?: string;
  /** Local URI or data: URI of the attached bill photo. */
  receiptUri?: string;
  /** Who paid and how much. Sum == total. */
  payers: MoneyShare[];
  /** Raw split input (for editing). */
  split: SplitInput;
  /** Computed amount each person owes. Sum == total. Zero entries are omitted. */
  owed: MoneyShare[];
  recurrence?: Recurrence;
  /** Set on copies generated from a recurring expense. */
  recurringParentId?: ID;
  comments: Comment[];
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Soft delete; deleted expenses can be restored and are ignored by balances. */
  deletedAt?: ISODateTime;
}

export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'other';

/** A settle-up: `fromId` paid `toId` real money. */
export interface Payment {
  id: ID;
  groupId: ID | null;
  fromId: ID;
  toId: ID;
  amount: Minor;
  currency: CurrencyCode;
  date: ISODate;
  note?: string;
  method: PaymentMethod;
  createdAt: ISODateTime;
  deletedAt?: ISODateTime;
}

export type ActivityType =
  | 'expense_added'
  | 'expense_updated'
  | 'expense_deleted'
  | 'expense_restored'
  | 'payment_added'
  | 'payment_deleted'
  | 'group_created'
  | 'group_updated'
  | 'group_deleted'
  | 'member_added'
  | 'member_removed'
  | 'friend_added'
  | 'friend_updated'
  | 'friend_removed'
  | 'settings_updated'
  | 'comment_added';

export interface Activity {
  id: ID;
  type: ActivityType;
  at: ISODateTime;
  actorId: ID;
  groupId?: ID | null;
  expenseId?: ID;
  paymentId?: ID;
  /** The friend a friend_added / friend_updated / friend_removed entry is about. */
  personId?: ID;
  /** Ready-to-show sentence, e.g. 'You added "Dinner" in Goa Trip.' */
  summary: string;
  amount?: Minor;
  currency?: CurrencyCode;
}

// Written via a const array: Snack's in-browser Babel cannot parse numeric literal types
// such as `1 | 2 | 3` in .ts files.
export const OCR_ENGINE_IDS = [1, 2, 3] as const;
export type OcrEngine = (typeof OCR_ENGINE_IDS)[number];

export interface Settings {
  defaultCurrency: CurrencyCode;
  /** OCR.space API key. Empty string = use the public demo key 'helloworld'. */
  ocrApiKey: string;
  ocrEngine: OcrEngine;
  /** Default for new groups. */
  simplifyDebtsDefault: boolean;
  /** Light, dark, or follow the phone ('system', the default). */
  appearance: AppearancePreference;
}

/** Bumped when the persisted shape changes. (A const, not a `1` literal type: see OCR_ENGINE_IDS.) */
export const SCHEMA_VERSION = 1;

export interface AppState {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Everyone known to the app, including ME_ID. */
  people: Record<ID, Person>;
  /** People shown on the Friends tab (never includes ME_ID). */
  friendIds: ID[];
  groups: Record<ID, Group>;
  expenses: Record<ID, Expense>;
  payments: Record<ID, Payment>;
  /** Newest first. */
  activity: Activity[];
  settings: Settings;
}

// ---------- Balances ----------

/** `fromId` owes `toId` `amount` (> 0) in `currency`. */
export interface Debt {
  fromId: ID;
  toId: ID;
  amount: Minor;
  currency: CurrencyCode;
}

/** Amount per currency, e.g. { INR: 50000, USD: -1200 }. */
export type CurrencyAmounts = Record<CurrencyCode, Minor>;

// ---------- Expense editor draft (shared by AddExpense, SplitOptions, ScanBill, ItemizedSplit) ----------

export interface ExpenseDraft {
  /** Set when editing an existing expense. */
  editingId?: ID;
  groupId: ID | null;
  /** Everyone involved (group members, or you + chosen friends). Always includes ME_ID. */
  participantIds: ID[];
  description: string;
  /** Raw text in the amount box, e.g. '1390.50'. */
  amountText: string;
  currency: CurrencyCode;
  category: CategoryId;
  date: ISODate;
  notes: string;
  /** null = "paid by you, full amount". Otherwise explicit payers (sum must equal total). */
  payers: MoneyShare[] | null;
  split: SplitInput;
  receiptUri?: string;
  recurrence?: Recurrence;
}

/** What the store's addExpense / updateExpense accept. The store computes `owed`. */
export interface ExpenseInput {
  groupId: ID | null;
  description: string;
  category: CategoryId;
  currency: CurrencyCode;
  total: Minor;
  date: ISODate;
  notes?: string;
  receiptUri?: string;
  payers: MoneyShare[];
  split: SplitInput;
  recurrence?: Recurrence;
}

export interface PaymentInput {
  groupId: ID | null;
  fromId: ID;
  toId: ID;
  amount: Minor;
  currency: CurrencyCode;
  date: ISODate;
  note?: string;
  method: PaymentMethod;
}
