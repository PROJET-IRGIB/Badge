-- Let a site administrator publish to their site or to every site,
-- while retaining a visible and enforceable publisher site.

alter table public.campus_announcements
  add column if not exists published_by_site text;

alter table public.campus_announcements
  drop constraint if exists campus_announcements_published_by_site_check;
alter table public.campus_announcements
  add constraint campus_announcements_published_by_site_check
  check (published_by_site is null or published_by_site in (
    'COT-AKPAKPA', 'CAL-CENTRE', 'PNV-CENTRE', 'PRK-CENTRE', 'DJG-CENTRE'
  ));

-- Existing site-only notices are attributed to the campus they targeted.
update public.campus_announcements
set published_by_site = site
where published_by_site is null and site is not null;

drop policy if exists "admins read scoped announcements" on public.campus_announcements;
create policy "admins read scoped announcements" on public.campus_announcements
  for select to authenticated using (
    (select public.is_admin())
    or (
      campus_announcements.site is not null
      and (select public.is_admin_for_site(campus_announcements.site))
    )
    or (
      campus_announcements.site is null
      and campus_announcements.published_by_site is not null
      and (select public.is_admin_for_site(campus_announcements.published_by_site))
    )
  );

drop policy if exists "admins create scoped announcements" on public.campus_announcements;
create policy "admins create scoped announcements" on public.campus_announcements
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or (
        published_by_site is not null
        and (select public.is_admin_for_site(published_by_site))
        and (site is null or site = published_by_site)
      )
    )
  );

drop policy if exists "admins update scoped announcements" on public.campus_announcements;
create policy "admins update scoped announcements" on public.campus_announcements
  for update to authenticated
  using (
    (select public.is_admin())
    or (
      published_by_site is not null
      and (select public.is_admin_for_site(published_by_site))
      and (site is null or site = published_by_site)
    )
  )
  with check (
    (select public.is_admin())
    or (
      published_by_site is not null
      and (select public.is_admin_for_site(published_by_site))
      and (site is null or site = published_by_site)
    )
  );
