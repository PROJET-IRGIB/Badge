begin;

-- Retiring a publication now archives it. Only explicitly authorized campus
-- administrators can permanently delete announcements and their media paths.
create or replace function public.admin_set_campus_announcement_status(
  p_announcement_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.campus_announcements%rowtype;
  publisher_site text;
begin
  if p_status not in ('archived', 'published') then
    raise exception 'Statut d’actualité invalide';
  end if;

  select * into item
  from public.campus_announcements a
  where a.id = p_announcement_id
  for update;

  if not found then raise exception 'Actualité introuvable'; end if;
  publisher_site := coalesce(item.published_by_site, item.site);

  if not (select public.is_admin())
     and (publisher_site is null or not (select public.is_admin_for_site(publisher_site))) then
    raise exception 'Vous n’êtes pas autorisé à modifier cette actualité' using errcode = '42501';
  end if;

  update public.campus_announcements
  set status = p_status,
      published_at = case when p_status = 'published' then coalesce(published_at, pg_catalog.now()) else published_at end
  where id = p_announcement_id;

  return p_announcement_id;
end;
$$;

revoke all on function public.admin_set_campus_announcement_status(uuid, text) from public, anon;
grant execute on function public.admin_set_campus_announcement_status(uuid, text) to authenticated;

create or replace function public.admin_delete_campus_announcement(p_announcement_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.campus_announcements%rowtype;
  publisher_site text;
begin
  select * into item
  from public.campus_announcements a
  where a.id = p_announcement_id
  for update;

  if not found then raise exception 'Actualité introuvable'; end if;
  publisher_site := coalesce(item.published_by_site, item.site);

  if not (select public.is_admin())
     and (publisher_site is null or not (select public.is_admin_for_site(publisher_site))) then
    raise exception 'Vous n’êtes pas autorisé à supprimer cette actualité' using errcode = '42501';
  end if;

  delete from public.campus_announcements where id = p_announcement_id;
  return item.media_path;
end;
$$;

revoke all on function public.admin_delete_campus_announcement(uuid) from public, anon;
grant execute on function public.admin_delete_campus_announcement(uuid) to authenticated;

commit;
