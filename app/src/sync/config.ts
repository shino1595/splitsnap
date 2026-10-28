// The Supabase project behind shared groups (roadmap/05, docs/SYNC_DESIGN.md). Both values are
// meant to be public: the publishable key can only do what the database's row security allows.
// Never put the secret key (sb_secret_…) or the database password here. Empty = sharing is off.
export const SUPABASE_URL = '';
export const SUPABASE_PUBLISHABLE_KEY = '';

export function isSyncConfigured(): boolean {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL) && SUPABASE_PUBLISHABLE_KEY.indexOf('sb_publishable_') === 0;
}
