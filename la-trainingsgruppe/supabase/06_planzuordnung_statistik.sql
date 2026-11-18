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
      exists (select 1 from public.attendance_log l where l.session_id = s.id and l.user_id = p.id and l.status = 'yes') as had_yes
    from public.sessions s
    join public.profiles p on p.approved and coalesce(p.trains, p.role = 'athlete') and s.session_date >= p.created_at::date
    left join public.attendance a on a.session_id = s.id and a.user_id = p.id
    left join public.attendance_private ap on ap.session_id = s.id and ap.user_id = p.id
    where s.session_date < cutoff and not s.cancelled
  ),
  agg as (
    select user_id, wk,
      count(*) filter (where not inj) as counted,
      count(*) filter (where not inj and ((status = 'yes' and coalesce(coach_mark, '') <> 'no_show') or coach_mark = 'late')) as attended,
      count(*) filter (where not inj and status = 'yes') as n_yes,
      count(*) filter (where not inj and status = 'no') as n_no,
      count(*) filter (where not inj and status is distinct from 'yes' and status is distinct from 'no') as n_open,
      count(*) filter (where not inj and coach_mark = 'late') as n_late,
      count(*) filter (where not inj and coach_mark = 'no_show') as n_no_show,
      count(*) filter (where not inj and status = 'no' and had_yes) as n_flipped,
      count(*) filter (where inj) as n_skipped
    from pairs group by user_id, wk
  ),
  rsn as (
    select user_id, wk, jsonb_object_agg(r, c) as reasons
    from (select user_id, wk, coalesce(reason, 'ohne Angabe') as r, count(*) as c from pairs where not inj and status = 'no' group by 1, 2, 3) x
    group by user_id, wk
  )
  insert into public.attendance_weekly as w (user_id, week_start, counted, attended, n_yes, n_no, n_open, n_late, n_no_show, n_flipped, n_skipped, reasons)
  select a.user_id, a.wk, a.counted, a.attended, a.n_yes, a.n_no, a.n_open, a.n_late, a.n_no_show, a.n_flipped, a.n_skipped, coalesce(r.reasons, '{}')
  from agg a left join rsn r using (user_id, wk)
  on conflict (user_id, week_start) do update set
    counted = w.counted + excluded.counted, attended = w.attended + excluded.attended, n_yes = w.n_yes + excluded.n_yes,
    n_no = w.n_no + excluded.n_no, n_open = w.n_open + excluded.n_open, n_late = w.n_late + excluded.n_late,
    n_no_show = w.n_no_show + excluded.n_no_show, n_flipped = w.n_flipped + excluded.n_flipped, n_skipped = w.n_skipped + excluded.n_skipped,
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
