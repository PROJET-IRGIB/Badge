begin;

-- Two independent, global counters (one per provenance), each in a fixed
-- four-digit format: IRGIB-0001F and IRGIB-0001A.
alter table public.matricule_origin_allocators
  alter column last_issued type bigint using last_issued::bigint;
alter table public.matricule_origin_allocators
  drop constraint if exists matricule_origin_allocators_last_issued_check,
  add constraint matricule_origin_allocators_last_issued_check check (last_issued between 0 and 9999);

update public.matricule_origin_allocators c
set last_issued = greatest(c.last_issued, coalesce(issued.last_number, 0))
from (
  select o.origin_group,
    max(substring(a.final_matricule from '^IRGIB-([0-9]+)[FA]$')::bigint) as last_number
  from public.matricule_origin_allocators o
  left join public.badge_applications a
    on a.final_matricule ~ ('^IRGIB-[0-9]{4}' || case when o.origin_group='anglophone' then 'A' else 'F' end || '$')
  group by o.origin_group
) issued
where c.origin_group=issued.origin_group;

alter table public.badge_applications
  drop constraint if exists badge_applications_final_matricule_origin_format,
  drop constraint if exists badge_applications_final_matricule_check,
  add constraint badge_applications_final_matricule_fixed_origin_format
    check (final_matricule is null or final_matricule ~ '^IRGIB-[0-9]{4}[FA]$');

create or replace function public.admin_decide_application(
  p_application_id uuid, p_decision text, p_reason text default null
)
returns public.badge_applications language plpgsql security definer set search_path = '' as $$
declare
  a public.badge_applications%rowtype;
  serial_no bigint;
  final_id text;
  suffix text;
  origin_key text;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Décision invalide'; end if;
  if p_decision='rejected' and nullif(pg_catalog.btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Un motif de rejet est requis';
  end if;
  select * into a from public.badge_applications
    where id=p_application_id and status='pending' for update;
  if not found then raise exception 'Demande en attente introuvable'; end if;
  if not (select public.is_admin_for_site(a.site)) then raise exception 'Site non autorisé' using errcode='42501'; end if;

  if p_decision='approved' then
    if a.origin_group not in ('francophone','anglophone') then raise exception 'Origine du dossier invalide'; end if;
    if exists(select 1 from public.student_profiles p where p.user_id=a.student_id
      and (p.banned_at is not null or p.card_suspended_at is not null or p.account_status <> 'approved')) then
      raise exception 'Le compte ou la carte de cet étudiant est désactivé' using errcode='42501';
    end if;
    suffix := case when a.origin_group='anglophone' then 'A' else 'F' end;
    origin_key := case when suffix='A' then 'anglophone' else 'francophone' end;
    update public.matricule_origin_allocators
      set last_issued=last_issued+1 where origin_group=origin_key and last_issued < 9999 returning last_issued into serial_no;
    if serial_no is null then raise exception 'La série de matricules % est épuisée (maximum IRGIB-9999%).', origin_key, suffix; end if;
    final_id := 'IRGIB-' || pg_catalog.lpad(serial_no::text,4,'0') || suffix;
    update public.badge_applications set status='approved',final_matricule=final_id,
      reserved_matricule=null,decided_at=pg_catalog.now(),decided_by=(select auth.uid())
      where id=p_application_id returning * into a;
  else
    update public.badge_applications set status='rejected',rejection_reason=pg_catalog.btrim(p_reason),
      reserved_matricule=null,decided_at=pg_catalog.now(),decided_by=(select auth.uid())
      where id=p_application_id returning * into a;
  end if;
  return a;
end;
$$;
revoke all on function public.admin_decide_application(uuid,text,text) from public,anon;
grant execute on function public.admin_decide_application(uuid,text,text) to authenticated;

-- An administrator may correct card details for a student at their own site.
-- The site, email, origin and matricule are intentionally immutable here.
create or replace function public.admin_update_student_card_details(
  p_student_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_sex text,
  p_program text,
  p_level text,
  p_birth_date date,
  p_origin_group text,
  p_country_of_origin text
)
returns void language plpgsql security definer set search_path = '' as $$
declare student public.student_profiles%rowtype; app public.badge_applications%rowtype;
  serial_no bigint; final_id text; suffix text; origin_key text;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise' using errcode='42501'; end if;
  select * into student from public.student_profiles where user_id=p_student_id for update;
  if not found then raise exception 'Étudiant introuvable'; end if;
  if not (select public.is_admin_for_site(student.site)) then
    raise exception 'Vous ne pouvez modifier que les étudiants de votre site' using errcode='42501';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_first_name,''))) not between 1 and 80
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_last_name,''))) not between 1 and 80
    or pg_catalog.left(pg_catalog.btrim(p_first_name),1) in ('=','+','-','@',pg_catalog.chr(9),pg_catalog.chr(13))
    or pg_catalog.left(pg_catalog.btrim(p_last_name),1) in ('=','+','-','@',pg_catalog.chr(9),pg_catalog.chr(13))
    or p_sex not in ('M','F')
    or p_program not in ('ABM','TIC','PFMI','PEA','PP','BBA','SJ','NUT')
    or p_level not in ('LP1','LP2','LP3','M1','M2')
    or p_origin_group not in ('francophone','anglophone')
    or p_birth_date is null or p_birth_date > current_date
    or p_birth_date < (current_date - interval '120 years')::date
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_country_of_origin,''))) not between 2 and 80 then
    raise exception 'Vérifiez les informations saisies';
  end if;

  if (student.program,student.level) is distinct from (p_program,p_level) then
    delete from public.class_representatives where user_id=p_student_id;
  end if;
  update public.student_profiles set
    first_name=pg_catalog.btrim(p_first_name), last_name=pg_catalog.btrim(p_last_name),
    phone=pg_catalog.btrim(coalesce(p_phone,'')), sex=p_sex, program=p_program,
    level=p_level, birth_date=p_birth_date,
    origin_group=p_origin_group, country_of_origin=pg_catalog.btrim(p_country_of_origin), updated_at=pg_catalog.now()
  where user_id=p_student_id;

  select * into app from public.badge_applications
    where student_id=p_student_id and status in ('pending','approved')
    order by submitted_at desc limit 1 for update;
  if found then
    update public.badge_applications set first_name=pg_catalog.btrim(p_first_name),
      last_name=pg_catalog.btrim(p_last_name), phone=pg_catalog.btrim(coalesce(p_phone,'')),
      sex=p_sex, program=p_program, level=p_level, birth_date=p_birth_date,
      origin_group=p_origin_group, country_of_origin=pg_catalog.btrim(p_country_of_origin)
    where id=app.id;
    if app.status='approved' and app.origin_group is distinct from p_origin_group then
      origin_key := p_origin_group;
      suffix := case when origin_key='anglophone' then 'A' else 'F' end;
      update public.matricule_origin_allocators set last_issued=last_issued+1
        where origin_group=origin_key and last_issued < 9999 returning last_issued into serial_no;
      if serial_no is null then raise exception 'La série de matricules % est épuisée (maximum IRGIB-9999%).', origin_key, suffix; end if;
      final_id := 'IRGIB-' || pg_catalog.lpad(serial_no::text,4,'0') || suffix;
      update public.badge_applications set final_matricule=final_id where id=app.id;
    end if;
  end if;
end;
$$;
revoke all on function public.admin_update_student_card_details(uuid,text,text,text,text,text,text,date,text,text) from public,anon;
grant execute on function public.admin_update_student_card_details(uuid,text,text,text,text,text,text,date,text,text) to authenticated;

-- Preserve a minimal append-only history for administrative profile and badge
-- decisions. RLS limits visibility to administrators of the affected campus.
create table if not exists public.admin_action_log (
  id bigint generated always as identity primary key,
  site text not null,
  actor_id uuid,
  subject_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);
alter table public.admin_action_log enable row level security;
revoke all on public.admin_action_log from public,anon,authenticated;
grant select on public.admin_action_log to authenticated;
drop policy if exists "site admins read action log" on public.admin_action_log;
create policy "site admins read action log" on public.admin_action_log for select to authenticated
  using ((select public.is_admin_for_site(site)));
revoke update,delete,truncate on public.admin_action_log from public,anon,authenticated;

create or replace function public.log_student_admin_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare fields text[] := array[]::text[]; event_name text;
begin
  if tg_op='UPDATE' then
    if new.account_status is distinct from old.account_status then fields:=pg_catalog.array_append(fields,'account_status'); end if;
    if new.banned_at is distinct from old.banned_at then fields:=pg_catalog.array_append(fields,'banned_at'); end if;
    if new.card_suspended_at is distinct from old.card_suspended_at then fields:=pg_catalog.array_append(fields,'card_suspended_at'); end if;
    if new.first_name is distinct from old.first_name then fields:=pg_catalog.array_append(fields,'first_name'); end if;
    if new.last_name is distinct from old.last_name then fields:=pg_catalog.array_append(fields,'last_name'); end if;
    if new.phone is distinct from old.phone then fields:=pg_catalog.array_append(fields,'phone'); end if;
    if new.sex is distinct from old.sex then fields:=pg_catalog.array_append(fields,'sex'); end if;
    if new.program is distinct from old.program then fields:=pg_catalog.array_append(fields,'program'); end if;
    if new.level is distinct from old.level then fields:=pg_catalog.array_append(fields,'level'); end if;
    if new.birth_date is distinct from old.birth_date then fields:=pg_catalog.array_append(fields,'birth_date'); end if;
    if new.origin_group is distinct from old.origin_group then fields:=pg_catalog.array_append(fields,'origin_group'); end if;
    if new.country_of_origin is distinct from old.country_of_origin then fields:=pg_catalog.array_append(fields,'country_of_origin'); end if;
    if pg_catalog.cardinality(fields)=0 then return new; end if;
    event_name := case when new.account_status is distinct from old.account_status then 'student_account_decision'
      when new.banned_at is distinct from old.banned_at then 'student_ban_change'
      when new.card_suspended_at is distinct from old.card_suspended_at then 'student_card_suspension_change'
      else 'student_profile_edit' end;
    insert into public.admin_action_log(site,actor_id,subject_id,action,details)
    values(new.site,(select auth.uid()),new.user_id,event_name,jsonb_build_object('fields',fields));
  end if;
  return new;
end;
$$;
revoke all on function public.log_student_admin_changes() from public,anon,authenticated;
drop trigger if exists log_student_admin_changes on public.student_profiles;
create trigger log_student_admin_changes after update on public.student_profiles
for each row execute function public.log_student_admin_changes();

create or replace function public.log_badge_admin_decisions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.admin_action_log(site,actor_id,subject_id,action,details)
    values(new.site,(select auth.uid()),new.student_id,'badge_application_decision',
      jsonb_build_object('application_id',new.id,'from',old.status,'to',new.status,'matricule',new.final_matricule));
  end if;
  return new;
end;
$$;
revoke all on function public.log_badge_admin_decisions() from public,anon,authenticated;
drop trigger if exists log_badge_admin_decisions on public.badge_applications;
create trigger log_badge_admin_decisions after update of status on public.badge_applications
for each row execute function public.log_badge_admin_decisions();

-- Keep the official seal/signature out of the public web directory. Upload the
-- existing PNG as official/director-stamp-signature.png after this migration.
insert into storage.buckets(id,name,public,allowed_mime_types)
values('irgib-official-assets','irgib-official-assets',false,array['image/png'])
on conflict(id) do update set public=false,allowed_mime_types=array['image/png'];
drop policy if exists "approved students and campus admins read official mark" on storage.objects;
create policy "approved students and campus admins read official mark" on storage.objects
for select to authenticated using (
  bucket_id='irgib-official-assets'
  and name='official/director-stamp-signature.png'
  and (
    exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid())
      and p.account_status='approved' and p.email_verified_at is not null and p.banned_at is null)
    or exists(select 1 from public.admin_site_members m where m.user_id=(select auth.uid()))
  )
);

commit;
