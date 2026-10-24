-- A still-valid JWT must not let a banned student modify an editable profile.
begin;

create or replace function public.student_update_profile(
  p_first_name text, p_last_name text, p_phone text, p_sex text,
  p_program text, p_level text, p_site text, p_birth_date date
)
returns public.student_profiles language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into p from public.student_profiles where user_id = (select auth.uid()) for update;
  if not found then raise exception 'student profile not found'; end if;
  if p.banned_at is not null then
    raise exception 'Votre compte est banni' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.badge_applications
    where student_id = (select auth.uid()) and status in ('pending', 'approved')
  ) then
    raise exception 'profile is locked after application submission';
  end if;
  update public.student_profiles set first_name = trim(p_first_name), last_name = trim(p_last_name),
    phone = trim(p_phone), sex = p_sex, program = p_program, level = p_level, site = p_site,
    birth_date = p_birth_date, updated_at = now()
    where user_id = (select auth.uid()) returning * into p;
  return p;
end;
$$;
revoke all on function public.student_update_profile(text,text,text,text,text,text,text,date) from public, anon;
grant execute on function public.student_update_profile(text,text,text,text,text,text,text,date) to authenticated;

commit;
