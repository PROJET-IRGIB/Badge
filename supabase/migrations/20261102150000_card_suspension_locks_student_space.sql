begin;

-- A temporarily suspended card closes student access to announcements,
-- attendance, badge applications, private campus media, and student RPCs.
-- Existing restrictive RLS policies call this helper; campus admins retain
-- their explicit admin access through the policy's admin branch.
create or replace function public.student_account_is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_profiles p
    where p.user_id = (select auth.uid())
      and p.account_status = 'approved'
      and p.email_verified_at is not null
      and p.banned_at is null
      and p.card_suspended_at is null
  );
$$;

revoke all on function public.student_account_is_approved() from public, anon;
grant execute on function public.student_account_is_approved() to authenticated;

create or replace function public.require_student_account_approved()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.student_profiles p
    where p.user_id = (select auth.uid())
      and p.card_suspended_at is not null
      and p.banned_at is null
  ) then
    raise exception 'Votre carte est temporairement désactivée. L’accès à votre espace étudiant est suspendu. Contactez l’administration de votre site.'
      using errcode = '42501';
  end if;

  if not (select public.student_account_is_approved()) then
    raise exception 'Votre compte étudiant n’est pas autorisé à accéder à cette fonction.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.require_student_account_approved() from public, anon;
grant execute on function public.require_student_account_approved() to authenticated;

commit;
