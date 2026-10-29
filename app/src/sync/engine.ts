// The sync engine (docs/SYNC_DESIGN.md §4–7). It watches local changes to shared groups, sends
// them through the outbox with push_changes, and feeds server rows back in through
// sync/applyRemote. React-free and Supabase-free: it only knows a SyncBackend, so the tests run
// it against an in-memory server, and SyncProvider.tsx wires it to the app.
import { ME_ID } from '../types';
import type { AppState, ID, ISODateTime } from '../types';
import type { AppAction } from '../store/reducer';
import { isSyncConfigured } from './config';
import { diffShared } from './diff';
import { buildPush, mergeOutbox } from './outbox';
import { batchToLocal, shareRequest } from './rows';
import type { ConvertedBatch } from './rows';
import { EMPTY_SYNC_STATE, SyncError } from './types';
import type {
  GroupPreview,
  LiveStatus,
  LocalBatch,
  OutboxKey,
  PushPayload,
  RemoteBatch,
  SharedGroupInfo,
  SharedMemberInfo,
  SyncApi,
  SyncBackend,
  SyncState,
  SyncStatus,
} from './types';

const FLUSH_DELAY_MS = 500;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 60000;
const PULL_EVERY_MS = 2 * 60 * 1000;
const NAME_MAX = 60;
/** batchToLocal's reason for rows of groups this phone doesn't share (e.g. just left): not worth logging. */
const NOT_SHARED_HERE = 'not a shared group on this phone';

/** A pull cursor waiting for its rows to be saved (moveCursors). */
interface CursorMove {
  from: ISODateTime | null;
  to: ISODateTime | null;
}

/** Same contract as AppStore's StoreListener. */
export type SyncStoreListener = (prev: AppState, next: AppState, action: AppAction) => void;

/** The parts of AppStore the engine uses (useStoreInternals + actions.applyRemote). */
export interface SyncStore {
  getState(): AppState;
  /** Called after every dispatch that changed the state; returns the unsubscribe function. */
  subscribe(listener: SyncStoreListener): () => void;
  applyRemote(batch: LocalBatch): void;
  /** Saves the app state now (AppStore saves it after a delay); awaited before a pull cursor is saved. */
  flushSave?(): Promise<void>;
}

export interface SyncStorage {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

export interface SyncTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SyncEngineOptions {
  backend: SyncBackend;
  store: SyncStore;
  storage: SyncStorage;
  /** Called when anything getApi() shows has changed. */
  onChange?: () => void;
  timers?: SyncTimers;
  /** Defaults to isSyncConfigured(). false = status 'off', and the backend is never called. */
  configured?: boolean;
  /** Problems nobody sees otherwise (rows skipped, changes refused). */
  log?: (message: string) => void;
}

const DEFAULT_TIMERS: SyncTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const noop = (): void => undefined;

function signature(key: OutboxKey): string {
  return `${key.kind}\u0000${key.groupId}\u0000${key.id}`;
}

/** SyncError's kind, by name rather than instanceof (transpiled Error subclasses can break it). */
function errorKind(error: unknown): SyncError['kind'] | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { name?: unknown; kind?: unknown };
  return e.name === 'SyncError' && typeof e.kind === 'string' ? (e.kind as SyncError['kind']) : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function cleanName(text: string): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('').trim();
}

/** 'u_' + 32 random hex digits, like join_group's ids (crypto when the runtime has it). */
export function newMemberId(): ID {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as unknown as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return `u_${hex}`;
}

function isEmptyBatch(b: LocalBatch): boolean {
  return (
    b.people.length === 0 &&
    b.groups.length === 0 &&
    b.deletedGroupIds.length === 0 &&
    b.expenses.length === 0 &&
    b.payments.length === 0 &&
    b.comments.length === 0 &&
    b.activity.length === 0
  );
}

function without<T>(record: Record<ID, T>, ids: ID[]): Record<ID, T> {
  const out = { ...record };
  for (const id of ids) delete out[id];
  return out;
}

const has = (record: object, id: ID): boolean => Object.prototype.hasOwnProperty.call(record, id);

export class SyncEngine {
  private readonly backend: SyncBackend;
  private readonly store: SyncStore;
  private readonly storage: SyncStorage;
  private readonly timers: SyncTimers;
  private readonly configured: boolean;
  private readonly onChange: () => void;
  private readonly log: (message: string) => void;

  private sync: SyncState = EMPTY_SYNC_STATE;
  private running = false;
  private loaded = false;
  private loading: Promise<void> | null = null;
  /** Bumped by stop() and by a reset, so a share or join that was on its way doesn't record itself. */
  private epoch = 0;
  /** The state when start() began: diffed once the sync state has loaded, so nothing is missed. */
  private baseline: AppState | null = null;
  private replacedWhileLoading = false;
  private unsubscribeStore: (() => void) | null = null;

  private liveToken: object | null = null;
  private unsubscribeLive: (() => void) | null = null;
  private live: LiveStatus | null = null;
  /** The last request failed for lack of a connection. */
  private offline = false;
  private lastError: string | null = null;

  private flushTimer: unknown = null;
  private retryTimer: unknown = null;
  private pullTimer: unknown = null;
  private retryDelay = 0;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  /** Keys of the push on its way, and those changed again meanwhile (they must be sent again). */
  private inFlight: Set<string> | null = null;
  private touched = new Set<string>();
  private pullChain: Promise<void> = Promise.resolve();
  private pullAllQueued: Promise<void> | null = null;
  /** The display name last saved to the profile in this session. */
  private profileName: string | null = null;
  private sharing = new Set<ID>();
  private api: SyncApi | null = null;
  private notified = '';

  constructor(options: SyncEngineOptions) {
    this.backend = options.backend;
    this.store = options.store;
    this.storage = options.storage;
    this.timers = options.timers || DEFAULT_TIMERS;
    this.configured = options.configured !== undefined ? options.configured : isSyncConfigured();
    this.onChange = options.onChange || noop;
    this.log = options.log || noop;
  }

  // ---------- Lifecycle ----------

  /**
   * Loads the sync state, then follows local changes and (when signed in with shared groups) the
   * server. The starting state is taken and the store subscribed before this returns, so a change
   * dispatched right after start() is sent even while the sync state is still loading.
   */
  start(): Promise<void> {
    if (this.running) return this.loading || Promise.resolve();
    this.running = true;
    this.epoch += 1;
    if (!this.configured) {
      this.notify();
      return Promise.resolve();
    }
    this.baseline = this.store.getState();
    this.replacedWhileLoading = false;
    this.unsubscribeStore = this.store.subscribe(this.onStoreChange);
    this.loading = this.load();
    return this.loading;
  }

  /** Stops everything; the outbox stays saved for the next start. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.loaded = false;
    this.loading = null;
    this.epoch += 1;
    if (this.unsubscribeStore) this.unsubscribeStore();
    this.unsubscribeStore = null;
    this.disconnect();
    this.clearTimer('flushTimer');
    this.clearTimer('retryTimer');
  }

  /** A snapshot for the screens; a new object whenever something it shows changed. */
  getApi(): SyncApi {
    if (!this.api) {
      this.api = {
        status: this.status(),
        pending: this.sync.outbox.length,
        lastError: this.lastError,
        displayName: this.sync.displayName,
        setDisplayName: this.setDisplayName,
        shared: this.shared,
        isOnSplitSnap: this.isOnSplitSnap,
        shareGroup: this.shareGroup,
        previewJoin: this.previewJoin,
        joinGroup: this.joinGroup,
        leaveGroup: this.leaveGroup,
        resetJoinCode: this.resetJoinCode,
        syncNow: this.syncNow,
      };
    }
    return this.api;
  }

  private async load(): Promise<void> {
    let saved = EMPTY_SYNC_STATE;
    try {
      saved = await this.storage.load();
    } catch (error) {
      this.log(`Couldn't read the sync state: ${messageOf(error)}`);
    }
    if (!this.running) return;
    this.sync = saved;
    this.loaded = true;
    const baseline = this.baseline;
    this.baseline = null;
    if (this.replacedWhileLoading) {
      this.forgetSharedGroups();
    } else if (baseline) {
      const keys = diffShared(baseline, this.store.getState(), this.sync);
      if (keys.length > 0) this.enqueue(keys);
    }
    this.restartLostGroups();
    if (this.wantsLive()) {
      this.connect();
      this.pullAll().catch(noop);
    }
    this.scheduleFlush(0);
    this.notify();
  }

  /**
   * A shared group whose record isn't in the app state (the app closed after a pull saved its
   * cursor but before the rows were saved) is pulled again from the beginning.
   */
  private restartLostGroups(): void {
    const state = this.store.getState();
    let groups = this.sync.groups;
    for (const id of Object.keys(groups)) {
      if (has(state.groups, id) || groups[id].cursor === null) continue;
      groups = { ...groups, [id]: { ...groups[id], cursor: null } };
    }
    if (groups !== this.sync.groups) this.setSync({ ...this.sync, groups });
  }

  private async ready(): Promise<void> {
    if (!this.configured) throw new SyncError('invalid', 'Shared groups are not set up in this version of the app.');
    if (!this.running || !this.loading) throw new SyncError('network', 'Shared groups are still starting. Try again in a moment.');
    await this.loading;
  }

  // ---------- State ----------

  private setSync(next: SyncState): void {
    this.sync = next;
    this.storage.save(next).catch((error: unknown) => this.log(`Couldn't save the sync state: ${messageOf(error)}`));
  }

  private status(): SyncStatus {
    if (!this.configured) return 'off';
    if (!this.sync.userId || Object.keys(this.sync.groups).length === 0) return 'idle';
    if (this.offline || this.live === 'offline') return 'offline';
    return this.live || 'connecting';
  }

  /** Calls onChange only when something the screens show changed (not for every new cursor). */
  private notify(): void {
    this.api = null;
    const groups = Object.keys(this.sync.groups).map((id) => {
      const g = this.sync.groups[id];
      return [id, g.myMemberId, g.joinCode, g.joinEnabled, g.members];
    });
    const key = JSON.stringify([this.status(), this.sync.outbox.length, this.lastError, this.sync.displayName, groups]);
    if (key === this.notified) return;
    this.notified = key;
    if (this.running) this.onChange();
  }

  private setError(message: string | null): void {
    this.lastError = message;
    this.notify();
  }

  private setOffline(offline: boolean): void {
    if (this.offline === offline) return;
    this.offline = offline;
    this.notify();
  }

  private myName(): string {
    if (this.sync.displayName) return this.sync.displayName;
    const me = this.store.getState().people[ME_ID];
    const name = cleanName(me ? me.name : '');
    return name && !/^(you|me)$/i.test(name) ? name : 'Friend';
  }

  private groupName(groupId: ID): string {
    const group = this.store.getState().groups[groupId];
    return group ? group.name : 'a shared group';
  }

  // ---------- Local → server ----------

  private readonly onStoreChange = (prev: AppState, next: AppState, action: AppAction): void => {
    if (action.type === 'sync/applyRemote') return;
    if (action.type === 'state/replace' || action.type === 'state/clear') {
      // A reset or a cleared phone stops sharing here; it never deletes anything for the others.
      if (this.loaded) this.forgetSharedGroups();
      else this.replacedWhileLoading = true;
      return;
    }
    if (!this.loaded) return;
    const keys = diffShared(prev, next, this.sync);
    if (keys.length > 0) this.enqueue(keys);
  };

  private enqueue(keys: OutboxKey[]): void {
    let groups = this.sync.groups;
    for (const key of keys) {
      // A deleted group stops syncing at once; only its delete is still sent.
      if (key.kind === 'group-delete' && has(groups, key.groupId)) groups = without(groups, [key.groupId]);
      const sig = signature(key);
      if (this.inFlight && this.inFlight.has(sig)) this.touched.add(sig);
    }
    const outbox = mergeOutbox(this.sync.outbox, keys);
    if (outbox === this.sync.outbox && groups === this.sync.groups) return;
    const groupsChanged = groups !== this.sync.groups;
    this.setSync({ ...this.sync, groups, outbox });
    if (groupsChanged) this.connect();
    this.scheduleFlush(FLUSH_DELAY_MS);
    this.notify();
  }

  private forgetSharedGroups(): void {
    this.epoch += 1;
    this.clearTimer('flushTimer');
    this.clearTimer('retryTimer');
    this.retryDelay = 0;
    if (Object.keys(this.sync.groups).length > 0 || this.sync.outbox.length > 0) {
      this.setSync({ ...this.sync, groups: {}, outbox: [] });
    }
    this.connect();
    this.notify();
  }

  /** Stops syncing one group here (left, or deleted on the server); the local copy stays. */
  private dropGroup(groupId: ID): void {
    if (!has(this.sync.groups, groupId)) return;
    const outbox = this.sync.outbox.filter((k) => k.groupId !== groupId);
    this.setSync({ ...this.sync, groups: without(this.sync.groups, [groupId]), outbox });
    this.connect();
    this.notify();
  }

  private canSend(): boolean {
    return this.running && this.loaded && this.configured && !!this.sync.userId && this.sync.outbox.length > 0;
  }

  private clearTimer(name: 'flushTimer' | 'retryTimer' | 'pullTimer'): void {
    if (this[name] !== null) this.timers.clearTimeout(this[name]);
    this[name] = null;
  }

  /** Debounced: each change restarts the wait. A waiting retry (offline) is left alone. */
  private scheduleFlush(delay: number): void {
    if (!this.canSend() || this.retryTimer !== null) return;
    this.clearTimer('flushTimer');
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private scheduleRetry(): void {
    this.retryDelay = this.retryDelay ? Math.min(this.retryDelay * 2, RETRY_MAX_MS) : RETRY_MIN_MS;
    this.clearTimer('flushTimer');
    this.clearTimer('retryTimer');
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.retryDelay);
  }

  /** Sends now, without waiting for the debounce or a retry. */
  private flushNow(): Promise<void> {
    this.clearTimer('flushTimer');
    this.clearTimer('retryTimer');
    return this.flush();
  }

  /** One flush at a time; a request during one runs another right after it. Never rejects. */
  private flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    const run = async (): Promise<void> => {
      do {
        this.flushAgain = false;
        try {
          await this.flushOnce();
        } catch (error) {
          this.log(`Sending failed: ${messageOf(error)}`);
        }
      } while (this.flushAgain && this.running && this.retryTimer === null);
    };
    const done = run().then(() => {
      this.flushing = null;
    });
    this.flushing = done;
    return done;
  }

  private async flushOnce(): Promise<void> {
    if (!this.canSend()) return;
    const keys = this.sync.outbox;
    const outcome = await this.send(keys, keys.length === 1);
    if (outcome !== 'rejected') return;
    // One bad row fails the whole transaction: send the rest one by one, so only that one is dropped.
    for (const key of keys) {
      if (!this.running || !this.sync.outbox.some((k) => signature(k) === signature(key))) continue;
      if ((await this.send([key], true)) === 'retry') return;
    }
  }

  /** One push_changes call. 'rejected' = refused by the server (the keys are dropped only when `dropRejected`). */
  private async send(keys: OutboxKey[], dropRejected: boolean): Promise<'sent' | 'retry' | 'rejected'> {
    const built = buildPush(this.store.getState(), this.sync, keys, this.myName());
    if (built.dropped.length > 0) this.removeKeys(built.dropped, null);
    if (built.sent.length === 0) return 'sent';
    this.inFlight = new Set(built.sent.map(signature));
    this.touched = new Set();
    try {
      const written = await this.backend.push(built.payload);
      this.retryDelay = 0;
      this.setOffline(false);
      this.removeKeys(built.sent, this.touched);
      this.logSkipped(built.payload, written);
      return 'sent';
    } catch (error) {
      const kind = errorKind(error);
      if (kind === null || kind === 'network') {
        if (kind === null) this.log(`Sending failed: ${messageOf(error)}`);
        this.setOffline(kind === 'network');
        this.scheduleRetry();
        return 'retry';
      }
      if (!dropRejected) return 'rejected';
      this.removeKeys(built.sent, this.touched);
      const groupIds = built.sent.map((k) => k.groupId).filter((id, i, all) => all.indexOf(id) === i);
      const names = groupIds.map((id) => this.groupName(id)).join(', ');
      this.log(`Change refused (${kind}): ${messageOf(error)}`);
      this.setError(kind === 'denied' ? `You are no longer in ${names}, so a change there wasn't sent.` : `A change in ${names} couldn't be sent: ${messageOf(error)}`);
      return 'rejected';
    } finally {
      this.inFlight = null;
      this.touched = new Set();
    }
  }

  /** Removes these keys from the outbox, except those changed again while they were being sent. */
  private removeKeys(keys: OutboxKey[], keep: Set<string> | null): void {
    const drop = new Set(keys.map(signature).filter((sig) => !keep || !keep.has(sig)));
    const outbox = this.sync.outbox.filter((k) => !drop.has(signature(k)));
    if (outbox.length === this.sync.outbox.length) return;
    this.setSync({ ...this.sync, outbox });
    this.notify();
  }

  /** push_changes skips rows of groups you are no longer in (§4.5): worth a log line. */
  private logSkipped(payload: PushPayload, written: Record<keyof PushPayload, number>): void {
    const kinds = Object.keys(payload) as (keyof PushPayload)[];
    const short = kinds.filter((kind) => typeof written[kind] === 'number' && written[kind] < payload[kind].length);
    // Comments and activity are insert-only, so a repeat send writes nothing on purpose.
    const real = short.filter((kind) => kind !== 'comments' && kind !== 'activity');
    if (real.length > 0) this.log(`The server skipped some rows: ${real.map((k) => `${k} ${written[k]}/${payload[k].length}`).join(', ')}`);
  }

  // ---------- Server → local ----------

  private wantsLive(): boolean {
    return this.running && this.loaded && this.configured && !!this.sync.userId && Object.keys(this.sync.groups).length > 0;
  }

  /** Subscribes when signed in with shared groups, unsubscribes when none are left. */
  private connect(): void {
    if (!this.wantsLive()) {
      this.disconnect();
      return;
    }
    if (this.liveToken) return;
    const token = {};
    this.liveToken = token;
    this.live = 'connecting';
    try {
      const unsubscribe = this.backend.subscribe(
        (batch) => {
          if (this.liveToken === token) void this.applyRows(batch, false);
        },
        (status) => {
          if (this.liveToken === token) this.onLiveStatus(status);
        },
      );
      if (this.liveToken === token) this.unsubscribeLive = unsubscribe;
      else unsubscribe();
    } catch (error) {
      this.log(`Live updates failed: ${messageOf(error)}`);
      this.live = 'offline';
    }
    this.schedulePeriodicPull();
  }

  private disconnect(): void {
    const unsubscribe = this.unsubscribeLive;
    this.liveToken = null;
    this.unsubscribeLive = null;
    this.live = null;
    this.clearTimer('pullTimer');
    if (unsubscribe) unsubscribe();
  }

  private onLiveStatus(status: LiveStatus): void {
    const was = this.live;
    this.live = status;
    if (status === 'live') {
      this.offline = false;
      // Back online: catch up on what live updates missed, and send what waited.
      if (was !== 'live') {
        this.pullAll().catch(noop);
        void this.flushNow();
      }
    }
    this.notify();
  }

  private schedulePeriodicPull(): void {
    if (this.pullTimer !== null) return;
    this.pullTimer = this.timers.setTimeout(() => {
      this.pullTimer = null;
      if (!this.wantsLive()) return;
      this.pullAll().catch(noop);
      this.schedulePeriodicPull();
    }, PULL_EVERY_MS);
  }

  /** Every shared group from its cursor. Pulls run one at a time; one waiting pull serves every caller. */
  private pullAll(): Promise<void> {
    if (this.pullAllQueued) return this.pullAllQueued;
    const next = this.pullChain.then(() => {
      this.pullAllQueued = null;
      return this.pullOnce(null);
    });
    this.pullAllQueued = next;
    this.pullChain = next.catch(noop);
    return next;
  }

  private pullGroups(groupIds: ID[]): Promise<void> {
    const next = this.pullChain.then(() => this.pullOnce(groupIds));
    this.pullChain = next.catch(noop);
    return next;
  }

  private async pullOnce(groupIds: ID[] | null): Promise<void> {
    if (!this.running || !this.loaded || !this.configured || !this.sync.userId) return;
    const since: Record<ID, string | null> = {};
    for (const id of groupIds || Object.keys(this.sync.groups)) {
      if (has(this.sync.groups, id)) since[id] = this.sync.groups[id].cursor;
    }
    if (Object.keys(since).length === 0) return;
    let batch: RemoteBatch;
    try {
      batch = await this.backend.pull(since);
    } catch (error) {
      const kind = errorKind(error);
      if (kind === null || kind === 'network') this.setOffline(true);
      else this.setError(`Couldn't load the latest changes: ${messageOf(error)}`);
      this.log(`Pull failed: ${messageOf(error)}`);
      throw error;
    }
    this.setOffline(false);
    await this.applyRows(batch, true);
  }

  /**
   * Rows from a pull or a live update → the store. Entities with a pending outbox key keep the
   * local version (it is about to be sent, and later saves win). Only pulls move the cursor: a
   * live row can arrive before older rows that a pull still has to fetch. Resolves once the new
   * cursors are saved.
   */
  private applyRows(batch: RemoteBatch, fromPull: boolean): Promise<void> {
    if (!this.running || !this.loaded) return Promise.resolve();
    const state = this.store.getState();
    let converted: ConvertedBatch;
    try {
      converted = batchToLocal(batch, this.sync, state);
    } catch (error) {
      this.log(`Couldn't read server rows: ${messageOf(error)}`);
      return Promise.resolve();
    }
    for (const row of converted.skipped) {
      if (row.reason !== NOT_SHARED_HERE) this.log(`Skipped ${row.kind} ${row.id}: ${row.reason}`);
    }
    const local = this.withoutPending(converted.local, state);
    if (!isEmptyBatch(local)) {
      try {
        this.store.applyRemote(local);
      } catch (error) {
        this.log(`Couldn't apply server rows: ${messageOf(error)}`);
        return Promise.resolve();
      }
    }

    // Everything but the cursors now; the cursors once the rows are saved (moveCursors).
    let groups = this.sync.groups;
    const moved: Record<ID, CursorMove> = {};
    for (const id of Object.keys(converted.groupInfo)) {
      if (!has(groups, id)) continue;
      const info = groups[id];
      const update = converted.groupInfo[id];
      const next: SharedGroupInfo = { ...info, ...update, cursor: info.cursor };
      if (fromPull && update.cursor !== undefined && update.cursor !== info.cursor) moved[id] = { from: info.cursor, to: update.cursor };
      if (JSON.stringify(next) !== JSON.stringify(info)) groups = { ...groups, [id]: next };
    }
    const gone = converted.local.deletedGroupIds.filter((id) => has(groups, id));
    if (groups !== this.sync.groups || gone.length > 0) {
      const outbox = gone.length > 0 ? this.sync.outbox.filter((k) => gone.indexOf(k.groupId) < 0) : this.sync.outbox;
      this.setSync({ ...this.sync, groups: without(groups, gone), outbox });
      if (gone.length > 0) this.connect();
      this.notify();
    }
    return Object.keys(moved).length > 0 ? this.moveCursors(moved) : Promise.resolve();
  }

  /**
   * Saves pull cursors only after the app state that holds their rows: AppStore saves it after a
   * delay, and a cursor saved first would skip those rows for good if the app closed in between.
   */
  private async moveCursors(moved: Record<ID, CursorMove>): Promise<void> {
    const epoch = this.epoch;
    if (this.store.flushSave) {
      try {
        await this.store.flushSave();
      } catch (error) {
        // The cursors stay put, so the next pull fetches these rows again.
        this.log(`Couldn't save the app state: ${messageOf(error)}`);
        return;
      }
    }
    if (!this.running || epoch !== this.epoch) return;
    let groups = this.sync.groups;
    for (const id of Object.keys(moved)) {
      // Not for a group that stopped syncing meanwhile, or whose cursor was reset.
      if (!has(groups, id) || groups[id].cursor !== moved[id].from) continue;
      groups = { ...groups, [id]: { ...groups[id], cursor: moved[id].to } };
    }
    if (groups !== this.sync.groups) this.setSync({ ...this.sync, groups });
  }

  private withoutPending(local: LocalBatch, state: AppState): LocalBatch {
    if (this.sync.outbox.length === 0) return local;
    const pending = new Set(this.sync.outbox.map((k) => `${k.kind}\u0000${k.id}`));
    const waiting = (kind: OutboxKey['kind'], id: ID): boolean => pending.has(`${kind}\u0000${id}`);
    return {
      ...local,
      people: local.people.filter((p) => !waiting('member', p.id)),
      // A pending group edit keeps its fields, but new members still come in.
      groups: local.groups.map((g) => {
        const mine = state.groups[g.id];
        return mine && waiting('group', g.id) ? { ...mine, memberIds: g.memberIds } : g;
      }),
      expenses: local.expenses.filter((e) => !waiting('expense', e.id)),
      payments: local.payments.filter((p) => !waiting('payment', p.id)),
    };
  }

  // ---------- Sign-in ----------

  private async signIn(): Promise<string> {
    const userId = await this.backend.signIn();
    if (userId !== this.sync.userId) {
      this.profileName = null;
      this.setSync({ ...this.sync, userId });
      this.notify();
    }
    return userId;
  }

  /** Signed in, with a name the others will see (your profile name by default) saved to the profile. */
  private async identity(): Promise<{ userId: string; name: string }> {
    let name = this.sync.displayName;
    if (!name) {
      const me = this.store.getState().people[ME_ID];
      const candidate = cleanName(me ? me.name : '');
      if (!candidate || /^(you|me)$/i.test(candidate)) throw new SyncError('invalid', 'Choose the name the others will see first.');
      name = candidate;
      this.setSync({ ...this.sync, displayName: name });
      this.notify();
    }
    const userId = await this.signIn();
    if (this.profileName !== name) {
      await this.backend.saveProfile(name);
      this.profileName = name;
    }
    return { userId, name };
  }

  // ---------- SyncApi ----------

  private readonly shared = (groupId: ID): SharedGroupInfo | null =>
    has(this.sync.groups, groupId) ? this.sync.groups[groupId] : null;

  private readonly isOnSplitSnap = (groupId: ID, personId: ID): boolean => {
    if (personId === ME_ID) return true;
    const info = this.shared(groupId);
    if (!info || personId === info.myMemberId || !has(info.members, personId)) return false;
    const member = info.members[personId];
    return member.userId !== null && member.leftAt === null;
  };

  private readonly setDisplayName = async (text: string): Promise<void> => {
    const name = cleanName(text);
    if (!name) throw new SyncError('invalid', 'Enter your name.');
    await this.ready();
    if (name !== this.sync.displayName) {
      this.setSync({ ...this.sync, displayName: name });
      // Your member row carries this name in every shared group.
      const state = this.store.getState();
      const keys: OutboxKey[] = Object.keys(this.sync.groups)
        .filter((id) => !!state.groups[id])
        .map((id): OutboxKey => ({ kind: 'member', groupId: id, id: ME_ID }));
      if (keys.length > 0) this.enqueue(keys);
      this.notify();
    }
    if (!this.sync.userId || this.profileName === name) return;
    try {
      await this.backend.saveProfile(name);
      this.profileName = name;
    } catch (error) {
      // Saved here; the profile follows on the next share or join.
      if (errorKind(error) !== 'network') throw error;
    }
  };

  private readonly shareGroup = async (groupId: ID): Promise<string> => {
    await this.ready();
    if (has(this.sync.groups, groupId) || this.sharing.has(groupId)) throw new SyncError('invalid', 'This group is already shared.');
    if (!this.store.getState().groups[groupId]) throw new SyncError('invalid', 'This group no longer exists.');
    this.sharing.add(groupId);
    try {
      const { userId, name } = await this.identity();
      const epoch = this.epoch;
      const before = this.store.getState();
      const me = newMemberId();
      const request = shareRequest(before, groupId, me, name);
      const code = await this.backend.shareGroup(request);
      if (epoch !== this.epoch) return code;

      const members: Record<ID, SharedMemberInfo> = {};
      for (const m of request.members) members[m.id] = { userId: m.id === me ? userId : null, leftAt: null };
      const info: SharedGroupInfo = { groupId, myMemberId: me, joinCode: code, joinEnabled: true, members, cursor: null };
      this.setSync({ ...this.sync, groups: { ...this.sync.groups, [groupId]: info } });

      // share_group stores no deleted_at, so deletions are sent again through push_changes, which does.
      const keys: OutboxKey[] = [];
      for (const e of Object.values(before.expenses)) {
        if (e.groupId === groupId && e.deletedAt) keys.push({ kind: 'expense', groupId, id: e.id });
      }
      for (const p of Object.values(before.payments)) {
        if (p.groupId === groupId && p.deletedAt) keys.push({ kind: 'payment', groupId, id: p.id });
      }
      // Changes made while the upload was on its way.
      keys.push(...diffShared(before, this.store.getState(), this.sync));
      if (keys.length > 0) this.enqueue(keys);
      this.connect();
      this.notify();
      return code;
    } finally {
      this.sharing.delete(groupId);
    }
  };

  private readonly previewJoin = async (code: string): Promise<GroupPreview | null> => {
    await this.ready();
    await this.signIn();
    return this.backend.previewGroup(code);
  };

  /** A group that is on this phone but not shared (e.g. you left it) can't be joined over. */
  private refuseLocalCopy(groupId: ID): void {
    const local = this.store.getState().groups[groupId];
    if (!local || has(this.sync.groups, groupId)) return;
    throw new SyncError('invalid', `"${local.name}" is already on this phone as an unshared group. Delete it first, then join again.`);
  }

  private readonly joinGroup = async (code: string, memberId: ID | null): Promise<ID> => {
    await this.ready();
    const { userId, name } = await this.identity();
    const preview = await this.backend.previewGroup(code);
    if (!preview) throw new SyncError('not-found', "That code doesn't match a group.");
    this.refuseLocalCopy(preview.id);
    const epoch = this.epoch;
    const result = await this.backend.joinGroup(code, memberId, memberId ? null : name);
    if (epoch !== this.epoch) return result.groupId;
    try {
      this.refuseLocalCopy(result.groupId);
    } catch (error) {
      await this.backend.leaveGroup(result.groupId).catch(noop);
      throw error;
    }
    const existing = this.shared(result.groupId);
    const info: SharedGroupInfo = {
      groupId: result.groupId,
      // The server decides who you are (someone who was in the group before gets their old row back).
      myMemberId: result.memberId,
      joinCode: existing ? existing.joinCode : code.trim().toUpperCase(),
      joinEnabled: true,
      members: { ...(existing ? existing.members : {}), [result.memberId]: { userId, leftAt: null } },
      cursor: null,
    };
    this.setSync({ ...this.sync, groups: { ...this.sync.groups, [result.groupId]: info } });
    this.connect();
    this.notify();
    await this.pullGroups([result.groupId]);
    return result.groupId;
  };

  private readonly leaveGroup = async (groupId: ID): Promise<void> => {
    await this.ready();
    if (!this.shared(groupId)) throw new SyncError('invalid', "This group isn't shared.");
    // Your last changes still reach the others.
    if (this.sync.outbox.some((k) => k.groupId === groupId)) await this.flushNow();
    await this.backend.leaveGroup(groupId);
    this.dropGroup(groupId);
  };

  private readonly resetJoinCode = async (groupId: ID, enabled: boolean): Promise<string> => {
    await this.ready();
    if (!this.shared(groupId)) throw new SyncError('invalid', "This group isn't shared.");
    const code = await this.backend.resetJoinCode(groupId, enabled);
    const info = this.shared(groupId);
    if (info) {
      this.setSync({ ...this.sync, groups: { ...this.sync.groups, [groupId]: { ...info, joinCode: code, joinEnabled: enabled } } });
      this.notify();
    }
    return code;
  };

  private readonly syncNow = async (): Promise<void> => {
    await this.ready();
    // Tapping "sync now" dismisses the last problem; a new one shows again.
    if (this.lastError) this.setError(null);
    if (!this.wantsLive() && !this.canSend()) return;
    this.connect();
    await this.flushNow();
    await this.pullAll().catch(noop);
  };
}
