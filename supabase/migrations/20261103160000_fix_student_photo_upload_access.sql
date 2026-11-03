-- Keep photo uploads bound to the signed-in student's own UUID folder.
-- The storage INSERT policy already enforces this ownership boundary, so the
-- trigger does not need a second check against Storage's owner metadata.
create or replace function public.validate_student_photo_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  if new.bucket_id <> 'student-photos' then return new; end if;

  actor := (select auth.uid());
  if actor is null
     or (storage.foldername(new.name))[1] is distinct from actor::text
     or new.name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+[.](jpg|png|webp)$' then
    raise exception 'Chemin de photo invalide' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.student_profiles p
    where p.user_id = actor
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
    where a.student_id = actor and a.status in ('pending', 'approved')
  ) then
    raise exception 'Une demande active existe déjà';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_student_photo_upload() from public, anon, authenticated;
