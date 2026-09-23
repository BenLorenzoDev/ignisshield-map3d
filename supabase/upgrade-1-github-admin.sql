-- IgnisShield Map 3D, upgrade 1: GitHub-only admin and account-based editors.
-- For a project that already ran the first schema.sql. Run once: SQL Editor -> New query -> paste -> Run.
--
-- Why: email confirmation is off (Supabase's free mailer cannot reach students), so an email address in an
-- account proves nothing. Rights are therefore tied to identities that cannot be claimed by typing:
--   admin  = a GitHub login whose permanent GitHub account id is listed below (checked in auth.identities)
--   editor = a specific account (auth user id) that the admin approved on /admin.html

-- Admins: GitHub account ids (BenLorenzoDev = 23088786). No policies: not readable or writable from the app.
create table if not exists public.admin_github_ids (
  github_id text primary key,
  login text,
  added_at timestamptz not null default now()
);
alter table public.admin_github_ids enable row level security;
insert into public.admin_github_ids (github_id, login) values ('23088786', 'BenLorenzoDev') on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.identities i
    join public.admin_github_ids a on a.github_id = i.provider_id
    where i.user_id = auth.uid() and i.provider = 'github');
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Editors: approved accounts
create table if not exists public.editor_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  added_at timestamptz not null default now()
);
alter table public.editor_accounts enable row level security;
drop policy if exists "admins read editor accounts" on public.editor_accounts;
drop policy if exists "admins add editor accounts" on public.editor_accounts;
drop policy if exists "admins remove editor accounts" on public.editor_accounts;
create policy "admins read editor accounts" on public.editor_accounts for select to authenticated using (public.is_admin());
create policy "admins add editor accounts" on public.editor_accounts for insert to authenticated with check (public.is_admin());
create policy "admins remove editor accounts" on public.editor_accounts for delete to authenticated using (public.is_admin());

-- The admin can always edit; everyone else needs approval
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.editor_accounts where user_id = auth.uid());
$$;
grant execute on function public.is_editor() to anon, authenticated;

-- Every account with its sign-in method and role. Admin only.
drop function if exists public.list_accounts();
create function public.list_accounts()
returns table (user_id uuid, email text, providers text, created_at timestamptz, last_sign_in_at timestamptz, is_editor boolean, is_admin boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can list accounts'; end if;
  return query
    select u.id, u.email::text,
      coalesce((select string_agg(distinct i.provider, ', ') from auth.identities i where i.user_id = u.id), ''),
      u.created_at, u.last_sign_in_at,
      exists (select 1 from public.editor_accounts e where e.user_id = u.id),
      exists (select 1 from auth.identities i join public.admin_github_ids a on a.github_id = i.provider_id
              where i.user_id = u.id and i.provider = 'github')
    from auth.users u
    order by u.created_at desc;
end $$;
revoke execute on function public.list_accounts() from public, anon;
grant execute on function public.list_accounts() to authenticated;

-- Retire the email-based lists from the first schema
drop table if exists public.admins;
drop table if exists public.editors;

-- Check: should show BenLorenzoDev
select * from public.admin_github_ids;
