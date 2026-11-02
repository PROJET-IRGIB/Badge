begin;

-- Store the authenticated administrator's email in the private audit row so the
-- campus journal can identify the actor without querying Auth from the browser.
create or replace function public.log_student_admin_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fields text[] := array[]::text[];
  event_name text;
  actor_email text := ((select auth.jwt()) ->> 'email');
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.account_status is distinct from old.account_status then fields := pg_catalog.array_append(fields, 'account_status'); end if;
    if new.banned_at is distinct from old.banned_at then fields := pg_catalog.array_append(fields, 'banned_at'); end if;
    if new.card_suspended_at is distinct from old.card_suspended_at then fields := pg_catalog.array_append(fields, 'card_suspended_at'); end if;
    if new.first_name is distinct from old.first_name then fields := pg_catalog.array_append(fields, 'first_name'); end if;
    if new.last_name is distinct from old.last_name then fields := pg_catalog.array_append(fields, 'last_name'); end if;
    if new.phone is distinct from old.phone then fields := pg_catalog.array_append(fields, 'phone'); end if;
    if new.sex is distinct from old.sex then fields := pg_catalog.array_append(fields, 'sex'); end if;
    if new.program is distinct from old.program then fields := pg_catalog.array_append(fields, 'program'); end if;
    if new.level is distinct from old.level then fields := pg_catalog.array_append(fields, 'level'); end if;
    if new.birth_date is distinct from old.birth_date then fields := pg_catalog.array_append(fields, 'birth_date'); end if;
    if new.origin_group is distinct from old.origin_group then fields := pg_catalog.array_append(fields, 'origin_group'); end if;
    if new.country_of_origin is distinct from old.country_of_origin then fields := pg_catalog.array_append(fields, 'country_of_origin'); end if;
    if pg_catalog.cardinality(fields) = 0 then return new; end if;
    event_name := case
      when new.account_status is distinct from old.account_status then 'student_account_decision'
      when new.banned_at is distinct from old.banned_at then 'student_ban_change'
      when new.card_suspended_at is distinct from old.card_suspended_at then 'student_card_suspension_change'
      else 'student_profile_edit'
    end;
    insert into public.admin_action_log(site, actor_id, subject_id, action, details)
    values (new.site, (select auth.uid()), new.user_id, event_name,
      jsonb_build_object('fields', fields, 'actor_email', actor_email));
  end if;
  return new;
end;
$$;
revoke all on function public.log_student_admin_changes() from public, anon, authenticated;

create or replace function public.log_badge_admin_decisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.admin_action_log(site, actor_id, subject_id, action, details)
    values (new.site, (select auth.uid()), new.student_id, 'badge_application_decision',
      jsonb_build_object(
        'application_id', new.id,
        'from', old.status,
        'to', new.status,
        'matricule', new.final_matricule,
        'actor_email', ((select auth.jwt()) ->> 'email')
      ));
  end if;
  return new;
end;
$$;
revoke all on function public.log_badge_admin_decisions() from public, anon, authenticated;

commit;
