-- SplitSnap group themes: one-time upgrade for a Supabase project that already ran an older
-- setup.sql (a NEW project needs only setup.sql, which already includes this).
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once, and safe to run before or after phones update: the app sends
-- `theme` inside the JSON that share_group / push_changes read by key, so a server that has not
-- run this file simply ignores it, and a server that has run it never sends a theme the app
-- cannot read. Nothing is deleted or rewritten; existing groups get theme = null (the default look).
--
-- It adds the nullable groups.theme column, lets signed-in users write it (column grants, like
-- the other group columns) and replaces the two functions that write group rows with the same
-- bodies as setup.sql plus the theme. Their signatures and grants are unchanged.

begin;

alter table public.groups
  add column if not exists theme text check (char_length(theme) between 1 and 20);

grant insert (theme) on public.groups to authenticated;
grant update (theme) on public.groups to authenticated;

create or replace function public.share_group(p_group jsonb, p_members jsonb, p_expenses jsonb, p_payments jsonb,
  p_comments jsonb, p_me text)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  gid text := p_group ->> 'id';
  code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) m where m ->> 'id' = p_me) then
    raise exception 'You must be one of the members' using errcode = '22023';
  end if;

  insert into public.groups (id, name, type, emoji, default_currency, simplify_debts, archived, theme)
  values (
    gid,
    p_group ->> 'name',
    coalesce(p_group ->> 'type', 'other'),
    coalesce(p_group ->> 'emoji', '👥'),
    coalesce(p_group ->> 'defaultCurrency', 'INR'),
    coalesce((p_group ->> 'simplifyDebts')::boolean, true),
    coalesce((p_group ->> 'archived')::boolean, false),
    p_group ->> 'theme'
  );

  insert into public.group_members (group_id, id, user_id, name, color)
  select gid, m ->> 'id', case when m ->> 'id' = p_me then (select auth.uid()) end, m ->> 'name', m ->> 'color'
  from jsonb_array_elements(p_members) m;

  insert into public.expenses (id, group_id, data)
  select e ->> 'id', gid, e -> 'data' from jsonb_array_elements(coalesce(p_expenses, '[]'::jsonb)) e;

  insert into public.payments (id, group_id, data)
  select p ->> 'id', gid, p -> 'data' from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) p;

  insert into public.comments (id, group_id, expense_id, data)
  select c ->> 'id', gid, c ->> 'expenseId', c -> 'data' from jsonb_array_elements(coalesce(p_comments, '[]'::jsonb)) c;

  select g.join_code into code from public.groups g where g.id = gid;
  return code;
end;
$$;

create or replace function public.push_changes(p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  n_groups int; n_members int; n_expenses int; n_payments int; n_comments int; n_activity int;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;

  update public.groups g set
    name = coalesce(x ->> 'name', g.name),
    type = coalesce(x ->> 'type', g.type),
    emoji = coalesce(x ->> 'emoji', g.emoji),
    default_currency = coalesce(x ->> 'defaultCurrency', g.default_currency),
    simplify_debts = coalesce((x ->> 'simplifyDebts')::boolean, g.simplify_debts),
    archived = coalesce((x ->> 'archived')::boolean, g.archived),
    theme = coalesce(x ->> 'theme', g.theme),
    deleted_at = case when coalesce((x ->> 'deleted')::boolean, false) then coalesce(g.deleted_at, now()) else g.deleted_at end
  from jsonb_array_elements(coalesce(p -> 'groups', '[]'::jsonb)) x
  where g.id = x ->> 'id';
  get diagnostics n_groups = row_count;

  insert into public.group_members (group_id, id, name, color)
  select x ->> 'groupId', x ->> 'id', x ->> 'name', x ->> 'color'
  from jsonb_array_elements(coalesce(p -> 'members', '[]'::jsonb)) x
  where private.is_member(x ->> 'groupId')
  on conflict (group_id, id) do update set name = excluded.name, color = excluded.color;
  get diagnostics n_members = row_count;

  insert into public.expenses (id, group_id, data, deleted_at)
  select x ->> 'id', x ->> 'groupId', x -> 'data', (x ->> 'deletedAt')::timestamptz
  from jsonb_array_elements(coalesce(p -> 'expenses', '[]'::jsonb)) x
  where private.is_member(x ->> 'groupId')
  on conflict (id) do update set data = excluded.data, deleted_at = excluded.deleted_at
  where public.expenses.group_id = excluded.group_id;
  get diagnostics n_expenses = row_count;

  insert into public.payments (id, group_id, data, deleted_at)
  select x ->> 'id', x ->> 'groupId', x -> 'data', (x ->> 'deletedAt')::timestamptz
  from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) x
  where private.is_member(x ->> 'groupId')
  on conflict (id) do update set data = excluded.data, deleted_at = excluded.deleted_at
  where public.payments.group_id = excluded.group_id;
  get diagnostics n_payments = row_count;

  insert into public.comments (id, group_id, expense_id, data)
  select x ->> 'id', x ->> 'groupId', x ->> 'expenseId', x -> 'data'
  from jsonb_array_elements(coalesce(p -> 'comments', '[]'::jsonb)) x
  where private.is_member(x ->> 'groupId')
  on conflict (id) do nothing;
  get diagnostics n_comments = row_count;

  insert into public.activity (id, group_id, data)
  select x ->> 'id', x ->> 'groupId', x -> 'data'
  from jsonb_array_elements(coalesce(p -> 'activity', '[]'::jsonb)) x
  where private.is_member(x ->> 'groupId')
  on conflict (id) do nothing;
  get diagnostics n_activity = row_count;

  return jsonb_build_object('groups', n_groups, 'members', n_members, 'expenses', n_expenses,
    'payments', n_payments, 'comments', n_comments, 'activity', n_activity);
end;
$$;

commit;
