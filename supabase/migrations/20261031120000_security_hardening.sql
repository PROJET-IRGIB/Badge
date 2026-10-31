-- Security hardening for the student portal.
-- Apply once in Supabase after the existing migrations.
begin;

-- The old administrator RPC bypassed the representative PIN and returned the QR token.
revoke all on function public.admin_create_attendance_session(text,text,text,integer) from public, anon, authenticated;
drop function if exists public.admin_create_attendance_session(text,text,text,integer);
revoke all on function public.admin_daily_attendance_qrs(text,date) from public, anon, authenticated;

-- Representatives can still be assigned through SECURITY DEFINER admin RPCs,
-- but authenticated clients may no longer mutate the table directly.
revoke insert, update, delete on public.class_representatives from public, anon, authenticated;
revoke select on public.class_representatives from public, anon, authenticated;
grant select(site,program,level,user_id,assigned_by,assigned_at)
  on public.class_representatives to authenticated;

create or replace function public.admin_remove_class_representative(
  p_site text, p_program text, p_level text, p_student_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;
  select * into rep from public.class_representatives
  where site = p_site and program = p_program and level = p_level and user_id = p_student_id
  for update;
  if not found then raise exception 'Responsable introuvable'; end if;
  if not (select public.is_admin_for_site(rep.site)) then
    raise exception 'Vous n’êtes pas autorisé à gérer ce groupe' using errcode = '42501';
  end if;
  delete from public.class_representatives
  where site = rep.site and program = rep.program and level = rep.level and user_id = rep.user_id;
end;
$$;
revoke all on function public.admin_remove_class_representative(text,text,text,uuid) from public, anon;
grant execute on function public.admin_remove_class_representative(text,text,text,uuid) to authenticated;

-- Freeze the academic scope once the administration has approved the account.
create or replace function public.student_update_profile(
  p_first_name text, p_last_name text, p_phone text, p_sex text,
  p_program text, p_level text, p_site text, p_birth_date date,
  p_origin_group text, p_country_of_origin text
)
returns public.student_profiles language plpgsql security definer set search_path = '' as $$
declare p public.student_profiles%rowtype; origin_value text; country_value text;
begin
  perform public.require_student_account_approved();
  select * into p from public.student_profiles where user_id = (select auth.uid()) for update;
  if not found then raise exception 'Profil étudiant introuvable'; end if;
  if p.banned_at is not null or p.card_suspended_at is not null then
    raise exception 'Ce compte ou cette carte est temporairement désactivé' using errcode = '42501';
  end if;
  if (p.site,p.program,p.level) is distinct from (p_site,p_program,p_level) then
    raise exception 'Le site, la filière et le niveau validés ne peuvent pas être modifiés ici. Contactez l’administration de votre site.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.badge_applications
    where student_id = (select auth.uid()) and status in ('pending','approved')
  ) then raise exception 'Le profil est verrouillé après l’envoi de la demande'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_first_name,''))) not between 1 and 80
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_last_name,''))) not between 1 and 80
     or pg_catalog.left(pg_catalog.btrim(p_first_name),1) in ('=','+','-','@',pg_catalog.chr(9),pg_catalog.chr(13))
     or pg_catalog.left(pg_catalog.btrim(p_last_name),1) in ('=','+','-','@',pg_catalog.chr(9),pg_catalog.chr(13)) then
    raise exception 'Le nom ou le prénom est invalide';
  end if;
  origin_value := pg_catalog.lower(pg_catalog.btrim(coalesce(p_origin_group,'')));
  country_value := pg_catalog.btrim(coalesce(p_country_of_origin,''));
  if origin_value not in ('francophone','anglophone') then raise exception 'Choisissez votre origine francophone ou anglophone'; end if;
  if pg_catalog.length(country_value) not between 2 and 80 then raise exception 'Indiquez votre pays d’origine'; end if;
  update public.student_profiles set
    first_name = pg_catalog.btrim(p_first_name), last_name = pg_catalog.btrim(p_last_name),
    phone = pg_catalog.btrim(p_phone), sex = p_sex, birth_date = p_birth_date,
    origin_group = origin_value, country_of_origin = country_value, updated_at = pg_catalog.now()
  where user_id = (select auth.uid()) returning * into p;
  return p;
end;
$$;
revoke all on function public.student_update_profile(text,text,text,text,text,text,text,date,text,text) from public, anon;
grant execute on function public.student_update_profile(text,text,text,text,text,text,text,date,text,text) to authenticated;

-- Do not approve a banned account or one whose card has been suspended.
create or replace function public.admin_decide_student_account(
  p_student_id uuid, p_approve boolean, p_reason text default null
)
returns text language plpgsql security definer set search_path = '' as $$
declare student public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise' using errcode = '42501'; end if;
  select * into student from public.student_profiles where user_id = p_student_id for update;
  if not found then raise exception 'Compte étudiant introuvable'; end if;
  if not (select public.is_admin_for_site(student.site)) then
    raise exception 'Vous ne pouvez gérer que les comptes de votre site' using errcode = '42501';
  end if;
  if student.email_verified_at is null then raise exception 'L’adresse e-mail doit être confirmée avant l’examen du compte'; end if;
  if p_approve and (student.banned_at is not null or student.card_suspended_at is not null) then
    raise exception 'Un compte banni ou une carte désactivée ne peut pas être confirmé' using errcode = '42501';
  end if;
  update public.student_profiles
  set account_status = case when p_approve then 'approved' else 'rejected' end,
      account_reviewed_at = pg_catalog.now(), account_reviewed_by = (select auth.uid()),
      account_rejection_reason = case when p_approve then null else nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reason,'')),500),'') end,
      updated_at = pg_catalog.now()
  where user_id = p_student_id;
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;
revoke all on function public.admin_decide_student_account(uuid,boolean,text) from public, anon;
grant execute on function public.admin_decide_student_account(uuid,boolean,text) to authenticated;

-- Keep pending applications on an unbounded dossier reference. Reserve the
-- matricule only when an administrator approves. French- and English-origin
-- students have separate global counters, shared across all campuses.
create or replace function public.prepare_application()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.student_profiles%rowtype;
begin
  perform public.require_student_account_approved();
  select * into p from public.student_profiles where user_id = new.student_id for update;
  if not found or new.student_id is distinct from (select auth.uid()) then raise exception 'student profile mismatch'; end if;
  if p.account_status <> 'approved' or p.email_verified_at is null or p.banned_at is not null or p.card_suspended_at is not null then
    raise exception 'Ce compte ou cette carte ne peut pas envoyer une demande';
  end if;
  if p.origin_group not in ('francophone','anglophone') then raise exception 'Choisissez votre origine francophone ou anglophone avant la demande'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p.country_of_origin,''))) not between 2 and 80 then raise exception 'Indiquez votre pays d’origine avant la demande'; end if;
  if new.first_name is distinct from p.first_name or new.last_name is distinct from p.last_name
    or pg_catalog.lower(new.email) is distinct from pg_catalog.lower(p.email) or new.phone is distinct from p.phone
    or new.sex is distinct from p.sex or new.program is distinct from p.program
    or new.level is distinct from p.level or new.site is distinct from p.site or new.birth_date is distinct from p.birth_date
    or new.origin_group is distinct from p.origin_group or new.country_of_origin is distinct from p.country_of_origin then
    raise exception 'application fields must match the verified profile';
  end if;
  if pg_catalog.split_part(new.photo_path,'/',1) <> new.student_id::text or new.photo_path !~ '\.(jpg|png|webp)$' then
    raise exception 'invalid private photo path';
  end if;
  if not exists(select 1 from storage.objects where bucket_id = 'student-photos' and name = new.photo_path) then
    raise exception 'photo upload not found';
  end if;
  new.reserved_matricule := null;
  new.temporary_matricule := 'DOSSIER-' || pg_catalog.upper(new.id::text);
  new.status := 'pending'; new.final_matricule := null; new.decided_at := null;
  new.decided_by := null; new.rejection_reason := null; new.submitted_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.prepare_application() from public, anon, authenticated;

create or replace function public.admin_decide_application(
  p_application_id uuid, p_decision text, p_reason text default null
)
returns public.badge_applications language plpgsql security definer set search_path = '' as $$
declare a public.badge_applications%rowtype; serial_no integer; final_id text; suffix text; origin_key text;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise' using errcode = '42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Décision invalide'; end if;
  if p_decision = 'rejected' and nullif(pg_catalog.btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Un motif de rejet est requis';
  end if;
  select * into a from public.badge_applications where id = p_application_id and status = 'pending' for update;
  if not found then raise exception 'Demande en attente introuvable'; end if;
  if not (select public.is_admin_for_site(a.site)) then raise exception 'Site non autorisé' using errcode = '42501'; end if;

  if p_decision = 'approved' then
    if a.origin_group not in ('francophone','anglophone') then raise exception 'Origine du dossier invalide'; end if;
    if exists (
      select 1 from public.student_profiles p
      where p.user_id = a.student_id and (p.banned_at is not null or p.card_suspended_at is not null or p.account_status <> 'approved')
    ) then raise exception 'Le compte ou la carte de cet étudiant est désactivé' using errcode = '42501'; end if;
    suffix := case when a.origin_group = 'anglophone' then 'A' else 'F' end;
    origin_key := case when suffix = 'A' then 'anglophone' else 'francophone' end;
    update public.matricule_origin_allocators set last_issued = last_issued + 1
    where origin_group = origin_key and last_issued < 9999 returning last_issued into serial_no;
    if serial_no is null then raise exception 'La série de matricules de cette provenance est arrivée à IRGIB-9999%' , suffix; end if;
    final_id := 'IRGIB-' || pg_catalog.lpad(serial_no::text,4,'0') || suffix;
    update public.badge_applications
    set status = 'approved', final_matricule = final_id, reserved_matricule = null,
        decided_at = pg_catalog.now(), decided_by = (select auth.uid())
    where id = p_application_id returning * into a;
  else
    update public.badge_applications
    set status = 'rejected', rejection_reason = pg_catalog.btrim(p_reason), reserved_matricule = null,
        decided_at = pg_catalog.now(), decided_by = (select auth.uid())
    where id = p_application_id returning * into a;
  end if;
  return a;
end;
$$;
revoke all on function public.admin_decide_application(uuid,text,text) from public, anon;
grant execute on function public.admin_decide_application(uuid,text,text) to authenticated;

-- Retire les anciennes réservations faites à la soumission. Le numéro n'est
-- désormais pris que lors de l'approbation. Les deux séries ont chacune leur
-- propre compteur global et les matricules déjà délivrés restent inchangés.
alter table public.badge_applications
  drop constraint if exists badge_applications_reserved_state_check,
  drop constraint if exists badge_applications_final_matches_reserved_check;
drop index if exists public.badge_applications_reserved_matricule_unique;
update public.badge_applications
set reserved_matricule = null,
    temporary_matricule = case when status = 'pending' then 'DOSSIER-' || pg_catalog.upper(id::text) else temporary_matricule end;

create table if not exists public.matricule_origin_allocators (
  origin_group text primary key check (origin_group in ('francophone','anglophone')),
  last_issued integer not null default 0 check (last_issued between 0 and 9999)
);
alter table public.matricule_origin_allocators enable row level security;
revoke all on public.matricule_origin_allocators from public, anon, authenticated;
insert into public.matricule_origin_allocators(origin_group,last_issued)
select origins.origin_group, coalesce(max(substring(a.final_matricule from 7 for 4)::integer),0)
from (values ('francophone'::text,'F'::text),('anglophone'::text,'A'::text)) origins(origin_group,suffix)
left join public.badge_applications a on a.final_matricule ~ ('^IRGIB-[0-9]{4}' || origins.suffix || '$')
group by origins.origin_group
on conflict (origin_group) do update
set last_issued = greatest(public.matricule_origin_allocators.last_issued,excluded.last_issued);

-- PIN attempts are verified by a server function, outside a caller-controlled
-- PostgREST projection. Failed attempts are cumulative and use increasing locks.
revoke all on function public.representative_daily_attendance_qr(text) from public, anon, authenticated;
create or replace function public.verify_representative_daily_qr(p_user_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.student_profiles%rowtype; rep public.class_representatives%rowtype;
  attempts integer; delay interval; day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
  session_row public.attendance_sessions%rowtype; token_value text;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Accès serveur requis' using errcode = '42501'; end if;
  if p_user_id is null or p_pin is null then return jsonb_build_object('ok',false,'message','Code invalide'); end if;
  select * into p from public.student_profiles where user_id = p_user_id for update;
  if not found or p.account_status <> 'approved' or p.email_verified_at is null or p.banned_at is not null or p.card_suspended_at is not null then
    return jsonb_build_object('ok',false,'message','Ce compte ou cette carte est désactivé');
  end if;
  select * into rep from public.class_representatives where user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok',false,'message','Aucun rôle de responsable actif'); end if;
  if rep.daily_qr_pin_hash is null then return jsonb_build_object('ok',false,'message','Configurez d’abord votre code à 4 chiffres'); end if;
  if rep.daily_qr_pin_locked_until is not null and rep.daily_qr_pin_locked_until > pg_catalog.now() then
    return jsonb_build_object('ok',false,'message','Trop de tentatives. Réessayez plus tard.');
  end if;

  if p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin,rep.daily_qr_pin_hash) <> rep.daily_qr_pin_hash then
    attempts := coalesce(rep.daily_qr_pin_failures,0) + 1;
    delay := case when attempts >= 20 then interval '30 days'
                  when attempts >= 15 then interval '24 hours'
                  when attempts >= 10 then interval '1 hour'
                  when attempts >= 5 then interval '15 minutes'
                  else null end;
    update public.class_representatives
    set daily_qr_pin_failures = attempts,
        daily_qr_pin_locked_until = case when delay is null then null else pg_catalog.now() + delay end
    where user_id = p_user_id;
    return jsonb_build_object('ok',false,'message','Code incorrect');
  end if;

  update public.class_representatives set daily_qr_pin_failures = 0,daily_qr_pin_locked_until = null
  where user_id = p_user_id;
  perform public.ensure_daily_attendance_sessions(day_value);
  select * into session_row from public.attendance_sessions s
  where (s.site,s.program,s.level,s.session_day,s.is_daily) = (rep.site,rep.program,rep.level,day_value,true)
    and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now();
  if not found then return jsonb_build_object('ok',false,'message','Le QR du jour n’est pas disponible'); end if;
  select k.token into token_value from public.attendance_session_secrets k where k.session_id = session_row.id;
  if token_value is null then return jsonb_build_object('ok',false,'message','Le QR du jour est indisponible'); end if;
  return jsonb_build_object('ok',true,'token',token_value,'site',rep.site,'program',rep.program,'level',rep.level,
    'course_title',session_row.course_title,'session_day',session_row.session_day,'ends_at',session_row.ends_at);
end;
$$;
revoke all on function public.verify_representative_daily_qr(uuid,text) from public, anon, authenticated;
grant execute on function public.verify_representative_daily_qr(uuid,text) to service_role;

-- Retain only valid Web Push endpoints, require an approved account to add one,
-- and enforce a strict endpoint allowlist before any server-side request.
delete from public.push_subscriptions
where not (
  endpoint ~* '^https://fcm[.]googleapis[.]com(:443)?/'
  or endpoint ~* '^https://[a-z0-9-]+([.][a-z0-9-]+)*[.]push[.]services[.]mozilla[.]com(:443)?/'
  or endpoint ~* '^https://[a-z0-9-]+([.][a-z0-9-]+)*[.]notify[.]windows[.]com(:443)?/'
  or endpoint ~* '^https://[a-z0-9-]+([.][a-z0-9-]+)*[.]push[.]apple[.]com(:443)?/'
);
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_allowlist;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_allowlist check (
  endpoint ~* '^https://fcm[.]googleapis[.]com(:443)?/'
  or endpoint ~* '^https://[a-z0-9-]+([.][a-z0-9-]+)*[.]push[.]services[.]mozilla[.]com(:443)?/'
  or endpoint ~* '^https://[a-z0-9-]+([.][a-z0-9-]+)*[.]notify[.]windows[.]com(:443)?/'
  or endpoint ~* '^https://[a-z0-9-]+([.][a-z0-9-]+)*[.]push[.]apple[.]com(:443)?/'
);
drop policy if exists "students manage own push subscriptions" on public.push_subscriptions;
create policy "students manage own push subscriptions" on public.push_subscriptions
for all to authenticated using (
  user_id = (select auth.uid()) and (select public.student_account_is_approved())
) with check (
  user_id = (select auth.uid()) and (select public.student_account_is_approved())
  and exists (select 1 from public.student_profiles p where p.user_id = (select auth.uid()) and p.site = push_subscriptions.site and p.banned_at is null)
);
drop policy if exists "approved accounts only push subscriptions" on public.push_subscriptions;
create policy "approved accounts only push subscriptions" on public.push_subscriptions
as restrictive for all to authenticated
using ((select public.student_account_is_approved()))
with check ((select public.student_account_is_approved()));

-- Validate photo ownership and account status without imposing an account-level
-- photo-count ceiling. The storage bucket still enforces its existing per-file limit.
create or replace function public.validate_student_photo_upload()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  if new.bucket_id <> 'student-photos' then return new; end if;
  actor := (select auth.uid());
  if actor is null or new.owner_id is distinct from actor::text
     or (storage.foldername(new.name))[1] is distinct from actor::text
     or new.name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+[.](jpg|png|webp)$' then
    raise exception 'Chemin ou propriétaire de photo invalide' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.student_profiles p where p.user_id = actor and p.account_status = 'approved'
      and p.email_verified_at is not null and p.banned_at is null and p.card_suspended_at is null
  ) then raise exception 'Compte étudiant non autorisé à envoyer une photo' using errcode = '42501'; end if;
  if exists (
    select 1 from public.badge_applications a where a.student_id = actor and a.status in ('pending','approved')
  ) then raise exception 'Une demande active existe déjà'; end if;
  return new;
end;
$$;
revoke all on function public.validate_student_photo_upload() from public, anon, authenticated;
drop trigger if exists enforce_student_photo_quota on storage.objects;
drop trigger if exists validate_student_photo_upload on storage.objects;
create trigger validate_student_photo_upload
before insert or update of bucket_id,name,owner_id on storage.objects
for each row execute function public.validate_student_photo_upload();

drop policy if exists "student uploads own photo" on storage.objects;
create policy "student uploads own photo" on storage.objects for insert to authenticated
with check (
  bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+[.](jpg|png|webp)$'
  and exists (select 1 from public.student_profiles p where p.user_id = (select auth.uid())
    and p.account_status = 'approved' and p.email_verified_at is not null and p.banned_at is null and p.card_suspended_at is null)
  and not exists (select 1 from public.badge_applications a where a.student_id = (select auth.uid()) and a.status in ('pending','approved'))
);

-- Remove the misspelled address from the public global-admin allowlist.
delete from public.admin_members m using auth.users u
where m.user_id = u.id and pg_catalog.lower(u.email) = 'jesusesonoesononchama219@gmal.com';

commit;
