-- Daily attendance sessions, explicit absences, and site-scoped administrators.
-- Apply after 20261023090000_remove_cotonou_admin_seat_from_study_sites.sql.
create extension if not exists pg_cron;

create table if not exists public.admin_site_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  site text not null check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  created_at timestamptz not null default now(),
  primary key (user_id, site)
);
alter table public.admin_site_members enable row level security;
revoke all on public.admin_site_members from anon, authenticated;
grant select on public.admin_site_members to authenticated;
drop policy if exists "admins read own site membership" on public.admin_site_members;
create policy "admins read own site membership" on public.admin_site_members
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_admin_for_site(p_site text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select public.is_admin()) or exists (
    select 1 from public.admin_site_members m
    where m.user_id = (select auth.uid()) and m.site = p_site
  );
$$;
revoke all on function public.is_admin_for_site(text) from public, anon;
grant execute on function public.is_admin_for_site(text) to authenticated;

-- Replace global administrator reads with a site-aware check. Existing rows in
-- admin_members remain institution-wide administrators until assigned otherwise.
drop policy if exists "read own profile or admin" on public.student_profiles;
create policy "read own profile or scoped admin" on public.student_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin_for_site(site)));
drop policy if exists "read own application or admin" on public.badge_applications;
create policy "read own application or scoped admin" on public.badge_applications for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_admin_for_site(site)));
drop policy if exists "admins or attending students read sessions" on public.attendance_sessions;
create policy "admins or attending students read sessions" on public.attendance_sessions for select to authenticated
  using ((select public.is_admin_for_site(site)) or exists (
    select 1 from public.student_profiles p where p.user_id = (select auth.uid())
      and p.site = attendance_sessions.site and p.program = attendance_sessions.program and p.level = attendance_sessions.level
  ));
drop policy if exists "read own attendance or admin" on public.attendance_records;
create policy "read own attendance or scoped admin" on public.attendance_records for select to authenticated
  using (student_id = (select auth.uid()) or exists (
    select 1 from public.attendance_sessions s where s.id = session_id
      and (select public.is_admin_for_site(s.site))
  ));
drop policy if exists "students and admins read photos" on storage.objects;
create policy "students and scoped admins read photos" on storage.objects for select to authenticated
  using (bucket_id = 'student-photos' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_admin())
    or exists (
      select 1 from public.badge_applications a
      where a.photo_path = name and (select public.is_admin_for_site(a.site))
    )
  ));

alter table public.attendance_sessions add column if not exists session_day date;
alter table public.attendance_sessions add column if not exists course_title text not null default 'Séance du jour';
alter table public.attendance_sessions add column if not exists is_daily boolean not null default false;
alter table public.attendance_sessions alter column created_by drop not null;
update public.attendance_sessions set session_day = (starts_at at time zone 'Africa/Porto-Novo')::date where session_day is null;
alter table public.attendance_sessions alter column session_day set not null;
create unique index if not exists one_daily_session_per_group
  on public.attendance_sessions(site, program, level, session_day) where is_daily;

create table if not exists public.attendance_session_secrets (
  session_id uuid primary key references public.attendance_sessions(id) on delete cascade,
  token text not null unique
);
alter table public.attendance_session_secrets enable row level security;
revoke all on public.attendance_session_secrets from public, anon, authenticated;

alter table public.attendance_records add column if not exists status text not null default 'present'
  check (status in ('present','absent'));
alter table public.attendance_records alter column attended_at drop not null;
update public.attendance_records set status = 'present' where attended_at is not null;

create or replace function public.ensure_daily_attendance_sessions(p_day date default (now() at time zone 'Africa/Porto-Novo')::date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare g record; s public.attendance_sessions%rowtype; token text; made integer := 0;
begin
  for g in
    select distinct a.site, a.program, a.level
    from public.badge_applications a
    where a.status = 'approved'
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

create or replace function public.ensure_roster_for_new_approval()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') then
    perform public.ensure_daily_attendance_sessions((now() at time zone 'Africa/Porto-Novo')::date);
  end if;
  return new;
end;
$$;
drop trigger if exists add_new_approved_student_to_daily_roster on public.badge_applications;
create trigger add_new_approved_student_to_daily_roster after insert or update of status on public.badge_applications
  for each row execute function public.ensure_roster_for_new_approval();

create or replace function public.admin_daily_attendance_qrs(p_site text default null, p_day date default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare the_day date := coalesce(p_day,(now() at time zone 'Africa/Porto-Novo')::date); result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not (select public.is_admin()) and not exists (
    select 1 from public.admin_site_members where user_id=(select auth.uid())
  ) then raise exception 'administrator access required' using errcode='42501'; end if;
  if p_site is not null and not (select public.is_admin_for_site(p_site)) then
    raise exception 'site access denied' using errcode='42501';
  end if;
  perform public.ensure_daily_attendance_sessions(the_day);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'site',s.site,'program',s.program,'level',s.level,
    'course_title',s.course_title,'session_day',s.session_day,'starts_at',s.starts_at,'ends_at',s.ends_at,'token',k.token)
    order by s.site,s.program,s.level),'[]'::jsonb)
    into result
  from public.attendance_sessions s join public.attendance_session_secrets k on k.session_id=s.id
  where s.session_day=the_day and (p_site is null or s.site=p_site)
    and (select public.is_admin_for_site(s.site));
  return result;
end;
$$;
revoke all on function public.admin_daily_attendance_qrs(text,date) from public, anon;
grant execute on function public.admin_daily_attendance_qrs(text,date) to authenticated;

create or replace function public.admin_attendance_session_info(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into s from public.attendance_sessions
    where token_digest=encode(extensions.digest(p_token,'sha256'),'hex');
  if not found then raise exception 'QR de séance inconnu'; end if;
  if not (select public.is_admin_for_site(s.site)) then raise exception 'site access denied' using errcode='42501'; end if;
  return jsonb_build_object('id',s.id,'site',s.site,'program',s.program,'level',s.level,
    'course_title',s.course_title,'session_day',s.session_day,'starts_at',s.starts_at,'ends_at',s.ends_at,
    'active',s.starts_at<=now() and s.ends_at>=now());
end;
$$;
revoke all on function public.admin_attendance_session_info(text) from public, anon;
grant execute on function public.admin_attendance_session_info(text) to authenticated;

create or replace function public.admin_decide_application(p_application_id uuid,p_decision text,p_reason text default null)
returns public.badge_applications language plpgsql security definer set search_path = ''
as $$
declare a public.badge_applications%rowtype; n integer; final_id text;
begin
  if not (select public.is_admin()) and not exists (
    select 1 from public.admin_site_members where user_id=(select auth.uid())
  ) then raise exception 'administrator access required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
  if p_decision='rejected' and nullif(trim(p_reason),'') is null then raise exception 'rejection reason required'; end if;
  select * into a from public.badge_applications where id=p_application_id and status='pending' for update;
  if not found then raise exception 'pending application not found'; end if;
  if not (select public.is_admin_for_site(a.site)) then raise exception 'site access denied' using errcode='42501'; end if;
  if p_decision='approved' then
    update public.matricule_allocator set last_issued=last_issued+1 where id=true and last_issued<20000 returning last_issued into n;
    if n is null then raise exception 'matricule capacity exhausted'; end if;
    final_id := 'IRGIB-' || lpad(((n-1)%10000)::text,4,'0') || case when n<=10000 then 'F' else 'B' end;
    update public.badge_applications set status='approved',final_matricule=final_id,decided_at=now(),decided_by=(select auth.uid())
      where id=p_application_id returning * into a;
  else
    update public.badge_applications set status='rejected',rejection_reason=trim(p_reason),decided_at=now(),decided_by=(select auth.uid())
      where id=p_application_id returning * into a;
  end if;
  return a;
end;
$$;
revoke all on function public.admin_decide_application(uuid,text,text) from public, anon;
grant execute on function public.admin_decide_application(uuid,text,text) to authenticated;

create or replace function public.admin_create_attendance_session(p_site text,p_program text,p_level text,p_duration_minutes integer default 90)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare token text; session public.attendance_sessions%rowtype;
begin
  if not (select public.is_admin_for_site(p_site)) then raise exception 'site access denied' using errcode='42501'; end if;
  if p_duration_minutes not between 5 and 480 then raise exception 'duration must be 5 to 480 minutes'; end if;
  select * into session from public.attendance_sessions
    where site=p_site and program=p_program and level=p_level
      and session_day=(now() at time zone 'Africa/Porto-Novo')::date and is_daily;
  if found then
    select k.token into token from public.attendance_session_secrets k where k.session_id=session.id;
    return jsonb_build_object('id',session.id,'site',session.site,'program',session.program,'level',session.level,
      'starts_at',session.starts_at,'ends_at',session.ends_at,'token',token);
  end if;
  token := 'IRGIB-PRESENCE:' || encode(extensions.gen_random_bytes(24),'hex');
  insert into public.attendance_sessions(token_digest,site,program,level,session_day,course_title,is_daily,ends_at,created_by)
    values(encode(extensions.digest(token,'sha256'),'hex'),p_site,p_program,p_level,(now() at time zone 'Africa/Porto-Novo')::date,
      'Séance du jour',true,(now() at time zone 'Africa/Porto-Novo')::date + 1 - interval '1 second',(select auth.uid())) returning * into session;
  insert into public.attendance_session_secrets(session_id,token) values(session.id,token);
  insert into public.attendance_records(session_id,student_id,status,attended_at)
    select session.id,a.student_id,'absent',null from public.badge_applications a
    where a.status='approved' and a.site=p_site and a.program=p_program and a.level=p_level
    on conflict(session_id,student_id) do nothing;
  return jsonb_build_object('id',session.id,'site',session.site,'program',session.program,'level',session.level,
    'starts_at',session.starts_at,'ends_at',session.ends_at,'token',token);
end;
$$;
revoke all on function public.admin_create_attendance_session(text,text,text,integer) from public, anon;
grant execute on function public.admin_create_attendance_session(text,text,text,integer) to authenticated;

create or replace function public.submit_attendance(p_token text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype; rec public.attendance_records%rowtype;
begin
  select * into strict p from public.student_profiles where user_id=(select auth.uid());
  if not exists (select 1 from public.badge_applications a where a.student_id=p.user_id and a.status='approved') then
    raise exception 'votre demande doit être approuvée pour enregistrer une présence';
  end if;
  select * into s from public.attendance_sessions
    where token_digest=encode(extensions.digest(p_token,'sha256'),'hex') and starts_at<=now() and ends_at>=now();
  if not found then raise exception 'QR invalide ou séance terminée'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then raise exception 'ce QR ne correspond pas à votre groupe'; end if;
  insert into public.attendance_records(session_id,student_id,status,attended_at) values(s.id,p.user_id,'present',now())
    on conflict(session_id,student_id) do update set status='present',attended_at=coalesce(public.attendance_records.attended_at,now())
    returning * into rec;
  return rec;
end;
$$;
revoke all on function public.submit_attendance(text) from public, anon;
grant execute on function public.submit_attendance(text) to authenticated;

-- Create today's roster at migration time too; the scheduled job maintains it thereafter.
select public.ensure_daily_attendance_sessions((now() at time zone 'Africa/Porto-Novo')::date);

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='student_profiles') then
      alter publication supabase_realtime add table public.student_profiles;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance_sessions') then
      alter publication supabase_realtime add table public.attendance_sessions;
    end if;
  end if;
end $$;

-- Supabase's hosted database uses UTC; 23:00 UTC is midnight in Porto-Novo.
do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    if not exists (select 1 from cron.job where jobname='irgib-daily-attendance') then
      perform cron.schedule('irgib-daily-attendance','0 23 * * *',
        $job$select public.ensure_daily_attendance_sessions((now() at time zone 'Africa/Porto-Novo')::date);$job$);
    end if;
  end if;
end;
$$;

