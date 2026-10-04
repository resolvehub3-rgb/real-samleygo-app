-- =====================================================================
-- SamleyGo distance-based delivery pricing — database checks
--
-- Run this in the Supabase SQL editor (or `psql -f`) against ANY database,
-- including production: every statement runs inside a transaction that is
-- rolled back at the end, so nothing is committed and no data is touched.
--
-- A check reports PASS through a NOTICE. The only way this file can fail is
-- by raising an exception that starts with "FAIL —", which means a rule from
-- supabase/migrations/20261005_distance_delivery_pricing.sql is broken.
--
-- These checks NEVER touch the stored delivery pricing rules: the formula is
-- exercised with explicit settings, so running them cannot re-price anything.
--
-- Client-level coverage (checkout totals, quote expiry, reporting, source
-- scans) lives in scripts/delivery_pricing.test.ts — run `npm test`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The acceptance example: 8 km, base GHc5, GHc2/km
--    fee = GHc21, courier earns GHc21 with 0% courier commission.
-- ---------------------------------------------------------------------
do $$
declare
    v_settings jsonb := jsonb_build_object(
        'base_fee', 5.00,
        'per_km_rate', 2.00,
        'min_fee', 1.00,
        'surge_multiplier', 1.00,
        'courier_earning_percentage', 100.00,
        'currency', 'GHS'
        -- no max_fee key on purpose: an absent cap means "no ceiling"
    );
    v_result jsonb;
    v_fee numeric;
    v_cour numeric;
    v_comm_pct numeric;
begin
    v_result  := public.delivery_pricing_amounts(8, v_settings);
    v_fee     := (v_result ->> 'delivery_fee')::numeric;
    v_cour    := (v_result ->> 'courier_earning')::numeric;
    v_comm_pct := (v_result ->> 'courier_commission_percentage')::numeric;

    if v_fee is distinct from 21.00 then
        raise exception 'FAIL — 8 km at base 5 + 2/km must cost GHc21 (got %)', v_fee;
    end if;
    if v_cour is distinct from 21.00 then
        raise exception 'FAIL — the courier must earn the whole fee (got %)', v_cour;
    end if;
    if v_comm_pct is distinct from 0.00 then
        raise exception 'FAIL — Phase 1 courier commission must be 0%% (got %)', v_comm_pct;
    end if;

    raise notice 'PASS 1 — 8 km = GHc21 delivery, GHc21 to the courier, 0%% courier commission';
end $$;

-- ---------------------------------------------------------------------
-- 2. Formula, optional cap, floor and 2-decimal rounding.
-- ---------------------------------------------------------------------
do $$
declare
    v_1780 numeric;
    v_rounded numeric;
    v_floored numeric;
    v_capped numeric;
    v_uncapped numeric;
    v_settings jsonb;
begin
    v_settings := jsonb_build_object('base_fee', 5.00, 'per_km_rate', 2.00,
                                     'min_fee', 1.00, 'surge_multiplier', 1.00,
                                     'courier_earning_percentage', 100.00);
    v_1780 := (public.delivery_pricing_amounts(6.4, v_settings) ->> 'delivery_fee')::numeric;
    if v_1780 is distinct from 17.80 then
        raise exception 'FAIL — 5 + (6.4 x 2) must be GHc17.80 (got %)', v_1780;
    end if;

    -- 5.006 + (6.4 x 2) = 17.806 -> 17.81 (half up, whole pesewas)
    v_settings := jsonb_set(v_settings, '{base_fee}', '5.006');
    v_rounded := (public.delivery_pricing_amounts(6.4, v_settings) ->> 'delivery_fee')::numeric;
    if v_rounded is distinct from 17.81 then
        raise exception 'FAIL — 17.806 must round to 17.81 (got %)', v_rounded;
    end if;

    -- Floor lifts a very short trip.
    v_settings := jsonb_build_object('base_fee', 5.00, 'per_km_rate', 2.00,
                                     'min_fee', 10.00, 'surge_multiplier', 1.00,
                                     'courier_earning_percentage', 100.00);
    v_floored := (public.delivery_pricing_amounts(0.2, v_settings) ->> 'delivery_fee')::numeric;
    if v_floored is distinct from 10.00 then
        raise exception 'FAIL — the GHc10 floor was not applied (got %)', v_floored;
    end if;

    -- Ceiling applies only when it is configured...
    v_settings := jsonb_set(v_settings, '{max_fee}', '60');
    v_capped := (public.delivery_pricing_amounts(100, v_settings) ->> 'delivery_fee')::numeric;
    if v_capped is distinct from 60.00 then
        raise exception 'FAIL — a 100 km trip must be capped at GHc60 (got %)', v_capped;
    end if;

    -- ...and an absent cap means the real route price.
    v_settings := v_settings - 'max_fee';
    v_uncapped := (public.delivery_pricing_amounts(100, v_settings) ->> 'delivery_fee')::numeric;
    if v_uncapped is distinct from 205.00 then
        raise exception 'FAIL — without a cap a 100 km trip must cost GHc205 (got %)', v_uncapped;
    end if;

    raise notice 'PASS 2 — formula, floor, optional cap and 2-decimal rounding';
end $$;

-- ---------------------------------------------------------------------
-- 3. Distance is measured (haversine), never invented, and prices the
--    same as the acceptance example.
-- ---------------------------------------------------------------------
do $$
declare
    v_dist numeric;
    v_fee numeric;
    v_expected numeric;
begin
    -- ~8 km due north of an Accra kitchen
    v_dist := public.haversine_km(5.6037, -0.187, 5.67565, -0.187);

    if v_dist is null or v_dist not between 7.95 and 8.05 then
        raise exception 'FAIL — two points 8 km apart measured as % km', v_dist;
    end if;
    if public.haversine_km(5.67565, -0.187, 5.6037, -0.187) is distinct from v_dist then
        raise exception 'FAIL — distance must not depend on direction';
    end if;

    -- calculate_delivery_fee_server() must price exactly the route it
    -- measured, using whatever rules the admin has configured (checked in
    -- section 5) — so this holds on any database, live ones included.
    v_fee      := public.calculate_delivery_fee_server(5.6037, -0.187, 5.67565, -0.187);
    v_expected := (public.delivery_pricing_amounts(round(v_dist, 2)) ->> 'delivery_fee')::numeric;

    if v_fee is distinct from v_expected then
        raise exception 'FAIL — server fee % disagrees with the formula %', v_fee, v_expected;
    end if;
    if v_fee is null or v_fee < 0 then
        raise exception 'FAIL — a measured route must produce a non-negative fee (got %)', v_fee;
    end if;

    raise notice 'PASS 3 — haversine measures restaurant -> customer (8 km) and the fee follows it (GHc%)',
        v_fee;
end $$;

-- ---------------------------------------------------------------------
-- 4. Delivery pricing and restaurant commission stay separate: the fee
--    moves with the distance, the commission only ever reads the food
--    subtotal (never the GHc121 customer total, never the GHc21 fee).
-- ---------------------------------------------------------------------
do $$
declare
    v_rate numeric;
    v_comm numeric;
    v_gross numeric;
    v_net numeric;
    v_cour numeric;
begin
    select commission_rate, commission_amount, restaurant_gross_amount,
           restaurant_net_amount, courier_earning
      into v_rate, v_comm, v_gross, v_net, v_cour
      from public.compute_order_financials(null::uuid, 100::numeric, 21::numeric);

    if v_gross is distinct from 100.00 then
        raise exception 'FAIL — restaurant gross must be the food subtotal (%)', v_gross;
    end if;
    if v_comm is distinct from round(100 * v_rate / 100, 2) then
        raise exception 'FAIL — commission must be % of the food (rate %, got %)',
            v_rate, v_rate, v_comm;
    end if;
    if v_net is distinct from v_gross - v_comm then
        raise exception 'FAIL — restaurant net must be gross minus commission (got %)', v_net;
    end if;
    if v_cour is distinct from 21.00 then
        raise exception 'FAIL — courier must earn the GHc21 fee (got %)', v_cour;
    end if;
    if v_rate > 0 then
        if v_comm = round(121 * v_rate / 100, 2) then
            raise exception 'FAIL — commission was taken on the GHc121 customer total';
        end if;
        if v_comm = round(21 * v_rate / 100, 2) then
            raise exception 'FAIL — commission was taken on the delivery fee';
        end if;
    end if;

    raise notice 'PASS 4 — GHc100 food / GHc21 delivery: commission % percent on food only, courier keeps GHc21',
        v_rate;
end $$;

-- ---------------------------------------------------------------------
-- 5. The stored pricing rules are usable (the admin form saves through
--    set_delivery_pricing(), which validates the same way).
-- ---------------------------------------------------------------------
do $$
declare
    v_s jsonb;
    v_base numeric;
    v_rate numeric;
    v_min numeric;
    v_max numeric;
    v_earning numeric;
    v_version numeric;
begin
    v_s := public.get_delivery_pricing_settings();

    v_base    := (v_s ->> 'base_fee')::numeric;
    v_rate    := (v_s ->> 'per_km_rate')::numeric;
    v_min     := (v_s ->> 'min_fee')::numeric;
    v_max     := (v_s ->> 'max_fee')::numeric;   -- null = no cap, which is legal
    v_earning := (v_s ->> 'courier_earning_percentage')::numeric;
    v_version := (v_s ->> 'pricing_version')::numeric;

    if v_base is null or v_base not between 0 and 9999.99 then
        raise exception 'FAIL — base fee out of range (%)', v_base;
    end if;
    if v_rate is null or v_rate not between 0 and 9999.99 then
        raise exception 'FAIL — per-km rate out of range (%)', v_rate;
    end if;
    if v_min is null or v_min not between 0 and 999999.99 then
        raise exception 'FAIL — minimum fee out of range (%)', v_min;
    end if;
    if v_max is not null and v_max < v_min then
        raise exception 'FAIL — cap (%) is below the floor (%)', v_max, v_min;
    end if;
    if v_earning is null or v_earning not between 0 and 100 then
        raise exception 'FAIL — courier earning percentage out of range (%)', v_earning;
    end if;
    if v_version is null or v_version < 1 then
        raise exception 'FAIL — pricing version must be at least 1 (%)', v_version;
    end if;

    raise notice 'PASS 5 — stored pricing valid: base %, rate %/km, floor %, cap %, courier earning %, version %',
        v_base, v_rate, v_min, coalesce(v_max::text, 'none'), v_earning, v_version;
end $$;

-- ---------------------------------------------------------------------
-- 6. Orders carry a numeric money snapshot + the distance/pricing version.
-- ---------------------------------------------------------------------
do $$
declare
    v_bad text;
begin
    select string_agg(column_name, ', ')
      into v_bad
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name in ('delivery_fee', 'courier_earning', 'delivery_distance_km')
       and data_type <> 'numeric';

    if v_bad is not null then
        raise exception 'FAIL — these order columns must be numeric: %', v_bad;
    end if;

    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'orders'
           and column_name in ('delivery_pricing_version', 'delivery_quote_id',
                               'delivery_distance_source')
    ) then
        raise exception 'FAIL — orders is missing its delivery snapshot columns';
    end if;

    raise notice 'PASS 6 — orders stores distance, fee, earning and pricing version as typed numbers';
end $$;

-- ---------------------------------------------------------------------
-- 7. Quote rows can only be created by the server: RLS on, SELECT-only
--    for authenticated clients, nothing for anonymous visitors, and no
--    INSERT / UPDATE / DELETE policy at all.
-- ---------------------------------------------------------------------
do $$
declare
    v_enabled boolean;
    v_writer text;
begin
    select c.relrowsecurity
      into v_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'delivery_quotes';

    if coalesce(v_enabled, false) = false then
        raise exception 'FAIL — row level security is not enabled on delivery_quotes';
    end if;

    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'delivery_quotes'
           and cmd in ('INSERT', 'UPDATE', 'DELETE')
    ) then
        raise exception 'FAIL — delivery_quotes must have no write policy';
    end if;

    select string_agg(cmd, ', ')
      into v_writer
      from pg_roles r
      cross join lateral (values
            ('INSERT', has_table_privilege(r.rolname, 'public.delivery_quotes', 'INSERT')),
            ('UPDATE', has_table_privilege(r.rolname, 'public.delivery_quotes', 'UPDATE')),
            ('DELETE', has_table_privilege(r.rolname, 'public.delivery_quotes', 'DELETE'))
         ) as p(cmd, allowed)
     where r.rolname in ('anon', 'authenticated')
       and p.allowed;

    if v_writer is not null then
        raise exception 'FAIL — anon/authenticated can still % delivery_quotes: %',
            v_writer, 'server-only table';
    end if;

    raise notice 'PASS 7 — delivery_quotes is RLS protected, SELECT only, server-written';
end $$;

-- ---------------------------------------------------------------------
-- 8. The pricing functions are not callable by clients, and quoting
--    requires a signed-in customer.
-- ---------------------------------------------------------------------
do $$
begin
    if to_regprocedure('public.delivery_pricing_amounts(numeric,jsonb)') is null then
        raise exception 'FAIL — delivery_pricing_amounts() is missing';
    end if;

    if exists (
        select 1 from pg_roles r
         where r.rolname in ('anon', 'authenticated')
           and has_function_privilege(r.rolname,
                 'public.delivery_pricing_amounts(numeric,jsonb)', 'execute')
    ) then
        raise exception 'FAIL — clients can call the pricing function directly';
    end if;

    if exists (
        select 1 from pg_roles r
         where r.rolname = 'anon'
           and has_function_privilege(r.rolname,
                 'public.get_delivery_pricing_settings()', 'execute')
    ) then
        raise exception 'FAIL — anonymous clients can read the pricing settings';
    end if;

    -- Quoting must refuse a sessionless caller before it measures anything.
    begin
        perform public.create_delivery_quote(null::uuid,
            5.6037::double precision, -0.187::double precision, null);
        raise exception 'FAIL — a signed-out caller was allowed to create a quote';
    exception
        when raise_exception then
            if sqlerrm like 'FAIL%' then raise; end if;
            if sqlerrm not like 'Sign in to get a delivery quote.%' then
                raise exception 'FAIL — expected the sign-in guard, got: %', sqlerrm;
            end if;
    end;

    raise notice 'PASS 8 — pricing functions are server-only and quoting needs a signed-in customer';
end $$;

-- ---------------------------------------------------------------------
-- 9. The exact customer-facing message when no valid location exists.
-- ---------------------------------------------------------------------
do $$
begin
    perform public.assert_delivery_location(null::double precision, null::double precision);
    raise exception 'FAIL — a missing delivery location was accepted';
exception
    when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm <> 'Please select a valid delivery location to calculate your delivery fee.' then
            raise exception 'FAIL — wrong customer message: %', sqlerrm;
        end if;
        raise notice 'PASS 9 — missing coordinates rejected with the exact required message';
end $$;

do $$
begin
    perform public.assert_delivery_location(0::double precision, 0::double precision);
    raise exception 'FAIL — the (0,0) "no GPS fix" sentinel was accepted';
exception
    when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm <> 'Please select a valid delivery location to calculate your delivery fee.' then
            raise exception 'FAIL — wrong customer message: %', sqlerrm;
        end if;
        raise notice 'PASS 9b — the (0,0) sentinel is rejected too';
end $$;

rollback;
