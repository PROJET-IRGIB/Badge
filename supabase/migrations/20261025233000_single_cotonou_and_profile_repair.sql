-- Recreate a missing student profile from the signup data, and keep Cotonou as one study city.
create or replace function public.ensure_student_profile()
returns public.student_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor auth.users%rowtype;
  existing public.student_profiles%rowtype;
  chosen_site text;
begin
  select * into actor from auth.users where id = (select auth.uid());
  if actor.id is null then
    raise exception 'Connexion requise.';
  end if;
  select * into existing from public.student_profiles where user_id = actor.id;
  if existing.user_id is not null then
    return existing;
  end if;
  if coalesce(actor.raw_user_meta_data->>'account_type', '') <> 'student' then
    raise exception 'Ce compte n’est pas un compte étudiant.';
  end if;
  chosen_site := actor.raw_user_meta_data->>'site';
  if chosen_site = 'COT-SIEGE' then
    chosen_site := 'COT-AKPAKPA';
  end if;
  if chosen_site not in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE') then
    raise exception 'La ville enregistrée à l’inscription n’est pas reconnue.';
  end if;
  insert into public.student_profiles(user_id, first_name, last_name, email, phone, sex, program, level, site)
  values (
    actor.id,
    trim(actor.raw_user_meta_data->>'first_name'),
    trim(actor.raw_user_meta_data->>'last_name'),
    lower(actor.email),
    trim(actor.raw_user_meta_data->>'phone'),
    actor.raw_user_meta_data->>'sex',
    actor.raw_user_meta_data->>'program',
    actor.raw_user_meta_data->>'level',
    chosen_site
  )
  returning * into existing;
  return existing;
end;
$$;
revoke all on function public.ensure_student_profile() from public, anon;
grant execute on function public.ensure_student_profile() to authenticated;

update public.student_profiles set site = 'COT-AKPAKPA', updated_at = now() where site = 'COT-SIEGE';
update public.badge_applications set site = 'COT-AKPAKPA' where site = 'COT-SIEGE';

delete from public.attendance_records as seat_record
using public.attendance_sessions as seat_session, public.attendance_sessions as campus_session, public.attendance_records as campus_record
where seat_record.session_id = seat_session.id
  and seat_session.site = 'COT-SIEGE'
  and campus_session.site = 'COT-AKPAKPA'
  and campus_session.program = seat_session.program
  and campus_session.level = seat_session.level
  and campus_session.session_day = seat_session.session_day
  and campus_record.session_id = campus_session.id
  and campus_record.student_id = seat_record.student_id;

update public.attendance_records as seat_record
set session_id = campus_session.id
from public.attendance_sessions as seat_session
join public.attendance_sessions as campus_session
  on campus_session.site = 'COT-AKPAKPA'
 and campus_session.program = seat_session.program
 and campus_session.level = seat_session.level
 and campus_session.session_day = seat_session.session_day
where seat_record.session_id = seat_session.id
  and seat_session.site = 'COT-SIEGE';

delete from public.attendance_sessions as seat_session
using public.attendance_sessions as campus_session
where seat_session.site = 'COT-SIEGE'
  and campus_session.site = 'COT-AKPAKPA'
  and campus_session.program = seat_session.program
  and campus_session.level = seat_session.level
  and campus_session.session_day = seat_session.session_day;

update public.attendance_sessions set site = 'COT-AKPAKPA' where site = 'COT-SIEGE';

delete from public.admin_site_members as seat_member
where seat_member.site = 'COT-SIEGE'
  and exists (
    select 1 from public.admin_site_members as campus_member
    where campus_member.user_id = seat_member.user_id and campus_member.site = 'COT-AKPAKPA'
  );
update public.admin_site_members set site = 'COT-AKPAKPA' where site = 'COT-SIEGE';
