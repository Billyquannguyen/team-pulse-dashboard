create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.dashboard_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'disabled')),
  role text not null default 'member'
    check (role in ('member', 'admin')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_members_approved_by_idx
on public.dashboard_members (approved_by);

create table if not exists private.dashboard_admin_bootstrap (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into private.dashboard_admin_bootstrap (email)
values ('anhquan2016048@gmail.com')
on conflict (email) do nothing;

create or replace function private.is_dashboard_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.dashboard_members
    where user_id = (select auth.uid())
      and status = 'approved'
      and role = 'admin'
  );
$$;

revoke all on function private.is_dashboard_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_dashboard_admin() to authenticated;

create or replace function private.handle_dashboard_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(coalesce(new.email, ''));
  is_bootstrap_admin boolean;
begin
  select exists (
    select 1
    from private.dashboard_admin_bootstrap
    where email = normalized_email
  ) into is_bootstrap_admin;

  insert into public.dashboard_members (
    user_id,
    email,
    display_name,
    status,
    role,
    approved_at
  )
  values (
    new.id,
    normalized_email,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    case when is_bootstrap_admin then 'approved' else 'pending' end,
    case when is_bootstrap_admin then 'admin' else 'member' end,
    case when is_bootstrap_admin then now() else null end
  )
  on conflict (user_id) do update
  set email = excluded.email,
      updated_at = now();

  if is_bootstrap_admin then
    delete from private.dashboard_admin_bootstrap where email = normalized_email;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_dashboard_auth_user()
from public, anon, authenticated;

drop trigger if exists on_dashboard_auth_user_created on auth.users;
create trigger on_dashboard_auth_user_created
after insert on auth.users
for each row execute function private.handle_dashboard_auth_user();

alter table public.dashboard_members enable row level security;

drop policy if exists "Members read own access and admins read all"
on public.dashboard_members;
create policy "Members read own access and admins read all"
on public.dashboard_members
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select private.is_dashboard_admin())
);

drop policy if exists "Admins can update access" on public.dashboard_members;
create policy "Admins can update access"
on public.dashboard_members
for update
to authenticated
using ((select private.is_dashboard_admin()))
with check ((select private.is_dashboard_admin()));

revoke all on table public.dashboard_members from anon;
grant select on table public.dashboard_members to authenticated;
grant update (status, role, approved_at, approved_by, updated_at)
on table public.dashboard_members to authenticated;
