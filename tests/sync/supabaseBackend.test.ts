// The parts of the real backend that decide what the engine does next. toSyncError: whether a
// change is retried or dropped, so a missing session must never read as a refusal. subscribe():
// when the live channel counts as live (only after the server confirms the change stream). These
// tests never load supabase-js: subscribe() runs on a fake client and fake timers.
import type { SyncTimers } from '../../app/src/sync/engine';
import { createSupabaseBackend, toSyncError } from '../../app/src/sync/supabaseBackend';
import type { LiveStatus, RemoteBatch } from '../../app/src/sync/types';

describe('toSyncError', () => {
  it('retries when there is no answer, a server problem or no valid session', () => {
    expect(toSyncError(null, 0).kind).toBe('network');
    expect(toSyncError({ message: 'Bad gateway' }, 502).kind).toBe('network');
    expect(toSyncError({ message: 'Too many requests' }, 429).kind).toBe('network');
    expect(toSyncError({ message: 'JWT expired', code: 'PGRST301' }, 401).kind).toBe('network');
    expect(toSyncError({ message: 'Sign in first', code: '28000' }, 400).kind).toBe('network');
    // Signed out: the anon role is refused with 42501, but PostgREST answers 401.
    expect(toSyncError({ message: 'permission denied for function push_changes', code: '42501' }, 401)).toMatchObject({
      kind: 'network',
      message: 'permission denied for function push_changes',
    });
  });

  it('keeps refusals of the rows themselves as denied, not found or invalid', () => {
    expect(toSyncError({ message: 'You are not in this group', code: '42501' }, 403).kind).toBe('denied');
    expect(toSyncError({ message: 'new row violates row-level security policy', code: '42501' }, 403).kind).toBe('denied');
    expect(toSyncError({ message: "That code doesn't match a group", code: 'P0002' }, 400).kind).toBe('not-found');
    expect(toSyncError({ message: 'You must be one of the members', code: '22023' }, 400).kind).toBe('invalid');
    expect(toSyncError({ message: 'duplicate key value violates unique constraint "groups_pkey"', code: '23505' }, 409).kind).toBe('invalid');
  });
});

// ---------- subscribe() ----------

/** The server's confirmation, as supabase-js 2.118 hands it to .on('system', {}, cb). */
const STREAM_OK = { message: 'Subscribed to PostgreSQL', status: 'ok', extension: 'postgres_changes', channel: 'splitsnap-sync' };
/** A refused subscription (e.g. a filter on a column the role can't read). */
const STREAM_ERROR = {
  message: 'Unable to subscribe to changes with given parameters.',
  status: 'error',
  extension: 'postgres_changes',
  channel: 'splitsnap-sync',
};

class FakeTimers implements SyncTimers {
  now = 0;
  private seq = 0;
  private queue: { id: number; at: number; run: () => void }[] = [];

  setTimeout = (run: () => void, ms: number): unknown => {
    this.seq += 1;
    this.queue.push({ id: this.seq, at: this.now + ms, run });
    return this.seq;
  };

  clearTimeout = (handle: unknown): void => {
    this.queue = this.queue.filter((t) => t.id !== handle);
  };

  get pending(): number {
    return this.queue.length;
  }

  /** Runs every timer due within `ms` (including ones they set), in time order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.queue.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.queue = this.queue.filter((t) => t !== due);
      this.now = due.at;
      due.run();
    }
    this.now = end;
  }
}

type Listener = (payload: unknown) => void;

/** A RealtimeChannel that records its bindings; the test plays the server. */
class FakeChannel {
  bindings: { type: string; filter: { table?: string }; listener: Listener }[] = [];
  removed = false;
  private onStatus: ((status: string) => void) | null = null;

  constructor(
    readonly name: string,
    private readonly log: string[],
  ) {}

  on = (type: string, filter: { table?: string }, listener: Listener): FakeChannel => {
    this.bindings.push({ type, filter, listener });
    return this;
  };

  subscribe = (callback: (status: string) => void): FakeChannel => {
    this.log.push(`subscribe ${this.name}`);
    this.onStatus = callback;
    return this;
  };

  /** What the subscribe callback hears: SUBSCRIBED, CHANNEL_ERROR, CLOSED… */
  status(status: string): void {
    if (this.onStatus) this.onStatus(status);
  }

  system(payload: object): void {
    for (const b of this.bindings) if (b.type === 'system') b.listener(payload);
  }

  change(table: string, eventType: string, row: object): void {
    for (const b of this.bindings) {
      if (b.type === 'postgres_changes' && b.filter.table === table) b.listener({ eventType, new: row, old: {} });
    }
  }
}

/** Only what subscribe() uses of a SupabaseClient. */
class FakeClient {
  log: string[] = [];
  channels: FakeChannel[] = [];
  /** Replace to make setAuth fail or wait. */
  auth: () => Promise<void> = () => Promise.resolve();

  realtime = {
    setAuth: (): Promise<void> => {
      this.log.push('setAuth');
      return this.auth();
    },
  };

  channel = (name: string): FakeChannel => {
    const channel = new FakeChannel(name, this.log);
    this.channels.push(channel);
    return channel;
  };

  removeChannel = (channel: FakeChannel): Promise<string> => {
    channel.removed = true;
    this.log.push(`remove ${channel.name}`);
    channel.status('CLOSED'); // like realtime-js: removing a channel closes it
    return Promise.resolve('ok');
  };

  get last(): FakeChannel {
    return this.channels[this.channels.length - 1];
  }
}

/** Lets open() get past its awaits (load, setAuth). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function subscribed() {
  const client = new FakeClient();
  const timers = new FakeTimers();
  const statuses: LiveStatus[] = [];
  const batches: RemoteBatch[] = [];
  const backend = createSupabaseBackend({ load: () => Promise.resolve(client as never), timers });
  const stop = backend.subscribe(
    (batch) => batches.push(batch),
    (status) => statuses.push(status),
  );
  await settle();
  return { client, timers, statuses, batches, stop };
}

describe('subscribe', () => {
  it('goes live only once the server confirms the change stream, not on SUBSCRIBED alone', async () => {
    const { client, statuses } = await subscribed();
    expect(client.channels).toHaveLength(1);
    client.last.status('SUBSCRIBED');
    expect(statuses).toEqual(['connecting']);
    client.last.system(STREAM_OK);
    expect(statuses).toEqual(['connecting', 'live']);
    client.last.system(STREAM_OK); // a repeat changes nothing
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('goes live on SUBSCRIBED when the confirmation came first', async () => {
    const { client, statuses } = await subscribed();
    client.last.system(STREAM_OK);
    expect(statuses).toEqual(['connecting']);
    client.last.status('SUBSCRIBED');
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('drops the channel on a system error and opens a new one after the backoff', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client, timers, statuses } = await subscribed();
    const first = client.last;
    first.status('SUBSCRIBED');
    first.system(STREAM_ERROR);
    expect(statuses).toEqual(['connecting', 'offline']);
    expect(first.removed).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Unable to subscribe to changes');
    expect(timers.pending).toBe(1); // only the retry: no readiness timer left behind

    timers.advance(999);
    await settle();
    expect(client.channels).toHaveLength(1);
    timers.advance(1);
    await settle();
    expect(client.channels).toHaveLength(2);
    expect(client.last.name).not.toBe(first.name);
    expect(client.log).toEqual(['setAuth', `subscribe ${first.name}`, `remove ${first.name}`, 'setAuth', `subscribe ${client.last.name}`]);

    client.last.status('SUBSCRIBED');
    client.last.system(STREAM_OK);
    expect(statuses).toEqual(['connecting', 'offline', 'live']);
  });

  it('backs off longer after each failure and starts again from 1 s once live', async () => {
    const { client, timers, statuses } = await subscribed();
    client.last.status('CHANNEL_ERROR');
    timers.advance(1000);
    await settle();
    client.last.status('TIMED_OUT');
    timers.advance(1999);
    await settle();
    expect(client.channels).toHaveLength(2);
    timers.advance(1);
    await settle();
    expect(client.channels).toHaveLength(3);

    client.last.status('SUBSCRIBED');
    client.last.system(STREAM_OK);
    client.last.status('CHANNEL_ERROR');
    timers.advance(1000);
    await settle();
    expect(client.channels).toHaveLength(4);
    expect(statuses).toEqual(['connecting', 'offline', 'offline', 'live', 'offline']);
  });

  it('keeps backing off while joins succeed but the stream does not start', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client, timers, statuses } = await subscribed();
    client.last.status('SUBSCRIBED');
    client.last.system(STREAM_ERROR);
    timers.advance(1000);
    await settle();
    expect(client.channels).toHaveLength(2);

    // Neither SUBSCRIBED nor the confirmation alone is live, so neither resets the delay.
    client.last.status('SUBSCRIBED');
    client.last.system(STREAM_ERROR);
    timers.advance(1999);
    await settle();
    expect(client.channels).toHaveLength(2);
    timers.advance(1);
    await settle();
    expect(client.channels).toHaveLength(3);

    client.last.system(STREAM_OK);
    client.last.status('CHANNEL_ERROR');
    timers.advance(3999);
    await settle();
    expect(client.channels).toHaveLength(3);
    timers.advance(1);
    await settle();
    expect(client.channels).toHaveLength(4);
    expect(statuses).toEqual(['connecting', 'offline', 'offline', 'offline']);
  });

  it('goes live without a confirmation 10 s after SUBSCRIBED (a server that never sends one)', async () => {
    const { client, timers, statuses } = await subscribed();
    timers.advance(60000); // nothing waits before SUBSCRIBED
    expect(statuses).toEqual(['connecting']);
    client.last.status('SUBSCRIBED');
    timers.advance(9999);
    expect(statuses).toEqual(['connecting']);
    timers.advance(1);
    expect(statuses).toEqual(['connecting', 'live']);
    // A late confirmation goes live again, so the engine pulls what changed before the stream started.
    client.last.system(STREAM_OK);
    expect(statuses).toEqual(['connecting', 'live', 'connecting', 'live']);
    client.last.system(STREAM_OK); // a repeat changes nothing
    expect(statuses).toEqual(['connecting', 'live', 'connecting', 'live']);
    expect(timers.pending).toBe(0);
  });

  it('cancels the 10 s fallback once the confirmation comes', async () => {
    const { client, timers, statuses } = await subscribed();
    client.last.status('SUBSCRIBED');
    timers.advance(3000);
    client.last.system(STREAM_OK);
    expect(statuses).toEqual(['connecting', 'live']);
    expect(timers.pending).toBe(0);
  });

  it('ignores everything from a channel it dropped', async () => {
    const { client, timers, statuses } = await subscribed();
    const old = client.last;
    old.status('SUBSCRIBED');
    old.status('CHANNEL_ERROR');
    expect(statuses).toEqual(['connecting', 'offline']);
    expect(timers.pending).toBe(1); // the readiness timer went with the channel
    old.system(STREAM_OK);
    old.system(STREAM_ERROR);
    old.status('SUBSCRIBED');
    old.status('CLOSED');
    expect(statuses).toEqual(['connecting', 'offline']);

    timers.advance(1000);
    await settle();
    const next = client.last;
    expect(next).not.toBe(old);
    old.system(STREAM_OK);
    old.status('CHANNEL_ERROR');
    next.status('SUBSCRIBED');
    expect(statuses).toEqual(['connecting', 'offline']);
    next.system(STREAM_OK);
    expect(statuses).toEqual(['connecting', 'offline', 'live']);
  });

  it('stops everything when unsubscribed', async () => {
    const { client, timers, statuses, batches, stop } = await subscribed();
    const channel = client.last;
    channel.status('SUBSCRIBED');
    stop();
    expect(channel.removed).toBe(true);
    expect(timers.pending).toBe(0); // the readiness timer is gone too
    channel.system(STREAM_OK);
    channel.status('CHANNEL_ERROR');
    channel.change('expenses', 'UPDATE', { id: 'exp_1' });
    timers.advance(60000);
    await settle();
    expect(statuses).toEqual(['connecting']);
    expect(batches).toEqual([]);
    expect(client.channels).toHaveLength(1);
  });

  it('stops a retry that is waiting, and an open that is still fetching the token', async () => {
    const waiting = await subscribed();
    waiting.client.last.status('CHANNEL_ERROR');
    waiting.stop();
    waiting.timers.advance(60000);
    await settle();
    expect(waiting.client.channels).toHaveLength(1);
    expect(waiting.statuses).toEqual(['connecting', 'offline']);

    const client = new FakeClient();
    let finishAuth: () => void = () => undefined;
    client.auth = () => new Promise<void>((resolve) => (finishAuth = resolve));
    const statuses: LiveStatus[] = [];
    const stop = createSupabaseBackend({ load: () => Promise.resolve(client as never), timers: new FakeTimers() }).subscribe(
      () => undefined,
      (status) => statuses.push(status),
    );
    await settle();
    stop();
    finishAuth();
    await settle();
    expect(client.channels).toHaveLength(0);
    expect(statuses).toEqual(['connecting']);
  });

  it('refreshes the token before it joins, and retries when that fails', async () => {
    const client = new FakeClient();
    const timers = new FakeTimers();
    let finishAuth: () => void = () => undefined;
    client.auth = () => new Promise<void>((resolve) => (finishAuth = resolve));
    const statuses: LiveStatus[] = [];
    createSupabaseBackend({ load: () => Promise.resolve(client as never), timers }).subscribe(
      () => undefined,
      (status) => statuses.push(status),
    );
    await settle();
    expect(client.log).toEqual(['setAuth']);
    expect(client.channels).toHaveLength(0); // no channel until the token is in place
    finishAuth();
    await settle();
    expect(client.log).toEqual(['setAuth', `subscribe ${client.last.name}`]);

    client.last.status('CHANNEL_ERROR');
    client.auth = () => Promise.reject(new Error('Failed to fetch'));
    timers.advance(1000);
    await settle();
    expect(client.channels).toHaveLength(1);
    expect(statuses).toEqual(['connecting', 'offline', 'offline']);
    client.auth = () => Promise.resolve();
    timers.advance(2000);
    await settle();
    expect(client.channels).toHaveLength(2);
    expect(client.log.slice(-2)).toEqual(['setAuth', `subscribe ${client.last.name}`]);
  });

  it('retries when supabase-js does not load', async () => {
    const client = new FakeClient();
    const timers = new FakeTimers();
    let loads = 0;
    const load = () => {
      loads += 1;
      return loads === 1 ? Promise.reject(new Error('Shared groups are not set up')) : Promise.resolve(client as never);
    };
    const statuses: LiveStatus[] = [];
    createSupabaseBackend({ load, timers }).subscribe(
      () => undefined,
      (status) => statuses.push(status),
    );
    await settle();
    expect(statuses).toEqual(['connecting', 'offline']);
    timers.advance(1000);
    await settle();
    expect(client.channels).toHaveLength(1);
  });

  it('ignores system messages that are not about the change stream', async () => {
    const { client, statuses } = await subscribed();
    client.last.status('SUBSCRIBED');
    client.last.system({ message: 'Replication connection established', status: 'ok', extension: 'system', channel: 'x' });
    client.last.system({ message: 'Something else failed', status: 'error', extension: 'broadcast', channel: 'x' });
    expect(statuses).toEqual(['connecting']);
    expect(client.last.removed).toBe(false);
    client.last.system(STREAM_OK);
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('passes changed rows on, one table per batch, and skips hard deletes', async () => {
    const { client, batches } = await subscribed();
    const tables = client.last.bindings.filter((b) => b.type === 'postgres_changes').map((b) => b.filter.table);
    expect(tables).toEqual(['groups', 'group_members', 'expenses', 'payments', 'comments', 'activity']);

    // Rows can arrive before the channel counts as live: they are real rows either way.
    client.last.change('expenses', 'INSERT', { id: 'exp_1', group_id: 'grp_goa' });
    client.last.status('SUBSCRIBED');
    client.last.system(STREAM_OK);
    client.last.change('group_members', 'UPDATE', { id: 'per_bhavna', group_id: 'grp_goa' });
    client.last.change('payments', 'DELETE', {});
    expect(batches).toHaveLength(2);
    expect(batches[0].expenses).toEqual([{ id: 'exp_1', group_id: 'grp_goa' }]);
    expect(batches[0].groups).toEqual([]);
    expect(batches[1].members).toEqual([{ id: 'per_bhavna', group_id: 'grp_goa' }]);
    expect(batches[1].expenses).toEqual([]);
  });
});
