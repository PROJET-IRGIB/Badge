-- Enforce account bans at the database boundary as well as in the student UI.
-- Apply after 20261025100000_student_admin_controls.sql.
begin;

create or replace function public.submit_attendance(p_token text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype; rec public.attendance_records%rowtype;
begin
  select * into strict p from public.student_profiles where user_id = (select auth.uid());
  if p.banned_at is not null then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.badge_applications a
    where a.student_id = p.user_id and a.status = 'approved'
  ) then
    raise exception 'votre demande doit être approuvée pour enregistrer une présence';
  end if;
  select * into s from public.attendance_sessions
    where token_digest = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and starts_at <= now() and ends_at >= now();
  if not found then raise exception 'QR invalide ou séance terminée'; end if;
  if (p.site, p.program, p.level) is distinct from (s.site, s.program, s.level) then
    raise exception 'ce QR ne correspond pas à votre groupe';
  end if;

  insert into public.attendance_records as existing_record(session_id, student_id, status, attended_at)
    values (s.id, p.user_id, 'present', now())
    on conflict (session_id, student_id) do update
      set status = 'present', attended_at = now()
      where existing_record.status = 'absent'
    returning * into rec;
  if not found then raise exception 'présence déjà enregistrée'; end if;
  return rec;
end;
$$;
revoke all on function public.submit_attendance(text) from public, anon;
grant execute on function public.submit_attendance(text) to authenticated;

create or replace function public.list_representative_groupmates()
returns table(student_id uuid, first_name text, last_name text, final_matricule text)
language plpgsql security definer set search_path = ''
as $$
declare
  rep public.class_representatives%rowtype;
  day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  select * into rep
  from public.class_representatives cr
  where cr.user_id = (select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (
    select 1 from public.student_profiles p
    where p.user_id = (select auth.uid()) and p.banned_at is not null
  ) then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;

  perform public.ensure_daily_attendance_sessions(day_value);
  return query
    select a.student_id, a.first_name, a.last_name, a.final_matricule
    from public.badge_applications a
    join public.student_profiles p on p.user_id = a.student_id and p.banned_at is null
    join public.attendance_sessions s
      on (s.site, s.program, s.level, s.session_day, s.is_daily) = (rep.site, rep.program, rep.level, day_value, true)
    join public.attendance_records r on r.session_id = s.id and r.student_id = a.student_id
    where a.status = 'approved'
      and (a.site, a.program, a.level) = (rep.site, rep.program, rep.level)
      and a.student_id <> (select auth.uid())
      and a.final_matricule is not null
      and r.status = 'absent'
      and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now()
    order by a.last_name, a.first_name;
end;
$$;
revoke all on function public.list_representative_groupmates() from public, anon;
grant execute on function public.list_representative_groupmates() to authenticated;

create or replace function public.mark_classmate_attendance(p_student_id uuid, p_scanned_qr text)
returns public.attendance_records
language plpgsql security definer set search_path = ''
as $$
declare
  rep public.class_representatives%rowtype;
  student_row public.badge_applications%rowtype;
  session_row public.attendance_sessions%rowtype;
  rec public.attendance_records%rowtype;
  day_value date := (pg_catalog.now() at time zone 'Africa/Porto-Novo')::date;
begin
  select * into rep
  from public.class_representatives cr
  where cr.user_id = (select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (
    select 1 from public.student_profiles p
    where p.user_id = (select auth.uid()) and p.banned_at is not null
  ) then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;
  if p_student_id = (select auth.uid()) then raise exception 'Utilisez votre propre espace pour marquer votre présence'; end if;

  select * into student_row
  from public.badge_applications a
  where a.student_id = p_student_id and a.status = 'approved'
    and (a.site, a.program, a.level) = (rep.site, rep.program, rep.level);
  if not found then raise exception 'Cet étudiant n’appartient pas à votre groupe'; end if;
  if exists (
    select 1 from public.student_profiles p
    where p.user_id = p_student_id and p.banned_at is not null
  ) then
    raise exception 'Cet étudiant est banni' using errcode = '42501';
  end if;
  if student_row.final_matricule is null
     or p_scanned_qr is distinct from ('IRGIB-CARTE:' || student_row.final_matricule) then
    raise exception 'Le QR scanné ne correspond pas à l’étudiant sélectionné';
  end if;

  perform public.ensure_daily_attendance_sessions(day_value);
  select * into session_row
  from public.attendance_sessions s
  where (s.site, s.program, s.level, s.session_day, s.is_daily) = (rep.site, rep.program, rep.level, day_value, true)
    and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now();
  if not found then raise exception 'La présence du jour n’est pas ouverte'; end if;

  update public.attendance_records r
  set status = 'present', attended_at = pg_catalog.now(), marked_by = (select auth.uid())
  where r.session_id = session_row.id and r.student_id = p_student_id and r.status = 'absent'
  returning r.* into rec;
  if not found then
    if exists (select 1 from public.attendance_records r where r.session_id = session_row.id and r.student_id = p_student_id and r.status = 'present') then
      raise exception 'La présence de cet étudiant est déjà enregistrée';
    end if;
    raise exception 'Aucune absence en attente pour cet étudiant aujourd’hui';
  end if;
  return rec;
end;
$$;
revoke all on function public.mark_classmate_attendance(uuid, text) from public, anon;
grant execute on function public.mark_classmate_attendance(uuid, text) to authenticated;

drop policy if exists "read own attendance or scoped admin" on public.attendance_records;
create policy "read own attendance or scoped admin" on public.attendance_records
  for select to authenticated using (
    (student_id = (select auth.uid()) and not exists (
      select 1 from public.student_profiles p
      where p.user_id = (select auth.uid()) and p.banned_at is not null
    ))
    or exists (
      select 1 from public.attendance_sessions s where s.id = session_id
        and (select public.is_admin_for_site(s.site))
    )
  );

drop policy if exists "submit own pending application" on public.badge_applications;
create policy "submit own pending application" on public.badge_applications
  for insert to authenticated with check (
    student_id = (select auth.uid()) and status = 'pending' and final_matricule is null
    and decided_at is null and decided_by is null and rejection_reason is null
    and exists (
      select 1 from public.student_profiles p
      where p.user_id = (select auth.uid()) and p.banned_at is null
    )
  );

drop policy if exists "student uploads own photo" on storage.objects;
create policy "student uploads own photo" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.student_profiles p
      where p.user_id = (select auth.uid()) and p.banned_at is null
    )
  );

drop policy if exists "students manage own push subscriptions" on public.push_subscriptions;
create policy "students manage own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.student_profiles p
      where p.user_id = (select auth.uid()) and p.site = push_subscriptions.site and p.banned_at is null
    )
  );

commit;
