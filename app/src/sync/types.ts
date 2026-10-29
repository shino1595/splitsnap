// Contract for shared-group sync (docs/SYNC_DESIGN.md). Server rows mirror supabase/setup.sql;
// everything else is the app's own model. Nothing here imports Supabase.
import type { Activity, Comment, CurrencyCode, Expense, Group, GroupType, ID, ISODateTime, Payment, Person } from '../types';

// ---------- Local bookkeeping (AsyncStorage 'splitsnap/sync/v1', never inside AppState) ----------

export interface SharedMemberInfo {
  /** Supabase user id once a real person joined or claimed the row; null = placeholder. */
  userId: string | null;
  /** Set when that person left the group. */
  leftAt: ISODateTime | null;
}

export interface SharedGroupInfo {
  groupId: ID;
  /** The member id that is "you" in this group (rewritten to ME_ID locally, §2). */
  myMemberId: ID;
  joinCode: string | null;
  joinEnabled: boolean;
  members: Record<ID, SharedMemberInfo>;
  /** Newest server timestamp applied for this group (pulls start 10 s before it); null = never pulled. */
  cursor: ISODateTime | null;
}

export type OutboxKind = 'group' | 'member' | 'expense' | 'payment' | 'comment' | 'activity' | 'group-delete';

/** A change waiting to be sent. The payload is read from the current state when sending (§4). */
export interface OutboxKey {
  kind: OutboxKind;
  groupId: ID;
  /** Entity id (for 'group' / 'group-delete' the group id; for 'member' the member's local person id). */
  id: ID;
  /** Comments only: the expense the comment belongs to. */
  expenseId?: ID;
}

/** Bumped when SyncState changes shape. (A const, not a `1` literal type: Snack's Babel can't parse those.) */
export const SYNC_STATE_VERSION = 1;

export interface SyncState {
  version: typeof SYNC_STATE_VERSION;
  /** Supabase user id after the first (anonymous) sign-in. */
  userId: string | null;
  /** Your name as other members see it. */
  displayName: string | null;
  groups: Record<ID, SharedGroupInfo>;
  outbox: OutboxKey[];
}

export const EMPTY_SYNC_STATE: SyncState = { version: SYNC_STATE_VERSION, userId: null, displayName: null, groups: {}, outbox: [] };

// ---------- Server rows (PostgREST JSON, snake_case; see supabase/setup.sql) ----------

export interface GroupRow {
  id: ID;
  name: string;
  type: string;
  emoji: string;
  default_currency: CurrencyCode;
  simplify_debts: boolean;
  archived: boolean;
  join_code: string | null;
  join_enabled: boolean;
  created_by: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  updated_by: string | null;
  deleted_at: ISODateTime | null;
}

export interface MemberRow {
  group_id: ID;
  id: ID;
  user_id: string | null;
  name: string;
  color: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  left_at: ISODateTime | null;
}

/** expenses and payments. `data` is untrusted JSON: validate before use. */
export interface DataRow {
  id: ID;
  group_id: ID;
  data: unknown;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  updated_by: string | null;
  deleted_at: ISODateTime | null;
}

export interface CommentRow {
  id: ID;
  group_id: ID;
  expense_id: ID;
  data: unknown;
  created_at: ISODateTime;
  created_by: string | null;
  deleted_at: ISODateTime | null;
}

export interface ActivityRow {
  id: ID;
  group_id: ID;
  data: unknown;
  created_at: ISODateTime;
  created_by: string | null;
}

/** Rows from a pull or a live update. Any array may be empty. */
export interface RemoteBatch {
  groups: GroupRow[];
  members: MemberRow[];
  expenses: DataRow[];
  payments: DataRow[];
  comments: CommentRow[];
  activity: ActivityRow[];
}

export const EMPTY_BATCH: RemoteBatch = { groups: [], members: [], expenses: [], payments: [], comments: [], activity: [] };

// ---------- What the app sends (push_changes / share_group arguments, camelCase) ----------

export interface PushGroup {
  id: ID;
  name: string;
  type: GroupType;
  emoji: string;
  defaultCurrency: CurrencyCode;
  simplifyDebts: boolean;
  archived: boolean;
}

/** A shared group deleted on this phone: only the id travels (push_changes keeps the other fields). */
export interface PushGroupDelete {
  id: ID;
  deleted: true;
}

export interface PushMember {
  groupId: ID;
  id: ID;
  name: string;
  color: string | null;
}

/** `data` is the entity with ids already rewritten for the server (ME_ID → myMemberId). */
export interface PushData {
  id: ID;
  groupId: ID;
  data: Record<string, unknown>;
  deletedAt: ISODateTime | null;
}

export interface PushComment {
  id: ID;
  groupId: ID;
  expenseId: ID;
  data: Record<string, unknown>;
}

export interface PushActivity {
  id: ID;
  groupId: ID;
  data: Record<string, unknown>;
}

export interface PushPayload {
  groups: (PushGroup | PushGroupDelete)[];
  members: PushMember[];
  expenses: PushData[];
  payments: PushData[];
  comments: PushComment[];
  activity: PushActivity[];
}

export interface ShareRequest {
  group: PushGroup;
  /** Includes you, with id = me. */
  members: PushMember[];
  expenses: PushData[];
  payments: PushData[];
  comments: PushComment[];
  /** Your member id in this group (a fresh random 'u_…' id). */
  me: ID;
}

export interface GroupPreview {
  id: ID;
  name: string;
  emoji: string;
  members: { id: ID; name: string; claimed: boolean }[];
}

// ---------- The server, as the engine sees it ----------

/** Thrown by a backend; `kind` tells the engine whether to retry. */
export class SyncError extends Error {
  /** 'network' = retry later; 'denied' = not allowed (drop the change); 'invalid' = bad input; 'not-found' = e.g. wrong code. */
  kind: 'network' | 'denied' | 'invalid' | 'not-found';
  constructor(kind: 'network' | 'denied' | 'invalid' | 'not-found', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'SyncError';
  }
}

export type LiveStatus = 'connecting' | 'live' | 'offline';

export interface SyncBackend {
  /** Signs in anonymously if needed; returns the user id. */
  signIn(): Promise<string>;
  /** Creates or renames your profile. */
  saveProfile(displayName: string): Promise<void>;
  /** share_group: returns the join code. */
  shareGroup(request: ShareRequest): Promise<string>;
  /** preview_group: null when the code is wrong or switched off. */
  previewGroup(code: string): Promise<GroupPreview | null>;
  /** join_group: memberId null = join as a new member named `name`. */
  joinGroup(code: string, memberId: ID | null, name: string | null): Promise<{ groupId: ID; memberId: ID }>;
  leaveGroup(groupId: ID): Promise<void>;
  /** reset_join_code: returns the new code. */
  resetJoinCode(groupId: ID, enabled: boolean): Promise<string>;
  /** push_changes, one transaction. Returns rows written per kind (rows for groups you are not in are skipped). */
  push(payload: PushPayload): Promise<Record<keyof PushPayload, number>>;
  /** Everything for these groups changed after `since` (per group; null = everything). */
  pull(since: Record<ID, ISODateTime | null>): Promise<RemoteBatch>;
  /** Live updates for every group you can see. Returns an unsubscribe function. */
  subscribe(onRows: (batch: RemoteBatch) => void, onStatus: (status: LiveStatus) => void): () => void;
}

// ---------- What the reducer applies (ids already rewritten to the local model) ----------

export interface LocalBatch {
  /** People to create or rename (group members). Existing people keep their colour and details. */
  people: Pick<Person, 'id' | 'name' | 'color'>[];
  /** Groups to create or update; memberIds includes ME_ID where you are a member. */
  groups: Group[];
  /** Ids of shared groups that were deleted on the server. */
  deletedGroupIds: ID[];
  /** Full expenses (owed recomputed, comments kept from the local copy by the reducer). */
  expenses: Expense[];
  payments: Payment[];
  comments: { expenseId: ID; comment: Comment }[];
  /** Ids rewritten, summary still neutral: the reducer re-words it for this phone (§6). */
  activity: Activity[];
}

// ---------- What screens use (useSync() in SyncProvider.tsx) ----------

export type SyncStatus =
  /** No Supabase project in this build (config.ts empty): every sharing control is hidden. */
  | 'off'
  /** Configured, but you haven't shared or joined anything yet (no sign-in made). */
  | 'idle'
  | 'connecting'
  | 'live'
  /** Signed in but the server can't be reached; changes wait in the outbox. */
  | 'offline';

export interface SyncApi {
  status: SyncStatus;
  /** Changes waiting to be sent. */
  pending: number;
  /** Last problem worth showing (e.g. "You are no longer in Goa Trip"), or null. */
  lastError: string | null;
  /** Your name as other members see it (null until set). */
  displayName: string | null;
  setDisplayName(name: string): Promise<void>;
  /** Bookkeeping for a shared group, or null when the group is only on this phone. */
  shared(groupId: ID): SharedGroupInfo | null;
  /** True when this local person is a real SplitSnap user in that shared group (ME_ID: always). */
  isOnSplitSnap(groupId: ID, personId: ID): boolean;
  /** Uploads a local group (signs in first if needed). Returns the join code. */
  shareGroup(groupId: ID): Promise<string>;
  previewJoin(code: string): Promise<GroupPreview | null>;
  /** memberId = the placeholder you claim ("That's me"), or null to join as a new member. Returns the local group id. */
  joinGroup(code: string, memberId: ID | null): Promise<ID>;
  /** Stops syncing; the local copy stays as an ordinary group. */
  leaveGroup(groupId: ID): Promise<void>;
  /** New code (enabled = true) or joining switched off (enabled = false). Returns the new code. */
  resetJoinCode(groupId: ID, enabled: boolean): Promise<string>;
  /** Pull now and send anything waiting. */
  syncNow(): Promise<void>;
}
