-- Record each student's linguistic origin and country of origin.
-- New matricules use F (Francophone) or A (Anglophone); existing matricules,
-- including historical B matricules, remain unchanged.
begin;

alter table public.student_profiles
  add column if not exists origin_group text,
  add column if not exists country_of_origin text;
alter table public.student_profiles
  drop constraint if exists student_profiles_origin_group_check,
  drop constraint if exists student_profiles_country_of_origin_check;
alter table public.student_profiles
  add constraint student_profiles_origin_group_check
    check (origin_group is null or origin_group in ('francophone','anglophone')),
  add constraint student_profiles_country_of_origin_check
    check (country_of_origin is null or (pg_catalog.length(pg_catalog.btrim(country_of_origin)) between 2 and 80));

alter table public.badge_applications
  add column if not exists origin_group text,
  add column if not exists country_of_origin text;
alter table public.badge_applications
  drop constraint if exists badge_applications_origin_group_check,
  drop constraint if exists badge_applications_country_of_origin_check;
alter table public.badge_applications
  add constraint badge_applications_origin_group_check
    check (origin_group is null or origin_group in ('francophone','anglophone')),
  add constraint badge_applications_country_of_origin_check
    check (country_of_origin is null or (pg_catalog.length(pg_catalog.btrim(country_of_origin)) between 2 and 80));

-- The existing approval migration remains intact. This trigger now also saves
-- the required origin fields submitted with a new student's email signup.
create or replace function public.create_student_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  origin_value text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'origin_group','')));
  country_value text := pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'country_of_origin',''));
begin
  if coalesce(new.raw_user_meta_data->>'account_type','') <> 'student' then return new; end if;
  if origin_value not in ('francophone','anglophone') then
    raise exception 'Choisissez votre origine : francophone ou anglophone';
  end if;
  if pg_catalog.length(country_value) not between 2 and 80 then
    raise exception 'Indiquez votre pays d’origine';
  end if;
  insert into public.student_profiles
    (user_id,first_name,last_name,email,phone,sex,program,level,site,origin_group,country_of_origin)
  values
    (new.id,pg_catalog.btrim(new.raw_user_meta_data->>'first_name'),
     pg_catalog.btrim(new.raw_user_meta_data->>'last_name'),pg_catalog.lower(new.email),
     pg_catalog.btrim(new.raw_user_meta_data->>'phone'),new.raw_user_meta_data->>'sex',
     new.raw_user_meta_data->>'program',new.raw_user_meta_data->>'level',new.raw_user_meta_data->>'site',
     origin_value,country_value);
  return new;
end;
$$;
revoke all on function public.create_student_profile() from public, anon, authenticated;

-- Remove the old RPC signatures, including the interim study-language version
-- if it was ever applied, then expose only the origin-based version.
drop function if exists public.student_update_profile(text,text,text,text,text,text,text,date);
drop function if exists public.student_update_profile(text,text,text,text,text,text,text,date,text);
drop function if exists public.student_update_profile(text,text,text,text,text,text,text,date,text,text);
create function public.student_update_profile(
  p_first_name text, p_last_name text, p_phone text, p_sex text,
  p_program text, p_level text, p_site text, p_birth_date date,
  p_origin_group text, p_country_of_origin text
)
returns public.student_profiles language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype; origin_value text; country_value text;
begin
  perform public.require_student_account_approved();
  select * into p from public.student_profiles where user_id=(select auth.uid()) for update;
  if not found then raise exception 'Profil étudiant introuvable'; end if;
  if p.banned_at is not null then raise exception 'Votre compte est banni' using errcode='42501'; end if;
  if exists (select 1 from public.badge_applications where student_id=(select auth.uid()) and status in ('pending','approved')) then
    raise exception 'Le profil est verrouillé après l’envoi de la demande';
  end if;
  origin_value := pg_catalog.lower(pg_catalog.btrim(coalesce(p_origin_group,'')));
  country_value := pg_catalog.btrim(coalesce(p_country_of_origin,''));
  if origin_value not in ('francophone','anglophone') then raise exception 'Choisissez votre origine francophone ou anglophone'; end if;
  if pg_catalog.length(country_value) not between 2 and 80 then raise exception 'Indiquez votre pays d’origine'; end if;
  update public.student_profiles set
    first_name=pg_catalog.btrim(p_first_name),last_name=pg_catalog.btrim(p_last_name),
    phone=pg_catalog.btrim(p_phone),sex=p_sex,program=p_program,level=p_level,site=p_site,
    birth_date=p_birth_date,origin_group=origin_value,country_of_origin=country_value,
    updated_at=pg_catalog.now()
  where user_id=(select auth.uid()) returning * into p;
  return p;
end;
$$;
revoke all on function public.student_update_profile(text,text,text,text,text,text,text,date,text,text) from public, anon;
grant execute on function public.student_update_profile(text,text,text,text,text,text,text,date,text,text) to authenticated;

alter table public.badge_applications
  drop constraint if exists badge_applications_reserved_matricule_format,
  drop constraint if exists badge_applications_final_matricule_check,
  drop constraint if exists badge_applications_final_matricule_language_check,
  drop constraint if exists badge_applications_final_matricule_origin_format;
alter table public.badge_applications
  add constraint badge_applications_reserved_matricule_format
    check (reserved_matricule is null or reserved_matricule ~ '^IRGIB-[0-9]{4}[FBA]$'),
  add constraint badge_applications_final_matricule_origin_format
    check (final_matricule is null or final_matricule ~ '^IRGIB-[0-9]{4}[FBA]$');

-- Continue after all existing numbers; never rewrite or reuse a historical ID.
-- The previous allocator had a second B range after 9999, so cap that legacy
-- counter and use the highest number already present as the new high-water mark.
do $$
declare highest_number integer; previous_serial integer;
begin
  select coalesce(max(case when code ~ '^IRGIB-[0-9]{4}[FBA]$'
    then pg_catalog.substr(code,7,4)::integer else 0 end),0)
    into highest_number
  from (
    select reserved_matricule as code from public.badge_applications where reserved_matricule is not null
    union all
    select final_matricule as code from public.badge_applications where final_matricule is not null
  ) issued;
  select least(last_issued,9999) into previous_serial
    from public.matricule_allocator where id=true;
  highest_number := greatest(highest_number,coalesce(previous_serial,0));
  update public.matricule_allocator set last_issued=highest_number where id=true;
end;
$$;
alter table public.matricule_allocator
  drop constraint if exists matricule_allocator_last_issued_check;
alter table public.matricule_allocator
  add constraint matricule_allocator_last_issued_check check (last_issued between 0 and 9999);

create or replace function public.prepare_application()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  p public.student_profiles%rowtype;
  serial_no integer;
  suffix text;
  code text;
begin
  select * into p from public.student_profiles where user_id=new.student_id for update;
  if not found or new.student_id<>(select auth.uid()) then raise exception 'student profile mismatch'; end if;
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
  if not exists(select 1 from storage.objects where bucket_id='student-photos' and name=new.photo_path) then
    raise exception 'photo upload not found';
  end if;

  update public.matricule_allocator set last_issued=last_issued+1
    where id=true and last_issued<9999 returning last_issued into serial_no;
  if serial_no is null then raise exception 'Matricule capacity exhausted'; end if;
  suffix := case when p.origin_group='anglophone' then 'A' else 'F' end;
  code := 'IRGIB-' || pg_catalog.lpad(serial_no::text,4,'0') || suffix;
  new.reserved_matricule := code;
  new.temporary_matricule := 'TMP-' || code;
  new.status := 'pending'; new.final_matricule := null; new.decided_at := null;
  new.decided_by := null; new.rejection_reason := null; new.submitted_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.prepare_application() from public, anon, authenticated;

commit;
