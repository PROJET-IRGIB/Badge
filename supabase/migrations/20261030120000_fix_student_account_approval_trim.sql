-- Fix the schema-qualified trim call in the student account approval RPC.
-- PostgreSQL exposes this function as pg_catalog.btrim, not pg_catalog.trim.
create or replace function public.admin_decide_student_account(
  p_student_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  student public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  select * into student
  from public.student_profiles
  where user_id = p_student_id
  for update;

  if not found then
    raise exception 'Compte étudiant introuvable';
  end if;

  if not (select public.is_admin_for_site(student.site)) then
    raise exception 'Vous ne pouvez gérer que les comptes de votre site' using errcode = '42501';
  end if;

  if student.email_verified_at is null then
    raise exception 'L’adresse e-mail doit être confirmée avant l’examen du compte';
  end if;

  update public.student_profiles
  set account_status = case when p_approve then 'approved' else 'rejected' end,
      account_reviewed_at = pg_catalog.now(),
      account_reviewed_by = (select auth.uid()),
      account_rejection_reason = case
        when p_approve then null
        else nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 500), '')
      end,
      updated_at = pg_catalog.now()
  where user_id = p_student_id;

  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

revoke all on function public.admin_decide_student_account(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_student_account(uuid, boolean, text) to authenticated;
