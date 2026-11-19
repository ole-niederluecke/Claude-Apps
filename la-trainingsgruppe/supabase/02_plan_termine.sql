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
