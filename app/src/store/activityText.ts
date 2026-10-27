// Sentences for the Activity feed. Pure; names come from the state at the time of the
// change, so a later rename does not rewrite history.
import type { AppState, Expense, Group, ID, Payment, Person, Settings } from '../types';
import { formatMoney } from '../lib/money';
import { personName } from './selectors';

/** 'You' / 'Aarav' — the subject at the start of a sentence. */
const subject = (state: AppState, id: ID): string => personName(state, id, { you: 'You' });
/** 'you' / 'Aarav' — anywhere else in a sentence. */
const object = (state: AppState, id: ID): string => personName(state, id, { you: 'you' });

function groupLabel(state: AppState, groupId: ID | null): string | null {
  if (groupId === null) return null;
  const group = state.groups[groupId];
  return group ? group.name : null;
}

const inGroup = (state: AppState, groupId: ID | null): string => {
  const name = groupLabel(state, groupId);
  return name ? ` in ${name}` : '';
};

const fromGroup = (state: AppState, groupId: ID | null): string => {
  const name = groupLabel(state, groupId);
  return name ? ` from ${name}` : '';
};

export function expenseAddedText(state: AppState, actorId: ID, e: Pick<Expense, 'description' | 'groupId'>): string {
  return `${subject(state, actorId)} added "${e.description}"${inGroup(state, e.groupId)}.`;
}

export function expenseUpdatedText(state: AppState, actorId: ID, e: Pick<Expense, 'description' | 'groupId'>): string {
  return `${subject(state, actorId)} updated "${e.description}"${inGroup(state, e.groupId)}.`;
}

export function expenseDeletedText(state: AppState, actorId: ID, e: Pick<Expense, 'description' | 'groupId'>): string {
  return `${subject(state, actorId)} deleted "${e.description}"${fromGroup(state, e.groupId)}.`;
}

export function expenseRestoredText(state: AppState, actorId: ID, e: Pick<Expense, 'description' | 'groupId'>): string {
  return `${subject(state, actorId)} restored "${e.description}"${inGroup(state, e.groupId)}.`;
}

/** A copy created automatically from a recurring expense. */
export function recurringCopyText(state: AppState, e: Pick<Expense, 'description' | 'groupId'>): string {
  return `Recurring expense "${e.description}" was added${inGroup(state, e.groupId)}.`;
}

/** 'Aarav paid you ₹500.00' (no trailing period). */
function paymentClause(state: AppState, p: Pick<Payment, 'fromId' | 'toId' | 'amount' | 'currency'>): string {
  return `${object(state, p.fromId)} paid ${object(state, p.toId)} ${formatMoney(p.amount, p.currency)}`;
}

/**
 * When the payer records it themselves: 'Diya paid you ₹2,000.00 in Goa Trip.'
 * Otherwise: 'You recorded a payment in Goa Trip: Aarav paid you ₹500.00.'
 */
export function paymentAddedText(state: AppState, actorId: ID, p: Pick<Payment, 'fromId' | 'toId' | 'amount' | 'currency' | 'groupId'>): string {
  if (actorId === p.fromId) {
    return `${subject(state, p.fromId)} paid ${object(state, p.toId)} ${formatMoney(p.amount, p.currency)}${inGroup(state, p.groupId)}.`;
  }
  return `${subject(state, actorId)} recorded a payment${inGroup(state, p.groupId)}: ${paymentClause(state, p)}.`;
}

export function paymentDeletedText(state: AppState, actorId: ID, p: Pick<Payment, 'fromId' | 'toId' | 'amount' | 'currency' | 'groupId'>): string {
  return `${subject(state, actorId)} deleted a payment${fromGroup(state, p.groupId)}: ${paymentClause(state, p)}.`;
}

export function groupCreatedText(state: AppState, actorId: ID, g: Pick<Group, 'name'>): string {
  return `${subject(state, actorId)} created the group "${g.name}".`;
}

export function groupUpdatedText(state: AppState, actorId: ID, before: Group, after: Group): string {
  const who = subject(state, actorId);
  if (before.name !== after.name) return `${who} renamed "${before.name}" to "${after.name}".`;
  if (!before.archived && after.archived) return `${who} archived "${after.name}".`;
  if (before.archived && !after.archived) return `${who} unarchived "${after.name}".`;
  if (before.simplifyDebts !== after.simplifyDebts) {
    return `${who} turned ${after.simplifyDebts ? 'on' : 'off'} simplify debts in "${after.name}".`;
  }
  return `${who} updated the group "${after.name}".`;
}

export function groupDeletedText(state: AppState, actorId: ID, g: Pick<Group, 'name'>): string {
  return `${subject(state, actorId)} deleted the group "${g.name}".`;
}

export function memberAddedText(state: AppState, actorId: ID, memberId: ID, g: Pick<Group, 'name'>): string {
  return `${subject(state, actorId)} added ${object(state, memberId)} to ${g.name}.`;
}

export function memberRemovedText(state: AppState, actorId: ID, memberId: ID, g: Pick<Group, 'name'>): string {
  return `${subject(state, actorId)} removed ${object(state, memberId)} from ${g.name}.`;
}

export function friendAddedText(state: AppState, actorId: ID, friendId: ID): string {
  return `${subject(state, actorId)} added ${object(state, friendId)} as a friend.`;
}

/** 'You renamed Aarav to Aarav S.' / "You updated Aarav's details." / 'You updated your profile.' */
export function personUpdatedText(state: AppState, actorId: ID, before: Person, after: Person): string {
  const who = subject(state, actorId);
  if (after.id === actorId) return `${who} updated your profile.`;
  if (before.name !== after.name) return `${who} renamed ${before.name} to ${after.name}.`;
  return `${who} updated ${after.name}'s details.`;
}

export function friendRemovedText(state: AppState, actorId: ID, friendId: ID): string {
  return `${subject(state, actorId)} removed ${object(state, friendId)} from your friends.`;
}

/** One sentence per kind of change; never repeats the API key itself. */
export function settingsUpdatedText(state: AppState, actorId: ID, before: Settings, after: Settings): string {
  const who = subject(state, actorId);
  const changed = (Object.keys(after) as (keyof Settings)[]).filter((k) => before[k] !== after[k]);
  if (changed.length !== 1) return `${who} updated your settings.`;
  switch (changed[0]) {
    case 'defaultCurrency':
      return `${who} changed your default currency to ${after.defaultCurrency}.`;
    case 'ocrApiKey':
      return after.ocrApiKey ? `${who} saved an OCR.space API key for bill scanning.` : `${who} removed your OCR.space API key.`;
    case 'ocrEngine':
      return `${who} switched bill scanning to OCR engine ${after.ocrEngine}.`;
    case 'appearance':
      return `${who} switched the app to ${after.appearance === 'system' ? 'match the phone (light or dark)' : `${after.appearance} mode`}.`;
    case 'simplifyDebtsDefault':
      return `${who} turned ${after.simplifyDebtsDefault ? 'on' : 'off'} simplify debts for new groups.`;
    default:
      return `${who} updated your settings.`;
  }
}

export function commentAddedText(state: AppState, actorId: ID, e: Pick<Expense, 'description'>): string {
  return `${subject(state, actorId)} commented on "${e.description}".`;
}
