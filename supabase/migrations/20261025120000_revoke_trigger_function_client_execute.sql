-- Trigger-only SECURITY DEFINER functions must not be callable through the API.
-- Their attached triggers continue to run; client roles do not need EXECUTE.
begin;

revoke all on function public.create_student_profile() from public, anon, authenticated;
revoke all on function public.sync_student_email() from public, anon, authenticated;
revoke all on function public.prepare_application() from public, anon, authenticated;
revoke all on function public.ensure_roster_for_new_approval() from public, anon, authenticated;

commit;
