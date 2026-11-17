-- Trainingsgruppe App, Teil 1: Konten, Rollen, Einstellungen
-- Einmal komplett im Supabase SQL-Editor ausführen (Projekt → SQL Editor → New query → Run).
-- Das Skript kann gefahrlos erneut ausgeführt werden.
--
-- Rollen:
--   admin    – alles, inkl. Rollen vergeben, Teamname, Backup/Wiederherstellung
--   trainer  – Athleten freischalten, Trainingsgruppen zuordnen, Plan-Sichtbarkeit,
--              Trainingsgruppen (Plan-Blätter) verwalten
--   athlete  – eigenes Profil, sieht freigeschaltete Mitglieder
-- Wer sich als Erstes registriert, wird automatisch Admin.
-- Alle weiteren Konten müssen von Admin oder Trainer freigeschaltet werden.

-- ───────────────────────── Tabellen ─────────────────────────

create table if not exists public.team_settings (
  id              int primary key default 1 check (id = 1),
  team_name       text not null default 'LT DSHS Köln',
  -- 'all': alle sehen alle Pläne · 'assigned': jeder sieht nur seinen zugeordneten Plan
  plan_visibility text not null default 'all' check (plan_visibility in ('all', 'assigned')),
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
insert into public.team_settings (id) values (1) on conflict (id) do nothing;

-- Trainingsgruppen = Blätter im Wochenplan (Kurzsprint, Langsprint, Stab, …)
create table if not exists public.plan_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) between 1 and 60),
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
insert into public.plan_groups (name, sort_order) values
  ('Kurzsprint', 1), ('Langsprint', 2), ('Stab', 3)
on conflict (name) do nothing;

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '' check (length(display_name) <= 60),
  role          text not null default 'athlete' check (role in ('admin', 'trainer', 'athlete')),
  approved      boolean not null default false,
  plan_group_id uuid references public.plan_groups (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ───────────────────────── Hilfsfunktionen ─────────────────────────
-- security definer: lesen die eigene Rolle, ohne an RLS hängen zu bleiben.

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and approved
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'trainer'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- ───────────────────────── Neues Konto → Profil ─────────────────────────

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  perform pg_advisory_xact_lock(841203);
  is_first := not exists (select 1 from public.profiles);
  insert into public.profiles (id, display_name, role, approved)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 60),
    case when is_first then 'admin' else 'athlete' end,
    is_first
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Schutzregeln für Profile ─────────────────────────

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my text := coalesce(public.my_role(), '');
begin
  if me is null then
    return new;  -- SQL-Editor / Service-Rolle: keine Einschränkung
  end if;
  if new.id <> old.id then
    raise exception 'Die ID eines Profils kann nicht geändert werden';
  end if;
  -- Trainingsgruppe wurde gelöscht → Zuordnung wird automatisch geleert (on delete set null)
  if new.plan_group_id is null and old.plan_group_id is not null
     and not exists (select 1 from public.plan_groups where id = old.plan_group_id)
     and (new.display_name, new.role, new.approved) is not distinct from (old.display_name, old.role, old.approved) then
    return new;
  end if;
  if my <> 'admin' then
    if new.role <> old.role then
      raise exception 'Nur Admins dürfen Rollen ändern';
    end if;
    if old.id <> me and old.role <> 'athlete' then
      raise exception 'Nur Admins dürfen Trainer- und Admin-Profile ändern';
    end if;
  end if;
  if my not in ('admin', 'trainer') then
    if new.approved <> old.approved or new.plan_group_id is distinct from old.plan_group_id then
      raise exception 'Freischaltung und Trainingsgruppe dürfen nur Trainer und Admins ändern';
    end if;
  end if;
  if old.role = 'admin' and old.approved and (new.role <> 'admin' or not new.approved)
     and not exists (select 1 from public.profiles where role = 'admin' and approved and id <> old.id) then
    raise exception 'Es muss mindestens einen Admin geben';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

create or replace function public.team_settings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.team_name <> old.team_name and not public.is_admin() then
    raise exception 'Nur Admins dürfen den Teamnamen ändern';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists team_settings_guard on public.team_settings;
create trigger team_settings_guard
  before update on public.team_settings
  for each row execute function public.team_settings_guard();

-- ───────────────────────── Row Level Security ─────────────────────────

alter table public.team_settings enable row level security;
alter table public.plan_groups   enable row level security;
alter table public.profiles      enable row level security;

revoke all on public.team_settings, public.plan_groups, public.profiles from anon;
grant select, update                 on public.team_settings to authenticated;
grant select, insert, update, delete on public.plan_groups   to authenticated;
grant select, update                 on public.profiles      to authenticated;

drop policy if exists "settings: Mitglieder lesen" on public.team_settings;
create policy "settings: Mitglieder lesen" on public.team_settings
  for select to authenticated using (public.is_member());
drop policy if exists "settings: Trainer/Admin ändern" on public.team_settings;
create policy "settings: Trainer/Admin ändern" on public.team_settings
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "gruppen: Mitglieder lesen" on public.plan_groups;
create policy "gruppen: Mitglieder lesen" on public.plan_groups
  for select to authenticated using (public.is_member());
drop policy if exists "gruppen: Trainer/Admin anlegen" on public.plan_groups;
create policy "gruppen: Trainer/Admin anlegen" on public.plan_groups
  for insert to authenticated with check (public.is_staff());
drop policy if exists "gruppen: Trainer/Admin ändern" on public.plan_groups;
create policy "gruppen: Trainer/Admin ändern" on public.plan_groups
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "gruppen: Trainer/Admin löschen" on public.plan_groups;
create policy "gruppen: Trainer/Admin löschen" on public.plan_groups
  for delete to authenticated using (public.is_staff());

-- Eigenes Profil immer; freigeschaltete Profile für Mitglieder; alle für Trainer/Admin
drop policy if exists "profile: lesen" on public.profiles;
create policy "profile: lesen" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff() or (approved and public.is_member()));
-- Feinere Regeln (wer was ändern darf) stehen in profiles_guard
drop policy if exists "profile: ändern" on public.profiles;
create policy "profile: ändern" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_staff())
  with check (id = auth.uid() or public.is_staff());

-- ───────────────────────── Funktionen für die App ─────────────────────────

-- E-Mail-Adressen nur für Trainer und Admins
create or replace function public.member_emails() returns table (id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text from auth.users u where public.is_staff()
$$;

-- Konto löschen: eigenes Konto, als Admin jedes, als Trainer nicht freigeschaltete Athleten
create or replace function public.delete_user(target uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  my text := coalesce(public.my_role(), '');
  t public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  select * into t from public.profiles where id = target;
  if target <> auth.uid() then
    if my = 'admin' then
      null;
    elsif my = 'trainer' and t.role = 'athlete' and not t.approved then
      null;
    else
      raise exception 'Keine Berechtigung, dieses Konto zu löschen';
    end if;
  end if;
  if t.role = 'admin' and t.approved
     and not exists (select 1 from public.profiles where role = 'admin' and approved and id <> target) then
    raise exception 'Der letzte Admin kann nicht gelöscht werden';
  end if;
  delete from auth.users where id = target;
end $$;

revoke execute on function public.member_emails()   from public, anon;
revoke execute on function public.delete_user(uuid) from public, anon;
grant  execute on function public.member_emails()   to authenticated;
grant  execute on function public.delete_user(uuid) to authenticated;
