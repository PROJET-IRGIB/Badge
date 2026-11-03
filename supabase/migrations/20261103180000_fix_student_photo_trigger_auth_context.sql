-- Storage's BEFORE trigger can run without a populated auth.uid() context even
-- when the request has already passed the authenticated INSERT RLS policy.
-- Keep ownership enforcement in the Storage policy and validate the UUID folder
-- against the student's approved profile here.
begin;

create or replace function public.validate_student_photo_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo_student_id uuid;
begin
  if new.bucket_id <> 'student-photos' then
    return new;
  end if;

  if new.name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+[.](jpg|png|webp)$' then
    raise exception 'Chemin de photo invalide' using errcode = '42501';
  end if;

  photo_student_id := (storage.foldername(new.name))[1]::uuid;

  if not exists (
    select 1
    from public.student_profiles p
    where p.user_id = photo_student_id
      and p.account_status = 'approved'
      and p.email_verified_at is not null
      and p.banned_at is null
      and p.card_suspended_at is null
  ) then
    raise exception 'Compte étudiant non autorisé à envoyer une photo' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.badge_applications a
    where a.student_id = photo_student_id
      and a.status in ('pending', 'approved')
  ) then
    raise exception 'Une demande active existe déjà';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_student_photo_upload() from public, anon, authenticated;

commit;
