import { ME_ID } from '../../app/src/types';
import type { AppState } from '../../app/src/types';
import { DEMO_IDS, createDemoState, createEmptyState, hasDemoData, removableDemoGroups, removeDemoData } from '../../app/src/store/seed';
import { appReducer } from '../../app/src/store/reducer';
import { checkIntegrity } from '../../app/src/store/backup';
import { equalExpense, run, stamp } from './fixtures';

const TODAY = '2026-10-19';
const MINE = 'g_mine';
const PAL = 'p_pal';

function demo(): AppState {
  return createDemoState(TODAY);
}

/** The demo plus a friend, a group and an expense the user added. */
function demoPlusMine(): AppState {
  return run(
    demo(),
    { type: 'friend/add', id: PAL, input: { name: 'Pal' }, ...stamp() },
    {
      type: 'group/create',
      id: MINE,
      input: { name: 'Hike', type: 'trip', emoji: '🥾', memberIds: [PAL], defaultCurrency: 'INR', simplifyDebts: true },
      ...stamp(),
    },
    { type: 'expense/add', id: 'e_mine', input: equalExpense({ groupId: MINE, ids: [ME_ID, PAL], total: 20000 }), ...stamp() },
  );
}

describe('hasDemoData', () => {
  it('is true for the demo, false for an empty state and after the demo is removed', () => {
    expect(hasDemoData(demo())).toBe(true);
    expect(hasDemoData(createEmptyState())).toBe(false);
    expect(hasDemoData(removeDemoData(demo(), []))).toBe(false);
  });
});

describe('removeDemoData', () => {
  it('leaves nothing of the plain demo but the profile and settings', () => {
    const before = demo();
    const after = removeDemoData(before, []);
    expect(Object.keys(after.groups)).toEqual([]);
    expect(after.friendIds).toEqual([]);
    expect(Object.keys(after.expenses)).toEqual([]);
    expect(Object.keys(after.payments)).toEqual([]);
    expect(after.activity).toEqual([]);
    expect(Object.keys(after.people)).toEqual([ME_ID]);
    expect(after.people[ME_ID]).toBe(before.people[ME_ID]);
    expect(after.settings).toEqual(before.settings);
    expect(checkIntegrity(after)).toEqual([]);
  });

  it('keeps a group, friend and expense the user added', () => {
    const after = removeDemoData(demoPlusMine(), []);
    expect(Object.keys(after.groups)).toEqual([MINE]);
    expect(after.friendIds).toEqual([PAL]);
    expect(Object.keys(after.expenses)).toEqual(['e_mine']);
    expect(after.activity.length).toBeGreaterThan(0);
    expect(after.activity.every((a) => a.groupId === MINE || a.personId === PAL)).toBe(true);
    expect(checkIntegrity(after)).toEqual([]);
  });

  it('keeps a demo friend who is in the user\'s own group', () => {
    const state = run(demo(), {
      type: 'group/create',
      id: MINE,
      input: { name: 'Hike', type: 'trip', emoji: '🥾', memberIds: [DEMO_IDS.aarav], defaultCurrency: 'INR', simplifyDebts: true },
      ...stamp(),
    });
    const after = removeDemoData(state, []);
    expect(after.friendIds).toEqual([DEMO_IDS.aarav]);
    expect(after.people[DEMO_IDS.aarav]).toBeDefined();
    expect(Object.keys(after.groups)).toEqual([MINE]);
    expect(checkIntegrity(after)).toEqual([]);
  });

  it('keeps a demo group listed in keepGroupIds with its expenses and members', () => {
    const before = demo();
    const after = removeDemoData(before, [DEMO_IDS.goa]);
    expect(Object.keys(after.groups)).toEqual([DEMO_IDS.goa]);
    const goaExpenses = Object.values(before.expenses).filter((e) => e.groupId === DEMO_IDS.goa).map((e) => e.id).sort();
    expect(Object.keys(after.expenses).sort()).toEqual(goaExpenses);
    for (const id of before.groups[DEMO_IDS.goa].memberIds) expect(after.people[id]).toBeDefined();
    expect(after.groups[DEMO_IDS.flat]).toBeUndefined();
    expect(after.people[DEMO_IDS.ishaan]).toBeUndefined();
    expect(after.friendIds).not.toContain(DEMO_IDS.ishaan);
    expect(checkIntegrity(after)).toEqual([]);
  });

  it('returns the same object when there is nothing to remove', () => {
    const empty = createEmptyState();
    expect(removeDemoData(empty, [])).toBe(empty);
    const mine = run(
      empty,
      { type: 'friend/add', id: PAL, input: { name: 'Pal' }, ...stamp() },
      { type: 'expense/add', id: 'e_mine', input: equalExpense({ groupId: null, ids: [ME_ID, PAL] }), ...stamp() },
    );
    expect(removeDemoData(mine, [])).toBe(mine);
  });

  it('is what the demo/remove action does', () => {
    const state = demoPlusMine();
    expect(appReducer(state, { type: 'demo/remove', keepGroupIds: [] })).toEqual(removeDemoData(state, []));
  });
});

describe('a new install', () => {
  it('starts with nothing but you', () => {
    const s = createEmptyState();
    expect(Object.keys(s.people)).toEqual([ME_ID]);
    expect(Object.keys(s.groups)).toEqual([]);
    expect(s.activity).toEqual([]);
  });
});

describe('removableDemoGroups', () => {
  it('lists the demo groups that are not kept, and none without the demo', () => {
    const state = createDemoState('2026-10-19');
    expect(removableDemoGroups(state, []).map((g) => g.id).sort()).toEqual([DEMO_IDS.flat, DEMO_IDS.goa].sort());
    expect(removableDemoGroups(state, [DEMO_IDS.goa]).map((g) => g.id)).toEqual([DEMO_IDS.flat]);
    expect(removableDemoGroups(state, [DEMO_IDS.goa, DEMO_IDS.flat])).toEqual([]);
    expect(removableDemoGroups(createEmptyState(), [])).toEqual([]);
  });
});
