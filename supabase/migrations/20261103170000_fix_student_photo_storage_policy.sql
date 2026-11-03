-- Restore the authenticated student's narrowly scoped upload policy.
-- The SECURITY DEFINER trigger validate_student_photo_upload() separately
-- enforces email verification, card/account status, and active applications.
begin;

drop policy if exists "student uploads own photo" on storage.objects;
create policy "student uploads own photo"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+[.](jpg|png|webp)$'
  and (select public.student_account_is_approved())
);

commit;
