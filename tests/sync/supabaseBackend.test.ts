// toSyncError decides whether the engine retries a change or drops it, so a missing session must
// never read as a refusal. (Only the pure mapping: these tests never load supabase-js.)
import { toSyncError } from '../../app/src/sync/supabaseBackend';

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
