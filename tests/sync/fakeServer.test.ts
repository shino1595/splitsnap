import { EMPTY_BATCH, SyncError } from '../../app/src/sync/types';
import type { LiveStatus, PushData, PushGroup, PushMember, PushPayload, RemoteBatch, ShareRequest, SyncBackend } from '../../app/src/sync/types';
import { FakeServer } from './fakeServer';

const GOA = 'grp_goa';
const HOME = 'grp_home';
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);

function group(id = GOA, name = 'Goa Trip'): PushGroup {
  return { id, name, type: 'trip', emoji: '🏖️', defaultCurrency: 'INR', simplifyDebts: true, archived: false };
}

function member(id: string, name: string, groupId = GOA): PushMember {
  return { groupId, id, name, color: '#2E86DE' };
}

function expense(id: string, groupId = GOA, description = 'Dinner'): PushData {
  return { id, groupId, data: { id, groupId, description, total: 240000, currency: 'INR' }, deletedAt: null };
}

function payment(id: string, groupId = GOA): PushData {
  return { id, groupId, data: { id, groupId, fromId: 'per_bhavna', toId: 'u_aarav', amount: 50000 }, deletedAt: null };
}

function shareRequest(overrides: Partial<ShareRequest> = {}): ShareRequest {
  return {
    group: group(),
    members: [member('u_aarav', 'Aarav'), member('per_bhavna', 'Bhavna'), member('per_chirag', 'Chirag')],
    expenses: [expense('exp_dinner')],
    payments: [payment('pay_1')],
    comments: [{ id: 'cmt_1', groupId: GOA, expenseId: 'exp_dinner', data: { id: 'cmt_1', authorId: 'u_aarav', text: 'Paid by card' } }],
    me: 'u_aarav',
    ...overrides,
  };
}

function payload(parts: Partial<PushPayload>): PushPayload {
  return { groups: [], members: [], expenses: [], payments: [], comments: [], activity: [], ...parts };
}

const NOTHING = { groups: 0, members: 0, expenses: 0, payments: 0, comments: 0, activity: 0 };

async function failure(promise: Promise<unknown>): Promise<SyncError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SyncError) return error;
    throw error;
  }
  throw new Error('Expected the call to fail');
}

/** Aarav signs in and shares Goa Trip. */
async function shareGoa(server: FakeServer): Promise<{ aarav: SyncBackend; code: string }> {
  const aarav = server.backend('aarav');
  await aarav.signIn();
  const code = await aarav.shareGroup(shareRequest());
  return { aarav, code };
}

async function join(server: FakeServer, label: string, code: string, memberId: string | null, name: string | null = null) {
  const phone = server.backend(label);
  await phone.signIn();
  return { phone, ...(await phone.joinGroup(code, memberId, name)) };
}

function listen(phone: SyncBackend): { batches: RemoteBatch[]; statuses: LiveStatus[]; stop: () => void } {
  const batches: RemoteBatch[] = [];
  const statuses: LiveStatus[] = [];
  const stop = phone.subscribe((batch) => batches.push(batch), (status) => statuses.push(status));
  return { batches, statuses, stop };
}

function ids(rows: { id: string }[]): string[] {
  return rows.map((row) => row.id);
}

describe('fakeServer: sign-in and profiles', () => {
  it('gives each phone its own anonymous user and the same backend per label', async () => {
    const server = new FakeServer();
    const aarav = server.backend('aarav');
    const first = await aarav.signIn();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await aarav.signIn()).toBe(first);
    expect(server.backend('aarav')).toBe(aarav);
    expect(aarav.label).toBe('aarav');
    expect(await server.backend('bhavna').signIn()).not.toBe(first);
    expect(server.userId('aarav')).toBe(first);
    expect(server.userId('chirag')).toBeNull();
  });

  it("refuses every call before sign-in, as 'network' (it says nothing about the rows)", async () => {
    const server = new FakeServer();
    await shareGoa(server);
    const diya = server.backend('diya');
    expect((await failure(diya.pull({ [GOA]: null }))).kind).toBe('network');
    expect((await failure(diya.previewGroup('ABCDEFGH'))).message).toBe('Sign in first');
    expect((await failure(diya.push(payload({})))).kind).toBe('network');
  });

  it('creates and renames the profile, checking the trimmed length', async () => {
    const server = new FakeServer();
    const aarav = server.backend('aarav');
    const uid = await aarav.signIn();
    await aarav.saveProfile('Aarav');
    await aarav.saveProfile('Aarav M');
    const [profile] = server.profiles();
    expect(server.profiles()).toHaveLength(1);
    expect(profile).toMatchObject({ id: uid, display_name: 'Aarav M' });
    expect(profile.updated_at > profile.created_at).toBe(true);
    expect((await failure(aarav.saveProfile('   '))).kind).toBe('invalid');
    expect(server.profiles()[0].display_name).toBe('Aarav M');
  });
});

describe('fakeServer: share_group', () => {
  it('uploads the group in one transaction with server stamps and returns an 8-character code', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const uid = server.userId('aarav');
    const rows = server.rows();
    expect(code).toMatch(CODE);
    expect(rows.groups).toHaveLength(1);
    const g = rows.groups[0];
    expect(g).toMatchObject({ id: GOA, name: 'Goa Trip', type: 'trip', join_code: code, join_enabled: true, created_by: uid, updated_by: uid, deleted_at: null });
    expect(rows.members.map((m) => [m.id, m.user_id])).toEqual([['u_aarav', uid], ['per_bhavna', null], ['per_chirag', null]]);
    expect(rows.expenses).toEqual([
      { id: 'exp_dinner', group_id: GOA, data: expense('exp_dinner').data, created_at: g.created_at, updated_at: g.created_at, updated_by: uid, deleted_at: null },
    ]);
    expect(ids(rows.payments)).toEqual(['pay_1']);
    expect(rows.comments[0]).toMatchObject({ id: 'cmt_1', group_id: GOA, expense_id: 'exp_dinner', created_by: uid, created_at: g.created_at });
    // One transaction, one now().
    expect(rows.members.every((m) => m.created_at === g.created_at && m.updated_at === g.created_at)).toBe(true);
  });

  it('fills defaults, puts every row in the shared group and does not store deletedAt', async () => {
    const server = new FakeServer();
    const aarav = server.backend('aarav');
    await aarav.signIn();
    const bare = { id: GOA, name: 'Goa Trip' } as unknown as PushGroup;
    const deleted = { ...expense('exp_old'), deletedAt: '2026-10-20T10:00:00.000Z' };
    await aarav.shareGroup(shareRequest({ group: bare, members: [member('u_aarav', 'Aarav', 'grp_elsewhere')], expenses: [deleted], payments: [], comments: [] }));
    const rows = server.rows();
    expect(rows.groups[0]).toMatchObject({ type: 'other', emoji: '👥', default_currency: 'INR', simplify_debts: true, archived: false });
    expect(rows.members[0].group_id).toBe(GOA);
    expect(rows.expenses[0].deleted_at).toBeNull();
  });

  it('is all or nothing', async () => {
    const server = new FakeServer();
    const aarav = server.backend('aarav');
    await aarav.signIn();
    const notMe = await failure(aarav.shareGroup(shareRequest({ me: 'u_somebody' })));
    expect(notMe).toMatchObject({ kind: 'invalid', message: 'You must be one of the members' });
    const wrongGroup = { ...expense('exp_x'), data: { id: 'exp_x', groupId: HOME } };
    expect((await failure(aarav.shareGroup(shareRequest({ expenses: [expense('exp_dinner'), wrongGroup] })))).kind).toBe('invalid');
    const orphan = { id: 'cmt_2', groupId: GOA, expenseId: 'exp_missing', data: { id: 'cmt_2' } };
    expect((await failure(aarav.shareGroup(shareRequest({ comments: [orphan] })))).kind).toBe('denied');
    expect((await failure(aarav.shareGroup(shareRequest({ group: group(GOA, '   ') })))).kind).toBe('invalid');
    expect(server.rows()).toEqual(EMPTY_BATCH);
  });

  it('refuses a group id or an expense id that is already on the server', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    expect((await failure(aarav.shareGroup(shareRequest()))).message).toContain('groups_pkey');
    const home = shareRequest({ group: group(HOME, 'Flat'), payments: [], comments: [], expenses: [expense('exp_dinner', HOME)] });
    expect((await failure(aarav.shareGroup(home))).message).toContain('expenses_pkey');
    expect(ids(server.rows().groups)).toEqual([GOA]);
  });

  it('gives every group its own code from the alphabet', async () => {
    const server = new FakeServer();
    const aarav = server.backend('aarav');
    await aarav.signIn();
    const codes: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      codes.push(await aarav.shareGroup({ group: group(`grp_${i}`), members: [member('u_aarav', 'Aarav')], expenses: [], payments: [], comments: [], me: 'u_aarav' }));
    }
    expect(codes.every((c) => CODE.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(30);
  });
});

describe('fakeServer: preview_group', () => {
  it('previews by code (trimmed, any case) with members in order and their claimed flag', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const diya = server.backend('diya');
    await diya.signIn();
    expect(await diya.previewGroup('ZZZZZZZZ')).toBeNull();
    expect(await diya.previewGroup(`  ${code.toLowerCase()} `)).toEqual({
      id: GOA,
      name: 'Goa Trip',
      emoji: '🏖️',
      members: [
        { id: 'per_bhavna', name: 'Bhavna', claimed: false },
        { id: 'per_chirag', name: 'Chirag', claimed: false },
        { id: 'u_aarav', name: 'Aarav', claimed: true },
      ],
    });
  });

  it('leaves out members who left, and groups that are closed or deleted', async () => {
    const server = new FakeServer();
    const { aarav, code } = await shareGoa(server);
    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    await bhavna.leaveGroup(GOA);
    expect(ids((await aarav.previewGroup(code))!.members)).toEqual(['per_chirag', 'u_aarav']);

    const closed = await aarav.resetJoinCode(GOA, false);
    expect(await aarav.previewGroup(closed)).toBeNull();
    const open = await aarav.resetJoinCode(GOA, true);
    expect(await aarav.previewGroup(open)).not.toBeNull();

    await aarav.push(payload({ groups: [{ id: GOA, deleted: true }] }));
    expect(await aarav.previewGroup(open)).toBeNull();
  });
});

describe('fakeServer: join_group', () => {
  it('claims a placeholder ("That\'s me")', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const result = await join(server, 'bhavna', code, 'per_bhavna');
    expect({ groupId: result.groupId, memberId: result.memberId }).toEqual({ groupId: GOA, memberId: 'per_bhavna' });
    expect(server.rows().members.find((m) => m.id === 'per_bhavna')!.user_id).toBe(server.userId('bhavna'));
  });

  it('refuses a name someone already claimed, or one that does not exist', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    await join(server, 'bhavna', code, 'per_bhavna');
    const chirag = server.backend('chirag');
    await chirag.signIn();
    const taken = await failure(chirag.joinGroup(code, 'per_bhavna', null));
    expect(taken).toMatchObject({ kind: 'invalid', message: 'Someone has already claimed that name' });
    expect((await failure(chirag.joinGroup(code, 'per_nobody', null))).kind).toBe('invalid');
    expect(server.rows().members.filter((m) => m.user_id === server.userId('chirag'))).toEqual([]);
  });

  it('joins as a new member with a random u_ id, named from the request, the profile or "Friend"', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const diya = await join(server, 'diya', code, null, '  Diya ');
    expect(diya.memberId).toMatch(/^u_[0-9a-f]{32}$/);

    const chirag = server.backend('chirag');
    await chirag.signIn();
    await chirag.saveProfile('Chirag S');
    const viaProfile = await chirag.joinGroup(code, null, '   ');
    const guest = await join(server, 'guest', code, null);

    const names = new Map(server.rows().members.map((m) => [m.id, m.name]));
    expect(names.get(diya.memberId)).toBe('Diya');
    expect(names.get(viaProfile.memberId)).toBe('Chirag S');
    expect(names.get(guest.memberId)).toBe('Friend');
    expect(new Set([diya.memberId, viaProfile.memberId, guest.memberId]).size).toBe(3);
    // A new member, not a claim: Chirag's placeholder is still free.
    expect(server.rows().members.find((m) => m.id === 'per_chirag')!.user_id).toBeNull();
  });

  it('gives someone who was in the group their old row back, whatever they ask for', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    await bhavna.leaveGroup(GOA);
    expect(await bhavna.joinGroup(code, 'per_chirag', null)).toEqual({ groupId: GOA, memberId: 'per_bhavna' });
    expect(await bhavna.joinGroup(code, null, 'Someone else')).toEqual({ groupId: GOA, memberId: 'per_bhavna' });
    const members = server.rows().members;
    expect(members.find((m) => m.id === 'per_bhavna')).toMatchObject({ user_id: server.userId('bhavna'), left_at: null, name: 'Bhavna' });
    expect(members.find((m) => m.id === 'per_chirag')!.user_id).toBeNull();
    expect(members).toHaveLength(3);
  });

  it('answers not-found for a wrong or replaced code', async () => {
    const server = new FakeServer();
    const { aarav, code } = await shareGoa(server);
    const diya = server.backend('diya');
    await diya.signIn();
    expect(await failure(diya.joinGroup('ZZZZZZZZ', null, 'Diya'))).toMatchObject({ kind: 'not-found', message: "That code doesn't match a group" });
    await aarav.resetJoinCode(GOA, true);
    expect((await failure(diya.joinGroup(code, null, 'Diya'))).kind).toBe('not-found');
  });

  it('frees the rows of a deleted user, so the new phone can claim them again', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    await join(server, 'bhavna-old', code, 'per_bhavna');
    server.deleteUser('bhavna-old');
    expect(server.userId('bhavna-old')).toBeNull();
    expect(server.rows().members.find((m) => m.id === 'per_bhavna')!.user_id).toBeNull();
    const again = await join(server, 'bhavna-new', code, 'per_bhavna');
    expect(again.memberId).toBe('per_bhavna');
  });
});

describe('fakeServer: leave_group and reset_join_code', () => {
  it('leaving stamps left_at; the leaver then only sees their own member row', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    expect(ids((await bhavna.pull({ [GOA]: null })).expenses)).toEqual(['exp_dinner']);
    await bhavna.leaveGroup(GOA);
    expect(server.rows().members.find((m) => m.id === 'per_bhavna')!.left_at).not.toBeNull();
    const after = await bhavna.pull({ [GOA]: null });
    expect(ids(after.members)).toEqual(['per_bhavna']);
    expect(after.groups).toEqual([]);
    expect(after.expenses).toEqual([]);
    expect(after.comments).toEqual([]);
  });

  it('a creator who left no longer sees the group', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    await aarav.leaveGroup(GOA);
    const after = await aarav.pull({ [GOA]: null });
    expect(after.groups).toEqual([]);
    expect(after.payments).toEqual([]);
    expect(ids(after.members)).toEqual(['u_aarav']);
  });

  it('resets the code for members only; the old code stops working', async () => {
    const server = new FakeServer();
    const { aarav, code } = await shareGoa(server);
    const chirag = server.backend('chirag');
    await chirag.signIn();
    expect(await failure(chirag.resetJoinCode(GOA, true))).toMatchObject({ kind: 'denied', message: 'You are not in this group' });
    const next = await aarav.resetJoinCode(GOA, true);
    expect(next).toMatch(CODE);
    expect(next).not.toBe(code);
    expect(await chirag.previewGroup(code)).toBeNull();
    expect((await chirag.previewGroup(next))!.id).toBe(GOA);
    expect(server.rows().groups[0]).toMatchObject({ join_code: next, join_enabled: true, updated_by: server.userId('aarav') });
  });
});

describe('fakeServer: push_changes', () => {
  it('only updates groups, keeps missing fields, and soft-deletes once', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    const rename = { id: GOA, name: 'Goa 2026' } as unknown as PushGroup;
    const notShared = group('grp_unknown');
    expect(await aarav.push(payload({ groups: [rename, notShared] }))).toEqual({ ...NOTHING, groups: 1 });
    expect(server.rows().groups).toHaveLength(1);
    expect(server.rows().groups[0]).toMatchObject({ name: 'Goa 2026', type: 'trip', emoji: '🏖️', deleted_at: null });

    await aarav.push(payload({ groups: [{ id: GOA, deleted: true }] }));
    const deletedAt = server.rows().groups[0].deleted_at;
    expect(deletedAt).not.toBeNull();
    await aarav.push(payload({ groups: [{ id: GOA, deleted: true }] }));
    const g = server.rows().groups[0];
    expect(g.deleted_at).toBe(deletedAt);
    expect(g.updated_at > deletedAt!).toBe(true);
    expect(g.name).toBe('Goa 2026');
  });

  it('upserts members, changing name and colour only', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    const counts = await aarav.push(payload({ members: [{ ...member('u_aarav', 'Aarav M'), color: null }, member('per_diya', 'Diya')] }));
    expect(counts.members).toBe(2);
    const members = server.rows().members;
    expect(members.find((m) => m.id === 'u_aarav')).toMatchObject({ name: 'Aarav M', color: null, user_id: server.userId('aarav') });
    expect(members.find((m) => m.id === 'per_diya')).toMatchObject({ group_id: GOA, user_id: null, left_at: null });
  });

  it('inserts and updates expenses and payments but never moves one to another group', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    await aarav.shareGroup(shareRequest({ group: group(HOME, 'Flat'), expenses: [expense('exp_rent', HOME, 'Rent')], payments: [], comments: [] }));
    const before = server.rows().expenses.find((e) => e.id === 'exp_dinner')!;

    const changed = expense('exp_dinner', GOA, 'Dinner at the shack');
    const counts = await aarav.push(payload({
      expenses: [changed, expense('exp_lunch'), expense('exp_rent', GOA, 'Moved?')],
      payments: [{ ...payment('pay_1'), deletedAt: '2026-10-28T12:00:00Z' }],
    }));
    expect(counts).toEqual({ ...NOTHING, expenses: 2, payments: 1 });

    const rows = server.rows();
    const dinner = rows.expenses.find((e) => e.id === 'exp_dinner')!;
    expect(dinner.data).toEqual(changed.data);
    expect(dinner.created_at).toBe(before.created_at);
    expect(dinner.updated_at > before.updated_at).toBe(true);
    expect(rows.expenses.find((e) => e.id === 'exp_rent')).toMatchObject({ group_id: HOME, data: { description: 'Rent' } });
    expect(rows.payments[0].deleted_at).toBe('2026-10-28T12:00:00.000Z');
  });

  it('keeps comments and activity insert-only, so a repeat send is harmless', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    const edited = { id: 'cmt_1', groupId: GOA, expenseId: 'exp_dinner', data: { id: 'cmt_1', text: 'Edited' } };
    const fresh = { id: 'cmt_2', groupId: GOA, expenseId: 'exp_dinner', data: { id: 'cmt_2', text: 'Thanks' } };
    const act = { id: 'act_1', groupId: GOA, data: { id: 'act_1', groupId: GOA, type: 'expense_added', summary: 'Aarav added Dinner' } };
    expect(await aarav.push(payload({ comments: [edited, fresh], activity: [act] }))).toEqual({ ...NOTHING, comments: 1, activity: 1 });
    expect(await aarav.push(payload({ comments: [fresh], activity: [act, act] }))).toEqual(NOTHING);
    const rows = server.rows();
    expect(rows.comments.find((c) => c.id === 'cmt_1')!.data).toEqual({ id: 'cmt_1', authorId: 'u_aarav', text: 'Paid by card' });
    expect(rows.activity).toHaveLength(1);
    expect(rows.activity[0].created_by).toBe(server.userId('aarav'));
  });

  it('silently skips rows for groups the caller is not (or no longer) in', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const before = server.rows();
    const everything = payload({
      groups: [{ ...group(), name: 'Hijacked' }],
      members: [member('per_diya', 'Diya')],
      expenses: [expense('exp_new')],
      payments: [payment('pay_new')],
      comments: [{ id: 'cmt_9', groupId: GOA, expenseId: 'exp_dinner', data: { id: 'cmt_9' } }],
      activity: [{ id: 'act_9', groupId: GOA, data: { id: 'act_9' } }],
    });
    const chirag = server.backend('chirag');
    await chirag.signIn();
    expect(await chirag.push(everything)).toEqual(NOTHING);

    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    await bhavna.leaveGroup(GOA);
    expect(await bhavna.push(everything)).toEqual(NOTHING);
    expect(server.rows().expenses).toEqual(before.expenses);
    expect(server.rows().groups[0].name).toBe('Goa Trip');
  });

  it('fails the whole push when a JSON row claims another id or group', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    const otherGroup = { ...expense('exp_bad'), data: { id: 'exp_bad', groupId: HOME } };
    const otherId = { ...payment('pay_bad'), data: { id: 'pay_other' } };
    const badActivity = { id: 'act_bad', groupId: GOA, data: { id: 'act_other' } };
    for (const bad of [payload({ expenses: [expense('exp_ok'), otherGroup] }), payload({ expenses: [expense('exp_ok')], payments: [otherId] }), payload({ groups: [{ ...group(), name: 'Renamed' }], activity: [badActivity] })]) {
      expect((await failure(aarav.push(bad))).kind).toBe('invalid');
    }
    const rows = server.rows();
    expect(ids(rows.expenses)).toEqual(['exp_dinner']);
    expect(rows.groups[0].name).toBe('Goa Trip');
  });

  it('fails the whole push for a comment whose expense is not in that group (row security)', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    const orphan = { id: 'cmt_2', groupId: GOA, expenseId: 'exp_missing', data: { id: 'cmt_2' } };
    // Checked before "on conflict do nothing", so even a repeat send of an existing comment fails.
    const resent = { id: 'cmt_1', groupId: GOA, expenseId: 'exp_missing', data: { id: 'cmt_1' } };
    for (const comment of [orphan, resent]) {
      expect((await failure(aarav.push(payload({ expenses: [expense('exp_new')], comments: [comment] })))).kind).toBe('denied');
    }
    expect(ids(server.rows().expenses)).toEqual(['exp_dinner']);
    // The expense may come in the same push: statements run in order.
    const together = await aarav.push(payload({ expenses: [expense('exp_new')], comments: [{ ...orphan, expenseId: 'exp_new' }] }));
    expect(together).toEqual({ ...NOTHING, expenses: 1, comments: 1 });
  });

  it('refuses the same expense twice in one push, like on conflict do update', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    expect((await failure(aarav.push(payload({ expenses: [expense('exp_x'), expense('exp_x', GOA, 'Again')] })))).kind).toBe('invalid');
  });

  it('stamps who and when on the server, one timestamp per call', async () => {
    const server = new FakeServer();
    const { code } = await shareGoa(server);
    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    await bhavna.push(payload({ expenses: [expense('exp_dinner', GOA, 'Edited by Bhavna'), expense('exp_taxi')] }));
    const [dinner, taxi] = server.rows().expenses;
    expect(dinner.updated_by).toBe(server.userId('bhavna'));
    expect(taxi.updated_by).toBe(server.userId('bhavna'));
    expect(taxi.updated_at).toBe(dinner.updated_at);
    expect(taxi.created_at > dinner.created_at).toBe(true);
  });
});

describe('fakeServer: pull', () => {
  it('returns everything for null, and rows changed after the cursor minus 10 seconds', async () => {
    let now = T0;
    const server = new FakeServer({ clock: () => now });
    const { aarav } = await shareGoa(server);
    now = T0 + 60000;
    await aarav.push(payload({ expenses: [expense('exp_lunch')] }));
    const iso = (ms: number) => new Date(ms).toISOString();

    const everything = await aarav.pull({ [GOA]: null });
    expect(ids(everything.expenses)).toEqual(['exp_dinner', 'exp_lunch']);
    expect(everything.groups).toHaveLength(1);
    expect(everything.members).toHaveLength(3);
    expect(everything.comments).toHaveLength(1);

    const overlap = await aarav.pull({ [GOA]: iso(T0 + 9999) });
    expect(ids(overlap.expenses)).toEqual(['exp_dinner', 'exp_lunch']);
    // Strictly after: a row stamped exactly cursor - 10 s is not sent again.
    const later = await aarav.pull({ [GOA]: iso(T0 + 10000) });
    expect(later.expenses).toEqual([
      { id: 'exp_lunch', group_id: GOA, data: expense('exp_lunch').data, created_at: iso(T0 + 60000), updated_at: iso(T0 + 60000), updated_by: server.userId('aarav'), deleted_at: null },
    ]);
    expect({ ...later, expenses: [] }).toEqual(EMPTY_BATCH);
    expect(await aarav.pull({ [GOA]: iso(T0 + 70000) })).toEqual(EMPTY_BATCH);
  });

  it('only returns the groups asked for, and only those the caller can see', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    await aarav.shareGroup(shareRequest({ group: group(HOME, 'Flat'), expenses: [expense('exp_rent', HOME)], payments: [], comments: [] }));
    const goa = await aarav.pull({ [GOA]: null });
    expect(ids(goa.groups)).toEqual([GOA]);
    expect(ids(goa.expenses)).toEqual(['exp_dinner']);
    const chirag = server.backend('chirag');
    await chirag.signIn();
    expect(await chirag.pull({ [GOA]: null, [HOME]: null })).toEqual(EMPTY_BATCH);
  });
});

describe('fakeServer: live updates', () => {
  it('delivers each written row later, one batch per row, to every member including the writer', async () => {
    const server = new FakeServer();
    const { aarav, code } = await shareGoa(server);
    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    const chirag = server.backend('chirag');
    await chirag.signIn();
    const [a, b, c] = [listen(aarav), listen(bhavna), listen(chirag)];
    await server.flush();
    expect([a.statuses, b.statuses, c.statuses]).toEqual([['live'], ['live'], ['live']]);

    await aarav.push(payload({ expenses: [expense('exp_lunch'), expense('exp_taxi')] }));
    expect(a.batches).toEqual([]);
    await server.flush();
    for (const listener of [a, b]) {
      expect(listener.batches.map((batch) => ids(batch.expenses))).toEqual([['exp_lunch'], ['exp_taxi']]);
      expect(listener.batches[0]).toMatchObject({ groups: [], members: [], payments: [], comments: [], activity: [] });
    }
    expect(c.batches).toEqual([]);
  });

  it('tells a new member about their own row and the leaver about theirs, then nothing more', async () => {
    const server = new FakeServer();
    const { aarav, code } = await shareGoa(server);
    const bhavna = server.backend('bhavna');
    await bhavna.signIn();
    const [a, b] = [listen(aarav), listen(bhavna)];
    await bhavna.joinGroup(code, 'per_bhavna', null);
    await server.flush();
    expect(b.batches.map((batch) => ids(batch.members))).toEqual([['per_bhavna']]);
    expect(a.batches.map((batch) => ids(batch.members))).toEqual([['per_bhavna']]);

    await bhavna.leaveGroup(GOA);
    await aarav.push(payload({ expenses: [expense('exp_lunch')] }));
    await server.flush();
    expect(b.batches.map((batch) => batch.members.map((m) => m.left_at !== null))).toEqual([[false], [true]]);
    expect(a.batches.map((batch) => ids(batch.members).concat(ids(batch.expenses)))).toEqual([['per_bhavna'], ['per_bhavna'], ['exp_lunch']]);
  });

  it('offline: calls fail with network errors and missed updates are not delivered later', async () => {
    const server = new FakeServer();
    const { aarav, code } = await shareGoa(server);
    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    const b = listen(bhavna);
    await server.flush();

    server.setOnline('bhavna', false);
    expect((await failure(bhavna.push(payload({ expenses: [expense('exp_mine')] })))).kind).toBe('network');
    expect((await failure(bhavna.signIn())).kind).toBe('network');
    await aarav.push(payload({ expenses: [expense('exp_lunch')] }));
    await server.flush();
    server.setOnline('bhavna', true);
    await server.flush();
    expect(b.statuses).toEqual(['live', 'offline', 'live']);
    expect(b.batches).toEqual([]);
    expect(ids((await bhavna.pull({ [GOA]: null })).expenses)).toEqual(['exp_dinner', 'exp_lunch']);
    expect(server.rows().expenses.some((e) => e.id === 'exp_mine')).toBe(false);
  });

  it('drops updates that were queued before the phone went offline', async () => {
    const server = new FakeServer();
    const { aarav, code } = await shareGoa(server);
    const { phone: bhavna } = await join(server, 'bhavna', code, 'per_bhavna');
    const b = listen(bhavna);
    await server.flush();
    await aarav.push(payload({ expenses: [expense('exp_lunch')] }));
    server.setOnline('bhavna', false);
    server.setOnline('bhavna', true);
    await server.flush();
    expect(b.batches).toEqual([]);
  });

  it('reports offline when subscribing offline, and stops after unsubscribe', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    server.setOnline('aarav', false);
    const a = listen(aarav);
    await server.flush();
    expect(a.statuses).toEqual(['offline']);
    server.setOnline('aarav', true);
    a.stop();
    await aarav.push(payload({ expenses: [expense('exp_lunch')] }));
    await server.flush();
    expect(a.statuses).toEqual(['offline']);
    expect(a.batches).toEqual([]);
  });

  it('rethrows an error thrown by a callback from flush()', async () => {
    const server = new FakeServer();
    const { aarav } = await shareGoa(server);
    aarav.subscribe(() => {
      throw new Error('engine bug');
    }, () => undefined);
    await aarav.push(payload({ expenses: [expense('exp_lunch')] }));
    await expect(server.flush()).rejects.toThrow('engine bug');
  });
});

describe('fakeServer: copies', () => {
  it('never shares objects with callers', async () => {
    const server = new FakeServer();
    const aarav = server.backend('aarav');
    await aarav.signIn();
    const request = shareRequest();
    await aarav.shareGroup(request);
    (request.expenses[0].data as { description: string }).description = 'Changed by the caller';
    request.members.length = 0;

    const a = listen(aarav);
    await aarav.push(payload({ expenses: [expense('exp_lunch')] }));
    await server.flush();
    (a.batches[0].expenses[0].data as { description: string }).description = 'Changed in a live batch';
    const pulled = await aarav.pull({ [GOA]: null });
    (pulled.expenses[0].data as { description: string }).description = 'Changed in a pull';
    server.rows().groups[0].name = 'Changed in rows()';

    const rows = server.rows();
    expect(rows.expenses.map((e) => (e.data as { description: string }).description)).toEqual(['Dinner', 'Dinner']);
    expect(rows.members).toHaveLength(3);
    expect(rows.groups[0].name).toBe('Goa Trip');
  });
});
