-- Keep banned class representatives from configuring or retrieving attendance QR codes.
-- Apply after 20261025120000_revoke_trigger_function_client_execute.sql.
begin;

create or replace function public.representative_daily_qr_pin_status()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.student_profiles p
    where p.user_id = (select auth.uid()) and p.banned_at is not null
  ) then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.class_representatives cr
    where cr.user_id = (select auth.uid()) and cr.daily_qr_pin_hash is not null
  );
end;
$$;
revoke all on function public.representative_daily_qr_pin_status() from public, anon;
grant execute on function public.representative_daily_qr_pin_status() to authenticated;

create or replace function public.set_representative_daily_qr_pin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare rep public.class_representatives%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  select * into rep from public.class_representatives where user_id = (select auth.uid()) for update;
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (
    select 1 from public.student_profiles p
    where p.user_id = (select auth.uid()) and p.banned_at is not null
  ) then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'Le code doit contenir exactement 4 chiffres'; end if;
  if rep.daily_qr_pin_hash is not null then raise exception 'Le code est déjà configuré'; end if;
  update public.class_representatives set daily_qr_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
    daily_qr_pin_failures = 0, daily_qr_pin_locked_until = null where user_id = (select auth.uid());
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
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  select * into rep from public.class_representatives where user_id = (select auth.uid()) for update;
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if exists (
    select 1 from public.student_profiles p
    where p.user_id = (select auth.uid()) and p.banned_at is not null
  ) then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;
  if rep.daily_qr_pin_hash is null then raise exception 'Configurez d’abord votre code à 4 chiffres'; end if;
  if rep.daily_qr_pin_locked_until is not null and rep.daily_qr_pin_locked_until > pg_catalog.now() then
    raise exception 'Trop de tentatives. Réessayez après %', to_char(rep.daily_qr_pin_locked_until at time zone 'Africa/Porto-Novo', 'HH24:MI');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin, rep.daily_qr_pin_hash) <> rep.daily_qr_pin_hash then
    update public.class_representatives
      set daily_qr_pin_failures = case when daily_qr_pin_failures + 1 >= 5 then 0 else daily_qr_pin_failures + 1 end,
          daily_qr_pin_locked_until = case when daily_qr_pin_failures + 1 >= 5 then pg_catalog.now() + interval '15 minutes' else null end
      where user_id = (select auth.uid());
    return jsonb_build_object('ok', false, 'message', case when rep.daily_qr_pin_failures + 1 >= 5
      then 'Trop de tentatives. Réessayez dans 15 minutes.' else 'Code incorrect' end);
  end if;
  update public.class_representatives set daily_qr_pin_failures = 0, daily_qr_pin_locked_until = null
    where user_id = (select auth.uid());
  perform public.ensure_daily_attendance_sessions(day_value);
  select s.* into session_row from public.attendance_sessions s
    where (s.site, s.program, s.level, s.session_day, s.is_daily) = (rep.site, rep.program, rep.level, day_value, true)
      and s.starts_at <= pg_catalog.now() and s.ends_at >= pg_catalog.now();
  if not found then raise exception 'Le QR de présence du jour n’est pas disponible'; end if;
  select k.token into token_value from public.attendance_session_secrets k where k.session_id = session_row.id;
  if token_value is null then raise exception 'Le QR de présence du jour est indisponible'; end if;
  return jsonb_build_object('ok', true, 'token', token_value, 'site', rep.site, 'program', rep.program, 'level', rep.level,
    'course_title', session_row.course_title, 'session_day', session_row.session_day, 'ends_at', session_row.ends_at);
end;
$$;
revoke all on function public.representative_daily_attendance_qr(text) from public, anon;
grant execute on function public.representative_daily_attendance_qr(text) to authenticated;

commit;
