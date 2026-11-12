-- SplitSnap keep-alive: one-time upgrade for a Supabase project that already ran an older
-- setup.sql (a NEW project needs only setup.sql, which already includes this).
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once. Nothing is deleted or rewritten.
--
-- It adds one function, public.keep_alive(), for the scheduled GitHub job
-- (.github/workflows/keep-alive.yml). The job calls it a few times a day without signing in, so
-- the free project shows database activity and is less likely to be paused. The function counts
-- the groups table (a real table read) and returns the text 'ok': it gives nothing away, and it
-- is the only thing a caller who is not signed in can run.

begin;

create or replace function public.keep_alive() returns text
language sql stable security definer set search_path = '' as $$
  select 'ok'::text from (select count(*) from public.groups) as g;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

commit;
