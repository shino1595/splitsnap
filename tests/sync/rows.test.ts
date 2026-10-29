import { ME_ID } from '../../app/src/types';
import type { Activity, AppState, Expense, Payment, SplitInput } from '../../app/src/types';
import {
  batchToLocal,
  neutralSummary,
  pushActivity,
  pushComment,
  pushExpense,
  pushGroup,
  pushMember,
  pushPayment,
  shareRequest,
  timeOf,
} from '../../app/src/sync/rows';
import { EMPTY_BATCH, EMPTY_SYNC_STATE } from '../../app/src/sync/types';
import type { ActivityRow, CommentRow, DataRow, GroupRow, MemberRow, PushData, RemoteBatch, SharedGroupInfo, SyncState } from '../../app/src/sync/types';
import { computeOwed } from '../../app/src/lib/split';
import { blankState } from '../../app/src/store/stateShape';
import { avatarPalette } from '../../app/src/theme';

const GOA = 'grp_goa';
const OTHER = 'grp_other';
const AARAV = 'u_aarav01'; // Aarav shared Goa Trip: his member id
const BHAVNA = 'per_bhavna'; // Bhavna's placeholder, which she claimed on her phone
const CHIRAG = 'per_chirag'; // still a placeholder
const DIYA = 'u_diya02'; // joined as a new member
const T0 = '2026-10-01T10:00:00.000Z';
const LATER = '2026-10-05T10:00:00.123456+00:00';

function infoFor(myMemberId: string, extra: Partial<SharedGroupInfo> = {}): SharedGroupInfo {
  return { groupId: GOA, myMemberId, joinCode: 'ABCD2345', joinEnabled: true, members: {}, cursor: null, ...extra };
}

function syncWith(info: SharedGroupInfo): SyncState {
  return { ...EMPTY_SYNC_STATE, userId: 'user-x', displayName: 'X', groups: { [info.groupId]: info } };
}

const AARAV_INFO = infoFor(AARAV);
const BHAVNA_INFO = infoFor(BHAVNA);

function aaravsPhone(): AppState {
  const s = blankState(T0);
  return {
    ...s,
    people: {
      [ME_ID]: { ...s.people[ME_ID], name: 'Aarav' },
      [BHAVNA]: { id: BHAVNA, name: 'Bhavna', color: '#F2994A', createdAt: T0 },
      [CHIRAG]: { id: CHIRAG, name: 'Chirag', color: '#9B51E0', createdAt: T0 },
    },
    friendIds: [BHAVNA, CHIRAG],
    groups: {
      [GOA]: {
        id: GOA,
        name: 'Goa Trip',
        type: 'trip',
        emoji: '🏖️',
        memberIds: [ME_ID, BHAVNA, CHIRAG],
        simplifyDebts: true,
        defaultCurrency: 'INR',
        createdAt: T0,
      },
      [OTHER]: {
        id: OTHER,
        name: 'Flat',
        type: 'home',
        emoji: '🏠',
        memberIds: [ME_ID, BHAVNA],
        simplifyDebts: false,
        defaultCurrency: 'INR',
        createdAt: T0,
      },
    },
  };
}

function bhavnasPhone(): AppState {
  const s = blankState(T0);
  return { ...s, people: { [ME_ID]: { ...s.people[ME_ID], name: 'Bhavna' } } };
}

const SPLITS: Record<string, SplitInput> = {
  equal: { method: 'equal', participantIds: [ME_ID, BHAVNA, CHIRAG] },
  exact: { method: 'exact', amounts: { [BHAVNA]: 30000, [ME_ID]: 40000, [CHIRAG]: 20000 } },
  percent: { method: 'percent', percents: { [ME_ID]: 50, [BHAVNA]: 25.5, [CHIRAG]: 24.5 } },
  shares: { method: 'shares', shares: { [BHAVNA]: 2, [ME_ID]: 1 } },
  adjustment: { method: 'adjustment', participantIds: [ME_ID, BHAVNA], adjustments: { [CHIRAG]: 10000, [ME_ID]: -500 } },
  itemized: {
    method: 'itemized',
    bill: {
      items: [
        { id: 'item_naan', name: 'Naan', quantity: 6, amount: 36000, shares: { [ME_ID]: 2, [BHAVNA]: 1 } },
        { id: 'item_paneer', name: 'Paneer', quantity: 1, amount: 49500, shares: { [CHIRAG]: 1, [ME_ID]: 1 } },
      ],
      charges: [{ id: 'chg_gst', kind: 'tax', label: 'GST 5%', amount: 4500, allocation: 'proportional' }],
      merchant: 'Punjab Dhaba',
      scanned: true,
      printedTotal: 90000,
    },
  },
};

function expense(id: string, split: SplitInput = SPLITS.equal, overrides: Partial<Expense> = {}): Expense {
  const total = 90000;
  return {
    id,
    groupId: GOA,
    description: 'Dinner',
    category: 'food',
    currency: 'INR',
    total,
    date: '2026-10-01',
    payers: [{ personId: ME_ID, amount: total }],
    split,
    owed: computeOwed(total, split, 'INR').owed,
    comments: [],
    createdBy: ME_ID,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    groupId: GOA,
    fromId: BHAVNA,
    toId: ME_ID,
    amount: 30000,
    currency: 'INR',
    date: '2026-10-02',
    method: 'upi',
    createdAt: '2026-10-02T08:00:00.000Z',
    ...overrides,
  };
}

/** A timestamp as Postgres prints it ('2026-10-02 09:00:00+00'). */
function pg(iso: string): string {
  return iso.replace('T', ' ').replace(/\.000Z$/, '+00');
}

/** What the server hands back for a pushed expense or payment. */
function dataRow(push: PushData, updatedAt: string = LATER): DataRow {
  return {
    id: push.id,
    group_id: push.groupId,
    data: JSON.parse(JSON.stringify(push.data)),
    created_at: updatedAt,
    updated_at: updatedAt,
    updated_by: 'user-a',
    deleted_at: push.deletedAt ? pg(push.deletedAt) : null,
  };
}

function memberRow(id: string, name: string, extra: Partial<MemberRow> = {}): MemberRow {
  return { group_id: GOA, id, user_id: null, name, color: null, created_at: LATER, updated_at: LATER, left_at: null, ...extra };
}

function groupRow(extra: Partial<GroupRow> = {}): GroupRow {
  return {
    id: GOA,
    name: 'Goa Trip',
    type: 'trip',
    emoji: '🏖️',
    default_currency: 'INR',
    simplify_debts: true,
    archived: false,
    join_code: 'ABCD2345',
    join_enabled: true,
    created_by: 'user-a',
    created_at: '2026-10-03T10:00:00+00:00',
    updated_at: LATER,
    updated_by: 'user-a',
    deleted_at: null,
    ...extra,
  };
}

function batchOf(rows: Partial<RemoteBatch>): RemoteBatch {
  return { ...EMPTY_BATCH, ...rows };
}

const mentionsMe = (value: unknown): boolean => JSON.stringify(value).indexOf(`"${ME_ID}"`) >= 0;

describe('pushGroup / pushMember', () => {
  it('sends the group fields, archived defaulting to false', () => {
    expect(pushGroup(aaravsPhone().groups[GOA])).toStrictEqual({
      id: GOA,
      name: 'Goa Trip',
      type: 'trip',
      emoji: '🏖️',
      defaultCurrency: 'INR',
      simplifyDebts: true,
      archived: false,
    });
    expect(pushGroup({ ...aaravsPhone().groups[GOA], archived: true }).archived).toBe(true);
  });

  it('fits text to the server checks so one row cannot fail the whole push', () => {
    const group = aaravsPhone().groups[GOA];
    expect(pushGroup({ ...group, name: '  ' + 'x'.repeat(70) }).name).toBe('x'.repeat(60));
    expect(pushGroup({ ...group, name: '   ' }).name).toBe('New group');
    expect(pushGroup({ ...group, emoji: '' }).emoji).toBe('👥');
    // Counted in code points, so an emoji is never cut in half.
    expect(pushGroup({ ...group, name: '😀'.repeat(61) }).name).toBe('😀'.repeat(60));
  });

  it('builds a member row under the member id', () => {
    expect(pushMember(GOA, { id: ME_ID, name: ' Aarav ', color: '#5B8DEF' }, AARAV)).toStrictEqual({
      groupId: GOA,
      id: AARAV,
      name: 'Aarav',
      color: '#5B8DEF',
    });
    expect(pushMember(GOA, { id: CHIRAG, name: '', color: '#123456789012345678' }, CHIRAG)).toStrictEqual({
      groupId: GOA,
      id: CHIRAG,
      name: 'Friend',
      color: null,
    });
  });
});

describe('pushExpense / pushPayment / pushComment / pushActivity', () => {
  it('sends the expense without comments or bill photo, with you as your member id', () => {
    const e = expense('exp_1', SPLITS.itemized, {
      receiptUri: 'data:image/jpeg;base64,AAAA',
      comments: [{ id: 'cmt_1', authorId: BHAVNA, text: 'Nice', createdAt: T0 }],
    });
    const before = JSON.stringify(e);
    const push = pushExpense(e, AARAV_INFO);
    expect(push.id).toBe('exp_1');
    expect(push.groupId).toBe(GOA);
    expect(push.deletedAt).toBeNull();
    expect('comments' in push.data).toBe(false);
    expect('receiptUri' in push.data).toBe(false);
    expect(mentionsMe(push)).toBe(false);
    expect(push.data.createdBy).toBe(AARAV);
    expect(push.data.payers).toEqual([{ personId: AARAV, amount: 90000 }]);
    expect(push.data.split).toEqual({
      method: 'itemized',
      bill: {
        ...(SPLITS.itemized as Extract<SplitInput, { method: 'itemized' }>).bill,
        items: [
          { id: 'item_naan', name: 'Naan', quantity: 6, amount: 36000, shares: { [AARAV]: 2, [BHAVNA]: 1 } },
          { id: 'item_paneer', name: 'Paneer', quantity: 1, amount: 49500, shares: { [CHIRAG]: 1, [AARAV]: 1 } },
        ],
      },
    });
    expect(push.data.groupId).toBe(GOA);
    expect(push.data.description).toBe('Dinner');
    expect(JSON.stringify(e)).toBe(before);
  });

  it('carries a soft delete in deletedAt', () => {
    const push = pushExpense(expense('exp_2', SPLITS.equal, { deletedAt: '2026-10-02T09:00:00.000Z' }), AARAV_INFO);
    expect(push.deletedAt).toBe('2026-10-02T09:00:00.000Z');
    expect(pushPayment(payment('pay_1', { deletedAt: '2026-10-03T09:00:00.000Z' }), AARAV_INFO).deletedAt).toBe('2026-10-03T09:00:00.000Z');
  });

  it('rewrites payment, comment and activity ids', () => {
    const p = pushPayment(payment('pay_1'), AARAV_INFO);
    expect(p).toEqual({ id: 'pay_1', groupId: GOA, data: { ...payment('pay_1'), toId: AARAV }, deletedAt: null });

    const c = pushComment('exp_1', { id: 'cmt_1', authorId: ME_ID, text: 'Paid', createdAt: T0 }, GOA, AARAV_INFO);
    expect(c).toEqual({ id: 'cmt_1', groupId: GOA, expenseId: 'exp_1', data: { id: 'cmt_1', authorId: AARAV, text: 'Paid', createdAt: T0 } });

    const a: Activity = {
      id: 'act_1',
      type: 'payment_added',
      at: T0,
      actorId: ME_ID,
      groupId: GOA,
      paymentId: 'pay_1',
      summary: 'You recorded a payment in Goa Trip: Bhavna paid you ₹300.00.',
      amount: 30000,
      currency: 'INR',
    };
    const push = pushActivity(a, AARAV_INFO, 'Aarav');
    expect(push).toEqual({
      id: 'act_1',
      groupId: GOA,
      data: { ...a, actorId: AARAV, summary: 'Aarav recorded a payment in Goa Trip: Bhavna paid Aarav ₹300.00.' },
    });
    expect(a.summary).toBe('You recorded a payment in Goa Trip: Bhavna paid you ₹300.00.');
  });
});

describe('neutralSummary', () => {
  it('replaces You / you with your name', () => {
    expect(neutralSummary('You added "Dinner" in Goa Trip.', 'Aarav')).toBe('Aarav added "Dinner" in Goa Trip.');
    expect(neutralSummary('Bhavna paid you ₹500.00 in Goa Trip.', 'Aarav')).toBe('Bhavna paid Aarav ₹500.00 in Goa Trip.');
    expect(neutralSummary('You added you to Goa Trip.', 'Aarav')).toBe('Aarav added Aarav to Goa Trip.');
  });

  it('never re-words quoted parts such as descriptions', () => {
    expect(neutralSummary('You added "Drinks with you" in Goa Trip.', 'Aarav')).toBe('Aarav added "Drinks with you" in Goa Trip.');
    expect(neutralSummary('You renamed "You & me" to "Us".', 'Aarav')).toBe('Aarav renamed "You & me" to "Us".');
    expect(neutralSummary('You added "The "you" special" in Goa Trip.', 'Aarav')).toBe('Aarav added "The "you" special" in Goa Trip.');
  });

  it('leaves other words alone and inserts the name literally', () => {
    expect(neutralSummary('You updated your profile.', 'Aarav')).toBe('Aarav updated your profile.');
    expect(neutralSummary('Bhavna added Young as a friend.', 'Aarav')).toBe('Bhavna added Young as a friend.');
    expect(neutralSummary('You paid.', 'A$&B')).toBe('A$&B paid.');
    expect(neutralSummary('You paid.', '  ')).toBe('Someone paid.');
  });
});

describe('shareRequest', () => {
  function sharedState(): AppState {
    const s = aaravsPhone();
    return {
      ...s,
      expenses: {
        exp_1: expense('exp_1', SPLITS.equal, {
          receiptUri: 'file:///bill.jpg',
          comments: [
            { id: 'cmt_1', authorId: ME_ID, text: 'Paid by card', createdAt: T0 },
            { id: 'cmt_2', authorId: BHAVNA, text: 'Thanks', createdAt: T0 },
          ],
        }),
        exp_2: expense('exp_2', SPLITS.shares, { deletedAt: '2026-10-02T09:00:00.000Z' }),
        exp_flat: expense('exp_flat', SPLITS.equal, { groupId: OTHER, split: { method: 'equal', participantIds: [ME_ID, BHAVNA] } }),
        exp_solo: expense('exp_solo', SPLITS.equal, { groupId: null }),
      },
      payments: { pay_1: payment('pay_1'), pay_solo: payment('pay_solo', { groupId: null }) },
    };
  }

  it('uploads members, every expense (deleted too), payments and comments with you as `me`', () => {
    const req = shareRequest(sharedState(), GOA, 'u_new01', 'Aarav S');
    expect(req.me).toBe('u_new01');
    expect(req.group).toEqual(pushGroup(aaravsPhone().groups[GOA]));
    expect(req.members).toEqual([
      { groupId: GOA, id: 'u_new01', name: 'Aarav S', color: aaravsPhone().people[ME_ID].color },
      { groupId: GOA, id: BHAVNA, name: 'Bhavna', color: '#F2994A' },
      { groupId: GOA, id: CHIRAG, name: 'Chirag', color: '#9B51E0' },
    ]);
    expect(req.expenses.map((e) => e.id)).toEqual(['exp_1', 'exp_2']);
    expect(req.expenses[1].deletedAt).toBe('2026-10-02T09:00:00.000Z');
    expect(req.expenses[0].data.createdBy).toBe('u_new01');
    expect('receiptUri' in req.expenses[0].data).toBe(false);
    expect(req.payments.map((p) => p.id)).toEqual(['pay_1']);
    expect(req.payments[0].data.toId).toBe('u_new01');
    expect(req.comments).toEqual([
      { id: 'cmt_1', groupId: GOA, expenseId: 'exp_1', data: { id: 'cmt_1', authorId: 'u_new01', text: 'Paid by card', createdAt: T0 } },
      { id: 'cmt_2', groupId: GOA, expenseId: 'exp_1', data: { id: 'cmt_2', authorId: BHAVNA, text: 'Thanks', createdAt: T0 } },
    ]);
    expect(mentionsMe([req.members, req.expenses, req.payments, req.comments])).toBe(false);
  });

  it('throws for a group that does not exist', () => {
    expect(() => shareRequest(sharedState(), 'grp_missing', 'u_new01', 'Aarav')).toThrow('This group no longer exists');
  });
});

describe('batchToLocal: expenses', () => {
  it("brings Aarav's expense to Bhavna's phone with her as you", () => {
    const row = dataRow(pushExpense(expense('exp_1', SPLITS.equal, { comments: [{ id: 'c', authorId: ME_ID, text: 'x', createdAt: T0 }] }), AARAV_INFO));
    const { local, skipped } = batchToLocal(batchOf({ expenses: [row] }), syncWith(BHAVNA_INFO), bhavnasPhone());
    expect(skipped).toEqual([]);
    expect(local.expenses).toHaveLength(1);
    const e = local.expenses[0];
    expect(e.payers).toEqual([{ personId: AARAV, amount: 90000 }]);
    expect(e.split).toEqual({ method: 'equal', participantIds: [AARAV, ME_ID, CHIRAG] });
    expect(e.owed).toEqual([
      { personId: AARAV, amount: 30000 },
      { personId: ME_ID, amount: 30000 },
      { personId: CHIRAG, amount: 30000 },
    ]);
    expect(e.createdBy).toBe(AARAV);
    expect(e.comments).toEqual([]);
  });

  for (const method of Object.keys(SPLITS)) {
    it(`round-trips a ${method} expense through the server on the same phone`, () => {
      const original = expense(`exp_${method}`, SPLITS[method], {
        notes: 'Beach shack',
        receiptUri: 'file:///bill.jpg',
        recurrence: { frequency: 'monthly', nextDate: '2026-11-01' },
        deletedAt: '2026-10-02T09:00:00.000Z',
        comments: [{ id: 'cmt_1', authorId: ME_ID, text: 'Paid', createdAt: T0 }],
      });
      const row = dataRow(pushExpense(original, AARAV_INFO));
      expect(row.deleted_at).toBe('2026-10-02 09:00:00+00');
      const { local, skipped } = batchToLocal(batchOf({ expenses: [row] }), syncWith(AARAV_INFO), aaravsPhone());
      expect(skipped).toEqual([]);
      const back = { ...original, comments: [] } as Partial<Expense>;
      delete back.receiptUri;
      expect(local.expenses[0]).toStrictEqual(back);
    });
  }

  it('recomputes owed and takes id, group and deletion from the columns, never from the JSON', () => {
    const row = dataRow(pushExpense(expense('exp_real'), AARAV_INFO));
    const data = row.data as Record<string, unknown>;
    data.owed = [{ personId: AARAV, amount: 90000 }];
    data.id = 'exp_fake';
    data.groupId = 'grp_elsewhere';
    data.deletedAt = '2026-10-03T00:00:00.000Z';
    data.comments = [{ id: 'cmt_x', authorId: AARAV, text: 'sneaky', createdAt: T0 }];
    data.receiptUri = 'https://example.invalid/bill.jpg';
    data.extra = 'ignored';
    const { local } = batchToLocal(batchOf({ expenses: [row] }), syncWith(BHAVNA_INFO), bhavnasPhone());
    const e = local.expenses[0];
    expect(e.id).toBe('exp_real');
    expect(e.groupId).toBe(GOA);
    expect(e.deletedAt).toBeUndefined();
    expect(e.comments).toEqual([]);
    expect(e.owed.map((o) => o.amount)).toEqual([30000, 30000, 30000]);
    expect('receiptUri' in e).toBe(false);
    expect('extra' in e).toBe(false);
  });

  it('skips invalid expenses whole, with a reason, and keeps the valid ones', () => {
    const good = dataRow(pushExpense(expense('exp_good'), AARAV_INFO));
    const cases: [string, (d: Record<string, unknown>) => void][] = [
      ['payers short', (d) => (d.payers = [{ personId: AARAV, amount: 80000 }])],
      ['payer twice', (d) => (d.payers = [{ personId: AARAV, amount: 45000 }, { personId: AARAV, amount: 45000 }])],
      ['zero payer', (d) => (d.payers = [{ personId: AARAV, amount: 90000 }, { personId: BHAVNA, amount: 0 }])],
      ['fraction total', (d) => (d.total = 900.5)],
      ['negative total', (d) => (d.total = -90000)],
      ['string total', (d) => (d.total = '90000')],
      ['unknown category', (d) => (d.category = 'yachts')],
      ['unknown method', (d) => (d.split = { method: 'magic', participantIds: [AARAV] })],
      ['bad date', (d) => (d.date = '2026-13-01')],
      ['bad currency', (d) => (d.currency = 'rupees')],
      ['blank description', (d) => (d.description = '   ')],
      ['bad createdAt', (d) => (d.createdAt = 'yesterday')],
      ['raw me in split', (d) => (d.split = { method: 'equal', participantIds: ['me', BHAVNA] })],
      ['raw me as creator', (d) => (d.createdBy = 'me')],
      ['raw me as payer', (d) => (d.payers = [{ personId: 'me', amount: 90000 }])],
      ['exact not adding up', (d) => (d.split = { method: 'exact', amounts: { [AARAV]: 100 } })],
      ['negative share', (d) => (d.split = { method: 'shares', shares: { [AARAV]: -1, [BHAVNA]: 2 } })],
      [
        'itemized total mismatch',
        (d) =>
          (d.split = {
            method: 'itemized',
            bill: { items: [{ id: 'i1', name: 'Tea', quantity: 1, amount: 100, shares: { [AARAV]: 1 } }], charges: [] },
          }),
      ],
      [
        'unknown charge kind',
        (d) =>
          (d.split = {
            method: 'itemized',
            bill: {
              items: [{ id: 'i1', name: 'Thali', quantity: 1, amount: 90000, shares: { [AARAV]: 1 } }],
              charges: [{ id: 'c1', kind: 'bribe', label: 'x', amount: 0, allocation: 'equal' }],
            },
          }),
      ],
      ['bad recurrence', (d) => (d.recurrence = { frequency: 'hourly', nextDate: '2026-11-01' })],
      ['notes not text', (d) => (d.notes = 42)],
    ];
    const bad = cases.map(([label, mutate], i) => {
      const row = dataRow(pushExpense(expense(`exp_bad_${i}`), AARAV_INFO));
      mutate(row.data as Record<string, unknown>);
      return { row, label };
    });
    const notObject: DataRow = { ...dataRow(pushExpense(expense('exp_string'), AARAV_INFO)), data: 'oops' };
    const rows = [good, ...bad.map((b) => b.row), notObject];

    const { local, skipped } = batchToLocal(batchOf({ expenses: rows }), syncWith(BHAVNA_INFO), bhavnasPhone());
    expect(local.expenses.map((e) => e.id)).toEqual(['exp_good']);
    expect(skipped.map((s) => s.id)).toEqual([...bad.map((b) => b.row.id), 'exp_string']);
    for (const s of skipped) {
      expect(s.kind).toBe('expense');
      expect(s.reason.length).toBeGreaterThan(0);
    }
    expect(skipped).toContainEqual({ kind: 'expense', id: 'exp_bad_6', reason: 'unknown category' });
    expect(skipped).toContainEqual({ kind: 'expense', id: 'exp_string', reason: 'data is not an object' });
    expect(skipped[0].reason).toBe("payers don't add up to the total");
    expect(skipped[15].reason).toContain('bad split');
  });

  it('keeps the newest copy when a row arrives twice', () => {
    const older = dataRow(pushExpense(expense('exp_1', SPLITS.equal, { description: 'Old' }), AARAV_INFO), '2026-10-05T10:00:00+00:00');
    const newer = dataRow(pushExpense(expense('exp_1', SPLITS.equal, { description: 'New' }), AARAV_INFO), '2026-10-05 10:00:01+00');
    const result = batchToLocal(batchOf({ expenses: [newer, older] }), syncWith(AARAV_INFO), aaravsPhone());
    expect(result.local.expenses.map((e) => e.description)).toEqual(['New']);
    const again = batchToLocal(batchOf({ expenses: [older, newer] }), syncWith(AARAV_INFO), aaravsPhone());
    expect(again.local.expenses.map((e) => e.description)).toEqual(['New']);
  });
});

describe('batchToLocal: payments, comments, activity', () => {
  it('converts a payment and skips invalid ones', () => {
    const good = dataRow(pushPayment(payment('pay_1'), AARAV_INFO));
    const bad = (id: string, change: Record<string, unknown>): DataRow => {
      const row = dataRow(pushPayment(payment(id), AARAV_INFO));
      return { ...row, data: { ...(row.data as Record<string, unknown>), ...change } };
    };
    const rows = [
      good,
      bad('pay_self', { fromId: AARAV, toId: AARAV }),
      bad('pay_zero', { amount: 0 }),
      bad('pay_cheque', { method: 'cheque' }),
      bad('pay_me', { fromId: 'me' }),
      bad('pay_date', { date: '02/10/2026' }),
    ];
    const { local, skipped } = batchToLocal(batchOf({ payments: rows }), syncWith(BHAVNA_INFO), bhavnasPhone());
    expect(local.payments).toEqual([{ ...payment('pay_1'), fromId: ME_ID, toId: AARAV }]);
    expect(skipped.map((s) => s.id)).toEqual(['pay_self', 'pay_zero', 'pay_cheque', 'pay_me', 'pay_date']);
    expect(skipped.every((s) => s.kind === 'payment')).toBe(true);
  });

  it('carries a payment deletion from the column', () => {
    const row = dataRow(pushPayment(payment('pay_1', { deletedAt: '2026-10-03T09:00:00.000Z' }), AARAV_INFO));
    const { local } = batchToLocal(batchOf({ payments: [row] }), syncWith(AARAV_INFO), aaravsPhone());
    expect(local.payments[0]).toStrictEqual(payment('pay_1', { deletedAt: '2026-10-03T09:00:00.000Z' }));
  });

  it('converts comments with their expense id and skips deleted or forged ones', () => {
    const push = pushComment('exp_1', { id: 'cmt_1', authorId: ME_ID, text: 'Paid by card', createdAt: T0 }, GOA, AARAV_INFO);
    const row = (id: string, data: unknown, extra: Partial<CommentRow> = {}): CommentRow => ({
      id,
      group_id: GOA,
      expense_id: 'exp_1',
      data,
      created_at: LATER,
      created_by: 'user-a',
      deleted_at: null,
      ...extra,
    });
    const rows = [
      row('cmt_1', JSON.parse(JSON.stringify(push.data))),
      row('cmt_deleted', { ...push.data, id: 'cmt_deleted' }, { deleted_at: LATER }),
      row('cmt_me', { ...push.data, authorId: 'me' }),
      row('cmt_blank', { ...push.data, text: ' ' }),
    ];
    const { local, skipped } = batchToLocal(batchOf({ comments: rows }), syncWith(BHAVNA_INFO), bhavnasPhone());
    expect(local.comments).toEqual([
      { expenseId: 'exp_1', comment: { id: 'cmt_1', authorId: AARAV, text: 'Paid by card', createdAt: T0 } },
    ]);
    expect(skipped).toEqual([
      { kind: 'comment', id: 'cmt_deleted', reason: 'deleted' },
      { kind: 'comment', id: 'cmt_me', reason: 'bad author' },
      { kind: 'comment', id: 'cmt_blank', reason: 'text missing' },
    ]);
  });

  it('keeps the neutral summary and rewrites the actor', () => {
    const a: Activity = {
      id: 'act_1',
      type: 'payment_added',
      at: '2026-10-02T08:00:00.000Z',
      actorId: ME_ID,
      groupId: GOA,
      paymentId: 'pay_1',
      summary: 'You recorded a payment in Goa Trip: Bhavna paid you ₹300.00.',
      amount: 30000,
      currency: 'INR',
    };
    const push = pushActivity(a, AARAV_INFO, 'Aarav');
    const row = (id: string, data: unknown): ActivityRow => ({ id, group_id: GOA, data, created_at: LATER, created_by: 'user-a' });
    const rows = [
      row('act_1', { ...JSON.parse(JSON.stringify(push.data)), groupId: 'grp_elsewhere' }),
      row('act_unknown', { ...push.data, id: 'act_unknown', type: 'party_started' }),
      row('act_time', { ...push.data, at: 'soon' }),
    ];
    const { local, skipped } = batchToLocal(batchOf({ activity: rows }), syncWith(BHAVNA_INFO), bhavnasPhone());
    expect(local.activity).toStrictEqual([
      { ...a, actorId: AARAV, summary: 'Aarav recorded a payment in Goa Trip: Bhavna paid Aarav ₹300.00.' },
    ]);
    expect(skipped.map((s) => [s.id, s.reason])).toEqual([
      ['act_unknown', 'unknown activity type'],
      ['act_time', 'bad time'],
    ]);
  });
});

describe('batchToLocal: groups and members', () => {
  it("builds the group and its people on Bhavna's first pull", () => {
    const rows = [
      memberRow(AARAV, 'Aarav', { user_id: 'user-a', color: '#5B8DEF' }),
      memberRow(BHAVNA, 'Bhavna', { user_id: 'user-b', color: '#F2994A' }),
      memberRow(CHIRAG, 'Chirag'),
      memberRow(DIYA, 'Diya', { user_id: 'user-d', color: '#27AE60', left_at: '2026-10-06 08:00:00+00' }),
    ];
    const { local, groupInfo, skipped } = batchToLocal(batchOf({ groups: [groupRow()], members: rows }), syncWith(BHAVNA_INFO), bhavnasPhone());
    expect(skipped).toEqual([]);
    expect(local.people.map((p) => [p.id, p.name])).toEqual([
      [AARAV, 'Aarav'],
      [CHIRAG, 'Chirag'],
      [DIYA, 'Diya'],
    ]);
    expect(local.people[0].color).toBe('#5B8DEF');
    expect(avatarPalette).toContain(local.people[1].color);
    expect(local.groups).toStrictEqual([
      {
        id: GOA,
        name: 'Goa Trip',
        type: 'trip',
        emoji: '🏖️',
        memberIds: [ME_ID, AARAV, CHIRAG, DIYA],
        simplifyDebts: true,
        defaultCurrency: 'INR',
        createdAt: '2026-10-03T10:00:00.000Z',
      },
    ]);
    expect(local.deletedGroupIds).toEqual([]);
    expect(groupInfo[GOA]).toEqual({
      members: {
        [AARAV]: { userId: 'user-a', leftAt: null },
        [BHAVNA]: { userId: 'user-b', leftAt: null },
        [CHIRAG]: { userId: null, leftAt: null },
        [DIYA]: { userId: 'user-d', leftAt: '2026-10-06T08:00:00.000Z' },
      },
      joinCode: 'ABCD2345',
      joinEnabled: true,
      cursor: '2026-10-05T10:00:00.123Z',
    });
  });

  it('gives a member without a colour the same palette colour on every phone', () => {
    const one = batchToLocal(batchOf({ members: [memberRow(CHIRAG, 'Chirag')] }), syncWith(BHAVNA_INFO), bhavnasPhone());
    const two = batchToLocal(batchOf({ members: [memberRow(CHIRAG, 'Chirag', { color: 'red' })] }), syncWith(infoFor(DIYA)), bhavnasPhone());
    expect(one.local.people[0].color).toBe(two.local.people[0].color);
  });

  it('never turns your own member row into a person', () => {
    const { local, groupInfo } = batchToLocal(
      batchOf({ members: [memberRow(AARAV, 'Somebody else', { user_id: 'user-a' })] }),
      syncWith(AARAV_INFO),
      aaravsPhone(),
    );
    expect(local.people).toEqual([]);
    expect(local.groups).toEqual([]);
    expect(groupInfo[GOA].members).toEqual({ [AARAV]: { userId: 'user-a', leftAt: null } });
  });

  it('adds a member who joined a known group even without a group row', () => {
    const info = infoFor(AARAV, { members: { [AARAV]: { userId: 'user-a', leftAt: null }, [BHAVNA]: { userId: null, leftAt: null } } });
    const state = aaravsPhone();
    const { local, groupInfo } = batchToLocal(batchOf({ members: [memberRow(DIYA, 'Diya', { user_id: 'user-d' })] }), syncWith(info), state);
    expect(local.groups).toEqual([{ ...state.groups[GOA], memberIds: [ME_ID, BHAVNA, CHIRAG, DIYA] }]);
    expect(local.people.map((p) => [p.id, p.name])).toEqual([[DIYA, 'Diya']]);
    expect(avatarPalette).toContain(local.people[0].color);
    expect(groupInfo[GOA].members).toEqual({ ...info.members, [DIYA]: { userId: 'user-d', leftAt: null } });
  });

  it('renames a member without rewriting the group, keeping the local colour when the row has none', () => {
    const state = aaravsPhone();
    const { local } = batchToLocal(batchOf({ members: [memberRow(BHAVNA, 'Bhavna K')] }), syncWith(AARAV_INFO), state);
    expect(local.groups).toEqual([]);
    expect(local.people).toEqual([{ id: BHAVNA, name: 'Bhavna K', color: '#F2994A' }]);
  });

  it('updates a known group, keeping its createdAt and members', () => {
    const state = aaravsPhone();
    const row = groupRow({ name: 'Goa 2026', archived: true, type: 'spaceship', emoji: '', join_enabled: false, join_code: null });
    const { local, groupInfo } = batchToLocal(batchOf({ groups: [row] }), syncWith(AARAV_INFO), state);
    expect(local.groups).toStrictEqual([
      { ...state.groups[GOA], name: 'Goa 2026', archived: true, type: 'other', emoji: '👥' },
    ]);
    expect(groupInfo[GOA]).toEqual({ joinCode: null, joinEnabled: false, cursor: '2026-10-05T10:00:00.123Z' });
  });

  it('reports a deleted group instead of updating it', () => {
    const { local } = batchToLocal(batchOf({ groups: [groupRow({ deleted_at: LATER })] }), syncWith(AARAV_INFO), aaravsPhone());
    expect(local.deletedGroupIds).toEqual([GOA]);
    expect(local.groups).toEqual([]);
  });

  it('skips a member row that fails validation', () => {
    const rows = [memberRow(CHIRAG, '  '), memberRow('me', 'Forged')];
    const { local, groupInfo, skipped } = batchToLocal(batchOf({ members: rows }), syncWith(AARAV_INFO), aaravsPhone());
    expect(local.people).toEqual([]);
    expect(skipped).toEqual([
      { kind: 'member', id: CHIRAG, reason: 'name missing' },
      { kind: 'member', id: 'me', reason: 'bad member id' },
    ]);
    expect(groupInfo[GOA].members).toBeUndefined();
  });
});

describe('batchToLocal: groups that are not shared, malformed rows and cursors', () => {
  it('skips rows of groups that are not shared on this phone', () => {
    const flat = { ...dataRow(pushExpense(expense('exp_flat'), AARAV_INFO)), group_id: OTHER };
    const rows: Partial<RemoteBatch> = {
      groups: [groupRow({ id: OTHER })],
      members: [memberRow(BHAVNA, 'Bhavna', { group_id: OTHER })],
      expenses: [flat, { ...flat, id: 'exp_proto', group_id: '__proto__' }, { ...flat, id: 'exp_ctor', group_id: 'constructor' }],
    };
    const { local, groupInfo, skipped } = batchToLocal(batchOf(rows), syncWith(AARAV_INFO), aaravsPhone());
    expect(local.groups).toEqual([]);
    expect(local.people).toEqual([]);
    expect(local.expenses).toEqual([]);
    expect(Object.keys(groupInfo)).toEqual([]);
    expect(skipped.map((s) => s.id)).toEqual([BHAVNA, OTHER, 'exp_flat', 'exp_proto', 'exp_ctor']);
    expect(skipped.every((s) => s.reason === 'not a shared group on this phone')).toBe(true);
  });

  it('skips malformed rows without throwing', () => {
    const weird = { ...EMPTY_BATCH, expenses: [null, {}, { id: 5, group_id: GOA }, 'row'] } as unknown as RemoteBatch;
    const { local, skipped } = batchToLocal(weird, syncWith(AARAV_INFO), aaravsPhone());
    expect(local.expenses).toEqual([]);
    expect(skipped).toHaveLength(4);
    expect(skipped.every((s) => s.reason === 'malformed row')).toBe(true);
    const missing = { groups: null } as unknown as RemoteBatch;
    expect(batchToLocal(missing, syncWith(AARAV_INFO), aaravsPhone()).skipped).toEqual([]);
  });

  it('moves the cursor to the newest row seen, invalid rows included, and never back', () => {
    const exp = dataRow(pushExpense(expense('exp_1'), AARAV_INFO), '2026-10-05T10:00:00.5+00:00');
    const bad = { ...dataRow(pushExpense(expense('exp_2'), AARAV_INFO), '2026-10-05 10:00:01+00'), data: null };
    const comment: CommentRow = {
      id: 'cmt_1',
      group_id: GOA,
      expense_id: 'exp_1',
      data: { id: 'cmt_1', authorId: BHAVNA, text: 'hi', createdAt: T0 },
      created_at: '2026-10-05T15:29:00+05:30',
      created_by: null,
      deleted_at: null,
    };
    const batch = batchOf({ expenses: [exp, bad], comments: [comment] });
    expect(batchToLocal(batch, syncWith(AARAV_INFO), aaravsPhone()).groupInfo[GOA].cursor).toBe('2026-10-05T10:00:01.000Z');
    const ahead = infoFor(AARAV, { cursor: '2026-10-06T00:00:00.000Z' });
    expect(batchToLocal(batch, syncWith(ahead), aaravsPhone()).groupInfo[GOA].cursor).toBe('2026-10-06T00:00:00.000Z');
    const behind = infoFor(AARAV, { cursor: '2026-10-04 00:00:00+00' });
    expect(batchToLocal(batch, syncWith(behind), aaravsPhone()).groupInfo[GOA].cursor).toBe('2026-10-05T10:00:01.000Z');
    expect(batchToLocal(EMPTY_BATCH, syncWith(AARAV_INFO), aaravsPhone()).groupInfo).toEqual({});
  });
});

describe('timeOf', () => {
  it('reads ISO and Postgres timestamps', () => {
    const t = Date.UTC(2026, 9, 5, 10, 0, 0, 123);
    expect(timeOf('2026-10-05T10:00:00.123Z')).toBe(t);
    expect(timeOf('2026-10-05T10:00:00.123456+00:00')).toBe(t);
    expect(timeOf('2026-10-05 10:00:00.123+00')).toBe(t);
    expect(timeOf('2026-10-05 15:30:00.123+05:30')).toBe(t);
    expect(timeOf('2026-10-05T05:00:00.123-0500')).toBe(t);
    expect(timeOf('2026-10-05T10:00Z')).toBe(Date.UTC(2026, 9, 5, 10, 0));
  });

  it('rejects anything else', () => {
    expect(timeOf('yesterday')).toBeNull();
    expect(timeOf('2026-13-05T10:00:00Z')).toBeNull();
    expect(timeOf('2026-10-05')).toBeNull();
    expect(timeOf(1730000000000)).toBeNull();
    expect(timeOf(null)).toBeNull();
  });
});
