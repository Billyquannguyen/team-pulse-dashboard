alter table public.dashboard_members
add column if not exists team_member_id text,
add column if not exists linked_at timestamptz,
add column if not exists linked_by uuid references auth.users(id) on delete set null;

alter table public.dashboard_members
drop constraint if exists dashboard_members_team_member_id_valid;

alter table public.dashboard_members
add constraint dashboard_members_team_member_id_valid
check (
  team_member_id is null
  or (char_length(btrim(team_member_id)) between 1 and 80 and team_member_id = btrim(team_member_id))
);

create unique index if not exists dashboard_members_team_member_id_unique_idx
on public.dashboard_members (lower(team_member_id))
where team_member_id is not null;

create index if not exists dashboard_members_linked_by_idx
on public.dashboard_members (linked_by);

create table if not exists private.dashboard_member_link_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  previous_team_member_id text,
  next_team_member_id text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

revoke all on table private.dashboard_member_link_events from public, anon, authenticated;

create or replace function private.audit_dashboard_member_link_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.team_member_id is distinct from new.team_member_id then
    insert into private.dashboard_member_link_events (
      user_id,
      previous_team_member_id,
      next_team_member_id,
      changed_by
    ) values (
      new.user_id,
      old.team_member_id,
      new.team_member_id,
      new.linked_by
    );
  end if;

  return new;
end;
$$;

revoke all on function private.audit_dashboard_member_link_change()
from public, anon, authenticated;

drop trigger if exists audit_dashboard_member_link_change on public.dashboard_members;
create trigger audit_dashboard_member_link_change
after update of team_member_id on public.dashboard_members
for each row execute function private.audit_dashboard_member_link_change();

grant update (team_member_id, linked_at, linked_by)
on table public.dashboard_members to authenticated;
