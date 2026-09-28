-- ==============================================================================
-- SAMLEYGO — SUPER ADMIN ROLE PROTECTION MIGRATION
-- -----------------------------------------------------------------------------
-- Run this in the Supabase SQL Editor alongside the other migrations.
-- Fully idempotent — safe to run on a fresh or already-live database.
--
-- Why: the original "Users can update their own profile" policy had no
-- WITH CHECK, so any signed-in user could run
--     update profiles set role = 'SUPER_ADMIN' where id = auth.uid()
-- and walk straight into /admin/dashboard. These two objects close that hole
-- and keep SUPER_ADMIN exclusive to accounts granted it by platform operators.
-- ==============================================================================

-- 1. Allow users to create their own profile row (needed when the signup trigger
--    is disabled) — but never with the SUPER_ADMIN role.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'profiles'
          and policyname = 'Users can insert their own profile'
    ) then
        create policy "Users can insert their own profile" on public.profiles
            for insert with check (auth.uid() = id and role <> 'SUPER_ADMIN');
    end if;
end$$;

-- 2. Role change guard: only a super admin, a service role call or a session-less
--    SQL console (auth.uid() is null) may change profiles.role.
create or replace function public.protect_profile_role()
returns trigger as $$
begin
    if new.role is distinct from old.role
       and auth.uid() is not null
       and not exists (
           select 1 from public.profiles
            where id = auth.uid() and role = 'SUPER_ADMIN'
       ) then
        raise exception 'Only a super admin can change account roles';
    end if;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists protect_profiles_role on public.profiles;
create trigger protect_profiles_role
    before update on public.profiles
    for each row execute function public.protect_profile_role();

-- ==============================================================================
-- END OF MIGRATION
-- ==============================================================================
