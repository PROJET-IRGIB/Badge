begin;

-- Discard future schedules created by the previous date-planning interface.
delete from public.representative_course_schedules;
delete from public.attendance_records r using public.attendance_sessions s
where r.session_id=s.id and s.is_daily
  and s.session_day > (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
delete from public.attendance_sessions
where is_daily and session_day > (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;

-- Keep today's old attendance history, but prevent stale QR tokens being shown.
update public.attendance_sessions
set is_daily=false, course_title='Appel antérieur'
where is_daily and session_day=(pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;

alter table public.representative_course_schedules
  drop constraint if exists representative_course_schedules_starts_at_check;
alter table public.representative_course_schedules
  add constraint representative_course_schedules_starts_at_check
  check (starts_at in (time '07:00',time '09:00',time '14:00'));

drop function if exists public.representative_set_daily_course_schedule(date,time[]);

create or replace function public.representative_set_today_course_schedule(p_times time[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype;
  local_now timestamp without time zone := pg_catalog.now() at time zone 'Africa/Porto-Novo';
  today date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
  item_time time; i integer; result jsonb;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives r where r.user_id=(select auth.uid()) for update;
  if not found then raise exception 'Cette action est réservée aux responsables de classe'; end if;
  if exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid())
      and (p.account_status<>'approved' or p.banned_at is not null or p.card_suspended_at is not null)) then
    raise exception 'Votre compte ou votre carte ne permet pas cette action' using errcode='42501';
  end if;
  if p_times is null or cardinality(p_times)<1 or cardinality(p_times)>2 then raise exception 'Choisissez un ou deux cours'; end if;
  if exists(select 1 from unnest(p_times) as v(start_time)
      where v.start_time is null or v.start_time not in (time '07:00',time '09:00',time '14:00')) then
    raise exception 'Choisissez 7 h, 9 h ou 14 h';
  end if;
  if cardinality(p_times)=2 and (p_times[1]=p_times[2] or p_times[1]>p_times[2]) then
    raise exception 'Les heures doivent être différentes et dans l’ordre';
  end if;
  if exists(select 1 from unnest(p_times) as v(start_time) where v.start_time<=local_now::time) then
    raise exception 'L’heure choisie est déjà passée';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(rep.site||rep.program||rep.level),pg_catalog.hashtext(today::text));
  if exists(select 1 from public.attendance_sessions s join public.attendance_records r on r.session_id=s.id
      where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,today,true) and r.status='present') then
    raise exception 'Une présence est déjà enregistrée; les horaires ne peuvent plus être modifiés';
  end if;
  if exists(select 1 from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,today,true)
      and s.ends_at<=pg_catalog.now()) then raise exception 'Un cours a déjà commencé; les horaires du jour ne peuvent plus être modifiés'; end if;
  delete from public.attendance_records r using public.attendance_sessions s
    where r.session_id=s.id and (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,today,true);
  delete from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,today,true);
  delete from public.representative_course_schedules where (site,program,level,session_day)=(rep.site,rep.program,rep.level,today);
  for i in 1..cardinality(p_times) loop
    item_time:=p_times[i];
    insert into public.representative_course_schedules(site,program,level,session_day,course_slot,starts_at,configured_by)
      values(rep.site,rep.program,rep.level,today,i,item_time,(select auth.uid()));
  end loop;
  perform public.ensure_daily_attendance_sessions(today);
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id',s.id,'course_slot',s.course_slot,
      'course_title',s.course_title,'starts_at',s.ends_at) order by s.course_slot) into result
    from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,today,true);
  return coalesce(result,'[]'::jsonb);
end;
$$;
revoke all on function public.representative_set_today_course_schedule(time[]) from public,anon;
grant execute on function public.representative_set_today_course_schedule(time[]) to authenticated;

commit;
