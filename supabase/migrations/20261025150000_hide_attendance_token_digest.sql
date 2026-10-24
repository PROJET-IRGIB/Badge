-- Do not expose the attendance-token digest through PostgREST.
-- Client queries use only the columns granted below; SECURITY DEFINER RPCs
-- continue to read the digest as the function owner.
begin;

revoke select on public.attendance_sessions from public, anon, authenticated;
grant select (
  id,
  site,
  program,
  level,
  starts_at,
  ends_at,
  created_by,
  created_at,
  session_day,
  course_title,
  is_daily
) on public.attendance_sessions to authenticated;

commit;

-- Rollback, only if the older table-wide SELECT grant must be restored:
-- grant select on public.attendance_sessions to authenticated;
