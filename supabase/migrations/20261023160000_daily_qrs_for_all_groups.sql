-- Prepare a daily QR for every configured site/program/level, even before a
-- group has any approved students. Attendance rows are still created only for
-- approved students in the matching group.
create or replace function public.ensure_daily_attendance_sessions(p_day date default (now() at time zone 'Africa/Porto-Novo')::date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare g record; s public.attendance_sessions%rowtype; token text; made integer := 0;
begin
  -- The midnight job and an admin opening the QR document can race; serialize
  -- generation per date so only one token is ever created for a group/day.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('irgib-daily-attendance'), pg_catalog.hashtext(p_day::text));
  for g in
    select sites.site, programs.program, levels.level
    from (values ('COT-AKPAKPA'),('CAL-CENTRE'),('PNV-CENTRE'),('PRK-CENTRE'),('DJG-CENTRE')) as sites(site)
    cross join (values ('ABM'),('TIC'),('PFMI'),('PEA'),('PP'),('BBA'),('SJ'),('NUT')) as programs(program)
    cross join (values ('LP1'),('LP2'),('LP3'),('M1'),('M2')) as levels(level)
  loop
    select * into s from public.attendance_sessions
      where site=g.site and program=g.program and level=g.level and session_day=p_day and is_daily;
    if not found then
      token := 'IRGIB-PRESENCE:' || encode(extensions.gen_random_bytes(24),'hex');
      insert into public.attendance_sessions(token_digest,site,program,level,session_day,course_title,is_daily,starts_at,ends_at,created_by)
      values (encode(extensions.digest(token,'sha256'),'hex'),g.site,g.program,g.level,p_day,'Séance du jour',
        true,(p_day::timestamp at time zone 'Africa/Porto-Novo'),
        ((p_day + 1)::timestamp at time zone 'Africa/Porto-Novo') - interval '1 second',
        (select user_id from public.admin_members order by created_at limit 1))
      returning * into s;
      insert into public.attendance_session_secrets(session_id,token) values(s.id,token);
      made := made + 1;
    end if;
    insert into public.attendance_records(session_id,student_id,status,attended_at)
      select s.id,a.student_id,'absent',null
      from public.badge_applications a
      where a.status='approved' and a.site=g.site and a.program=g.program and a.level=g.level
      on conflict(session_id,student_id) do nothing;
  end loop;
  return made;
end;
$$;
revoke all on function public.ensure_daily_attendance_sessions(date) from public, anon, authenticated;

-- Fill the current date immediately when this migration is applied; the
-- existing pg_cron job will prepare subsequent days at midnight.
select public.ensure_daily_attendance_sessions((now() at time zone 'Africa/Porto-Novo')::date);
