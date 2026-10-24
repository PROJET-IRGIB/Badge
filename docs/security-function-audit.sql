-- READ ONLY: inspect SECURITY DEFINER functions and client-role EXECUTE grants.
-- Run on a TEST project first. This reports database metadata and changes nothing.
-- Expected for app RPCs: a fixed search_path, no PUBLIC/anon execute, and
-- authenticated execute only where a signed-in client must call the RPC.
-- Trigger and cron/internal functions should not be callable by client roles.

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  coalesce(p.proconfig, array[]::text[]) as function_settings,
  exists (
    select 1
    from unnest(coalesce(p.proconfig, array[]::text[])) setting
    where setting like 'search_path=%'
  ) as has_explicit_search_path,
  exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions')
order by n.nspname, p.proname, arguments;
