// The send queue (docs/SYNC_DESIGN.md §4): coalesced keys, and the push_changes payload built
// from the CURRENT state when sending, so the latest local version always wins.
import { ME_ID } from '../types';
import type { Activity, AppState, ID } from '../types';
import type { OutboxKey, PushPayload, SyncState } from './types';
import { toServerId } from './idMap';
import { pushActivity, pushComment, pushExpense, pushGroup, pushMember, pushPayment } from './rows';

function signature(key: OutboxKey): string {
  return `${key.kind}\u0000${key.groupId}\u0000${key.id}`;
}

/**
 * One key per kind + group + entity, in first-seen order. A 'group-delete' removes every other
 * key of its group (those records are gone). Returns `existing` itself when nothing changes.
 */
export function mergeOutbox(existing: OutboxKey[], added: OutboxKey[]): OutboxKey[] {
  const all = existing.concat(added);
  const deleted = new Set<ID>();
  for (const key of all) if (key.kind === 'group-delete') deleted.add(key.groupId);
  const seen = new Set<string>();
  const out: OutboxKey[] = [];
  for (const key of all) {
    if (key.kind !== 'group-delete' && deleted.has(key.groupId)) continue;
    const sig = signature(key);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(key);
  }
  const unchanged = out.length === existing.length && out.every((key, i) => key === existing[i]);
  return unchanged ? existing : out;
}

export interface BuiltPush {
  payload: PushPayload;
  /** Keys covered by the payload (a repeated key rides on the same row). */
  sent: OutboxKey[];
  /** Keys whose record is gone or whose group is no longer shared: nothing to send. */
  dropped: OutboxKey[];
}

/**
 * The push_changes payload for `keys`. Each row never appears twice (Postgres refuses an upsert
 * that touches one row twice). A 'group-delete' always goes out as { id, deleted: true }.
 */
export function buildPush(state: AppState, sync: SyncState, keys: OutboxKey[], myName: string): BuiltPush {
  const payload: PushPayload = { groups: [], members: [], expenses: [], payments: [], comments: [], activity: [] };
  const sent: OutboxKey[] = [];
  const dropped: OutboxKey[] = [];
  const included = new Set<string>();
  let activityById: Map<ID, Activity> | null = null;

  const findActivity = (id: ID): Activity | undefined => {
    if (!activityById) {
      activityById = new Map();
      for (const a of state.activity) activityById.set(a.id, a);
    }
    return activityById.get(id);
  };

  /** Adds the key's row to the payload; false when there is nothing to send. */
  const add = (key: OutboxKey): boolean => {
    if (key.kind === 'group-delete') {
      payload.groups.push({ id: key.groupId, deleted: true });
      return true;
    }
    const info = Object.prototype.hasOwnProperty.call(sync.groups, key.groupId) ? sync.groups[key.groupId] : undefined;
    if (!info) return false;
    const group = state.groups[key.groupId];
    switch (key.kind) {
      case 'group':
        if (!group) return false;
        payload.groups.push(pushGroup(group));
        return true;
      case 'member': {
        const person = state.people[key.id];
        if (!group || !person || group.memberIds.indexOf(key.id) < 0) return false;
        // Your own row carries the name other members know you by, not the local profile's.
        const name = key.id === ME_ID ? myName : person.name;
        payload.members.push(pushMember(key.groupId, { id: key.id, name, color: person.color }, toServerId(info.myMemberId)(key.id)));
        return true;
      }
      case 'expense': {
        const expense = state.expenses[key.id];
        if (!expense || expense.groupId !== key.groupId) return false;
        payload.expenses.push(pushExpense(expense, info));
        return true;
      }
      case 'payment': {
        const payment = state.payments[key.id];
        if (!payment || payment.groupId !== key.groupId) return false;
        payload.payments.push(pushPayment(payment, info));
        return true;
      }
      case 'comment': {
        const expense = key.expenseId ? state.expenses[key.expenseId] : undefined;
        if (!expense || expense.groupId !== key.groupId) return false;
        const comment = expense.comments.find((c) => c.id === key.id);
        if (!comment) return false;
        payload.comments.push(pushComment(expense.id, comment, key.groupId, info));
        return true;
      }
      case 'activity': {
        const entry = findActivity(key.id);
        if (!entry || entry.groupId !== key.groupId) return false;
        payload.activity.push(pushActivity(entry, info, myName));
        return true;
      }
      default:
        return false;
    }
  };

  for (const key of keys) {
    const sig = signature(key);
    if (included.has(sig)) {
      sent.push(key);
    } else if (add(key)) {
      included.add(sig);
      sent.push(key);
    } else {
      dropped.push(key);
    }
  }
  return { payload, sent, dropped };
}
