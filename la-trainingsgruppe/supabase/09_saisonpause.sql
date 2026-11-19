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
