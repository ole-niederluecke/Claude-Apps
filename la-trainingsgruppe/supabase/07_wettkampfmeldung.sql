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
