// Turns a Splitwise "Export as spreadsheet" CSV into SplitSnap friends, a group, expenses and
// payments. Pure: no React / React Native, so it is unit-tested with the rest of src/lib.
//
// Splitwise's export has one row per expense or payment:
//   Date,Description,Category,Cost,Currency,<Person 1>,<Person 2>,...
// where each person's cell is their NET for that row (what they paid minus their share; the
// payer is positive, the people who owe are negative), and a last "Total balance" row per currency.
import type {
  CategoryId,
  CurrencyCode,
  ExpenseInput,
  GroupType,
  ID,
  ISODate,
  Minor,
  MoneyShare,
  PaymentInput,
} from '../types';
import { ME_ID } from '../types';
import { guessCategory } from './categories';
import { formatMoney, toMinor } from './money';

export interface SplitwiseRow {
  /** 1-based line number in the file, for messages. */
  line: number;
  date: ISODate;
  description: string;
  category: string;
  cost: Minor;
  currency: CurrencyCode;
  /** Net per person column (same order as `people`). */
  nets: Minor[];
}

export interface SplitwiseExport {
  people: string[];
  rows: SplitwiseRow[];
  /** The file's "Total balance" row(s): net per person column, by currency. */
  totals: Record<CurrencyCode, Minor[]>;
  currencies: CurrencyCode[];
  firstDate?: ISODate;
  lastDate?: ISODate;
}

export type ImportMode = 'history' | 'balances';

export interface ImportOptions {
  groupName: string;
  /** Which person column is the app user (becomes "You"). */
  meIndex: number;
  mode: ImportMode;
  today: ISODate;
  /** Friends already in the app: a column with the same name (ignoring case) reuses them. */
  existingPeople: { id: ID; name: string }[];
  makeId: (prefix: string) => ID;
}

export interface ImportGroupInput {
  name: string;
  type: GroupType;
  emoji: string;
  memberIds: ID[];
  defaultCurrency: CurrencyCode;
  simplifyDebts: boolean;
}

export interface ImportPlan {
  groupId: ID;
  group: ImportGroupInput;
  /** Columns that become new friends. */
  newFriends: { id: ID; name: string }[];
  /** Person id for each column (ME_ID for the user). */
  personIds: ID[];
  expenses: { id: ID; input: ExpenseInput }[];
  payments: { id: ID; input: PaymentInput }[];
  /** Rows left out, with the reason (e.g. nothing owed). */
  skipped: { line: number; reason: string }[];
  /** Rows imported differently from a normal expense, with an explanation. */
  notes: string[];
  /** Final net per person and currency according to the file's "Total balance" row. */
  expected: Record<CurrencyCode, Record<ID, Minor>>;
}

// ---------- CSV ----------

/** RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const FIXED_COLUMNS = ['date', 'description', 'category', 'cost', 'currency'];
const TOTAL_ROW = /^total balance$/i;

function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '');
  if (t === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Reads a Splitwise export. Returns a plain-English error when the file isn't one. */
export function parseSplitwiseExport(text: string): { data?: SplitwiseExport; error?: string } {
  // Keep each record's position in the file (blank lines count) so messages point at the right line.
  const table = parseCsv(text)
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (table.length === 0) return { error: 'The file is empty.' };
  const header = table[0].cells.map((h) => h.trim());
  const fixedOk = FIXED_COLUMNS.every((name, i) => (header[i] || '').toLowerCase() === name);
  if (!fixedOk) {
    return { error: "This doesn't look like a Splitwise export. The first row should start with Date, Description, Category, Cost, Currency." };
  }
  const people = header.slice(FIXED_COLUMNS.length).filter((p) => p !== '');
  if (people.length < 2) return { error: 'The export needs at least two people.' };

  const rows: SplitwiseRow[] = [];
  const totals: Record<CurrencyCode, Minor[]> = {};
  const currencies: CurrencyCode[] = [];
  for (let r = 1; r < table.length; r++) {
    const { cells, line } = table[r];
    const description = (cells[1] || '').trim();
    const currency = (cells[4] || '').trim().toUpperCase() || 'INR';
    const nets: Minor[] = [];
    for (let p = 0; p < people.length; p++) {
      const n = parseNumber(cells[FIXED_COLUMNS.length + p] || '');
      if (n === null) return { error: `Line ${line}: "${cells[FIXED_COLUMNS.length + p]}" is not a number.` };
      nets.push(toMinor(n, currency));
    }
    if (TOTAL_ROW.test(description)) {
      totals[currency] = nets;
      continue;
    }
    const date = (cells[0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: `Line ${line}: "${cells[0]}" is not a date (YYYY-MM-DD).` };
    const cost = parseNumber(cells[3] || '');
    if (cost === null) return { error: `Line ${line}: the cost "${cells[3]}" is not a number.` };
    if (currencies.indexOf(currency) < 0) currencies.push(currency);
    rows.push({ line, date, description: description || 'Expense', category: (cells[2] || '').trim(), cost: toMinor(cost, currency), currency, nets });
  }
  if (rows.length === 0) return { error: 'The export has no expenses.' };
  const dates = rows.map((r) => r.date).sort();
  return { data: { people, rows, totals, currencies, firstDate: dates[0], lastDate: dates[dates.length - 1] } };
}

// ---------- Categories ----------

const CATEGORY_MAP: Record<string, CategoryId> = {
  'dining out': 'food',
  food: 'food',
  groceries: 'groceries',
  liquor: 'drinks',
  taxi: 'transport',
  'bus/train': 'transport',
  car: 'transport',
  bicycle: 'transport',
  'gas/fuel': 'fuel',
  parking: 'parking',
  plane: 'travel',
  hotel: 'hotel',
  rent: 'rent',
  mortgage: 'rent',
  electricity: 'utilities',
  water: 'utilities',
  'heat/gas': 'utilities',
  trash: 'utilities',
  cleaning: 'utilities',
  utilities: 'utilities',
  'tv/phone/internet': 'internet',
  movies: 'entertainment',
  games: 'entertainment',
  music: 'entertainment',
  entertainment: 'entertainment',
  clothing: 'shopping',
  electronics: 'shopping',
  furniture: 'shopping',
  'household supplies': 'shopping',
  'home - other': 'shopping',
  gifts: 'gifts',
  'medical expenses': 'medical',
  sports: 'sports',
};

/** Splitwise category → SplitSnap category; unknown ones fall back to a guess from the description. */
export function mapCategory(splitwiseCategory: string, description: string): CategoryId {
  const mapped = CATEGORY_MAP[splitwiseCategory.trim().toLowerCase()];
  return mapped || guessCategory(description);
}

// ---------- Plan ----------

function exactSplit(owed: MoneyShare[]): ExpenseInput['split'] {
  const amounts: Record<ID, Minor> = {};
  for (const o of owed) if (o.amount !== 0) amounts[o.personId] = (amounts[o.personId] || 0) + o.amount;
  return { method: 'exact', amounts };
}

/** Builds everything to import. Never throws; odd rows end up in `skipped` or `notes`. */
export function buildSplitwiseImport(data: SplitwiseExport, opts: ImportOptions): ImportPlan {
  const byName = new Map(opts.existingPeople.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const newFriends: { id: ID; name: string }[] = [];
  const personIds = data.people.map((name, i) => {
    if (i === opts.meIndex) return ME_ID;
    const existing = byName.get(name.trim().toLowerCase());
    if (existing && existing !== ME_ID) return existing;
    const id = opts.makeId('p');
    newFriends.push({ id, name: name.trim() });
    return id;
  });

  const counts = new Map<CurrencyCode, number>();
  for (const r of data.rows) counts.set(r.currency, (counts.get(r.currency) || 0) + 1);
  const defaultCurrency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const groupId = opts.makeId('g');
  const group: ImportGroupInput = {
    name: opts.groupName.trim() || 'Imported from Splitwise',
    type: 'other',
    emoji: '🧾',
    memberIds: personIds,
    defaultCurrency,
    simplifyDebts: true,
  };

  const expenses: ImportPlan['expenses'] = [];
  const payments: ImportPlan['payments'] = [];
  const skipped: ImportPlan['skipped'] = [];
  const notes: string[] = [];

  const expense = (row: Omit<ExpenseInput, 'groupId' | 'split'>, owed: MoneyShare[]) =>
    expenses.push({ id: opts.makeId('e'), input: { ...row, groupId, split: exactSplit(owed) } });

  if (opts.mode === 'balances') {
    for (const currency of Object.keys(data.totals)) {
      const nets = data.totals[currency];
      const payers = nets.map((n, i) => ({ personId: personIds[i], amount: n })).filter((s) => s.amount > 0);
      const owed = nets.map((n, i) => ({ personId: personIds[i], amount: -n })).filter((s) => s.amount > 0);
      const total = payers.reduce((s, p) => s + p.amount, 0);
      if (total === 0) continue;
      expense(
        {
          description: 'Balances brought over from Splitwise',
          category: 'general',
          currency,
          total,
          date: opts.today,
          notes: `Final balances from the Splitwise export (${data.rows.length} entries, ${data.firstDate} to ${data.lastDate}).`,
          payers,
        },
        owed,
      );
    }
  } else {
    for (const row of data.rows) {
      const positive = row.nets.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
      const negative = row.nets.map((n, i) => (n < 0 ? i : -1)).filter((i) => i >= 0);
      if (positive.length === 0 && negative.length === 0) {
        skipped.push({ line: row.line, reason: `"${row.description}" changes nobody's balance` });
        continue;
      }

      if (row.category.toLowerCase() === 'payment' && positive.length === 1 && negative.length === 1) {
        payments.push({
          id: opts.makeId('pay'),
          input: {
            groupId,
            fromId: personIds[positive[0]],
            toId: personIds[negative[0]],
            amount: row.nets[positive[0]],
            currency: row.currency,
            date: row.date,
            note: row.description && row.description.toLowerCase() !== 'payment' ? row.description : 'Imported from Splitwise',
            method: 'other',
          },
        });
        continue;
      }

      const base = {
        description: row.description,
        category: mapCategory(row.category, row.description),
        currency: row.currency,
        date: row.date,
        notes: 'Imported from Splitwise',
      };
      const others = negative.map((i) => ({ personId: personIds[i], amount: -row.nets[i] }));
      const othersTotal = others.reduce((s, o) => s + o.amount, 0);

      if (positive.length === 1 && row.cost >= othersTotal && row.cost > 0) {
        // The usual case: one person paid the whole cost. Their own share is what's left.
        const p = positive[0];
        const payerShare = row.cost - othersTotal;
        const owed = payerShare > 0 ? [...others, { personId: personIds[p], amount: payerShare }] : others;
        expense({ ...base, total: row.cost, payers: [{ personId: personIds[p], amount: row.cost }] }, owed);
        const fileNet = row.nets[p];
        if (row.cost - payerShare !== fileNet) {
          notes.push(`Line ${row.line} "${row.description}": rounding of ${formatMoney(Math.abs(row.cost - payerShare - fileNet), row.currency)} kept on the payer's share.`);
        }
        continue;
      }

      // Several payers (or a cost that doesn't match): keep each person's net exactly.
      const payers = positive.map((i) => ({ personId: personIds[i], amount: row.nets[i] }));
      const total = payers.reduce((s, p) => s + p.amount, 0);
      if (total <= 0 || total !== othersTotal) {
        skipped.push({ line: row.line, reason: `"${row.description}" doesn't add up (paid ${formatMoney(total, row.currency)}, owed ${formatMoney(othersTotal, row.currency)})` });
        continue;
      }
      expense(
        {
          ...base,
          total,
          payers,
          notes: `Imported from Splitwise. Original cost ${formatMoney(row.cost, row.currency)}; several people paid, so each person's net is kept.`,
        },
        others,
      );
      notes.push(`Line ${row.line} "${row.description}": several payers, imported as net amounts.`);
    }
  }

  const expected: ImportPlan['expected'] = {};
  for (const currency of Object.keys(data.totals)) {
    expected[currency] = {};
    data.totals[currency].forEach((n, i) => {
      expected[currency][personIds[i]] = n;
    });
  }

  return { groupId, group, newFriends, personIds, expenses, payments, skipped, notes, expected };
}

/** Net per person and currency produced by the plan (paid − owed, plus payments). */
export function planNets(plan: ImportPlan): Record<CurrencyCode, Record<ID, Minor>> {
  const nets: Record<CurrencyCode, Record<ID, Minor>> = {};
  const add = (currency: CurrencyCode, id: ID, amount: Minor) => {
    nets[currency] = nets[currency] || {};
    nets[currency][id] = (nets[currency][id] || 0) + amount;
  };
  for (const { input } of plan.expenses) {
    for (const p of input.payers) add(input.currency, p.personId, p.amount);
    if (input.split.method === 'exact') {
      for (const id of Object.keys(input.split.amounts)) add(input.currency, id, -input.split.amounts[id]);
    }
  }
  for (const { input } of plan.payments) {
    add(input.currency, input.fromId, input.amount);
    add(input.currency, input.toId, -input.amount);
  }
  return nets;
}

export interface PlanCheck {
  /** True when the file has a "Total balance" row and every person matches it exactly. */
  ok: boolean;
  /** False when the file had no "Total balance" row to compare with. */
  checked: boolean;
  mismatches: { personId: ID; currency: CurrencyCode; expected: Minor; actual: Minor }[];
}

/** Compares the plan's result with the file's "Total balance" row. */
export function checkPlan(plan: ImportPlan): PlanCheck {
  const actual = planNets(plan);
  const mismatches: PlanCheck['mismatches'] = [];
  const currencies = Object.keys(plan.expected);
  for (const currency of currencies) {
    for (const id of plan.personIds) {
      const want = plan.expected[currency][id] || 0;
      const got = (actual[currency] && actual[currency][id]) || 0;
      if (want !== got) mismatches.push({ personId: id, currency, expected: want, actual: got });
    }
  }
  return { ok: currencies.length > 0 && mismatches.length === 0, checked: currencies.length > 0, mismatches };
}
