-- READ ONLY: list current general and site administrators.
-- Run this query in the Supabase SQL Editor on the intended project.
-- IMPORTANT: only intentionally institution-wide administrators belong in
-- public.admin_members. A site administrator belongs in public.admin_site_members
-- only; remove their admin_members row after confirming their site assignment.

select
  'GENERAL'::text as access_scope,
  m.user_id,
  u.email,
  null::text as site,
  m.created_at
from public.admin_members m
left join auth.users u on u.id = m.user_id

union all

select
  'SITE'::text as access_scope,
  m.user_id,
  u.email,
  m.site,
  m.created_at
from public.admin_site_members m
left join auth.users u on u.id = m.user_id

order by access_scope, email, site;
