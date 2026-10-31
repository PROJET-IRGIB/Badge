-- An admin account must belong to at most one campus site.
-- Resolve any existing multi-site assignments explicitly before applying this migration.
do $$
begin
  if exists (
    select 1
    from public.admin_site_members
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'Some admin accounts are assigned to multiple sites. Keep one site per account, then rerun this migration.';
  end if;
end;
$$;

create unique index if not exists admin_site_members_one_site_per_user_idx
  on public.admin_site_members (user_id);
