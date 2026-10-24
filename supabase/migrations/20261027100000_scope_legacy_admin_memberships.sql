-- A site-scoped account must remain site-scoped even if an old global row
-- was left behind in admin_members. A site assignment takes precedence;
-- only accounts without a site assignment are institution-wide admins.
begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_members m
    where m.user_id = (select auth.uid())
  ) and not exists (
    select 1
    from public.admin_site_members s
    where s.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Keep site contacts in the realtime stream so open student and admin pages
-- receive edits without requiring a manual reload.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'campus_site_contacts'
     ) then
    execute 'alter publication supabase_realtime add table public.campus_site_contacts';
  end if;
end;
$$;

commit;
