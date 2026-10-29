// Local changes to shared groups → outbox keys (docs/SYNC_DESIGN.md §4.1). The reducer replaces
// records instead of mutating them, so reference checks find every change. Only keys are
// produced; the payload is read from the state when sending (outbox.ts).
import type { AppState, Expense, Group, ID } from '../types';
import type { OutboxKey, SyncState } from './types';
import { mergeOutbox } from './outbox';

/**
 * state/replace and state/clear swap the whole state; the engine resyncs those itself, and
 * diffing them would read every vanished group as deleted. No other action replaces both
 * settings and groups, and every other action keeps the old activity list behind its new entries.
 */
function isWholeSwap(prev: AppState, next: AppState): boolean {
  if (prev.settings !== next.settings && prev.groups !== next.groups) return true;
  return prev.activity.length > 0 && next.activity !== prev.activity && next.activity.indexOf(prev.activity[0]) < 0;
}

/** Fields that travel in a 'group' row (members have their own rows). */
function groupChanged(a: Group, b: Group): boolean {
  return (
    a.name !== b.name ||
    a.type !== b.type ||
    a.emoji !== b.emoji ||
    a.defaultCurrency !== b.defaultCurrency ||
    a.simplifyDebts !== b.simplifyDebts ||
    !!a.archived !== !!b.archived
  );
}

/** Comments travel as their own rows and the bill photo stays here, so neither counts. */
function expenseChanged(a: Expense, b: Expense): boolean {
  const keys = Object.keys(a).concat(Object.keys(b)) as (keyof Expense)[];
  return keys.some((k) => k !== 'comments' && k !== 'receiptUri' && a[k] !== b[k]);
}

export function diffShared(prev: AppState, next: AppState, sync: SyncState): OutboxKey[] {
  if (prev === next || isWholeSwap(prev, next)) return [];
  const sharedIds = Object.keys(sync.groups);
  const isShared = (groupId: ID | null | undefined): groupId is ID =>
    !!groupId && Object.prototype.hasOwnProperty.call(sync.groups, groupId);
  const keys: OutboxKey[] = [];

  if (prev.groups !== next.groups) {
    for (const groupId of sharedIds) {
      const before = prev.groups[groupId];
      const after = next.groups[groupId];
      if (!after) {
        if (before) keys.push({ kind: 'group-delete', groupId, id: groupId });
        continue;
      }
      // No baseline (the group appeared without a local action): nothing to compare.
      if (!before || before === after) continue;
      if (groupChanged(before, after)) keys.push({ kind: 'group', groupId, id: groupId });
      for (const id of after.memberIds) {
        if (before.memberIds.indexOf(id) < 0) keys.push({ kind: 'member', groupId, id });
      }
    }
  }

  // A renamed or recoloured person is re-sent in every shared group they belong to.
  if (prev.people !== next.people) {
    for (const id of Object.keys(next.people)) {
      const before = prev.people[id];
      const after = next.people[id];
      if (!before || before === after || (before.name === after.name && before.color === after.color)) continue;
      for (const groupId of sharedIds) {
        const group = next.groups[groupId];
        if (group && group.memberIds.indexOf(id) >= 0) keys.push({ kind: 'member', groupId, id });
      }
    }
  }

  if (prev.expenses !== next.expenses) {
    for (const id of Object.keys(next.expenses)) {
      const expense = next.expenses[id];
      const before = prev.expenses[id];
      if (expense === before || !isShared(expense.groupId)) continue;
      const groupId = expense.groupId;
      if (!before || expenseChanged(before, expense)) keys.push({ kind: 'expense', groupId, id });
      if (before && before.comments === expense.comments) continue;
      const known = new Set(before ? before.comments.map((c) => c.id) : []);
      for (const c of expense.comments) {
        if (!known.has(c.id)) keys.push({ kind: 'comment', groupId, id: c.id, expenseId: id });
      }
    }
  }

  if (prev.payments !== next.payments) {
    for (const id of Object.keys(next.payments)) {
      const payment = next.payments[id];
      if (payment === prev.payments[id] || !isShared(payment.groupId)) continue;
      keys.push({ kind: 'payment', groupId: payment.groupId, id });
    }
  }

  // New entries sit in front of the previous newest one; send them oldest first.
  if (prev.activity !== next.activity) {
    const head = prev.activity[0];
    const end = head ? Math.max(0, next.activity.indexOf(head)) : next.activity.length;
    for (const entry of next.activity.slice(0, end).reverse()) {
      if (isShared(entry.groupId)) keys.push({ kind: 'activity', groupId: entry.groupId, id: entry.id });
    }
  }

  return mergeOutbox([], keys);
}
