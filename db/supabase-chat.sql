-- Project chat schema for the Bit-Unity dashboard.
-- Run this once in the Supabase SQL editor.

create extension if not exists pgcrypto;
create schema if not exists private;

drop function if exists public.dashboard_chat_github_login();

create table if not exists public.project_chat_members (
  project text not null,
  login text not null,
  role text not null check (role in ('owner', 'contributor', 'member')),
  synced_at timestamptz not null default now(),
  primary key (project, login)
);

alter table public.project_chat_members
  drop constraint if exists project_chat_members_role_check;
alter table public.project_chat_members
  add constraint project_chat_members_role_check
  check (role in ('owner', 'contributor', 'member'));

create index if not exists project_chat_members_login_idx
  on public.project_chat_members (login);

create table if not exists public.project_chat_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_login text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_chat_profiles_login_idx
  on public.project_chat_profiles (github_login);

create table if not exists public.project_chat_messages (
  id uuid primary key default gen_random_uuid(),
  project text not null,
  user_login text not null,
  user_name text,
  user_avatar_url text,
  body text not null check (char_length(trim(body)) between 1 and 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create index if not exists project_chat_messages_project_created_idx
  on public.project_chat_messages (project, created_at);

alter table public.project_chat_profiles enable row level security;
alter table public.project_chat_members enable row level security;
alter table public.project_chat_messages enable row level security;

grant usage on schema public to authenticated;
grant select on public.project_chat_profiles to authenticated;
grant select on public.project_chat_members to authenticated;
grant select, insert on public.project_chat_messages to authenticated;

create or replace function public.project_chat_github_login_from_metadata(metadata jsonb)
returns text
language sql
immutable
as $$
  select lower(
    nullif(
      coalesce(
        metadata ->> 'user_name',
        metadata ->> 'preferred_username',
        metadata ->> 'login',
        metadata ->> 'nickname'
      ),
      ''
    )
  );
$$;

drop trigger if exists project_chat_auth_user_created
  on auth.users;
drop function if exists public.sync_project_chat_profile_from_user();

create or replace function private.sync_project_chat_profile_from_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  login text;
  providers jsonb := coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb);
begin
  if new.raw_app_meta_data ->> 'provider' <> 'github'
     and not (providers ? 'github') then
    return new;
  end if;

  login := public.project_chat_github_login_from_metadata(new.raw_user_meta_data);
  if login is null then
    return new;
  end if;

  insert into public.project_chat_profiles (
    user_id,
    github_login,
    display_name,
    avatar_url,
    updated_at
  )
  values (
    new.id,
    login,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      login
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    now()
  )
  on conflict (user_id)
  do update set
    github_login = excluded.github_login,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

create trigger project_chat_auth_user_created
  after insert on auth.users
  for each row
  execute function private.sync_project_chat_profile_from_user();

insert into public.project_chat_profiles (
  user_id,
  github_login,
  display_name,
  avatar_url,
  updated_at
)
select
  users.id,
  public.project_chat_github_login_from_metadata(users.raw_user_meta_data),
  coalesce(
    nullif(users.raw_user_meta_data ->> 'name', ''),
    nullif(users.raw_user_meta_data ->> 'full_name', ''),
    public.project_chat_github_login_from_metadata(users.raw_user_meta_data)
  ),
  nullif(users.raw_user_meta_data ->> 'avatar_url', ''),
  now()
from auth.users as users
where (
    users.raw_app_meta_data ->> 'provider' = 'github'
    or coalesce(users.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'github'
  )
  and public.project_chat_github_login_from_metadata(users.raw_user_meta_data) is not null
on conflict (user_id)
do update set
  github_login = excluded.github_login,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  updated_at = excluded.updated_at;

drop policy if exists "project chat profiles read own row"
  on public.project_chat_profiles;
create policy "project chat profiles read own row"
  on public.project_chat_profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "project chat members read own rows"
  on public.project_chat_members;
create policy "project chat members read own rows"
  on public.project_chat_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.project_chat_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.github_login = project_chat_members.login
    )
  );

drop policy if exists "project chat messages read by project members"
  on public.project_chat_messages;
create policy "project chat messages read by project members"
  on public.project_chat_messages
  for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.project_chat_members member
      join public.project_chat_profiles profile
        on profile.github_login = member.login
      where member.project = project_chat_messages.project
        and profile.user_id = (select auth.uid())
    )
  );

drop policy if exists "project chat messages insert by project members"
  on public.project_chat_messages;
create policy "project chat messages insert by project members"
  on public.project_chat_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.project_chat_members member
      join public.project_chat_profiles profile
        on profile.github_login = member.login
      where member.project = project_chat_messages.project
        and profile.user_id = (select auth.uid())
    )
  );

drop trigger if exists project_chat_sender_trigger
  on public.project_chat_messages;
drop function if exists public.set_project_chat_sender();

create or replace function private.set_project_chat_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_login text;
  sender_name text;
  sender_avatar_url text;
begin
  select profile.github_login, profile.display_name, profile.avatar_url
    into sender_login, sender_name, sender_avatar_url
  from public.project_chat_profiles profile
  where profile.user_id = auth.uid();

  if sender_login is null then
    raise exception 'Verified GitHub profile is required';
  end if;

  if not exists (
    select 1
    from public.project_chat_members member
    where member.project = new.project
      and member.login = sender_login
  ) then
    raise exception 'Not allowed for this project chat';
  end if;

  new.user_login := sender_login;
  new.user_name := coalesce(sender_name, sender_login);
  new.user_avatar_url := sender_avatar_url;
  new.body := trim(new.body);
  new.created_at := coalesce(new.created_at, now());
  return new;
end;
$$;

create trigger project_chat_sender_trigger
  before insert on public.project_chat_messages
  for each row
  execute function private.set_project_chat_sender();

create or replace function public.replace_project_chat_members(
  p_project text,
  p_members jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_project is null or length(trim(p_project)) = 0 then
    raise exception 'p_project is required';
  end if;

  p_project := lower(trim(p_project));

  delete from public.project_chat_members
  where project = p_project;

  insert into public.project_chat_members (project, login, role, synced_at)
  select
    p_project,
    lower(trim(member ->> 'login')),
    case
      when member ->> 'role' = 'owner' then 'owner'
      when member ->> 'role' = 'member' then 'member'
      else 'contributor'
    end,
    now()
  from jsonb_array_elements(p_members) as member
  where nullif(trim(member ->> 'login'), '') is not null
  on conflict (project, login)
  do update set
    role = excluded.role,
    synced_at = excluded.synced_at;
end;
$$;

revoke all on function public.replace_project_chat_members(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_project_chat_members(text, jsonb)
  to service_role;
