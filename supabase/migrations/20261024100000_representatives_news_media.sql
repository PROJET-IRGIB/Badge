-- Class representatives, announcement media and scoped browser notification events.

create table if not exists public.class_representatives (
  site text not null check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  program text not null check (program in ('ABM','TIC','PFMI','PEA','PP','BBA','SJ','NUT')),
  level text not null check (level in ('LP1','LP2','LP3','M1','M2')),
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (site, program, level),
  unique (user_id)
);
alter table public.class_representatives enable row level security;
revoke all on public.class_representatives from public, anon;
grant select, insert, update, delete on public.class_representatives to authenticated;
drop policy if exists "representatives read scoped assignment" on public.class_representatives;
create policy "representatives read scoped assignment" on public.class_representatives
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin_for_site(site)));
drop policy if exists "admins assign representatives" on public.class_representatives;
create policy "admins assign representatives" on public.class_representatives
  for insert to authenticated with check (
    assigned_by = (select auth.uid()) and (select public.is_admin_for_site(site))
    and exists (select 1 from public.badge_applications a where a.student_id=class_representatives.user_id and a.status='approved'
      and (a.site,a.program,a.level)=(class_representatives.site,class_representatives.program,class_representatives.level))
  );
drop policy if exists "admins update representatives" on public.class_representatives;
create policy "admins update representatives" on public.class_representatives
  for update to authenticated using ((select public.is_admin_for_site(site)))
  with check ((select public.is_admin_for_site(class_representatives.site)) and exists (
    select 1 from public.badge_applications a where a.student_id=class_representatives.user_id and a.status='approved'
      and (a.site,a.program,a.level)=(class_representatives.site,class_representatives.program,class_representatives.level)));
drop policy if exists "admins remove representatives" on public.class_representatives;
create policy "admins remove representatives" on public.class_representatives
  for delete to authenticated using ((select public.is_admin_for_site(site)));

alter table public.attendance_records add column if not exists marked_by uuid references auth.users(id) on delete set null;

create or replace function public.list_representative_groupmates()
returns table(student_id uuid, first_name text, last_name text, final_matricule text)
language plpgsql stable security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype;
begin
  select * into rep from public.class_representatives where user_id=(select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  return query
    select a.student_id,a.first_name,a.last_name,a.final_matricule
    from public.badge_applications a
    where a.status='approved' and (a.site,a.program,a.level)=(rep.site,rep.program,rep.level)
      and a.student_id<>(select auth.uid())
    order by a.last_name,a.first_name;
end;
$$;
revoke all on function public.list_representative_groupmates() from public, anon;
grant execute on function public.list_representative_groupmates() to authenticated;

create or replace function public.mark_classmate_attendance(p_student_id uuid)
returns public.attendance_records language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype; session_row public.attendance_sessions%rowtype; rec public.attendance_records%rowtype; day_value date;
begin
  select * into rep from public.class_representatives where user_id=(select auth.uid());
  if not found then raise exception 'Vous n’êtes pas responsable de classe'; end if;
  if p_student_id=(select auth.uid()) then raise exception 'Utilisez votre propre espace pour marquer votre présence'; end if;
  if not exists (select 1 from public.badge_applications a where a.student_id=p_student_id and a.status='approved'
      and (a.site,a.program,a.level)=(rep.site,rep.program,rep.level)) then
    raise exception 'Cet étudiant n’appartient pas à votre groupe';
  end if;
  day_value := (now() at time zone 'Africa/Porto-Novo')::date;
  perform public.ensure_daily_attendance_sessions(day_value);
  select * into session_row from public.attendance_sessions s
    where (s.site,s.program,s.level,s.session_day,s.is_daily)=(rep.site,rep.program,rep.level,day_value,true)
      and s.starts_at<=now() and s.ends_at>=now();
  if not found then raise exception 'La présence du jour n’est pas ouverte'; end if;
  update public.attendance_records r set status='present',attended_at=now(),marked_by=(select auth.uid())
    where r.session_id=session_row.id and r.student_id=p_student_id and r.status='absent'
    returning r.* into rec;
  if not found then
    if exists(select 1 from public.attendance_records r where r.session_id=session_row.id and r.student_id=p_student_id and r.status='present') then
      raise exception 'La présence de cet étudiant est déjà enregistrée';
    end if;
    raise exception 'Aucune absence en attente pour cet étudiant aujourd’hui';
  end if;
  return rec;
end;
$$;
revoke all on function public.mark_classmate_attendance(uuid) from public, anon;
grant execute on function public.mark_classmate_attendance(uuid) to authenticated;

alter table public.campus_announcements add column if not exists media_path text;
alter table public.campus_announcements add column if not exists media_type text check (media_type is null or media_type in ('image','video'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname='campus_announcements_media_pair_check') then
    alter table public.campus_announcements add constraint campus_announcements_media_pair_check
      check ((media_path is null) = (media_type is null));
  end if;
end; $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('campus-announcement-media','campus-announcement-media',false,52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "admins read announcement media" on storage.objects;
create policy "admins read announcement media" on storage.objects for select to authenticated
  using (bucket_id='campus-announcement-media' and (
    (storage.foldername(name))[1]='all' and (select public.is_admin())
    or (storage.foldername(name))[1]<>'all' and (select public.is_admin_for_site((storage.foldername(name))[1]))));
drop policy if exists "students read published announcement media" on storage.objects;
create policy "students read published announcement media" on storage.objects for select to authenticated
  using (bucket_id='campus-announcement-media' and exists (
    select 1 from public.campus_announcements ca join public.student_profiles p on p.user_id=(select auth.uid())
    where ca.media_path=storage.objects.name and ca.status='published' and ca.published_at<=now()
      and (ca.expires_at is null or ca.expires_at >= (now() at time zone 'Africa/Porto-Novo')::date)
      and (ca.site is null or ca.site=p.site)));
drop policy if exists "admins upload announcement media" on storage.objects;
create policy "admins upload announcement media" on storage.objects for insert to authenticated
  with check (bucket_id='campus-announcement-media' and (
    ((storage.foldername(name))[1]='all' and (select public.is_admin()))
    or ((storage.foldername(name))[1]<>'all' and (select public.is_admin_for_site((storage.foldername(name))[1])))));
drop policy if exists "admins update announcement media" on storage.objects;
create policy "admins update announcement media" on storage.objects for update to authenticated
  using (bucket_id='campus-announcement-media' and (
    ((storage.foldername(name))[1]='all' and (select public.is_admin()))
    or ((storage.foldername(name))[1]<>'all' and (select public.is_admin_for_site((storage.foldername(name))[1])))))
  with check (bucket_id='campus-announcement-media' and (
    ((storage.foldername(name))[1]='all' and (select public.is_admin()))
    or ((storage.foldername(name))[1]<>'all' and (select public.is_admin_for_site((storage.foldername(name))[1])))));
drop policy if exists "admins delete announcement media" on storage.objects;
create policy "admins delete announcement media" on storage.objects for delete to authenticated
  using (bucket_id='campus-announcement-media' and (
    ((storage.foldername(name))[1]='all' and (select public.is_admin()))
    or ((storage.foldername(name))[1]<>'all' and (select public.is_admin_for_site((storage.foldername(name))[1])))));

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  site text not null check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')),
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
drop policy if exists "students manage own push subscriptions" on public.push_subscriptions;
create policy "students manage own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()) and exists (
    select 1 from public.student_profiles p where p.user_id=(select auth.uid()) and p.site=push_subscriptions.site));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='campus_announcements') then
    alter publication supabase_realtime add table public.campus_announcements;
  end if;
end;
$$;
