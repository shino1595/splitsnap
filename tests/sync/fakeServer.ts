// In-memory stand-in for the Supabase project in supabase/setup.sql, for the sync tests (not a
// test file itself). It copies the server, not the engine's expectations: row security, the
// triggers' stamps, the check constraints and the six functions, each call one transaction.
//
// Postgres errors become SyncErrors the way a backend maps their codes: 'Sign in first' (28000)
// and row security (42501) → 'denied'; failed casts and constraints (22xxx, 23xxx) and P0001 →
// 'invalid'; a wrong join code (P0002) → 'not-found'. Known differences: timestamps are 'Z' ISO
// strings with milliseconds (PostgREST sends '+00:00' and microseconds), JSON size limits are not
// checked, and an offline call never reaches the server (no request lost after it was applied).
import { EMPTY_BATCH, SyncError } from '../../app/src/sync/types';
import type {
  GroupPreview,
  GroupRow,
  LiveStatus,
  MemberRow,
  PushPayload,
  RemoteBatch,
  ShareRequest,
  SyncBackend,
} from '../../app/src/sync/types';
import type { ID, ISODateTime } from '../../app/src/types';

export interface ProfileRow {
  id: string;
  display_name: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

type Table = keyof RemoteBatch;
type AnyRow = RemoteBatch[Table][number];
type Rows = { [K in Table]: Map<string, RemoteBatch[K][number]> };

interface Db {
  profiles: Map<string, ProfileRow>;
  rows: Rows;
}

/** One write call. `now` is the transaction start (Postgres now()); `changes` go to Realtime after commit. */
interface Tx {
  db: Db;
  now: ISODateTime;
  uid: string | null;
  changes: { table: Table; row: AnyRow }[];
}

interface Phone {
  label: string;
  userId: string | null;
  online: boolean;
  /** Bumped on going offline, so updates queued before that are dropped instead of arriving late. */
  epoch: number;
  backend: (SyncBackend & { label: string }) | null;
}

interface Subscription {
  phone: Phone;
  onRows: (batch: RemoteBatch) => void;
  onStatus: (status: LiveStatus) => void;
  active: boolean;
}

const TABLES: Table[] = ['groups', 'members', 'expenses', 'payments', 'comments', 'activity'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PULL_OVERLAP_MS = 10000;
const START_MS = Date.UTC(2026, 9, 28, 9, 0, 0);

export class FakeServer {
  private db: Db = { profiles: new Map(), rows: emptyRows() };
  private readonly phones = new Map<string, Phone>();
  private subscriptions: Subscription[] = [];
  private readonly clock: () => number;
  /** Seeded, so ids and codes are the same on every run. */
  private seed = 20261028;
  private queued = 0;
  private callbackErrors: unknown[] = [];

  /** `clock` returns ms; by default every write is 1 ms after the previous one. */
  constructor(opts: { clock?: () => number } = {}) {
    let last = START_MS;
    this.clock = opts.clock ?? (() => (last += 1));
  }

  /** The simulated phone `label` (the same object on every call); it signs in as its own anonymous user. */
  backend(label: string): SyncBackend & { label: string } {
    const phone = this.phone(label);
    if (!phone.backend) {
      const call = <T>(run: () => T): Promise<T> => this.call(phone, run);
      phone.backend = {
        label,
        signIn: () => call(() => this.signIn(phone)),
        saveProfile: (displayName) => call(() => this.saveProfile(phone, displayName)),
        shareGroup: (request) => call(() => this.shareGroup(phone, copy(request))),
        previewGroup: (code) => call(() => this.previewGroup(phone, code)),
        joinGroup: (code, memberId, name) => call(() => this.joinGroup(phone, code, memberId, name)),
        leaveGroup: (groupId) => call(() => this.leaveGroup(phone, groupId)),
        resetJoinCode: (groupId, enabled) => call(() => this.resetJoinCode(phone, groupId, enabled)),
        push: (payload) => call(() => this.push(phone, copy(payload))),
        pull: (since) => call(() => this.pull(phone, copy(since))),
        subscribe: (onRows, onStatus) => this.subscribe(phone, onRows, onStatus),
      };
    }
    return phone.backend;
  }

  /** Offline: every call fails with SyncError('network') and live updates for the phone are dropped for good. */
  setOnline(label: string, online: boolean): void {
    const phone = this.phone(label);
    if (phone.online === online) return;
    phone.online = online;
    if (!online) phone.epoch += 1;
    const status: LiveStatus = online ? 'live' : 'offline';
    for (const sub of this.subscriptions) {
      if (sub.phone === phone) this.later(() => sub.active && sub.onStatus(status));
    }
  }

  /** The raw tables (copies), for assertions. */
  rows(): RemoteBatch {
    const out = copy(EMPTY_BATCH);
    for (const table of TABLES) (out[table] as AnyRow[]).push(...all(this.db.rows, table));
    return copy(out);
  }

  profiles(): ProfileRow[] {
    return copy([...this.db.profiles.values()]);
  }

  /** The phone's user id: null before signIn() and after deleteUser(). */
  userId(label: string): string | null {
    return this.phone(label).userId;
  }

  /**
   * The project owner deletes the phone's anonymous user (Authentication → Users), as after a
   * reinstall: the profile goes, its member rows become placeholders, and the phone is signed out.
   */
  deleteUser(label: string): void {
    const phone = this.phone(label);
    const uid = phone.userId;
    if (uid === null) return;
    phone.userId = null;
    // on delete cascade / set null; the updates fire the stamp triggers with no signed-in user.
    this.write(null, (tx) => {
      tx.db.profiles.delete(uid);
      for (const m of all(tx.db.rows, 'members')) {
        if (m.user_id === uid) this.save(tx, 'members', { ...m, user_id: null, updated_at: tx.now });
      }
      for (const g of all(tx.db.rows, 'groups')) {
        if (g.created_by === uid) this.save(tx, 'groups', { ...g, created_by: null, updated_at: tx.now, updated_by: null });
      }
    });
  }

  /** Waits until every queued live update and status has been delivered; rethrows the first error a callback threw. */
  async flush(): Promise<void> {
    for (let round = 0; this.queued > 0; round += 1) {
      if (round > 1000) throw new Error('FakeServer.flush(): live updates keep coming');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const errors = this.callbackErrors;
    this.callbackErrors = [];
    if (errors.length > 0) throw errors[0];
  }

  // ---------- Plumbing ----------

  private phone(label: string): Phone {
    let phone = this.phones.get(label);
    if (!phone) {
      phone = { label, userId: null, online: true, epoch: 0, backend: null };
      this.phones.set(label, phone);
    }
    return phone;
  }

  private call<T>(phone: Phone, run: () => T): Promise<T> {
    if (!phone.online) return Promise.reject(new SyncError('network', `${phone.label} is offline`));
    try {
      return Promise.resolve(copy(run()));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private user(phone: Phone): string {
    if (phone.userId === null) throw new SyncError('denied', 'Sign in first');
    return phone.userId;
  }

  /** Runs one transaction: all or nothing, one timestamp, Realtime after commit. */
  private write<T>(uid: string | null, run: (tx: Tx) => T): T {
    const tx: Tx = { db: cloneDb(this.db), now: new Date(this.clock()).toISOString(), uid, changes: [] };
    const result = run(tx);
    this.db = tx.db;
    this.publish(tx.changes);
    return result;
  }

  private save<K extends Table>(tx: Tx, table: K, row: RemoteBatch[K][number]): void {
    const key = table === 'members' ? memberKey((row as MemberRow).group_id, row.id) : row.id;
    tx.db.rows[table].set(key, row);
    tx.changes.push({ table, row });
  }

  /** Realtime: one event per written row, to every online subscriber whose row security allows it (the writer too). */
  private publish(changes: Tx['changes']): void {
    for (const change of changes) {
      for (const sub of this.subscriptions) {
        const { phone } = sub;
        if (!phone.online || phone.userId === null || !canSee(this.db.rows, phone.userId, change.table, change.row)) continue;
        const batch = copy(EMPTY_BATCH);
        (batch[change.table] as AnyRow[]).push(copy(change.row));
        const epoch = phone.epoch;
        this.later(() => sub.active && phone.online && phone.epoch === epoch && sub.onRows(batch));
      }
    }
  }

  private later(deliver: () => void): void {
    this.queued += 1;
    setTimeout(() => {
      this.queued -= 1;
      try {
        deliver();
      } catch (error) {
        this.callbackErrors.push(error);
      }
    }, 0);
  }

  private byte(): number {
    // mulberry32
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % 256;
  }

  /** gen_random_uuid(). */
  private uuid(): string {
    const bytes = Array.from({ length: 16 }, () => this.byte());
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** private.new_join_code(): 8 characters without look-alikes, unique across every group. */
  private newJoinCode(rows: Rows): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[this.byte() % CODE_ALPHABET.length];
      if (!all(rows, 'groups').some((g) => g.join_code === code)) return code;
    }
  }

  // ---------- Auth and profiles ----------

  private signIn(phone: Phone): string {
    if (phone.userId === null) phone.userId = this.uuid();
    return phone.userId;
  }

  private saveProfile(phone: Phone, displayName: string): void {
    const uid = this.user(phone);
    this.write(uid, (tx) => {
      const name = notNull(text(displayName), 'profiles', 'display_name');
      check(lengthIn(btrim(name), 1, 60), 'profiles', 'display_name length');
      const old = tx.db.profiles.get(uid);
      tx.db.profiles.set(uid, old
        ? { ...old, display_name: name, updated_at: tx.now }
        : { id: uid, display_name: name, created_at: tx.now, updated_at: tx.now });
    });
  }

  // ---------- The functions in setup.sql ----------

  private shareGroup(phone: Phone, request: ShareRequest): string {
    const uid = this.user(phone);
    const r: unknown = request;
    return this.write(uid, (tx) => {
      const me = text(field(r, 'me'));
      const members = elements(field(r, 'members') ?? undefined, 'p_members');
      if (me === null || !members.some((m) => text(field(m, 'id')) === me)) throw invalid('You must be one of the members');

      const g = field(r, 'group');
      const gid = notNull(text(field(g, 'id')), 'groups', 'id');
      if (tx.db.rows.groups.has(gid)) throw duplicateKey('groups_pkey');
      const code = this.newJoinCode(tx.db.rows);
      const group: GroupRow = {
        id: gid,
        name: notNull(text(field(g, 'name')), 'groups', 'name'),
        type: text(field(g, 'type')) ?? 'other',
        emoji: text(field(g, 'emoji')) ?? '👥',
        default_currency: text(field(g, 'defaultCurrency')) ?? 'INR',
        simplify_debts: bool(field(g, 'simplifyDebts')) ?? true,
        archived: bool(field(g, 'archived')) ?? false,
        join_code: code,
        join_enabled: true,
        created_by: uid,
        created_at: tx.now,
        updated_at: tx.now,
        updated_by: uid,
        deleted_at: null,
      };
      checkGroup(group);
      this.save(tx, 'groups', group);

      // Every row goes to this group whatever its own groupId says; only p_me gets your user id.
      for (const m of members) {
        const id = notNull(text(field(m, 'id')), 'group_members', 'id');
        const name = notNull(text(field(m, 'name')), 'group_members', 'name');
        this.insertMember(tx, {
          group_id: gid, id, user_id: id === me ? uid : null, name, color: text(field(m, 'color')),
          created_at: tx.now, updated_at: tx.now, left_at: null,
        });
      }
      // share_group inserts (id, group_id, data) only: deletedAt is not stored.
      for (const table of ['expenses', 'payments'] as const) {
        for (const x of elements(field(r, table) ?? undefined, `p_${table}`)) {
          const { id, data } = checkJson(table, text(field(x, 'id')), gid, field(x, 'data'));
          if (tx.db.rows[table].has(id)) throw duplicateKey(`${table}_pkey`);
          this.save(tx, table, { id, group_id: gid, data, created_at: tx.now, updated_at: tx.now, updated_by: uid, deleted_at: null });
        }
      }
      for (const x of elements(field(r, 'comments') ?? undefined, 'p_comments')) this.insertComment(tx, gid, x, 'error');
      return code;
    });
  }

  private push(phone: Phone, payload: PushPayload): Record<keyof PushPayload, number> {
    const uid = this.user(phone);
    const p: unknown = payload;
    return this.write(uid, (tx) => {
      const rows = tx.db.rows;
      // Row security and push_changes' own filter: rows for groups you are not (or no longer) in are skipped.
      const inGroup = (gid: string | null): gid is string => gid !== null && isMember(rows, gid, uid);

      let groups = 0;
      const updatedGroups = new Set<ID>();
      for (const x of elements(field(p, 'groups'), 'groups')) {
        const id = text(field(x, 'id'));
        const g = id === null ? undefined : rows.groups.get(id);
        // UPDATE … FROM: a group listed twice is updated once.
        if (!g || updatedGroups.has(g.id) || !inGroup(g.id)) continue;
        updatedGroups.add(g.id);
        const next: GroupRow = {
          ...g,
          name: text(field(x, 'name')) ?? g.name,
          type: text(field(x, 'type')) ?? g.type,
          emoji: text(field(x, 'emoji')) ?? g.emoji,
          default_currency: text(field(x, 'defaultCurrency')) ?? g.default_currency,
          simplify_debts: bool(field(x, 'simplifyDebts')) ?? g.simplify_debts,
          archived: bool(field(x, 'archived')) ?? g.archived,
          deleted_at: bool(field(x, 'deleted')) ? g.deleted_at ?? tx.now : g.deleted_at,
          updated_at: tx.now,
          updated_by: uid,
        };
        checkGroup(next);
        this.save(tx, 'groups', next);
        groups += 1;
      }

      let members = 0;
      const upsertedMembers = new Set<string>();
      for (const x of elements(field(p, 'members'), 'members')) {
        const gid = text(field(x, 'groupId'));
        if (!inGroup(gid)) continue;
        const id = notNull(text(field(x, 'id')), 'group_members', 'id');
        const name = notNull(text(field(x, 'name')), 'group_members', 'name');
        const color = text(field(x, 'color'));
        const key = memberKey(gid, id);
        const old = rows.members.get(key);
        // on conflict do update set name, color: user_id and left_at stay.
        const next: MemberRow = old
          ? { ...old, name, color, updated_at: tx.now }
          : { group_id: gid, id, user_id: null, name, color, created_at: tx.now, updated_at: tx.now, left_at: null };
        checkMember(next);
        if (upsertedMembers.has(key)) throw affectedTwice();
        upsertedMembers.add(key);
        this.save(tx, 'members', next);
        members += 1;
      }

      const upsertJson = (table: 'expenses' | 'payments'): number => {
        let count = 0;
        const upserted = new Set<ID>();
        for (const x of elements(field(p, table), table)) {
          const gid = text(field(x, 'groupId'));
          if (!inGroup(gid)) continue;
          const deletedAt = timestamp(field(x, 'deletedAt'));
          const { id, data } = checkJson(table, text(field(x, 'id')), gid, field(x, 'data'));
          if (upserted.has(id)) throw affectedTwice();
          const old = rows[table].get(id);
          // ... do update ... where group_id = excluded.group_id: an id already in another group is skipped.
          if (old && old.group_id !== gid) continue;
          upserted.add(id);
          this.save(tx, table, old
            ? { ...old, data, deleted_at: deletedAt, updated_at: tx.now, updated_by: uid }
            : { id, group_id: gid, data, created_at: tx.now, updated_at: tx.now, updated_by: uid, deleted_at: deletedAt });
          count += 1;
        }
        return count;
      };
      const expenses = upsertJson('expenses');
      const payments = upsertJson('payments');

      let comments = 0;
      for (const x of elements(field(p, 'comments'), 'comments')) {
        const gid = text(field(x, 'groupId'));
        if (inGroup(gid) && this.insertComment(tx, gid, x, 'nothing')) comments += 1;
      }

      let activity = 0;
      for (const x of elements(field(p, 'activity'), 'activity')) {
        const gid = text(field(x, 'groupId'));
        if (!inGroup(gid)) continue;
        const { id, data } = checkJson('activity', text(field(x, 'id')), gid, field(x, 'data'));
        if (rows.activity.has(id)) continue;
        this.save(tx, 'activity', { id, group_id: gid, data, created_at: tx.now, created_by: uid });
        activity += 1;
      }

      return { groups, members, expenses, payments, comments, activity };
    });
  }

  private previewGroup(phone: Phone, code: string): GroupPreview | null {
    this.user(phone);
    const group = findByCode(this.db.rows, code);
    if (!group) return null;
    const members = all(this.db.rows, 'members')
      .filter((m) => m.group_id === group.id && m.left_at === null)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || compareText(a.id, b.id))
      .map((m) => ({ id: m.id, name: m.name, claimed: m.user_id !== null }));
    return { id: group.id, name: group.name, emoji: group.emoji, members };
  }

  private joinGroup(phone: Phone, code: string, memberId: ID | null, name: string | null): { groupId: ID; memberId: ID } {
    const uid = this.user(phone);
    return this.write(uid, (tx) => {
      const group = findByCode(tx.db.rows, code);
      if (!group) throw new SyncError('not-found', "That code doesn't match a group");
      const members = all(tx.db.rows, 'members').filter((m) => m.group_id === group.id);

      // Already in, or back after leaving: the same row, whatever was asked for.
      const mine = members.find((m) => m.user_id === uid);
      if (mine) {
        this.save(tx, 'members', { ...mine, left_at: null, updated_at: tx.now });
        return { groupId: group.id, memberId: mine.id };
      }

      const claim = text(memberId);
      if (claim !== null) {
        const placeholder = members.find((m) => m.id === claim && m.user_id === null);
        if (!placeholder) throw invalid('Someone has already claimed that name');
        this.save(tx, 'members', { ...placeholder, user_id: uid, left_at: null, updated_at: tx.now });
        return { groupId: group.id, memberId: placeholder.id };
      }

      const profile = tx.db.profiles.get(uid);
      const display = btrim(text(name) ?? '') || (profile ? profile.display_name : 'Friend');
      // Random, not derived from the user id, so nobody can block a join with a placeholder of that id.
      const id = `u_${this.uuid().replace(/-/g, '')}`;
      this.insertMember(tx, {
        group_id: group.id, id, user_id: uid, name: Array.from(display).slice(0, 60).join(''), color: null,
        created_at: tx.now, updated_at: tx.now, left_at: null,
      });
      return { groupId: group.id, memberId: id };
    });
  }

  private leaveGroup(phone: Phone, groupId: ID): void {
    const uid = this.user(phone);
    this.write(uid, (tx) => {
      for (const m of all(tx.db.rows, 'members')) {
        if (m.group_id === groupId && m.user_id === uid && m.left_at === null) {
          this.save(tx, 'members', { ...m, left_at: tx.now, updated_at: tx.now });
        }
      }
    });
  }

  private resetJoinCode(phone: Phone, groupId: ID, enabled: boolean): string {
    const uid = this.user(phone);
    return this.write(uid, (tx) => {
      if (!isMember(tx.db.rows, groupId, uid)) throw new SyncError('denied', 'You are not in this group');
      const code = this.newJoinCode(tx.db.rows);
      const group = tx.db.rows.groups.get(groupId);
      if (group) {
        const joinEnabled = notNull(bool(enabled), 'groups', 'join_enabled');
        this.save(tx, 'groups', { ...group, join_code: code, join_enabled: joinEnabled, updated_at: tx.now, updated_by: uid });
      }
      return code;
    });
  }

  // ---------- Reads ----------

  private pull(phone: Phone, since: Record<ID, ISODateTime | null>): RemoteBatch {
    const uid = this.user(phone);
    const after = new Map<ID, number>();
    for (const gid of Object.keys(since)) {
      const cursor = text(since[gid]);
      const ms = cursor === null ? -Infinity : Date.parse(cursor) - PULL_OVERLAP_MS;
      if (Number.isNaN(ms)) throw invalid(`invalid input syntax for type timestamp with time zone: "${cursor}"`);
      after.set(gid, ms);
    }
    const rows = this.db.rows;
    const batch = copy(EMPTY_BATCH);
    for (const table of TABLES) {
      const found = all(rows, table)
        .filter((row) => {
          const min = after.get(groupIdOf(row));
          return min !== undefined && Date.parse(stampOf(row)) > min && canSee(rows, uid, table, row);
        })
        .sort((a, b) => Date.parse(stampOf(a)) - Date.parse(stampOf(b)) || compareText(a.id, b.id));
      (batch[table] as AnyRow[]).push(...copy(found));
    }
    return batch;
  }

  private subscribe(phone: Phone, onRows: (batch: RemoteBatch) => void, onStatus: (status: LiveStatus) => void): () => void {
    const sub: Subscription = { phone, onRows, onStatus, active: true };
    this.subscriptions.push(sub);
    const status: LiveStatus = phone.online ? 'live' : 'offline';
    this.later(() => sub.active && sub.onStatus(status));
    return () => {
      sub.active = false;
      this.subscriptions = this.subscriptions.filter((s) => s !== sub);
    };
  }

  // ---------- Inserts shared by several functions ----------

  /** A plain insert (share_group, join_group): duplicates are errors. */
  private insertMember(tx: Tx, row: MemberRow): void {
    checkMember(row);
    if (tx.db.rows.members.has(memberKey(row.group_id, row.id))) throw duplicateKey('group_members_pkey');
    if (row.user_id !== null && all(tx.db.rows, 'members').some((m) => m.group_id === row.group_id && m.user_id === row.user_id)) {
      throw duplicateKey('group_members_one_row_per_user');
    }
    this.save(tx, 'members', row);
  }

  /** Returns false when the id exists and `onConflict` is 'nothing' (push_changes); share_group has no on conflict. */
  private insertComment(tx: Tx, gid: ID, x: unknown, onConflict: 'nothing' | 'error'): boolean {
    // Row security is checked before the conflict, so even a repeat send needs the expense in this group.
    const expenseId = text(field(x, 'expenseId'));
    const expense = expenseId === null ? undefined : tx.db.rows.expenses.get(expenseId);
    if (!expense || expense.group_id !== gid) throw new SyncError('denied', 'new row violates row-level security policy for table "comments"');
    const { id, data } = checkJson('comments', text(field(x, 'id')), null, field(x, 'data'));
    if (tx.db.rows.comments.has(id)) {
      if (onConflict === 'error') throw duplicateKey('comments_pkey');
      return false;
    }
    this.save(tx, 'comments', { id, group_id: gid, expense_id: expense.id, data, created_at: tx.now, created_by: tx.uid, deleted_at: null });
    return true;
  }
}

// ---------- Row security ----------

/** private.is_member: a current (not left) member. */
function isMember(rows: Rows, gid: ID, uid: string): boolean {
  return all(rows, 'members').some((m) => m.group_id === gid && m.user_id === uid && m.left_at === null);
}

/** private.is_creator: true only inside share_group before the creator's own row exists. */
function isCreator(rows: Rows, gid: ID, uid: string): boolean {
  const group = rows.groups.get(gid);
  return !!group && group.created_by === uid && !all(rows, 'members').some((m) => m.group_id === gid && m.user_id === uid);
}

/** The select policies, used for pulls and Realtime. Your own member row stays visible after leaving. */
function canSee(rows: Rows, uid: string, table: Table, row: AnyRow): boolean {
  const gid = groupIdOf(row);
  if (isMember(rows, gid, uid) || ((table === 'groups' || table === 'members') && isCreator(rows, gid, uid))) return true;
  return table === 'members' && (row as MemberRow).user_id === uid;
}

// ---------- Constraints and casts ----------

function invalid(message: string): SyncError {
  return new SyncError('invalid', message);
}

function duplicateKey(constraint: string): SyncError {
  return invalid(`duplicate key value violates unique constraint "${constraint}"`);
}

function affectedTwice(): SyncError {
  return invalid('ON CONFLICT DO UPDATE command cannot affect row a second time');
}

function check(ok: boolean, table: string, rule: string): void {
  if (!ok) throw invalid(`new row for relation "${table}" violates check constraint (${rule})`);
}

function notNull<T>(value: T | null, table: string, column: string): T {
  if (value === null) throw invalid(`null value in column "${column}" of relation "${table}" violates not-null constraint`);
  return value;
}

function checkGroup(g: GroupRow): void {
  check(lengthIn(g.id, 1, 64), 'groups', 'id length');
  check(lengthIn(btrim(g.name), 1, 60), 'groups', 'name length');
  check(lengthIn(g.type, 1, 20), 'groups', 'type length');
  check(lengthIn(g.emoji, 1, 16), 'groups', 'emoji length');
  check(lengthIn(g.default_currency, 3, 3), 'groups', 'default_currency length');
}

function checkMember(m: MemberRow): void {
  check(lengthIn(m.id, 1, 64), 'group_members', 'id length');
  check(lengthIn(btrim(m.name), 1, 60), 'group_members', 'name length');
  check(m.color === null || lengthIn(m.color, 0, 16), 'group_members', 'color length');
}

/** The NOT NULL and CHECK constraints of a JSON row; groupId null = no group check (comments). */
function checkJson(table: Table, id: string | null, groupId: string | null, data: unknown): { id: string; data: Record<string, unknown> } {
  const rowId = notNull(id, table, 'id');
  check(lengthIn(rowId, 1, 64), table, 'id length');
  if (data === undefined) throw invalid(`null value in column "data" of relation "${table}" violates not-null constraint`);
  if (!isObject(data)) throw invalid(`new row for relation "${table}" violates check constraint (data is an object)`);
  check((text(data.id) ?? rowId) === rowId, table, 'data.id = id');
  if (groupId !== null) check((text(data.groupId) ?? groupId) === groupId, table, 'data.groupId = group_id');
  return { id: rowId, data };
}

/** char_length counts characters, not UTF-16 units. */
function lengthIn(s: string, min: number, max: number): boolean {
  const n = Array.from(s).length;
  return n >= min && n <= max;
}

/** Postgres btrim() without a second argument trims spaces only. */
function btrim(s: string): string {
  return s.replace(/^ +| +$/g, '');
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------- JSON as Postgres reads it ----------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** json -> key */
function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

/** json ->> key: null for a missing key or JSON null. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** (json ->> key)::boolean */
function bool(value: unknown): boolean | null {
  const s = text(value);
  if (s === null) return null;
  const t = s.trim().toLowerCase();
  if (['t', 'true', 'y', 'yes', 'on', '1'].includes(t)) return true;
  if (['f', 'false', 'n', 'no', 'off', '0'].includes(t)) return false;
  throw invalid(`invalid input syntax for type boolean: "${s}"`);
}

/** (json ->> key)::timestamptz */
function timestamp(value: unknown): ISODateTime | null {
  const s = text(value);
  if (s === null) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw invalid(`invalid input syntax for type timestamp with time zone: "${s}"`);
  return new Date(ms).toISOString();
}

/** jsonb_array_elements(coalesce(value, '[]')): a missing list is empty, anything but an array fails. */
function elements(value: unknown, name: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(`cannot extract elements from ${name}: not an array`);
  return value;
}

/** A JSON round trip, like the network: callers never share objects with the server. */
function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

// ---------- Tables ----------

function emptyRows(): Rows {
  return { groups: new Map(), members: new Map(), expenses: new Map(), payments: new Map(), comments: new Map(), activity: new Map() };
}

function cloneDb(db: Db): Db {
  // Rows are replaced, never changed in place, so copying the maps is enough.
  const rows = db.rows;
  return {
    profiles: new Map(db.profiles),
    rows: {
      groups: new Map(rows.groups),
      members: new Map(rows.members),
      expenses: new Map(rows.expenses),
      payments: new Map(rows.payments),
      comments: new Map(rows.comments),
      activity: new Map(rows.activity),
    },
  };
}

function all<K extends Table>(rows: Rows, table: K): RemoteBatch[K][number][] {
  return [...rows[table].values()];
}

function memberKey(groupId: ID, id: ID): string {
  return `${groupId}\n${id}`;
}

function groupIdOf(row: AnyRow): ID {
  return 'group_id' in row ? row.group_id : row.id;
}

/** updated_at, or created_at for insert-only tables (comments, activity). */
function stampOf(row: AnyRow): ISODateTime {
  return 'updated_at' in row ? row.updated_at : row.created_at;
}

function findByCode(rows: Rows, code: unknown): GroupRow | undefined {
  const wanted = text(code);
  if (wanted === null) return undefined;
  const normal = btrim(wanted).toUpperCase();
  return all(rows, 'groups').find((g) => g.join_code === normal && g.join_enabled && g.deleted_at === null);
}
