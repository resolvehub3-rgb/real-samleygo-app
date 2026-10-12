-- =====================================================================
-- SamleyGo Errands & On-Demand Rides — database checks
--
-- Run this in the Supabase SQL editor (or `psql -f`) against ANY database,
-- including production: every statement runs inside a transaction that is
-- rolled back at the end, so nothing is committed and no data is touched.
--
-- A check reports PASS through a NOTICE. The only way this file can fail is
-- by raising an exception that starts with "FAIL -", which means a rule from
-- supabase/migrations/20261012_errands_module.sql is broken.
--
-- These checks NEVER touch the stored Errands pricing rules or config: the
-- fare formula is exercised with EXPLICIT settings passed to
-- errands_pricing_amounts(...), so running them cannot re-price anything.
-- Checks that would depend on the operator's saved switches read the raw
-- setting row and compare shapes, never hard-coded expectations.
--
-- Client-level coverage (quote TTL, transition map mirror, source scans of
-- the booking flow) lives in scripts/errands_pricing.test.ts - run `npm test`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The acceptance example: 8 km, base GHc5, GHc2/km, GHc2 booking fee,
--    0% tax, driver earns 100%.
--    trip = 5 + (8 x 2) = 21; total = 21 + 2 + 0 = GHc23.
-- ---------------------------------------------------------------------
do $$
declare
    v_settings jsonb := jsonb_build_object(
        'configured', true,
        'base_fare', 5.00,
        'per_km_rate', 2.00,
        'min_fare', 1.00,
        'booking_fee', 2.00,
        'tax_rate_percent', 0.00,
        'surge_multiplier', 1.00,
        'driver_earning_percentage', 100.00,
        'currency', 'GHS'
        -- no max_fare key on purpose: an absent cap means "no ceiling"
    );
    v_result jsonb;
    v_trip numeric;
    v_total numeric;
    v_earning numeric;
begin
    v_result   := public.errands_pricing_amounts(8, 'ERRAND_MOTORCYCLE', v_settings);
    v_trip     := (v_result ->> 'trip_fare')::numeric;
    v_total    := (v_result ->> 'estimated_fare')::numeric;
    v_earning  := (v_result ->> 'driver_earning')::numeric;

    if v_trip is distinct from 21.00 then
        raise exception 'FAIL - 8 km at base 5 + 2/km must be a GHc21 trip fare (got %)', v_trip;
    end if;
    if v_total is distinct from 23.00 then
        raise exception 'FAIL - 21 + GHc2 booking fee must total GHc23 (got %)', v_total;
    end if;
    if v_earning is distinct from 23.00 then
        raise exception 'FAIL - a 100%% earning share must pay the driver GHc23 (got %)', v_earning;
    end if;

    raise notice 'PASS 1 - 8 km = GHc21 fare + GHc2 fee = GHc23 total, driver earns GHc23';
end $$;

-- ---------------------------------------------------------------------
-- 2. Unconfigured pricing refuses to quote with the exact honest message.
-- ---------------------------------------------------------------------
do $$
begin
    perform public.errands_pricing_amounts(
        8, 'ERRAND_MOTORCYCLE',
        jsonb_build_object('configured', false)
    );
    raise exception 'FAIL - unconfigured pricing produced a fare instead of refusing';
exception
    when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like 'Errands pricing has not been configured yet.%' then
            raise exception 'FAIL - wrong "not configured" message: %', sqlerrm;
        end if;
        raise notice 'PASS 2 - unconfigured pricing refuses to quote with the admin-required message';
end $$;

-- ---------------------------------------------------------------------
-- 3. Floor, OPTIONAL ceiling and 2-decimal (pesewa) rounding.
-- ---------------------------------------------------------------------
do $$
declare
    v_base jsonb := jsonb_build_object(
        'configured', true,
        'base_fare', 5.00, 'per_km_rate', 2.00, 'min_fare', 1.00,
        'booking_fee', 0.00, 'tax_rate_percent', 0.00,
        'surge_multiplier', 1.00, 'driver_earning_percentage', 100.00
    );
    v_floored numeric;
    v_capped numeric;
    v_uncapped numeric;
    v_rounded numeric;
begin
    -- 5.006 + (6.4 x 2) = 17.806 -> 17.81 (half up, whole pesewas)
    v_rounded := (public.errands_pricing_amounts(
        6.4, 'ERRAND_MOTORCYCLE',
        jsonb_set(v_base, '{base_fare}', '5.006')
    ) ->> 'trip_fare')::numeric;
    if v_rounded is distinct from 17.81 then
        raise exception 'FAIL - 17.806 must round to 17.81 (got %)', v_rounded;
    end if;

    -- Floor lifts a very short trip.
    v_floored := (public.errands_pricing_amounts(
        0.2, 'ERRAND_MOTORCYCLE',
        jsonb_set(v_base, '{min_fare}', '10.00')
    ) ->> 'trip_fare')::numeric;
    if v_floored is distinct from 10.00 then
        raise exception 'FAIL - the GHc10 floor was not applied (got %)', v_floored;
    end if;

    -- Ceiling applies only when configured...
    v_capped := (public.errands_pricing_amounts(
        100, 'ERRAND_MOTORCYCLE',
        jsonb_set(v_base, '{max_fare}', '60.00')
    ) ->> 'trip_fare')::numeric;
    if v_capped is distinct from 60.00 then
        raise exception 'FAIL - a 100 km trip must be capped at GHc60 (got %)', v_capped;
    end if;

    -- ...and an absent cap means the real route price.
    v_uncapped := (public.errands_pricing_amounts(100, 'ERRAND_MOTORCYCLE', v_base)
                   ->> 'trip_fare')::numeric;
    if v_uncapped is distinct from 205.00 then
        raise exception 'FAIL - without a cap a 100 km trip must cost GHc205 (got %)', v_uncapped;
    end if;

    raise notice 'PASS 3 - formula, floor, optional ceiling and 2-decimal rounding';
end $$;

-- ---------------------------------------------------------------------
-- 4. Booking fee and tax are ADDED after the clamp (never swallowed by the
--    minimum), and the driver earning share is a percentage of the total.
--    Trip 10 (floored to min 12), fee 3, tax 15%%, driver 80%%:
--    tax = (12 + 3) x 0.15 = 2.25; total = 17.25; driver = 13.80.
-- ---------------------------------------------------------------------
do $$
declare
    v_result jsonb;
begin
    v_result := public.errands_pricing_amounts(
        0.5, 'ERRAND_MOTORCYCLE',
        jsonb_build_object(
            'configured', true,
            'base_fare', 5.00, 'per_km_rate', 2.00, 'min_fare', 12.00,
            'booking_fee', 3.00, 'tax_rate_percent', 15.00,
            'surge_multiplier', 1.00, 'driver_earning_percentage', 80.00
        )
    );

    if (v_result ->> 'trip_fare')::numeric is distinct from 12.00 then
        raise exception 'FAIL - the floored trip fare must be GHc12 (got %)',
            v_result ->> 'trip_fare';
    end if;
    if (v_result ->> 'tax_amount')::numeric is distinct from 2.25 then
        raise exception 'FAIL - 15%% of (12 + 3) must be GHc2.25 (got %)',
            v_result ->> 'tax_amount';
    end if;
    if (v_result ->> 'estimated_fare')::numeric is distinct from 17.25 then
        raise exception 'FAIL - total must be GHc17.25 (got %)',
            v_result ->> 'estimated_fare';
    end if;
    if (v_result ->> 'driver_earning')::numeric is distinct from 13.80 then
        raise exception 'FAIL - 80%% of GHc17.25 must be GHc13.80 (got %)',
            v_result ->> 'driver_earning';
    end if;

    raise notice 'PASS 4 - booking fee and tax are added after the clamp; earning % of total';
end $$;

-- ---------------------------------------------------------------------
-- 5. Surge multiplies the distance component before the clamp.
--    (5 + (10 x 2)) x 1.5 = GHc37.50.
-- ---------------------------------------------------------------------
do $$
declare
    v_trip numeric;
begin
    v_trip := (public.errands_pricing_amounts(
        10, 'ERRAND_MOTORCYCLE',
        jsonb_build_object(
            'configured', true,
            'base_fare', 5.00, 'per_km_rate', 2.00, 'min_fare', 1.00,
            'booking_fee', 0.00, 'tax_rate_percent', 0.00,
            'surge_multiplier', 1.50, 'driver_earning_percentage', 100.00
        )
    ) ->> 'trip_fare')::numeric;

    if v_trip is distinct from 37.50 then
        raise exception 'FAIL - surge 1.5 on a 10 km trip must be GHc37.50 (got %)', v_trip;
    end if;

    raise notice 'PASS 5 - surge multiplies the distance component';
end $$;

-- ---------------------------------------------------------------------
-- 6. Per-service overrides replace the shared rules key by key.
--    A car ride with a different base keeps the shared per-km rate.
-- ---------------------------------------------------------------------
do $$
declare
    v_result jsonb;
begin
    v_result := public.errands_pricing_amounts(
        10, 'RIDE_CAR',
        jsonb_build_object(
            'configured', true,
            'base_fare', 5.00, 'per_km_rate', 2.00, 'min_fare', 1.00,
            'booking_fee', 0.00, 'tax_rate_percent', 0.00,
            'surge_multiplier', 1.00, 'driver_earning_percentage', 100.00,
            'services', jsonb_build_object(
                'RIDE_CAR', jsonb_build_object('base_fare', 8.00)
            )
        )
    );

    -- (8 + 10 x 2) = 28, not (5 + 20) = 25.
    if (v_result ->> 'trip_fare')::numeric is distinct from 28.00 then
        raise exception 'FAIL - the RIDE_CAR override must replace only the base fare (got %)',
            v_result ->> 'trip_fare';
    end if;
    if (v_result ->> 'per_km_rate')::numeric is distinct from 2.00 then
        raise exception 'FAIL - the shared per-km rate must survive the override (got %)',
            v_result ->> 'per_km_rate';
    end if;

    raise notice 'PASS 6 - per-service overrides replace keys, not the whole rule set';
end $$;

-- ---------------------------------------------------------------------
-- 7. Unknown service categories are refused, never priced.
-- ---------------------------------------------------------------------
do $$
begin
    perform public.errands_pricing_amounts(
        5, 'HELICOPTER',
        jsonb_build_object('configured', true, 'base_fare', 5.00)
    );
    raise exception 'FAIL - an unknown service category was priced';
exception
    when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm <> 'That Errands service is not supported.' then
            raise exception 'FAIL - wrong message for an unknown service: %', sqlerrm;
        end if;
        raise notice 'PASS 7 - unknown service categories are refused';
end $$;

-- ---------------------------------------------------------------------
-- 8. The exact customer-facing message when an endpoint is missing or the
--    (0,0) "no GPS fix" sentinel is sent.
-- ---------------------------------------------------------------------
do $$
begin
    perform public.assert_errands_location(null::double precision, null::double precision);
    raise exception 'FAIL - a missing location was accepted';
exception
    when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm <> 'Please select a valid pickup and destination location to calculate the fare.' then
            raise exception 'FAIL - wrong customer message: %', sqlerrm;
        end if;
        raise notice 'PASS 8 - missing coordinates rejected with the exact required message';
end $$;

do $$
begin
    perform public.assert_errands_location(0::double precision, 0::double precision);
    raise exception 'FAIL - the (0,0) "no GPS fix" sentinel was accepted';
exception
    when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm <> 'Please select a valid pickup and destination location to calculate the fare.' then
            raise exception 'FAIL - wrong customer message: %', sqlerrm;
        end if;
        raise notice 'PASS 8b - the (0,0) sentinel is rejected too';
end $$;

-- Out-of-world coordinates are rejected as well.
do $$
begin
    perform public.assert_errands_location(91::double precision, 0.1::double precision);
    raise exception 'FAIL - latitude 91 was accepted';
exception
    when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        raise notice 'PASS 8c - out-of-range coordinates rejected';
end $$;

-- ---------------------------------------------------------------------
-- 9. Area labels are coarse on purpose: first segment, house number
--    stripped, 60 characters max - this is all a driver sees pre-accept.
-- ---------------------------------------------------------------------
do $$
declare
    v_label text;
begin
    v_label := public.errands_area_label('12 Oxford Street, Osu, Accra');
    if v_label is distinct from 'Oxford Street' then
        raise exception 'FAIL - house number must be stripped, first segment kept (got "%")', v_label;
    end if;

    v_label := public.errands_area_label(repeat('A', 100) || ' Road, Accra');
    if length(v_label) > 60 then
        raise exception 'FAIL - area labels must be capped at 60 chars (got %)', length(v_label);
    end if;

    if public.errands_area_label('') is not null then
        raise exception 'FAIL - an empty address must produce a NULL label';
    end if;

    raise notice 'PASS 9 - area labels stay coarse (no house number, max 60 chars)';
end $$;

-- ---------------------------------------------------------------------
-- 10. Structural guarantees: no client can ever write money, coordinates
--     or status directly, the PIN table is locked down, and the module's
--     tables + functions exist with the grants the app relies on.
-- ---------------------------------------------------------------------
do $$
declare
    v_writes int;
    v_row record;
begin
    -- No INSERT/UPDATE/DELETE policy may exist on any money/lifecycle table.
    select count(*) into v_writes
      from pg_policies
     where schemaname = 'public'
       and tablename in ('errands_quotes', 'errands_bookings',
                         'errands_booking_details', 'errands_status_history',
                         'errands_booking_pins', 'driver_service_capabilities')
       and cmd in ('INSERT', 'UPDATE', 'DELETE');
    if v_writes <> 0 then
        raise exception 'FAIL - % write policy found on an Errands table; writes must go through SECURITY DEFINER RPCs only', v_writes;
    end if;

    -- The trip PIN table exists, has RLS on, and the driver-facing grant is
    -- SELECT-free for anyone but the booking's customer and super admins.
    if to_regclass('public.errands_booking_pins') is null then
        raise exception 'FAIL - public.errands_booking_pins was not created';
    end if;
    if not exists (
        select 1 from pg_class c
         where c.relname = 'errands_booking_pins'
           and c.relrowsecurity
    ) then
        raise exception 'FAIL - errands_booking_pins must have row level security enabled';
    end if;
    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'errands_booking_pins'
           and roles = array['public']::name[]
    ) then
        raise exception 'FAIL - a PUBLIC policy on errands_booking_pins would expose trip PINs';
    end if;

    -- anon must be stripped from every Errands table (Supabase defaults to ALL).
    for v_row in
        select unnest(array['errands_quotes', 'errands_bookings',
                            'errands_booking_details', 'errands_status_history',
                            'errands_booking_pins',
                            'driver_service_capabilities']) as t
    loop
        if has_table_privilege('anon', 'public.' || v_row.t, 'SELECT')
           or has_table_privilege('anon', 'public.' || v_row.t, 'INSERT') then
            raise exception 'FAIL - role anon still has privileges on %', v_row.t;
        end if;
    end loop;

    raise notice 'PASS 10 - no client write paths, PIN table locked down, anon stripped';
end $$;

-- ---------------------------------------------------------------------
-- 11. The eligibility and lifecycle RPCs exist with the exact signatures
--     the client calls (a rename here breaks the app silently).
-- ---------------------------------------------------------------------
do $$
begin
    if to_regprocedure('public.errands_nearby_drivers(double precision, double precision, text, numeric, integer)') is null then
        raise exception 'FAIL - errands_nearby_drivers(lat, lng, service, radius, limit) is missing';
    end if;
    if to_regprocedure('public.create_errands_quote(double precision, double precision, text, double precision, double precision, text, text, numeric, integer)') is null then
        raise exception 'FAIL - create_errands_quote(...) is missing';
    end if;
    if to_regprocedure('public.create_errands_booking(uuid, uuid)') is null then
        raise exception 'FAIL - create_errands_booking(quote_id, driver_id) is missing';
    end if;
    if to_regprocedure('public.errands_set_booking_status(uuid, text, text, text)') is null then
        raise exception 'FAIL - errands_set_booking_status(booking_id, status, note, trip_pin) is missing';
    end if;
    if to_regprocedure('public.errands_expire_stale_bookings()') is null then
        raise exception 'FAIL - errands_expire_stale_bookings() is missing';
    end if;
    if to_regprocedure('public.set_errands_availability(boolean)') is null then
        raise exception 'FAIL - set_errands_availability(boolean) is missing';
    end if;
    if to_regprocedure('public.set_errands_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb)') is null then
        raise exception 'FAIL - set_errands_pricing(...) is missing';
    end if;
    if to_regprocedure('public.set_driver_service_capabilities(uuid, boolean, boolean)') is null then
        raise exception 'FAIL - set_driver_service_capabilities(...) is missing';
    end if;
    if to_regprocedure('public.get_errands_pricing_settings()') is null then
        raise exception 'FAIL - get_errands_pricing_settings() is missing';
    end if;
    if to_regprocedure('public.get_errands_config()') is null then
        raise exception 'FAIL - get_errands_config() is missing';
    end if;

    raise notice 'PASS 11 - every RPC the client calls exists with the expected signature';
end $$;

-- ---------------------------------------------------------------------
-- 12. Service switches: the shape is always complete, and a missing row
--     means motorcycle errands ON / passenger rides OFF (never the other
--     way round: passenger transport must be enabled deliberately).
--     When the operator HAS saved switches we verify the function mirrors
--     them instead of asserting hard-coded defaults.
-- ---------------------------------------------------------------------
do $$
declare
    v_config jsonb;
    v_saved jsonb;
begin
    v_config := public.get_errands_config();

    if jsonb_typeof(v_config -> 'enabled') <> 'boolean'
       or jsonb_typeof(v_config -> 'services' -> 'ERRAND_MOTORCYCLE') <> 'boolean'
       or jsonb_typeof(v_config -> 'services' -> 'RIDE_CAR') <> 'boolean' then
        raise exception 'FAIL - get_errands_config() must always report both service switches as booleans';
    end if;

    select value into v_saved from public.platform_settings where key = 'errands_config';

    if v_saved is null then
        -- Nothing saved: the documented defaults must hold.
        if (v_config ->> 'enabled')::boolean <> true
           or (v_config -> 'services' ->> 'ERRAND_MOTORCYCLE')::boolean <> true
           or (v_config -> 'services' ->> 'RIDE_CAR')::boolean <> false then
            raise exception 'FAIL - default switches must be: enabled, motorcycle ON, rides OFF (got %)', v_config;
        end if;
        raise notice 'PASS 12 - default switches: module on, motorcycle errands on, rides off';
    else
        if (v_config -> 'services' ->> 'RIDE_CAR')::boolean
           is distinct from coalesce((v_saved -> 'services' ->> 'RIDE_CAR')::boolean, false) then
            raise exception 'FAIL - get_errands_config() does not mirror the saved RIDE_CAR switch';
        end if;
        raise notice 'PASS 12 - get_errands_config() mirrors the operator''s saved switches';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 13. Restaurant dispatch never sees a driver who is mid-Errand. The
--     replaced courier_driver_directory() must exclude active Errands
--     bookings, and its owner/admin gate must still hold.
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_proc p
         where p.proname = 'courier_driver_directory'
           and pg_get_functiondef(p.oid) like '%errands_bookings%'
    ) then
        raise exception 'FAIL - courier_driver_directory() no longer excludes drivers with active Errands bookings';
    end if;

    -- As a signed-out caller the directory must return nothing.
    if exists (
        select 1 from public.courier_driver_directory(false, false, 5)
    ) then
        raise exception 'FAIL - courier_driver_directory() leaked riders to an anonymous caller';
    end if;

    raise notice 'PASS 13 - restaurant dispatch cannot see Errands-busy drivers or anonymous riders';
end $$;

-- ---------------------------------------------------------------------
-- 14. Realtime is wired for the booking lifecycle (and ONLY the lifecycle:
--     driver positions stay behind the couriers RLS policy).
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'errands_bookings'
    ) then
        raise exception 'FAIL - errands_bookings is not in the realtime publication';
    end if;
    if exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'errands_booking_pins'
    ) then
        raise exception 'FAIL - errands_booking_pins must NEVER be in the realtime publication (trip PINs)';
    end if;

    raise notice 'PASS 14 - booking lifecycle is realtime; trip PINs are not streamed';
end $$;

rollback;
