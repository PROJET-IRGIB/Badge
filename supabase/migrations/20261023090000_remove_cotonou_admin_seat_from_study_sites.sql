-- Cotonou's administrative headquarters is not a student study site.
-- NOT VALID preserves any historical records while enforcing the new list on new/updated rows.
alter table public.student_profiles drop constraint if exists student_profiles_site_check;
alter table public.student_profiles add constraint student_profiles_site_study_check
  check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')) not valid;

alter table public.badge_applications drop constraint if exists badge_applications_site_check;
alter table public.badge_applications add constraint badge_applications_site_study_check
  check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')) not valid;

alter table public.attendance_sessions drop constraint if exists attendance_sessions_site_check;
alter table public.attendance_sessions add constraint attendance_sessions_site_study_check
  check (site in ('COT-AKPAKPA','CAL-CENTRE','PNV-CENTRE','PRK-CENTRE','DJG-CENTRE')) not valid;
