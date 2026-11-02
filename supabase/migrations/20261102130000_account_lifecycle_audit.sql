begin;

-- Account management uses the service role after the Edge Function verifies
-- the administrator. Do not create anonymous-looking trigger entries for those
-- updates; the Edge Function writes a separate event with the verified actor.
create or replace function public.log_student_admin_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare fields text[] := array[]::text[]; event_name text;
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.account_status is distinct from old.account_status then fields := pg_catalog.array_append(fields,'account_status'); end if;
    if new.banned_at is distinct from old.banned_at then fields := pg_catalog.array_append(fields,'banned_at'); end if;
    if new.card_suspended_at is distinct from old.card_suspended_at then fields := pg_catalog.array_append(fields,'card_suspended_at'); end if;
    if new.first_name is distinct from old.first_name then fields := pg_catalog.array_append(fields,'first_name'); end if;
    if new.last_name is distinct from old.last_name then fields := pg_catalog.array_append(fields,'last_name'); end if;
    if new.phone is distinct from old.phone then fields := pg_catalog.array_append(fields,'phone'); end if;
    if new.sex is distinct from old.sex then fields := pg_catalog.array_append(fields,'sex'); end if;
    if new.program is distinct from old.program then fields := pg_catalog.array_append(fields,'program'); end if;
    if new.level is distinct from old.level then fields := pg_catalog.array_append(fields,'level'); end if;
    if new.birth_date is distinct from old.birth_date then fields := pg_catalog.array_append(fields,'birth_date'); end if;
    if new.origin_group is distinct from old.origin_group then fields := pg_catalog.array_append(fields,'origin_group'); end if;
    if new.country_of_origin is distinct from old.country_of_origin then fields := pg_catalog.array_append(fields,'country_of_origin'); end if;
    if pg_catalog.cardinality(fields) = 0 then return new; end if;
    event_name := case
      when new.account_status is distinct from old.account_status then 'student_account_decision'
      when new.banned_at is distinct from old.banned_at then 'student_ban_change'
      when new.card_suspended_at is distinct from old.card_suspended_at then 'student_card_suspension_change'
      else 'student_profile_edit'
    end;
    insert into public.admin_action_log(site,actor_id,subject_id,action,details)
    values(new.site,(select auth.uid()),new.user_id,event_name,jsonb_build_object('fields',fields));
  end if;
  return new;
end;
$$;

revoke all on function public.log_student_admin_changes() from public, anon, authenticated;

commit;
