// Person-id rewriting between this phone and the server (docs/SYNC_DESIGN.md §2). Locally the
// user is always ME_ID; on the server they are their member id in that group. Pure and
// exhaustive: every place a person id can appear is rewritten, and inputs are never mutated.
import { ME_ID } from '../types';
import type { Activity, BillItem, Comment, Expense, ID, MoneyShare, Payment, SplitInput } from '../types';

export type IdMap = (id: ID) => ID;

/** ME_ID → myMemberId; every other id unchanged. */
export function toServerId(myMemberId: ID): IdMap {
  return (id) => (id === ME_ID ? myMemberId : id);
}

/** myMemberId → ME_ID; every other id unchanged. */
export function toLocalId(myMemberId: ID): IdMap {
  return (id) => (id === myMemberId ? ME_ID : id);
}

// The helpers pass damaged values (a missing list or record) through instead of throwing:
// stored data is only checked loosely on load.

function mapList(ids: ID[], map: IdMap): ID[] {
  return Array.isArray(ids) ? ids.map(map) : ids;
}

/** Same values under rewritten keys, in the same key order (allocate() breaks ties by order). */
function mapKeys<T>(record: Record<ID, T>, map: IdMap): Record<ID, T> {
  if (typeof record !== 'object' || record === null) return record;
  const out: Record<ID, T> = {};
  for (const id of Object.keys(record)) out[map(id)] = record[id];
  return out;
}

function mapShares(shares: MoneyShare[], map: IdMap): MoneyShare[] {
  return Array.isArray(shares) ? shares.map((s) => ({ ...s, personId: map(s.personId) })) : shares;
}

function mapItem(item: BillItem, map: IdMap): BillItem {
  return { ...item, shares: mapKeys(item.shares, map) };
}

/** Every SplitInput variant: participant lists, the keys of amounts / percents / shares /
 *  adjustments, and the share keys of each itemised bill item. */
export function remapSplit(split: SplitInput, map: IdMap): SplitInput {
  if (typeof split !== 'object' || split === null) return split;
  switch (split.method) {
    case 'equal':
      return { ...split, participantIds: mapList(split.participantIds, map) };
    case 'exact':
      return { ...split, amounts: mapKeys(split.amounts, map) };
    case 'percent':
      return { ...split, percents: mapKeys(split.percents, map) };
    case 'shares':
      return { ...split, shares: mapKeys(split.shares, map) };
    case 'adjustment':
      return { ...split, participantIds: mapList(split.participantIds, map), adjustments: mapKeys(split.adjustments, map) };
    case 'itemized': {
      const bill = split.bill;
      if (typeof bill !== 'object' || bill === null || !Array.isArray(bill.items)) return split;
      return { ...split, bill: { ...bill, items: bill.items.map((item) => mapItem(item, map)) } };
    }
    default:
      return split;
  }
}

export function remapComment(c: Comment, map: IdMap): Comment {
  return { ...c, authorId: map(c.authorId) };
}

export function remapExpense(e: Expense, map: IdMap): Expense {
  return {
    ...e,
    payers: mapShares(e.payers, map),
    owed: mapShares(e.owed, map),
    split: remapSplit(e.split, map),
    comments: Array.isArray(e.comments) ? e.comments.map((c) => remapComment(c, map)) : e.comments,
    createdBy: map(e.createdBy),
  };
}

export function remapPayment(p: Payment, map: IdMap): Payment {
  return { ...p, fromId: map(p.fromId), toId: map(p.toId) };
}

export function remapActivity(a: Activity, map: IdMap): Activity {
  const out: Activity = { ...a, actorId: map(a.actorId) };
  if (a.personId !== undefined) out.personId = map(a.personId);
  return out;
}
