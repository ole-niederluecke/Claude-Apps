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
