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
  check (reason in ('krank', 'verletzt', 'uni', 'arbeit', 'fortbildung', 'sonstiges'));

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
  if p_reason is not null and p_reason not in ('krank', 'verletzt', 'uni', 'arbeit', 'fortbildung', 'sonstiges') then raise exception 'Ungültiger Grund'; end if;
  select * into s from public.sessions where id = p_session;
  if s.id is null then raise exception 'Termin nicht gefunden'; end if;
  if s.cancelled then raise exception 'Dieser Termin ist abgesagt'; end if;
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
