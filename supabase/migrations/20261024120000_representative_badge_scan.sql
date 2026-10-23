-- Require a selected absent classmate's badge QR before a representative can mark attendance.

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

  perform public.ensure_daily_attendance_sessions(day_value);
  return query
    select a.student_id, a.first_name, a.last_name, a.final_matricule
    from public.badge_applications a
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

drop function if exists public.mark_classmate_attendance(uuid);

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
  if p_student_id = (select auth.uid()) then raise exception 'Utilisez votre propre espace pour marquer votre présence'; end if;

  select * into student_row
  from public.badge_applications a
  where a.student_id = p_student_id and a.status = 'approved'
    and (a.site, a.program, a.level) = (rep.site, rep.program, rep.level);
  if not found then raise exception 'Cet étudiant n’appartient pas à votre groupe'; end if;
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
