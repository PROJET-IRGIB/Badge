-- READ ONLY: verify the ban guards and key RLS protections after migrations.
-- Run on a TEST Supabase project after applying the branch migrations.
-- A false result means the relevant migration is missing or the definition drifted.

with required_functions(function_name, required_guard) as (
  values
    ('submit_attendance', 'banned_at is not null'),
    ('list_representative_groupmates', 'banned_at is not null'),
    ('mark_classmate_attendance', 'banned_at is not null')
)
select
  r.function_name,
  p.oid is not null as function_installed,
  coalesce(p.prosrc ilike '%' || r.required_guard || '%', false) as ban_guard_present,
  coalesce(p.prosecdef, false) as security_definer
from required_functions r
left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = r.function_name
order by r.function_name;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('attendance_records', 'badge_applications', 'push_subscriptions');

select
  c.relname as table_name,
  p.polname as policy_name,
  pg_get_expr(p.polqual, p.polrelid) as using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('attendance_records', 'badge_applications', 'push_subscriptions')
order by c.relname, p.polname;
