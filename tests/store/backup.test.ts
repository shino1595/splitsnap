import { ME_ID } from '../../app/src/types';
import type { AppState } from '../../app/src/types';
import { createDemoState, createEmptyState } from '../../app/src/store/seed';
import {
  BACKUP_FORMAT,
  MAX_BACKUP_BYTES,
  backupFilename,
  buildBackup,
  checkIntegrity,
  countsOf,
  countsText,
  readBackup,
  restoreState,
} from '../../app/src/store/backup';
import { buildSplitwiseImport, parseSplitwiseExport } from '../../app/src/lib/splitwiseImport';
import { A, B, TRIP, equalExpense, makeState, payment, run, stamp } from './fixtures';

const TODAY = '2026-10-19';
const AT = '2026-11-12T10:00:00.000Z';

function demo(): AppState {
  return createDemoState(TODAY);
}

/** A deep copy that tests can tamper with. */
function copy(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function firstExpenseId(state: AppState): string {
  return Object.keys(state.expenses)[0];
}

describe('buildBackup / readBackup', () => {
  it('round-trips the state, leaving out the OCR key', () => {
    const state = demo();
    state.settings.ocrApiKey = 'SECRET';
    const text = buildBackup(state, { at: AT, sharedGroupIds: [] });
    const result = readBackup(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual({ ...state, settings: { ...state.settings, ocrApiKey: '' } });
    expect(result.exportedAt).toBe(AT);
    expect(result.counts).toEqual(countsOf(state));
    expect(text).not.toContain('SECRET');
  });

  it('keeps the shared group ids that exist in the state', () => {
    const state = demo();
    const gid = Object.keys(state.groups)[0];
    const text = buildBackup(state, { at: AT, sharedGroupIds: [gid, 'nope'] });
    const result = readBackup(text);
    expect(result.ok && result.sharedGroupIds).toEqual([gid]);
    expect(JSON.parse(text).format).toBe(BACKUP_FORMAT);
  });

  it('accepts a bare saved state, with a BOM and whitespace', () => {
    const result = readBackup('﻿  \n' + JSON.stringify(demo()) + '\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exportedAt).toBeNull();
    expect(result.sharedGroupIds).toEqual([]);
  });

  it('names the file by date', () => {
    expect(backupFilename('2026-11-12')).toBe('splitsnap-backup-2026-11-12.json');
  });

  function error(text: string): string {
    const result = readBackup(text);
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.error;
  }

  it('rejects an empty file', () => {
    expect(error('')).toBe('That file is empty.');
    expect(error(' \n﻿ ')).toBe('That file is empty.');
  });

  it('rejects a file that is too long', () => {
    expect(error('x'.repeat(MAX_BACKUP_BYTES + 1))).toContain('too big');
  });

  it('rejects text that is not a backup', () => {
    const notBackup = "This isn't a SplitSnap backup file.";
    expect(error('hello')).toBe(notBackup);
    expect(error('[1,2]')).toBe(notBackup);
    expect(error('{"a":1}')).toBe(notBackup);
    expect(error('{"format":"other","version":1}')).toBe(notBackup);
    expect(error(JSON.stringify({ format: BACKUP_FORMAT, version: 'x', state: demo() }))).toBe(notBackup);
    expect(error(JSON.stringify({ format: BACKUP_FORMAT, version: 0, state: demo() }))).toBe(notBackup);
    expect(error(JSON.stringify({ format: BACKUP_FORMAT, version: 1.5, state: demo() }))).toBe(notBackup);
  });

  it('rejects a backup from a newer backup format or schema', () => {
    const newer = 'This backup was made by a newer version of SplitSnap. Update the app, then try again.';
    expect(error(JSON.stringify({ format: BACKUP_FORMAT, version: 2, state: demo() }))).toBe(newer);
    expect(error(JSON.stringify({ ...demo(), schemaVersion: 99 }))).toBe(newer);
  });

  it('rejects a damaged state', () => {
    const damaged = "This backup is damaged and can't be used.";
    expect(error(JSON.stringify({ format: BACKUP_FORMAT, version: 1, state: { schemaVersion: 1 } }))).toBe(damaged);
    expect(error(JSON.stringify({ format: BACKUP_FORMAT, version: 1, state: 5 }))).toBe(damaged);
  });

  it('rejects a state that fails the integrity check, naming the first problem and the rest', () => {
    const bad = copy(demo());
    bad.expenses[firstExpenseId(bad)].payers = [{ personId: 'ghost', amount: 100 }];
    const message = error(JSON.stringify(bad));
    expect(message).toContain("This backup can't be used: ");
    expect(message).toContain('more problem');

    const one = copy(demo());
    one.expenses[firstExpenseId(one)].date = 'yesterday';
    expect(error(JSON.stringify(one))).toMatch(/^This backup can't be used: the expense ".*" has a bad date$/);
  });
});

describe('checkIntegrity', () => {
  it('passes for the demo state', () => {
    expect(checkIntegrity(demo())).toEqual([]);
  });

  it('passes for an empty state', () => {
    expect(checkIntegrity(createEmptyState())).toEqual([]);
  });

  it('passes for a state built through the reducer', () => {
    const state = run(
      makeState(),
      { type: 'friend/add', id: 'p_d', input: { name: 'Diya' }, ...stamp() },
      {
        type: 'group/create',
        id: 'g_two',
        input: { name: 'Flat', type: 'home', emoji: '🏠', memberIds: [A], defaultCurrency: 'INR', simplifyDebts: false },
        ...stamp(),
      },
      { type: 'expense/add', id: 'e1', input: equalExpense(), ...stamp() },
      { type: 'expense/add', id: 'e2', input: equalExpense({ groupId: null, ids: [ME_ID, 'p_d'], total: 5000, description: 'Tea' }), ...stamp() },
      { type: 'payment/add', id: 'pay1', input: payment(), ...stamp() },
      { type: 'comment/add', expenseId: 'e1', commentId: 'c1', text: 'hi', ...stamp() },
      { type: 'expense/delete', id: 'e2', ...stamp() },
      { type: 'friend/remove', id: 'p_d', ...stamp() },
    );
    expect(Object.keys(state.expenses)).toHaveLength(2);
    expect(state.expenses.e2.deletedAt).toBeDefined();
    expect(checkIntegrity(state)).toEqual([]);
  });

  it('passes for a Splitwise import', () => {
    const text = [
      'Date,Description,Category,Cost,Currency,Aarav,Bhavna,Chirag',
      '',
      '2026-01-05,Dinner,Dining out,300.00,INR,200.00,-100.00,-100.00',
      '2026-01-06,Payment,Payment,100.00,INR,-100.00,100.00,0.00',
      '',
      '2026-01-31,Total balance, , ,INR,100.00,0.00,-100.00',
    ].join('\r\n');
    const parsed = parseSplitwiseExport(text);
    if (!parsed.data) throw new Error(parsed.error);
    let n = 0;
    const plan = buildSplitwiseImport(parsed.data, {
      groupName: 'Chai',
      meIndex: 1,
      mode: 'history',
      today: '2026-02-01',
      existingPeople: [],
      makeId: (prefix) => `${prefix}_${++n}`,
    });
    const state = run(createEmptyState(), { type: 'import/apply', plan, ...stamp() });
    expect(Object.keys(state.expenses).length).toBeGreaterThan(0);
    expect(checkIntegrity(state)).toEqual([]);
  });

  function problems(edit: (s: AppState) => void): string[] {
    const s = copy(demo());
    edit(s);
    return checkIntegrity(s);
  }

  it('flags reserved record keys', () => {
    const raw = JSON.stringify(demo()).replace('"people":{', '"people":{"__proto__":{"id":"__proto__","name":"x","color":"#000"},');
    const parsed = JSON.parse(raw) as AppState;
    expect(checkIntegrity(parsed).join(' ')).toContain('__proto__');
  });

  it('flags friend list problems', () => {
    expect(problems((s) => s.friendIds.push('ghost'))[0]).toContain("doesn't exist");
    expect(problems((s) => s.friendIds.push(ME_ID))[0]).toContain('includes you');
    expect(problems((s) => s.friendIds.push(s.friendIds[0]))[0]).toContain('twice');
  });

  it('flags group problems', () => {
    const gid = (s: AppState): string => Object.keys(s.groups)[0];
    expect(problems((s) => s.groups[gid(s)].memberIds.push('ghost'))[0]).toContain("lists a member that doesn't exist");
    expect(
      problems((s) => {
        s.groups[gid(s)].memberIds = s.groups[gid(s)].memberIds.filter((m) => m !== ME_ID);
      })[0],
    ).toContain("doesn't include you");
    expect(problems((s) => s.groups[gid(s)].memberIds.push(ME_ID))[0]).toContain('twice');
    expect(
      problems((s) => {
        (s.groups[gid(s)] as unknown as Record<string, unknown>).simplifyDebts = 'yes';
      })[0],
    ).toContain('debt setting');
    expect(
      problems((s) => {
        (s.groups[gid(s)] as unknown as Record<string, unknown>).emoji = 5;
      })[0],
    ).toContain('type or emoji');
  });

  it('flags expense problems', () => {
    type E = AppState['expenses'][string];
    const edit = (f: (e: E) => void): string[] => problems((s) => f(s.expenses[firstExpenseId(s)]));
    const loose = (e: E): Record<string, unknown> => e as unknown as Record<string, unknown>;
    expect(edit((e) => { e.total = 0; })[0]).toContain('bad total');
    expect(edit((e) => { e.total = 10.5; })[0]).toContain('bad total');
    expect(edit((e) => { e.groupId = 'ghost'; })[0]).toContain("group that doesn't exist");
    expect(edit((e) => { e.payers = []; })[0]).toContain('bad payer list');
    expect(edit((e) => { e.payers = [{ personId: ME_ID, amount: -5 }]; })[0]).toContain('bad payer list');
    expect(edit((e) => { e.owed = [{ personId: ME_ID, amount: 10.5 }]; })[0]).toContain('bad amount owed');
    expect(edit((e) => { e.owed = [...e.owed, { personId: 'ghost', amount: 0 }]; })[0]).toContain("someone who doesn't exist");
    expect(
      edit((e) => {
        e.owed = [{ personId: ME_ID, amount: e.payers.reduce((x, p) => x + p.amount, 0) + 1 }];
      })[0],
    ).toContain("shares that don't add up");
    expect(edit((e) => { e.date = '12/11/2026'; })[0]).toContain('bad date');
    expect(edit((e) => { loose(e).createdBy = 3; })[0]).toContain('missing some details');
    expect(edit((e) => { loose(e).deletedAt = 3; })[0]).toContain('bad deleted time');
    expect(edit((e) => { e.comments = [{ id: 'c', authorId: ME_ID, text: 5 as unknown as string, createdAt: 'x' }]; })[0]).toContain('bad comment');
  });

  it('flags a split or repeat setting the editor could not open', () => {
    type E = AppState['expenses'][string];
    const edit = (f: (e: E) => void): string[] => problems((s) => f(s.expenses[firstExpenseId(s)]));
    const loose = (e: E): Record<string, unknown> => e as unknown as Record<string, unknown>;
    expect(edit((e) => { loose(e).split = { method: 'thirds' }; })[0]).toContain("split that can't be read");
    expect(edit((e) => { loose(e).split = { method: 'equal' }; })[0]).toContain("split that can't be read");
    expect(edit((e) => { loose(e).split = { method: 'exact', amounts: { [ME_ID]: 'all' } }; })[0]).toContain("split that can't be read");
    expect(edit((e) => { loose(e).split = { method: 'itemized' }; })[0]).toContain("split that can't be read");
    expect(
      edit((e) => {
        loose(e).split = { method: 'itemized', bill: { items: [{ id: 'i', name: 'Naan', quantity: 1, amount: 1.5, shares: {} }], charges: [] } };
      })[0],
    ).toContain("split that can't be read");
    expect(edit((e) => { loose(e).recurrence = { frequency: 'daily', nextDate: '2026-12-01' }; })[0]).toContain('bad repeat setting');
    expect(edit((e) => { loose(e).recurrence = { frequency: 'monthly', nextDate: 'soon' }; })[0]).toContain('bad repeat setting');
    expect(edit((e) => { e.recurrence = { frequency: 'monthly', nextDate: '2026-12-01' }; })).toEqual([]);
  });

  it('does not require shares to equal the total', () => {
    const s = copy(demo());
    const e = s.expenses[firstExpenseId(s)];
    e.payers = [{ personId: ME_ID, amount: 700 }];
    e.owed = [{ personId: ME_ID, amount: 300 }, { personId: ME_ID, amount: 400 }];
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('flags payment problems', () => {
    const base = run(makeState(), { type: 'payment/add', id: 'pay1', input: payment(), ...stamp() });
    const edit = (f: (p: AppState['payments'][string]) => void): string[] => {
      const s = copy(base);
      f(s.payments.pay1);
      return checkIntegrity(s);
    };
    expect(checkIntegrity(base)).toEqual([]);
    expect(edit((p) => { p.toId = p.fromId; })[0]).toContain('themselves');
    expect(edit((p) => { p.toId = 'ghost'; }).join(' ')).toContain("someone who doesn't exist");
    expect(edit((p) => { p.groupId = 'ghost'; })[0]).toContain("group that doesn't exist");
    expect(edit((p) => { p.amount = 1.5; })[0]).toContain('bad amount');
    expect(edit((p) => { p.date = 'x'; })[0]).toContain('bad date');
  });

  it('flags activity and settings problems', () => {
    expect(problems((s) => { s.activity[0] = { ...s.activity[0], at: 5 as unknown as string }; })[0]).toContain('activity entry 1');
    expect(problems((s) => { s.settings.defaultCurrency = 'RUPEES'; })[0]).toContain('default currency');
  });
});

describe('restoreState', () => {
  const noShare = { sharedHere: [], sharedInBackup: [], includeSharedCopies: false };

  it('replaces everything when nothing is shared', () => {
    const current = demo();
    const backup = makeState();
    const next = restoreState(current, backup, noShare);
    expect(Object.keys(next.groups)).toEqual(Object.keys(backup.groups));
    expect(next.friendIds).toEqual(backup.friendIds);
    expect(next.schemaVersion).toBe(backup.schemaVersion);
    expect(next.people[ME_ID]).toBe(backup.people[ME_ID]);
    expect(checkIntegrity(next)).toEqual([]);
  });

  /** Current phone: Trip is shared and has newer data; the backup has its own older Trip plus another group. */
  function sharedScenario(): { current: AppState; backup: AppState } {
    const current = run(
      makeState(),
      { type: 'expense/add', id: 'e_new', input: equalExpense({ description: 'Newer dinner' }), ...stamp() },
      { type: 'payment/add', id: 'pay_new', input: payment(), ...stamp() },
      { type: 'person/update', id: ME_ID, patch: { name: 'Sam' }, ...stamp() },
    );
    const backup = run(
      makeState(),
      { type: 'expense/add', id: 'e_old', input: equalExpense({ description: 'Old dinner' }), ...stamp('2026-09-02T10:00:00.000Z') },
      { type: 'friend/add', id: 'p_z', input: { name: 'Zoya' }, ...stamp() },
      {
        type: 'group/create',
        id: 'g_own',
        input: { name: 'Own', type: 'other', emoji: '🎯', memberIds: ['p_z'], defaultCurrency: 'INR', simplifyDebts: true },
        ...stamp(),
      },
      { type: 'expense/add', id: 'e_own', input: equalExpense({ groupId: 'g_own', ids: [ME_ID, 'p_z'], description: 'Own thing' }), ...stamp() },
    );
    return { current, backup };
  }

  it('keeps a group shared on this phone exactly as it is', () => {
    const { current, backup } = sharedScenario();
    const next = restoreState(current, backup, { sharedHere: [TRIP], sharedInBackup: [TRIP], includeSharedCopies: false });
    expect(next.groups[TRIP]).toBe(current.groups[TRIP]);
    expect(next.expenses.e_new).toBe(current.expenses.e_new);
    expect(next.payments.pay_new).toBe(current.payments.pay_new);
    expect(next.expenses.e_old).toBeUndefined();
    expect(next.groups.g_own).toBe(backup.groups.g_own);
    expect(next.expenses.e_own).toBe(backup.expenses.e_own);
    expect(next.people[ME_ID]).toBe(current.people[ME_ID]);
    expect(next.people[A]).toBe(current.people[A]);
    expect(next.friendIds).toContain(B);
    expect(checkIntegrity(next)).toEqual([]);
  });

  it('leaves out groups that were shared in the backup but are not shared here, unless copies are asked for', () => {
    const { current, backup } = sharedScenario();
    const without = restoreState(current, backup, { sharedHere: [], sharedInBackup: [TRIP], includeSharedCopies: false });
    expect(without.groups[TRIP]).toBeUndefined();
    expect(without.expenses.e_old).toBeUndefined();
    expect(without.groups.g_own).toBeDefined();
    expect(checkIntegrity(without)).toEqual([]);

    const withCopies = restoreState(current, backup, { sharedHere: [], sharedInBackup: [TRIP], includeSharedCopies: true });
    expect(withCopies.groups[TRIP]).toBe(backup.groups[TRIP]);
    expect(withCopies.expenses.e_old).toBe(backup.expenses.e_old);
    expect(checkIntegrity(withCopies)).toEqual([]);
  });

  it('ignores shared ids that are not on this phone', () => {
    const { current, backup } = sharedScenario();
    const next = restoreState(current, backup, { sharedHere: ['g_missing'], sharedInBackup: [], includeSharedCopies: false });
    expect(next.groups[TRIP]).toBe(backup.groups[TRIP]);
  });

  it('takes the backup OCR key unless it is empty', () => {
    const current = demo();
    current.settings.ocrApiKey = 'mine';
    const backup = copy(demo());
    backup.settings.ocrApiKey = '';
    expect(restoreState(current, backup, noShare).settings.ocrApiKey).toBe('mine');
    backup.settings.ocrApiKey = 'theirs';
    expect(restoreState(current, backup, noShare).settings.ocrApiKey).toBe('theirs');
  });

  it('orders activity newest first', () => {
    const { current, backup } = sharedScenario();
    const next = restoreState(current, backup, { sharedHere: [TRIP], sharedInBackup: [], includeSharedCopies: false });
    for (let i = 1; i < next.activity.length; i++) expect(next.activity[i - 1].at >= next.activity[i].at).toBe(true);
  });
});

describe('countsText', () => {
  it('reads as one line', () => {
    expect(countsText({ groups: 3, friends: 6, expenses: 42, payments: 5 })).toBe('3 groups · 6 friends · 42 expenses · 5 payments');
    expect(countsText({ groups: 1, friends: 1, expenses: 1, payments: 1 })).toBe('1 group · 1 friend · 1 expense · 1 payment');
  });
});
