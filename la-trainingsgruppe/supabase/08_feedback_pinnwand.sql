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
