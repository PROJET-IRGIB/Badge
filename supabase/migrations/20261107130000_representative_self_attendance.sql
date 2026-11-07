-- Allow a class representative to mark their own attendance on their device.
-- The assignment, approved badge, daily session and one-presence rule are all
-- validated server-side; the session QR token is never returned to the client.
begin;

create or replace function public.representative_mark_own_attendance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  student public.student_profiles%rowtype;
  session_row public.attendance_sessions%rowtype;
  token_value text;
  day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  if actor_id is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  perform public.require_student_account_approved();

  select * into student
  from public.student_profiles p
  where p.user_id = actor_id
  for update;

  if not found then raise exception 'Profil étudiant introuvable'; end if;
  if student.banned_at is not null or student.card_suspended_at is not null then
    raise exception 'Votre compte ou votre carte est désactivé' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.badge_applications a
    where a.student_id = actor_id and a.status = 'approved'
  ) then
    raise exception 'Votre demande de badge doit être approuvée pour enregistrer une présence';
  end if;
  if not exists (
    select 1 from public.class_representatives r
    where r.user_id = actor_id
      and (r.site, r.program, r.level) = (student.site, student.program, student.level)
  ) then
    raise exception 'Cette action est réservée aux responsables de classe actifs' using errcode = '42501';
  end if;

  perform public.ensure_daily_attendance_sessions(day_value);

  select * into session_row
  from public.attendance_sessions s
  where (s.site, s.program, s.level, s.session_day, s.is_daily)
      = (student.site, student.program, student.level, day_value, true)
    and s.starts_at <= pg_catalog.now()
    and s.ends_at >= pg_catalog.now();

  if not found then
    raise exception 'La séance de présence du jour n’est pas disponible pour votre groupe';
  end if;

  select k.token into token_value
  from public.attendance_session_secrets k
  where k.session_id = session_row.id;

  if token_value is null then raise exception 'La séance de présence est indisponible'; end if;

  -- Reuse the established student check-in path, including its duplicate guard.
  perform public.submit_attendance(token_value);

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'session_id', session_row.id,
    'session_day', session_row.session_day,
    'course_title', session_row.course_title
  );
end;
$$;

revoke all on function public.representative_mark_own_attendance() from public, anon;
grant execute on function public.representative_mark_own_attendance() to authenticated;

commit;
