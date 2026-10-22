-- Authorize the corrected admin once that account exists in Authentication.
-- Safe to run more than once. If the user has not been created yet, this inserts nothing.
insert into public.admin_members (user_id)
select id
from auth.users
where lower(email) in (
  lower('jesusesonoesononchama219@gmail.com'),
  lower('jesusesonoesononchama219@gmal.com')
)
on conflict (user_id) do nothing;
