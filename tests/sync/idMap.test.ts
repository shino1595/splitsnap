import { ME_ID } from '../../app/src/types';
import type { Activity, BillCharge, Comment, Expense, Payment, SplitInput } from '../../app/src/types';
import {
  remapActivity,
  remapComment,
  remapExpense,
  remapPayment,
  remapSplit,
  toLocalId,
  toServerId,
} from '../../app/src/sync/idMap';

// Aarav's phone: he is ME_ID locally and 'u_aarav01' in the shared group.
const MY = 'u_aarav01';
const BHAVNA = 'per_bhavna';
const CHIRAG = 'per_chirag';
const DIYA = 'u_diya02';
const toServer = toServerId(MY);
const toLocal = toLocalId(MY);

const CHARGES: BillCharge[] = [{ id: 'chg_gst', kind: 'tax', label: 'GST 5%', amount: 4500, allocation: 'proportional' }];

const SPLITS: Record<string, SplitInput> = {
  equal: { method: 'equal', participantIds: [ME_ID, BHAVNA, CHIRAG] },
  exact: { method: 'exact', amounts: { [BHAVNA]: 30000, [ME_ID]: 30000, [CHIRAG]: 30000 } },
  percent: { method: 'percent', percents: { [ME_ID]: 50, [BHAVNA]: 25.5, [CHIRAG]: 24.5 } },
  shares: { method: 'shares', shares: { [BHAVNA]: 2, [ME_ID]: 1, [CHIRAG]: 0 } },
  adjustment: { method: 'adjustment', participantIds: [ME_ID, BHAVNA], adjustments: { [CHIRAG]: 10000, [ME_ID]: -500 } },
  itemized: {
    method: 'itemized',
    bill: {
      items: [
        { id: 'item_naan', name: 'Naan', quantity: 6, amount: 36000, shares: { [ME_ID]: 2, [BHAVNA]: 1 } },
        { id: 'item_paneer', name: 'Paneer', quantity: 1, amount: 48000, shares: { [CHIRAG]: 1, [ME_ID]: 1 } },
        { id: 'item_water', name: 'Water', quantity: 1, amount: 6000, shares: {} },
      ],
      charges: CHARGES,
      merchant: 'Punjab Dhaba',
      scanned: true,
      printedTotal: 94500,
    },
  },
};

function expenseWith(split: SplitInput): Expense {
  return {
    id: 'exp_dinner',
    groupId: 'grp_goa',
    description: 'Dinner',
    category: 'food',
    currency: 'INR',
    total: 90000,
    date: '2026-10-01',
    notes: 'Beach shack',
    receiptUri: 'file:///bill.jpg',
    payers: [
      { personId: ME_ID, amount: 60000 },
      { personId: BHAVNA, amount: 30000 },
    ],
    split,
    owed: [
      { personId: ME_ID, amount: 30000 },
      { personId: BHAVNA, amount: 30000 },
      { personId: CHIRAG, amount: 30000 },
    ],
    comments: [
      { id: 'cmt_1', authorId: ME_ID, text: 'Paid by card', createdAt: '2026-10-01T11:00:00.000Z' },
      { id: 'cmt_2', authorId: CHIRAG, text: 'Thanks!', createdAt: '2026-10-01T11:05:00.000Z' },
    ],
    createdBy: ME_ID,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:30:00.000Z',
    deletedAt: '2026-10-02T09:00:00.000Z',
  };
}

const mentionsMe = (value: unknown): boolean => JSON.stringify(value).indexOf(`"${ME_ID}"`) >= 0;

describe('toServerId / toLocalId', () => {
  it('rewrites only you', () => {
    expect(toServer(ME_ID)).toBe(MY);
    expect(toServer(BHAVNA)).toBe(BHAVNA);
    expect(toServer(MY)).toBe(MY);
    expect(toLocal(MY)).toBe(ME_ID);
    expect(toLocal(BHAVNA)).toBe(BHAVNA);
    expect(toLocal(DIYA)).toBe(DIYA);
  });
});

describe('remapExpense', () => {
  for (const method of Object.keys(SPLITS)) {
    it(`round-trips a ${method} split to the server and back unchanged`, () => {
      const local = expenseWith(SPLITS[method]);
      const before = JSON.stringify(local);
      const server = remapExpense(local, toServer);
      expect(mentionsMe(server)).toBe(false);
      expect(server.createdBy).toBe(MY);
      expect(server.payers[0]).toEqual({ personId: MY, amount: 60000 });
      expect(server.owed.map((o) => o.personId)).toEqual([MY, BHAVNA, CHIRAG]);
      expect(server.comments.map((c) => c.authorId)).toEqual([MY, CHIRAG]);
      expect(remapExpense(server, toLocal)).toStrictEqual(local);
      expect(JSON.stringify(local)).toBe(before);
    });
  }

  it('keeps ids that are not people and every other field', () => {
    const server = remapExpense(expenseWith(SPLITS.itemized), toServer);
    expect(server.id).toBe('exp_dinner');
    expect(server.groupId).toBe('grp_goa');
    expect(server.comments.map((c) => c.id)).toEqual(['cmt_1', 'cmt_2']);
    expect(server.receiptUri).toBe('file:///bill.jpg');
    expect(server.deletedAt).toBe('2026-10-02T09:00:00.000Z');
    const bill = server.split.method === 'itemized' ? server.split.bill : null;
    expect(bill && bill.items.map((i) => i.id)).toEqual(['item_naan', 'item_paneer', 'item_water']);
    expect(bill && bill.items.map((i) => i.shares)).toEqual([{ [MY]: 2, [BHAVNA]: 1 }, { [CHIRAG]: 1, [MY]: 1 }, {}]);
    expect(bill && bill.charges).toEqual(CHARGES);
    expect(bill && bill.merchant).toBe('Punjab Dhaba');
  });

  it('keeps the key order of amounts, shares and adjustments (allocate breaks ties by order)', () => {
    const exact = remapSplit(SPLITS.exact, toServer);
    expect(exact.method === 'exact' && Object.keys(exact.amounts)).toEqual([BHAVNA, MY, CHIRAG]);
    const shares = remapSplit(SPLITS.shares, toServer);
    expect(shares.method === 'shares' && Object.keys(shares.shares)).toEqual([BHAVNA, MY, CHIRAG]);
    const adjustment = remapSplit(SPLITS.adjustment, toServer);
    expect(adjustment).toEqual({ method: 'adjustment', participantIds: [MY, BHAVNA], adjustments: { [CHIRAG]: 10000, [MY]: -500 } });
    expect(adjustment.method === 'adjustment' && Object.keys(adjustment.adjustments)).toEqual([CHIRAG, MY]);
  });

  it('returns new objects and never touches the input', () => {
    const local = expenseWith(SPLITS.itemized);
    const server = remapExpense(local, toServer);
    expect(server).not.toBe(local);
    expect(server.split).not.toBe(local.split);
    expect(server.payers).not.toBe(local.payers);
    expect(local.payers[0].personId).toBe(ME_ID);
    expect(local.split.method === 'itemized' && local.split.bill.items[0].shares).toEqual({ [ME_ID]: 2, [BHAVNA]: 1 });
  });

  it('maps another phone the other way: their member id becomes you', () => {
    // On Bhavna's phone she claimed her placeholder, so her member id is BHAVNA.
    const server = remapExpense(expenseWith(SPLITS.equal), toServer);
    const onBhavnasPhone = remapExpense(server, toLocalId(BHAVNA));
    expect(onBhavnasPhone.payers).toEqual([
      { personId: MY, amount: 60000 },
      { personId: ME_ID, amount: 30000 },
    ]);
    expect(onBhavnasPhone.split).toEqual({ method: 'equal', participantIds: [MY, ME_ID, CHIRAG] });
    expect(onBhavnasPhone.createdBy).toBe(MY);
  });

  it('passes damaged split data through instead of throwing', () => {
    const damaged = { method: 'equal' } as unknown as SplitInput;
    expect(remapSplit(damaged, toServer)).toEqual(damaged);
    const noBill = { method: 'itemized' } as unknown as SplitInput;
    expect(remapSplit(noBill, toServer)).toStrictEqual(noBill);
    const unknown = { method: 'magic', who: [ME_ID] } as unknown as SplitInput;
    expect(remapSplit(unknown, toServer)).toBe(unknown);
  });
});

describe('remapPayment / remapComment / remapActivity', () => {
  it('round-trips a payment', () => {
    const p: Payment = {
      id: 'pay_1',
      groupId: 'grp_goa',
      fromId: BHAVNA,
      toId: ME_ID,
      amount: 50000,
      currency: 'INR',
      date: '2026-10-02',
      method: 'upi',
      createdAt: '2026-10-02T08:00:00.000Z',
    };
    const server = remapPayment(p, toServer);
    expect(server).toEqual({ ...p, toId: MY });
    expect(remapPayment(server, toLocal)).toStrictEqual(p);
    expect(p.toId).toBe(ME_ID);
  });

  it('round-trips a comment', () => {
    const c: Comment = { id: 'cmt_9', authorId: ME_ID, text: 'Done', createdAt: '2026-10-02T08:00:00.000Z' };
    expect(remapComment(c, toServer)).toEqual({ ...c, authorId: MY });
    expect(remapComment(remapComment(c, toServer), toLocal)).toStrictEqual(c);
  });

  it('round-trips activity, rewriting actor and person only', () => {
    const a: Activity = {
      id: 'act_1',
      type: 'friend_added',
      at: '2026-10-02T08:00:00.000Z',
      actorId: ME_ID,
      groupId: 'grp_goa',
      personId: ME_ID,
      summary: 'You added Diya.',
      amount: 100,
      currency: 'INR',
    };
    const server = remapActivity(a, toServer);
    expect(server).toEqual({ ...a, actorId: MY, personId: MY });
    expect(remapActivity(server, toLocal)).toStrictEqual(a);
  });

  it('does not add a personId to activity that has none', () => {
    const a: Activity = { id: 'act_2', type: 'expense_added', at: '2026-10-02T08:00:00.000Z', actorId: BHAVNA, expenseId: 'exp_1', summary: 'x' };
    const server = remapActivity(a, toServer);
    expect(server).toStrictEqual(a);
    expect('personId' in server).toBe(false);
  });
});
