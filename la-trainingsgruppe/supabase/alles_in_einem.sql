-- Trainingsgruppe App: alle Teile (01–09) in einer Datei
-- Einmal komplett im Supabase SQL-Editor ausführen. Geht für die Ersteinrichtung und für jedes Update:
-- alle Teile dürfen mehrfach laufen, vorhandene Daten bleiben erhalten.
-- Diese Datei wird aus 01_…sql bis 09_…sql zusammengesetzt; Änderungen bitte in den Einzeldateien machen.


-- ═════════════════════════ 01_grundlage.sql ═════════════════════════
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
-- trainiert selbst mit (null = Standard: Athleten ja, Trainer/Admins nein); Details in Teil 4
alter table public.profiles add column if not exists trains boolean;

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
  -- Trainer dürfen fast alles wie Admins; nur Admin-Rechte und Admin-Profile bleiben bei den Admins
  if my = 'trainer' then
    if (new.role = 'admin') <> (old.role = 'admin') then
      raise exception 'Nur Admins dürfen Admin-Rechte vergeben oder entziehen';
    end if;
    if old.id <> me and old.role = 'admin' then
      raise exception 'Nur Admins dürfen Admin-Profile ändern';
    end if;
  elsif my <> 'admin' then
    if new.role <> old.role then
      raise exception 'Nur Trainer und Admins dürfen Rollen ändern';
    end if;
    if old.id <> me then
      raise exception 'Du kannst nur dein eigenes Profil ändern';
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
  if auth.uid() is not null and new.team_name <> old.team_name and not public.is_staff() then
    raise exception 'Nur Trainer und Admins dürfen den Teamnamen ändern';
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

-- Eigenes Profil immer; alle für Trainer/Admin; für Athleten die freigeschalteten Profile –
-- aber keine Admins (die machen nur die Verwaltung), außer ein Admin trainiert selbst mit
drop policy if exists "profile: lesen" on public.profiles;
create policy "profile: lesen" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff()
         or (approved and public.is_member() and (role <> 'admin' or coalesce(trains, false))));
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

-- Konto löschen: eigenes Konto, als Admin jedes, als Trainer alle außer Admins
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
    elsif my = 'trainer' and t.role <> 'admin' then
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


-- ═════════════════════════ 02_plan_termine.sql ═════════════════════════
-- Trainingsgruppe App, Teil 2: Wochenpläne, Übungssammlung, Termine mit Zu- und Absagen
-- Voraussetzung: 01_grundlage.sql wurde ausgeführt.
-- Einmal komplett im Supabase SQL-Editor ausführen. Kann gefahrlos erneut ausgeführt werden.

-- ───────────────────────── Feste Trainingstage ─────────────────────────
-- dow: 1 = Montag … 7 = Sonntag. Gilt für Wochen, deren Termine noch nicht angelegt wurden.
alter table public.team_settings add column if not exists session_template jsonb not null default
  '[{"dow":2,"time":"17:25","location":"LAA"},{"dow":4,"time":"17:55","location":"LAA"},{"dow":6,"time":"09:55","location":"LAA"}]';

create or replace function public.my_group() returns uuid
language sql stable security definer set search_path = public as $$
  select plan_group_id from public.profiles where id = auth.uid() and approved
$$;

-- ───────────────────────── Wochenpläne ─────────────────────────
create table if not exists public.plans (
  id           uuid primary key default gen_random_uuid(),
  valid_from   date not null check (extract(isodow from valid_from) = 1),  -- Montag der Woche, gilt bis zum nächsten Plan
  title        text not null default '' check (length(title) <= 120),
  season       text not null default '',
  goal         text not null default '',
  source_name  text not null default '',
  extra_sheets jsonb not null default '[]',   -- Blätter ohne Wochentage (Übungen, Turnhalle …): [{name, rows}]
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists plans_valid_from_idx on public.plans (valid_from desc, created_at desc);

create table if not exists public.plan_sheets (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  name       text not null,
  group_id   uuid references public.plan_groups (id) on delete set null,
  sort_order int not null default 0,
  data       jsonb not null   -- {days: [{day, info, title, items: [{text, details: [], gap}]}]}
);
create index if not exists plan_sheets_plan_idx on public.plan_sheets (plan_id);

-- ───────────────────────── Übungssammlung ─────────────────────────
create table if not exists public.exercises (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 120),
  abbreviation text not null default '' check (length(abbreviation) <= 30),
  category     text not null default '' check (length(category) <= 60),
  description  text not null default '' check (length(description) <= 4000),
  video_url    text not null default '' check (length(video_url) <= 500),
  video_path   text not null default '',
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists exercises_name_uq on public.exercises (lower(trim(name)));

-- ───────────────────────── Termine ─────────────────────────
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  session_date date not null,
  start_time   time,
  title        text not null default 'Training' check (length(title) <= 80),
  location     text not null default '' check (length(location) <= 80),
  note         text not null default '' check (length(note) <= 500),
  cancelled    boolean not null default false,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists sessions_date_idx on public.sessions (session_date);

-- Wochen, für die die festen Termine schon angelegt wurden (damit gelöschte Termine nicht wiederkommen)
create table if not exists public.session_weeks (week_start date primary key);

-- Zu-/Absage: für alle Mitglieder sichtbar (wer kommt?)
create table if not exists public.attendance (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text check (status in ('yes', 'no')),          -- null = keine Antwort, nur Trainer-Markierung
  coach_mark text check (coach_mark in ('late', 'no_show')), -- nur Trainer/Admin: zu spät / nicht erschienen
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- Absagegrund: nur Trainer, Admins und die Person selbst
create table if not exists public.attendance_private (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reason     text check (reason in ('krank', 'verletzt', 'uni', 'arbeit', 'sonstiges')),
  note       text not null default '' check (length(note) <= 300),
  primary key (session_id, user_id)
);

-- Verlauf jeder Änderung (z. B. erst zugesagt, dann abgesagt): nur Trainer, Admins und die Person selbst
create table if not exists public.attendance_log (
  id         bigint generated by default as identity primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text,
  reason     text,
  coach_mark text,
  changed_by uuid references public.profiles (id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists attendance_log_idx on public.attendance_log (session_id, user_id, at);

-- ───────────────────────── Funktionen ─────────────────────────

-- Legt die festen Termine einer Woche einmalig an (aufrufbar von jedem Mitglied)
create or replace function public.ensure_week(p_week date) returns void
language plpgsql security definer set search_path = public as $$
declare
  tpl jsonb;
  e jsonb;
begin
  if not public.is_member() then raise exception 'Keine Berechtigung'; end if;
  if extract(isodow from p_week) <> 1 then raise exception 'Die Woche muss an einem Montag beginnen'; end if;
  if p_week < (date_trunc('week', current_date)::date - 7) or p_week > (date_trunc('week', current_date)::date + 28) then
    return;  -- nur für die nahe Zukunft
  end if;
  insert into public.session_weeks (week_start) values (p_week) on conflict do nothing;
  if not found then return; end if;
  select session_template into tpl from public.team_settings where id = 1;
  for e in select * from jsonb_array_elements(coalesce(tpl, '[]'::jsonb)) loop
    insert into public.sessions (session_date, start_time, location, created_by)
    values (p_week + ((e ->> 'dow')::int - 1),
            nullif(e ->> 'time', '')::time,
            coalesce(e ->> 'location', ''),
            null);
  end loop;
end $$;

-- Zu- oder Absagen (selbst, oder als Trainer/Admin für andere)
create or replace function public.respond(p_session uuid, p_user uuid, p_status text, p_reason text default null, p_note text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
begin
  if not public.is_member() then raise exception 'Keine Berechtigung'; end if;
  if p_user <> auth.uid() and not public.is_staff() then raise exception 'Du kannst nur für dich selbst zu- oder absagen'; end if;
  if p_status not in ('yes', 'no') then raise exception 'Ungültiger Status'; end if;
  if p_status = 'no' and coalesce(p_reason, '') = '' then raise exception 'Bitte wähle einen Absagegrund'; end if;
  if p_status = 'no' and p_reason = 'sonstiges' and coalesce(trim(p_note), '') = '' then raise exception 'Bitte beschreibe kurz den Grund'; end if;
  select * into s from public.sessions where id = p_session;
  if s.id is null then raise exception 'Termin nicht gefunden'; end if;
  if s.cancelled then raise exception 'Dieser Termin ist abgesagt'; end if;
  if not exists (select 1 from public.profiles where id = p_user and approved) then raise exception 'Person nicht gefunden'; end if;

  insert into public.attendance (session_id, user_id, status, updated_at)
  values (p_session, p_user, p_status, now())
  on conflict (session_id, user_id) do update set status = excluded.status, updated_at = now();

  if p_status = 'no' then
    insert into public.attendance_private (session_id, user_id, reason, note)
    values (p_session, p_user, p_reason, left(coalesce(p_note, ''), 300))
    on conflict (session_id, user_id) do update set reason = excluded.reason, note = excluded.note;
  else
    delete from public.attendance_private where session_id = p_session and user_id = p_user;
  end if;

  insert into public.attendance_log (session_id, user_id, status, reason, changed_by)
  values (p_session, p_user, p_status, case when p_status = 'no' then p_reason end, auth.uid());
end $$;

-- Trainer/Admin: zu spät / nicht erschienen markieren (p_mark null = Markierung entfernen)
create or replace function public.set_mark(p_session uuid, p_user uuid, p_mark text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Nur Trainer und Admins können markieren'; end if;
  if p_mark is not null and p_mark not in ('late', 'no_show') then raise exception 'Ungültige Markierung'; end if;
  if p_mark is not null and public.in_pause((select session_date from public.sessions where id = p_session)) then
    raise exception 'In der Saisonpause findet kein Training statt';
  end if;
  insert into public.attendance (session_id, user_id, coach_mark, updated_at)
  values (p_session, p_user, p_mark, now())
  on conflict (session_id, user_id) do update set coach_mark = excluded.coach_mark, updated_at = now();
  insert into public.attendance_log (session_id, user_id, coach_mark, changed_by)
  values (p_session, p_user, coalesce(p_mark, 'none'), auth.uid());
end $$;

revoke execute on function public.ensure_week(date) from public, anon;
revoke execute on function public.respond(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.set_mark(uuid, uuid, text) from public, anon;
grant execute on function public.ensure_week(date) to authenticated;
grant execute on function public.respond(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.set_mark(uuid, uuid, text) to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists exercises_touch on public.exercises;
create trigger exercises_touch before update on public.exercises for each row execute function public.touch_updated_at();

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.plans              enable row level security;
alter table public.plan_sheets        enable row level security;
alter table public.exercises          enable row level security;
alter table public.sessions           enable row level security;
alter table public.session_weeks      enable row level security;
alter table public.attendance         enable row level security;
alter table public.attendance_private enable row level security;
alter table public.attendance_log     enable row level security;

revoke all on public.plans, public.plan_sheets, public.exercises, public.sessions, public.session_weeks,
  public.attendance, public.attendance_private, public.attendance_log from anon;
grant select, insert, update, delete on public.plans, public.plan_sheets, public.exercises, public.sessions to authenticated;
grant select, insert on public.session_weeks to authenticated;
-- Zu-/Absagen laufen über respond()/set_mark(); direktes Schreiben nur für Admins (Backup-Wiederherstellung)
grant select, insert, update on public.attendance, public.attendance_private to authenticated;
grant select, insert on public.attendance_log to authenticated;

-- Pläne
drop policy if exists "plaene: Mitglieder lesen" on public.plans;
create policy "plaene: Mitglieder lesen" on public.plans for select to authenticated using (public.is_member());
drop policy if exists "plaene: Trainer/Admin schreiben" on public.plans;
create policy "plaene: Trainer/Admin schreiben" on public.plans for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Planblätter: je nach Einstellung alle, oder nur das Blatt der eigenen Trainingsgruppe
drop policy if exists "blaetter: lesen" on public.plan_sheets;
create policy "blaetter: lesen" on public.plan_sheets for select to authenticated using (
  public.is_staff()
  or (public.is_member() and (
        (select plan_visibility from public.team_settings where id = 1) = 'all'
        or group_id = public.my_group())));
drop policy if exists "blaetter: Trainer/Admin schreiben" on public.plan_sheets;
create policy "blaetter: Trainer/Admin schreiben" on public.plan_sheets for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Übungen: alle lesen und hinzufügen; ändern/löschen eigene, Trainer/Admin alle
drop policy if exists "uebungen: lesen" on public.exercises;
create policy "uebungen: lesen" on public.exercises for select to authenticated using (public.is_member());
drop policy if exists "uebungen: anlegen" on public.exercises;
create policy "uebungen: anlegen" on public.exercises for insert to authenticated
  with check (public.is_staff());   -- Übungen legen nur Trainer/Admins an
drop policy if exists "uebungen: ändern" on public.exercises;
create policy "uebungen: ändern" on public.exercises for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "uebungen: löschen" on public.exercises;
create policy "uebungen: löschen" on public.exercises for delete to authenticated
  using (public.is_staff());

-- Termine
drop policy if exists "termine: lesen" on public.sessions;
create policy "termine: lesen" on public.sessions for select to authenticated using (public.is_member());
drop policy if exists "termine: Trainer/Admin schreiben" on public.sessions;
create policy "termine: Trainer/Admin schreiben" on public.sessions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "wochen: lesen" on public.session_weeks;
create policy "wochen: lesen" on public.session_weeks for select to authenticated using (public.is_member());
drop policy if exists "wochen: Admin schreiben" on public.session_weeks;
create policy "wochen: Admin schreiben" on public.session_weeks for insert to authenticated with check (public.is_admin());

drop policy if exists "zusagen: lesen" on public.attendance;
create policy "zusagen: lesen" on public.attendance for select to authenticated using (public.is_member());
drop policy if exists "zusagen: Admin schreiben" on public.attendance;
create policy "zusagen: Admin schreiben" on public.attendance for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "gruende: lesen" on public.attendance_private;
create policy "gruende: lesen" on public.attendance_private for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "gruende: Admin schreiben" on public.attendance_private;
create policy "gruende: Admin schreiben" on public.attendance_private for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "verlauf: lesen" on public.attendance_log;
create policy "verlauf: lesen" on public.attendance_log for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "verlauf: Admin schreiben" on public.attendance_log;
create policy "verlauf: Admin schreiben" on public.attendance_log for insert to authenticated
  with check (public.is_admin());

-- ───────────────────────── Videos zu Übungen (Supabase Storage) ─────────────────────────
-- Privater Speicher, max. 50 MB pro Video. Abspielen nur für angemeldete Mitglieder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uebungen', 'uebungen', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do nothing;

drop policy if exists "uebungsvideos: lesen" on storage.objects;
create policy "uebungsvideos: lesen" on storage.objects for select to authenticated
  using (bucket_id = 'uebungen' and public.is_member());
drop policy if exists "uebungsvideos: hochladen" on storage.objects;
create policy "uebungsvideos: hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'uebungen' and public.is_staff());
drop policy if exists "uebungsvideos: löschen" on storage.objects;
create policy "uebungsvideos: löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'uebungen' and public.is_staff());


-- ═════════════════════════ 03_leistung.sql ═════════════════════════
-- Trainingsgruppe App, Teil 3: Testwochen, Normen, Verletzungen, Wettkämpfe, Saisonkalender
-- Voraussetzung: 01_grundlage.sql und 02_plan_termine.sql wurden ausgeführt.
-- Einmal komplett im Supabase SQL-Editor ausführen. Kann gefahrlos erneut ausgeführt werden.

-- ───────────────────────── Athleten-Infos (nur Trainer/Admin und die Person selbst) ─────────────────────────
create table if not exists public.athlete_info (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  sex            text check (sex in ('m', 'w')),            -- für die Normen (Jungs / Mädels)
  norm_group_ids uuid[] not null default '{}',              -- weitere Trainingsgruppen, deren Normen gelten (z. B. Kurz- und Langsprint)
  updated_at     timestamptz not null default now()
);

-- Verletzungen / Pausen: individuell, ob Training und/oder Tests entfallen
create table if not exists public.injuries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  start_date         date not null,
  end_date           date,                                   -- leer = noch verletzt
  note               text not null default '' check (length(note) <= 300),
  exclude_attendance boolean not null default true,          -- zählt nicht in die Trainingsbeteiligung
  exclude_tests      boolean not null default true,          -- fehlende Tests / Normen werden nicht angerechnet
  created_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists injuries_user_idx on public.injuries (user_id);

-- ───────────────────────── Tests und Normen ─────────────────────────
create table if not exists public.test_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) between 1 and 60),
  unit       text not null default '' check (length(unit) <= 12),
  category   text not null default 'sonstiges' check (category in ('sprint', 'sprung', 'kraft', 'sonstiges')),
  better     text not null default 'higher' check (better in ('higher', 'lower')),
  sides      boolean not null default false,               -- links/rechts getrennt (z. B. 5er Hop)
  entry      text not null default 'staff' check (entry in ('staff', 'self')),  -- wer einträgt
  note       text not null default '' check (length(note) <= 200),
  sort_order int not null default 0,
  active     boolean not null default true
);

-- Vorlagen nur bei der Ersteinrichtung (leere Tabelle), damit gelöschte oder umbenannte Tests nicht wiederkommen
insert into public.test_types (name, unit, category, better, sides, entry, note, sort_order)
select * from (values
  ('30m fliegend',      's',  'sprint', 'lower',  false, 'staff', '30m Anlauf', 10),
  ('80m',               's',  'sprint', 'lower',  false, 'staff', 'Kurzsprint', 11),
  ('300m',              's',  'sprint', 'lower',  false, 'staff', 'Langsprint', 12),
  ('5er Hop',           'm',  'sprung', 'higher', true,  'staff', 'aus dem Stand, bester Versuch je Bein', 20),
  ('10er SPL',          'm',  'sprung', 'higher', false, 'staff', '', 21),
  ('Standweitsprung',   'm',  'sprung', 'higher', false, 'staff', '', 22),
  ('Schocken vorwärts', 'm',  'sprung', 'higher', false, 'staff', '', 23),
  ('Schocken rückwärts','m',  'sprung', 'higher', false, 'staff', '', 24),
  ('Reißen',            'kg', 'kraft',  'higher', false, 'self',  '1RM', 30),
  ('Umsetzen',          'kg', 'kraft',  'higher', false, 'self',  '1RM', 31),
  ('Kniebeuge',         'kg', 'kraft',  'higher', false, 'self',  '1RM', 32),
  ('Trapbar-Kreuzheben','kg', 'kraft',  'higher', false, 'self',  '1RM', 33),
  ('OBS',               'kg', 'kraft',  'higher', false, 'self',  '1RM Oberschenkelstrecker Maschine', 34),
  ('OBB',               'kg', 'kraft',  'higher', false, 'self',  '1RM Oberschenkelbeuger Maschine', 35),
  ('Bankdrücken',       'kg', 'kraft',  'higher', false, 'self',  '1RM', 36),
  ('Bankzug',           'kg', 'kraft',  'higher', false, 'self',  '1RM', 37),
  ('Schulterdrücken',   'kg', 'kraft',  'higher', false, 'self',  '1RM', 38),
  ('Klimmzug',          'kg', 'kraft',  'higher', false, 'self',  'Zusatzgewicht bei 1RM', 39),
  ('Dips',              'kg', 'kraft',  'higher', false, 'self',  'Zusatzgewicht bei 1RM', 40)
) v (name, unit, category, better, sides, entry, note, sort_order)
where not exists (select 1 from public.test_types)
on conflict (name) do nothing;

-- Norm je Test und Geschlecht; optional nur für eine Trainingsgruppe (z. B. 80m nur Kurzsprint)
create table if not exists public.norms (
  id       uuid primary key default gen_random_uuid(),
  test_id  uuid not null references public.test_types (id) on delete cascade,
  sex      text not null check (sex in ('m', 'w')),
  group_id uuid references public.plan_groups (id) on delete cascade,
  value    numeric not null,
  unique nulls not distinct (test_id, sex, group_id)
);

-- Gruppenvoraussetzungen aus der Testwoche vom Herbst 2026
insert into public.norms (test_id, sex, group_id, value)
select t.id, n.sex, g.id, n.value
from (values
  ('30m fliegend', 'm', null, 3.40), ('30m fliegend', 'w', null, 3.65),
  ('80m', 'm', 'Kurzsprint', 9.9),   ('80m', 'w', 'Kurzsprint', 10.7),
  ('300m', 'm', 'Langsprint', 40.1), ('300m', 'w', 'Langsprint', 45.3),
  ('Standweitsprung', 'm', null, 2.65), ('Standweitsprung', 'w', null, 2.35)
) as n (test, sex, grp, value)
join public.test_types t on t.name = n.test
left join public.plan_groups g on g.name = n.grp
where (n.grp is null or g.id is not null)
  and not exists (select 1 from public.norms)   -- nur bei der Ersteinrichtung
on conflict do nothing;

create table if not exists public.test_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  test_id     uuid not null references public.test_types (id) on delete cascade,
  test_date   date not null,
  value       numeric,          -- Wert bzw. bestes Bein
  value_left  numeric,
  value_right numeric,
  note        text not null default '' check (length(note) <= 200),
  entered_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (value is not null or value_left is not null or value_right is not null)
);
create index if not exists test_results_user_idx on public.test_results (user_id, test_id, test_date);

-- Bei links/rechts zählt für den Normabgleich das bessere Bein
create or replace function public.test_results_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b text; s boolean;
begin
  select better, sides into b, s from public.test_types where id = new.test_id;
  if s and (new.value_left is not null or new.value_right is not null) then
    new.value := case when b = 'lower' then least(new.value_left, new.value_right)
                      else greatest(new.value_left, new.value_right) end;
  end if;
  if new.value is null then raise exception 'Bitte einen Wert eintragen'; end if;
  return new;
end $$;
drop trigger if exists test_results_fill on public.test_results;
create trigger test_results_fill before insert or update on public.test_results
  for each row execute function public.test_results_fill();

create or replace function public.test_is_self(p_test uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select entry = 'self' from public.test_types where id = p_test), false)
$$;

-- ───────────────────────── Saisonkalender & Wettkämpfe ─────────────────────────
create table if not exists public.calendar_entries (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('phase', 'wettkampf', 'testwoche', 'sonstiges')),
  title      text not null check (length(trim(title)) between 1 and 120),
  start_date date not null,
  end_date   date,
  location   text not null default '' check (length(location) <= 120),
  note       text not null default '' check (length(note) <= 500),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists calendar_start_idx on public.calendar_entries (start_date);

create table if not exists public.competition_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  entry_id    uuid references public.calendar_entries (id) on delete set null,
  comp_date   date not null,
  comp_name   text not null check (length(trim(comp_name)) between 1 and 120),
  discipline  text not null check (length(trim(discipline)) between 1 and 60),
  result      text not null check (length(trim(result)) between 1 and 30),  -- wie eingegeben, z. B. 10,85 oder 1:52,30
  value       numeric,                                                       -- in Sekunden bzw. Metern, für Bestleistungen
  better      text not null default 'lower' check (better in ('higher', 'lower')),
  place       text not null default '' check (length(place) <= 20),
  wind        text not null default '' check (length(wind) <= 10),
  note        text not null default '' check (length(note) <= 300),
  entered_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists competition_results_user_idx on public.competition_results (user_id, discipline);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.athlete_info        enable row level security;
alter table public.injuries            enable row level security;
alter table public.test_types          enable row level security;
alter table public.norms               enable row level security;
alter table public.test_results        enable row level security;
alter table public.calendar_entries    enable row level security;
alter table public.competition_results enable row level security;

revoke all on public.athlete_info, public.injuries, public.test_types, public.norms, public.test_results,
  public.calendar_entries, public.competition_results from anon;
grant select, insert, update, delete on public.athlete_info, public.injuries, public.test_types, public.norms,
  public.test_results, public.calendar_entries, public.competition_results to authenticated;
revoke execute on function public.test_is_self(uuid) from public, anon;
grant execute on function public.test_is_self(uuid) to authenticated;

-- Athleten-Infos und Verletzungen: lesen Trainer/Admin und die Person selbst; schreiben nur Trainer/Admin
drop policy if exists "athleteninfo: lesen" on public.athlete_info;
create policy "athleteninfo: lesen" on public.athlete_info for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "athleteninfo: Trainer/Admin schreiben" on public.athlete_info;
create policy "athleteninfo: Trainer/Admin schreiben" on public.athlete_info for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "verletzungen: lesen" on public.injuries;
create policy "verletzungen: lesen" on public.injuries for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "verletzungen: Trainer/Admin schreiben" on public.injuries;
create policy "verletzungen: Trainer/Admin schreiben" on public.injuries for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Tests und Normen: alle Mitglieder lesen; Trainer/Admin pflegen
drop policy if exists "tests: lesen" on public.test_types;
create policy "tests: lesen" on public.test_types for select to authenticated using (public.is_member());
drop policy if exists "tests: Trainer/Admin schreiben" on public.test_types;
create policy "tests: Trainer/Admin schreiben" on public.test_types for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "normen: lesen" on public.norms;
create policy "normen: lesen" on public.norms for select to authenticated using (public.is_member());
drop policy if exists "normen: Trainer/Admin schreiben" on public.norms;
create policy "normen: Trainer/Admin schreiben" on public.norms for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Testergebnisse: eigene + Trainer/Admin lesen. Krafttests trägt jeder selbst ein, Sprint/Sprung nur Trainer/Admin.
drop policy if exists "testwerte: lesen" on public.test_results;
create policy "testwerte: lesen" on public.test_results for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "testwerte: eintragen" on public.test_results;
create policy "testwerte: eintragen" on public.test_results for insert to authenticated
  with check (public.is_staff() or (public.is_member() and user_id = auth.uid() and public.test_is_self(test_id)));
drop policy if exists "testwerte: ändern" on public.test_results;
create policy "testwerte: ändern" on public.test_results for update to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid() and entered_by = auth.uid() and public.test_is_self(test_id)))
  with check (public.is_staff() or (public.is_member() and user_id = auth.uid() and public.test_is_self(test_id)));
drop policy if exists "testwerte: löschen" on public.test_results;
create policy "testwerte: löschen" on public.test_results for delete to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid() and entered_by = auth.uid() and public.test_is_self(test_id)));

-- Kalender: alle lesen; Trainer/Admin pflegen
drop policy if exists "kalender: lesen" on public.calendar_entries;
create policy "kalender: lesen" on public.calendar_entries for select to authenticated using (public.is_member());
drop policy if exists "kalender: Trainer/Admin schreiben" on public.calendar_entries;
create policy "kalender: Trainer/Admin schreiben" on public.calendar_entries for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Wettkampfergebnisse: alle lesen; eigene eintragen/ändern; Trainer/Admin alle
drop policy if exists "wettkampf: lesen" on public.competition_results;
create policy "wettkampf: lesen" on public.competition_results for select to authenticated using (public.is_member());
drop policy if exists "wettkampf: eintragen" on public.competition_results;
create policy "wettkampf: eintragen" on public.competition_results for insert to authenticated
  with check (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "wettkampf: ändern" on public.competition_results;
create policy "wettkampf: ändern" on public.competition_results for update to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()))
  with check (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "wettkampf: löschen" on public.competition_results;
create policy "wettkampf: löschen" on public.competition_results for delete to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));


-- ═════════════════════════ 04_anmeldung.sql ═════════════════════════
-- Trainingsgruppe App, Teil 4: Wöchentliche Freigabe der Trainingsanmeldung, Abwesenheit von Trainern,
-- "trainiert selbst mit" für Admins/Trainer.
-- Voraussetzung: Teil 1–3 wurden ausgeführt. Einmal komplett im SQL-Editor ausführen; kann erneut ausgeführt werden.

-- ───────────────────────── Wer trainiert mit? ─────────────────────────
-- null = Standard: Athleten trainieren mit, Trainer/Admins nicht. true/false überschreibt das (z. B. Admin, der selbst trainiert).
alter table public.profiles add column if not exists trains boolean;

-- Selbst darf jeder "trainiert mit" ändern; sonst gelten die Regeln aus profiles_guard (Teil 1) unverändert.

-- ───────────────────────── Freigabe der Anmeldung je Woche ─────────────────────────
create table if not exists public.week_openings (
  week_start date primary key check (extract(isodow from week_start) = 1),
  opened_at  timestamptz not null default now(),
  opened_by  uuid default auth.uid() references public.profiles (id) on delete set null
);
-- Bereits angelegte Wochen bleiben offen, damit laufende Zu-/Absagen weiter funktionieren
insert into public.week_openings (week_start, opened_at, opened_by)
select week_start, now(), null from public.session_weeks on conflict do nothing;

-- Automatische Freigabe: null = nur von Hand; sonst {"dow": 7, "time": "18:00"} (7 = Sonntag vor der Woche, 1 = Montag der Woche)
alter table public.team_settings add column if not exists registration_auto jsonb;

create or replace function public.week_open_at(p_week date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when a is null then null
    else ((p_week + (case when (a ->> 'dow')::int = 1 then 0 else (a ->> 'dow')::int - 8 end))::timestamp
          + coalesce(nullif(a ->> 'time', ''), '00:00')::time) at time zone 'Europe/Berlin' end
  from (select registration_auto as a from public.team_settings where id = 1) s
$$;

create or replace function public.week_is_open(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.week_openings where week_start = date_trunc('week', p_date)::date)
      or coalesce(now() >= public.week_open_at(date_trunc('week', p_date)::date), false)
$$;

create or replace function public.open_week(p_week date, p_open boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Nur Trainer und Admins können die Anmeldung öffnen'; end if;
  if extract(isodow from p_week) <> 1 then raise exception 'Die Woche muss an einem Montag beginnen'; end if;
  if p_open then
    insert into public.week_openings (week_start) values (p_week) on conflict do nothing;
  else
    delete from public.week_openings where week_start = p_week;
  end if;
end $$;

-- ───────────────────────── Absagegrund "Fortbildung", Grund für Trainer freiwillig ─────────────────────────
alter table public.attendance_private drop constraint if exists attendance_private_reason_check;
alter table public.attendance_private add constraint attendance_private_reason_check
  check (reason in ('krank', 'verletzt', 'uni', 'arbeit', 'urlaub', 'heimat', 'fortbildung', 'sonstiges'));

create or replace function public.respond(p_session uuid, p_user uuid, p_status text, p_reason text default null, p_note text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
  target public.profiles;
  coach boolean;
begin
  if not public.is_member() then raise exception 'Keine Berechtigung'; end if;
  if p_user <> auth.uid() and not public.is_staff() then raise exception 'Du kannst nur für dich selbst zu- oder absagen'; end if;
  if p_status not in ('yes', 'no') then raise exception 'Ungültiger Status'; end if;
  select * into target from public.profiles where id = p_user and approved;
  if target.id is null then raise exception 'Person nicht gefunden'; end if;
  coach := target.role in ('admin', 'trainer') and not coalesce(target.trains, false);
  if p_status = 'no' and not coach and coalesce(p_reason, '') = '' then raise exception 'Bitte wähle einen Absagegrund'; end if;
  if p_status = 'no' and p_reason = 'sonstiges' and not coach and coalesce(trim(p_note), '') = '' then raise exception 'Bitte beschreibe kurz den Grund'; end if;
  if p_reason is not null and p_reason not in ('krank', 'verletzt', 'uni', 'arbeit', 'urlaub', 'heimat', 'fortbildung', 'sonstiges') then raise exception 'Ungültiger Grund'; end if;
  select * into s from public.sessions where id = p_session;
  if s.id is null then raise exception 'Termin nicht gefunden'; end if;
  if s.cancelled then raise exception 'Dieser Termin ist abgesagt'; end if;
  if public.in_pause(s.session_date) then raise exception 'In der Saisonpause findet kein Training statt'; end if;
  if not public.is_staff() and not public.week_is_open(s.session_date) then
    raise exception 'Die Anmeldung für diese Woche ist noch nicht geöffnet';
  end if;

  insert into public.attendance (session_id, user_id, status, updated_at)
  values (p_session, p_user, p_status, now())
  on conflict (session_id, user_id) do update set status = excluded.status, updated_at = now();

  if p_status = 'no' and (coalesce(p_reason, '') <> '' or coalesce(trim(p_note), '') <> '') then
    insert into public.attendance_private (session_id, user_id, reason, note)
    values (p_session, p_user, nullif(p_reason, ''), left(coalesce(p_note, ''), 300))
    on conflict (session_id, user_id) do update set reason = excluded.reason, note = excluded.note;
  else
    delete from public.attendance_private where session_id = p_session and user_id = p_user;
  end if;

  insert into public.attendance_log (session_id, user_id, status, reason, changed_by)
  values (p_session, p_user, p_status, case when p_status = 'no' then nullif(p_reason, '') end, auth.uid());
end $$;

-- Trainer können ihre Zu-/Absage auch wieder zurücknehmen ("doch da")
create or replace function public.clear_response(p_session uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and not public.is_staff() then raise exception 'Keine Berechtigung'; end if;
  if not public.is_member() then raise exception 'Keine Berechtigung'; end if;
  update public.attendance set status = null, updated_at = now() where session_id = p_session and user_id = p_user;
  delete from public.attendance_private where session_id = p_session and user_id = p_user;
  insert into public.attendance_log (session_id, user_id, status, changed_by) values (p_session, p_user, 'cleared', auth.uid());
end $$;

revoke execute on function public.respond(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.open_week(date, boolean) from public, anon;
revoke execute on function public.clear_response(uuid, uuid) from public, anon;
revoke execute on function public.week_is_open(date) from public, anon;
revoke execute on function public.week_open_at(date) from public, anon;
grant execute on function public.respond(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.open_week(date, boolean) to authenticated;
grant execute on function public.clear_response(uuid, uuid) to authenticated;
grant execute on function public.week_is_open(date) to authenticated;
grant execute on function public.week_open_at(date) to authenticated;

alter table public.week_openings enable row level security;
revoke all on public.week_openings from anon;
grant select, insert, delete on public.week_openings to authenticated;
drop policy if exists "freigabe: lesen" on public.week_openings;
create policy "freigabe: lesen" on public.week_openings for select to authenticated using (public.is_member());
drop policy if exists "freigabe: Admin wiederherstellen" on public.week_openings;
create policy "freigabe: Admin wiederherstellen" on public.week_openings for insert to authenticated with check (public.is_admin());


-- ═════════════════════════ 05_feedback.sql ═════════════════════════
-- Trainingsgruppe App, Teil 5: Feedback in der App und Beta-Kennzeichnung
-- Voraussetzung: Teil 1–4 wurden ausgeführt. Einmal komplett im SQL-Editor ausführen; kann erneut ausgeführt werden.

alter table public.team_settings add column if not exists beta boolean not null default true;

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  category    text not null default 'idee' check (category in ('fehler', 'idee', 'sonstiges')),
  message     text not null check (length(trim(message)) between 1 and 2000),
  context     text not null default '' check (length(context) <= 200),   -- wo in der App (automatisch)
  app_version text not null default '' check (length(app_version) <= 40),
  device      text not null default '' check (length(device) <= 200),
  status      text not null default 'neu' check (status in ('neu', 'erledigt')),
  admin_note  text not null default '' check (length(admin_note) <= 1000),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

-- Status und Antwort dürfen nur Trainer und Admins ändern; Text nur die Person selbst
create or replace function public.feedback_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.is_staff() and (new.status <> old.status or new.admin_note <> old.admin_note) then
    raise exception 'Nur Trainer und Admins können den Status ändern';
  end if;
  if old.user_id <> auth.uid() and (new.message <> old.message or new.category <> old.category) then
    raise exception 'Nur die Person selbst kann ihr Feedback ändern';
  end if;
  if new.user_id <> old.user_id then raise exception 'Nicht erlaubt'; end if;
  return new;
end $$;
drop trigger if exists feedback_guard on public.feedback;
create trigger feedback_guard before update on public.feedback for each row execute function public.feedback_guard();

alter table public.feedback enable row level security;
revoke all on public.feedback from anon;
grant select, insert, update, delete on public.feedback to authenticated;

-- Eigenes Feedback sehen alle; alles sehen Trainer und Admins
drop policy if exists "feedback: lesen" on public.feedback;
create policy "feedback: lesen" on public.feedback for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "feedback: schreiben" on public.feedback;
create policy "feedback: schreiben" on public.feedback for insert to authenticated
  with check (public.is_member() and (user_id = auth.uid() or public.is_staff()));
drop policy if exists "feedback: ändern" on public.feedback;
create policy "feedback: ändern" on public.feedback for update to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()))
  with check (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "feedback: löschen" on public.feedback;
create policy "feedback: löschen" on public.feedback for delete to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));


-- ═════════════════════════ 06_planzuordnung_statistik.sql ═════════════════════════
-- Trainingsgruppe App, Teil 6: Planblätter für einzelne Personen (Alternativpläne) und
-- Verdichtung alter Trainings zu einer Wochenstatistik.
-- Voraussetzung: Teil 1–5 wurden ausgeführt. Einmal komplett im SQL-Editor ausführen; kann erneut ausgeführt werden.

-- ───────────────────────── Planblätter auch für einzelne Personen ─────────────────────────
-- Ein Blatt gilt für eine Trainingsgruppe und/oder für einzelne Personen (z. B. Alternativplan bei Verletzung).
alter table public.plan_sheets add column if not exists user_ids uuid[] not null default '{}';

drop policy if exists "blaetter: lesen" on public.plan_sheets;
create policy "blaetter: lesen" on public.plan_sheets for select to authenticated using (
  public.is_staff()
  or (public.is_member() and (
        (select plan_visibility from public.team_settings where id = 1) = 'all'
        or group_id = public.my_group()
        or auth.uid() = any (user_ids))));

-- ───────────────────────── Wochenstatistik statt alter Einzeltermine ─────────────────────────
-- Trainings, die älter als 14 Tage sind, werden je Person und Woche zusammengezählt und danach gelöscht
-- (mitsamt Zu-/Absagen, Absagegründen und Verlauf). Erhalten bleiben nur die Zahlen.
create table if not exists public.attendance_weekly (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  counted    int not null default 0,   -- gezählte Trainings (ohne Verletzungszeiten)
  attended   int not null default 0,   -- da gewesen
  n_yes      int not null default 0,   -- zugesagt
  n_no       int not null default 0,   -- abgesagt
  n_open     int not null default 0,   -- keine Antwort
  n_late     int not null default 0,
  n_no_show  int not null default 0,
  n_flipped  int not null default 0,   -- erst zu-, dann abgesagt
  n_skipped  int not null default 0,   -- wegen Verletzung nicht gezählt
  reasons    jsonb not null default '{}',  -- Anzahl je Absagegrund, ohne Freitext
  primary key (user_id, week_start)
);
-- Absagen wegen Urlaub oder Heimatbesuch zählen nicht als Fehlen
alter table public.attendance_weekly add column if not exists n_excused int not null default 0;

create or replace function public.jsonb_sum(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from (select k, sum(v)::int v from (
          select key k, value::int v from jsonb_each_text(coalesce(a, '{}'))
          union all select key, value::int from jsonb_each_text(coalesce(b, '{}'))) x group by k) y
$$;

create or replace function public.compact_attendance(p_keep_days int default 14) returns int
language plpgsql security definer set search_path = public as $$
declare
  cutoff date := current_date - p_keep_days;
  n int;
begin
  if auth.uid() is not null and not public.is_member() then return 0; end if;
  if not pg_try_advisory_xact_lock(841204) then return 0; end if;
  if not exists (select 1 from public.sessions where session_date < cutoff) then return 0; end if;

  with pairs as (
    select p.id as user_id, date_trunc('week', s.session_date)::date as wk, a.status, a.coach_mark, ap.reason,
      exists (select 1 from public.injuries i where i.user_id = p.id and i.exclude_attendance
              and i.start_date <= s.session_date and (i.end_date is null or i.end_date >= s.session_date)) as inj,
      exists (select 1 from public.attendance_log l where l.session_id = s.id and l.user_id = p.id and l.status = 'yes') as had_yes,
      (a.status = 'no' and ap.reason in ('urlaub', 'heimat')) is true as exc
    from public.sessions s
    join public.profiles p on p.approved and coalesce(p.trains, p.role = 'athlete') and s.session_date >= p.created_at::date
    left join public.attendance a on a.session_id = s.id and a.user_id = p.id
    left join public.attendance_private ap on ap.session_id = s.id and ap.user_id = p.id
    where s.session_date < cutoff and not s.cancelled
      and not exists (select 1 from public.calendar_entries c where c.kind = 'pause' and s.session_date between c.start_date and coalesce(c.end_date, c.start_date))
  ),
  pairs2 as (select *, inj or exc as skip from pairs),
  agg as (
    select user_id, wk,
      count(*) filter (where not skip) as counted,
      count(*) filter (where not skip and ((status = 'yes' and coalesce(coach_mark, '') <> 'no_show') or coach_mark = 'late')) as attended,
      count(*) filter (where not skip and status = 'yes') as n_yes,
      count(*) filter (where not skip and status = 'no') as n_no,
      count(*) filter (where not skip and status is distinct from 'yes' and status is distinct from 'no') as n_open,
      count(*) filter (where not skip and coach_mark = 'late') as n_late,
      count(*) filter (where not skip and coach_mark = 'no_show') as n_no_show,
      count(*) filter (where not skip and status = 'no' and had_yes) as n_flipped,
      count(*) filter (where inj) as n_skipped,
      count(*) filter (where exc and not inj) as n_excused
    from pairs2 group by user_id, wk
  ),
  rsn as (
    select user_id, wk, jsonb_object_agg(r, c) as reasons
    from (select user_id, wk, coalesce(reason, 'ohne Angabe') as r, count(*) as c from pairs where not inj and status = 'no' group by 1, 2, 3) x
    group by user_id, wk
  )
  insert into public.attendance_weekly as w (user_id, week_start, counted, attended, n_yes, n_no, n_open, n_late, n_no_show, n_flipped, n_skipped, n_excused, reasons)
  select a.user_id, a.wk, a.counted, a.attended, a.n_yes, a.n_no, a.n_open, a.n_late, a.n_no_show, a.n_flipped, a.n_skipped, a.n_excused, coalesce(r.reasons, '{}')
  from agg a left join rsn r using (user_id, wk)
  on conflict (user_id, week_start) do update set
    counted = w.counted + excluded.counted, attended = w.attended + excluded.attended, n_yes = w.n_yes + excluded.n_yes,
    n_no = w.n_no + excluded.n_no, n_open = w.n_open + excluded.n_open, n_late = w.n_late + excluded.n_late,
    n_no_show = w.n_no_show + excluded.n_no_show, n_flipped = w.n_flipped + excluded.n_flipped, n_skipped = w.n_skipped + excluded.n_skipped, n_excused = w.n_excused + excluded.n_excused,
    reasons = public.jsonb_sum(w.reasons, excluded.reasons);

  delete from public.sessions where session_date < cutoff;   -- Zu-/Absagen, Gründe und Verlauf fallen mit weg
  get diagnostics n = row_count;
  delete from public.week_openings where week_start < cutoff - 7;
  return n;
end $$;

-- Läuft automatisch mit, sobald jemand die App öffnet (ensure_week wird bei jedem Start aufgerufen)
create or replace function public.ensure_week(p_week date) returns void
language plpgsql security definer set search_path = public as $$
declare
  tpl jsonb;
  e jsonb;
begin
  if not public.is_member() then raise exception 'Keine Berechtigung'; end if;
  if extract(isodow from p_week) <> 1 then raise exception 'Die Woche muss an einem Montag beginnen'; end if;
  perform public.compact_attendance();
  if p_week < (date_trunc('week', current_date)::date - 7) or p_week > (date_trunc('week', current_date)::date + 28) then
    return;
  end if;
  insert into public.session_weeks (week_start) values (p_week) on conflict do nothing;
  if not found then return; end if;
  select session_template into tpl from public.team_settings where id = 1;
  for e in select * from jsonb_array_elements(coalesce(tpl, '[]'::jsonb)) loop
    insert into public.sessions (session_date, start_time, location, created_by)
    values (p_week + ((e ->> 'dow')::int - 1), nullif(e ->> 'time', '')::time, coalesce(e ->> 'location', ''), null);
  end loop;
end $$;

revoke execute on function public.compact_attendance(int) from public, anon;
grant execute on function public.compact_attendance(int) to authenticated;

alter table public.attendance_weekly enable row level security;
revoke all on public.attendance_weekly from anon;
grant select, insert on public.attendance_weekly to authenticated;
drop policy if exists "wochenstatistik: lesen" on public.attendance_weekly;
create policy "wochenstatistik: lesen" on public.attendance_weekly for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "wochenstatistik: Admin wiederherstellen" on public.attendance_weekly;
create policy "wochenstatistik: Admin wiederherstellen" on public.attendance_weekly for insert to authenticated
  with check (public.is_admin());


-- ═════════════════════════ 07_wettkampfmeldung.sql ═════════════════════════
-- Trainingsgruppe App, Teil 7: Wettkampf-Meldungen, Aufräumen alter Kalendereinträge, Bestleistungen
-- Voraussetzung: Teil 1–6 wurden ausgeführt. Einmal komplett im SQL-Editor ausführen; kann erneut ausgeführt werden.

-- ───────────────────────── Wettkampf-Meldungen ─────────────────────────
-- Der Trainer wählt beim Wettkampf aus, wen er melden möchte. Die Personen bestätigen oder lehnen ab.
-- Wettkämpfe sehen nur Trainer/Admins und die ausgewählten Personen.
create table if not exists public.competition_entries (
  entry_id   uuid not null references public.calendar_entries (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'angefragt' check (status in ('angefragt', 'zugesagt', 'abgesagt')),
  updated_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

create or replace function public.is_invited(p_entry uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.competition_entries where entry_id = p_entry and user_id = auth.uid())
$$;

-- Athlet bestätigt oder lehnt die eigene Meldung ab
create or replace function public.answer_competition(p_entry uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Keine Berechtigung'; end if;
  if p_status not in ('zugesagt', 'abgesagt') then raise exception 'Ungültige Antwort'; end if;
  update public.competition_entries set status = p_status, updated_at = now()
  where entry_id = p_entry and user_id = auth.uid();
  if not found then raise exception 'Du bist für diesen Wettkampf nicht vorgesehen'; end if;
end $$;
revoke execute on function public.answer_competition(uuid, text) from public, anon;
revoke execute on function public.is_invited(uuid) from public, anon;
grant execute on function public.answer_competition(uuid, text) to authenticated;
grant execute on function public.is_invited(uuid) to authenticated;

alter table public.competition_entries enable row level security;
revoke all on public.competition_entries from anon;
grant select, insert, update, delete on public.competition_entries to authenticated;
drop policy if exists "meldungen: lesen" on public.competition_entries;
create policy "meldungen: lesen" on public.competition_entries for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "meldungen: Trainer/Admin schreiben" on public.competition_entries;
create policy "meldungen: Trainer/Admin schreiben" on public.competition_entries for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Kalender: Phasen, Testwochen, Termine sehen alle; Wettkämpfe nur Trainer/Admins und die gemeldeten Personen
drop policy if exists "kalender: lesen" on public.calendar_entries;
create policy "kalender: lesen" on public.calendar_entries for select to authenticated
  using (public.is_staff() or (public.is_member() and (kind <> 'wettkampf' or public.is_invited(id))));

-- ───────────────────────── Alte Kalendereinträge ─────────────────────────
-- Nach 2 Wochen fragt die App Trainer/Admins, ob ein vergangener Eintrag behalten oder gelöscht werden soll.
alter table public.calendar_entries add column if not exists keep boolean not null default false;

-- ───────────────────────── Bestleistungen ─────────────────────────
-- Ein Ergebnis kann als (bisherige) Bestleistung markiert werden, z. B. eine PB aus der Zeit vor der App.
alter table public.competition_results add column if not exists is_pb boolean not null default false;


-- ═════════════════════════ 08_feedback_pinnwand.sql ═════════════════════════
-- Trainingsgruppe App, Teil 8: Feedback-Pinnwand – alle sehen, was schon gemeldet wurde, und können „Ich auch“ drücken
-- Voraussetzung: Teil 1–7 wurden ausgeführt. Einmal komplett im SQL-Editor ausführen; kann erneut ausgeführt werden.

-- „Ich auch“-Stimmen: eine je Person und Rückmeldung
create table if not exists public.feedback_votes (
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

alter table public.feedback_votes enable row level security;
revoke all on public.feedback_votes from anon;
grant select, insert, delete on public.feedback_votes to authenticated;
drop policy if exists "feedback_votes: lesen" on public.feedback_votes;
create policy "feedback_votes: lesen" on public.feedback_votes for select to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "feedback_votes: setzen" on public.feedback_votes;
create policy "feedback_votes: setzen" on public.feedback_votes for insert to authenticated
  with check (public.is_member() and (user_id = auth.uid() or public.is_staff()));
drop policy if exists "feedback_votes: entfernen" on public.feedback_votes;
create policy "feedback_votes: entfernen" on public.feedback_votes for delete to authenticated
  using (public.is_staff() or (public.is_member() and user_id = auth.uid()));

-- Pinnwand: alle Rückmeldungen ohne Absender und ohne Gerätedaten.
-- Die Tabelle feedback selbst bleibt geschützt (Namen und Geräte sehen weiter nur Trainer und Admins).
create or replace function public.feedback_board()
returns table (id uuid, category text, message text, context text, status text, admin_note text,
               created_at timestamptz, votes int, voted boolean, mine boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.category, f.message, f.context, f.status, f.admin_note, f.created_at,
         (select count(*)::int from public.feedback_votes v where v.feedback_id = f.id),
         exists (select 1 from public.feedback_votes v where v.feedback_id = f.id and v.user_id = auth.uid()),
         f.user_id = auth.uid()
  from public.feedback f
  where public.is_member()
  order by f.created_at desc
$$;
revoke execute on function public.feedback_board() from public, anon;
grant execute on function public.feedback_board() to authenticated;


-- ═════════════════════════ 09_saisonpause.sql ═════════════════════════
-- Trainingsgruppe App, Teil 9: Saisonpause, Absagegründe Urlaub/Heimatbesuch, Datenbank wach halten
-- Voraussetzung: Teil 1–8 wurden ausgeführt (oder einfach alles_in_einem.sql). Kann erneut ausgeführt werden.

-- ───────────────────────── Saisonpause ─────────────────────────
-- Ein Kalendereintrag der Art „pause“ (von–bis): in dieser Zeit findet kein Training statt.
-- Termine darin gelten als ausgefallen, man kann nicht zu-/absagen und nichts zählt in die Statistik.
alter table public.calendar_entries drop constraint if exists calendar_entries_kind_check;
alter table public.calendar_entries add constraint calendar_entries_kind_check
  check (kind in ('phase', 'wettkampf', 'testwoche', 'pause', 'sonstiges'));

create or replace function public.in_pause(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.calendar_entries
                 where kind = 'pause' and p_date between start_date and coalesce(end_date, start_date))
$$;
revoke execute on function public.in_pause(date) from public, anon;
grant execute on function public.in_pause(date) to authenticated;

-- „zu spät“/„nicht erschienen“ ist in der Pause gesperrt (siehe set_mark in Teil 2), Zu-/Absagen ebenso (respond in Teil 4)

-- ───────────────────────── Datenbank wach halten ─────────────────────────
-- Supabase pausiert kostenlose Projekte nach 7 Tagen ohne Zugriff. Eine GitHub-Aktion ruft dafür
-- zweimal pro Woche diese Funktion auf. Sie liest keine Daten und gibt nur „ok“ zurück.
create or replace function public.ping() returns text
language sql stable as $$ select 'ok'::text $$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
