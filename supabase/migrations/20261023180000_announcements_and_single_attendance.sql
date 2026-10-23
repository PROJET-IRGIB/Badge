-- Site-scoped campus news and strict one-time attendance validation.

create table if not exists public.campus_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 4 and 120),
  body text not null check (length(trim(body)) between 10 and 3000),
  site text check (site is null or site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  expires_at date,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);

create index if not exists campus_announcements_published_feed
  on public.campus_announcements(status, published_at desc);
create index if not exists campus_announcements_site_feed
  on public.campus_announcements(site, status, published_at desc);

alter table public.campus_announcements enable row level security;
revoke all on public.campus_announcements from public, anon;
grant select, insert, update on public.campus_announcements to authenticated;

drop policy if exists "students read campus announcements" on public.campus_announcements;
create policy "students read campus announcements" on public.campus_announcements
  for select to authenticated using (
    status = 'published'
    and published_at <= now()
    and (expires_at is null or expires_at >= (now() at time zone 'Africa/Porto-Novo')::date)
    and exists (
      select 1 from public.student_profiles p
      where p.user_id = (select auth.uid())
        and (campus_announcements.site is null or campus_announcements.site = p.site)
    )
  );

drop policy if exists "admins read scoped announcements" on public.campus_announcements;
create policy "admins read scoped announcements" on public.campus_announcements
  for select to authenticated using (
    (campus_announcements.site is null and (select public.is_admin()))
    or (campus_announcements.site is not null and (select public.is_admin_for_site(campus_announcements.site)))
  );

drop policy if exists "admins create scoped announcements" on public.campus_announcements;
create policy "admins create scoped announcements" on public.campus_announcements
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and ((site is null and (select public.is_admin()))
      or (site is not null and (select public.is_admin_for_site(site))))
  );

drop policy if exists "admins update scoped announcements" on public.campus_announcements;
create policy "admins update scoped announcements" on public.campus_announcements
  for update to authenticated
  using ((site is null and (select public.is_admin()))
      or (site is not null and (select public.is_admin_for_site(site))))
  with check ((site is null and (select public.is_admin()))
      or (site is not null and (select public.is_admin_for_site(site))));

-- A pre-created absence can transition to present exactly once. Concurrent
-- submissions also use the unique key to ensure only one succeeds.
create or replace function public.submit_attendance(p_token text)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare s public.attendance_sessions%rowtype; p public.student_profiles%rowtype; rec public.attendance_records%rowtype;
begin
  select * into strict p from public.student_profiles where user_id = (select auth.uid());
  if not exists (
    select 1 from public.badge_applications a
    where a.student_id = p.user_id and a.status = 'approved'
  ) then
    raise exception 'votre demande doit être approuvée pour enregistrer une présence';
  end if;
  select * into s from public.attendance_sessions
    where token_digest = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and starts_at <= now() and ends_at >= now();
  if not found then raise exception 'QR invalide ou séance terminée'; end if;
  if (p.site, p.program, p.level) is distinct from (s.site, s.program, s.level) then
    raise exception 'ce QR ne correspond pas à votre groupe';
  end if;

  insert into public.attendance_records as existing_record(session_id, student_id, status, attended_at)
    values (s.id, p.user_id, 'present', now())
    on conflict (session_id, student_id) do update
      set status = 'present', attended_at = now()
      where existing_record.status = 'absent'
    returning * into rec;
  if not found then raise exception 'présence déjà enregistrée'; end if;
  return rec;
end;
$$;
revoke all on function public.submit_attendance(text) from public, anon;
grant execute on function public.submit_attendance(text) to authenticated;
