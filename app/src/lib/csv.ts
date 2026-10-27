// Splitwise-style CSV export (RFC 4180: CRLF rows, fields quoted when they contain a comma,
// quote or line break, quotes doubled).
import type { CurrencyCode, Expense, ID, Minor, Payment, Person } from '../types';
import { expenseNet, paymentNet } from './balances';
import { categoryInfo } from './categories';
import { compareCurrencyCodes, currencyDecimals } from './money';

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Free text typed by users; a leading = + - @ would make spreadsheets run it as a formula. */
function textCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Plain number with the currency's decimals: 139050 → '1390.50', -1200 → '-12.00'. */
function amountCell(minor: Minor, currency: CurrencyCode): string {
  const decimals = currencyDecimals(currency);
  const factor = Math.pow(10, decimals);
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / factor);
  let frac = String(abs - whole * factor);
  while (frac.length < decimals) frac = '0' + frac;
  const sign = minor < 0 && abs !== 0 ? '-' : '';
  return decimals > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

interface Row {
  date: string;
  createdAt: string;
  currency: CurrencyCode;
  description: string;
  category: string;
  cost: Minor;
  net: Record<ID, Minor>;
}

/** RFC 4180 CSV of expenses + payments (Date, Description, Category, Currency, Cost, then one column per person = net).
 *  Rows are oldest first; a 'Total balance' row per currency closes the file. Deleted records are skipped. */
export function buildCsv(args: {
  expenses: Expense[];
  payments: Payment[];
  people: Record<ID, Person>;
  personIds: ID[];
}): string {
  const { expenses, payments, people, personIds } = args;
  const name = (id: ID) => people[id]?.name ?? 'Unknown';
  // 'Diya paid you', not 'Diya paid You', while your name is still the default 'You'.
  const objectName = (id: ID) => (name(id) === 'You' ? 'you' : name(id));

  const rows: Row[] = [];
  for (const e of expenses) {
    if (e.deletedAt) continue;
    rows.push({
      date: e.date,
      createdAt: e.createdAt,
      currency: e.currency,
      description: e.description,
      category: categoryInfo(e.category).label,
      cost: e.total,
      net: expenseNet(e),
    });
  }
  for (const p of payments) {
    if (p.deletedAt) continue;
    rows.push({
      date: p.date,
      createdAt: p.createdAt,
      currency: p.currency,
      description: `${name(p.fromId)} paid ${objectName(p.toId)}`,
      category: 'Payment',
      cost: p.amount,
      net: paymentNet(p),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const lines: string[][] = [['Date', 'Description', 'Category', 'Currency', 'Cost', ...personIds.map((id) => textCell(name(id)))]];
  const totals: Record<CurrencyCode, Record<ID, Minor>> = {};
  for (const row of rows) {
    const bucket = totals[row.currency] ?? (totals[row.currency] = {});
    lines.push([
      row.date,
      textCell(row.description),
      row.category,
      row.currency,
      amountCell(row.cost, row.currency),
      ...personIds.map((id) => {
        const v = row.net[id] ?? 0;
        bucket[id] = (bucket[id] ?? 0) + v;
        return amountCell(v, row.currency);
      }),
    ]);
  }
  Object.keys(totals)
    .sort(compareCurrencyCodes)
    .forEach((currency) => {
      lines.push(['', 'Total balance', '', currency, '', ...personIds.map((id) => amountCell(totals[currency][id] ?? 0, currency))]);
    });

  return lines.map((cells) => cells.map(escapeField).join(',')).join('\r\n');
}
