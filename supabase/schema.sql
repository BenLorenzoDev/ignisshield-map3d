-- IgnisShield Map 3D: shared map for the class.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run. Then run upgrade-1-github-admin.sql.
-- Everyone (even signed out) can READ. Only approved editor accounts can WRITE (upgrade-1 replaces the email list below).

-- Who may change the shared map. Add or remove students here (Table Editor -> editors).
create table if not exists public.editors (
  email text primary key,
  note text,
  added_at timestamptz not null default now()
);

-- Buildings: AI outlines, traced and edited buildings, with their fire inputs in `properties`.
create table if not exists public.buildings (
  id text primary key,
  geometry jsonb not null,
  properties jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Fire runs logged by editors (one row per run; `record` holds X1–X9, Y1–Y8 and the run settings).
create table if not exists public.runs (
  id text primary key,
  batch text not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  created_by text
);

-- Shared settings, e.g. the class's Trial A–D values.
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- True when the signed-in user's email is on the editors list.
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.is_editor() to anon, authenticated;

-- Stamp who changed a row and when.
create or replace function public.stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'runs' then
    new.created_by := auth.jwt() ->> 'email';
  else
    new.updated_at := now();
    new.updated_by := auth.jwt() ->> 'email';
  end if;
  return new;
end $$;
drop trigger if exists stamp on public.buildings;
create trigger stamp before insert or update on public.buildings for each row execute function public.stamp();
drop trigger if exists stamp on public.settings;
create trigger stamp before insert or update on public.settings for each row execute function public.stamp();
drop trigger if exists stamp on public.runs;
create trigger stamp before insert on public.runs for each row execute function public.stamp();

-- Row level security
alter table public.editors enable row level security;
alter table public.buildings enable row level security;
alter table public.runs enable row level security;
alter table public.settings enable row level security;

drop policy if exists "read buildings" on public.buildings;
drop policy if exists "editors add buildings" on public.buildings;
drop policy if exists "editors change buildings" on public.buildings;
drop policy if exists "editors delete buildings" on public.buildings;
create policy "read buildings" on public.buildings for select using (true);
create policy "editors add buildings" on public.buildings for insert to authenticated with check (public.is_editor());
create policy "editors change buildings" on public.buildings for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "editors delete buildings" on public.buildings for delete to authenticated using (public.is_editor());

drop policy if exists "read runs" on public.runs;
drop policy if exists "editors add runs" on public.runs;
drop policy if exists "editors delete runs" on public.runs;
create policy "read runs" on public.runs for select using (true);
create policy "editors add runs" on public.runs for insert to authenticated with check (public.is_editor());
create policy "editors delete runs" on public.runs for delete to authenticated using (public.is_editor());

drop policy if exists "read settings" on public.settings;
drop policy if exists "editors add settings" on public.settings;
drop policy if exists "editors change settings" on public.settings;
create policy "read settings" on public.settings for select using (true);
create policy "editors add settings" on public.settings for insert to authenticated with check (public.is_editor());
create policy "editors change settings" on public.settings for update to authenticated using (public.is_editor()) with check (public.is_editor());

-- The editors list itself is managed in the dashboard only (no policies = no access from the app).

-- Live updates to every open browser
do $$ begin
  alter publication supabase_realtime add table public.buildings, public.runs, public.settings;
exception when duplicate_object then null; end $$;

-- Next: run upgrade-1-github-admin.sql (GitHub-only admin, account-based editors).
