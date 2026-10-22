-- Production schema for the IRGIB badge portal.
-- Safe to run once via Supabase SQL Editor or Supabase CLI.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_members enable row level security;
revoke all on public.admin_members from anon, authenticated;
grant select on public.admin_members to authenticated;
drop policy if exists "admins read own membership" on public.admin_members;
create policy "admins read own membership" on public.admin_members
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admin_members where user_id=(select auth.uid())); $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null check (length(trim(last_name)) between 1 and 80),
  email text not null unique,
  phone text not null check (length(trim(phone)) between 5 and 30),
  sex text not null check (sex in ('M','F')),
  program text not null check (program in ('ABM','TIC','PFMI','PEA','PP','BBA','SJ','NUT')),
  level text not null check (level in ('LP1','LP2','LP3','M1','M2')),
  site text not null check (site in ('COT-SIEGE','COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.student_profiles enable row level security;
revoke all on public.student_profiles from anon, authenticated;
grant select on public.student_profiles to authenticated;
drop policy if exists "read own profile or admin" on public.student_profiles;
create policy "read own profile or admin" on public.student_profiles for select to authenticated
  using (user_id=(select auth.uid()) or (select public.is_admin()));

create or replace function public.create_student_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(new.raw_user_meta_data->>'account_type','') <> 'student' then return new; end if;
  insert into public.student_profiles(user_id,first_name,last_name,email,phone,sex,program,level,site)
  values(new.id,trim(new.raw_user_meta_data->>'first_name'),trim(new.raw_user_meta_data->>'last_name'),
    lower(new.email),trim(new.raw_user_meta_data->>'phone'),new.raw_user_meta_data->>'sex',
    new.raw_user_meta_data->>'program',new.raw_user_meta_data->>'level',new.raw_user_meta_data->>'site');
  return new;
end; $$;
drop trigger if exists on_auth_user_created_student on auth.users;
create trigger on_auth_user_created_student after insert on auth.users
for each row execute function public.create_student_profile();

create or replace function public.sync_student_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.student_profiles set email=lower(new.email),updated_at=now() where user_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists on_auth_email_changed_student on auth.users;
create trigger on_auth_email_changed_student after update of email on auth.users
for each row execute function public.sync_student_email();

create table if not exists public.temporary_matricule_counter (
  id boolean primary key default true check(id), value bigint not null default 0
);
insert into public.temporary_matricule_counter(id) values(true) on conflict do nothing;
alter table public.temporary_matricule_counter enable row level security;
create table if not exists public.matricule_allocator (
  id boolean primary key default true check(id), last_issued integer not null default 0 check(last_issued between 0 and 20000)
);
insert into public.matricule_allocator(id) values(true) on conflict do nothing;
alter table public.matricule_allocator enable row level security;

create table if not exists public.badge_applications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(user_id) on delete restrict,
  first_name text not null, last_name text not null, email text not null,
  phone text not null, sex text not null check(sex in ('M','F')), birth_date date not null,
  program text not null check(program in ('ABM','TIC','PFMI','PEA','PP','BBA','SJ','NUT')),
  level text not null check(level in ('LP1','LP2','LP3','M1','M2')),
  site text not null check(site in ('COT-SIEGE','COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  temporary_matricule text not null unique,
  final_matricule text unique check(final_matricule is null or final_matricule ~ '^IRGIB-[0-9]{4}[FB]$'),
  photo_path text not null,
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  check((status='approved') = (final_matricule is not null)),
  check(status<>'rejected' or nullif(trim(rejection_reason),'') is not null)
);
create unique index if not exists one_open_application_per_student
  on public.badge_applications(student_id) where status in ('pending','approved');
create index if not exists badge_applications_submitted_desc on public.badge_applications(submitted_at desc);
create index if not exists badge_applications_status_submitted on public.badge_applications(status,submitted_at desc);
alter table public.badge_applications enable row level security;
revoke all on public.badge_applications from anon, authenticated;
grant select, insert on public.badge_applications to authenticated;
drop policy if exists "read own application or admin" on public.badge_applications;
create policy "read own application or admin" on public.badge_applications for select to authenticated
  using(student_id=(select auth.uid()) or (select public.is_admin()));
drop policy if exists "submit own pending application" on public.badge_applications;
create policy "submit own pending application" on public.badge_applications for insert to authenticated
  with check(student_id=(select auth.uid()) and status='pending' and final_matricule is null
    and decided_at is null and decided_by is null and rejection_reason is null);

create or replace function public.prepare_application()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype; serial_no bigint;
begin
  select * into p from public.student_profiles where user_id=new.student_id for update;
  if not found or new.student_id<>(select auth.uid()) then raise exception 'student profile mismatch'; end if;
  if new.first_name is distinct from p.first_name or new.last_name is distinct from p.last_name
    or lower(new.email) is distinct from lower(p.email) or new.phone is distinct from p.phone
    or new.sex is distinct from p.sex or new.program is distinct from p.program
    or new.level is distinct from p.level or new.site is distinct from p.site or new.birth_date is distinct from p.birth_date then
    raise exception 'application fields must match the verified profile';
  end if;
  if split_part(new.photo_path,'/',1) <> new.student_id::text or new.photo_path !~ '\.(jpg|png|webp)$' then
    raise exception 'invalid private photo path';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='student-photos' and name=new.photo_path) then
    raise exception 'photo upload not found';
  end if;
  update public.temporary_matricule_counter set value=value+1 where id=true returning value into serial_no;
  new.temporary_matricule := 'TMP-' || lpad(serial_no::text,8,'0');
  new.status := 'pending'; new.final_matricule := null; new.decided_at := null;
  new.decided_by := null; new.rejection_reason := null; new.submitted_at := now();
  return new;
end; $$;
drop trigger if exists prepare_badge_application on public.badge_applications;
create trigger prepare_badge_application before insert on public.badge_applications
for each row execute function public.prepare_application();

create or replace function public.admin_decide_application(p_application_id uuid,p_decision text,p_reason text default null)
returns public.badge_applications language plpgsql security definer set search_path = ''
as $$
declare a public.badge_applications%rowtype; n integer; final_id text;
begin
  if not (select public.is_admin()) then raise exception 'administrator access required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
  if p_decision='rejected' and nullif(trim(p_reason),'') is null then raise exception 'rejection reason required'; end if;
  select * into a from public.badge_applications where id=p_application_id and status='pending' for update;
  if not found then raise exception 'pending application not found'; end if;
  if p_decision='approved' then
    update public.matricule_allocator set last_issued=last_issued+1
      where id=true and last_issued<20000 returning last_issued into n;
    if n is null then raise exception 'matricule capacity exhausted'; end if;
    final_id := 'IRGIB-' || lpad(((n-1)%10000)::text,4,'0') || case when n<=10000 then 'F' else 'B' end;
    update public.badge_applications set status='approved',final_matricule=final_id,
      decided_at=now(),decided_by=(select auth.uid()) where id=p_application_id returning * into a;
  else
    update public.badge_applications set status='rejected',rejection_reason=trim(p_reason),
      decided_at=now(),decided_by=(select auth.uid()) where id=p_application_id returning * into a;
  end if;
  return a;
end; $$;
revoke all on function public.admin_decide_application(uuid,text,text) from public, anon;
grant execute on function public.admin_decide_application(uuid,text,text) to authenticated;

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(), token_digest text not null unique,
  site text not null check(site in ('COT-SIEGE','COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  program text not null check(program in ('ABM','TIC','PFMI','PP','BBA','SJ','NUT','PEA')),
  level text not null check(level in ('LP1','LP2','LP3','M1','M2')),
  starts_at timestamptz not null default now(), ends_at timestamptz not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  check(ends_at>starts_at)
);
alter table public.attendance_sessions enable row level security;
revoke all on public.attendance_sessions from anon, authenticated;
grant select on public.attendance_sessions to authenticated;
drop policy if exists "admins read sessions" on public.attendance_sessions;
create policy "admins read sessions" on public.attendance_sessions for select to authenticated using((select public.is_admin()));

create or replace function public.admin_create_attendance_session(p_site text,p_program text,p_level text,p_duration_minutes integer default 90)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare token text; session public.attendance_sessions%rowtype;
begin
  if not (select public.is_admin()) then raise exception 'administrator access required' using errcode='42501'; end if;
  if p_duration_minutes not between 5 and 480 then raise exception 'duration must be 5 to 480 minutes'; end if;
  token := 'IRGIB-PRESENCE:' || encode(extensions.gen_random_bytes(24),'hex');
  insert into public.attendance_sessions(token_digest,site,program,level,ends_at,created_by)
    values(encode(extensions.digest(token,'sha256'),'hex'),p_site,p_program,p_level,
      now()+make_interval(mins=>p_duration_minutes),(select auth.uid())) returning * into session;
  return jsonb_build_object('id',session.id,'site',session.site,'program',session.program,
    'level',session.level,'starts_at',session.starts_at,'ends_at',session.ends_at,'token',token);
end; $$;
revoke all on function public.admin_create_attendance_session(text,text,text,integer) from public, anon;
grant execute on function public.admin_create_attendance_session(text,text,text,integer) to authenticated;

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  student_id uuid not null references public.student_profiles(user_id) on delete restrict,
  attended_at timestamptz not null default now(), unique(session_id,student_id)
);
create index if not exists attendance_by_student_time on public.attendance_records(student_id,attended_at desc);
create index if not exists attendance_by_session_time on public.attendance_records(session_id,attended_at desc);
alter table public.attendance_records enable row level security;
revoke all on public.attendance_records from anon, authenticated;
grant select on public.attendance_records to authenticated;
drop policy if exists "read own attendance or admin" on public.attendance_records;
create policy "read own attendance or admin" on public.attendance_records for select to authenticated
  using(student_id=(select auth.uid()) or (select public.is_admin()));
drop policy if exists "admins read sessions" on public.attendance_sessions;
drop policy if exists "admins or attending students read sessions" on public.attendance_sessions;
create policy "admins or attending students read sessions" on public.attendance_sessions for select to authenticated
  using((select public.is_admin()) or exists(
    select 1 from public.attendance_records r where r.session_id=id and r.student_id=(select auth.uid())
  ));

create or replace function public.submit_attendance(p_token text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype; rec public.attendance_records%rowtype;
begin
  select * into strict p from public.student_profiles where user_id=(select auth.uid());
  select * into s from public.attendance_sessions
    where token_digest=encode(extensions.digest(p_token,'sha256'),'hex') and starts_at<=now() and ends_at>=now();
  if not found then raise exception 'QR invalide ou séance terminée'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then
    raise exception 'ce QR ne correspond pas à votre groupe';
  end if;
  insert into public.attendance_records(session_id,student_id) values(s.id,p.user_id)
    on conflict(session_id,student_id) do nothing returning * into rec;
  if rec.id is null then raise exception 'présence déjà enregistrée'; end if;
  return rec;
end; $$;
revoke all on function public.submit_attendance(text) from public, anon;
grant execute on function public.submit_attendance(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('student-photos','student-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "student uploads own photo" on storage.objects;
create policy "student uploads own photo" on storage.objects for insert to authenticated
  with check(bucket_id='student-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "students and admins read photos" on storage.objects;
create policy "students and admins read photos" on storage.objects for select to authenticated
  using(bucket_id='student-photos' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_admin())));
drop policy if exists "delete unlinked own photo" on storage.objects;
create policy "delete unlinked own photo" on storage.objects for delete to authenticated
  using(bucket_id='student-photos' and (storage.foldername(name))[1]=(select auth.uid())::text
    and not exists(select 1 from public.badge_applications a where a.photo_path=name));

revoke all on public.temporary_matricule_counter,public.matricule_allocator from anon,authenticated;

-- Realtime drives administrator refreshes and student approval notifications.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='badge_applications') then
      alter publication supabase_realtime add table public.badge_applications;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance_records') then
      alter publication supabase_realtime add table public.attendance_records;
    end if;
  end if;
end $$;

create or replace function public.student_update_profile(
  p_first_name text,p_last_name text,p_phone text,p_sex text,p_program text,p_level text,p_site text,p_birth_date date
)
returns public.student_profiles language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into p from public.student_profiles where user_id=(select auth.uid()) for update;
  if not found then raise exception 'student profile not found'; end if;
  if exists(select 1 from public.badge_applications where student_id=(select auth.uid()) and status in ('pending','approved')) then
    raise exception 'profile is locked after application submission';
  end if;
  update public.student_profiles set first_name=trim(p_first_name),last_name=trim(p_last_name),
    phone=trim(p_phone),sex=p_sex,program=p_program,level=p_level,site=p_site,birth_date=p_birth_date,updated_at=now()
    where user_id=(select auth.uid()) returning * into p;
  return p;
end; $$;
revoke all on function public.student_update_profile(text,text,text,text,text,text,text,date) from public,anon;
grant execute on function public.student_update_profile(text,text,text,text,text,text,text,date) to authenticated;

