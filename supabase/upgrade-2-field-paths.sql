-- IgnisShield Map 3D, upgrade 2: field GPS tracks and surveyed paths (alleys).
-- Run once after upgrade-1: SQL Editor -> New query -> paste -> Run.
-- Everyone can read; approved editors (and the admin) can add, change and delete.

-- GPS tracks imported from Strava/GPX. Only the walking parts are stored, without timestamps or names.
create table if not exists public.tracks (
  id text primary key,
  name text not null,
  walked_on date,
  geometry jsonb not null,           -- GeoJSON MultiLineString
  created_at timestamptz not null default now(),
  created_by text
);

-- Paths drawn along the tracks: alleys and small roads missing from public maps. Used by routing.
create table if not exists public.paths (
  id text primary key,
  geometry jsonb not null,           -- GeoJSON LineString
  properties jsonb not null,         -- width_m, access ('walk' | 'motorcycle' | 'vehicle'), note
  updated_at timestamptz not null default now(),
  updated_by text
);

create or replace function public.stamp_field() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'tracks' then new.created_by := auth.jwt() ->> 'email';
  else new.updated_at := now(); new.updated_by := auth.jwt() ->> 'email';
  end if;
  return new;
end $$;
drop trigger if exists stamp on public.tracks;
create trigger stamp before insert on public.tracks for each row execute function public.stamp_field();
drop trigger if exists stamp on public.paths;
create trigger stamp before insert or update on public.paths for each row execute function public.stamp_field();

alter table public.tracks enable row level security;
alter table public.paths enable row level security;

drop policy if exists "read tracks" on public.tracks;
drop policy if exists "editors add tracks" on public.tracks;
drop policy if exists "editors delete tracks" on public.tracks;
create policy "read tracks" on public.tracks for select using (true);
create policy "editors add tracks" on public.tracks for insert to authenticated with check (public.is_editor());
create policy "editors delete tracks" on public.tracks for delete to authenticated using (public.is_editor());

drop policy if exists "read paths" on public.paths;
drop policy if exists "editors add paths" on public.paths;
drop policy if exists "editors change paths" on public.paths;
drop policy if exists "editors delete paths" on public.paths;
create policy "read paths" on public.paths for select using (true);
create policy "editors add paths" on public.paths for insert to authenticated with check (public.is_editor());
create policy "editors change paths" on public.paths for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "editors delete paths" on public.paths for delete to authenticated using (public.is_editor());

do $$ begin
  alter publication supabase_realtime add table public.tracks, public.paths;
exception when duplicate_object then null; end $$;

select 'tracks' as t, count(*) from public.tracks union all select 'paths', count(*) from public.paths;
