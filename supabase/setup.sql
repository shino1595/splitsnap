-- SplitSnap shared groups (roadmap/05, Option A): one-time setup for a NEW, empty Supabase project.
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- It runs as one transaction: if anything fails, nothing is created. To start over, run
-- supabase/teardown.sql first.
--
-- Design (see roadmap/05_Shared_Groups_Live_Test.md):
--   * Every phone signs in anonymously (Authentication → Providers → Anonymous sign-ins: ON).
--   * Ids are the app's own text ids ('grp_…', 'exp_…'); member ids are the person ids used
--     inside expenses, so the app's split/balance engine works unchanged.
--   * Expenses, payments, comments and activity keep the app's JSON in `data`.
--   * Row Level Security on every table: you only see and change groups you are a member of.
--     Membership checks live in the `private` schema, which the API does not expose.
--   * Deletes are soft (`deleted_at`): live updates of hard deletes would bypass row security.
--   * Joining only happens through join_group(), which adds the caller and nobody else.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id text primary key check (char_length(id) between 1 and 64),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  type text not null default 'other' check (char_length(type) between 1 and 20),
  emoji text not null default '👥' check (char_length(emoji) between 1 and 16),
  default_currency text not null default 'INR' check (char_length(default_currency) = 3),
  simplify_debts boolean not null default true,
  archived boolean not null default false,
  -- 8 characters, set by the insert trigger; reset with reset_join_code().
  join_code text unique,
  join_enabled boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

-- One row per person in a group. user_id is null for a placeholder ("Bhavna" before she joins)
-- and set once a real user joins or claims the row ("That's me").
create table public.group_members (
  group_id text not null references public.groups (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text check (char_length(color) <= 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_id, id)
);
create unique index group_members_one_row_per_user on public.group_members (group_id, user_id) where user_id is not null;
create index group_members_by_user on public.group_members (user_id) where user_id is not null;

create table public.expenses (
  id text primary key check (char_length(id) between 1 and 64),
  group_id text not null references public.groups (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 262144),
  -- The JSON can't claim another id or group than its row (the app also trusts the columns).
  check (coalesce(data ->> 'id', id) = id and coalesce(data ->> 'groupId', group_id) = group_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);
create index expenses_by_group on public.expenses (group_id);

create table public.payments (
  id text primary key check (char_length(id) between 1 and 64),
  group_id text not null references public.groups (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  check (coalesce(data ->> 'id', id) = id and coalesce(data ->> 'groupId', group_id) = group_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);
create index payments_by_group on public.payments (group_id);

-- One row per comment, so two people commenting at once never overwrite each other.
create table public.comments (
  id text primary key check (char_length(id) between 1 and 64),
  group_id text not null references public.groups (id) on delete cascade,
  expense_id text not null references public.expenses (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  check (coalesce(data ->> 'id', id) = id),
  created_at timestamptz not null default now(),
  created_by uuid,
  deleted_at timestamptz
);
create index comments_by_group on public.comments (group_id);

create table public.activity (
  id text primary key check (char_length(id) between 1 and 64),
  group_id text not null references public.groups (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  check (coalesce(data ->> 'id', id) = id and coalesce(data ->> 'groupId', group_id) = group_id),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index activity_by_group on public.activity (group_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Private helpers (the private schema is not exposed through the API)
-- ---------------------------------------------------------------------------------------------

create schema private;
grant usage on schema private to authenticated;

-- Am I a current member of this group?
create function private.is_member(gid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.left_at is null
  );
$$;

-- Am I the creator of this group AND not yet in it? True only while share_group is adding the
-- first member rows (inside that one statement the creator's own new row isn't visible yet).
-- Once the creator has a member row, ordinary membership rules apply, including after leaving.
create function private.is_creator(gid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups g where g.id = gid and g.created_by = (select auth.uid()))
     and not exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = (select auth.uid()));
$$;

-- Do I share a group with this user? (Lets group-mates see each other's display name.)
create function private.shares_group(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and mine.left_at is null and theirs.user_id = other
  );
$$;

-- 8 characters without look-alikes (no I, L, O, 0, 1), from a random UUID's random bytes.
-- Security definer so the uniqueness check sees every group, not just the caller's.
create function private.new_join_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  positions constant int[] := array[0, 1, 2, 3, 4, 5, 9, 10]; -- skips the UUID's version/variant bytes
  bytes bytea;
  code text;
  i int;
begin
  loop
    bytes := uuid_send(gen_random_uuid());
    code := '';
    foreach i in array positions loop
      code := code || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.groups g where g.join_code = code);
  end loop;
  return code;
end;
$$;

-- Server-side stamps: clients can't fake who changed a row or when.
create function private.stamp_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end;
$$;

create function private.stamp_group() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.join_code := private.new_join_code();
    new.join_enabled := true;
  end if;
  return new;
end;
$$;

create function private.stamp_created() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create function private.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stamp_group before insert on public.groups for each row execute function private.stamp_group();
create trigger stamp_change before insert or update on public.groups for each row execute function private.stamp_change();
create trigger stamp_change before insert or update on public.expenses for each row execute function private.stamp_change();
create trigger stamp_change before insert or update on public.payments for each row execute function private.stamp_change();
create trigger stamp_created before insert on public.comments for each row execute function private.stamp_created();
create trigger stamp_created before insert on public.activity for each row execute function private.stamp_created();
create trigger touch before update on public.group_members for each row execute function private.touch();
create trigger touch before update on public.profiles for each row execute function private.touch();

revoke all on all functions in schema private from public, anon;
-- new_join_code is called by the group insert trigger, which runs as the signed-in user.
grant execute on function private.is_member(text), private.is_creator(text), private.shares_group(uuid),
  private.new_join_code() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
alter table public.comments enable row level security;
alter table public.activity enable row level security;

create policy "own and group-mates' profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_group(id));
create policy "create own profile" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members see their groups" on public.groups for select to authenticated
  using (private.is_member(id) or private.is_creator(id));
create policy "anyone signed in creates groups" on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "members edit groups" on public.groups for update to authenticated
  using (private.is_member(id)) with check (private.is_member(id));

-- Your own row stays readable after leaving; is_creator covers share_group's first insert.
create policy "members see members" on public.group_members for select to authenticated
  using (private.is_member(group_id) or user_id = (select auth.uid()) or private.is_creator(group_id));
-- Members (and the creator) add placeholders; only the creator adds a row for themselves.
-- Everyone else joins through join_group().
create policy "members add placeholders" on public.group_members for insert to authenticated
  with check (
    (user_id is null and (private.is_member(group_id) or private.is_creator(group_id)))
    or (user_id = (select auth.uid()) and private.is_creator(group_id))
  );
create policy "members rename members" on public.group_members for update to authenticated
  using (private.is_member(group_id)) with check (private.is_member(group_id));

create policy "members see expenses" on public.expenses for select to authenticated using (private.is_member(group_id));
create policy "members add expenses" on public.expenses for insert to authenticated with check (private.is_member(group_id));
create policy "members edit expenses" on public.expenses for update to authenticated
  using (private.is_member(group_id)) with check (private.is_member(group_id));

create policy "members see payments" on public.payments for select to authenticated using (private.is_member(group_id));
create policy "members add payments" on public.payments for insert to authenticated with check (private.is_member(group_id));
create policy "members edit payments" on public.payments for update to authenticated
  using (private.is_member(group_id)) with check (private.is_member(group_id));

create policy "members see comments" on public.comments for select to authenticated using (private.is_member(group_id));
create policy "members comment" on public.comments for insert to authenticated
  with check (
    private.is_member(group_id)
    and exists (select 1 from public.expenses e where e.id = expense_id and e.group_id = comments.group_id)
  );
create policy "authors edit their comments" on public.comments for update to authenticated
  using (private.is_member(group_id) and created_by = (select auth.uid()))
  with check (private.is_member(group_id) and created_by = (select auth.uid()));

create policy "members see activity" on public.activity for select to authenticated using (private.is_member(group_id));
create policy "members add activity" on public.activity for insert to authenticated with check (private.is_member(group_id));

-- Column-level grants. Ids, stamps, join codes and user links are only set by the triggers and
-- functions in this file. The app writes through share_group / push_changes below: a plain
-- PostgREST upsert would also SET group_id, which has no UPDATE grant on purpose (an expense
-- can't move to another group).
revoke all on public.profiles, public.groups, public.group_members, public.expenses, public.payments,
  public.comments, public.activity from anon, authenticated;
grant select on public.profiles, public.groups, public.group_members, public.expenses, public.payments,
  public.comments, public.activity to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
-- id too, because a PostgREST upsert also SETs the key; the policy pins id to you anyway.
grant update (id, display_name) on public.profiles to authenticated;
grant insert (id, name, type, emoji, default_currency, simplify_debts, archived) on public.groups to authenticated;
grant update (name, type, emoji, default_currency, simplify_debts, archived, deleted_at) on public.groups to authenticated;
grant insert (group_id, id, user_id, name, color) on public.group_members to authenticated;
grant update (name, color) on public.group_members to authenticated;
grant insert (id, group_id, data, deleted_at) on public.expenses, public.payments to authenticated;
grant update (data, deleted_at) on public.expenses, public.payments to authenticated;
grant insert (id, group_id, expense_id, data, deleted_at) on public.comments to authenticated;
grant update (data, deleted_at) on public.comments to authenticated;
grant insert (id, group_id, data) on public.activity to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Functions the app calls (exposed through the API to signed-in users only)
-- ---------------------------------------------------------------------------------------------

-- Upload a local group in one go (all or nothing). Runs as the caller, so every row security
-- rule above still applies. p_me = the member id that is the caller (the app picks a random
-- 'u_…' id); it gets their user id. Returns the join code.
create function public.share_group(p_group jsonb, p_members jsonb, p_expenses jsonb, p_payments jsonb,
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

  insert into public.groups (id, name, type, emoji, default_currency, simplify_debts, archived)
  values (
    gid,
    p_group ->> 'name',
    coalesce(p_group ->> 'type', 'other'),
    coalesce(p_group ->> 'emoji', '👥'),
    coalesce(p_group ->> 'defaultCurrency', 'INR'),
    coalesce((p_group ->> 'simplifyDebts')::boolean, true),
    coalesce((p_group ->> 'archived')::boolean, false)
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

-- Send local changes for shared groups in one transaction. Runs as the caller (row security and
-- column grants apply). p = { groups, members, expenses, payments, comments, activity }, each an
-- array (see docs/SYNC_DESIGN.md). Groups are only updated (created by share_group); members,
-- expenses and payments are inserted or updated; comments and activity are insert-only, so a
-- repeat send is harmless. Returns how many rows of each kind were written. Rows for groups you are
-- not (or no longer) in are skipped, so one stale change can't block the rest.
create function public.push_changes(p jsonb) returns jsonb
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

-- What a code leads to, before joining: the group's name and its members (so you can tap
-- "That's me" on your placeholder). Null when the code is wrong or switched off.
create function public.preview_group(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'emoji', g.emoji,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'claimed', m.user_id is not null) order by m.created_at, m.id)
      from public.group_members m
      where m.group_id = g.id and m.left_at is null
    ), '[]'::jsonb)
  )
  from public.groups g
  where g.join_code = upper(btrim(p_code)) and g.join_enabled and g.deleted_at is null;
$$;

-- Join with a code. With p_member_id = claim that placeholder ("That's me"); without it = join
-- as a new member named p_name (or your profile name). Only ever adds the caller.
-- Returns { groupId, memberId }: the member row that is now you. Someone who was in the group
-- before (even after leaving) always gets their old row back, whatever they asked for.
-- A reinstalled phone is a new user: to reclaim the old row, the project owner first deletes
-- the old anonymous user (Authentication → Users), which turns the row back into a placeholder.
create function public.join_group(p_code text, p_member_id text default null, p_name text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  gid text;
  mid text;
  display text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  select g.id into gid from public.groups g
  where g.join_code = upper(btrim(p_code)) and g.join_enabled and g.deleted_at is null;
  if gid is null then
    raise exception 'That code doesn''t match a group' using errcode = 'P0002';
  end if;

  -- Already in (or coming back after leaving): keep the same member row.
  update public.group_members set left_at = null where group_id = gid and user_id = uid
  returning id into mid;
  if mid is not null then
    return jsonb_build_object('groupId', gid, 'memberId', mid);
  end if;

  if p_member_id is not null then
    update public.group_members set user_id = uid, left_at = null
    where group_id = gid and id = p_member_id and user_id is null
    returning id into mid;
    if mid is null then
      raise exception 'Someone has already claimed that name' using errcode = 'P0001';
    end if;
    return jsonb_build_object('groupId', gid, 'memberId', mid);
  end if;

  select coalesce(nullif(btrim(p_name), ''), (select p.display_name from public.profiles p where p.id = uid), 'Friend')
  into display;
  -- A random id (not derived from the user id), so nobody can block a join by adding a
  -- placeholder with that id first.
  mid := 'u_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.group_members (group_id, id, user_id, name)
  values (gid, mid, uid, left(display, 60));
  return jsonb_build_object('groupId', gid, 'memberId', mid);
end;
$$;

-- Leave a group: your member row stays (expenses still name you) but you stop seeing updates.
create function public.leave_group(p_group_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.group_members set left_at = now()
  where group_id = p_group_id and user_id = (select auth.uid()) and left_at is null;
end;
$$;

-- New join code (old one stops working). p_enabled = false switches joining off.
create function public.reset_join_code(p_group_id text, p_enabled boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  if not private.is_member(p_group_id) then
    raise exception 'You are not in this group' using errcode = '42501';
  end if;
  code := private.new_join_code();
  update public.groups set join_code = code, join_enabled = p_enabled where id = p_group_id;
  return code;
end;
$$;

revoke all on function public.share_group(jsonb, jsonb, jsonb, jsonb, jsonb, text), public.push_changes(jsonb),
  public.preview_group(text), public.join_group(text, text, text), public.leave_group(text),
  public.reset_join_code(text, boolean)
  from public, anon;
grant execute on function public.share_group(jsonb, jsonb, jsonb, jsonb, jsonb, text), public.push_changes(jsonb),
  public.preview_group(text), public.join_group(text, text, text), public.leave_group(text),
  public.reset_join_code(text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Live updates (Supabase Realtime "Postgres Changes"; row security decides who receives what)
-- ---------------------------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.profiles, public.groups, public.group_members, public.expenses, public.payments,
  public.comments, public.activity;

commit;
