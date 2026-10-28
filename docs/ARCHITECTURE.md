# SplitSnap — architecture and module contract

SplitSnap is a Splitwise-style bill-splitting prototype for iOS and Android, built with
React Native + Expo **SDK 54** (code also type-checks against SDK 55) and run through **Expo Snack** (no local Node.js; nothing may
be installed on the developer PC). Bills can be photographed or picked from the gallery;
OCR.space reads the text and our own parser turns it into items, prices, tax and total,
which then feed an **item-by-item split** (each item shared by any subset of people, with
optional unequal portions).

Everything in this file is a contract: several agents build modules in parallel against it.
Do not rename exported symbols, files or route names. If something is genuinely missing, add
it (new exports are fine) but never change an existing signature.

---------------------------------------------------------------------------------------------
## 1. Hard rules (apply to every file under `app/`)

1. **TypeScript, strict.** `.ts` / `.tsx` only. No `any` unless unavoidable (comment why).
2. **Relative imports only** (`../lib/money`). No path aliases, no `@/`.
3. **Allowed third-party imports — nothing else:**
   `react`, `react-native`, `@react-navigation/native`, `@react-navigation/native-stack`,
   `@react-navigation/bottom-tabs`, `react-native-safe-area-context`, `react-native-screens`,
   `@react-native-async-storage/async-storage`, `expo-image-picker`, `expo-image-manipulator`,
   `expo-document-picker` (loaded with `import()`, like the photo libraries),
   `@supabase/supabase-js` and `react-native-url-polyfill` (shared groups only, loaded with
   `import()` in `src/sync/supabaseClient.ts`; nothing else imports them),
   `@expo/vector-icons` (use **Ionicons** only, with glyph names that exist in Ionicons 7, e.g.
   `restaurant-outline`, `cart-outline`, `car-outline`, `camera-outline`, `images-outline`,
   `people-outline`, `person-outline`, `receipt-outline`, `add`, `close`, `checkmark`,
   `chevron-forward`, `trash-outline`, `create-outline`, `cash-outline`, `swap-horizontal`,
   `search`, `settings-outline`, `pulse-outline`, `home-outline`, `airplane-outline`,
   `heart-outline`, `ellipsis-horizontal`, `share-outline`, `notifications-outline`,
   `pie-chart-outline`, `bar-chart-outline`, `calendar-outline`, `repeat-outline`,
   `chatbubble-outline`, `scan-outline`, `sparkles-outline`, `alert-circle-outline`,
   `information-circle-outline`, `wallet-outline`, `gift-outline`, `medkit-outline`,
   `bed-outline`, `bus-outline`, `flash-outline`, `wifi-outline`, `film-outline`,
   `beer-outline`, `basket-outline`, `pricetag-outline`, `football-outline`, `water-outline`).
   No other npm packages (no lodash, date-fns, zustand, uuid, svg, gesture-handler, reanimated).
4. **Must run on iOS, Android and web (Snack web preview = react-native-web):**
   - Never call `Alert.alert` directly (it is a no-op on web). Use `confirmAsync` /
     `showAlert` from `src/ui/dialogs.ts`.
   - No `@react-native-community/datetimepicker`; use our `DateField` component.
   - Sharing: use `shareText` / `shareFile` from `src/ui/share.ts`.
   - No `Intl` (format money/dates with `src/lib/money.ts` and `src/lib/dates.ts`).
   - Avoid `position: 'fixed'`, `gap` is fine (RN 0.71+ and RN-web support it).
5. **Money is always integer minor units** (`Minor`). Convert only at the edges
   (`parseAmountInput` from text, `formatMoney` for display). Splits must add up exactly;
   use `allocate()` (largest remainder) — never `Math.round(total / n)` alone.
6. Pure logic lives in `src/lib` and `src/ocr` (no React imports there, except
   `src/ocr/imagePrep.ts` and `src/ocr/ocrSpace.ts`, which may import Expo/RN modules).
   Pure modules must not import `react-native` so they can be unit-tested in a browser.
7. Styling with tokens from `src/theme.ts`, light and dark. Build sheets with `const styles = themed((colors) => StyleSheet.create({...}))` and read `colors.*` only while rendering, never in module-level constants (typecheck rule SPLITSNAP4). The palette is switched in App.tsx from Settings → Appearance (system / light / dark).
8. Every screen handles empty states and missing records (deleted group/expense → show an
   `EmptyState` and a way back, never crash).
9. Keep comments sparse and useful. No commented-out code.
10. **No costs beyond the user's Claude subscription.** Never use or add anything that is billed separately or needs payment: no paid APIs (no Claude/OpenAI vision), no paid OCR or cloud tiers, no paid Expo/EAS services. Free tiers only (OCR.space free/demo key, Expo Snack, Expo Go). If something would cost money, stop and ask the user.

---------------------------------------------------------------------------------------------
## 2. Folder layout

```
2026-10-03_Splitwise_Clone_App/
  app/                         ← the Snack project (only this folder is sent to Snack)
    App.tsx                    ← providers + navigator
    src/
      types.ts                 ← domain types (DONE — do not edit signatures)
      theme.ts                 ← design tokens (DONE)
      lib/                     ← pure engine (money, split, itemized, balances, …)
      ocr/                     ← OCR.space client, image prep, receipt parser, sample bill
      store/                   ← AppStore (context + reducer + persistence), selectors, draft, seed
      ui/                      ← reusable components + dialogs + share helpers
      navigation/              ← RootNavigator.tsx, types.ts (types DONE)
      screens/                 ← one folder per area (see §7)
  tests/                       ← unit tests (NOT sent to Snack), run in headless Edge
    lib/*.test.ts  ocr/*.test.ts  ocr/fixtures/*.ts
  tools/                       ← PowerShell + HTML harnesses (headless Edge), Snack launcher
  docs/ARCHITECTURE.md         ← this file
  open-in-snack.html           ← generated launcher (hands app/ to an embedded snack.expo.dev)
```

---------------------------------------------------------------------------------------------
## 3. `src/lib` — pure engine (no React, no react-native)

### lib/money.ts
```ts
export interface CurrencyInfo { code: CurrencyCode; symbol: string; name: string; decimals: number }
export const CURRENCIES: CurrencyInfo[];            // at least INR, USD, EUR, GBP, SGD, AED, AUD, CAD, JPY, THB, HKD, CHF
export function currencyInfo(code: CurrencyCode): CurrencyInfo;   // unknown code → {code, symbol: code+' ', decimals: 2}
export function currencyDecimals(code: CurrencyCode): number;
/** Drops typed digits beyond `decimals` after a single "." ("12.345", 2 → "12.34"; "1500.5", 0 → "1500"). */
export function limitDecimals(text: string, decimals: number): string;
export function toMinor(major: number, currency: CurrencyCode): Minor;          // rounds half away from zero
export function toMajor(minor: Minor, currency: CurrencyCode): number;
/** '1,390.5' / '₹1390.50' / ' 1390 ' → 139050; '' / 'abc' / '1.2.3' → null. Negative allowed only if opts.allowNegative. */
export function parseAmountInput(text: string, currency: CurrencyCode, opts?: { allowNegative?: boolean }): Minor | null;
/** Amount → plain editable text without symbol/grouping, e.g. 139050 → '1390.50', 100000 → '1000'. */
export function minorToInputText(minor: Minor, currency: CurrencyCode): string;
/** 139050,'INR' → '₹1,390.50'; INR uses Indian grouping (₹1,23,456.00); others 3-digit groups.
 *  opts.signed adds '+'/'−'; opts.abs formats the absolute value; opts.compact drops '.00'. */
export function formatMoney(minor: Minor, currency: CurrencyCode, opts?: { signed?: boolean; abs?: boolean; compact?: boolean }): string;
/** Largest-remainder allocation of `total` by non-negative `weights`. Result sums to total exactly.
 *  Ties broken by lower index first. All-zero weights → throws. Works for negative totals (mirror). */
export function allocate(total: Minor, weights: number[]): Minor[];
export function splitEvenly(total: Minor, n: number): Minor[];   // allocate(total, n×1)
export function sumMinor(values: Minor[]): Minor;
export function formatCurrencyAmounts(amounts: CurrencyAmounts, opts?: { abs?: boolean }): string; // '₹500.00 + $12.00', skips zeros, '' if none
```

### lib/split.ts
```ts
export interface SplitResult { owed: MoneyShare[]; errors: string[] }   // owed omits zero entries; errors empty when valid
/** Turns a SplitInput into exact owed amounts that sum to `total`. Never throws; invalid input → errors (and best-effort owed). */
export function computeOwed(total: Minor, split: SplitInput, currency: CurrencyCode): SplitResult;
export function splitMethodLabel(method: SplitMethod): string;        // 'Equally', 'Exact amounts', 'Percentages', 'Shares', 'Adjustment', 'Itemized'
/** Short human summary, e.g. 'Split equally among 4', 'Itemized · 5 items'. */
export function describeSplit(split: SplitInput): string;
/** Default split for a participant list: equal among everyone. */
export function defaultSplit(participantIds: ID[]): SplitInput;
/** Convert the current split into another method for the same participants, keeping the
 *  same owed amounts where possible (used when switching tabs in SplitOptions). */
export function convertSplit(total: Minor, from: SplitInput, to: SplitMethod, participantIds: ID[], currency: CurrencyCode): SplitInput;
export function participantsOf(split: SplitInput): ID[];
/** Validates payers: non-empty, positive amounts, sum == total. Returns error strings. */
export function validatePayers(total: Minor, payers: MoneyShare[], currency: CurrencyCode): string[];
```
Rules: equal → `splitEvenly` over participantIds (in given order). exact → must sum to total
(error shows the difference with `formatMoney`). percent → must sum to 100 (±0.001), amounts
via `allocate(total, percents)`. shares → `allocate(total, shares)`, at least one > 0.
adjustment → base = total − Σadjustments, `splitEvenly(base, participants)` then add each
adjustment (people with an adjustment but not in participantIds still get their adjustment);
error if base < 0. itemized → `computeItemized(bill)`; the itemized total must equal `total`
(error otherwise) — owed = per-person totals.

### lib/itemized.ts
```ts
export interface PersonItemLine { itemId: ID; name: string; amount: Minor; portion: string }   // portion e.g. '1/4', '2/3'
export interface PersonBreakdown { personId: ID; itemsSubtotal: Minor; charges: Minor; total: Minor; lines: PersonItemLine[]; chargeLines: { chargeId: ID; label: string; amount: Minor }[] }
export interface ItemizedResult {
  total: Minor;                       // Σ items + Σ charges
  itemsSubtotal: Minor;
  chargesTotal: Minor;
  perPerson: PersonBreakdown[];        // only people with a non-zero total, ordered by first appearance
  unassignedItemIds: ID[];             // items with no shares (their amount is NOT allocated)
  errors: string[];                   // e.g. 'Assign "Naan" to at least one person', negative totals
}
export function computeItemized(bill: ItemizedBill): ItemizedResult;
export function itemizedTotal(bill: ItemizedBill): Minor;      // Σ item amounts + Σ charge amounts
export function newBillItem(name: string, amount: Minor, quantity?: number, shares?: Record<ID, number>): BillItem;
export function newBillCharge(kind: ChargeKind, label: string, amount: Minor): BillCharge;   // allocation 'proportional'
/** Set an item to be shared equally by exactly `personIds` (1 portion each). */
export function assignEqually(item: BillItem, personIds: ID[]): BillItem;
/** Toggle a person on/off an item (on = 1 portion). */
export function togglePerson(item: BillItem, personId: ID): BillItem;
/** Set a person's portions on an item (0 removes them). */
export function setPortions(item: BillItem, personId: ID, portions: number): BillItem;
/** Assign every unassigned item to all `personIds`. */
export function assignUnassignedToAll(bill: ItemizedBill, personIds: ID[]): ItemizedBill;
```
Algorithm: each item's amount is split with `allocate(item.amount, portions)` among its
sharers (order = key order of `shares`). Charges: 'proportional' → `allocate(charge.amount,
itemsSubtotalPerPerson)`; 'equal' → split evenly among people with a non-zero item subtotal.
If nobody has items yet, charges are not allocated (error). Result per person sums exactly;
Σ perPerson.total == total − Σ unassigned item amounts.

### lib/balances.ts
```ts
/** paid − owed per person for one expense (or payment treated as payer=fromId, owed=toId). */
export function expenseNet(e: { payers: MoneyShare[]; owed: MoneyShare[] }): Record<ID, Minor>;
export function paymentNet(p: Payment): Record<ID, Minor>;     // { [fromId]: +amount, [toId]: −amount }
/** Net balance per currency per person over live (non-deleted) expenses and payments. + = is owed money. */
export function computeNets(expenses: Expense[], payments: Payment[]): Record<CurrencyCode, Record<ID, Minor>>;
/** Who owes whom without simplification: each expense's debtors pay its creditors pro rata
 *  (allocate), aggregated per ordered pair and netted (a→b and b→a cancel). Payments included. */
export function pairwiseDebts(expenses: Expense[], payments: Payment[]): Debt[];
/** simplify=true → simplifyDebts on computeNets per currency; else pairwiseDebts. */
export function debtsFor(expenses: Expense[], payments: Payment[], simplify: boolean): Debt[];
/** What `other` owes `me` per currency (+ = other owes me, − = I owe other). */
export function balanceBetween(debts: Debt[], me: ID, other: ID): CurrencyAmounts;
export interface BalanceSummary { owedToMe: CurrencyAmounts; iOwe: CurrencyAmounts; net: CurrencyAmounts }   // owedToMe/iOwe positive
export function summarizeFor(debts: Debt[], personId: ID): BalanceSummary;
/** For list rows: 'you lent ₹300' / 'you borrowed ₹90' / 'not involved'. */
export function expenseImpact(e: Expense, personId: ID): { paid: Minor; owed: Minor; net: Minor };
export function addAmounts(a: CurrencyAmounts, b: CurrencyAmounts): CurrencyAmounts;   // drops zero keys
export function negateAmounts(a: CurrencyAmounts): CurrencyAmounts;
export function isSettled(a: CurrencyAmounts): boolean;                               // all zero / empty
```

### lib/simplify.ts
```ts
/** Minimum-ish set of transfers that settles `nets` (Σ nets must be 0; ignores zero entries).
 *  Greedy: repeatedly match largest debtor with largest creditor; ties by id for determinism. */
export function simplifyDebts(nets: Record<ID, Minor>, currency: CurrencyCode): Debt[];
```

### lib/dates.ts
```ts
export function todayISO(now?: Date): ISODate;                       // local date
export function parseISODate(d: ISODate): Date;                      // local midnight
export function toISODate(d: Date): ISODate;
export function addDays(d: ISODate, n: number): ISODate;
export function addMonths(d: ISODate, n: number): ISODate;           // clamps day (31 Jan +1 → 28/29 Feb)
export function formatDate(d: ISODate, style?: 'short' | 'long'): string;   // 'Oct 3' / 'Oct 3, 2026' (year shown in short only if not current year)
export function monthKey(d: ISODate): string;                        // '2026-10'
export function monthLabel(key: string): string;                     // 'October 2026'
export function relativeTime(iso: ISODateTime, now?: Date): string;  // 'just now', '5 min ago', 'yesterday', 'Oct 3'
export function compareDesc(a: ISODate, b: ISODate): number;
```

### lib/recurrence.ts
```ts
export function advance(date: ISODate, f: RecurrenceFrequency): ISODate;
/** Dates from r.nextDate up to and including `today` (max 24), and the next date after them. With `anchor` (the expense's own date) later dates follow its series, so 31 Aug → 30 Sep → 31 Oct. */
export function dueDates(r: Recurrence, today: ISODate, anchor?: ISODate): { dates: ISODate[]; nextDate: ISODate };
/** First date of the series starting on `anchor` that falls after `after`. */
export function nextOccurrenceAfter(anchor: ISODate, f: RecurrenceFrequency, after: ISODate): ISODate;
export function frequencyLabel(f: RecurrenceFrequency): string;     // 'Every week', …
```

### lib/categories.ts
```ts
export interface CategoryInfo { id: CategoryId; label: string; icon: string /* Ionicons glyph */; color: string }
export const CATEGORIES: CategoryInfo[];        // one per CategoryId
export function categoryInfo(id: CategoryId): CategoryInfo;
/** Keyword guess from a description: 'Dinner at Punjab Grill' → 'food', 'Uber' → 'transport', 'Airbnb' → 'hotel'. Default 'general'. */
export function guessCategory(description: string): CategoryId;
```

### lib/csv.ts
```ts
/** RFC 4180 CSV of expenses + payments (Date, Description, Category, Currency, Cost, then one column per person = net). */
export function buildCsv(args: { expenses: Expense[]; payments: Payment[]; people: Record<ID, Person>; personIds: ID[] }): string;
```

### lib/ids.ts
```ts
export function newId(prefix: string): ID;        // e.g. 'exp_lq3k9x_4f2a' (time + random)
```

---------------------------------------------------------------------------------------------
## 4. `src/ocr` — bill scanning

Flow: pick/take photo → `prepareImageForOcr` (≤ 1 MB JPEG base64, OCR.space free limit) →
`recognizeText` (OCR.space) → `parseReceipt` (our parser) → `receiptToBill` → ItemizedSplit.

### ocr/types.ts
```ts
export interface OcrWord { text: string; left: number; top: number; width: number; height: number }
export interface OcrLine { text: string; words: OcrWord[] }
export interface OcrResult { lines: string[]; rawText: string; engine: OcrEngine; ms: number }
export interface ParsedItem { name: string; quantity: number; unitPrice?: Minor; amount: Minor; confidence: number; sourceLine: string }
export interface ParsedCharge { kind: ChargeKind; label: string; amount: Minor; sourceLine: string }
export interface ParsedReceipt {
  merchant?: string; date?: ISODate; currency?: CurrencyCode;
  items: ParsedItem[]; charges: ParsedCharge[];
  subtotal?: Minor;            // printed subtotal, if found
  total?: Minor;               // printed grand total, if found
  computedTotal: Minor;        // Σ items + Σ charges
  warnings: string[];          // e.g. 'Items add up to ₹1,390.00 but the bill subtotal says ₹1,400.00'
}
export class OcrError extends Error { code: 'network' | 'quota' | 'too_large' | 'bad_key' | 'no_text' | 'timeout' | 'unknown' }
```

### ocr/lineBuilder.ts (pure)
```ts
/** Rebuild visual rows from OCR.space TextOverlay lines/words: group words whose vertical
 *  centres are within ~0.6× median word height, sort each row by x, join with ' ' and use
 *  '  ' (two spaces) where the horizontal gap is large (column break). Rows top→bottom. */
export function buildRows(lines: OcrLine[]): string[];
```

### ocr/receiptParser.ts (pure — the heart of scanning; heavily unit-tested)
```ts
export function parseReceipt(lines: string[], opts?: { currencyHint?: CurrencyCode }): ParsedReceipt;
/** Lower-level helpers exported for tests. */
export function normalizeLine(line: string): string;                  // fix OCR noise in numbers: O→0, l/I→1 inside digits, ',' decimal, '₹ 1,390.00' etc.
export function extractNumbers(line: string): { value: number; raw: string; index: number }[];
```
Must handle (each needs a test): Indian restaurant bills (`Item Qty Rate Amount` columns,
`Butter Chicken 1 420.00 420.00`, `Naan 6 60.00 360.00`, `6 x Naan 360`, `Naan x6 360.00`,
`2 Gulab Jamun @80 160`), names wrapped onto two lines, CGST/SGST/IGST/VAT/GST/Service Charge
(with or without %), discounts (negative), `Round Off`/`Rounding` (±), `Packing`/`Delivery`
charges (kind 'other'), tips, `Sub Total`/`Subtotal`, `Grand Total`/`Total`/`Net Amount`/
`Amount Payable`/`Bill Amount`, ignoring header/footer noise (GSTIN, FSSAI, Bill No, Table,
Cover, Cashier, Date/Time lines, phone numbers, `Thank you`, URLs, `Qty: 7`-style summary lines),
US/EU receipts (`$` and `€`, `1.234,56` decimal comma), totals with currency symbols, lines
where qty × rate ≠ amount (keep amount, lower confidence). Currency detection from symbols
(₹/Rs/INR, $, €, £, S$, AED, …) else currencyHint else 'INR'. Merchant = first meaningful
line near the top. Date = first date-like token (dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd, 'Oct 3, 2026').
Never throws.

### ocr/ocrSpace.ts (network)
```ts
export const OCR_SPACE_DEMO_KEY = 'helloworld';
/** POST https://api.ocr.space/parse/image (x-www-form-urlencoded: base64Image=data:image/jpeg;base64,…,
 *  language=eng, isTable=true, OCREngine, scale=true, detectOrientation=true, isOverlayRequired=true),
 *  header apikey. 45 s timeout. Rows from buildRows(overlay) when available, else ParsedText split
 *  on newlines. Maps OCR.space errors to OcrError codes (E101 timeouts, 'maximum file size', rate
 *  limits '403'/'429', 'API key' invalid). */
export async function recognizeText(base64Jpeg: string, opts: { apiKey: string; engine: OcrEngine; signal?: AbortSignal }): Promise<OcrResult>;
```

### ocr/imagePrep.ts (Expo)
```ts
/** Resize (long edge ≤ 1600, then 1300, 1000) and JPEG-compress (0.7 → 0.5 → 0.35) until the
 *  decoded size is < 950 KB. Uses ImageManipulator.manipulate(uri).resize(...).renderAsync() then
 *  saveAsync({ format: SaveFormat.JPEG, compress, base64: true }); falls back to the deprecated
 *  manipulateAsync if the new API is missing. Works with file:// and data: URIs (web). */
export async function prepareImageForOcr(uri: string, size?: { width: number; height: number }): Promise<{ base64: string; uri: string; bytes: number }>;
```

### ocr/sampleBill.ts (pure)
```ts
/** OCR-style rows of a realistic Indian restaurant bill used by "Try a sample bill" and tests:
 *  6 Naan (₹360), Butter Chicken (₹420), Chicken Lababdar (₹450), Gulab Jamun ×2 (₹160),
 *  Sub Total 1390.00, CGST 2.5% 34.75, SGST 2.5% 34.75, Round Off +0.50, Grand Total 1460.00,
 *  plus header/footer noise (restaurant name, GSTIN, Bill No, Table, date, Thank you). */
export const SAMPLE_BILL_ROWS: string[];
```

### ocr/index.ts
```ts
export * from './types';
/** Full pipeline for one photo. onStage reports 'preparing' | 'uploading' | 'parsing'. */
export async function scanBill(uri: string, opts: { apiKey: string; engine: OcrEngine; currencyHint: CurrencyCode; size?: { width: number; height: number }; onStage?: (s: 'preparing' | 'uploading' | 'parsing') => void; signal?: AbortSignal }): Promise<{ receipt: ParsedReceipt; ocr: OcrResult }>;
/** Sample bill without network (parseReceipt(SAMPLE_BILL_ROWS)). */
export function sampleReceipt(currencyHint: CurrencyCode): ParsedReceipt;
/** Items/charges → ItemizedBill. Every item starts shared equally by all `participantIds`
 *  (the user then untaps people). printedTotal = receipt.total. scanned = true. */
export function receiptToBill(receipt: ParsedReceipt, participantIds: ID[]): ItemizedBill;
```

---------------------------------------------------------------------------------------------
## 5. `src/store` — state

Single React context with `useReducer`; persisted to AsyncStorage key `splitsnap/state/v1`
(debounced 300 ms); first launch (or `resetToDemo`) loads `seed.ts`. Recurring expenses are
materialised on load (`processRecurring`).

### store/AppStore.tsx
```ts
export function AppStoreProvider(props: { children: React.ReactNode }): JSX.Element;
export function useAppState(): AppState;
export function useStoreReady(): boolean;            // false until AsyncStorage has loaded
export interface StoreActions {
  addFriend(input: { name: string; email?: string; phone?: string; upiId?: string }): Person;
  updatePerson(id: ID, patch: Partial<Omit<Person, 'id' | 'createdAt'>>): void;
  removeFriend(id: ID): { ok: boolean; reason?: string };          // refuses if any unsettled balance or shared group
  restoreFriend(id: ID): void;                                      // a removed friend back on the friends list
  createGroup(input: { name: string; type: GroupType; emoji: string; memberIds: ID[]; defaultCurrency: CurrencyCode; simplifyDebts: boolean }): Group;  // ME_ID always added
  updateGroup(id: ID, patch: Partial<Omit<Group, 'id' | 'createdAt'>>): void;
  addGroupMember(groupId: ID, personId: ID): void;
  removeGroupMember(groupId: ID, personId: ID): { ok: boolean; reason?: string };   // refuses if member has non-zero balance in group
  deleteGroup(id: ID): { ok: boolean; reason?: string };            // refuses unless all settled; deletes its expenses/payments
  addExpense(input: ExpenseInput): { expense?: Expense; errors: string[] };   // validates payers + computeOwed; no save on errors
  updateExpense(id: ID, input: ExpenseInput): { expense?: Expense; errors: string[] };
  deleteExpense(id: ID): void;                                      // soft delete
  restoreExpense(id: ID): void;
  addComment(expenseId: ID, text: string): void;
  addPayment(input: PaymentInput): Payment;
  deletePayment(id: ID): void;                                      // soft delete
  updateSettings(patch: Partial<Settings>): void;
  resetToDemo(): void;
  clearAllData(): void;                                             // empty state with just ME_ID
}
export function useActions(): StoreActions;
```
Every mutating action appends an `Activity` (newest first) with a readable `summary` using
`personName` ('You added "Dinner" in Goa Trip.', 'You recorded a payment: Aarav paid you ₹500.00.').

### store/selectors.ts (pure functions of AppState; screens wrap them in useMemo)
```ts
export function personName(state: AppState, id: ID, opts?: { you?: 'You' | 'you' | false }): string;  // default 'You' for ME_ID; unknown → 'Unknown'
export function getPerson(state: AppState, id: ID): Person | undefined;
export function listFriends(state: AppState): Person[];                       // by name
export function listGroups(state: AppState, opts?: { includeArchived?: boolean }): Group[];   // most recent activity first
export function groupMembers(state: AppState, groupId: ID): Person[];         // ME first
export function liveExpenses(state: AppState, filter?: { groupId?: ID | null }): Expense[];   // non-deleted; groupId null = non-group only; undefined = all
export function livePayments(state: AppState, filter?: { groupId?: ID | null }): Payment[];
export type TimelineEntry = { kind: 'expense'; expense: Expense } | { kind: 'payment'; payment: Payment };
export function groupTimeline(state: AppState, groupId: ID): TimelineEntry[];  // newest date first, then newest createdAt
export function friendTimeline(state: AppState, friendId: ID): TimelineEntry[];// anything involving both me and friend, any group
export function nonGroupTimeline(state: AppState): TimelineEntry[];
export function groupDebts(state: AppState, groupId: ID): Debt[];             // honours group.simplifyDebts
export function nonGroupDebts(state: AppState): Debt[];                       // pairwise
export function myGroupBalance(state: AppState, groupId: ID): CurrencyAmounts;// + = I'm owed
export function friendBalance(state: AppState, friendId: ID): CurrencyAmounts;// + = friend owes me (Σ over all groups + non-group)
export function friendBalanceByGroup(state: AppState, friendId: ID): { groupId: ID | null; amounts: CurrencyAmounts }[];  // non-zero only
export function overallSummary(state: AppState): BalanceSummary;              // across all groups + non-group, for ME_ID
export interface GroupTotals { currency: CurrencyCode; totalSpent: Minor; myShare: Minor; iPaid: Minor; byCategory: { category: CategoryId; amount: Minor }[]; byMonth: { month: string; amount: Minor }[]; byPayer: { personId: ID; amount: Minor }[] }
export function groupTotals(state: AppState, groupId: ID): GroupTotals[];     // one per currency used, default currency first
export function searchExpenses(state: AppState, query: string): Expense[];   // description, notes, item names, people names; newest first
export function expenseGroupName(state: AppState, e: { groupId: ID | null }): string;   // group name or 'Non-group expenses'
```

### store/draft.tsx — the expense being edited (shared by 4 screens)
```ts
export function DraftProvider(props: { children: React.ReactNode }): JSX.Element;
export interface DraftApi {
  draft: ExpenseDraft;
  setDraft(patch: Partial<ExpenseDraft>): void;                 // shallow merge
  startNew(args: { groupId?: ID | null; friendId?: ID }): void; // participants = group members or [ME, friend]; currency = group default or settings default; split = defaultSplit(participants); date = today; payers = null
  startEdit(expense: Expense): void;
  /** Parsed total (amountText) in minor units, or null if blank/invalid. */
  total: Minor | null;
  /** Payers resolved (null payers → [{ME_ID, total}]). */
  resolvedPayers: MoneyShare[];
  /** Validation for the Save button: computeOwed + validatePayers + description required. */
  errors: string[];
  /** Ready-to-save input, or null if errors. */
  toInput(): ExpenseInput | null;
}
export function useDraft(): DraftApi;
```
When participants change, a non-itemized split is re-defaulted to equal among the new
participants; itemized bills keep their items but drop removed people from shares.

### store/seed.ts
```ts
export function createDemoState(today: ISODate): AppState;
export function createEmptyState(): AppState;
```
Demo data: you ('You', ME_ID) + friends Aarav, Bhavna, Chirag, Diya (A, B, C, D — matches the
itemized example), Ishaan, Meera. Groups: 'Goa Trip' (trip, ✈️/🏖️, you+A+B+C+D, INR, simplify on,
~6 expenses incl. one itemized dinner bill with the exact example assignment — 6 Naan: A,B,C,D;
Butter Chicken: A,C; Chicken Lababdar: B,C,D; Gulab Jamun: B,D — one multi-payer expense, one
payment), 'Flat 302' (home, 🏠, you+Ishaan+Meera, INR, monthly recurring rent + utilities),
one non-group expense with Diya, one USD expense in Goa Trip to show multi-currency. Settings:
defaultCurrency 'INR', ocrApiKey '', ocrEngine 2, simplifyDebtsDefault true. Dates relative to
`today` so the demo always looks fresh.

### store/persistence.ts
```ts
export async function loadState(): Promise<AppState | null>;      // null if nothing saved or corrupt
export async function saveState(state: AppState): Promise<void>;
export async function clearSavedState(): Promise<void>;
```

---------------------------------------------------------------------------------------------
## 6. `src/ui` — shared components (export everything from `src/ui/index.ts`)

```ts
Screen({ children, scroll?: boolean = true, padded?: boolean = true, footer?: ReactNode, keyboard?: boolean, refreshControl?, contentStyle? })
AppText({ variant?: 'title'|'heading'|'body'|'label'|'caption'|'amount' = 'body', color?, weight?, align?, numberOfLines?, style?, children })
Button({ title, onPress, variant?: 'primary'|'secondary'|'outline'|'ghost'|'danger' = 'primary', icon?: string, disabled?, loading?, size?: 'sm'|'md'|'lg' = 'md', fullWidth?, style?, testID? })
IconButton({ icon: string, onPress, color?, size?: number = 22, accessibilityLabel: string, style? })
Card({ children, onPress?, style?, padded?: boolean = true })
ListItem({ title, subtitle?, left?: ReactNode, right?: ReactNode, onPress?, showChevron?, style? })
Avatar({ name: string, color: string, size?: number = 40, emoji?: string })      // initials (max 2) or emoji
PersonAvatar({ person: Person | undefined, size? })                                // wraps Avatar
AvatarStack({ people: Person[], size?: number = 24, max?: number = 4 })
Chip({ label, selected?: boolean, onPress?, color?: string, left?: ReactNode, small?: boolean, disabled? })
TextField({ label?, value, onChangeText, placeholder?, keyboardType?, multiline?, autoFocus?, error?, helper?, maxLength?, secureTextEntry?, autoCapitalize?, style?, inputStyle?, testID? })
AmountField({ value: string, onChangeText, currency: CurrencyCode, onPressCurrency?, autoFocus?, error? })   // big number + tappable currency symbol
SegmentedControl<T extends string>({ options: { value: T; label: string }[], value: T, onChange: (v: T) => void, scrollable?: boolean })
SwitchRow({ label, value, onValueChange, description? })
MoneyText({ amount: Minor, currency, tone?: 'auto'|'owe'|'owed'|'neutral' = 'neutral', variant?, signed?, abs? })   // auto: >0 owed(green), <0 owe(orange)
BalanceText({ amounts: CurrencyAmounts, perspective: 'me' | { name: string }, size?: 'sm'|'md' })
   // perspective 'me': 'you are owed ₹500.00' / 'you owe ₹200.00' / 'settled up' (multi-currency joined with ' + ')
   // perspective {name}: 'Aarav owes you ₹500.00' / 'you owe Aarav ₹200.00' / 'settled up'
EmptyState({ icon: string, title: string, message?: string, actionTitle?: string, onAction? })
SectionHeader({ title, right?: ReactNode, style? })
Divider({ inset?: number })
Sheet({ visible, onClose, title?, children, footer? })          // bottom sheet using RN Modal (transparent, slide)
OptionPicker<T>({ visible, onClose, title, options: { value: T; label: string; subtitle?: string; icon?: string; left?: ReactNode }[], selected?: T, onSelect: (v: T) => void, searchable? })   // Sheet with a list
DateField({ label?, value: ISODate, onChange: (d: ISODate) => void })   // tap → Sheet with month calendar grid + Today/Yesterday shortcuts
Fab({ icon?: string = 'add', label?: string, onPress, style? })
Banner({ tone: 'info'|'warning'|'danger'|'success', title?, message, actionTitle?, onAction? })
Stepper({ value: number, onChange: (n: number) => void, min?: number = 0, max?: number = 99, step?: number = 1 })
LoadingOverlay({ visible, message? })
```
### ui/dialogs.ts
```ts
export function showAlert(title: string, message?: string): void;                         // web: window.alert
export function confirmAsync(title: string, message?: string, opts?: { confirmText?: string; cancelText?: string; destructive?: boolean }): Promise<boolean>;   // web: window.confirm
export function chooseAsync<T extends string>(title: string, options: { value: T; label: string; destructive?: boolean }[], message?: string): Promise<T | null>;   // native: Alert with buttons; web: sequential window.confirm fallback is NOT ok → use a prompt listing numbered options
```
### ui/share.ts
```ts
export async function shareText(message: string, title?: string): Promise<void>;           // RN Share; web: navigator.share → clipboard → alert
export async function shareCsv(filename: string, csv: string): Promise<void>;               // web: Blob download; native: Share.share({ message: csv, title: filename })
export async function openUpiPayment(args: { upiId: string; name: string; amount: Minor; currency: CurrencyCode; note: string }): Promise<boolean>;  // Linking upi://pay?pa=&pn=&am=&cu=INR&tn= ; false if cannot open
```

---------------------------------------------------------------------------------------------
## 7. Screens and navigation

`App.tsx`: `SafeAreaProvider` → `AppStoreProvider` → `DraftProvider` → `NavigationContainer`
(theme background `colors.background`) → `RootNavigator`. While `useStoreReady()` is false show
a centred `ActivityIndicator`.

`src/navigation/RootNavigator.tsx`: native stack `RootStackParamList`, first screen `Tabs`
(bottom tabs: Groups, Friends, centre **+** (AddTab → `navigation.navigate('AddExpense')`,
rendered as a raised green circle button), Activity, Account). Header style: white, title
weight 600, tint `colors.primary`. AddExpense, SplitOptions, PaidBy, ScanBill, ItemizedSplit,
SettleUp, FriendEdit, GroupEdit are presented as `presentation: 'modal'` (on Android a normal
push). Tab icons: people-outline, person-outline, (add), pulse-outline, person-circle-outline.

Each screen file default-exports its component and takes `RootScreenProps<'Name'>` (or
`TabScreenProps<'Name'>` for tabs). Screen titles are set with `navigation.setOptions` where
dynamic.

| Route | File | Purpose |
|---|---|---|
| Tabs › Groups | `screens/groups/GroupsScreen.tsx` | Overall balance card (`overallSummary`), list of groups with my balance per group + avatars, "Non-group expenses" row, "Start a new group" button, search icon in header → Search |
| Tabs › Friends | `screens/friends/FriendsScreen.tsx` | Overall balance, filter chips (All / Owe you / You owe / Settled), friends with `friendBalance`, "Add friend" |
| Tabs › Activity | `screens/activity/ActivityScreen.tsx` | Feed grouped by day, icon per type, amount impact for me, tap → ExpenseDetail / PaymentDetail / GroupDetail |
| Tabs › Account | `screens/account/AccountScreen.tsx` | Your name/email (edit), default currency, link to Settings, stats (groups, friends, expenses), app info |
| GroupDetail | `screens/groups/GroupDetailScreen.tsx` | Header (emoji, name, type, members), my balance + top debts lines ('Aarav owes you ₹500'), action row: Settle up · Balances · Totals · Export CSV · Scan bill; timeline grouped by month (expense rows: date, category icon, description, 'Bhavna paid ₹1,460', 'you lent ₹300' coloured; payment rows), Fab "Add expense"; header gear → GroupEdit |
| GroupEdit | `screens/groups/GroupEditScreen.tsx` | Create/edit: name, type segmented, emoji picker (grid of ~24), members (pick friends with checkboxes + 'Add new person' inline), default currency, simplify debts switch with explanation; edit mode: archive, delete group (confirm; blocked unless settled), remove member (blocked if balance ≠ 0) |
| GroupBalances | `screens/groups/GroupBalancesScreen.tsx` | Per member net (green/orange), list of debts (simplified or pairwise per setting) each with 'Settle up' and 'Remind' (shareText) buttons; note explaining simplify |
| GroupTotals | `screens/groups/GroupTotalsScreen.tsx` | Per currency: total group spending, your share, you paid; horizontal bar chart by category (View bars, category colours), by month, by payer |
| FriendDetail | `screens/friends/FriendDetailScreen.tsx` | Avatar, balance (`friendBalance`), breakdown by group, Settle up / Remind / Pay via UPI, shared timeline, header edit → FriendEdit, Add expense with friend |
| FriendEdit | `screens/friends/FriendEditScreen.tsx` | Add / edit friend: name (required), email, phone, UPI ID; edit mode: remove friend (blocked unless settled) |
| AddExpense | `screens/expense/AddExpenseScreen.tsx` | The editor (see §8). On mount: `keepDraft` → keep; `expenseId` → `startEdit`; else `startNew({groupId, friendId})` |
| SplitOptions | `screens/expense/SplitOptionsScreen.tsx` | Segmented tabs Equally / Exact / Percent / Shares / Adjustment / Itemized; per-person inputs; live remaining ('₹40.00 left' / '10% left'); Done writes `draft.split`; Itemized tab → navigate ItemizedSplit |
| PaidBy | `screens/expense/PaidByScreen.tsx` | Choose one payer (list) or "Multiple people" with amount per person and live remaining |
| ScanBill | `screens/scan/ScanBillScreen.tsx` | See §8 |
| ItemizedSplit | `screens/itemized/ItemizedSplitScreen.tsx` | See §8 |
| ExpenseDetail | `screens/expense/ExpenseDetailScreen.tsx` | Big amount, category, date, group, 'Added by'; paid-by list; owed list with each person's amount; if itemized: table per person (items with portions, tax/charges, total) and per item (who shared); receipt image; notes; recurrence; comments thread + input; header edit (→ AddExpense {expenseId}) and delete (confirm) / restore if deleted |
| SettleUp | `screens/settle/SettleUpScreen.tsx` | If no from/to given: list of my debts/credits (from group or overall) to pick from; payer → payee row with avatars and swap button; AmountField prefilled; method chips Cash / UPI / Bank / Other; date; note; 'Pay via UPI' button when I pay, payee has upiId and currency INR (opens UPI app, then asks to record); Save → addPayment → back |
| PaymentDetail | `screens/settle/PaymentDetailScreen.tsx` | Who paid whom, amount, date, method, note, group; delete (confirm) |
| Search | `screens/search/SearchScreen.tsx` | Autofocus search box, results via `searchExpenses` with group name, tap → ExpenseDetail |
| Settings | `screens/account/SettingsScreen.tsx` | Bill scanning: OCR.space API key (secure field, 'Get a free key' explanation text with the URL https://ocr.space/ocrapi/freekey, demo-key notice), engine segmented (1/2/3 with one-line explanations; 2 default); default currency; simplify default; Export all as CSV; Reset demo data (confirm); Clear all data (confirm) |

---------------------------------------------------------------------------------------------
## 8. The two headline flows

### 8.1 Add expense (`AddExpenseScreen`)
Top: "With you and:" participant chips (group members, or pick friends when non-group) +
group picker (OptionPicker of groups + 'No group'). Prominent card **"Scan a bill"**
(camera icon) → `ScanBill`; secondary link "Split item by item" → sets
`draft.split = { method:'itemized', bill: { items: [], charges: [] } }` if not already itemized
and opens `ItemizedSplit` (manual entry). Then description (with category icon button →
OptionPicker of CATEGORIES; category auto-guessed from description until the user picks one),
`AmountField` (read-only and showing the itemized total when the split is itemized — tap goes to
ItemizedSplit), row "Paid by **you** and split **equally**" with both words tappable
(→ PaidBy, → SplitOptions), date (DateField), notes, repeat (OptionPicker: never/weekly/
fortnightly/monthly/yearly), attached receipt thumbnail (from scan). Inline errors from
`draft.errors`; header Save (disabled when errors) → `addExpense`/`updateExpense` → go back to
where the user came from (GroupDetail / FriendDetail / tabs). Cancel asks to discard if dirty.

### 8.2 Scan bill (`ScanBillScreen`)
Three big options: **Take photo** (`ImagePicker.launchCameraAsync`, ask camera permission;
explain if denied), **Choose from gallery** (`launchImageLibraryAsync`, mediaTypes ['images'],
quality 1), **Try a sample bill** (offline: `sampleReceipt`). While scanning show the photo
with a `LoadingOverlay` and the stage text ('Shrinking photo…', 'Reading the bill…',
'Finding items…'). Errors → Banner with friendly text by `OcrError.code` and Retry / Enter
manually. Demo-key Banner when `settings.ocrApiKey` is empty ('Using the shared demo key —
add your free key in Settings for reliable scans').
After OCR: **review list** — merchant (editable), each item row editable (name, qty, amount;
delete), add item, charges (label, amount, kind), detected total vs computed total with a
warning Banner if they differ, 'Show raw text' expander. Button **Continue to split** →
`setDraft({ split: { method:'itemized', bill: receiptToBill(receipt, draft.participantIds) },
description: draft.description || merchant || 'Restaurant bill', category: 'food' if not set,
receiptUri, date: receipt.date ?? draft.date, currency: receipt.currency ?? draft.currency,
amountText: minorToInputText(itemizedTotal) })` → `navigation.replace('ItemizedSplit')`.

### 8.3 Itemized split (`ItemizedSplitScreen`) — the user's key requirement
Header: participants as avatar chips (from `draft.participantIds`); a "Quick assign" hint.
For each item a Card: name · qty · amount (tap to edit inline / delete), then a wrap of person
chips (Avatar + first name) — tap toggles that person on the item; chips "Everyone" / "Clear".
A small "Split unequally" link reveals a Stepper per selected person (portions, e.g. A ate 2 of
6 naan → A:2, B:1, C:2, D:1). Under the chips: '₹90.00 each' or per-person amounts. Unassigned
items are highlighted (warning border) with text 'Tap who shared this'.
"+ Add item" (name, qty, amount) for manual entry; "Tax & charges" section listing charges
(label, amount, allocation toggle Proportional / Equal, delete) and "+ Add tax / tip /
discount" (kind chips: Tax %, Service %, Tip, Discount, Other; % kinds take a percentage of the
items subtotal and store the computed amount).
Sticky bottom **summary panel**: each person's total (tap to expand the item lines), Σ = bill
total, and warnings (unassigned items, printed total mismatch). **Done** (disabled while items
are unassigned unless the user taps 'Split unassigned among everyone') writes
`draft.split = { method:'itemized', bill }`, `draft.amountText = minorToInputText(total)`,
then `navigation.navigate('AddExpense', { keepDraft: true })`.
The user's example must work exactly: 6 Naan → A,B,C,D; Butter chicken → A & C; Chicken
lababdar → B, C & D; Gulab jamun → B & D.

---------------------------------------------------------------------------------------------
## 9. Tooling (no Node.js — headless Microsoft Edge only)

Edge: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. All harnesses are
PowerShell 5.1 scripts that bundle sources into a JS file, open an HTML page with
`msedge --headless=new --disable-gpu --user-data-dir=<tools\.edge-profile> --virtual-time-budget=… --dump-dom file:///…`
(or `--remote-debugging` not needed) and parse the dumped DOM. TypeScript is loaded inside the
page from `https://cdn.jsdelivr.net/npm/typescript@5.9.3/lib/typescript.js` (cached by the
Edge profile). Nothing is installed or written outside the topic folder.

- `tools/run-tests.ps1` — transpiles `app/src/**/*.ts` (no .tsx) + `tests/**/*.ts`, runs every
  `*.test.ts` with a Jest-like API (`describe`, `it`/`test`, `beforeEach`, `expect(x).toBe /
  toEqual / toStrictEqual / toBeCloseTo / toBeTruthy / toBeFalsy / toBeNull / toBeUndefined /
  toBeDefined / toContain / toHaveLength / toBeGreaterThan(OrEqual) / toBeLessThan(OrEqual) /
  toMatch / toThrow / toHaveProperty`, all with `.not`). Prints per-test pass/fail + failure
  messages; exit code 1 on any failure. Optional `-Filter <substring>`.
- `tools/typecheck.ps1` — runs the TypeScript compiler over all of `app/` in strict mode.
  Third-party modules come from real type definitions fetched from jsDelivr where feasible
  (react 19.2, react-native 0.83, @react-navigation 7, expo-image-picker/manipulator 55,
  async-storage 2.2, safe-area-context 5.6, @expo/vector-icons 15); fallback: ambient
  `declare module` shims. Prints `file(line,col): error TSxxxx: message`; exit 1 on errors.
- `tools/build-snack-launcher.ps1` — writes `open-in-snack.html`: an auto-styled page with
  a "Run SplitSnap in Expo Snack" button that loads Snack's embedded editor
  (`https://snack.expo.dev/embedded`) on the page and, once it signals ready, sends it the fields
  `name=SplitSnap`, `platform=web`, `sdkVersion=54.0.0` (default; `-SdkVersion` overrides), `supportedPlatforms=ios,android,web,mydevice`,
  `dependencies` (comma list, see below), and `files` = `{ "App.tsx": { "type": "CODE",
  "contents": "…" }, "src/lib/money.ts": {…}, … }` for every file under `app/`. The arrow icon in
  the embedded Snack opens the full editor (My Device QR code, iOS/Android previews) with the same
  files. A plain form POST to snack.expo.dev is not used: Snack caps form bodies at 56 KB and
  the app is about 900 KB. Re-run the script after every app change.

Snack dependencies (versions pinned where Snack can't infer them):
`@react-navigation/native@7.5.0,@react-navigation/native-stack@7.20.0,@react-navigation/bottom-tabs@7.20.0,react-native-screens,react-native-safe-area-context,@react-native-async-storage/async-storage,expo-image-picker,expo-image-manipulator,expo-document-picker,@expo/vector-icons,@supabase/supabase-js,react-native-url-polyfill`

---------------------------------------------------------------------------------------------
## 10. Why Expo SDK 54 (decided 2026-10-16, tested in Snack)

- The App Store's Expo Go stops at SDK 54, so an iPhone can only open SDK 54 projects (signed in
  to a free Expo account). SDK 55+ on a physical iPhone needs a TestFlight build of Expo Go and a
  paid Apple Developer membership, which this project rules out.
- Snack's in-browser iOS/Android simulators use the same SDK 56 devices for its "55.0.0" and
  "56.0.0" entries, so an SDK 55 project crashes there ("Tried to register two views with the same
  name RNSScreen"). SDK 54 has its own simulator devices.
- Snack's SDK 56 support still runs a preview `expo` package; expo-image-picker 56.0.7+ crashes on
  it ("createPermissionHook is not a function").
- `tools\typecheck.ps1 -Sdk 54` (default) checks against SDK 54 library versions; `-Sdk 55` also
  works. `tools\build-snack-launcher.ps1 -SdkVersion 55.0.0` builds a launcher for another SDK.
- The photo libraries (expo-image-picker, expo-image-manipulator) are loaded with `import()` on
  first use, so a runtime that cannot load them only disables the photo buttons.
