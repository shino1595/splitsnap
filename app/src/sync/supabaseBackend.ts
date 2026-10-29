// The real SyncBackend: supabase/setup.sql through supabase-js (docs/SYNC_DESIGN.md §1). Writes go
// only through the SQL functions; reads are plain selects and one Realtime channel, and row
// security decides which rows come back.
import type { ID, ISODateTime } from '../types';
import type { SyncTimers } from './engine';
import { ensureSignedIn, loadSupabase } from './supabaseClient';
import { SyncError, type GroupPreview, type PushPayload, type RemoteBatch, type SyncBackend } from './types';

type Client = Awaited<ReturnType<typeof loadSupabase>>;
type Channel = ReturnType<Client['channel']>;
type Rows = Record<keyof RemoteBatch, unknown[]>;

export interface SupabaseBackendOptions {
  /** Defaults to loadSupabase; the tests pass a fake client. */
  load?: () => Promise<Client>;
  timers?: SyncTimers;
}

/** What a supabase-js query or rpc resolves to (status 0 = no response at all). */
interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
  status: number;
}

/** A Realtime 'system' message; the postgres_changes one says whether the change stream started. */
interface SystemMessage {
  extension?: string;
  status?: string;
  message?: string;
}

interface Table {
  name: string;
  key: keyof RemoteBatch;
  /** groups are matched on their own id, everything else on group_id. */
  groupColumn: string;
  /** comments and activity are insert-only, so they have no updated_at (§5). */
  timeColumn: string;
}

const TABLES: Table[] = [
  { name: 'groups', key: 'groups', groupColumn: 'id', timeColumn: 'updated_at' },
  { name: 'group_members', key: 'members', groupColumn: 'group_id', timeColumn: 'updated_at' },
  { name: 'expenses', key: 'expenses', groupColumn: 'group_id', timeColumn: 'updated_at' },
  { name: 'payments', key: 'payments', groupColumn: 'group_id', timeColumn: 'updated_at' },
  { name: 'comments', key: 'comments', groupColumn: 'group_id', timeColumn: 'created_at' },
  { name: 'activity', key: 'activity', groupColumn: 'group_id', timeColumn: 'created_at' },
];

const PAGE_SIZE = 500;
const OVERLAP_MS = 10000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
/** After SUBSCRIBED, how long to wait for the server to confirm the change stream (§5). */
const READY_WAIT_MS = 10000;
const NO_CONNECTION = 'No connection to the server.';
const SIGNED_OUT = 'Signed out — changes will be sent when you are signed in again';

const REAL_TIMERS: SyncTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let channelCount = 0;

function emptyRows(): Rows {
  return { groups: [], members: [], expenses: [], payments: [], comments: [], activity: [] };
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** Maps a PostgREST error to the engine's retry / drop / show decision (see SyncError). */
export function toSyncError(error: { message?: string; code?: string } | null, status: number): SyncError {
  const code = (error && error.code) || '';
  const message = (error && error.message) || 'The server could not complete the request.';
  if (status === 0) return new SyncError('network', NO_CONNECTION);
  if (status >= 500 || status === 408 || status === 429) return new SyncError('network', message);
  // PGRST3xx = expired or unreadable token: not a permission answer, the session refreshes.
  if (code.indexOf('PGRST3') === 0) return new SyncError('network', message);
  // 28000 ('Sign in first') and 401 (no session, so the anon role; PostgREST answers 42501 with
  // 401 then) say nothing about these rows: 'denied' would drop changes that only wait for a sign-in.
  if (code === '28000' || status === 401) return new SyncError('network', message);
  if (code === '42501' || status === 403) return new SyncError('denied', message);
  if (code === 'P0002') return new SyncError('not-found', message);
  return new SyncError('invalid', message);
}

async function run(request: PromiseLike<Result>): Promise<unknown> {
  let result: Result;
  try {
    result = await request;
  } catch (error) {
    throw new SyncError('network', messageOf(error)); // the request never got an answer
  }
  if (result.error) throw toSyncError(result.error, result.status);
  return result.data;
}

async function connect(load: () => Promise<Client>): Promise<Client> {
  try {
    return await load();
  } catch (error) {
    // 'network' keeps queued changes for later instead of dropping them.
    throw new SyncError('network', messageOf(error));
  }
}

async function userId(client: Client): Promise<string> {
  try {
    return await ensureSignedIn(client);
  } catch (error) {
    // ensureSignedIn hides the HTTP status; a failed anonymous sign-in is always safe to retry.
    throw new SyncError('network', messageOf(error));
  }
}

/**
 * push and pull never sign in themselves. Without a session supabase-js sends the anon key,
 * which the server refuses like a stranger, and the engine would drop the changes as "not in
 * this group any more"; 'network' keeps them until a share or join signs in again.
 */
async function requireSession(client: Client): Promise<void> {
  let signedIn = false;
  try {
    const { data } = await client.auth.getSession();
    signedIn = !!data.session;
  } catch (error) {
    throw new SyncError('network', messageOf(error));
  }
  if (!signedIn) throw new SyncError('network', SIGNED_OUT);
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new SyncError('invalid', `The server sent no ${what}.`);
  return value;
}

/** `since` minus the 10-second overlap (§5) as ISO text; null = from the beginning. */
export function overlapStart(since: ISODateTime | null): string | null {
  if (!since) return null;
  // Postgres text ('2026-10-28 10:00:00.123456+00') → what every JS engine parses.
  const iso = since.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d\d)$/, '$1:00');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms - OVERLAP_MS).toISOString() : null;
}

async function pullTable(client: Client, table: Table, groupId: ID, after: string | null): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (;;) {
    let query = client.from(table.name).select('*').eq(table.groupColumn, groupId);
    if (after) query = query.gt(table.timeColumn, after);
    const page = await run(query.order(table.timeColumn).order('id').range(rows.length, rows.length + PAGE_SIZE - 1));
    const list = Array.isArray(page) ? page : [];
    rows.push(...list);
    if (list.length < PAGE_SIZE) return rows;
  }
}

export function createSupabaseBackend(options: SupabaseBackendOptions = {}): SyncBackend {
  const load = options.load || loadSupabase;
  const timers = options.timers || REAL_TIMERS;
  return {
    async signIn() {
      return userId(await connect(load));
    },

    async saveProfile(displayName) {
      const client = await connect(load);
      const id = await userId(client);
      await run(client.from('profiles').upsert({ id, display_name: displayName }));
    },

    async shareGroup(request) {
      const client = await connect(load);
      const code = await run(
        client.rpc('share_group', {
          p_group: request.group,
          p_members: request.members,
          p_expenses: request.expenses,
          p_payments: request.payments,
          p_comments: request.comments,
          p_me: request.me,
        }),
      );
      return text(code, 'join code');
    },

    async previewGroup(code) {
      const client = await connect(load);
      const preview = await run(client.rpc('preview_group', { p_code: code }));
      // Built by the server from its own columns, so only "no match" (null) needs checking.
      return preview && typeof preview === 'object' ? (preview as GroupPreview) : null;
    },

    async joinGroup(code, memberId, name) {
      const client = await connect(load);
      const result = await run(client.rpc('join_group', { p_code: code, p_member_id: memberId, p_name: name }));
      const joined = result as { groupId?: unknown; memberId?: unknown } | null;
      return { groupId: text(joined && joined.groupId, 'group id'), memberId: text(joined && joined.memberId, 'member id') };
    },

    async leaveGroup(groupId) {
      const client = await connect(load);
      await run(client.rpc('leave_group', { p_group_id: groupId }));
    },

    async resetJoinCode(groupId, enabled) {
      const client = await connect(load);
      return text(await run(client.rpc('reset_join_code', { p_group_id: groupId, p_enabled: enabled })), 'join code');
    },

    async push(payload) {
      const client = await connect(load);
      await requireSession(client);
      const written = ((await run(client.rpc('push_changes', { p: payload }))) || {}) as Record<string, unknown>;
      const count = (kind: keyof PushPayload) => (typeof written[kind] === 'number' ? (written[kind] as number) : 0);
      return {
        groups: count('groups'),
        members: count('members'),
        expenses: count('expenses'),
        payments: count('payments'),
        comments: count('comments'),
        activity: count('activity'),
      };
    },

    async pull(since) {
      const client = await connect(load);
      await requireSession(client);
      const perGroup = await Promise.all(
        Object.keys(since).map((groupId) => {
          const after = overlapStart(since[groupId]);
          return Promise.all(TABLES.map((table) => pullTable(client, table, groupId, after)));
        }),
      );
      const batch = emptyRows();
      perGroup.forEach((lists) => TABLES.forEach((table, i) => {
        batch[table.key] = batch[table.key].concat(lists[i]);
      }));
      return batch as RemoteBatch;
    },

    subscribe(onRows, onStatus) {
      let stopped = false;
      let client: Client | null = null;
      let channel: Channel | null = null;
      let timer: unknown = null;
      let readyTimer: unknown = null;
      let delay = RETRY_MIN_MS;

      const drop = () => {
        if (readyTimer !== null) timers.clearTimeout(readyTimer);
        readyTimer = null;
        const old = channel;
        channel = null; // first, so the CLOSED that removing it reports is ignored
        if (old && client) void client.removeChannel(old);
      };
      const retry = () => {
        if (stopped || timer !== null) return;
        drop();
        onStatus('offline');
        timer = timers.setTimeout(() => {
          timer = null;
          void open();
        }, delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      };
      const open = async () => {
        try {
          client = await load();
          if (stopped) return;
          // The join carries the token the socket holds when it is sent: fetch the session's now,
          // or the server joins us as the anon role and sends us no rows.
          await client.realtime.setAuth();
        } catch {
          retry();
          return;
        }
        if (stopped) return;
        // A fresh topic each time: a channel still being removed can't be handed back to us.
        channelCount += 1;
        const next = client.channel(`splitsnap-sync-${channelCount}`);
        for (const table of TABLES) {
          next.on('postgres_changes', { event: '*', schema: 'public', table: table.name }, (payload) => {
            // Deletes are soft (an UPDATE); a hard delete only comes from a cascade and has no new row.
            if (stopped || payload.eventType === 'DELETE') return;
            const batch = emptyRows();
            batch[table.key] = [payload.new];
            onRows(batch as RemoteBatch);
          });
        }
        // SUBSCRIBED only means the join reply came. The server starts the change stream later
        // (seconds later on a cold project) and confirms it with a system message; changes made
        // before that never arrive. So the channel counts as live, and the engine pulls, after both.
        let joined = false;
        let confirmed = false;
        let live = false;
        const goLive = () => {
          if (live) return;
          live = true;
          if (readyTimer !== null) timers.clearTimeout(readyTimer);
          readyTimer = null;
          delay = RETRY_MIN_MS;
          onStatus('live');
        };
        next.on('system', {}, (payload: SystemMessage) => {
          if (stopped || channel !== next || payload.extension !== 'postgres_changes') return;
          if (payload.status === 'error') {
            console.warn(`[sync] The server refused live updates: ${payload.message}`);
            retry();
          } else if (payload.status === 'ok') {
            if (live && !confirmed) {
              // The fallback went live before the stream started: going live again makes the
              // engine pull what changed in between.
              onStatus('connecting');
              onStatus('live');
            }
            confirmed = true;
            if (joined) goLive();
          }
        });
        channel = next;
        next.subscribe((status: string) => {
          if (stopped || channel !== next) return;
          if (status !== 'SUBSCRIBED') return retry();
          joined = true;
          if (confirmed) return goLive();
          // A server that never sends the confirmation: go live without it after a while.
          if (readyTimer === null) {
            readyTimer = timers.setTimeout(() => {
              readyTimer = null;
              if (!stopped && channel === next) goLive();
            }, READY_WAIT_MS);
          }
        });
      };

      onStatus('connecting');
      void open();
      return () => {
        stopped = true;
        if (timer !== null) timers.clearTimeout(timer);
        timer = null;
        drop();
      };
    },
  };
}
