-- ==============================================================================
-- SAMLEYGO — SIGNUP REPAIR
-- -----------------------------------------------------------------------------
-- Symptom: every registration (customer, kitchen/restaurant owner, courier)
-- fails with HTTP 500  {"error_code":"unexpected_failure",
--                       "msg":"Database error saving new user"}.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this file -> Run.
--   Idempotent: safe to run on a fresh or already-live project, as often as
--   needed. It never modifies an existing account or its data.
--
-- WHAT IT DOES
--   1. Snapshots the CURRENT signup trigger (owner, SECURITY DEFINER flag,
--      search_path, full source, every trigger on auth.users, profiles RLS
--      flags) into public.signup_debug so nothing is lost when we replace it.
--   2. Reproduces a signup with the CURRENT trigger twice — once with a
--      search_path that contains `public`, once with an empty one (what the
--      auth service may well be using) — and stores the exact error each time.
--   3. Replaces public.handle_new_user() with a hardened version:
--        * security definer + explicit `set search_path`, every object
--          schema-qualified -> immune to the caller's search_path
--        * the role is written as an untyped 'LITERAL', so the enum type is
--          never resolved by name (the old source's unqualified `user_role`
--          is the classic "type user_role does not exist" failure)
--        * null-safe email / full name / phone (NOT NULL columns)
--        * ON CONFLICT DO NOTHING on every side insert
--        * side rows (customers / couriers / courier_documents) written in a
--          nested block so they can never roll the profile row back
--        * a top-level exception handler: registration can NEVER be blocked
--          again — the error goes to public.signup_debug instead, and the app
--          creates the profile row itself right after signUp.
--   4. Re-runs both probes against the repaired trigger.
--   5. Prints the full report.
--
-- READING THE RESULT
--   probe_before_*  = behaviour of the trigger you had
--   probe_after_*   = behaviour of the repaired trigger (both must be SUCCESS)
--   trigger_error / trigger_warning rows = what the repaired trigger had to
--   swallow (ideally: none).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. DIAGNOSTIC TABLE — how the failure is read back later
-- ------------------------------------------------------------------------------
create table if not exists public.signup_debug (
    id          uuid primary key default gen_random_uuid(),
    recorded_at timestamptz not null default now(),
    kind        text not null,
    detail      text
);

alter table public.signup_debug enable row level security;

drop policy if exists "Signed in users can read signup debug" on public.signup_debug;
create policy "Signed in users can read signup debug" on public.signup_debug
    for select to authenticated using (true);

grant select on table public.signup_debug to authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 1. SNAPSHOT THE CURRENT TRIGGER (before we touch anything)
-- ------------------------------------------------------------------------------
do $$
declare
    v_rec   record;
    v_sql   text;
    v_found boolean := false;
begin
    for v_rec in
        select p.oid,
               pg_catalog.pg_get_userbyid(p.proowner)  as owner_name,
               p.prosecdef                             as is_definer,
               coalesce(p.proconfig::text, '<none>')   as set_clause,
               pg_catalog.pg_get_functiondef(p.oid)    as source
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'handle_new_user'
    loop
        v_found := true;
        raise notice 'handle_new_user(): owner=%, security definer=%, set=%',
                     v_rec.owner_name, v_rec.is_definer, v_rec.set_clause;
        insert into public.signup_debug (kind, detail)
        values ('old_function',
                'owner=' || v_rec.owner_name
                || '; security_definer=' || v_rec.is_definer
                || '; set=' || v_rec.set_clause
                || E'\n--- source ---\n' || v_rec.source);
    end loop;

    if not v_found then
        raise notice 'handle_new_user(): NOT FOUND in schema public';
        insert into public.signup_debug (kind, detail)
        values ('old_function', 'handle_new_user() NOT FOUND in schema public');
    end if;

    -- every user trigger attached to auth.users (ours, or anything else)
    for v_rec in
        select t.tgname, pg_catalog.pg_get_triggerdef(t.oid) as ddl
          from pg_catalog.pg_trigger t
         where t.tgrelid = 'auth.users'::pg_catalog.regclass
           and not t.tgisinternal
    loop
        raise notice 'auth.users trigger: %', v_rec.tgname;
        insert into public.signup_debug (kind, detail)
        values ('old_trigger', v_rec.tgname || ' => ' || v_rec.ddl);
    end loop;

    -- profiles: owner + RLS flags. A SECURITY DEFINER trigger only bypasses
    -- row level security when it runs as the table owner.
    select coalesce('profiles owner=' || pg_catalog.pg_get_userbyid(c.relowner)
                    || '; rls_enabled=' || c.relrowsecurity
                    || '; rls_forced=' || c.relforcerowsecurity,
                    'profiles: NOT FOUND')
      into v_sql
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles';
    raise notice '%', coalesce(v_sql, 'profiles: NOT FOUND');
    insert into public.signup_debug (kind, detail)
    values ('old_profiles', coalesce(v_sql, 'profiles: NOT FOUND'));

    -- where the user_role enum lives (the old source spells it unqualified)
    select 'user_role enum schema=' || n.nspname
      into v_sql
      from pg_catalog.pg_type t
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'user_role';
    raise notice '%', coalesce(v_sql, 'user_role enum NOT FOUND');
    insert into public.signup_debug (kind, detail)
    values ('old_type', coalesce(v_sql, 'user_role enum NOT FOUND'));
end$$;

-- ------------------------------------------------------------------------------
-- 2. REUSABLE PROBE — a signup exactly the way GoTrue performs it (an INSERT
--    into auth.users, which fires every trigger attached to that table), run
--    under an explicit search_path.
--    NOTE: execute is revoked from everyone but postgres — this must never be
--    reachable through the public PostgREST API.
-- ------------------------------------------------------------------------------
create or replace procedure public.probe_signup(p_label text, p_search_path text)
language plpgsql
as $$
declare
    v_id      uuid;
    v_ok      boolean := false;
    v_err     text;
    v_profile boolean := false;
    v_path    text;
begin
    -- Emulate the caller's session. GoTrue connects as supabase_auth_admin and
    -- its search_path is not guaranteed to contain `public`.
    perform pg_catalog.set_config('search_path', p_search_path, true);
    -- record what the path ACTUALLY resolved to, not what was requested
    v_path := pg_catalog.array_to_string(pg_catalog.current_schemas(true), ',');
    v_id   := pg_catalog.gen_random_uuid();

    begin
        insert into auth.users (
            id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data
        ) values (
            v_id, 'authenticated', 'authenticated',
            'signup-probe-' || v_id || '@example.com', '',
            pg_catalog.now(), '{"provider":"email","providers":["email"]}',
            '{"full_name":"Signup Probe","phone":"+233000000000","role":"RESTAURANT_OWNER"}'
        );
        v_ok := true;
    exception when others then
        v_err := sqlerrm;
    end;

    if v_ok then
        select exists (select 1 from public.profiles where id = v_id) into v_profile;
    end if;

    insert into public.signup_debug (kind, detail)
    values (
        p_label,
        case
            when not v_ok then
                'FAILED: ' || coalesce(v_err, 'unknown error')
                || ' [schemas: ' || coalesce(v_path, '?') || ']'
            when v_profile then
                'SUCCESS - auth user + profile row created'
                || ' [schemas: ' || coalesce(v_path, '?') || ']'
            else
                'auth user created but profile row MISSING'
                || ' [schemas: ' || coalesce(v_path, '?') || ']'
        end
    );

    if not v_ok then
        raise notice '%: FAILED -> %', p_label, v_err;
    elsif not v_profile then
        raise notice '%: profile row MISSING', p_label;
    else
        raise notice '%: SUCCESS', p_label;
    end if;

    begin
        delete from auth.users where id = v_id;
    exception when others then
        insert into public.signup_debug (kind, detail)
        values ('probe_cleanup', p_label || ' cleanup FAILED: ' || sqlerrm);
    end;
end;
$$;

revoke execute on procedure public.probe_signup(text, text)
    from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. PROBE THE TRIGGER YOU HAVE RIGHT NOW
-- ------------------------------------------------------------------------------
-- NB: a single schema name, not a comma list — search_path entries containing
-- a comma are not split and would silently point at a schema that does not exist.
call public.probe_signup('probe_before_path_public', 'public');
call public.probe_signup('probe_before_path_empty',   '');

-- ------------------------------------------------------------------------------
-- 4. THE FIX — hardened signup trigger
-- ------------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_meta    jsonb;
    v_role    text;
    v_email   text;
    v_full    text;
    v_phone   text;
    v_card    text;
    v_licence text;
begin
    v_meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_role := v_meta->>'role';

    -- Anything unknown (or missing) becomes a plain customer.
    if v_role is null
       or v_role not in ('CUSTOMER', 'COURIER', 'RESTAURANT_OWNER', 'SUPER_ADMIN') then
        v_role := 'CUSTOMER';
    end if;

    v_email := coalesce(
        nullif(trim(new.email), ''),
        nullif(trim(v_meta->>'email'), ''),
        'no-email@samleygo.local'
    );
    v_full := coalesce(
        nullif(trim(v_meta->>'full_name'), ''),
        pg_catalog.split_part(v_email, '@', 1),
        'SamleyGo User'
    );
    v_phone := nullif(
        trim(coalesce(v_meta->>'phone', '')), '');

    -- The role is written as an untyped 'LITERAL' on purpose: PostgreSQL
    -- coerces it straight into the enum column, so this function never has to
    -- resolve the enum type by name (no search_path dependency at all).
    if v_role = 'COURIER' then
        insert into public.profiles (id, email, full_name, phone, role)
        values (new.id, v_email, v_full, v_phone, 'COURIER');
    elsif v_role = 'RESTAURANT_OWNER' then
        insert into public.profiles (id, email, full_name, phone, role)
        values (new.id, v_email, v_full, v_phone, 'RESTAURANT_OWNER');
    elsif v_role = 'SUPER_ADMIN' then
        insert into public.profiles (id, email, full_name, phone, role)
        values (new.id, v_email, v_full, v_phone, 'SUPER_ADMIN');
    else -- CUSTOMER (guaranteed by the normalisation above)
        insert into public.profiles (id, email, full_name, phone, role)
        values (new.id, v_email, v_full, v_phone, 'CUSTOMER');
    end if;

    -- Role-specific rows live in their own block: if one of them fails, the
    -- profile row above survives (the app recreates these itself anyway).
    begin
        if v_role = 'CUSTOMER' then
            insert into public.customers (id)
            values (new.id)
            on conflict (id) do nothing;

        elsif v_role = 'COURIER' then
            v_card    := nullif(
                trim(coalesce(v_meta->>'ghana_card_number', '')), '');
            v_licence := nullif(
                trim(coalesce(v_meta->>'license_number', '')), '');

            insert into public.couriers (
                id, vehicle_type, vehicle_plate,
                verification_status, verification_submitted_at
            ) values (
                new.id,
                coalesce(
                    nullif(
                        trim(coalesce(v_meta->>'vehicle_type', '')), ''),
                    'Motorcycle'),
                nullif(
                    trim(coalesce(v_meta->>'vehicle_plate', '')), ''),
                case when v_card is null then 'UNSUBMITTED' else 'PENDING' end,
                case when v_card is null then null else pg_catalog.now() end
            )
            on conflict (id) do nothing;

            if v_card is not null then
                insert into public.courier_documents
                    (courier_id, document_type, document_side, document_number, status)
                values
                    (new.id, 'GHANA_CARD_FRONT', 'FRONT', v_card, 'PENDING'),
                    (new.id, 'GHANA_CARD_BACK',  'BACK',  v_card, 'PENDING')
                on conflict (courier_id, document_type) do nothing;
            end if;

            if v_licence is not null then
                insert into public.courier_documents
                    (courier_id, document_type, document_number, status)
                values
                    (new.id, 'DRIVING_LICENCE', v_licence, 'PENDING')
                on conflict (courier_id, document_type) do nothing;
            end if;
        end if;
    exception when others then
        insert into public.signup_debug (kind, detail)
        values ('trigger_warning', 'role=' || v_role || '; ' || sqlerrm);
    end;

    return new;

exception when others then
    -- Registration must never be blocked by profile bookkeeping. Record what
    -- happened and let the account be created: AuthContext.signUp inserts the
    -- profile row itself, and fetchProfile falls back to the auth metadata.
    begin
        insert into public.signup_debug (kind, detail)
        values ('trigger_error', 'role=' || coalesce(v_role, '?') || '; ' || sqlerrm);
    exception when others then
        null;
    end;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 5. PROBE THE REPAIRED TRIGGER (both search paths must be SUCCESS)
-- ------------------------------------------------------------------------------
call public.probe_signup('probe_after_path_public', 'public');
call public.probe_signup('probe_after_path_empty',   '');

-- ------------------------------------------------------------------------------
-- 6. CLEAN UP THE PROBE PROCEDURE + REPORT
-- ------------------------------------------------------------------------------
drop procedure if exists public.probe_signup(text, text);

select kind, detail, recorded_at
  from public.signup_debug
 order by recorded_at desc
 limit 25;

select pg_catalog.pg_get_triggerdef(t.oid) as trigger_ddl
  from pg_catalog.pg_trigger t
 where t.tgrelid = 'auth.users'::pg_catalog.regclass
   and not t.tgisinternal;

-- make PostgREST pick up the new table straight away
notify pgrst, 'reload schema';
