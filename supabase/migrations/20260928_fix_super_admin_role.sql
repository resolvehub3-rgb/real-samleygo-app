-- ==============================================================================
-- SAMLEYGO — SUPER-ADMIN ROLE REPAIR
-- ------------------------------------------------------------------------------
-- Symptom: signing in with the super-admin credentials lands on
--          /restaurant/dashboard showing the "Register Your Restaurant" form
--          instead of /admin/dashboard.
--
-- Cause:   LoginPage routes on the role in public.profiles. That row for this
--          account says RESTAURANT_OWNER (the signup path that created the row
--          wrote a customer/owner role, or the row was created later via
--          upsert with a non-admin role), so the app treats the account as a
--          restaurant owner with no registered kitchen.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this file -> Run.
--   Then sign out in the app and sign in again.
--
-- WHAT IT DOES
--   1. Diagnostics: prints the current role row(s) for the admin email(s).
--   2. Fixes public.profiles.role -> 'SUPER_ADMIN' for every account whose
--      auth.users metadata says SUPER_ADMIN (and vice-versa), so the source of
--      truth and the profile table agree in both directions.
--   3. Aligns raw_user_meta_data.role / raw_app_meta_data.role in auth.users.
--   4. Optionally deletes an accidental restaurant row created while the
--      account was misrouted (UNCOMMENT block 4 if you created one).
-- ==============================================================================

-- 1) DIAGNOSTICS — run first if you want to see the current state.
--    Replace the email with your super-admin's email if you know it.
select p.id, p.email, p.role as profile_role, p.created_at,
       u.email as auth_email,
       u.raw_user_meta_data->>'role' as meta_role,
       u.raw_app_meta_data->>'role'  as app_meta_role
from public.profiles p
left join auth.users u on u.id = p.id
where u.email ilike '%admin%'          -- adjust to your admin email
   or p.role = 'SUPER_ADMIN'
   or u.raw_user_meta_data->>'role' = 'SUPER_ADMIN'
order by p.created_at desc;

-- 2) PROFILES -> SUPER_ADMIN where the auth metadata already says SUPER_ADMIN.
--    (This is the direction that fixes the reported symptom: auth metadata
--    correct, profiles row stale.)
update public.profiles p
set role = 'SUPER_ADMIN',
    updated_at = now()
from auth.users u
where u.id = p.id
  and u.raw_user_meta_data->>'role' = 'SUPER_ADMIN'
  and p.role <> 'SUPER_ADMIN';

-- 3) ALIGN AUTH METADATA where the profile row is authoritative
--    (covers accounts whose metadata was never set but the profile is admin).
update auth.users u
set raw_user_meta_data = jsonb_set(
        coalesce(u.raw_user_meta_data, '{}'::jsonb),
        '{role}', to_jsonb('SUPER_ADMIN'::text), true),
    raw_app_meta_data = jsonb_set(
        coalesce(u.raw_app_meta_data, '{}'::jsonb),
        '{role}', to_jsonb('SUPER_ADMIN'::text), true)
from public.profiles p
where p.id = u.id
  and p.role = 'SUPER_ADMIN'
  and (u.raw_user_meta_data->>'role' is distinct from 'SUPER_ADMIN'
       or u.raw_app_meta_data->>'role' is distinct from 'SUPER_ADMIN');

-- 4) OPTIONAL CLEANUP — only if a restaurant was accidentally registered by the
--    misrouted admin account. UNCOMMENT to remove it (cascades to categories,
--    menu items and orders).
-- delete from public.restaurants
-- where owner_id in (
--     select p.id from public.profiles p
--     join auth.users u on u.id = p.id
--     where p.role = 'SUPER_ADMIN'
--       and u.raw_user_meta_data->>'role' = 'SUPER_ADMIN'
-- );

-- 5) VERIFY — must return exactly one row with role = SUPER_ADMIN everywhere.
select p.email,
       p.role as profile_role,
       u.raw_user_meta_data->>'role' as meta_role,
       u.raw_app_meta_data->>'role'  as app_meta_role
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'SUPER_ADMIN'
   or u.raw_user_meta_data->>'role' = 'SUPER_ADMIN';
