-- Admin access list: membership is managed only from the Supabase SQL editor
-- or a trusted server using the service role. Browser clients can read only
-- their own membership row and cannot grant themselves admin access.
create table if not exists public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_members enable row level security;
revoke all on table public.admin_members from anon, authenticated;
grant select on table public.admin_members to authenticated;

drop policy if exists "admins can read their own membership" on public.admin_members;
create policy "admins can read their own membership"
  on public.admin_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- After creating an administrator in Supabase Authentication, authorize that
-- exact Auth user with this statement, replacing the email with its real one:
-- insert into public.admin_members (user_id)
-- select id from auth.users where lower(email) = lower('admin@example.com');
