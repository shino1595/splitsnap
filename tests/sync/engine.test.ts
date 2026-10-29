// The sync engine end to end: two or three phones (a SyncEngine + a small store on appReducer)
// against one FakeServer. Engine timers are fake and per phone; live updates arrive through the
// server's setTimeout(0), so settle() runs both until nothing moves.
import { ME_ID } from '../../app/src/types';
import type { AppState, Expense, ExpenseInput, ID, Person, Recurrence } from '../../app/src/types';
import { appReducer, processRecurring } from '../../app/src/store/reducer';
import type { AppAction } from '../../app/src/store/reducer';
import { groupNets, personName } from '../../app/src/store/selectors';
import { blankState } from '../../app/src/store/stateShape';
import { SyncEngine } from '../../app/src/sync/engine';
import type { SyncStoreListener, SyncTimers } from '../../app/src/sync/engine';
import { remapExpense, remapPayment, toServerId } from '../../app/src/sync/idMap';
import { loadSyncState, parseSyncState, saveSyncState, sharedGroupIdsNow } from '../../app/src/sync/syncStorage';
import { EMPTY_SYNC_STATE, SyncError } from '../../app/src/sync/types';
import type { LocalBatch, SyncApi, SyncBackend, SyncState } from '../../app/src/sync/types';
import { FakeServer } from './fakeServer';

const GOA = 'grp_goa';
const BHAVNA = 'per_bhavna';
const CHIRAG = 'per_chirag';
const T0 = '2026-10-01T09:00:00.000Z';

let tick = 0;

/** A later timestamp for every action. */
function nextAt(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 9, 20, 9, 0, 0) + tick * 1000).toISOString();
}

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

/** The same listener contract as AppStore: after every dispatch that changed the state. */
class TestStore {
  state: AppState;
  /** Like AppStore's; unset = nothing to wait for. */
  flushSave?: () => Promise<void>;
  private listeners: SyncStoreListener[] = [];

  constructor(state: AppState) {
    this.state = state;
  }

  getState = (): AppState => this.state;

  subscribe = (listener: SyncStoreListener): (() => void) => {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  };

  dispatch = (action: AppAction): void => {
    const prev = this.state;
    const next = appReducer(prev, action);
    if (next === prev) return;
    this.state = next;
    for (const listener of this.listeners) listener(prev, next, action);
  };

  applyRemote = (batch: LocalBatch): void => this.dispatch({ type: 'sync/applyRemote', batch, at: nextAt() });
}

/** Saves as JSON and loads through the real parser, like AsyncStorage would. */
class MemoryStorage {
  raw: string | null = null;
  load = (): Promise<SyncState> => Promise.resolve(parseSyncState(this.raw));
  save = (state: SyncState): Promise<void> => {
    this.raw = JSON.stringify(state);
    return Promise.resolve();
  };
}

interface Phone {
  label: string;
  store: TestStore;
  storage: MemoryStorage;
  timers: FakeTimers;
  backend: SyncBackend;
  engine: SyncEngine;
  logs: string[];
  api(): SyncApi;
  state(): AppState;
  /** Activity id + time, unique on every phone (activity rows share one id space on the server). */
  stamp(): { at: string; activityId: string };
  myMemberId(groupId?: ID): ID;
}

function world(server: FakeServer = new FakeServer()) {
  const phones: Phone[] = [];

  const engineFor = (p: Phone): SyncEngine =>
    new SyncEngine({
      backend: p.backend,
      store: p.store,
      storage: p.storage,
      timers: p.timers,
      configured: true,
      log: (message) => p.logs.push(message),
    });

  async function phone(label: string, state: AppState, wrap?: (backend: SyncBackend) => SyncBackend): Promise<Phone> {
    const base = server.backend(label);
    const p: Phone = {
      label,
      store: new TestStore(state),
      storage: new MemoryStorage(),
      timers: new FakeTimers(),
      backend: wrap ? wrap(base) : base,
      engine: null as unknown as SyncEngine,
      logs: [],
      api: () => p.engine.getApi(),
      state: () => p.store.state,
      stamp: () => {
        const at = nextAt();
        return { at, activityId: `act_${label}_${tick}` };
      },
      myMemberId: (groupId = GOA) => {
        const info = p.api().shared(groupId);
        if (!info) throw new Error(`${label} does not share ${groupId}`);
        return info.myMemberId;
      },
    };
    p.engine = engineFor(p);
    phones.push(p);
    await p.engine.start();
    return p;
  }

  /** A new engine on the same store and saved sync state (the app restarted). */
  function restart(p: Phone): Promise<void> {
    p.engine.stop();
    p.engine = engineFor(p);
    return p.engine.start();
  }

  /** Lets debounced sends, live updates and the pulls they cause run until everything is quiet. */
  async function settle(only?: Phone[]): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
      for (const p of only || phones) p.timers.advance(500);
      await server.flush();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return { server, phone, restart, settle };
}

function me(name: string): Person {
  return { id: ME_ID, name, color: '#4F46E5', createdAt: T0 };
}

function expenseInput(o: {
  description: string;
  total: number;
  payer: ID;
  ids: ID[];
  groupId?: ID;
  date?: string;
  recurrence?: Recurrence;
}): ExpenseInput {
  const input: ExpenseInput = {
    groupId: o.groupId || GOA,
    description: o.description,
    category: 'food',
    currency: 'INR',
    total: o.total,
    date: o.date || '2026-10-20',
    payers: [{ personId: o.payer, amount: o.total }],
    split: { method: 'equal', participantIds: o.ids },
  };
  if (o.recurrence) input.recurrence = o.recurrence;
  return input;
}

function inputOf(e: Expense, patch: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    groupId: e.groupId,
    description: e.description,
    category: e.category,
    currency: e.currency,
    total: e.total,
    date: e.date,
    payers: e.payers,
    split: e.split,
    ...patch,
  };
}

function run(state: AppState, actions: AppAction[]): AppState {
  return actions.reduce(appReducer, state);
}

let seedTick = 0;
const seed = (): { at: string; activityId: string } => {
  seedTick += 1;
  return { at: T0, activityId: `act_seed_${seedTick}` };
};

/** Aarav's phone: Goa Trip with placeholders Bhavna and Chirag, two expenses with comments, a deleted one and a payment. */
function aaravState(): AppState {
  return run(blankState(T0, me('Aarav')), [
    { type: 'friend/add', id: BHAVNA, input: { name: 'Bhavna' }, ...seed() },
    { type: 'friend/add', id: CHIRAG, input: { name: 'Chirag' }, ...seed() },
    {
      type: 'group/create',
      id: GOA,
      input: { name: 'Goa Trip', type: 'trip', emoji: '🏖️', memberIds: [BHAVNA, CHIRAG], defaultCurrency: 'INR', simplifyDebts: false },
      ...seed(),
    },
    { type: 'expense/add', id: 'exp_dinner', input: expenseInput({ description: 'Dinner', total: 90000, payer: ME_ID, ids: [ME_ID, BHAVNA, CHIRAG] }), ...seed() },
    { type: 'comment/add', expenseId: 'exp_dinner', commentId: 'cmt_dinner', text: 'Great fish curry', ...seed() },
    { type: 'expense/add', id: 'exp_cab', input: expenseInput({ description: 'Cab', total: 60000, payer: BHAVNA, ids: [ME_ID, BHAVNA] }), ...seed() },
    { type: 'comment/add', expenseId: 'exp_cab', commentId: 'cmt_cab', text: 'Paid by UPI', ...seed() },
    { type: 'expense/add', id: 'exp_snacks', input: expenseInput({ description: 'Snacks', total: 3000, payer: ME_ID, ids: [ME_ID, CHIRAG] }), ...seed() },
    { type: 'expense/delete', id: 'exp_snacks', ...seed() },
    {
      type: 'payment/add',
      id: 'pay_chirag',
      input: { groupId: GOA, fromId: CHIRAG, toId: ME_ID, amount: 10000, currency: 'INR', date: '2026-10-21', method: 'upi' },
      ...seed(),
    },
  ]);
}

/** Bhavna's phone: her own unshared group with Diya. */
function bhavnaState(): AppState {
  return run(blankState(T0, me('Bhavna')), [
    { type: 'friend/add', id: 'per_diya', input: { name: 'Diya' }, ...seed() },
    {
      type: 'group/create',
      id: 'grp_flat',
      input: { name: 'Flat', type: 'home', emoji: '🏠', memberIds: ['per_diya'], defaultCurrency: 'INR', simplifyDebts: true },
      ...seed(),
    },
  ]);
}

/** Aarav shares Goa Trip; Bhavna joins with "That's me" on her placeholder. */
async function sharedPair(wrapAarav?: (backend: SyncBackend) => SyncBackend, server?: FakeServer) {
  const w = world(server);
  const aarav = await w.phone('aarav', aaravState(), wrapAarav);
  const code = await aarav.api().shareGroup(GOA);
  await w.settle();
  const bhavna = await w.phone('bhavna', bhavnaState());
  const preview = await bhavna.api().previewJoin(code);
  const placeholder = preview ? preview.members.find((m) => m.name === 'Bhavna') : undefined;
  if (!placeholder) throw new Error('Bhavna is not in the preview');
  await bhavna.api().joinGroup(code, placeholder.id);
  await w.settle();
  return { w, aarav, bhavna, code };
}

const byId = (a: { id: ID }, b: { id: ID }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The group as the server would see it (ids rewritten with this phone's member id), for comparing phones. */
function canonical(p: Phone, groupId: ID = GOA) {
  const s = p.state();
  const map = toServerId(p.myMemberId(groupId));
  const g = s.groups[groupId];
  return {
    group: {
      name: g.name,
      type: g.type,
      emoji: g.emoji,
      defaultCurrency: g.defaultCurrency,
      simplifyDebts: g.simplifyDebts,
      archived: !!g.archived,
      members: g.memberIds.map(map).sort(),
    },
    expenses: Object.values(s.expenses)
      .filter((e) => e.groupId === groupId)
      .map((e) => {
        const r = remapExpense(e, map);
        return { ...r, receiptUri: undefined, comments: r.comments.slice().sort(byId) };
      })
      .sort(byId),
    payments: Object.values(s.payments)
      .filter((x) => x.groupId === groupId)
      .map((x) => remapPayment(x, map))
      .sort(byId),
  };
}

/** Net balance per member id (server ids), from this phone's point of view. */
function nets(p: Phone, groupId: ID = GOA): Record<string, Record<ID, number>> {
  const map = toServerId(p.myMemberId(groupId));
  const local = groupNets(p.state(), groupId);
  const out: Record<string, Record<ID, number>> = {};
  for (const currency of Object.keys(local)) {
    out[currency] = {};
    for (const id of Object.keys(local[currency])) if (local[currency][id] !== 0) out[currency][map(id)] = local[currency][id];
  }
  return out;
}

function activityFor(p: Phone, pred: (a: AppState['activity'][number]) => boolean): string[] {
  return p.state().activity.filter(pred).map((a) => a.summary);
}

describe('SyncEngine: sharing and joining', () => {
  it('shares a group, and a placeholder who joins sees her history as You with the same balances', async () => {
    const { w, aarav, bhavna, code } = await sharedPair();

    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(aarav.api().status).toBe('live');
    expect(aarav.api().pending).toBe(0);
    expect(aarav.api().displayName).toBe('Aarav');
    expect(aarav.api().shared(GOA)).toMatchObject({ groupId: GOA, joinCode: code, joinEnabled: true });
    expect(aarav.myMemberId()).toMatch(/^u_[0-9a-f]{32}$/);

    const rows = w.server.rows();
    expect(rows.groups.map((g) => g.id)).toEqual([GOA]); // Bhavna's Flat never leaves her phone
    expect(rows.members.map((m) => m.name).sort()).toEqual(['Aarav', 'Bhavna', 'Chirag']);
    expect(rows.comments.map((c) => c.id).sort()).toEqual(['cmt_cab', 'cmt_dinner']);
    // share_group drops deleted_at; the engine sends the deletion again right after sharing.
    const snacks = rows.expenses.find((e) => e.id === 'exp_snacks');
    expect(snacks && snacks.deleted_at).not.toBeNull();

    const s = bhavna.state();
    expect(bhavna.myMemberId()).toBe(BHAVNA);
    expect(bhavna.api().status).toBe('live');
    expect(s.groups[GOA]).toMatchObject({ name: 'Goa Trip', emoji: '🏖️' });
    expect(s.groups.grp_flat.name).toBe('Flat');
    expect(s.expenses.exp_cab.payers).toEqual([{ personId: ME_ID, amount: 60000 }]);
    expect(personName(s, s.expenses.exp_cab.payers[0].personId)).toBe('You');
    expect(s.expenses.exp_snacks.deletedAt).toBeDefined();
    const aaravId = aarav.myMemberId();
    expect(s.people[aaravId].name).toBe('Aarav');
    expect(s.people[CHIRAG].name).toBe('Chirag');
    expect(s.expenses.exp_dinner.comments.map((c) => [c.authorId, c.text])).toEqual([[aaravId, 'Great fish curry']]);

    expect(canonical(bhavna)).toEqual(canonical(aarav));
    expect(nets(bhavna)).toEqual(nets(aarav));
    expect(Object.keys(nets(aarav).INR).length).toBeGreaterThan(0);

    // Aarav's phone learns that Bhavna is now on SplitSnap.
    expect(aarav.api().isOnSplitSnap(GOA, BHAVNA)).toBe(true);
    expect(aarav.api().isOnSplitSnap(GOA, CHIRAG)).toBe(false);
    expect(aarav.api().isOnSplitSnap(GOA, ME_ID)).toBe(true);
    expect(aarav.logs).toEqual([]);
    expect(bhavna.logs).toEqual([]);
  });

  it('refuses to share a group twice', async () => {
    const { aarav } = await sharedPair();
    await expect(aarav.api().shareGroup(GOA)).rejects.toThrow('already shared');
  });

  it('asks for a name when the profile name is the default "You"', async () => {
    const { w, code } = await sharedPair();
    const diya = await w.phone('diya', blankState(T0));
    await expect(diya.api().joinGroup(code, null)).rejects.toThrow('Choose the name');
    await diya.api().setDisplayName('  Diya  ');
    expect(diya.api().displayName).toBe('Diya');
  });

  it('adds a new member on every phone', async () => {
    const { w, aarav, bhavna, code } = await sharedPair();
    const diya = await w.phone('diya', blankState(T0));
    await diya.api().setDisplayName('Diya');
    expect(await diya.api().joinGroup(code, null)).toBe(GOA);
    await w.settle();

    const diyaId = diya.myMemberId();
    expect(diyaId).toMatch(/^u_/);
    for (const p of [aarav, bhavna]) {
      expect(p.state().people[diyaId].name).toBe('Diya');
      expect(p.state().groups[GOA].memberIds).toContain(diyaId);
      expect(p.api().isOnSplitSnap(GOA, diyaId)).toBe(true);
    }
    expect(canonical(diya)).toEqual(canonical(aarav));
    expect(nets(diya)).toEqual(nets(aarav));

    aarav.store.dispatch({
      type: 'expense/add',
      id: 'exp_kayak',
      input: expenseInput({ description: 'Kayaking', total: 40000, payer: ME_ID, ids: [ME_ID, diyaId] }),
      ...aarav.stamp(),
    });
    await w.settle();
    expect(diya.state().expenses.exp_kayak.owed).toContainEqual({ personId: ME_ID, amount: 20000 });
    expect(nets(diya)).toEqual(nets(bhavna));
  });
});

describe('SyncEngine: changes flow both ways', () => {
  it('converges after both phones add, edit and soft-delete expenses and payments', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    const aaravId = aarav.myMemberId();

    aarav.store.dispatch({
      type: 'expense/add',
      id: 'exp_lunch',
      input: expenseInput({ description: 'Lunch', total: 45000, payer: ME_ID, ids: [ME_ID, BHAVNA, CHIRAG] }),
      ...aarav.stamp(),
    });
    aarav.store.dispatch({ type: 'expense/update', id: 'exp_cab', input: inputOf(aarav.state().expenses.exp_cab, { description: 'Airport cab' }), ...aarav.stamp() });
    aarav.store.dispatch({ type: 'payment/delete', id: 'pay_chirag', ...aarav.stamp() });
    bhavna.store.dispatch({
      type: 'expense/add',
      id: 'exp_groceries',
      input: expenseInput({ description: 'Groceries', total: 20000, payer: ME_ID, ids: [ME_ID, aaravId] }),
      ...bhavna.stamp(),
    });
    bhavna.store.dispatch({ type: 'expense/delete', id: 'exp_dinner', ...bhavna.stamp() });
    bhavna.store.dispatch({
      type: 'payment/add',
      id: 'pay_bhavna',
      input: { groupId: GOA, fromId: ME_ID, toId: aaravId, amount: 5000, currency: 'INR', date: '2026-10-22', method: 'cash' },
      ...bhavna.stamp(),
    });
    await w.settle();

    const a = aarav.state();
    expect(a.expenses.exp_groceries.payers).toEqual([{ personId: BHAVNA, amount: 20000 }]);
    expect(a.expenses.exp_dinner.deletedAt).toBeDefined();
    expect(a.payments.pay_bhavna).toMatchObject({ fromId: BHAVNA, toId: ME_ID, amount: 5000 });
    const b = bhavna.state();
    expect(b.expenses.exp_lunch.owed).toContainEqual({ personId: ME_ID, amount: 15000 });
    expect(b.expenses.exp_cab.description).toBe('Airport cab');
    expect(b.payments.pay_chirag.deletedAt).toBeDefined();

    expect(canonical(bhavna)).toEqual(canonical(aarav));
    expect(nets(bhavna)).toEqual(nets(aarav));
    expect(aarav.api().pending).toBe(0);
    expect(bhavna.api().pending).toBe(0);
  });

  it('syncs comments and words the activity for each phone', async () => {
    const { w, aarav, bhavna } = await sharedPair();

    bhavna.store.dispatch({ type: 'comment/add', expenseId: 'exp_dinner', commentId: 'cmt_bhavna', text: 'Next one is on me', ...bhavna.stamp() });
    const commented = bhavna.state().activity[0].id;
    aarav.store.dispatch({
      type: 'payment/add',
      id: 'pay_aarav',
      input: { groupId: GOA, fromId: ME_ID, toId: BHAVNA, amount: 50000, currency: 'INR', date: '2026-10-23', method: 'upi' },
      ...aarav.stamp(),
    });
    const paid = aarav.state().activity[0].id;
    await w.settle();

    const comments = aarav.state().expenses.exp_dinner.comments;
    expect(comments.map((c) => [c.authorId, c.text])).toEqual([
      [ME_ID, 'Great fish curry'],
      [BHAVNA, 'Next one is on me'],
    ]);
    expect(bhavna.state().expenses.exp_dinner.comments.map((c) => c.id)).toEqual(['cmt_dinner', 'cmt_bhavna']);

    expect(activityFor(bhavna, (a) => a.id === commented)).toEqual(['You commented on "Dinner".']);
    expect(activityFor(aarav, (a) => a.id === commented)).toEqual(['Bhavna commented on "Dinner".']);
    expect(activityFor(aarav, (a) => a.id === paid)).toEqual(['You paid Bhavna ₹500.00 in Goa Trip.']);
    expect(activityFor(bhavna, (a) => a.id === paid)).toEqual(['Aarav paid you ₹500.00 in Goa Trip.']);
  });

  it('keeps a pending local edit over the server copy, then sends it', async () => {
    const { w, aarav, bhavna } = await sharedPair();

    // Bhavna's edit waits for its debounce; Aarav's reaches the server and her phone first.
    bhavna.store.dispatch({ type: 'expense/update', id: 'exp_cab', input: inputOf(bhavna.state().expenses.exp_cab, { description: 'Cab to the airport' }), ...bhavna.stamp() });
    aarav.store.dispatch({ type: 'expense/update', id: 'exp_cab', input: inputOf(aarav.state().expenses.exp_cab, { description: 'Taxi' }), ...aarav.stamp() });
    await w.settle([aarav]);
    expect(aarav.state().expenses.exp_cab.description).toBe('Taxi');
    expect(bhavna.state().expenses.exp_cab.description).toBe('Cab to the airport');
    expect(bhavna.api().pending).toBeGreaterThan(0);

    await w.settle();
    expect(aarav.state().expenses.exp_cab.description).toBe('Cab to the airport');
    expect(canonical(bhavna)).toEqual(canonical(aarav));
  });

  it('moves the pull cursor on pulls only, not on live updates', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    const before = bhavna.api().shared(GOA)!.cursor as string;
    expect(before).not.toBeNull();
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_tea', input: expenseInput({ description: 'Tea', total: 1000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    await w.settle();
    expect(bhavna.state().expenses.exp_tea.description).toBe('Tea');
    expect(bhavna.api().shared(GOA)!.cursor).toBe(before);

    await bhavna.api().syncNow();
    expect(Date.parse(bhavna.api().shared(GOA)!.cursor as string)).toBeGreaterThan(Date.parse(before));
  });

  it('sends an edit again when it was made while the previous version was on its way', async () => {
    let gate: Promise<void> | null = null;
    let open: () => void = () => undefined;
    const held = (backend: SyncBackend): SyncBackend => ({
      ...backend,
      push: async (payload) => {
        if (gate) await gate;
        return backend.push(payload);
      },
    });
    const { w, aarav, bhavna } = await sharedPair(held);
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    aarav.store.dispatch({ type: 'expense/update', id: 'exp_dinner', input: inputOf(aarav.state().expenses.exp_dinner, { description: 'Dinner v1' }), ...aarav.stamp() });
    aarav.timers.advance(500); // the push of v1 starts and waits at the gate
    aarav.store.dispatch({ type: 'expense/update', id: 'exp_dinner', input: inputOf(aarav.state().expenses.exp_dinner, { description: 'Dinner v2' }), ...aarav.stamp() });
    gate = null;
    open();
    await w.settle();

    const row = w.server.rows().expenses.find((e) => e.id === 'exp_dinner');
    expect(row && (row.data as { description: string }).description).toBe('Dinner v2');
    expect(bhavna.state().expenses.exp_dinner.description).toBe('Dinner v2');
    expect(aarav.api().pending).toBe(0);
  });
});

describe('SyncEngine: offline and restarts', () => {
  it('queues offline edits, keeps them over a restart and sends them once back online', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    const aaravId = aarav.myMemberId();

    w.server.setOnline('bhavna', false);
    await w.settle();
    expect(bhavna.api().status).toBe('offline');

    bhavna.store.dispatch({
      type: 'expense/add',
      id: 'exp_scooter',
      input: expenseInput({ description: 'Scooter hire', total: 30000, payer: ME_ID, ids: [ME_ID, aaravId] }),
      ...bhavna.stamp(),
    });
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_ferry', input: expenseInput({ description: 'Ferry', total: 12000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    await w.settle();
    expect(bhavna.api().pending).toBe(2); // the expense and its activity entry
    expect(bhavna.api().status).toBe('offline');
    expect(bhavna.state().expenses.exp_ferry).toBeUndefined();
    expect(aarav.state().expenses.exp_scooter).toBeUndefined();

    await w.restart(bhavna);
    expect(bhavna.api().pending).toBe(2);

    w.server.setOnline('bhavna', true);
    await w.settle();
    expect(bhavna.api().status).toBe('live');
    expect(bhavna.api().pending).toBe(0);
    expect(bhavna.state().expenses.exp_ferry.description).toBe('Ferry');
    expect(aarav.state().expenses.exp_scooter.payers).toEqual([{ personId: BHAVNA, amount: 30000 }]);
    expect(canonical(bhavna)).toEqual(canonical(aarav));
  });

  it('picks up a change made while the sync state was still loading', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    aarav.engine.stop();
    aarav.engine = new SyncEngine({ backend: aarav.backend, store: aarav.store, storage: aarav.storage, timers: aarav.timers, configured: true });
    const started = aarav.engine.start();
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_water', input: expenseInput({ description: 'Water', total: 2000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    await started;
    expect(aarav.api().pending).toBe(2);
    await w.settle();
    expect(bhavna.state().expenses.exp_water.description).toBe('Water');
  });

  it('saves a pull cursor only after the app state that holds its rows', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    const savedCursor = (): string => parseSyncState(bhavna.storage.raw).groups[GOA].cursor as string;
    const before = savedCursor();
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_tea', input: expenseInput({ description: 'Tea', total: 1000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    await w.settle();

    let release: () => void = () => undefined;
    let flushes = 0;
    bhavna.store.flushSave = () => {
      flushes += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const pulling = bhavna.api().syncNow();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(flushes).toBe(1);
    expect(bhavna.state().expenses.exp_tea.description).toBe('Tea');
    expect(savedCursor()).toBe(before); // the rows may not be on disk yet
    release();
    await pulling;
    const after = savedCursor();
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));

    // A failed save leaves the cursor where it was, so the next pull fetches the rows again.
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_juice', input: expenseInput({ description: 'Juice', total: 1500, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    await w.settle();
    bhavna.store.flushSave = () => Promise.reject(new Error('disk full'));
    await bhavna.api().syncNow();
    expect(savedCursor()).toBe(after);
    expect(bhavna.api().shared(GOA)!.cursor).toBe(after);
    expect(bhavna.logs).toContain("Couldn't save the app state: disk full");
  });

  it('pulls a shared group again from the start when its record is missing on this phone', async () => {
    // A minute between writes, so a pull from the cursor (minus its 10-second overlap) misses older rows.
    let now = Date.UTC(2026, 9, 28, 9, 0, 0);
    const { w, aarav, bhavna } = await sharedPair(undefined, new FakeServer({ clock: () => (now += 60000) }));
    expect(bhavna.api().shared(GOA)!.cursor).not.toBeNull();
    // The app closed after the join saved its cursor, before the app state with the group was saved.
    bhavna.engine.stop();
    bhavna.store.state = bhavnaState();
    await w.restart(bhavna);
    await w.settle();
    expect(bhavna.state().groups[GOA].name).toBe('Goa Trip');
    expect(canonical(bhavna)).toEqual(canonical(aarav));
    expect(nets(bhavna)).toEqual(nets(aarav));
  });
});

describe('SyncEngine: leaving, codes, resets and deletes', () => {
  it('stops updates after leaving; the local copy stays', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    await bhavna.api().leaveGroup(GOA);
    expect(bhavna.api().shared(GOA)).toBeNull();
    expect(bhavna.api().status).toBe('idle');

    aarav.store.dispatch({ type: 'expense/add', id: 'exp_late', input: expenseInput({ description: 'Late snack', total: 4000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    bhavna.store.dispatch({ type: 'expense/update', id: 'exp_cab', input: inputOf(bhavna.state().expenses.exp_cab, { description: 'Only here' }), ...bhavna.stamp() });
    await w.settle();

    expect(bhavna.state().groups[GOA].name).toBe('Goa Trip');
    expect(bhavna.state().expenses.exp_late).toBeUndefined();
    expect(bhavna.api().pending).toBe(0);
    expect(aarav.state().expenses.exp_cab.description).toBe('Cab');
    expect(aarav.api().isOnSplitSnap(GOA, BHAVNA)).toBe(false);

    // Her old copy is not shared any more, so joining again over it is refused.
    const code = aarav.api().shared(GOA)!.joinCode as string;
    await expect(bhavna.api().joinGroup(code, BHAVNA)).rejects.toThrow('already on this phone');
  });

  it('makes a new join code, or switches joining off, on every phone', async () => {
    const { w, aarav, bhavna, code } = await sharedPair();
    const fresh = await aarav.api().resetJoinCode(GOA, true);
    expect(fresh).not.toBe(code);
    expect(await bhavna.api().previewJoin(code)).toBeNull();
    await w.settle();
    expect(bhavna.api().shared(GOA)).toMatchObject({ joinCode: fresh, joinEnabled: true });

    await aarav.api().resetJoinCode(GOA, false);
    await w.settle();
    expect(aarav.api().shared(GOA)!.joinEnabled).toBe(false);
    expect(bhavna.api().shared(GOA)!.joinEnabled).toBe(false);
  });

  it('stops syncing on a reset or a cleared phone without deleting anything on the server', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    const before = w.server.rows();

    bhavna.store.dispatch({ type: 'state/replace', state: bhavnaState() });
    aarav.store.dispatch({ type: 'state/clear', at: nextAt() });
    await w.settle();

    for (const p of [aarav, bhavna]) {
      expect(p.api().shared(GOA)).toBeNull();
      expect(p.api().pending).toBe(0);
      expect(p.api().status).toBe('idle');
    }
    const after = w.server.rows();
    expect(after.groups.map((g) => g.deleted_at)).toEqual([null]);
    expect(after.expenses).toEqual(before.expenses);
    expect(after.payments).toEqual(before.payments);
    expect(bhavna.state().groups[GOA]).toBeUndefined();
  });

  it('removes a deleted shared group on the other phone', async () => {
    const w = world();
    const aarav = await w.phone(
      'aarav',
      run(blankState(T0, me('Aarav')), [
        { type: 'friend/add', id: BHAVNA, input: { name: 'Bhavna' }, ...seed() },
        {
          type: 'group/create',
          id: 'grp_movie',
          input: { name: 'Movie night', type: 'other', emoji: '🎬', memberIds: [BHAVNA], defaultCurrency: 'INR', simplifyDebts: true },
          ...seed(),
        },
      ]),
    );
    const code = await aarav.api().shareGroup('grp_movie');
    const bhavna = await w.phone('bhavna', bhavnaState());
    await bhavna.api().joinGroup(code, BHAVNA);
    await w.settle();
    expect(bhavna.state().groups.grp_movie.name).toBe('Movie night');

    aarav.store.dispatch({ type: 'group/delete', id: 'grp_movie', ...aarav.stamp() });
    await w.settle();

    expect(w.server.rows().groups[0].deleted_at).not.toBeNull();
    expect(bhavna.state().groups.grp_movie).toBeUndefined();
    expect(bhavna.api().shared('grp_movie')).toBeNull();
    expect(aarav.api().pending).toBe(0);
  });
});

describe('SyncEngine: refused changes', () => {
  it('keeps changes while signed out instead of dropping them as refused', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    w.server.deleteUser('bhavna'); // e.g. the project owner removed her anonymous user: no session any more
    bhavna.store.dispatch({ type: 'expense/add', id: 'exp_kept', input: expenseInput({ description: 'Kept', total: 1000, payer: ME_ID, ids: [ME_ID, CHIRAG] }), ...bhavna.stamp() });
    await w.settle();
    expect(bhavna.api().pending).toBe(2); // the expense and its activity entry wait
    expect(bhavna.api().status).toBe('offline');
    expect(bhavna.api().lastError).toBeNull();
    expect(bhavna.api().shared(GOA)).not.toBeNull();
    expect(aarav.state().expenses.exp_kept).toBeUndefined();
    expect(aarav.api().isOnSplitSnap(GOA, BHAVNA)).toBe(false);
    await bhavna.api().syncNow();
    expect(bhavna.api().pending).toBe(2);
    expect(bhavna.api().lastError).toBeNull();
  });

  it('drops a change the server denies for its rows and says why', async () => {
    const strict = (backend: SyncBackend): SyncBackend => ({
      ...backend,
      push: (payload) =>
        payload.expenses.some((e) => e.id === 'exp_denied')
          ? Promise.reject(new SyncError('denied', 'new row violates row-level security policy for table "expenses"'))
          : backend.push(payload),
    });
    const { w, aarav, bhavna } = await sharedPair(strict);
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_denied', input: expenseInput({ description: 'Denied', total: 1000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    await w.settle();
    expect(aarav.api().pending).toBe(0);
    expect(aarav.api().lastError).toBe("You are no longer in Goa Trip, so a change there wasn't sent.");
    expect(bhavna.state().expenses.exp_denied).toBeUndefined();
    // "Sync now" replaces the old notice with what happens now.
    await aarav.api().syncNow();
    expect(aarav.api().lastError).toBeNull();
  });

  it('sends the rest one by one when a single row fails the whole push', async () => {
    const picky = (backend: SyncBackend): SyncBackend => ({
      ...backend,
      push: (payload) =>
        payload.expenses.some((e) => e.id === 'exp_bad') ? Promise.reject(new SyncError('invalid', 'bad row')) : backend.push(payload),
    });
    const { w, aarav, bhavna } = await sharedPair(picky);
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_good', input: expenseInput({ description: 'Good', total: 1000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    aarav.store.dispatch({ type: 'expense/add', id: 'exp_bad', input: expenseInput({ description: 'Bad', total: 1000, payer: ME_ID, ids: [ME_ID, BHAVNA] }), ...aarav.stamp() });
    await w.settle();

    expect(aarav.api().pending).toBe(0);
    expect(aarav.api().lastError).toBe("A change in Goa Trip couldn't be sent: bad row");
    expect(bhavna.state().expenses.exp_good.description).toBe('Good');
    expect(bhavna.state().expenses.exp_bad).toBeUndefined();
  });
});

describe('Recurring expenses in shared groups', () => {
  it('copies only where the expense was created when sharedGroupIds is given', () => {
    const rent = (id: string, actorId?: ID): AppAction => ({
      type: 'expense/add',
      id,
      input: expenseInput({ description: 'Rent', total: 100000, payer: ME_ID, ids: [ME_ID, BHAVNA], date: '2026-09-28', recurrence: { frequency: 'monthly', nextDate: '2026-10-28' } }),
      at: T0,
      activityId: `act_${id}`,
      ...(actorId ? { actorId } : {}),
    });
    const s = run(aaravState(), [rent('exp_mine'), rent('exp_theirs', BHAVNA)]);
    const copiesOf = (state: AppState) =>
      Object.values(state.expenses)
        .filter((e) => e.recurringParentId)
        .map((e) => e.recurringParentId)
        .sort();

    expect(copiesOf(processRecurring(s, '2026-10-28', T0, 'rec'))).toEqual(['exp_mine', 'exp_theirs']);
    expect(copiesOf(processRecurring(s, '2026-10-28', T0, 'rec', []))).toEqual(['exp_mine', 'exp_theirs']);
    const shared = appReducer(s, { type: 'recurring/process', today: '2026-10-28', at: T0, idBase: 'rec', sharedGroupIds: [GOA] });
    expect(copiesOf(shared)).toEqual(['exp_mine']);
    expect(shared.expenses.exp_theirs).toBe(s.expenses.exp_theirs); // nextDate not moved here either
  });

  it('creates each copy once across phones', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    aarav.store.dispatch({
      type: 'expense/add',
      id: 'exp_rent',
      input: expenseInput({ description: 'Rent', total: 100000, payer: ME_ID, ids: [ME_ID, BHAVNA], date: '2026-09-28', recurrence: { frequency: 'monthly', nextDate: '2026-10-28' } }),
      ...aarav.stamp(),
    });
    await w.settle();
    for (const p of [aarav, bhavna]) {
      p.store.dispatch({ type: 'recurring/process', today: '2026-10-28', at: nextAt(), idBase: `rec_${p.label}`, sharedGroupIds: [GOA] });
    }
    await w.settle();

    for (const p of [aarav, bhavna]) {
      const copies = Object.values(p.state().expenses).filter((e) => e.recurringParentId === 'exp_rent');
      expect(copies.map((e) => e.id)).toEqual(['rec_aarav_1']);
      expect(p.state().expenses.exp_rent.recurrence).toEqual({ frequency: 'monthly', nextDate: '2026-11-28' });
    }
    expect(canonical(bhavna)).toEqual(canonical(aarav));
  });

  it('sends the copies made at start-up, right after the engine started (as AppStore does)', async () => {
    const { w, aarav, bhavna } = await sharedPair();
    aarav.store.dispatch({
      type: 'expense/add',
      id: 'exp_rent',
      input: expenseInput({ description: 'Rent', total: 100000, payer: ME_ID, ids: [ME_ID, BHAVNA], date: '2026-09-28', recurrence: { frequency: 'monthly', nextDate: '2026-10-28' } }),
      ...aarav.stamp(),
    });
    await w.settle();
    // The app opens on the due date: the engine starts, then the copies are made while it still loads.
    const started = w.restart(aarav);
    aarav.store.dispatch({ type: 'recurring/process', today: '2026-10-28', at: nextAt(), idBase: 'rec_start', sharedGroupIds: [GOA] });
    await started;
    await w.settle();
    expect(aarav.api().pending).toBe(0);
    expect(bhavna.state().expenses.rec_start_1).toMatchObject({ description: 'Rent', recurringParentId: 'exp_rent' });
    expect(bhavna.state().expenses.exp_rent.recurrence).toEqual({ frequency: 'monthly', nextDate: '2026-11-28' });
    expect(canonical(bhavna)).toEqual(canonical(aarav));
  });
});

describe('SyncEngine without a server', () => {
  it("is 'off' and never calls the backend when sync is not configured", async () => {
    const calls: string[] = [];
    const backend = new Proxy({} as SyncBackend, {
      get: (_target, name) => () => {
        calls.push(String(name));
        throw new Error('backend called');
      },
    });
    const store = new TestStore(aaravState());
    const engine = new SyncEngine({ backend, store, storage: new MemoryStorage(), configured: false });
    await engine.start();
    expect(engine.getApi().status).toBe('off');
    await expect(engine.getApi().shareGroup(GOA)).rejects.toThrow('not set up');
    store.dispatch({ type: 'expense/delete', id: 'exp_dinner', at: nextAt(), activityId: 'act_off_1' });
    expect(engine.getApi().pending).toBe(0);
    expect(calls).toEqual([]);
    engine.stop();
  });

  it("is 'idle' before the first share or join", async () => {
    const w = world();
    const aarav = await w.phone('aarav', aaravState());
    expect(aarav.api().status).toBe('idle');
    expect(aarav.api().shared(GOA)).toBeNull();
    expect(w.server.userId('aarav')).toBeNull();
  });
});

describe('syncStorage', () => {
  const info = { groupId: GOA, myMemberId: 'u_1', joinCode: 'ABCD2345', joinEnabled: true, members: { u_1: { userId: 'user-1', leftAt: null } }, cursor: '2026-10-28T09:00:00.000Z' };
  const good: SyncState = {
    ...EMPTY_SYNC_STATE,
    userId: 'user-1',
    displayName: 'Aarav',
    groups: { [GOA]: info },
    outbox: [
      { kind: 'expense', groupId: GOA, id: 'exp_1' },
      { kind: 'comment', groupId: GOA, id: 'cmt_1', expenseId: 'exp_1' },
    ],
  };

  it('reads back what it saved', () => {
    expect(parseSyncState(JSON.stringify(good))).toEqual(good);
  });

  it('falls back to nothing shared for missing, broken or old data', () => {
    expect(parseSyncState(null)).toEqual(EMPTY_SYNC_STATE);
    expect(parseSyncState('{"version":1')).toEqual(EMPTY_SYNC_STATE);
    expect(parseSyncState('[]')).toEqual(EMPTY_SYNC_STATE);
    expect(parseSyncState(JSON.stringify({ ...good, version: 2 }))).toEqual(EMPTY_SYNC_STATE);
  });

  it('drops damaged entries and keeps the rest', () => {
    const raw = JSON.stringify({
      ...good,
      userId: 42,
      groups: { [GOA]: info, grp_x: { ...info, groupId: 'grp_y' }, grp_z: { groupId: 'grp_z' } },
      outbox: [...good.outbox, { kind: 'teleport', groupId: GOA, id: 'x' }, { kind: 'comment', groupId: GOA, id: 'cmt_2' }, null],
    });
    expect(parseSyncState(raw)).toEqual({ ...good, userId: null });
  });

  it('saves to AsyncStorage and remembers which groups are shared', async () => {
    await saveSyncState(good);
    expect(sharedGroupIdsNow()).toEqual([GOA]);
    expect(await loadSyncState()).toEqual(good);
    await saveSyncState(EMPTY_SYNC_STATE);
    expect(sharedGroupIdsNow()).toEqual([]);
  });
});
