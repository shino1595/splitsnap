-- Removes everything supabase/setup.sql created, including ALL shared data. Run in the SQL
-- Editor only to start over (then run setup.sql again). Anonymous users stay under
-- Authentication → Users; delete them there if you want a completely clean project.
begin;

drop function if exists public.share_group(jsonb, jsonb, jsonb, jsonb, jsonb, text);
drop function if exists public.push_changes(jsonb);
drop function if exists public.preview_group(text);
drop function if exists public.join_group(text, text, text);
drop function if exists public.leave_group(text);
drop function if exists public.reset_join_code(text, boolean);

-- Dropping the tables also removes them from the supabase_realtime publication.
drop table if exists public.activity, public.comments, public.payments, public.expenses,
  public.group_members, public.groups, public.profiles cascade;

drop schema if exists private cascade;

commit;
