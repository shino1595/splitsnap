import { ME_ID } from '../../app/src/types';
import type { AppState, CurrencyAmounts, Expense } from '../../app/src/types';
import { createDemoState, createEmptyState, DEMO_IDS } from '../../app/src/store/seed';
import { buildExpense } from '../../app/src/store/reducer';
import {
  canDeleteGroup,
  canRemoveFriend,
  expenseGroupName,
  friendBalance,
  friendBalanceByGroup,
  friendTimeline,
  groupDebts,
  groupMembers,
  groupNets,
  groupTimeline,
  groupTotals,
  listFriends,
  listGroups,
  liveExpenses,
  livePayments,
  myGroupBalance,
  nonGroupDebts,
  nonGroupTimeline,
  overallSummary,
  personName,
  searchExpenses,
} from '../../app/src/store/selectors';
import { computeOwed, validatePayers } from '../../app/src/lib/split';
import { addAmounts, balanceBetween, computeNets } from '../../app/src/lib/balances';

const TODAY = '2026-10-14';
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const owedOf = (e: Expense, id: string): number => sum(e.owed.filter((o) => o.personId === id).map((o) => o.amount));

function sumAmounts(list: CurrencyAmounts[]): CurrencyAmounts {
  return list.reduce((acc, a) => addAmounts(acc, a), {} as CurrencyAmounts);
}

// The demo must hold together whatever day the app is opened (month ends, leap day, new year).
const DAYS = ['2026-10-14', '2026-03-31', '2027-01-01', '2028-02-29', '2026-05-31'];

describe('demo data invariants', () => {
  DAYS.forEach((today) => {
    const state = createDemoState(today);

    it(`every expense is valid and dated on or before today (${today})`, () => {
      const expenses = Object.values(state.expenses);
      expect(expenses.length).toBeGreaterThanOrEqual(12);
      for (const e of expenses) {
        expect(sum(e.payers.map((p) => p.amount))).toBe(e.total);
        expect(sum(e.owed.map((o) => o.amount))).toBe(e.total);
        const recomputed = computeOwed(e.total, e.split, e.currency);
        expect(recomputed.errors).toEqual([]);
        expect(e.owed).toEqual(recomputed.owed);
        expect(validatePayers(e.total, e.payers, e.currency)).toEqual([]);
        const { owed: _owed, ...rest } = e;
        const again = buildExpense(state, { ...rest, notes: e.notes }, { id: e.id, at: e.createdAt, createdBy: e.createdBy });
        expect(again.errors).toEqual([]);
        expect(e.date <= today).toBe(true);
        expect(state.people[e.createdBy]).toBeDefined();
      }
      for (const p of Object.values(state.payments)) {
        expect(p.amount).toBeGreaterThan(0);
        expect(p.date <= today).toBe(true);
      }
    });

    it(`nets in every group and outside groups sum to zero (${today})`, () => {
      const scopes = [...Object.keys(state.groups).map((id) => groupNets(state, id)), computeNets(liveExpenses(state, { groupId: null }), livePayments(state, { groupId: null }))];
      for (const nets of scopes) {
        for (const currency of Object.keys(nets)) {
          expect(sum(Object.keys(nets[currency]).map((id) => nets[currency][id]))).toBe(0);
        }
      }
    });

    it(`friend balances add up to the overall summary (${today})`, () => {
      const balances = listFriends(state).map((f) => {
        const expected = sumAmounts([
          ...Object.keys(state.groups).map((g) => balanceBetween(groupDebts(state, g), ME_ID, f.id)),
          balanceBetween(nonGroupDebts(state), ME_ID, f.id),
        ]);
        const actual = friendBalance(state, f.id);
        expect(actual).toEqual(expected);
        return actual;
      });
      const summary = overallSummary(state);
      expect(summary.net).toEqual(sumAmounts(balances));
      expect(addAmounts(summary.owedToMe, Object.keys(summary.iOwe).reduce((acc, c) => ({ ...acc, [c]: -summary.iOwe[c] }), {} as CurrencyAmounts))).toEqual(summary.net);
      const groupsAndNonGroup = sumAmounts([
        ...Object.keys(state.groups).map((g) => myGroupBalance(state, g)),
        sumAmounts(listFriends(state).map((f) => balanceBetween(nonGroupDebts(state), ME_ID, f.id))),
      ]);
      expect(summary.net).toEqual(groupsAndNonGroup);
    });

    it(`group totals add up (${today})`, () => {
      for (const groupId of Object.keys(state.groups)) {
        const totals = groupTotals(state, groupId);
        expect(totals[0].currency).toBe(state.groups[groupId].defaultCurrency);
        for (const t of totals) {
          const expenses = liveExpenses(state, { groupId }).filter((e) => e.currency === t.currency);
          expect(t.totalSpent).toBe(sum(expenses.map((e) => e.total)));
          expect(sum(t.byCategory.map((x) => x.amount))).toBe(t.totalSpent);
          expect(sum(t.byMonth.map((x) => x.amount))).toBe(t.totalSpent);
          expect(sum(t.byPayer.map((x) => x.amount))).toBe(t.totalSpent);
          expect(t.myShare).toBe(sum(expenses.map((e) => owedOf(e, ME_ID))));
          expect(t.iPaid).toBe(sum(expenses.map((e) => sum(e.payers.filter((p) => p.personId === ME_ID).map((p) => p.amount)))));
        }
      }
    });

    it(`recurring rent has two copies and a future next date (${today})`, () => {
      const rent = state.expenses[DEMO_IDS.rent];
      expect(rent.recurrence && rent.recurrence.nextDate > today).toBe(true);
      const copies = Object.values(state.expenses).filter((e) => e.recurringParentId === DEMO_IDS.rent);
      expect(copies).toHaveLength(2);
      expect(copies.every((c) => c.date.slice(8) === '01')).toBe(true);
    });

    it(`activity is newest first and starts with real events (${today})`, () => {
      expect(state.activity.length).toBeGreaterThan(10);
      for (let i = 1; i < state.activity.length; i++) {
        expect(state.activity[i - 1].at >= state.activity[i].at).toBe(true);
      }
      expect(state.activity.some((a) => a.type === 'friend_added')).toBe(false);
    });
  });
});

describe('demo data content', () => {
  const state = createDemoState(TODAY);
  const goa = DEMO_IDS.goa;

  it('has the six friends with UPI ids and the two groups', () => {
    expect(listFriends(state).map((p) => p.name)).toEqual(['Aarav', 'Bhavna', 'Chirag', 'Diya', 'Ishaan', 'Meera']);
    expect(state.people[DEMO_IDS.aarav].upiId).toBe('aarav@okicici');
    expect(listFriends(state).every((p) => !!p.upiId && p.upiId.indexOf('@') > 0)).toBe(true);
    expect(state.groups[goa].memberIds).toEqual([ME_ID, DEMO_IDS.aarav, DEMO_IDS.bhavna, DEMO_IDS.chirag, DEMO_IDS.diya]);
    expect(state.groups[goa].simplifyDebts).toBe(true);
    expect(state.groups[DEMO_IDS.flat].memberIds).toEqual([ME_ID, DEMO_IDS.ishaan, DEMO_IDS.meera]);
    expect(state.settings).toEqual({ defaultCurrency: 'INR', ocrApiKey: '', ocrEngine: 2, simplifyDebtsDefault: true, appearance: 'system' });
  });

  it('splits the Punjab Grill bill exactly as in the example', () => {
    const dinner = state.expenses[DEMO_IDS.dinner];
    expect(dinner.total).toBe(146000);
    expect(dinner.split.method).toBe('itemized');
    expect(owedOf(dinner, DEMO_IDS.aarav)).toBe(31511);
    expect(owedOf(dinner, DEMO_IDS.bhavna)).toBe(33612);
    expect(owedOf(dinner, DEMO_IDS.chirag)).toBe(47266);
    expect(owedOf(dinner, DEMO_IDS.diya)).toBe(33611);
    expect(owedOf(dinner, ME_ID)).toBe(0);
    expect(dinner.comments).toHaveLength(1);
  });

  it('includes a multi-payer expense, a USD expense and a payment in Goa Trip', () => {
    expect(state.expenses[DEMO_IDS.scuba].payers).toHaveLength(2);
    expect(state.expenses[DEMO_IDS.insurance].currency).toBe('USD');
    expect(livePayments(state, { groupId: goa })).toHaveLength(1);
    expect(groupTotals(state, goa).map((t) => t.currency)).toEqual(['INR', 'USD']);
    expect(groupTotals(state, goa)[0].totalSpent).toBe(4281000);
  });

  it('computes my balances per group and per friend', () => {
    expect(myGroupBalance(state, goa)).toEqual({ INR: 1462000, USD: 7200 });
    expect(myGroupBalance(state, DEMO_IDS.flat)).toEqual({ INR: 4652675 });
    expect(friendBalance(state, DEMO_IDS.aarav)).toEqual({ INR: 335511, USD: 1800 });
    expect(friendBalance(state, DEMO_IDS.diya)).toEqual({ INR: -76389, USD: 1800 });
    expect(friendBalance(state, DEMO_IDS.ishaan)).toEqual({ INR: 1160700 });
    expect(friendBalanceByGroup(state, DEMO_IDS.diya).map((r) => r.groupId)).toEqual([goa, null]);
    expect(overallSummary(state)).toEqual({
      owedToMe: { INR: 5991064, USD: 7200 },
      iOwe: { INR: 76389 },
      net: { INR: 5914675, USD: 7200 },
    });
  });

  it('refuses destructive actions while balances are open', () => {
    expect(canDeleteGroup(state, goa).ok).toBe(false);
    expect(canRemoveFriend(state, DEMO_IDS.diya).reason).toContain('you owe Diya ₹763.89');
  });
});

describe('selectors', () => {
  const state = createDemoState(TODAY);
  const goa = DEMO_IDS.goa;

  it('names people', () => {
    expect(personName(state, ME_ID)).toBe('You');
    expect(personName(state, ME_ID, { you: 'you' })).toBe('you');
    expect(personName(state, DEMO_IDS.aarav)).toBe('Aarav');
    expect(personName(state, 'nobody')).toBe('Unknown');
  });

  it('lists groups by latest activity and members with me first', () => {
    expect(listGroups(state).map((g) => g.id)).toEqual([goa, DEMO_IDS.flat]);
    expect(groupMembers(state, goa)[0].id).toBe(ME_ID);
    expect(groupMembers(state, 'missing')).toEqual([]);
    expect(expenseGroupName(state, { groupId: null })).toBe('Non-group expenses');
    expect(expenseGroupName(state, { groupId: goa })).toBe('Goa Trip');
  });

  it('filters live expenses and builds timelines newest first', () => {
    expect(liveExpenses(state, { groupId: null }).map((e) => e.id)).toEqual([DEMO_IDS.movie]);
    const timeline = groupTimeline(state, goa);
    expect(timeline[0].kind).toBe('payment');
    const dates = timeline.map((t) => (t.kind === 'expense' ? t.expense.date : t.payment.date));
    expect(dates.slice().sort().reverse()).toEqual(dates);
    expect(nonGroupTimeline(state)).toHaveLength(1);

    const withDiya = friendTimeline(state, DEMO_IDS.diya);
    const ids = withDiya.map((t) => (t.kind === 'expense' ? t.expense.id : t.payment.id));
    expect(ids).toContain(DEMO_IDS.movie);
    expect(ids).toContain('pay_goa_diya');
    expect(ids).not.toContain(DEMO_IDS.scuba);
  });

  it('ignores deleted expenses everywhere', () => {
    const deleted: AppState = {
      ...state,
      expenses: { ...state.expenses, [DEMO_IDS.movie]: { ...state.expenses[DEMO_IDS.movie], deletedAt: '2026-10-14T00:00:00.000Z' } },
    };
    expect(liveExpenses(deleted, { groupId: null })).toEqual([]);
    expect(friendBalance(deleted, DEMO_IDS.diya)).toEqual({ INR: 123611, USD: 1800 });
  });

  it('searches descriptions, item names and people', () => {
    expect(searchExpenses(state, 'naan').map((e) => e.id)).toEqual([DEMO_IDS.dinner]);
    expect(searchExpenses(state, 'AARAV scuba').map((e) => e.id)).toEqual([DEMO_IDS.scuba]);
    expect(searchExpenses(state, 'anjuna').length).toBe(1);
    expect(searchExpenses(state, '   ')).toEqual([]);
    expect(searchExpenses(state, 'zzzz')).toEqual([]);
  });

  it('handles an empty state', () => {
    const empty = createEmptyState();
    expect(listFriends(empty)).toEqual([]);
    expect(listGroups(empty)).toEqual([]);
    expect(overallSummary(empty)).toEqual({ owedToMe: {}, iOwe: {}, net: {} });
    expect(groupTotals(empty, 'missing')).toEqual([]);
    expect(friendBalance(empty, 'nobody')).toEqual({});
  });
});
