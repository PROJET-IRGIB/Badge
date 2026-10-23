-- Reserve global student IDs at application time and add a protected daily QR
-- screen for class representatives.

alter table public.badge_applications
  add column if not exists reserved_matricule text;

alter table public.badge_applications
  add constraint badge_applications_reserved_matricule_format
  check (reserved_matricule is null or reserved_matricule ~ '^IRGIB-[0-9]{4}[FB]$');
create unique index if not exists badge_applications_reserved_matricule_unique
  on public.badge_applications(reserved_matricule) where reserved_matricule is not null;

-- Keep every already-issued final ID, and reserve the next IDs for applications
-- that were pending when this migration is installed.
update public.badge_applications
set reserved_matricule = final_matricule
where status = 'approved' and final_matricule is not null and reserved_matricule is null;

do $$
declare
  n integer;
  row_app record;
  digits integer;
  code text;
begin
  select greatest(
    coalesce((select max(case when right(final_matricule,1)='F'
      then substring(final_matricule from 7 for 4)::integer
      else 9999 + substring(final_matricule from 7 for 4)::integer end)
      from public.badge_applications where final_matricule ~ '^IRGIB-[0-9]{4}[FB]$'), 0),
    coalesce((select greatest(last_issued - 2, 0) from public.matricule_allocator where id=true), 0)
  ) into n;
  if n > 19998 then raise exception 'Matricule capacity exhausted during migration'; end if;
  update public.matricule_allocator set last_issued=n where id=true;

  for row_app in
    select id from public.badge_applications
    where status='pending' and reserved_matricule is null
    order by submitted_at, id
    for update
  loop
    n := n + 1;
    if n > 19998 then raise exception 'Matricule capacity exhausted during migration'; end if;
    digits := case when n <= 9999 then n else n - 9999 end;
    code := 'IRGIB-' || lpad(digits::text,4,'0') || case when n <= 9999 then 'F' else 'B' end;
    update public.badge_applications
      set reserved_matricule=code, temporary_matricule='TMP-' || code
      where id=row_app.id;
    update public.matricule_allocator set last_issued=n where id=true;
  end loop;
end;
$$;

alter table public.badge_applications
  add constraint badge_applications_reserved_state_check
  check (status not in ('pending','approved') or reserved_matricule is not null);
alter table public.badge_applications
  add constraint badge_applications_final_matches_reserved_check
  check (final_matricule is null or final_matricule = reserved_matricule);
alter table public.matricule_allocator
  drop constraint if exists matricule_allocator_last_issued_check;
alter table public.matricule_allocator
  add constraint matricule_allocator_last_issued_check check (last_issued between 0 and 19998);

create or replace function public.prepare_application()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  p public.student_profiles%rowtype;
  serial_no integer;
  digits integer;
  code text;
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
  update public.matricule_allocator
    set last_issued=last_issued+1 where id=true and last_issued<19998
    returning last_issued into serial_no;
  if serial_no is null then raise exception 'Matricule capacity exhausted'; end if;
  digits := case when serial_no <= 9999 then serial_no else serial_no - 9999 end;
  code := 'IRGIB-' || lpad(digits::text,4,'0') || case when serial_no <= 9999 then 'F' else 'B' end;
  new.reserved_matricule := code;
  new.temporary_matricule := 'TMP-' || code;
  new.status := 'pending'; new.final_matricule := null; new.decided_at := null;
  new.decided_by := null; new.rejection_reason := null; new.submitted_at := now();
  return new;
end;
$$;

create or replace function public.admin_decide_application(p_application_id uuid,p_decision text,p_reason text default null)
returns public.badge_applications language plpgsql security definer set search_path = ''
as $$
declare a public.badge_applications%rowtype;
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
    if a.reserved_matricule is null then raise exception 'Matricule réservé introuvable'; end if;
    update public.badge_applications set status='approved',final_matricule=reserved_matricule,
      decided_at=now(),decided_by=(select auth.uid()) where id=p_application_id returning * into a;
  else
    update public.badge_applications set status='rejected',rejection_reason=trim(p_reason),
      decided_at=now(),decided_by=(select auth.uid()) where id=p_application_id returning * into a;
  end if;
  return a;
end;
$$;
revoke all on function public.admin_decide_application(uuid,text,text) from public, anon;
grant execute on function public.admin_decide_application(uuid,text,text) to authenticated;

alter table public.class_representatives
  add column if not exists daily_qr_pin_hash text,
  add column if not exists daily_qr_pin_failures integer not null default 0,
  add column if not exists daily_qr_pin_locked_until timestamptz;

-- Never expose the password hash through PostgREST, even to the representative.
revoke select on public.class_representatives from authenticated;
grant select(site,program,level,user_id,assigned_by,assigned_at)
  on public.class_representatives to authenticated;

create or replace function public.reset_representative_pin_on_reassignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    new.daily_qr_pin_hash := null;
    new.daily_qr_pin_failures := 0;
    new.daily_qr_pin_locked_until := null;
  end if;
  return new;
end;
$$;
drop trigger if exists reset_representative_pin_on_reassignment on public.class_representatives;
create trigger reset_representative_pin_on_reassignment
before update of user_id on public.class_representatives
for each row execute function public.reset_representative_pin_on_reassignment();

create or replace function public.representative_daily_qr_pin_status()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.class_representatives cr
    where cr.user_id=(select auth.uid()) and cr.daily_qr_pin_hash is not null)
$$;
revoke all on function public.representative_daily_qr_pin_status() from public, anon;
grant execute on function public.representative_daily_qr_pin_status() to authenticated;

create or replace function public.set_representative_daily_qr_pin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'Le code doit contenir exactement 4 chiffres'; end if;
  select * into rep from public.class_representatives where user_id=(select auth.uid()) for update;
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if rep.daily_qr_pin_hash is not null then raise exception 'Le code est déjà configuré'; end if;
  update public.class_representatives set daily_qr_pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),
    daily_qr_pin_failures=0,daily_qr_pin_locked_until=null where user_id=(select auth.uid());
end;
$$;
revoke all on function public.set_representative_daily_qr_pin(text) from public, anon;
grant execute on function public.set_representative_daily_qr_pin(text) to authenticated;

create or replace function public.representative_daily_attendance_qr(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  rep public.class_representatives%rowtype;
  day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
  session_row public.attendance_sessions%rowtype;
  token_value text;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  select * into rep from public.class_representatives where user_id=(select auth.uid()) for update;
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if rep.daily_qr_pin_hash is null then raise exception 'Configurez d’abord votre code à 4 chiffres'; end if;
  if rep.daily_qr_pin_locked_until is not null and rep.daily_qr_pin_locked_until > pg_catalog.now() then
    raise exception 'Trop de tentatives. Réessayez après %', to_char(rep.daily_qr_pin_locked_until at time zone 'Africa/Porto-Novo','HH24:MI');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin,rep.daily_qr_pin_hash) <> rep.daily_qr_pin_hash then
    update public.class_representatives
      set daily_qr_pin_failures=case when daily_qr_pin_failures+1>=5 then 0 else daily_qr_pin_failures+1 end,
          daily_qr_pin_locked_until=case when daily_qr_pin_failures+1>=5 then pg_catalog.now()+interval '15 minutes' else null end
      where user_id=(select auth.uid());
    return jsonb_build_object('ok',false,'message',case when rep.daily_qr_pin_failures+1>=5
      then 'Trop de tentatives. Réessayez dans 15 minutes.' else 'Code incorrect' end);
  end if;
  update public.class_representatives set daily_qr_pin_failures=0,daily_qr_pin_locked_until=null
    where user_id=(select auth.uid());
  perform public.ensure_daily_attendance_sessions(day_value);
  select s.* into session_row from public.attendance_sessions s
    where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,day_value,true)
      and s.starts_at<=pg_catalog.now() and s.ends_at>=pg_catalog.now();
  if not found then raise exception 'Le QR de présence du jour n’est pas disponible'; end if;
  select k.token into token_value from public.attendance_session_secrets k where k.session_id=session_row.id;
  if token_value is null then raise exception 'Le QR de présence du jour est indisponible'; end if;
  return jsonb_build_object('ok',true,'token',token_value,'site',rep.site,'program',rep.program,'level',rep.level,
    'course_title',session_row.course_title,'session_day',session_row.session_day,'ends_at',session_row.ends_at);
end;
$$;
revoke all on function public.representative_daily_attendance_qr(text) from public, anon;
grant execute on function public.representative_daily_attendance_qr(text) to authenticated;

create or replace function public.admin_reset_representative_daily_qr_pin(p_site text,p_program text,p_level text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_admin_for_site(p_site)) then raise exception 'Site non autorisé' using errcode='42501'; end if;
  update public.class_representatives set daily_qr_pin_hash=null,daily_qr_pin_failures=0,daily_qr_pin_locked_until=null
    where site=p_site and program=p_program and level=p_level;
  if not found then raise exception 'Aucun responsable pour ce groupe'; end if;
end;
$$;
revoke all on function public.admin_reset_representative_daily_qr_pin(text,text,text) from public, anon;
grant execute on function public.admin_reset_representative_daily_qr_pin(text,text,text) to authenticated;

-- The administration no longer distributes QR secrets. Only the assigned
-- representative can reveal the QR for their own group.
revoke all on function public.admin_daily_attendance_qrs(text,date) from public, anon, authenticated;
