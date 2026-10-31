-- Student accounts must be approved by the administration of their campus
-- after email confirmation and before they can access student features.
begin;

alter table public.student_profiles
  add column if not exists account_status text not null default 'pending',
  add column if not exists email_verified_at timestamptz,
  add column if not exists account_reviewed_at timestamptz,
  add column if not exists account_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists account_rejection_reason text;

alter table public.student_profiles
  drop constraint if exists student_profiles_account_status_check;
alter table public.student_profiles
  add constraint student_profiles_account_status_check
  check (account_status in ('pending','approved','rejected'));

-- Existing students with a confirmed email keep access. Unverified accounts
-- remain pending and will not appear in the campus approval queue.
update public.student_profiles p
set account_status = case when u.email_confirmed_at is not null then 'approved' else 'pending' end,
    email_verified_at = coalesce(p.email_verified_at, u.email_confirmed_at),
    account_reviewed_at = case when u.email_confirmed_at is not null then coalesce(p.account_reviewed_at, pg_catalog.now()) else null end
from auth.users u
where u.id = p.user_id and p.account_status = 'pending';

create or replace function public.sync_student_email_verification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    update public.student_profiles
      set email_verified_at = new.email_confirmed_at, updated_at = pg_catalog.now()
      where user_id = new.id and email_verified_at is null;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_student_email_verification() from public, anon, authenticated;
drop trigger if exists z_sync_student_email_verification_after_insert on auth.users;
create trigger z_sync_student_email_verification_after_insert
  after insert on auth.users for each row execute function public.sync_student_email_verification();
drop trigger if exists sync_student_email_verification_after_confirm on auth.users;
create trigger sync_student_email_verification_after_confirm
  after update of email_confirmed_at on auth.users for each row
  when (new.email_confirmed_at is not null and old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function public.sync_student_email_verification();

create or replace function public.is_admin_account()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admin_members m where m.user_id = (select auth.uid()))
      or exists (select 1 from public.admin_site_members s where s.user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin_account() from public, anon;
grant execute on function public.is_admin_account() to authenticated;

create or replace function public.student_account_is_approved()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.student_profiles p
    where p.user_id = (select auth.uid())
      and p.account_status = 'approved'
      and p.email_verified_at is not null
      and p.banned_at is null
  );
$$;
revoke all on function public.student_account_is_approved() from public, anon;
grant execute on function public.student_account_is_approved() to authenticated;

create or replace function public.require_student_account_approved()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select public.student_account_is_approved()) then
    raise exception 'Votre compte étudiant est en cours de confirmation par l’administration de votre site. Le délai de traitement est de 72 h au maximum. Réessayez plus tard.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.require_student_account_approved() from public, anon;
grant execute on function public.require_student_account_approved() to authenticated;

create or replace function public.admin_decide_student_account(p_student_id uuid, p_approve boolean, p_reason text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare student public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise' using errcode = '42501'; end if;
  select * into student from public.student_profiles where user_id = p_student_id for update;
  if not found then raise exception 'Compte étudiant introuvable'; end if;
  if not (select public.is_admin_for_site(student.site)) then
    raise exception 'Vous ne pouvez gérer que les comptes de votre site' using errcode = '42501';
  end if;
  if student.email_verified_at is null then raise exception 'L’adresse e-mail doit être confirmée avant l’examen du compte'; end if;

  update public.student_profiles
  set account_status = case when p_approve then 'approved' else 'rejected' end,
      account_reviewed_at = pg_catalog.now(),
      account_reviewed_by = (select auth.uid()),
      account_rejection_reason = case when p_approve then null else nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reason,'')),500),'') end,
      updated_at = pg_catalog.now()
  where user_id = p_student_id;
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;
revoke all on function public.admin_decide_student_account(uuid,boolean,text) from public, anon;
grant execute on function public.admin_decide_student_account(uuid,boolean,text) to authenticated;

-- RLS keeps pending accounts from reading or writing student data even if they
-- call the API directly instead of using the portal UI. Existing per-site
-- permissive policies continue to define each administrator's scope.
drop policy if exists "approved accounts only badge applications" on public.badge_applications;
create policy "approved accounts only badge applications" on public.badge_applications
  as restrictive for all to authenticated
  using ((select public.is_admin_account()) or (select public.student_account_is_approved()))
  with check ((select public.is_admin_account()) or (select public.student_account_is_approved()));

drop policy if exists "approved accounts only attendance sessions" on public.attendance_sessions;
create policy "approved accounts only attendance sessions" on public.attendance_sessions
  as restrictive for all to authenticated
  using ((select public.is_admin_account()) or (select public.student_account_is_approved()))
  with check ((select public.is_admin_account()) or (select public.student_account_is_approved()));

drop policy if exists "approved accounts only attendance records" on public.attendance_records;
create policy "approved accounts only attendance records" on public.attendance_records
  as restrictive for all to authenticated
  using ((select public.is_admin_account()) or (select public.student_account_is_approved()))
  with check ((select public.is_admin_account()) or (select public.student_account_is_approved()));

drop policy if exists "approved accounts only class representatives" on public.class_representatives;
create policy "approved accounts only class representatives" on public.class_representatives
  as restrictive for all to authenticated
  using ((select public.is_admin_account()) or (select public.student_account_is_approved()))
  with check ((select public.is_admin_account()) or (select public.student_account_is_approved()));

drop policy if exists "approved accounts only campus announcements" on public.campus_announcements;
create policy "approved accounts only campus announcements" on public.campus_announcements
  as restrictive for all to authenticated
  using ((select public.is_admin_account()) or (select public.student_account_is_approved()))
  with check ((select public.is_admin_account()) or (select public.student_account_is_approved()));

drop policy if exists "approved accounts only private campus media" on storage.objects;
create policy "approved accounts only private campus media" on storage.objects
  as restrictive for all to authenticated
  using (bucket_id not in ('student-photos','campus-announcement-media')
    or (select public.is_admin_account()) or (select public.student_account_is_approved()))
  with check (bucket_id not in ('student-photos','campus-announcement-media')
    or (select public.is_admin_account()) or (select public.student_account_is_approved()));

-- Security-definer student RPCs do not inherit RLS, so they check approval here.
create or replace function public.student_update_profile(
  p_first_name text, p_last_name text, p_phone text, p_sex text,
  p_program text, p_level text, p_site text, p_birth_date date
)
returns public.student_profiles language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype;
begin
  perform public.require_student_account_approved();
  select * into p from public.student_profiles where user_id = (select auth.uid()) for update;
  if not found then raise exception 'Profil étudiant introuvable'; end if;
  if exists (select 1 from public.badge_applications where student_id = (select auth.uid()) and status in ('pending','approved')) then
    raise exception 'Le profil est verrouillé après l’envoi de la demande';
  end if;
  update public.student_profiles set first_name = pg_catalog.btrim(p_first_name), last_name = pg_catalog.btrim(p_last_name),
    phone = pg_catalog.btrim(p_phone), sex = p_sex, program = p_program, level = p_level, site = p_site,
    birth_date = p_birth_date, updated_at = pg_catalog.now()
    where user_id = (select auth.uid()) returning * into p;
  return p;
end;
$$;
revoke all on function public.student_update_profile(text,text,text,text,text,text,text,date) from public, anon;
grant execute on function public.student_update_profile(text,text,text,text,text,text,text,date) to authenticated;

create or replace function public.submit_attendance(p_token text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype; rec public.attendance_records%rowtype;
begin
  perform public.require_student_account_approved();
  select * into strict p from public.student_profiles where user_id = (select auth.uid());
  if p.card_suspended_at is not null then raise exception 'Votre carte est temporairement désactivée. Contactez l’administration de votre site.' using errcode = '42501'; end if;
  if not exists (select 1 from public.badge_applications a where a.student_id = p.user_id and a.status = 'approved') then
    raise exception 'Votre demande doit être approuvée pour enregistrer une présence';
  end if;
  select * into s from public.attendance_sessions
    where token_digest = encode(extensions.digest(p_token,'sha256'),'hex') and starts_at <= pg_catalog.now() and ends_at >= pg_catalog.now();
  if not found then raise exception 'QR invalide ou séance terminée'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then raise exception 'Ce QR ne correspond pas à votre groupe'; end if;
  insert into public.attendance_records as existing_record(session_id,student_id,status,attended_at)
    values(s.id,p.user_id,'present',pg_catalog.now())
    on conflict(session_id,student_id) do update set status='present',attended_at=pg_catalog.now()
      where existing_record.status='absent' returning * into rec;
  if not found then raise exception 'Présence déjà enregistrée'; end if;
  return rec;
end;
$$;
revoke all on function public.submit_attendance(text) from public, anon;
grant execute on function public.submit_attendance(text) to authenticated;

create or replace function public.student_attendance_session_info(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype;
begin
  perform public.require_student_account_approved();
  select * into strict p from public.student_profiles where user_id = (select auth.uid());
  if p.card_suspended_at is not null then raise exception 'Cette carte est désactivée' using errcode = '42501'; end if;
  if not exists (select 1 from public.badge_applications a where a.student_id = p.user_id and a.status = 'approved') then raise exception 'Votre demande doit être approuvée avant le pointage'; end if;
  select * into s from public.attendance_sessions where token_digest = encode(extensions.digest(p_token,'sha256'),'hex') and starts_at <= pg_catalog.now() and ends_at >= pg_catalog.now();
  if not found then raise exception 'QR de séance invalide ou expiré'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then raise exception 'Ce QR ne correspond pas à votre site, filière et niveau'; end if;
  if exists (select 1 from public.attendance_records r where r.session_id = s.id and r.student_id = p.user_id and r.status = 'present') then raise exception 'Votre présence à cette séance est déjà enregistrée'; end if;
  return jsonb_build_object('site',s.site,'program',s.program,'level',s.level,'course_title',s.course_title,'session_day',s.session_day,'ends_at',s.ends_at);
end;
$$;
revoke all on function public.student_attendance_session_info(text) from public, anon;
grant execute on function public.student_attendance_session_info(text) to authenticated;

create or replace function public.list_representative_groupmates()
returns table(student_id uuid,first_name text,last_name text,final_matricule text)
language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype; day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives cr where cr.user_id = (select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (select 1 from public.student_profiles p where p.user_id = (select auth.uid()) and p.card_suspended_at is not null) then raise exception 'Votre compte ne peut pas accéder au pointage' using errcode = '42501'; end if;
  perform public.ensure_daily_attendance_sessions(day_value);
  return query select a.student_id,a.first_name,a.last_name,a.final_matricule
    from public.badge_applications a
    join public.student_profiles p on p.user_id = a.student_id and p.banned_at is null and p.card_suspended_at is null
    join public.attendance_sessions s on (s.site,s.program,s.level,s.session_day,s.is_daily) = (rep.site,rep.program,rep.level,day_value,true)
    join public.attendance_records r on r.session_id = s.id and r.student_id = a.student_id
    where a.status = 'approved' and (a.site,a.program,a.level) = (rep.site,rep.program,rep.level)
      and a.student_id <> (select auth.uid()) and a.final_matricule is not null and r.status = 'absent'
      and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now() order by a.last_name,a.first_name;
end;
$$;
revoke all on function public.list_representative_groupmates() from public, anon;
grant execute on function public.list_representative_groupmates() to authenticated;

create or replace function public.verify_classmate_badge(p_student_id uuid,p_scanned_qr text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype; student_row public.badge_applications%rowtype; target public.student_profiles%rowtype;
  session_row public.attendance_sessions%rowtype; day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives cr where cr.user_id = (select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (select 1 from public.student_profiles p where p.user_id = (select auth.uid()) and p.card_suspended_at is not null) then raise exception 'Votre compte ne peut pas utiliser le pointage' using errcode = '42501'; end if;
  if p_student_id = (select auth.uid()) then raise exception 'Vous ne pouvez pas vous pointer avec le scan délégué'; end if;
  select * into target from public.student_profiles p where p.user_id = p_student_id;
  if not found or target.banned_at is not null or target.card_suspended_at is not null or target.account_status <> 'approved' then raise exception 'Cette carte est désactivée'; end if;
  select * into student_row from public.badge_applications a where a.student_id = p_student_id and a.status = 'approved' and (a.site,a.program,a.level) = (rep.site,rep.program,rep.level);
  if not found then raise exception 'Cet étudiant n’appartient pas à votre groupe'; end if;
  if student_row.final_matricule is null or p_scanned_qr is distinct from ('IRGIB-CARTE:' || student_row.final_matricule) then raise exception 'Le QR ne correspond pas à l’étudiant sélectionné'; end if;
  perform public.ensure_daily_attendance_sessions(day_value);
  select * into session_row from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily) = (rep.site,rep.program,rep.level,day_value,true) and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now();
  if not found then raise exception 'La présence du jour n’est pas ouverte'; end if;
  if exists (select 1 from public.attendance_records r where r.session_id = session_row.id and r.student_id = p_student_id and r.status = 'present') then raise exception 'La présence de cet étudiant est déjà enregistrée'; end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.verify_classmate_badge(uuid,text) from public, anon;
grant execute on function public.verify_classmate_badge(uuid,text) to authenticated;

create or replace function public.mark_classmate_attendance(p_student_id uuid,p_scanned_qr text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype; student_row public.badge_applications%rowtype; target public.student_profiles%rowtype;
  session_row public.attendance_sessions%rowtype; rec public.attendance_records%rowtype; day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives cr where cr.user_id = (select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (select 1 from public.student_profiles p where p.user_id = (select auth.uid()) and p.card_suspended_at is not null) then raise exception 'Votre compte ne peut pas utiliser le pointage' using errcode = '42501'; end if;
  if p_student_id = (select auth.uid()) then raise exception 'Utilisez votre propre espace pour marquer votre présence'; end if;
  select * into target from public.student_profiles p where p.user_id = p_student_id;
  if not found or target.banned_at is not null or target.card_suspended_at is not null or target.account_status <> 'approved' then raise exception 'Le badge de cet étudiant est désactivé ou son compte ne peut pas être pointé' using errcode = '42501'; end if;
  select * into student_row from public.badge_applications a where a.student_id = p_student_id and a.status = 'approved' and (a.site,a.program,a.level) = (rep.site,rep.program,rep.level);
  if not found then raise exception 'Cet étudiant n’appartient pas à votre groupe'; end if;
  if student_row.final_matricule is null or p_scanned_qr is distinct from ('IRGIB-CARTE:' || student_row.final_matricule) then raise exception 'Le QR scanné ne correspond pas à l’étudiant sélectionné'; end if;
  perform public.ensure_daily_attendance_sessions(day_value);
  select * into session_row from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily) = (rep.site,rep.program,rep.level,day_value,true) and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now();
  if not found then raise exception 'La présence du jour n’est pas ouverte'; end if;
  insert into public.attendance_records as existing_record(session_id,student_id,status,attended_at,marked_by)
    values(session_row.id,p_student_id,'present',pg_catalog.now(),(select auth.uid()))
    on conflict(session_id,student_id) do update set status='present',attended_at=pg_catalog.now(),marked_by=(select auth.uid())
      where existing_record.status = 'absent' returning * into rec;
  if not found then raise exception 'La présence de cet étudiant est déjà enregistrée'; end if;
  return rec;
end;
$$;
revoke all on function public.mark_classmate_attendance(uuid,text) from public, anon;
grant execute on function public.mark_classmate_attendance(uuid,text) to authenticated;

create or replace function public.representative_daily_qr_pin_status()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_student_account_approved();
  if exists (select 1 from public.student_profiles p where p.user_id = (select auth.uid()) and p.banned_at is not null) then raise exception 'Votre compte est banni' using errcode = '42501'; end if;
  return exists (select 1 from public.class_representatives cr where cr.user_id = (select auth.uid()) and cr.daily_qr_pin_hash is not null);
end;
$$;
revoke all on function public.representative_daily_qr_pin_status() from public, anon;
grant execute on function public.representative_daily_qr_pin_status() to authenticated;

create or replace function public.set_representative_daily_qr_pin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives where user_id = (select auth.uid()) for update;
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'Le code doit contenir exactement 4 chiffres'; end if;
  if rep.daily_qr_pin_hash is not null then raise exception 'Le code est déjà configuré'; end if;
  update public.class_representatives set daily_qr_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf',10)), daily_qr_pin_failures = 0, daily_qr_pin_locked_until = null where user_id = (select auth.uid());
end;
$$;
revoke all on function public.set_representative_daily_qr_pin(text) from public, anon;
grant execute on function public.set_representative_daily_qr_pin(text) to authenticated;

create or replace function public.representative_daily_attendance_qr(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype; day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
  session_row public.attendance_sessions%rowtype; token_value text;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives where user_id = (select auth.uid()) for update;
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (select 1 from public.student_profiles p where p.user_id = (select auth.uid()) and p.banned_at is not null) then raise exception 'Votre compte est banni' using errcode = '42501'; end if;
  if rep.daily_qr_pin_hash is null then raise exception 'Configurez d’abord votre code à 4 chiffres'; end if;
  if rep.daily_qr_pin_locked_until is not null and rep.daily_qr_pin_locked_until > pg_catalog.now() then raise exception 'Trop de tentatives. Réessayez après %', pg_catalog.to_char(rep.daily_qr_pin_locked_until at time zone 'Africa/Porto-Novo','HH24:MI'); end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin,rep.daily_qr_pin_hash) <> rep.daily_qr_pin_hash then
    update public.class_representatives set daily_qr_pin_failures = case when daily_qr_pin_failures + 1 >= 5 then 0 else daily_qr_pin_failures + 1 end,
      daily_qr_pin_locked_until = case when daily_qr_pin_failures + 1 >= 5 then pg_catalog.now() + interval '15 minutes' else null end where user_id = (select auth.uid());
    return jsonb_build_object('ok',false,'message','Code incorrect');
  end if;
  update public.class_representatives set daily_qr_pin_failures = 0,daily_qr_pin_locked_until = null where user_id = (select auth.uid());
  perform public.ensure_daily_attendance_sessions(day_value);
  select s.* into session_row from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily) = (rep.site,rep.program,rep.level,day_value,true) and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now();
  if not found then raise exception 'Le QR de présence du jour n’est pas disponible'; end if;
  select k.token into token_value from public.attendance_session_secrets k where k.session_id = session_row.id;
  if token_value is null then raise exception 'Le QR de présence du jour est indisponible'; end if;
  return jsonb_build_object('ok',true,'token',token_value,'site',rep.site,'program',rep.program,'level',rep.level,'course_title',session_row.course_title,'session_day',session_row.session_day,'ends_at',session_row.ends_at);
end;
$$;
revoke all on function public.representative_daily_attendance_qr(text) from public, anon;
grant execute on function public.representative_daily_attendance_qr(text) to authenticated;

commit;
