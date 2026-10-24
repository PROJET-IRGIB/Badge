-- Repair daily attendance updates, add temporary card suspension, and make
-- site contact details centrally editable by the administration of that site.
begin;

alter table public.student_profiles
  add column if not exists card_suspended_at timestamptz;

create table if not exists public.campus_site_contacts (
  site text primary key check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  contact_name text not null default 'Administration IRGIB',
  address text not null default '',
  phone text not null default '',
  updated_at timestamptz not null default pg_catalog.now()
);
alter table public.campus_site_contacts enable row level security;
revoke all on public.campus_site_contacts from public, anon, authenticated;
grant select on public.campus_site_contacts to anon, authenticated;
grant update (contact_name,address,phone,updated_at) on public.campus_site_contacts to authenticated;
drop policy if exists "public read site contacts" on public.campus_site_contacts;
create policy "public read site contacts" on public.campus_site_contacts
  for select to anon, authenticated using (true);
drop policy if exists "site admins update their contacts" on public.campus_site_contacts;
create policy "site admins update their contacts" on public.campus_site_contacts
  for update to authenticated
  using ((select public.is_admin_for_site(site)))
  with check ((select public.is_admin_for_site(site)));
insert into public.campus_site_contacts(site,contact_name,address,phone) values
  ('COT-AKPAKPA','Akpakpa','Campus Universitaire, Cotonou','+229 01 96 17 19 10'),
  ('CAL-CENTRE','Calavi','Centre d’application, Calavi','+229 01 96 17 19 10'),
  ('PNV-CENTRE','Porto-Novo','Centre d’application, Porto-Novo','+229 01 66 66 65 27'),
  ('PRK-CENTRE','Parakou','Centre d’application, Parakou','+229 01 97 80 06 71'),
  ('DJG-CENTRE','Djougou','Centre d’application, Djougou','+229 55 55 08 08')
on conflict (site) do nothing;

create or replace function public.ensure_daily_attendance_sessions(p_day date default (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare g record; s public.attendance_sessions%rowtype; token text; made integer := 0;
begin
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
      values (encode(extensions.digest(token,'sha256'),'hex'),g.site,g.program,g.level,p_day,'Séance du jour',true,
        (p_day::timestamp at time zone 'Africa/Porto-Novo'),((p_day + 1)::timestamp at time zone 'Africa/Porto-Novo') - interval '1 second',
        (select user_id from public.admin_members order by created_at limit 1)) returning * into s;
      insert into public.attendance_session_secrets(session_id,token) values(s.id,token);
      made := made + 1;
    end if;
    insert into public.attendance_records(session_id,student_id,status,attended_at)
      select s.id,a.student_id,'absent',null
      from public.badge_applications a
      join public.student_profiles p on p.user_id=a.student_id
      where a.status='approved' and a.site=g.site and a.program=g.program and a.level=g.level
        and p.banned_at is null and p.card_suspended_at is null
      on conflict(session_id,student_id) do nothing;
  end loop;
  return made;
end;
$$;
revoke all on function public.ensure_daily_attendance_sessions(date) from public, anon, authenticated;

create or replace function public.submit_attendance(p_token text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype; rec public.attendance_records%rowtype;
begin
  select * into strict p from public.student_profiles where user_id=(select auth.uid());
  if p.banned_at is not null then raise exception 'Votre compte est banni' using errcode='42501'; end if;
  if p.card_suspended_at is not null then raise exception 'Votre carte est temporairement désactivée. Contactez l’administration de votre site.' using errcode='42501'; end if;
  if not exists(select 1 from public.badge_applications a where a.student_id=p.user_id and a.status='approved') then
    raise exception 'Votre demande doit être approuvée pour enregistrer une présence';
  end if;
  select * into s from public.attendance_sessions
    where token_digest=encode(extensions.digest(p_token,'sha256'),'hex') and starts_at<=pg_catalog.now() and ends_at>=pg_catalog.now();
  if not found then raise exception 'QR invalide ou séance terminée'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then raise exception 'Ce QR ne correspond pas à votre groupe'; end if;
  insert into public.attendance_records as existing_record(session_id,student_id,status,attended_at)
    values(s.id,p.user_id,'present',pg_catalog.now())
    on conflict(session_id,student_id) do update set status='present',attended_at=pg_catalog.now()
      where existing_record.status='absent'
    returning * into rec;
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
  select * into strict p from public.student_profiles where user_id=(select auth.uid());
  if p.banned_at is not null or p.card_suspended_at is not null then raise exception 'Ce compte ou cette carte est désactivé' using errcode='42501'; end if;
  if not exists(select 1 from public.badge_applications a where a.student_id=p.user_id and a.status='approved') then
    raise exception 'Votre demande doit être approuvée avant le pointage';
  end if;
  select * into s from public.attendance_sessions
    where token_digest=encode(extensions.digest(p_token,'sha256'),'hex') and starts_at<=pg_catalog.now() and ends_at>=pg_catalog.now();
  if not found then raise exception 'QR de séance invalide ou expiré'; end if;
  if (p.site,p.program,p.level) is distinct from (s.site,s.program,s.level) then raise exception 'Ce QR ne correspond pas à votre site, filière et niveau'; end if;
  if exists(select 1 from public.attendance_records r where r.session_id=s.id and r.student_id=p.user_id and r.status='present') then
    raise exception 'Votre présence à cette séance est déjà enregistrée';
  end if;
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
  select * into rep from public.class_representatives cr where cr.user_id=(select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid()) and (p.banned_at is not null or p.card_suspended_at is not null)) then
    raise exception 'Votre compte ne peut pas accéder au pointage' using errcode='42501';
  end if;
  perform public.ensure_daily_attendance_sessions(day_value);
  return query
    select a.student_id,a.first_name,a.last_name,a.final_matricule
    from public.badge_applications a
    join public.student_profiles p on p.user_id=a.student_id and p.banned_at is null and p.card_suspended_at is null
    join public.attendance_sessions s on (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,day_value,true)
    join public.attendance_records r on r.session_id=s.id and r.student_id=a.student_id
    where a.status='approved' and (a.site,a.program,a.level)=(rep.site,rep.program,rep.level)
      and a.student_id<>(select auth.uid()) and a.final_matricule is not null and r.status='absent'
      and s.starts_at<=pg_catalog.now() and s.ends_at>=pg_catalog.now()
    order by a.last_name,a.first_name;
end;
$$;
revoke all on function public.list_representative_groupmates() from public, anon;
grant execute on function public.list_representative_groupmates() to authenticated;

create or replace function public.verify_classmate_badge(p_student_id uuid,p_scanned_qr text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype; student_row public.badge_applications%rowtype;
  target public.student_profiles%rowtype; session_row public.attendance_sessions%rowtype;
  day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  select * into rep from public.class_representatives cr where cr.user_id=(select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid()) and (p.banned_at is not null or p.card_suspended_at is not null)) then
    raise exception 'Votre compte ne peut pas utiliser le pointage' using errcode='42501';
  end if;
  if p_student_id=(select auth.uid()) then raise exception 'Vous ne pouvez pas vous pointer avec le scan délégué'; end if;
  select * into target from public.student_profiles p where p.user_id=p_student_id;
  if not found or target.banned_at is not null or target.card_suspended_at is not null then raise exception 'Cette carte est désactivée'; end if;
  select * into student_row from public.badge_applications a
    where a.student_id=p_student_id and a.status='approved' and (a.site,a.program,a.level)=(rep.site,rep.program,rep.level);
  if not found then raise exception 'Cet étudiant n’appartient pas à votre groupe'; end if;
  if student_row.final_matricule is null or p_scanned_qr is distinct from ('IRGIB-CARTE:'||student_row.final_matricule) then
    raise exception 'Le QR ne correspond pas à l’étudiant sélectionné';
  end if;
  perform public.ensure_daily_attendance_sessions(day_value);
  select * into session_row from public.attendance_sessions s
    where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,day_value,true)
      and s.starts_at<=pg_catalog.now() and s.ends_at>=pg_catalog.now();
  if not found then raise exception 'La présence du jour n’est pas ouverte'; end if;
  if exists(select 1 from public.attendance_records r where r.session_id=session_row.id and r.student_id=p_student_id and r.status='present') then
    raise exception 'La présence de cet étudiant est déjà enregistrée';
  end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.verify_classmate_badge(uuid,text) from public, anon;
grant execute on function public.verify_classmate_badge(uuid,text) to authenticated;

create or replace function public.mark_classmate_attendance(p_student_id uuid,p_scanned_qr text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype; student_row public.badge_applications%rowtype;
  target public.student_profiles%rowtype; session_row public.attendance_sessions%rowtype; rec public.attendance_records%rowtype;
  day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  select * into rep from public.class_representatives cr where cr.user_id=(select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists(select 1 from public.student_profiles p where p.user_id=(select auth.uid()) and (p.banned_at is not null or p.card_suspended_at is not null)) then
    raise exception 'Votre compte ne peut pas utiliser le pointage' using errcode='42501';
  end if;
  if p_student_id=(select auth.uid()) then raise exception 'Utilisez votre propre espace pour marquer votre présence'; end if;
  select * into target from public.student_profiles p where p.user_id=p_student_id;
  if not found or target.banned_at is not null or target.card_suspended_at is not null then
    raise exception 'Le badge de cet étudiant est désactivé ou son compte ne peut pas être pointé' using errcode='42501';
  end if;
  select * into student_row from public.badge_applications a
    where a.student_id=p_student_id and a.status='approved' and (a.site,a.program,a.level)=(rep.site,rep.program,rep.level);
  if not found then raise exception 'Cet étudiant n’appartient pas à votre groupe'; end if;
  if student_row.final_matricule is null or p_scanned_qr is distinct from ('IRGIB-CARTE:'||student_row.final_matricule) then
    raise exception 'Le QR scanné ne correspond pas à l’étudiant sélectionné';
  end if;
  perform public.ensure_daily_attendance_sessions(day_value);
  select * into session_row from public.attendance_sessions s
    where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,day_value,true)
      and s.starts_at<=pg_catalog.now() and s.ends_at>=pg_catalog.now();
  if not found then raise exception 'La présence du jour n’est pas ouverte'; end if;
  insert into public.attendance_records as existing_record(session_id,student_id,status,attended_at,marked_by)
    values(session_row.id,p_student_id,'present',pg_catalog.now(),(select auth.uid()))
    on conflict(session_id,student_id) do update
      set status='present',attended_at=pg_catalog.now(),marked_by=(select auth.uid())
      where existing_record.status='absent'
    returning * into rec;
  if not found then raise exception 'La présence de cet étudiant est déjà enregistrée'; end if;
  return rec;
end;
$$;
revoke all on function public.mark_classmate_attendance(uuid,text) from public, anon;
grant execute on function public.mark_classmate_attendance(uuid,text) to authenticated;

create or replace function public.admin_assign_class_representative(p_student_id uuid,p_site text,p_program text,p_level text)
returns void language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise'; end if;
  select * into p from public.student_profiles where user_id=p_student_id for update;
  if not found then raise exception 'Étudiant introuvable'; end if;
  if (p.site,p.program,p.level) is distinct from (p_site,p_program,p_level) then raise exception 'Les informations du groupe ne correspondent pas au profil étudiant'; end if;
  if p.banned_at is not null or p.card_suspended_at is not null then raise exception 'Un compte ou badge désactivé ne peut pas être responsable'; end if;
  if not public.is_admin_for_site(p.site) then raise exception 'Accès administrateur refusé pour ce site'; end if;
  if exists(select 1 from public.class_representatives cr where cr.user_id=p_student_id and not public.is_admin_for_site(cr.site)) then
    raise exception 'Vous ne pouvez pas modifier son affectation sur un autre site';
  end if;
  delete from public.class_representatives where user_id=p_student_id;
  insert into public.class_representatives(site,program,level,user_id,assigned_by,assigned_at)
    values(p.site,p.program,p.level,p_student_id,(select auth.uid()),pg_catalog.now())
    on conflict(site,program,level) do update set user_id=excluded.user_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
end;
$$;
revoke all on function public.admin_assign_class_representative(uuid,text,text,text) from public, anon;
grant execute on function public.admin_assign_class_representative(uuid,text,text,text) to authenticated;

create or replace function public.admin_set_student_card_suspension(p_student_id uuid,p_suspended boolean)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype;
begin
  select * into p from public.student_profiles where user_id=p_student_id for update;
  if not found then raise exception 'Étudiant introuvable'; end if;
  if not (select public.is_admin_for_site(p.site)) then raise exception 'Accès administrateur refusé pour ce site' using errcode='42501'; end if;
  if p.banned_at is not null then raise exception 'Un compte banni ne peut pas recevoir une carte active' using errcode='42501'; end if;
  if p_suspended then
    update public.student_profiles set card_suspended_at=coalesce(card_suspended_at,pg_catalog.now()) where user_id=p_student_id returning card_suspended_at into p.card_suspended_at;
    delete from public.class_representatives where user_id=p_student_id;
  else
    update public.student_profiles set card_suspended_at=null where user_id=p_student_id returning card_suspended_at into p.card_suspended_at;
  end if;
  return p.card_suspended_at;
end;
$$;
revoke all on function public.admin_set_student_card_suspension(uuid,boolean) from public, anon;
grant execute on function public.admin_set_student_card_suspension(uuid,boolean) to authenticated;

create or replace function public.admin_reset_representative_daily_qr_pin(p_site text,p_program text,p_level text)
returns void language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype;
begin
  select * into rep from public.class_representatives cr
    where cr.site=p_site and cr.program=p_program and cr.level=p_level for update;
  if not found then raise exception 'Aucun responsable n’est affecté à ce groupe'; end if;
  if not (select public.is_admin_for_site(rep.site)) then raise exception 'Vous n’êtes pas autorisé à réinitialiser le code de ce groupe' using errcode='42501'; end if;
  update public.class_representatives set daily_qr_pin_hash=null,daily_qr_pin_failures=0,daily_qr_pin_locked_until=null
    where user_id=rep.user_id;
end;
$$;
revoke all on function public.admin_reset_representative_daily_qr_pin(text,text,text) from public, anon;
grant execute on function public.admin_reset_representative_daily_qr_pin(text,text,text) to authenticated;

create or replace function public.admin_set_campus_announcement_status(p_announcement_id uuid,p_status text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare item public.campus_announcements%rowtype; publisher_site text;
begin
  if p_status not in ('draft','published') then raise exception 'Statut d’actualité invalide'; end if;
  select * into item from public.campus_announcements a where a.id=p_announcement_id for update;
  if not found then raise exception 'Actualité introuvable'; end if;
  publisher_site := coalesce(item.published_by_site,item.site);
  if not (select public.is_admin()) and (publisher_site is null or not (select public.is_admin_for_site(publisher_site))) then
    raise exception 'Vous n’êtes pas autorisé à modifier cette actualité' using errcode='42501';
  end if;
  update public.campus_announcements set status=p_status,
    published_at=case when p_status='published' then coalesce(published_at,pg_catalog.now()) else published_at end
    where id=p_announcement_id;
  return p_announcement_id;
end;
$$;
revoke all on function public.admin_set_campus_announcement_status(uuid,text) from public, anon;
grant execute on function public.admin_set_campus_announcement_status(uuid,text) to authenticated;

commit;
