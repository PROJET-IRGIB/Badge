-- Repair the profile update RPC for projects that already applied the original
-- account approval migration containing the invalid pg_catalog.trim calls.
create or replace function public.student_update_profile(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_sex text,
  p_program text,
  p_level text,
  p_site text,
  p_birth_date date,
  p_origin_group text,
  p_country_of_origin text
)
returns public.student_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.student_profiles%rowtype;
  origin_value text;
  country_value text;
begin
  perform public.require_student_account_approved();
  select * into p
  from public.student_profiles
  where user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'Profil étudiant introuvable';
  end if;

  if p.banned_at is not null then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.badge_applications
    where student_id = (select auth.uid())
      and status in ('pending', 'approved')
  ) then
    raise exception 'Le profil est verrouillé après l’envoi de la demande';
  end if;

  origin_value := pg_catalog.lower(pg_catalog.btrim(coalesce(p_origin_group, '')));
  country_value := pg_catalog.btrim(coalesce(p_country_of_origin, ''));
  if origin_value not in ('francophone', 'anglophone') then
    raise exception 'Choisissez votre origine francophone ou anglophone';
  end if;
  if pg_catalog.length(country_value) not between 2 and 80 then
    raise exception 'Indiquez votre pays d’origine';
  end if;

  update public.student_profiles
  set first_name = pg_catalog.btrim(p_first_name),
      last_name = pg_catalog.btrim(p_last_name),
      phone = pg_catalog.btrim(p_phone),
      sex = p_sex,
      program = p_program,
      level = p_level,
      site = p_site,
      birth_date = p_birth_date,
      origin_group = origin_value,
      country_of_origin = country_value,
      updated_at = pg_catalog.now()
  where user_id = (select auth.uid())
  returning * into p;

  return p;
end;
$$;

revoke all on function public.student_update_profile(text, text, text, text, text, text, text, date, text, text) from public, anon;
grant execute on function public.student_update_profile(text, text, text, text, text, text, text, date, text, text) to authenticated;
