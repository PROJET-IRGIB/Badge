-- Store the versions accepted at account creation and require both agreements
-- server-side so that a direct Auth request cannot bypass the signup form.
begin;

alter table public.student_profiles
  add column if not exists privacy_policy_version text,
  add column if not exists terms_of_use_version text,
  add column if not exists legal_consent_accepted_at timestamptz;

create or replace function public.create_student_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origin_value text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'origin_group','')));
  country_value text := pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'country_of_origin',''));
  privacy_version text := coalesce(new.raw_user_meta_data->>'privacy_policy_version','');
  terms_version text := coalesce(new.raw_user_meta_data->>'terms_of_use_version','');
begin
  if coalesce(new.raw_user_meta_data->>'account_type','') <> 'student' then return new; end if;

  if privacy_version <> '2026-11-07-v1' or terms_version <> '2026-11-07-v1' then
    raise exception 'Veuillez accepter la politique de confidentialité et les conditions d’utilisation';
  end if;
  if origin_value not in ('francophone','anglophone') then
    raise exception 'Choisissez votre origine : francophone ou anglophone';
  end if;
  if pg_catalog.length(country_value) not between 2 and 80 then
    raise exception 'Indiquez votre pays d’origine';
  end if;

  insert into public.student_profiles
    (user_id,first_name,last_name,email,phone,sex,program,level,site,origin_group,country_of_origin,
     privacy_policy_version,terms_of_use_version,legal_consent_accepted_at)
  values
    (new.id,pg_catalog.btrim(new.raw_user_meta_data->>'first_name'),
     pg_catalog.btrim(new.raw_user_meta_data->>'last_name'),pg_catalog.lower(new.email),
     pg_catalog.btrim(new.raw_user_meta_data->>'phone'),new.raw_user_meta_data->>'sex',
     new.raw_user_meta_data->>'program',new.raw_user_meta_data->>'level',new.raw_user_meta_data->>'site',
     origin_value,country_value,privacy_version,terms_version,pg_catalog.now());
  return new;
end;
$$;

revoke all on function public.create_student_profile() from public, anon, authenticated;

commit;
