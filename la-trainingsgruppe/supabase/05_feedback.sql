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

-- Status und Antwort darf nur ein Admin ändern; Text nur die Person selbst
create or replace function public.feedback_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.is_admin() and (new.status <> old.status or new.admin_note <> old.admin_note) then
    raise exception 'Nur Admins können den Status ändern';
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

-- Eigenes Feedback sehen alle; alles sehen nur Admins
drop policy if exists "feedback: lesen" on public.feedback;
create policy "feedback: lesen" on public.feedback for select to authenticated
  using (public.is_admin() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "feedback: schreiben" on public.feedback;
create policy "feedback: schreiben" on public.feedback for insert to authenticated
  with check (public.is_member() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists "feedback: ändern" on public.feedback;
create policy "feedback: ändern" on public.feedback for update to authenticated
  using (public.is_admin() or (public.is_member() and user_id = auth.uid()))
  with check (public.is_admin() or (public.is_member() and user_id = auth.uid()));
drop policy if exists "feedback: löschen" on public.feedback;
create policy "feedback: löschen" on public.feedback for delete to authenticated
  using (public.is_admin() or (public.is_member() and user_id = auth.uid()));
