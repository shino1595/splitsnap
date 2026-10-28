import { ME_ID } from '../../app/src/types';
import { computeNets } from '../../app/src/lib/balances';
import {
  buildSplitwiseImport,
  checkPlan,
  mapCategory,
  parseCsv,
  parseSplitwiseExport,
  planNets,
} from '../../app/src/lib/splitwiseImport';
import type { ImportOptions, SplitwiseExport } from '../../app/src/lib/splitwiseImport';
import { appReducer } from '../../app/src/store/reducer';
import { blankState } from '../../app/src/store/stateShape';

// Shaped like a real "Export as spreadsheet" file: a blank line after the header and before the
// totals, one "Total balance" row per currency. Bhavna's column is the app user in most tests.
const EXPORT = [
  'Date,Description,Category,Cost,Currency,Aarav,Bhavna,Chirag,Diya',
  '',
  '2026-01-05,Dinner,Dining out,400.00,INR,300.00,-100.00,-100.00,-100.00',
  '2026-01-06,Cab,Taxi,90.00,INR,-30.00,60.00,-30.00,0.00',
  '2026-01-07,"Movie, popcorn",Movies,300.00,INR,-150.00,0.00,0.00,150.00',
  '2026-01-08,Payment,Payment,100.00,INR,-100.00,100.00,0.00,0.00',
  '2026-01-09,Gift for Diya,Gifts,200.00,INR,100.00,0.00,100.00,-200.00',
  '2026-01-10,Nothing,General,0.00,INR,0.00,0.00,0.00,0.00',
  '2026-01-11,Snacks,General,100.00,INR,66.67,-33.33,-33.34,0.00',
  '2026-01-12,Souvenir,Shopping,20.00,USD,-10.00,10.00,0.00,0.00',
  '',
  '2026-01-31,Total balance, , ,INR,186.67,26.67,-63.34,-150.00',
  '2026-01-31,Total balance, , ,USD,-10.00,10.00,0.00,0.00',
].join('\r\n');

function parsed(text: string = EXPORT): SplitwiseExport {
  const result = parseSplitwiseExport(text);
  if (!result.data) throw new Error(result.error);
  return result.data;
}

function options(overrides: Partial<ImportOptions> = {}): ImportOptions {
  let n = 0;
  return {
    groupName: 'Chai club',
    meIndex: 1,
    mode: 'history',
    today: '2026-02-01',
    existingPeople: [],
    makeId: (prefix) => `${prefix}_${++n}`,
    ...overrides,
  };
}

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    const text = '﻿a,"b, c","say ""hi"""\r\n"two\nlines",x,\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['two\nlines', 'x', ''],
    ]);
  });

  it('keeps a last line without a newline', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseSplitwiseExport', () => {
  it('reads people, rows (net per person in minor units) and the totals per currency', () => {
    const data = parsed();
    expect(data.people).toEqual(['Aarav', 'Bhavna', 'Chirag', 'Diya']);
    expect(data.rows).toHaveLength(8);
    expect(data.currencies).toEqual(['INR', 'USD']);
    expect(data.firstDate).toBe('2026-01-05');
    expect(data.lastDate).toBe('2026-01-12');
    expect(data.rows[0]).toEqual({
      line: 3,
      date: '2026-01-05',
      description: 'Dinner',
      category: 'Dining out',
      cost: 40000,
      currency: 'INR',
      nets: [30000, -10000, -10000, -10000],
    });
    expect(data.rows[2].description).toBe('Movie, popcorn');
    expect(data.totals).toEqual({ INR: [18667, 2667, -6334, -15000], USD: [-1000, 1000, 0, 0] });
  });

  it('explains what is wrong with a file that is not an export', () => {
    expect(parseSplitwiseExport('').error).toBe('The file is empty.');
    expect(parseSplitwiseExport('Name,Amount\nTea,10').error).toMatch(/doesn't look like a Splitwise export/);
    expect(parseSplitwiseExport('Date,Description,Category,Cost,Currency,Aarav\n').error).toMatch(/at least two people/);
    expect(parseSplitwiseExport('Date,Description,Category,Cost,Currency,A,B\n2026-01-01,Tea,General,10,INR,5,abc').error).toBe(
      'Line 2: "abc" is not a number.',
    );
    expect(parseSplitwiseExport('Date,Description,Category,Cost,Currency,A,B\n\n01/02/2026,Tea,General,10,INR,5,-5').error).toBe(
      'Line 3: "01/02/2026" is not a date (YYYY-MM-DD).',
    );
    expect(parseSplitwiseExport('Date,Description,Category,Cost,Currency,A,B\n2026-01-01,Total balance, , ,INR,0,0').error).toBe(
      'The export has no expenses.',
    );
  });
});

describe('mapCategory', () => {
  it("maps Splitwise's categories and guesses from the description otherwise", () => {
    expect(mapCategory('Dining out', 'Kekra chai')).toBe('food');
    expect(mapCategory('Taxi', 'Ride home')).toBe('transport');
    expect(mapCategory('Movies', 'Show')).toBe('entertainment');
    expect(mapCategory('General', 'Uber')).toBe('transport');
    expect(mapCategory('General', 'Misc')).toBe('general');
  });
});

describe('buildSplitwiseImport (full history)', () => {
  it('makes the chosen column "You", reuses friends with the same name and adds the rest', () => {
    const plan = buildSplitwiseImport(parsed(), options({ existingPeople: [{ id: 'p_old', name: 'chirag ' }] }));
    expect(plan.personIds).toEqual(['p_1', ME_ID, 'p_old', 'p_2']);
    expect(plan.newFriends).toEqual([
      { id: 'p_1', name: 'Aarav' },
      { id: 'p_2', name: 'Diya' },
    ]);
    expect(plan.groupId).toBe('g_3');
    expect(plan.group).toEqual({
      name: 'Chai club',
      type: 'other',
      emoji: '🧾',
      memberIds: ['p_1', ME_ID, 'p_old', 'p_2'],
      defaultCurrency: 'INR',
      simplifyDebts: true,
    });
  });

  it('keeps the payer, exact shares, date and category of every expense', () => {
    const plan = buildSplitwiseImport(parsed(), options());
    const [aarav, , chirag, diya] = plan.personIds;
    expect(plan.expenses.map((e) => e.input.description)).toEqual(['Dinner', 'Cab', 'Movie, popcorn', 'Gift for Diya', 'Snacks', 'Souvenir']);

    const dinner = plan.expenses[0].input;
    expect(dinner).toMatchObject({ groupId: plan.groupId, category: 'food', currency: 'INR', total: 40000, date: '2026-01-05' });
    expect(dinner.payers).toEqual([{ personId: aarav, amount: 40000 }]);
    expect(dinner.split).toEqual({ method: 'exact', amounts: { [ME_ID]: 10000, [chirag]: 10000, [diya]: 10000, [aarav]: 10000 } });

    // Diya paid for herself and Aarav: her own share is the cost minus what Aarav owes.
    const movie = plan.expenses[2].input;
    expect(movie.payers).toEqual([{ personId: diya, amount: 30000 }]);
    expect(movie.split).toEqual({ method: 'exact', amounts: { [aarav]: 15000, [diya]: 15000 } });
    expect(movie.category).toBe('entertainment');

    // You paid 90 for the cab, split three ways: 60 comes back to you.
    const cab = plan.expenses[1].input;
    expect(cab.payers).toEqual([{ personId: ME_ID, amount: 9000 }]);
    expect(cab.split).toEqual({ method: 'exact', amounts: { [aarav]: 3000, [chirag]: 3000, [ME_ID]: 3000 } });
  });

  it('turns settle-ups into payments, skips rows that change nothing and notes several payers', () => {
    const plan = buildSplitwiseImport(parsed(), options());
    const [aarav] = plan.personIds;
    expect(plan.payments).toHaveLength(1);
    expect(plan.payments[0].input).toEqual({
      groupId: plan.groupId,
      fromId: ME_ID,
      toId: aarav,
      amount: 10000,
      currency: 'INR',
      date: '2026-01-08',
      note: 'Imported from Splitwise',
      method: 'other',
    });
    expect(plan.skipped).toEqual([{ line: 8, reason: '"Nothing" changes nobody\'s balance' }]);
    expect(plan.notes).toEqual(['Line 7 "Gift for Diya": several payers, imported as net amounts.']);
    const gift = plan.expenses[3].input;
    expect(gift.total).toBe(20000);
    expect(gift.payers.map((p) => p.amount)).toEqual([10000, 10000]);
  });

  it("reproduces the file's final balances exactly", () => {
    const plan = buildSplitwiseImport(parsed(), options());
    const check = checkPlan(plan);
    expect(check).toEqual({ ok: true, checked: true, mismatches: [] });
    expect(planNets(plan).USD[ME_ID]).toBe(1000);
  });

  it('notes a row whose nets are off by a rounding paisa, and the check reports it', () => {
    const text = [
      'Date,Description,Category,Cost,Currency,A,B,C',
      '2026-03-01,Snacks,General,100.00,INR,66.67,-33.33,-33.33',
      '2026-03-31,Total balance, , ,INR,66.67,-33.33,-33.33',
    ].join('\n');
    const plan = buildSplitwiseImport(parsed(text), options({ meIndex: 0 }));
    expect(plan.notes).toEqual(['Line 2 "Snacks": rounding of ₹0.01 kept on the payer\'s share.']);
    const check = checkPlan(plan);
    expect(check.ok).toBe(false);
    expect(check.mismatches).toEqual([{ personId: ME_ID, currency: 'INR', expected: 6667, actual: 6666 }]);
  });

  it("skips a several-payer row that doesn't add up", () => {
    const text = ['Date,Description,Category,Cost,Currency,A,B,C', '2026-03-01,Odd,General,100.00,INR,50.00,40.00,-80.00'].join('\n');
    const plan = buildSplitwiseImport(parsed(text), options({ meIndex: 0 }));
    expect(plan.expenses).toHaveLength(0);
    expect(plan.skipped).toEqual([{ line: 2, reason: '"Odd" doesn\'t add up (paid ₹90.00, owed ₹80.00)' }]);
    expect(checkPlan(plan)).toEqual({ ok: false, checked: false, mismatches: [] });
  });
});

describe('buildSplitwiseImport (balances only)', () => {
  it('adds one "brought over" expense per currency that gives everyone their final balance', () => {
    const plan = buildSplitwiseImport(parsed(), options({ mode: 'balances' }));
    expect(plan.payments).toHaveLength(0);
    expect(plan.expenses.map((e) => [e.input.currency, e.input.total, e.input.date])).toEqual([
      ['INR', 21334, '2026-02-01'],
      ['USD', 1000, '2026-02-01'],
    ]);
    expect(plan.expenses[0].input.description).toBe('Balances brought over from Splitwise');
    expect(checkPlan(plan).ok).toBe(true);
  });
});

describe("the reducer's import/apply", () => {
  const at = '2026-02-01T10:00:00.000Z';

  it('creates the friends, group, expenses and payments with the same balances', () => {
    const plan = buildSplitwiseImport(parsed(), options());
    const before = blankState('2026-01-01T09:00:00.000Z');
    const after = appReducer(before, { type: 'import/apply', plan, at, activityId: 'act_import' });

    expect(after.friendIds).toEqual(expect.arrayContaining(plan.personIds.filter((id) => id !== ME_ID)));
    expect(after.people[plan.personIds[0]].name).toBe('Aarav');
    expect(after.groups[plan.groupId].name).toBe('Chai club');
    expect(after.groups[plan.groupId].memberIds).toEqual(expect.arrayContaining(plan.personIds));

    const expenses = Object.values(after.expenses).filter((e) => e.groupId === plan.groupId);
    const payments = Object.values(after.payments).filter((p) => p.groupId === plan.groupId);
    expect(expenses).toHaveLength(6);
    expect(payments).toHaveLength(1);
    expect(expenses.find((e) => e.description === 'Dinner')!.date).toBe('2026-01-05');

    const nets = computeNets(expenses, payments);
    for (const currency of Object.keys(plan.expected)) {
      for (const id of plan.personIds) expect([currency, id, nets[currency][id] || 0]).toEqual([currency, id, plan.expected[currency][id]]);
    }

    expect(after.activity[0]).toMatchObject({
      id: 'act_import',
      type: 'group_created',
      groupId: plan.groupId,
      summary: 'You imported 6 expenses and 1 payment from Splitwise into "Chai club".',
    });
  });

  it('does nothing when the same plan is applied twice', () => {
    const plan = buildSplitwiseImport(parsed(), options());
    const once = appReducer(blankState(at), { type: 'import/apply', plan, at, activityId: 'act_1' });
    const twice = appReducer(once, { type: 'import/apply', plan, at, activityId: 'act_2' });
    expect(twice).toBe(once);
  });
});
