-- A group can have several class representatives. One student still belongs to a single group.

alter table public.class_representatives drop constraint class_representatives_pkey;
alter table public.class_representatives
  add constraint class_representatives_pkey primary key (site, program, level, user_id);

create or replace function public.admin_assign_class_representative(p_student_id uuid,p_site text,p_program text,p_level text)
returns void language plpgsql security definer set search_path = ''
as $$
declare p public.student_profiles%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise'; end if;
  select * into p from public.student_profiles where user_id=p_student_id for update;
  if not found then raise exception 'Étudiant introuvable'; end if;
  if (p.site,p.program,p.level) is distinct from (p_site,p_program,p_level) then raise exception 'Les informations du groupe ne correspondent pas au profil étudiant'; end if;
  if p.banned_at is not null or p.card_suspended_at is not null then raise exception 'Un compte ou badge désactivé ne peut pas être responsable'; end if;
  if not public.is_admin_for_site(p.site) then raise exception 'Accès administrateur refusé pour ce site'; end if;
  if exists(
    select 1 from public.class_representatives cr
    where cr.user_id=p_student_id and (cr.site,cr.program,cr.level)=(p.site,p.program,p.level)
  ) then
    return;
  end if;
  if exists(select 1 from public.class_representatives cr where cr.user_id=p_student_id and not public.is_admin_for_site(cr.site)) then
    raise exception 'Vous ne pouvez pas modifier son affectation sur un autre site';
  end if;
  delete from public.class_representatives where user_id=p_student_id;
  insert into public.class_representatives(site,program,level,user_id,assigned_by,assigned_at)
    values(p.site,p.program,p.level,p_student_id,(select auth.uid()),pg_catalog.now());
end;
$$;
revoke all on function public.admin_assign_class_representative(uuid,text,text,text) from public, anon;
grant execute on function public.admin_assign_class_representative(uuid,text,text,text) to authenticated;

drop function if exists public.admin_reset_representative_daily_qr_pin(text,text,text);
create or replace function public.admin_reset_representative_daily_qr_pin(p_site text,p_program text,p_level text,p_student_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare rep public.class_representatives%rowtype;
begin
  select * into rep from public.class_representatives cr
    where cr.site=p_site and cr.program=p_program and cr.level=p_level and cr.user_id=p_student_id
    for update;
  if not found then raise exception 'Aucun responsable n’est affecté à ce groupe'; end if;
  if not (select public.is_admin_for_site(rep.site)) then raise exception 'Vous n’êtes pas autorisé à réinitialiser le code de ce groupe' using errcode='42501'; end if;
  update public.class_representatives set daily_qr_pin_hash=null,daily_qr_pin_failures=0,daily_qr_pin_locked_until=null
    where user_id=rep.user_id;
end;
$$;
revoke all on function public.admin_reset_representative_daily_qr_pin(text,text,text,uuid) from public, anon;
grant execute on function public.admin_reset_representative_daily_qr_pin(text,text,text,uuid) to authenticated;

create or replace function public.admin_reset_representative_daily_qr_pin(p_site text,p_program text,p_level text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists(select 1 from public.class_representatives cr where cr.site=p_site and cr.program=p_program and cr.level=p_level) then
    raise exception 'Aucun responsable n’est affecté à ce groupe';
  end if;
  if not (select public.is_admin_for_site(p_site)) then raise exception 'Vous n’êtes pas autorisé à réinitialiser le code de ce groupe' using errcode='42501'; end if;
  update public.class_representatives set daily_qr_pin_hash=null,daily_qr_pin_failures=0,daily_qr_pin_locked_until=null
    where site=p_site and program=p_program and level=p_level;
end;
$$;
revoke all on function public.admin_reset_representative_daily_qr_pin(text,text,text) from public, anon;
grant execute on function public.admin_reset_representative_daily_qr_pin(text,text,text) to authenticated;
