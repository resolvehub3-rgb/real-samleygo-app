-- =====================================================================
-- SamleyGo — courier location RLS — database checks
--
-- Run this in the Supabase SQL editor (or `psql -f`) against ANY database,
-- including production: every statement runs inside a transaction that is
-- rolled back at the end, so nothing is committed and no data is touched.
--
-- A check reports PASS through a NOTICE. The only way this file can fail is
-- by raising an exception that starts with "FAIL —", which means a rule from
-- supabase/migrations/20261011_courier_location_rls.sql is broken.
--
-- What is being protected:
--   * `public.couriers.current_latitude` / `current_longitude` are a rider's
--     live position. Only the rider, a super admin, and the participants of
--     an order that rider is assigned to may read them.
--   * The restaurant dispatch screens ("Assign driver", "food is ready")
--     need a rider *directory* — never a rider *location*.
--
-- Client-level coverage (voice stays courier-only, the chrome never drives
-- the engine, source scans) lives in scripts/navigation_state.test.ts —
-- run `npm test`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The blanket policy must be gone.
-- ---------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'couriers'
          and qual = 'true'
    ) then
        raise exception 'FAIL — a blanket using (true) policy still exists on public.couriers';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'couriers'
          and cmd = 'SELECT'
          and qual like '%courier_order_participant%'
    ) then
        raise exception 'FAIL — the couriers SELECT policy no longer routes through courier_order_participant()';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'couriers'
          and cmd = 'SELECT'
          and qual like '%auth.uid() = id%'
    ) then
        raise exception 'FAIL — a courier can no longer read their own row';
    end if;

    raise notice 'PASS 1 — couriers SELECT is participant-only, no blanket policy remains';
end $$;

-- ---------------------------------------------------------------------
-- 2. Anonymous callers never see a coordinate column.
-- ---------------------------------------------------------------------
do $$
declare
    v_count integer;
begin
    select count(*)
      into v_count
      from information_schema.column_privileges
     where grantee = 'anon'
       and table_schema = 'public'
       and table_name = 'couriers'
       and column_name in ('current_latitude', 'current_longitude', 'last_seen_at')
       and privilege_type = 'SELECT';

    if v_count <> 0 then
        raise exception 'FAIL — anon still has % privileged courier column(s)', v_count;
    end if;

    raise notice 'PASS 2 — anon has no courier coordinates';
end $$;

-- ---------------------------------------------------------------------
-- 3. courier_order_participant(): SECURITY DEFINER (no orders⇄couriers
--    recursion) and false for a caller who is on no order.
-- ---------------------------------------------------------------------
do $$
declare
    v_prosecdef boolean;
    v_orphan uuid := gen_random_uuid();
    v_result boolean;
begin
    select prosecdef into v_prosecdef
      from pg_proc
     where oid = to_regprocedure('public.courier_order_participant(uuid)');

    if v_prosecdef is distinct from true then
        raise exception 'FAIL — courier_order_participant() must be SECURITY DEFINER (orders/couriers policies would recurse)';
    end if;

    -- Anonymous caller: auth.uid() is null → never a participant.
    set local role anon;
    set local request.jwt.claim.sub = '';
    set local request.jwt.claims = '{}';
    v_result := public.courier_order_participant(v_orphan);
    reset role;

    if v_result is distinct from false then
        raise exception 'FAIL — anon was treated as an order participant (got %)', v_result;
    end if;

    raise notice 'PASS 3 — participant helper is SECURITY DEFINER and rejects anon';
end $$;

-- ---------------------------------------------------------------------
-- 4. courier_driver_directory(): SECURITY DEFINER, callable only by a
--    restaurant owner / super admin, and it carries no location columns.
-- ---------------------------------------------------------------------
do $$
declare
    v_prosecdef boolean;
    v_columns text;
    v_rows integer;
    v_orphan uuid := gen_random_uuid();
begin
    select prosecdef into v_prosecdef
      from pg_proc
     where oid = to_regprocedure('public.courier_driver_directory(boolean,boolean,integer)');

    if v_prosecdef is distinct from true then
        raise exception 'FAIL — courier_driver_directory() must be SECURITY DEFINER (it would return nothing)';
    end if;

    select string_agg(a.attname, ',' order by a.attnum)
      into v_columns
      from pg_proc p
      cross join lateral unnest(p.proargnames) with ordinality as u(argname, ord)
      join pg_attribute a on a.attrelid = p.prorettype and a.attname = u.argname
     where p.oid = to_regprocedure('public.courier_driver_directory(boolean,boolean,integer)');

    if v_columns is null or v_columns like '%latitude%' or v_columns like '%longitude%'
       or v_columns like '%verification%' then
        raise exception 'FAIL — the rider directory exposes location/verification columns: %', v_columns;
    end if;

    -- Anonymous caller: either the function is not executable for them at all
    -- (revoked below) or it must hand back zero rows — never a rider roster.
    set local role anon;
    set local request.jwt.claim.sub = '';
    set local request.jwt.claims = '{}';
    begin
        select count(*) into v_rows from public.courier_driver_directory(false, false, 50);
    exception
        when insufficient_privilege then
            v_rows := 0; -- revoked from anon: equally safe, just louder
    end;
    reset role;

    if v_rows <> 0 then
        raise exception 'FAIL — anon enumerated % rider(s) from the directory', v_rows;
    end if;

    raise notice 'PASS 4 — rider directory is SECURITY DEFINER, location-free and empty for anon';
end $$;

-- ---------------------------------------------------------------------
-- 5. The restaurant dispatch screens keep working: the two RPCs the
--    dashboard calls still exist with the argument names it passes.
-- ---------------------------------------------------------------------
do $$
begin
    if to_regprocedure('public.courier_driver_directory(boolean,boolean,integer)') is null then
        raise exception 'FAIL — RestaurantDashboard''s rider-directory RPC is missing';
    end if;

    if not exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'courier_driver_directory'
           and p.proargnames[1] = 'p_only_online'
           and p.proargnames[2] = 'p_only_approved'
           and p.proargnames[3] = 'p_limit'
    ) then
        raise exception 'FAIL — courier_driver_directory() parameter names changed (the dashboard passes them by name)';
    end if;

    raise notice 'PASS 5 — the restaurant rider-directory RPC matches the client call';
end $$;

rollback;
