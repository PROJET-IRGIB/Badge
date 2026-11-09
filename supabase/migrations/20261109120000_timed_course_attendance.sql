-- Daily attendance becomes one independently locked session per scheduled class.
-- All times are interpreted in Benin time; the database is the enforcement point.
begin;

alter table public.attendance_sessions
  add column if not exists course_slot smallint not null default 1;
alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_course_slot_check;
alter table public.attendance_sessions
  add constraint attendance_sessions_course_slot_check check (course_slot between 1 and 2);
drop index if exists public.attendance_sessions_daily_group_day_idx;
drop index if exists public.one_daily_session_per_group;
create unique index if not exists attendance_sessions_daily_group_day_slot_idx
  on public.attendance_sessions(site,program,level,session_day,course_slot) where is_daily;
-- Close the legacy all-day session for today without deleting its attendance history.
update public.attendance_sessions
set is_daily=false, ends_at=least(ends_at,pg_catalog.now()), course_title='Séance antérieure au nouvel horaire'
where is_daily and session_day=(pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;

create table if not exists public.representative_course_schedules (
  site text not null,
  program text not null,
  level text not null,
  session_day date not null,
  course_slot smallint not null check (course_slot between 1 and 2),
  starts_at time without time zone not null check (starts_at >= time '09:00' and starts_at <= time '14:00'),
  configured_by uuid not null references auth.users(id),
  configured_at timestamptz not null default pg_catalog.now(),
  primary key(site,program,level,session_day,course_slot),
  check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE'))
);
alter table public.representative_course_schedules enable row level security;
revoke all on public.representative_course_schedules from public, anon, authenticated;

create or replace function public.ensure_daily_attendance_sessions(p_day date default (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date)
returns integer language plpgsql security definer set search_path = '' as $$
declare item record; s public.attendance_sessions%rowtype; token_value text; made integer := 0;
begin
  if p_day is null then raise exception 'Date invalide'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('irgib-daily-attendance-slots'),pg_catalog.hashtext(p_day::text));
  for item in select * from public.representative_course_schedules where session_day=p_day order by site,program,level,course_slot loop
    select * into s from public.attendance_sessions
    where site=item.site and program=item.program and level=item.level and session_day=p_day and is_daily and course_slot=item.course_slot;
    if not found then
      token_value := 'IRGIB-PRESENCE:' || encode(extensions.gen_random_bytes(24),'hex');
      insert into public.attendance_sessions(token_digest,site,program,level,session_day,course_title,is_daily,course_slot,starts_at,ends_at,created_by)
      values(encode(extensions.digest(token_value,'sha256'),'hex'),item.site,item.program,item.level,p_day,
        'Cours '||item.course_slot,true,item.course_slot,(p_day::timestamp at time zone 'Africa/Porto-Novo'),
        ((p_day + item.starts_at)::timestamp at time zone 'Africa/Porto-Novo'),item.configured_by)
      returning * into s;
      insert into public.attendance_session_secrets(session_id,token) values(s.id,token_value);
      made := made + 1;
    end if;
    insert into public.attendance_records(session_id,student_id,status,attended_at)
    select s.id,a.student_id,'absent',null
    from public.badge_applications a join public.student_profiles p on p.user_id=a.student_id
    where a.status='approved' and (a.site,a.program,a.level)=(item.site,item.program,item.level)
      and p.account_status='approved' and p.banned_at is null and p.card_suspended_at is null
    on conflict(session_id,student_id) do nothing;
  end loop;
  return made;
end;
$$;
revoke all on function public.ensure_daily_attendance_sessions(date) from public,anon,authenticated;

create or replace function public.representative_set_daily_course_schedule(p_day date,p_times time[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype; local_now timestamp without time zone := pg_catalog.now() at time zone 'Africa/Porto-Novo';
  item_time time; i integer; result jsonb;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives r where r.user_id=(select auth.uid()) for update;
  if not found then raise exception 'Cette action est réservée aux responsables de classe'; end if;
  if exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid()) and (p.account_status<>'approved' or p.banned_at is not null or p.card_suspended_at is not null)) then
    raise exception 'Votre compte ou votre carte ne permet pas cette action' using errcode='42501';
  end if;
  if p_day is null or p_day < local_now::date or p_day > local_now::date + 30 then raise exception 'Choisissez une date entre aujourd’hui et les 30 prochains jours'; end if;
  if p_times is null or cardinality(p_times)<1 or cardinality(p_times)>2 then raise exception 'Choisissez un ou deux horaires'; end if;
  if exists(select 1 from unnest(p_times) as v(start_time) where v.start_time is null or v.start_time < time '09:00' or v.start_time > time '14:00') then raise exception 'Les cours doivent commencer entre 09 h et 14 h'; end if;
  if cardinality(p_times)=2 and p_times[1]=p_times[2] then raise exception 'Les deux horaires doivent être différents'; end if;
  if cardinality(p_times)=2 and p_times[1]>p_times[2] then raise exception 'Le deuxième cours doit commencer après le premier'; end if;
  if p_day=local_now::date and exists(select 1 from unnest(p_times) as v(start_time) where v.start_time <= local_now::time) then raise exception 'L’horaire choisi est déjà passé'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(rep.site||rep.program||rep.level),pg_catalog.hashtext(p_day::text));
  if exists(select 1 from public.attendance_sessions s join public.attendance_records r on r.session_id=s.id
      where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,p_day,true) and r.status='present') then
    raise exception 'Un pointage existe déjà pour cette date; les horaires ne peuvent plus être modifiés';
  end if;
  if exists(select 1 from public.attendance_sessions s
      where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,p_day,true)
        and s.ends_at<=pg_catalog.now()) then
    raise exception 'Un cours a déjà commencé; les horaires de cette date ne peuvent plus être modifiés';
  end if;
  delete from public.attendance_records r using public.attendance_sessions s
    where r.session_id=s.id and (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,p_day,true);
  delete from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,p_day,true);
  delete from public.representative_course_schedules where (site,program,level,session_day)=(rep.site,rep.program,rep.level,p_day);
  for i in 1..cardinality(p_times) loop
    item_time := p_times[i];
    insert into public.representative_course_schedules(site,program,level,session_day,course_slot,starts_at,configured_by)
      values(rep.site,rep.program,rep.level,p_day,i,item_time,(select auth.uid()));
  end loop;
  perform public.ensure_daily_attendance_sessions(p_day);
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id',s.id,'course_slot',s.course_slot,'course_title',s.course_title,'starts_at',s.ends_at)
      order by s.course_slot) into result
    from public.attendance_sessions s where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,p_day,true);
  return coalesce(result,'[]'::jsonb);
end;
$$;
revoke all on function public.representative_set_daily_course_schedule(date,time[]) from public,anon;
grant execute on function public.representative_set_daily_course_schedule(date,time[]) to authenticated;

create or replace function public.submit_attendance(p_token text)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype; rec public.attendance_records%rowtype;
begin
  select * into strict p from public.student_profiles where user_id=(select auth.uid());
  perform public.require_student_account_approved();
  if p.banned_at is not null then raise exception 'Votre compte est banni' using errcode='42501'; end if;
  if p.card_suspended_at is not null then raise exception 'Votre carte est temporairement désactivée' using errcode='42501'; end if;
  if not exists(select 1 from public.badge_applications a where a.student_id=p.user_id and a.status='approved') then raise exception 'Votre demande doit être approuvée pour enregistrer une présence'; end if;
  select * into s from public.attendance_sessions where token_digest=encode(extensions.digest(p_token,'sha256'),'hex')
    and starts_at<=pg_catalog.now() and ends_at>pg_catalog.now();
  if not found then raise exception 'QR invalide ou pointage clôturé'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then raise exception 'Ce QR ne correspond pas à votre groupe'; end if;
  insert into public.attendance_records as old(session_id,student_id,status,attended_at)
    values(s.id,p.user_id,'present',pg_catalog.now())
    on conflict(session_id,student_id) do update set status='present',attended_at=pg_catalog.now() where old.status='absent'
    returning * into rec;
  if not found then raise exception 'Présence déjà enregistrée'; end if;
  return rec;
end; $$;
revoke all on function public.submit_attendance(text) from public,anon;
grant execute on function public.submit_attendance(text) to authenticated;

create or replace function public.student_attendance_session_info(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype;
begin
  select * into strict p from public.student_profiles where user_id=(select auth.uid());
  perform public.require_student_account_approved();
  if p.banned_at is not null or p.card_suspended_at is not null then raise exception 'Ce compte ou cette carte est désactivé' using errcode='42501'; end if;
  select * into s from public.attendance_sessions where token_digest=encode(extensions.digest(p_token,'sha256'),'hex') and starts_at<=pg_catalog.now() and ends_at>pg_catalog.now();
  if not found then raise exception 'QR invalide ou pointage clôturé'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then raise exception 'Ce QR ne correspond pas à votre groupe'; end if;
  if exists(select 1 from public.attendance_records r where r.session_id=s.id and r.student_id=p.user_id and r.status='present') then raise exception 'Votre présence à ce cours est déjà enregistrée'; end if;
  return pg_catalog.jsonb_build_object('session_id',s.id,'site',s.site,'program',s.program,'level',s.level,'course_title',s.course_title,'course_slot',s.course_slot,'session_day',s.session_day,'ends_at',s.ends_at);
end; $$;
revoke all on function public.student_attendance_session_info(text) from public,anon;
grant execute on function public.student_attendance_session_info(text) to authenticated;

create or replace function public.verify_representative_daily_qr(p_user_id uuid,p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.student_profiles%rowtype; rep public.class_representatives%rowtype; attempts integer; delay interval;
  day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date; sessions_json jsonb;
begin
  if (select auth.role())<>'service_role' then raise exception 'Accès serveur requis' using errcode='42501'; end if;
  select * into p from public.student_profiles where user_id=p_user_id for update;
  if not found or p.account_status<>'approved' or p.email_verified_at is null or p.banned_at is not null or p.card_suspended_at is not null then return jsonb_build_object('ok',false,'message','Ce compte ou cette carte est désactivé'); end if;
  select * into rep from public.class_representatives where user_id=p_user_id for update;
  if not found then return jsonb_build_object('ok',false,'message','Aucun rôle de responsable actif'); end if;
  if rep.daily_qr_pin_hash is null then return jsonb_build_object('ok',false,'message','Configurez d’abord votre code à 4 chiffres'); end if;
  if rep.daily_qr_pin_locked_until>pg_catalog.now() then return jsonb_build_object('ok',false,'message','Trop de tentatives. Réessayez plus tard.'); end if;
  if p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin,rep.daily_qr_pin_hash)<>rep.daily_qr_pin_hash then
    attempts:=coalesce(rep.daily_qr_pin_failures,0)+1;
    delay:=case when attempts>=20 then interval '30 days' when attempts>=15 then interval '24 hours' when attempts>=10 then interval '1 hour' when attempts>=5 then interval '15 minutes' else null end;
    update public.class_representatives set daily_qr_pin_failures=attempts,daily_qr_pin_locked_until=case when delay is null then null else pg_catalog.now()+delay end where user_id=p_user_id;
    return jsonb_build_object('ok',false,'message','Code incorrect');
  end if;
  update public.class_representatives set daily_qr_pin_failures=0,daily_qr_pin_locked_until=null where user_id=p_user_id;
  perform public.ensure_daily_attendance_sessions(day_value);
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id',s.id,'course_slot',s.course_slot,'course_title',s.course_title,
      'session_day',s.session_day,'starts_at',s.ends_at,'token',k.token) order by s.course_slot) into sessions_json
    from public.attendance_sessions s join public.attendance_session_secrets k on k.session_id=s.id
    where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,day_value,true) and s.ends_at>pg_catalog.now();
  return pg_catalog.jsonb_build_object('ok',true,'site',rep.site,'program',rep.program,'level',rep.level,'sessions',coalesce(sessions_json,'[]'::jsonb));
end; $$;
revoke all on function public.verify_representative_daily_qr(uuid,text) from public,anon,authenticated;
grant execute on function public.verify_representative_daily_qr(uuid,text) to service_role;

create or replace function public.representative_mark_own_attendance(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); p public.student_profiles%rowtype; rep public.class_representatives%rowtype;
  s public.attendance_sessions%rowtype; token_value text;
begin
  if actor_id is null then raise exception 'Authentification requise' using errcode='42501'; end if;
  perform public.require_student_account_approved();
  select * into p from public.student_profiles where user_id=actor_id for update;
  if not found or p.banned_at is not null or p.card_suspended_at is not null then raise exception 'Votre compte ou votre carte est désactivé' using errcode='42501'; end if;
  if not exists(select 1 from public.badge_applications a where a.student_id=actor_id and a.status='approved') then raise exception 'Votre carte doit être approuvée'; end if;
  select * into rep from public.class_representatives where user_id=actor_id;
  if not found then raise exception 'Action réservée aux responsables actifs' using errcode='42501'; end if;
  select * into s from public.attendance_sessions where id=p_session_id and is_daily and session_day=(pg_catalog.now() at time zone 'Africa/Porto-Novo')::date
    and (site,program,level)=(rep.site,rep.program,rep.level) and starts_at<=pg_catalog.now() and ends_at>pg_catalog.now();
  if not found then raise exception 'Le pointage de ce cours est fermé ou indisponible'; end if;
  select token into token_value from public.attendance_session_secrets where session_id=s.id;
  perform public.submit_attendance(token_value);
  return pg_catalog.jsonb_build_object('ok',true,'session_id',s.id,'course_title',s.course_title);
end; $$;
revoke all on function public.representative_mark_own_attendance(uuid) from public,anon;
grant execute on function public.representative_mark_own_attendance(uuid) to authenticated;

create or replace function public.list_representative_groupmates(p_session_id uuid)
returns table(student_id uuid,first_name text,last_name text,final_matricule text)
language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype; s public.attendance_sessions%rowtype;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives where user_id=(select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe' using errcode='42501'; end if;
  if exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid()) and (p.banned_at is not null or p.card_suspended_at is not null)) then raise exception 'Votre compte ou votre carte est désactivé' using errcode='42501'; end if;
  select * into s from public.attendance_sessions where id=p_session_id and is_daily and session_day=(pg_catalog.now() at time zone 'Africa/Porto-Novo')::date
    and (site,program,level)=(rep.site,rep.program,rep.level) and starts_at<=pg_catalog.now() and ends_at>pg_catalog.now();
  if not found then raise exception 'Le pointage de ce cours est fermé ou indisponible'; end if;
  return query select a.student_id,a.first_name,a.last_name,a.final_matricule from public.badge_applications a
    join public.student_profiles p on p.user_id=a.student_id and p.banned_at is null and p.card_suspended_at is null
    join public.attendance_records r on r.session_id=s.id and r.student_id=a.student_id
    where a.status='approved' and (a.site,a.program,a.level)=(rep.site,rep.program,rep.level) and a.student_id<>(select auth.uid())
      and a.final_matricule is not null and r.status='absent' order by a.last_name,a.first_name;
end; $$;
revoke all on function public.list_representative_groupmates(uuid) from public,anon;
grant execute on function public.list_representative_groupmates(uuid) to authenticated;

create or replace function public.verify_classmate_badge(p_student_id uuid,p_scanned_qr text,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype; target public.student_profiles%rowtype; app public.badge_applications%rowtype; s public.attendance_sessions%rowtype;
begin
  perform public.require_student_account_approved();
  select * into rep from public.class_representatives where user_id=(select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe' using errcode='42501'; end if;
  if exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid()) and (p.banned_at is not null or p.card_suspended_at is not null)) then raise exception 'Votre compte ou votre carte est désactivé' using errcode='42501'; end if;
  if p_student_id=(select auth.uid()) then raise exception 'Utilisez le bouton de présence personnelle'; end if;
  select * into s from public.attendance_sessions where id=p_session_id and is_daily and (site,program,level)=(rep.site,rep.program,rep.level)
    and session_day=(pg_catalog.now() at time zone 'Africa/Porto-Novo')::date and starts_at<=pg_catalog.now() and ends_at>pg_catalog.now();
  if not found then raise exception 'Le pointage de ce cours est fermé'; end if;
  select * into target from public.student_profiles where user_id=p_student_id;
  if not found or target.account_status<>'approved' or target.banned_at is not null or target.card_suspended_at is not null then raise exception 'Cette carte est désactivée'; end if;
  select * into app from public.badge_applications where student_id=p_student_id and status='approved' and (site,program,level)=(rep.site,rep.program,rep.level);
  if not found or app.final_matricule is null or p_scanned_qr is distinct from ('IRGIB-CARTE:'||app.final_matricule) then raise exception 'Le QR ne correspond pas à l’étudiant sélectionné'; end if;
  if not exists(select 1 from public.attendance_records where session_id=s.id and student_id=p_student_id and status='absent') then raise exception 'Aucune absence à corriger pour ce cours'; end if;
  return pg_catalog.jsonb_build_object('ok',true);
end; $$;
revoke all on function public.verify_classmate_badge(uuid,text,uuid) from public,anon;
grant execute on function public.verify_classmate_badge(uuid,text,uuid) to authenticated;

create or replace function public.mark_classmate_attendance(p_student_id uuid,p_scanned_qr text,p_session_id uuid)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype; target public.student_profiles%rowtype; app public.badge_applications%rowtype;
  s public.attendance_sessions%rowtype; rec public.attendance_records%rowtype;
begin
  perform public.verify_classmate_badge(p_student_id,p_scanned_qr,p_session_id);
  select * into rep from public.class_representatives where user_id=(select auth.uid());
  select * into s from public.attendance_sessions where id=p_session_id;
  insert into public.attendance_records as old(session_id,student_id,status,attended_at,marked_by)
    values(s.id,p_student_id,'present',pg_catalog.now(),(select auth.uid()))
    on conflict(session_id,student_id) do update set status='present',attended_at=pg_catalog.now(),marked_by=(select auth.uid())
    where old.status='absent' returning * into rec;
  if not found then raise exception 'La présence de cet étudiant est déjà enregistrée'; end if;
  return rec;
end; $$;
revoke all on function public.mark_classmate_attendance(uuid,text,uuid) from public,anon;
grant execute on function public.mark_classmate_attendance(uuid,text,uuid) to authenticated;

create or replace function public.admin_set_attendance_status(p_session_id uuid,p_student_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.attendance_sessions%rowtype;
begin
  if p_status not in ('present','absent') then raise exception 'Statut invalide'; end if;
  select * into s from public.attendance_sessions where id=p_session_id for update;
  if not found then raise exception 'Séance introuvable'; end if;
  if not (select public.is_admin()) and not (select public.is_admin_for_site(s.site)) then raise exception 'Accès administrateur refusé' using errcode='42501'; end if;
  if s.ends_at>pg_catalog.now() then raise exception 'La présence ne peut être corrigée qu’après l’heure de début du cours' using errcode='42501'; end if;
  if not exists(select 1 from public.student_profiles p where p.user_id=p_student_id and (p.site,p.program,p.level)=(s.site,s.program,s.level)) then raise exception 'Étudiant hors du groupe'; end if;
  update public.attendance_records set status=p_status,attended_at=case when p_status='present' then coalesce(attended_at,pg_catalog.now()) else null end,
    marked_by=(select auth.uid()) where session_id=s.id and student_id=p_student_id;
  if not found then raise exception 'Ligne de présence introuvable'; end if;
end; $$;
revoke all on function public.admin_set_attendance_status(uuid,uuid,text) from public,anon;
grant execute on function public.admin_set_attendance_status(uuid,uuid,text) to authenticated;

-- Retire legacy APIs that implicitly selected a single all-day group session.
drop function if exists public.representative_mark_own_attendance();
drop function if exists public.list_representative_groupmates();
drop function if exists public.verify_classmate_badge(uuid,text);
drop function if exists public.mark_classmate_attendance(uuid,text);
drop function if exists public.mark_classmate_attendance(uuid);

-- If badge approval happens after schedules were created, add the new student
-- to every already-generated course roster for that group and date.
create or replace function public.sync_approved_student_to_course_rosters()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'approved' or (tg_op='UPDATE' and old.status='approved') then
    return new;
  end if;
  if new.final_matricule is null then return new; end if;
  if not exists(select 1 from public.student_profiles p where p.user_id=new.student_id
      and p.account_status='approved' and p.banned_at is null and p.card_suspended_at is null) then
    return new;
  end if;
  insert into public.attendance_records(session_id,student_id,status,attended_at)
  select s.id,new.student_id,'absent',null
  from public.attendance_sessions s
  where s.is_daily and (s.site,s.program,s.level)=(new.site,new.program,new.level)
    and s.session_day >= (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date
  on conflict(session_id,student_id) do nothing;
  return new;
end;
$$;
revoke all on function public.sync_approved_student_to_course_rosters() from public,anon,authenticated;
drop trigger if exists sync_approved_student_course_rosters on public.badge_applications;
create trigger sync_approved_student_course_rosters
after insert or update of status on public.badge_applications
for each row execute function public.sync_approved_student_to_course_rosters();

commit;
