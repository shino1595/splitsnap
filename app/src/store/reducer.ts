// The pure state machine behind AppStore. Ids and timestamps arrive inside the actions
// (AppStore.tsx creates them), so the same action on the same state always gives the
// same result. Builders and validation are exported so AppStore can return results
// synchronously and tests can exercise everything without React.
import { ME_ID } from '../types';
import type {
  Activity,
  ActivityType,
  AppState,
  Comment,
  CurrencyCode,
  Expense,
  ExpenseInput,
  Group,
  GroupType,
  ID,
  ISODate,
  ISODateTime,
  MoneyShare,
  Payment,
  PaymentInput,
  Person,
  Recurrence,
  RecurrenceFrequency,
  Settings,
} from '../types';
import { avatarPalette } from '../theme';
import { computeOwed, validatePayers } from '../lib/split';
import { sumMinor } from '../lib/money';
import { advance, dueDates } from '../lib/recurrence';
import { canDeleteGroup, canRemoveFriend, canRemoveGroupMember } from './selectors';
import { blankState } from './stateShape';
import * as text from './activityText';
import type { ImportPlan } from '../lib/splitwiseImport';

/** Oldest entries beyond this are dropped so the saved state stays small. */
export const MAX_ACTIVITY = 500;

export interface FriendInput {
  name: string;
  email?: string;
  phone?: string;
  upiId?: string;
}

export interface GroupInput {
  name: string;
  type: GroupType;
  emoji: string;
  memberIds: ID[];
  defaultCurrency: CurrencyCode;
  simplifyDebts: boolean;
}

export type PersonPatch = Partial<Omit<Person, 'id' | 'createdAt'>>;
export type GroupPatch = Partial<Omit<Group, 'id' | 'createdAt'>>;

/** Fields shared by every action that records an Activity. actorId defaults to ME_ID. */
export interface Stamp {
  at: ISODateTime;
  activityId: ID;
  actorId?: ID;
}

export type AppAction =
  | { type: 'state/replace'; state: AppState }
  /** Wipe everything except the user's own profile and settings. */
  | { type: 'state/clear'; at: ISODateTime }
  | ({ type: 'friend/add'; id: ID; input: FriendInput } & Stamp)
  | ({ type: 'person/update'; id: ID; patch: PersonPatch } & Stamp)
  | ({ type: 'friend/remove'; id: ID } & Stamp)
  | ({ type: 'friend/restore'; id: ID } & Stamp)
  | ({ type: 'group/create'; id: ID; input: GroupInput } & Stamp)
  | ({ type: 'group/update'; id: ID; patch: GroupPatch } & Stamp)
  | ({ type: 'group/addMember'; groupId: ID; personId: ID } & Stamp)
  | ({ type: 'group/removeMember'; groupId: ID; personId: ID } & Stamp)
  | ({ type: 'group/delete'; id: ID } & Stamp)
  | ({ type: 'expense/add'; id: ID; input: ExpenseInput } & Stamp)
  | ({ type: 'expense/update'; id: ID; input: ExpenseInput } & Stamp)
  | ({ type: 'expense/delete'; id: ID } & Stamp)
  | ({ type: 'expense/restore'; id: ID } & Stamp)
  | ({ type: 'comment/add'; expenseId: ID; commentId: ID; text: string } & Stamp)
  | ({ type: 'payment/add'; id: ID; input: PaymentInput } & Stamp)
  | ({ type: 'payment/delete'; id: ID } & Stamp)
  /** Adds a whole Splitwise export at once (friends, group, expenses, payments) with one Activity entry. */
  | ({ type: 'import/apply'; plan: ImportPlan } & Stamp)
  | ({ type: 'settings/update'; patch: Partial<Settings> } & Stamp)
  /** Materialise due copies of recurring expenses; new ids are `${idBase}_<n>` / `${idBase}_a<n>`. */
  | { type: 'recurring/process'; today: ISODate; at: ISODateTime; idBase: string };

// ---------- Small helpers ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES: RecurrenceFrequency[] = ['weekly', 'fortnightly', 'monthly', 'yearly'];

function trimOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

/** Copy of a plain JSON value, so later edits to a draft can't reach the stored expense. */
function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Drops keys whose value is undefined (keeps saved JSON and equality checks tidy). */
function compact<T extends object>(obj: T): T {
  const out = { ...obj } as unknown as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as T;
}

function samePerson(a: Person, b: Person): boolean {
  return a.name === b.name && a.email === b.email && a.phone === b.phone && a.upiId === b.upiId && a.color === b.color;
}

function addActivity(
  state: AppState,
  stamp: Stamp,
  type: ActivityType,
  summary: string,
  extra?: Partial<Pick<Activity, 'groupId' | 'expenseId' | 'paymentId' | 'personId' | 'amount' | 'currency'>>,
): AppState {
  const entry: Activity = compact({
    id: stamp.activityId,
    type,
    at: stamp.at,
    actorId: stamp.actorId || ME_ID,
    summary,
    ...extra,
  });
  return { ...state, activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY) };
}

const actorOf = (stamp: Stamp): ID => stamp.actorId || ME_ID;

/** ME first, then the given people once each, keeping only people the app knows. */
export function normalizeMemberIds(state: AppState, ids: ID[]): ID[] {
  const out: ID[] = [ME_ID];
  for (const id of ids) {
    if (id !== ME_ID && state.people[id] && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

/** Group members appear on the Friends tab too. */
function withFriends(state: AppState, ids: ID[]): AppState {
  const missing = ids.filter((id) => id !== ME_ID && state.people[id] && state.friendIds.indexOf(id) < 0);
  return missing.length ? { ...state, friendIds: [...state.friendIds, ...missing] } : state;
}

// ---------- Builders (pure, shared by the reducer, AppStore and seed) ----------

export function buildPerson(state: AppState, id: ID, input: FriendInput, at: ISODateTime): Person {
  const colorIndex = Object.keys(state.people).length % avatarPalette.length;
  return compact({
    id,
    name: input.name.trim() || 'Friend',
    email: trimOrUndefined(input.email),
    phone: trimOrUndefined(input.phone),
    upiId: trimOrUndefined(input.upiId),
    color: avatarPalette[colorIndex],
    createdAt: at,
  });
}

export function buildGroup(state: AppState, id: ID, input: GroupInput, at: ISODateTime): Group {
  return {
    id,
    name: input.name.trim() || 'New group',
    type: input.type,
    emoji: input.emoji || '👥',
    memberIds: normalizeMemberIds(state, input.memberIds),
    simplifyDebts: input.simplifyDebts,
    defaultCurrency: input.defaultCurrency || state.settings.defaultCurrency,
    createdAt: at,
  };
}

/** A repeat's next date must fall after the expense's own date. */
export function normalizeRecurrence(recurrence: Recurrence | undefined, date: ISODate): Recurrence | undefined {
  if (!recurrence) return undefined;
  const nextDate =
    ISO_DATE.test(recurrence.nextDate) && recurrence.nextDate > date ? recurrence.nextDate : advance(date, recurrence.frequency);
  return { frequency: recurrence.frequency, nextDate };
}

export interface ExpenseBuildContext {
  id: ID;
  at: ISODateTime;
  createdBy: ID;
}

/**
 * Validates an ExpenseInput and turns it into an Expense with `owed` recomputed by
 * computeOwed. Returns errors (and no expense) when anything is wrong. Pass `existing`
 * when updating so its identity, comments and history are kept.
 */
export function buildExpense(
  state: AppState,
  input: ExpenseInput,
  ctx: ExpenseBuildContext,
  existing?: Expense,
): { expense?: Expense; errors: string[] } {
  const errors: string[] = [];
  const description = input.description.trim();
  if (!description) errors.push('Enter a description');
  const amountOk = Number.isInteger(input.total) && input.total > 0;
  if (!amountOk) errors.push('Enter an amount');
  if (!ISO_DATE.test(input.date)) errors.push('Choose a date');
  if (input.groupId !== null && !state.groups[input.groupId]) errors.push('This group no longer exists');
  if (input.recurrence && FREQUENCIES.indexOf(input.recurrence.frequency) < 0) errors.push('Choose how often this repeats');

  let owed: MoneyShare[] = [];
  if (amountOk) {
    errors.push(...validatePayers(input.total, input.payers, input.currency));
    const result = computeOwed(input.total, input.split, input.currency);
    errors.push(...result.errors);
    owed = result.owed.filter((o) => o.amount !== 0);
    if (result.errors.length === 0 && (owed.length === 0 || sumMinor(owed.map((o) => o.amount)) !== input.total)) {
      errors.push("The split doesn't add up to the total");
    }
    const everyone = [...input.payers, ...owed].map((s) => s.personId);
    if (everyone.some((id) => !state.people[id])) errors.push('Someone in this expense is no longer in the app');
  }

  const unique = errors.filter((e, i) => errors.indexOf(e) === i);
  if (unique.length > 0) return { errors: unique };

  const expense: Expense = compact({
    id: existing ? existing.id : ctx.id,
    groupId: input.groupId,
    description,
    category: input.category,
    currency: input.currency,
    total: input.total,
    date: input.date,
    notes: trimOrUndefined(input.notes),
    receiptUri: input.receiptUri || undefined,
    payers: input.payers.filter((p) => p.amount !== 0).map((p) => ({ personId: p.personId, amount: p.amount })),
    split: clonePlain(input.split),
    owed: owed.map((o) => ({ personId: o.personId, amount: o.amount })),
    recurrence: normalizeRecurrence(input.recurrence, input.date),
    recurringParentId: existing ? existing.recurringParentId : undefined,
    comments: existing ? existing.comments : [],
    createdBy: existing ? existing.createdBy : ctx.createdBy,
    createdAt: existing ? existing.createdAt : ctx.at,
    updatedAt: ctx.at,
    deletedAt: existing ? existing.deletedAt : undefined,
  });
  return { expense, errors: [] };
}

export function validatePaymentInput(state: AppState, input: PaymentInput): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.push('Enter an amount');
  if (input.fromId === input.toId) errors.push('Choose two different people');
  if (!state.people[input.fromId] || !state.people[input.toId]) errors.push('Choose who paid whom');
  if (input.groupId !== null && !state.groups[input.groupId]) errors.push('This group no longer exists');
  if (!ISO_DATE.test(input.date)) errors.push('Choose a date');
  return errors;
}

export function buildPayment(id: ID, input: PaymentInput, at: ISODateTime): Payment {
  return compact({
    id,
    groupId: input.groupId,
    fromId: input.fromId,
    toId: input.toId,
    amount: input.amount,
    currency: input.currency,
    date: input.date,
    note: trimOrUndefined(input.note),
    method: input.method,
    createdAt: at,
  });
}

/**
 * Creates a copy of every live recurring expense for each due date up to `today`
 * (via dueDates), moves the parent's nextDate on and logs one activity per copy.
 * Returns the same state object when nothing is due.
 */
export function processRecurring(state: AppState, today: ISODate, at: ISODateTime, idBase: string): AppState {
  const parents = Object.values(state.expenses)
    .filter((e) => !e.deletedAt && e.recurrence && e.recurrence.nextDate <= today)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (parents.length === 0) return state;

  const expenses = { ...state.expenses };
  let next: AppState = state;
  let n = 0;
  for (const parent of parents) {
    const recurrence = parent.recurrence as Recurrence;
    const due = dueDates(recurrence, today, parent.date);
    for (const date of due.dates) {
      n += 1;
      const copy: Expense = compact({
        ...parent,
        id: `${idBase}_${n}`,
        date,
        payers: parent.payers.map((p) => ({ ...p })),
        owed: parent.owed.map((o) => ({ ...o })),
        split: clonePlain(parent.split),
        recurrence: undefined,
        recurringParentId: parent.id,
        receiptUri: undefined,
        comments: [],
        createdAt: at,
        updatedAt: at,
        deletedAt: undefined,
      });
      expenses[copy.id] = copy;
      next = addActivity(
        next,
        { at, activityId: `${idBase}_a${n}`, actorId: parent.createdBy },
        'expense_added',
        text.recurringCopyText(next, copy),
        { groupId: copy.groupId, expenseId: copy.id, amount: copy.total, currency: copy.currency },
      );
    }
    expenses[parent.id] = { ...parent, recurrence: { frequency: recurrence.frequency, nextDate: due.nextDate } };
  }
  return { ...next, expenses };
}

// ---------- Reducer ----------

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'state/replace':
      return action.state;

    case 'state/clear':
      return blankState(action.at, state.people[ME_ID], state.settings);

    case 'friend/add': {
      const person = buildPerson(state, action.id, action.input, action.at);
      const next: AppState = {
        ...state,
        people: { ...state.people, [person.id]: person },
        friendIds: [...state.friendIds, person.id],
      };
      return addActivity(next, action, 'friend_added', text.friendAddedText(next, actorOf(action), person.id), {
        personId: person.id,
      });
    }

    case 'person/update': {
      const person = state.people[action.id];
      if (!person) return state;
      const patch = action.patch;
      const updated: Person = compact({
        ...person,
        ...patch,
        id: person.id,
        createdAt: person.createdAt,
        name: patch.name !== undefined && patch.name.trim() ? patch.name.trim() : person.name,
        email: 'email' in patch ? trimOrUndefined(patch.email) : person.email,
        phone: 'phone' in patch ? trimOrUndefined(patch.phone) : person.phone,
        upiId: 'upiId' in patch ? trimOrUndefined(patch.upiId) : person.upiId,
      });
      if (samePerson(person, updated)) return state;
      const next: AppState = { ...state, people: { ...state.people, [person.id]: updated } };
      return addActivity(next, action, 'friend_updated', text.personUpdatedText(next, actorOf(action), person, updated), {
        personId: person.id,
      });
    }

    case 'friend/remove': {
      if (!canRemoveFriend(state, action.id).ok) return state;
      const next: AppState = { ...state, friendIds: state.friendIds.filter((id) => id !== action.id) };
      return addActivity(next, action, 'friend_removed', text.friendRemovedText(next, actorOf(action), action.id), {
        personId: action.id,
      });
    }

    case 'friend/restore': {
      // Adds a removed friend back to the list; their person record and history were kept.
      if (action.id === ME_ID || !state.people[action.id] || state.friendIds.indexOf(action.id) >= 0) return state;
      const next = withFriends(state, [action.id]);
      return addActivity(next, action, 'friend_added', text.friendAddedText(next, actorOf(action), action.id), {
        personId: action.id,
      });
    }

    case 'group/create': {
      const group = buildGroup(state, action.id, action.input, action.at);
      const next = withFriends({ ...state, groups: { ...state.groups, [group.id]: group } }, group.memberIds);
      return addActivity(next, action, 'group_created', text.groupCreatedText(next, actorOf(action), group), {
        groupId: group.id,
      });
    }

    case 'group/update': {
      const before = state.groups[action.id];
      if (!before) return state;
      const patch = action.patch;
      const wanted = patch.memberIds;
      let memberIds = before.memberIds;
      if (wanted) {
        // Members with an open balance stay; removeGroupMember explains why.
        const kept = before.memberIds.filter(
          (id) => wanted.indexOf(id) >= 0 || !canRemoveGroupMember(state, before.id, id).ok,
        );
        memberIds = normalizeMemberIds(state, [...kept, ...wanted]);
      }
      const after: Group = compact({
        ...before,
        ...patch,
        id: before.id,
        createdAt: before.createdAt,
        name: patch.name !== undefined && patch.name.trim() ? patch.name.trim() : before.name,
        memberIds,
      });
      if (JSON.stringify(after) === JSON.stringify(before)) return state;
      const next = withFriends({ ...state, groups: { ...state.groups, [after.id]: after } }, memberIds);
      return addActivity(next, action, 'group_updated', text.groupUpdatedText(next, actorOf(action), before, after), {
        groupId: after.id,
      });
    }

    case 'group/addMember': {
      const group = state.groups[action.groupId];
      if (!group || !state.people[action.personId] || group.memberIds.indexOf(action.personId) >= 0) return state;
      const updated: Group = { ...group, memberIds: [...group.memberIds, action.personId] };
      const next = withFriends({ ...state, groups: { ...state.groups, [group.id]: updated } }, [action.personId]);
      return addActivity(next, action, 'member_added', text.memberAddedText(next, actorOf(action), action.personId, group), {
        groupId: group.id,
      });
    }

    case 'group/removeMember': {
      const group = state.groups[action.groupId];
      if (!group || !canRemoveGroupMember(state, action.groupId, action.personId).ok) return state;
      const updated: Group = { ...group, memberIds: group.memberIds.filter((id) => id !== action.personId) };
      const next = { ...state, groups: { ...state.groups, [group.id]: updated } };
      return addActivity(next, action, 'member_removed', text.memberRemovedText(next, actorOf(action), action.personId, group), {
        groupId: group.id,
      });
    }

    case 'group/delete': {
      const group = state.groups[action.id];
      if (!group || !canDeleteGroup(state, action.id).ok) return state;
      const groups = { ...state.groups };
      delete groups[group.id];
      const expenses: Record<ID, Expense> = {};
      for (const e of Object.values(state.expenses)) if (e.groupId !== group.id) expenses[e.id] = e;
      const payments: Record<ID, Payment> = {};
      for (const p of Object.values(state.payments)) if (p.groupId !== group.id) payments[p.id] = p;
      const next = { ...state, groups, expenses, payments };
      return addActivity(next, action, 'group_deleted', text.groupDeletedText(next, actorOf(action), group), {
        groupId: group.id,
      });
    }

    case 'expense/add': {
      if (state.expenses[action.id]) return state;
      const { expense } = buildExpense(state, action.input, { id: action.id, at: action.at, createdBy: actorOf(action) });
      if (!expense) return state;
      const next = { ...state, expenses: { ...state.expenses, [expense.id]: expense } };
      return addActivity(next, action, 'expense_added', text.expenseAddedText(next, actorOf(action), expense), {
        groupId: expense.groupId,
        expenseId: expense.id,
        amount: expense.total,
        currency: expense.currency,
      });
    }

    case 'expense/update': {
      const existing = state.expenses[action.id];
      if (!existing) return state;
      const { expense } = buildExpense(state, action.input, { id: action.id, at: action.at, createdBy: actorOf(action) }, existing);
      if (!expense) return state;
      const next = { ...state, expenses: { ...state.expenses, [expense.id]: expense } };
      return addActivity(next, action, 'expense_updated', text.expenseUpdatedText(next, actorOf(action), expense), {
        groupId: expense.groupId,
        expenseId: expense.id,
        amount: expense.total,
        currency: expense.currency,
      });
    }

    case 'expense/delete': {
      const existing = state.expenses[action.id];
      if (!existing || existing.deletedAt) return state;
      const deleted: Expense = { ...existing, deletedAt: action.at };
      const next = { ...state, expenses: { ...state.expenses, [deleted.id]: deleted } };
      return addActivity(next, action, 'expense_deleted', text.expenseDeletedText(next, actorOf(action), deleted), {
        groupId: deleted.groupId,
        expenseId: deleted.id,
        amount: deleted.total,
        currency: deleted.currency,
      });
    }

    case 'expense/restore': {
      const existing = state.expenses[action.id];
      if (!existing || !existing.deletedAt) return state;
      if (existing.groupId !== null && !state.groups[existing.groupId]) return state;
      const restored: Expense = compact({ ...existing, deletedAt: undefined, updatedAt: action.at });
      const next = { ...state, expenses: { ...state.expenses, [restored.id]: restored } };
      return addActivity(next, action, 'expense_restored', text.expenseRestoredText(next, actorOf(action), restored), {
        groupId: restored.groupId,
        expenseId: restored.id,
        amount: restored.total,
        currency: restored.currency,
      });
    }

    case 'comment/add': {
      const existing = state.expenses[action.expenseId];
      const body = action.text.trim();
      if (!existing || !body) return state;
      const comment: Comment = { id: action.commentId, authorId: actorOf(action), text: body, createdAt: action.at };
      const updated: Expense = { ...existing, comments: [...existing.comments, comment] };
      const next = { ...state, expenses: { ...state.expenses, [updated.id]: updated } };
      return addActivity(next, action, 'comment_added', text.commentAddedText(next, actorOf(action), updated), {
        groupId: updated.groupId,
        expenseId: updated.id,
      });
    }

    case 'payment/add': {
      if (state.payments[action.id] || validatePaymentInput(state, action.input).length > 0) return state;
      const payment = buildPayment(action.id, action.input, action.at);
      const next = { ...state, payments: { ...state.payments, [payment.id]: payment } };
      return addActivity(next, action, 'payment_added', text.paymentAddedText(next, actorOf(action), payment), {
        groupId: payment.groupId,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
      });
    }

    case 'payment/delete': {
      const existing = state.payments[action.id];
      if (!existing || existing.deletedAt) return state;
      const deleted: Payment = { ...existing, deletedAt: action.at };
      const next = { ...state, payments: { ...state.payments, [deleted.id]: deleted } };
      return addActivity(next, action, 'payment_deleted', text.paymentDeletedText(next, actorOf(action), deleted), {
        groupId: deleted.groupId,
        paymentId: deleted.id,
        amount: deleted.amount,
        currency: deleted.currency,
      });
    }

    case 'import/apply': {
      const plan = action.plan;
      if (state.groups[plan.groupId]) return state;
      const people = { ...state.people };
      const friendIds = [...state.friendIds];
      for (const f of plan.newFriends) {
        if (people[f.id]) continue;
        people[f.id] = buildPerson({ ...state, people }, f.id, { name: f.name }, action.at);
        friendIds.push(f.id);
      }
      let next: AppState = { ...state, people, friendIds };
      const group = buildGroup(next, plan.groupId, plan.group, action.at);
      next = withFriends({ ...next, groups: { ...next.groups, [group.id]: group } }, group.memberIds);

      // Every expense goes through the same validation as one added by hand.
      const expenses = { ...next.expenses };
      let added = 0;
      for (const item of plan.expenses) {
        if (expenses[item.id]) continue;
        const { expense } = buildExpense({ ...next, expenses }, item.input, { id: item.id, at: action.at, createdBy: actorOf(action) });
        if (!expense) continue;
        expenses[expense.id] = expense;
        added++;
      }
      const payments = { ...next.payments };
      let paid = 0;
      for (const item of plan.payments) {
        if (payments[item.id] || validatePaymentInput(next, item.input).length > 0) continue;
        payments[item.id] = buildPayment(item.id, item.input, action.at);
        paid++;
      }
      next = { ...next, expenses, payments };
      return addActivity(next, action, 'group_created', text.groupImportedText(next, actorOf(action), group, added, paid), {
        groupId: group.id,
      });
    }

    case 'settings/update': {
      const settings: Settings = { ...state.settings, ...action.patch };
      const keys = Object.keys(settings) as (keyof Settings)[];
      if (keys.every((k) => settings[k] === state.settings[k])) return state;
      const next: AppState = { ...state, settings };
      return addActivity(next, action, 'settings_updated', text.settingsUpdatedText(next, actorOf(action), state.settings, settings));
    }

    case 'recurring/process':
      return processRecurring(state, action.today, action.at, action.idBase);

    default:
      return state;
  }
}
