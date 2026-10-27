import type { Person } from '../../app/src/types';
import { buildCsv } from '../../app/src/lib/csv';
import { makeExpense, makePayment, shares } from './helpers';

const person = (id: string, name: string): Person => ({ id, name, color: '#000000', createdAt: '2026-01-01T00:00:00.000Z' });

const people: Record<string, Person> = {
  me: person('me', 'You'),
  a: person('a', 'Aarav'),
  b: person('b', 'Bhavna'),
};

/** Minimal RFC 4180 reader, to check that quoting round-trips. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

describe('buildCsv', () => {
  const dinner = makeExpense({
    description: 'Dinner',
    date: '2026-10-03',
    payers: shares('me', 90000),
    owed: shares('me', 30000, 'a', 30000, 'b', 30000),
  });
  dinner.category = 'food';
  const cab = makeExpense({ description: 'Cab', date: '2026-10-01', payers: shares('a', 45050), owed: shares('me', 22525, 'a', 22525) });
  const payment = makePayment({ fromId: 'b', toId: 'me', amount: 30000, date: '2026-10-05' });

  it('writes a header, one row per record (oldest first) and totals', () => {
    const csv = buildCsv({ expenses: [dinner, cab], payments: [payment], people, personIds: ['me', 'a', 'b'] });
    expect(csv.split('\r\n')).toEqual([
      'Date,Description,Category,Currency,Cost,You,Aarav,Bhavna',
      '2026-10-01,Cab,General,INR,450.50,-225.25,225.25,0.00',
      '2026-10-03,Dinner,Food & dining,INR,900.00,600.00,-300.00,-300.00',
      '2026-10-05,Bhavna paid you,Payment,INR,300.00,-300.00,0.00,300.00',
      ',Total balance,,INR,,74.75,-74.75,0.00',
    ]);
  });

  it('skips deleted records', () => {
    const deleted = makeExpense({ description: 'Gone', payers: shares('me', 100), owed: shares('a', 100), deleted: true });
    const deletedPayment = makePayment({ fromId: 'a', toId: 'me', amount: 100, deleted: true });
    const csv = buildCsv({ expenses: [deleted], payments: [deletedPayment], people, personIds: ['me', 'a'] });
    expect(csv).toBe('Date,Description,Category,Currency,Cost,You,Aarav');
  });

  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    const tricky = makeExpense({
      description: 'Dinner, drinks & "dessert"\nat Toit',
      date: '2026-10-03',
      payers: shares('me', 1000),
      owed: shares('a', 1000),
    });
    const csv = buildCsv({ expenses: [tricky], payments: [], people: { ...people, a: person('a', 'Singh, Aarav') }, personIds: ['me', 'a'] });
    expect(csv).toContain('"Dinner, drinks & ""dessert""\nat Toit"');
    expect(csv).toContain('"Singh, Aarav"');
    const rows = parseCsv(csv);
    expect(rows[0][6]).toBe('Singh, Aarav');
    expect(rows[1][1]).toBe('Dinner, drinks & "dessert"\nat Toit');
    expect(rows[1]).toHaveLength(7);
  });

  it('defuses spreadsheet formulas in text', () => {
    const evil = makeExpense({ description: '=HYPERLINK("x")', payers: shares('me', 100), owed: shares('a', 100) });
    const rows = parseCsv(buildCsv({ expenses: [evil], payments: [], people, personIds: ['me', 'a'] }));
    expect(rows[1][1]).toBe('\'=HYPERLINK("x")');
  });

  it('uses each currency’s decimals and keeps currencies apart', () => {
    const yen = makeExpense({ description: 'Ramen', currency: 'JPY', date: '2026-10-02', payers: shares('a', 3000), owed: shares('me', 1500, 'a', 1500) });
    const csv = buildCsv({ expenses: [cab, yen], payments: [], people, personIds: ['me', 'a'] });
    const rows = parseCsv(csv);
    expect(rows[2]).toEqual(['2026-10-02', 'Ramen', 'General', 'JPY', '3000', '-1500', '1500']);
    expect(rows.slice(-2)).toEqual([
      ['', 'Total balance', '', 'INR', '', '-225.25', '225.25'],
      ['', 'Total balance', '', 'JPY', '', '-1500', '1500'],
    ]);
  });

  it('names unknown people', () => {
    const csv = buildCsv({ expenses: [], payments: [], people, personIds: ['ghost'] });
    expect(csv).toBe('Date,Description,Category,Currency,Cost,Unknown');
  });
});
