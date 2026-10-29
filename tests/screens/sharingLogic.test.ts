import { SyncError } from '../../app/src/sync/types';
import type { GroupPreview, SharedGroupInfo } from '../../app/src/sync/types';
import {
  APP_LINK,
  CLAIMED_TEXT,
  DENIED_TEXT,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  OFFLINE_TEXT,
  RESHARED_TEXT,
  WRONG_CODE_TEXT,
  cleanDisplayName,
  displayNameDraft,
  displayNameProblem,
  formatJoinCode,
  hasLeft,
  inviteMessage,
  inviteTitle,
  joinChoices,
  joinCodeProblem,
  memberBadge,
  memberStatus,
  normalizeJoinCode,
  sharedGroupLock,
  sharedSummary,
  syncErrorText,
  syncStatusText,
} from '../../app/src/screens/sharing/sharingLogic';

const FALLBACK = 'Something went wrong. Please try again.';

function preview(members: { id: string; name: string; claimed: boolean }[]): GroupPreview {
  return { id: 'grp_goa', name: 'Goa Trip', emoji: '🏖️', members };
}

describe('join codes', () => {
  it('matches the server alphabet (no I, L, O, 0 or 1) and length', () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(31);
    for (const c of 'ILO01') expect(JOIN_CODE_ALPHABET.indexOf(c)).toBe(-1);
    expect(JOIN_CODE_LENGTH).toBe(8);
  });

  it('normalises case, spaces, dashes and invisible characters', () => {
    expect(normalizeJoinCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeJoinCode('  AB CD  EF GH ')).toBe('ABCDEFGH');
    expect(normalizeJoinCode('abcd–efgh')).toBe('ABCDEFGH');
    expect(normalizeJoinCode('ab_cd​efgh\n')).toBe('ABCDEFGH');
    expect(normalizeJoinCode('')).toBe('');
  });

  it('accepts a real code in any typed form', () => {
    expect(joinCodeProblem('K7M2-QX9P')).toBeNull();
    expect(joinCodeProblem('k7m2 qx9p')).toBeNull();
    expect(joinCodeProblem('HJKMNPQR')).toBeNull();
  });

  it('explains an empty, short or long code', () => {
    expect(joinCodeProblem('')).toBe('Enter the code from your invite');
    expect(joinCodeProblem(' - ')).toBe('Enter the code from your invite');
    expect(joinCodeProblem('K7M2')).toBe('A code has 8 characters; this one has 4.');
    expect(joinCodeProblem('K7M2QX9PA')).toBe('A code has 8 characters; this one has 9.');
  });

  it('points out look-alike characters the server never uses', () => {
    expect(joinCodeProblem('K7M2QX0P')).toMatch(/never use I, L, O, 0 or 1/);
    expect(joinCodeProblem('ilo1abcd')).toMatch(/never use/);
  });

  it('rejects other characters', () => {
    expect(joinCodeProblem('K7M2QX9#')).toBe('Codes only have letters and the numbers 2 to 9.');
    expect(joinCodeProblem('K7M2QXÉP')).toBe('Codes only have letters and the numbers 2 to 9.');
  });

  it('formats an 8-character code in two halves and leaves others alone', () => {
    expect(formatJoinCode('K7M2QX9P')).toBe('K7M2-QX9P');
    expect(formatJoinCode('ABC')).toBe('ABC');
    expect(normalizeJoinCode(formatJoinCode('K7M2QX9P'))).toBe('K7M2QX9P');
  });
});

describe('invite message', () => {
  it('has the group name, the readable code and the fixed app link', () => {
    const text = inviteMessage('Goa Trip', 'K7M2QX9P');
    expect(text).toContain('"Goa Trip"');
    expect(text).toContain('K7M2-QX9P');
    expect(text).toContain(APP_LINK);
    expect(text).toContain("That's me");
    expect(text.split('\n')).toHaveLength(5);
    expect(text.split('\n')[4]).toBe('3. Tap "That\'s me" next to your name, or join as a new member if your name isn\'t there.');
  });

  it('uses the Expo Go link for runtime SDK 58 on the main channel', () => {
    expect(APP_LINK).toBe(
      'exp://u.expo.dev/e2a3167d-0539-40eb-8acf-3593c97841b5?runtime-version=exposdk%3A58.0.0&channel-name=main',
    );
  });

  it('has a short title for the share sheet', () => {
    expect(inviteTitle('Flat 302')).toBe('Join Flat 302 on SplitSnap');
  });

  it('a code copied from the message passes validation', () => {
    const line = inviteMessage('Goa Trip', 'K7M2QX9P').split('\n')[3];
    const typed = line.slice(line.lastIndexOf(' ') + 1);
    expect(joinCodeProblem(typed)).toBeNull();
    expect(normalizeJoinCode(typed)).toBe('K7M2QX9P');
  });
});

describe('badges and summaries', () => {
  const info: SharedGroupInfo = {
    groupId: 'grp_goa',
    myMemberId: 'u_aarav',
    joinCode: 'K7M2QX9P',
    joinEnabled: true,
    members: {
      u_aarav: { userId: 'user-a', leftAt: null },
      per_bhavna: { userId: 'user-b', leftAt: null },
      per_chirag: { userId: null, leftAt: null },
      u_diya: { userId: 'user-d', leftAt: '2026-10-20T09:00:00.000Z' },
    },
    cursor: null,
  };

  it('labels members', () => {
    expect(memberBadge('on')).toBe('On SplitSnap');
    expect(memberBadge('invited')).toBe('Invited');
    expect(memberBadge('left')).toBe('Left');
  });

  it('tells members who left from placeholders nobody claimed yet', () => {
    expect(memberStatus(info, 'per_bhavna', true)).toBe('on');
    expect(memberStatus(info, 'per_chirag', false)).toBe('invited');
    expect(memberStatus(info, 'u_diya', false)).toBe('left');
    expect(memberStatus(info, 'per_unknown', false)).toBe('invited');
    expect(memberStatus(null, 'u_diya', false)).toBe('invited');
    expect(hasLeft(info, 'u_diya')).toBe(true);
    expect(hasLeft(info, 'per_chirag')).toBe(false);
    expect(hasLeft(info, 'constructor')).toBe(false);
  });

  it('summarises a shared group', () => {
    expect(sharedSummary(2, 4)).toBe('Shared · 2 of 4 on SplitSnap');
    expect(sharedSummary(1, 1)).toBe('Shared');
    // Members who left are neither on SplitSnap nor invited.
    expect(sharedSummary(2, 4, 1)).toBe('Shared · 2 of 3 on SplitSnap');
    expect(sharedSummary(1, 2, 1)).toBe('Shared');
  });

  it('explains a locked group picker in one line', () => {
    expect(sharedGroupLock('expense', 'Goa Trip')).toBe("This expense is shared in Goa Trip, so it can't move to another group.");
    expect(sharedGroupLock('payment', 'Flat 302')).toContain('This payment');
  });
});

describe('display name', () => {
  it('cleans spaces and keeps at most 60 characters', () => {
    expect(cleanDisplayName('  Aarav   Shah ')).toBe('Aarav Shah');
    expect(cleanDisplayName('x'.repeat(70))).toHaveLength(60);
  });

  it('needs a real name', () => {
    expect(displayNameProblem('   ')).toBe('Enter your name');
    expect(displayNameProblem('You')).toMatch(/your own name/);
    expect(displayNameProblem(' me ')).toMatch(/your own name/);
    expect(displayNameProblem('Bhavna')).toBeNull();
  });

  it('prefills from the saved name, else the profile name, never the default "You"', () => {
    expect(displayNameDraft('Chirag', 'Chirag K')).toBe('Chirag');
    expect(displayNameDraft(null, ' Diya  M ')).toBe('Diya M');
    expect(displayNameDraft(null, 'You')).toBe('');
    expect(displayNameDraft('', undefined)).toBe('');
  });
});

describe('sync status line', () => {
  it('describes each status', () => {
    expect(syncStatusText('live', 0)).toBe('Live');
    expect(syncStatusText('live', 2)).toBe('Live: sending 2 changes');
    expect(syncStatusText('offline', 1)).toBe('Offline: 1 change waiting');
    expect(syncStatusText('offline', 3)).toBe('Offline: 3 changes waiting');
    expect(syncStatusText('offline', 0)).toBe('Offline: nothing waiting');
    expect(syncStatusText('connecting', 0)).toBe('Connecting…');
    expect(syncStatusText('connecting', 4)).toBe('Connecting: 4 changes waiting');
    expect(syncStatusText('idle', 0)).toBe('Not connected yet');
    expect(syncStatusText('off', 0)).toMatch(/off/);
  });
});

describe('joinChoices', () => {
  const members = [
    { id: 'u_sharer', name: 'Aarav', claimed: true },
    { id: 'per_b', name: 'Bhavna Rao', claimed: false },
    { id: 'per_c', name: 'Chirag', claimed: false },
    { id: 'per_d', name: 'Diya', claimed: true },
  ];

  it('splits open placeholders from members who joined, keeping the order', () => {
    const c = joinChoices(preview(members), null);
    expect(c.open.map((m) => m.id)).toEqual(['per_b', 'per_c']);
    expect(c.taken.map((m) => m.id)).toEqual(['u_sharer', 'per_d']);
    expect(c.suggested).toBeNull();
  });

  it('suggests the placeholder with your name, ignoring case and spaces', () => {
    expect(joinChoices(preview(members), ' chirag ').suggested).toBe('per_c');
    expect(joinChoices(preview(members), 'Bhavna Rao').suggested).toBe('per_b');
  });

  it('falls back to a unique first-name match', () => {
    expect(joinChoices(preview(members), 'Bhavna').suggested).toBe('per_b');
  });

  it('never suggests a claimed member or an ambiguous name', () => {
    expect(joinChoices(preview(members), 'Diya').suggested).toBeNull();
    const twins = preview([
      { id: 'p1', name: 'Aarav S', claimed: false },
      { id: 'p2', name: 'Aarav K', claimed: false },
    ]);
    expect(joinChoices(twins, 'Aarav').suggested).toBeNull();
    expect(joinChoices(twins, 'Aarav K').suggested).toBe('p2');
  });

  it('handles a group with no members to claim', () => {
    const c = joinChoices(preview([{ id: 'u_1', name: 'Aarav', claimed: true }]), 'Bhavna');
    expect(c.open).toEqual([]);
    expect(c.suggested).toBeNull();
  });
});

describe('syncErrorText', () => {
  it('maps SyncError kinds to friendly sentences', () => {
    expect(syncErrorText(new SyncError('network', 'fetch failed'), FALLBACK)).toBe(OFFLINE_TEXT);
    expect(syncErrorText(new SyncError('not-found', 'no such code'), FALLBACK)).toBe(WRONG_CODE_TEXT);
    expect(syncErrorText(new SyncError('denied', 'permission denied for table groups'), FALLBACK)).toBe(DENIED_TEXT);
    expect(syncErrorText(new SyncError('invalid', 'You must be one of the members'), FALLBACK)).toBe(
      'You must be one of the members',
    );
  });

  it('recognises the server messages whatever the kind', () => {
    expect(syncErrorText(new SyncError('invalid', 'Someone has already claimed that name'), FALLBACK)).toBe(CLAIMED_TEXT);
    expect(syncErrorText(new SyncError('denied', 'Someone has already claimed that name'), FALLBACK)).toBe(CLAIMED_TEXT);
    expect(syncErrorText(new Error("That code doesn't match a group"), FALLBACK)).toBe(WRONG_CODE_TEXT);
    expect(syncErrorText(new Error('TypeError: Failed to fetch'), FALLBACK)).toBe(OFFLINE_TEXT);
    expect(syncErrorText(new Error('Network request failed'), FALLBACK)).toBe(OFFLINE_TEXT);
  });

  it('explains sharing a group the server already has, instead of the database message', () => {
    const duplicate = new SyncError('invalid', 'duplicate key value violates unique constraint "groups_pkey"');
    expect(syncErrorText(duplicate, FALLBACK)).toBe(RESHARED_TEXT);
    expect(RESHARED_TEXT).toBe(
      "This group was shared before, so it can't be shared again. Ask a member for the code and join it instead.",
    );
  });

  it('never shows Postgres internals, even short ones', () => {
    const internals = [
      'new row for relation "expenses" violates check constraint "expenses_data_check"',
      'value too long for type character varying(60) in column "name"',
      'syntax error at or near "select"',
      "Could not find the function public.push_changes(p) in the schema cache",
      'relation "public.groups" does not exist',
    ];
    for (const message of internals) expect(syncErrorText(new SyncError('invalid', message), FALLBACK)).toBe(FALLBACK);
    expect(syncErrorText(new SyncError('invalid', 'Choose the name the others will see first.'), FALLBACK)).toBe(
      'Choose the name the others will see first.',
    );
  });

  it('falls back for anything else, including a very long invalid message', () => {
    expect(syncErrorText(new Error('Shared groups are not available yet.'), FALLBACK)).toBe(FALLBACK);
    expect(syncErrorText(new SyncError('invalid', 'x'.repeat(200)), FALLBACK)).toBe(FALLBACK);
    expect(syncErrorText(undefined, FALLBACK)).toBe(FALLBACK);
    expect(syncErrorText('boom', FALLBACK)).toBe(FALLBACK);
    expect(syncErrorText({ kind: 'weird', message: 'x' }, FALLBACK)).toBe(FALLBACK);
  });
});
