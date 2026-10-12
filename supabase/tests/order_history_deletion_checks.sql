-- =====================================================================
-- SamleyGo — customer-managed order history (soft delete) — database checks
--
-- Run this in the Supabase SQL editor (or `psql -f`) AFTER
-- 20261012_order_history_deletion.sql. Every statement runs inside a
-- transaction that is rolled back at the end: nothing is committed, no
-- history is really removed, no pricing or money is touched.
--
-- A check reports PASS through a NOTICE. The only way this file can fail
-- is by raising an exception that starts with "FAIL -", which means a
-- rule from the migration is broken. Behaviour checks that need a real
-- order or booking announce SKIP on an empty database instead of
-- inventing rows for a scenario they cannot honestly reproduce.
--
-- Client-level coverage (Orders UI wiring, the two-step confirm, source
-- scans of the RPC calls and the FAB animation) lives in
-- scripts/errands_pricing.test.ts — run `npm test`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The soft-delete column exists on both history tables.
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'orders'
           and column_name = 'customer_deleted_at'
    ) then
        raise exception 'FAIL - orders.customer_deleted_at is missing';
    end if;
    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'errands_bookings'
           and column_name = 'customer_deleted_at'
    ) then
        raise exception 'FAIL - errands_bookings.customer_deleted_at is missing';
    end if;
    raise notice 'PASS 1 - both history tables carry customer_deleted_at';
end $$;

-- ---------------------------------------------------------------------
-- 2. Orders RLS: the CUSTOMER branch hides removed rows; the courier,
--    restaurant and Super Admin branches are untouched.
-- ---------------------------------------------------------------------
do $$
declare v_qual text;
begin
    select qual into v_qual
      from pg_policies
     where schemaname = 'public' and tablename = 'orders'
       and policyname = 'Users can view their related orders';

    if v_qual is null then
        raise exception 'FAIL - the orders SELECT policy is missing';
    end if;
    if v_qual not ilike '%customer_id and customer_deleted_at is null%' then
        raise exception 'FAIL - a customer can still see their removed orders';
    end if;
    if v_qual not ilike '%auth.uid() = courier_id%' then
        raise exception 'FAIL - the courier branch of the orders policy was lost';
    end if;
    if v_qual not ilike '%role = ''SUPER_ADMIN''%' then
        raise exception 'FAIL - the Super Admin branch of the orders policy was lost';
    end if;
    raise notice 'PASS 2 - only the customer stops seeing a removed order';
end $$;

-- ---------------------------------------------------------------------
-- 3. Errands RLS: the CUSTOMER branch hides removed trips; the driver
--    and Super Admin branches are untouched.
-- ---------------------------------------------------------------------
do $$
declare v_qual text;
begin
    select qual into v_qual
      from pg_policies
     where schemaname = 'public' and tablename = 'errands_bookings'
       and policyname = 'Errands bookings are visible to their participants';

    if v_qual is null then
        raise exception 'FAIL - the errands_bookings SELECT policy is missing';
    end if;
    if v_qual not ilike '%customer_id and customer_deleted_at is null%' then
        raise exception 'FAIL - a customer can still see their removed trips';
    end if;
    if v_qual not ilike '%driver_id = auth.uid()%' then
        raise exception 'FAIL - the driver must keep seeing their own trips';
    end if;
    if v_qual not ilike '%role = ''SUPER_ADMIN''%' then
        raise exception 'FAIL - the Super Admin branch of the errands policy was lost';
    end if;
    raise notice 'PASS 3 - only the customer stops seeing a removed trip; driver and admin keep theirs';
end $$;

-- ---------------------------------------------------------------------
-- 4. No write policy was granted: removal stays behind the two
--    SECURITY DEFINER RPCs (the errands money table stays locked).
-- ---------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from pg_policies
         where schemaname = 'public'
           and tablename in ('orders', 'errands_bookings')
           and cmd = 'DELETE'
    ) then
        raise exception 'FAIL - a DELETE policy was granted; removal must stay behind the guarded RPCs';
    end if;
    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'errands_bookings'
           and cmd in ('INSERT', 'UPDATE')
    ) then
        raise exception 'FAIL - the errands money table gained a write policy';
    end if;
    raise notice 'PASS 4 - no write policy: only the guarded RPCs can hide a row';
end $$;

-- ---------------------------------------------------------------------
-- 5. Both RPCs exist, are SECURITY DEFINER, own the row, only flip the
--    flag, and refuse anything that is not terminal.
-- ---------------------------------------------------------------------
do $$
declare
    v_order_def text;
    v_errand_def text;
begin
    if to_regprocedure('public.delete_customer_order(uuid)') is null then
        raise exception 'FAIL - delete_customer_order(uuid) is missing';
    end if;
    if to_regprocedure('public.delete_customer_errands_booking(uuid)') is null then
        raise exception 'FAIL - delete_customer_errands_booking(uuid) is missing';
    end if;

    if not exists (
        select 1 from pg_proc
         where oid = to_regprocedure('public.delete_customer_order(uuid)')
           and prosecdef
    ) then
        raise exception 'FAIL - delete_customer_order() must be SECURITY DEFINER (no write policy exists)';
    end if;
    if not exists (
        select 1 from pg_proc
         where oid = to_regprocedure('public.delete_customer_errands_booking(uuid)')
           and prosecdef
    ) then
        raise exception 'FAIL - delete_customer_errands_booking() must be SECURITY DEFINER (no write policy exists)';
    end if;

    select pg_get_functiondef(p.oid) into v_order_def
      from pg_proc p where p.oid = to_regprocedure('public.delete_customer_order(uuid)');
    select pg_get_functiondef(p.oid) into v_errand_def
      from pg_proc p where p.oid = to_regprocedure('public.delete_customer_errands_booking(uuid)');

    if v_order_def not ilike '%customer_id = auth.uid()%'
       or v_order_def not ilike '%set customer_deleted_at = now()%' then
        raise exception 'FAIL - delete_customer_order() must own the row and only hide it';
    end if;
    if v_order_def not ilike '%''DELIVERED'', ''COMPLETED'', ''CANCELLED'', ''REJECTED'', ''FAILED''%' then
        raise exception 'FAIL - delete_customer_order() lost its finished/cancelled-only guard';
    end if;
    if v_errand_def not ilike '%customer_id = auth.uid()%'
       or v_errand_def not ilike '%set customer_deleted_at = now()%' then
        raise exception 'FAIL - delete_customer_errands_booking() must own the row and only hide it';
    end if;
    if v_errand_def not ilike '%''COMPLETED'', ''CANCELLED'', ''EXPIRED'', ''FAILED''%' then
        raise exception 'FAIL - delete_customer_errands_booking() lost its terminal-only guard';
    end if;
    if v_order_def ilike '%set status%' or v_errand_def ilike '%set status%' then
        raise exception 'FAIL - the removal RPCs must never rewrite status';
    end if;

    raise notice 'PASS 5 - both RPCs are SECURITY DEFINER, owner-guarded and terminal-only';
end $$;

-- ---------------------------------------------------------------------
-- 6. Anonymous callers cannot execute either RPC; signed-in customers can.
-- ---------------------------------------------------------------------
do $$
begin
    if has_function_privilege('anon', 'public.delete_customer_order(uuid)', 'execute') then
        raise exception 'FAIL - anon must not execute delete_customer_order()';
    end if;
    if has_function_privilege('anon', 'public.delete_customer_errands_booking(uuid)', 'execute') then
        raise exception 'FAIL - anon must not execute delete_customer_errands_booking()';
    end if;
    if not has_function_privilege('authenticated', 'public.delete_customer_order(uuid)', 'execute')
       or not has_function_privilege('authenticated', 'public.delete_customer_errands_booking(uuid)', 'execute') then
        raise exception 'FAIL - authenticated customers must be able to execute both removal RPCs';
    end if;
    raise notice 'PASS 6 - anon has no execute; authenticated customers do';
end $$;

-- ---------------------------------------------------------------------
-- 7. Behaviour — a finished food order: hidden for its customer,
--    refused twice, invisible through RLS afterwards, and NOT ONE
--    other column (money included) may move. Then: an ACTIVE order
--    refuses outright.
-- ---------------------------------------------------------------------
do $$
declare
    v_order public.orders%rowtype;
    v_active public.orders%rowtype;
    v_before jsonb;
    v_after jsonb;
    v_claims text;
    v_seen integer;
begin
    select * into v_order
      from public.orders
     where customer_deleted_at is null
       and status in ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED')
     order by created_at desc
     limit 1;

    if not found then
        raise notice 'SKIP 7 - no finished/cancelled order in this database to remove';
    else
        select to_jsonb(v_order) - 'customer_deleted_at' into v_before;
        v_claims := json_build_object('sub', v_order.customer_id, 'role', 'authenticated')::text;
        perform set_config('request.jwt.claims', v_claims, true);
        set local role authenticated;

        -- The customer's own guarded RPC succeeds.
        perform public.delete_customer_order(v_order.id);

        -- ...and afterwards the row is invisible to them through RLS.
        select count(*) into v_seen from public.orders where id = v_order.id;
        if v_seen <> 0 then
            raise exception 'FAIL - a removed order is still visible to its customer';
        end if;

        -- A second attempt must refuse honestly, not pretend twice.
        begin
            perform public.delete_customer_order(v_order.id);
            raise exception 'FAIL - a hidden order accepted a second removal (it must refuse honestly)';
        exception when raise_exception then
            if sqlerrm like 'FAIL%' then
                raise;
            end if;
            if sqlerrm not like 'Only finished or cancelled orders%' then
                raise exception 'FAIL - the refusal message is wrong: %', sqlerrm;
            end if;
        end;

        reset role;
        perform set_config('request.jwt.claims', '', true);

        -- The row itself is intact: ONLY the flag may have moved.
        select to_jsonb(o) - 'customer_deleted_at' into v_after
          from public.orders o
         where id = v_order.id;
        if v_after is null then
            raise exception 'FAIL - the order row itself must never be hard-deleted';
        end if;
        if v_after is distinct from v_before then
            raise exception 'FAIL - hiding an order touched more than customer_deleted_at';
        end if;

        raise notice 'PASS 7 - a finished order is hidden for its customer, refuses twice, and its money is untouched';
    end if;

    -- Refusal path: an ACTIVE order can never disappear from tracking.
    select * into v_active
      from public.orders
     where customer_deleted_at is null
       and status not in ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED')
     order by created_at desc
     limit 1;

    if not found then
        raise notice 'SKIP 7b - no active order in this database to defend';
    else
        v_claims := json_build_object('sub', v_active.customer_id, 'role', 'authenticated')::text;
        perform set_config('request.jwt.claims', v_claims, true);
        set local role authenticated;
        begin
            perform public.delete_customer_order(v_active.id);
            raise exception 'FAIL - an active order was removable (it must stay trackable)';
        exception when raise_exception then
            if sqlerrm like 'FAIL%' then
                raise;
            end if;
            if sqlerrm not like 'Only finished or cancelled orders%' then
                raise exception 'FAIL - the active-order refusal is wrong: %', sqlerrm;
            end if;
        end;
        reset role;

        if exists (
            select 1 from public.orders
             where id = v_active.id and customer_deleted_at is not null
        ) then
            raise exception 'FAIL - an active order got hidden despite the refusal';
        end if;
        raise notice 'PASS 7b - an active order refuses removal and stays visible';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Behaviour — a terminal Errands trip: hidden for its customer
--    (refused twice), while THE DRIVER still sees their own trip and
--    not one other column (money included) moves. Then: an ACTIVE trip
--    refuses outright.
-- ---------------------------------------------------------------------
do $$
declare
    v_booking public.errands_bookings%rowtype;
    v_active public.errands_bookings%rowtype;
    v_before jsonb;
    v_after jsonb;
    v_claims text;
    v_seen integer;
begin
    select * into v_booking
      from public.errands_bookings
     where customer_deleted_at is null
       and status in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED')
     order by created_at desc
     limit 1;

    if not found then
        raise notice 'SKIP 8 - no terminal Errands booking in this database to remove';
    else
        select to_jsonb(v_booking) - 'customer_deleted_at' - 'updated_at' into v_before;
        v_claims := json_build_object('sub', v_booking.customer_id, 'role', 'authenticated')::text;
        perform set_config('request.jwt.claims', v_claims, true);
        set local role authenticated;

        perform public.delete_customer_errands_booking(v_booking.id);

        select count(*) into v_seen from public.errands_bookings where id = v_booking.id;
        if v_seen <> 0 then
            raise exception 'FAIL - a removed trip is still visible to its customer';
        end if;

        begin
            perform public.delete_customer_errands_booking(v_booking.id);
            raise exception 'FAIL - a hidden trip accepted a second removal (it must refuse honestly)';
        exception when raise_exception then
            if sqlerrm like 'FAIL%' then
                raise;
            end if;
            if sqlerrm not like 'Only completed, cancelled or expired trips%' then
                raise exception 'FAIL - the refusal message is wrong: %', sqlerrm;
            end if;
        end;

        reset role;
        perform set_config('request.jwt.claims', '', true);

        -- The driver keeps their own trip (and pay history) after the
        -- customer tidies their list.
        v_claims := json_build_object('sub', v_booking.driver_id, 'role', 'authenticated')::text;
        perform set_config('request.jwt.claims', v_claims, true);
        set local role authenticated;
        select count(*) into v_seen from public.errands_bookings where id = v_booking.id;
        if v_seen <> 1 then
            raise exception 'FAIL - the driver lost their own trip when the customer removed it';
        end if;
        reset role;
        perform set_config('request.jwt.claims', '', true);

        -- Only the flag moved (updated_at is bumped by design).
        select to_jsonb(b) - 'customer_deleted_at' - 'updated_at' into v_after
          from public.errands_bookings b
         where id = v_booking.id;
        if v_after is null then
            raise exception 'FAIL - the booking row itself must never be hard-deleted';
        end if;
        if v_after is distinct from v_before then
            raise exception 'FAIL - hiding a trip touched more than customer_deleted_at';
        end if;

        raise notice 'PASS 8 - a terminal trip is hidden for its customer, refuses twice, and the driver keeps theirs';
    end if;

    select * into v_active
      from public.errands_bookings
     where customer_deleted_at is null
       and status not in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED')
     order by created_at desc
     limit 1;

    if not found then
        raise notice 'SKIP 8b - no active Errands booking in this database to defend';
    else
        v_claims := json_build_object('sub', v_active.customer_id, 'role', 'authenticated')::text;
        perform set_config('request.jwt.claims', v_claims, true);
        set local role authenticated;
        begin
            perform public.delete_customer_errands_booking(v_active.id);
            raise exception 'FAIL - an active trip was removable (it must stay trackable)';
        exception when raise_exception then
            if sqlerrm like 'FAIL%' then
                raise;
            end if;
            if sqlerrm not like 'Only completed, cancelled or expired trips%' then
                raise exception 'FAIL - the active-trip refusal is wrong: %', sqlerrm;
            end if;
        end;
        reset role;

        if exists (
            select 1 from public.errands_bookings
             where id = v_active.id and customer_deleted_at is not null
        ) then
            raise exception 'FAIL - an active trip got hidden despite the refusal';
        end if;
        raise notice 'PASS 8b - an active Errands trip refuses removal and stays visible';
    end if;
end $$;

rollback;
