-- Administrator account controls, scoped to the student's learning site.
alter table public.student_profiles add column if not exists banned_at timestamptz;
alter table public.student_profiles add column if not exists banned_by uuid references auth.users(id) on delete set null;
alter table public.student_profiles add column if not exists ban_reason text;

drop policy if exists "admins assign representatives" on public.class_representatives;
create policy "admins assign representatives" on public.class_representatives
  for insert to authenticated with check (
    assigned_by = (select auth.uid())
    and (select public.is_admin_for_site(site))
    and exists (
      select 1 from public.student_profiles p
      where p.user_id=class_representatives.user_id and p.banned_at is null
        and (p.site,p.program,p.level)=(class_representatives.site,class_representatives.program,class_representatives.level)
    )
  );

drop policy if exists "admins update representatives" on public.class_representatives;
create policy "admins update representatives" on public.class_representatives
  for update to authenticated using ((select public.is_admin_for_site(site)))
  with check (
    (select public.is_admin_for_site(class_representatives.site))
    and exists (
      select 1 from public.student_profiles p
      where p.user_id=class_representatives.user_id and p.banned_at is null
        and (p.site,p.program,p.level)=(class_representatives.site,class_representatives.program,class_representatives.level)
    )
  );

create or replace function public.admin_assign_class_representative(
  p_student_id uuid, p_site text, p_program text, p_level text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise'; end if;
  select * into p from public.student_profiles where user_id=p_student_id for update;
  if not found then raise exception 'Étudiant introuvable'; end if;
  if (p.site,p.program,p.level) is distinct from (p_site,p_program,p_level) then
    raise exception 'Les informations du groupe ne correspondent pas au profil étudiant';
  end if;
  if p.banned_at is not null then raise exception 'Un compte banni ne peut pas être responsable'; end if;
  if not public.is_admin_for_site(p.site) then raise exception 'Accès administrateur refusé pour ce site'; end if;
  if exists (
    select 1 from public.class_representatives cr
    where cr.user_id=p_student_id and not public.is_admin_for_site(cr.site)
  ) then raise exception 'Vous ne pouvez pas modifier son affectation sur un autre site'; end if;

  -- An account can represent only one group. Move the role atomically if needed.
  delete from public.class_representatives where user_id=p_student_id;
  insert into public.class_representatives(site,program,level,user_id,assigned_by,assigned_at)
    values(p.site,p.program,p.level,p_student_id,(select auth.uid()),now())
    on conflict (site,program,level) do update
      set user_id=excluded.user_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
end;
$$;
revoke all on function public.admin_assign_class_representative(uuid,text,text,text) from public, anon;
grant execute on function public.admin_assign_class_representative(uuid,text,text,text) to authenticated;
