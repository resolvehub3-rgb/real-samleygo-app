-- =====================================================================
-- SamleyGo Errands — FARE ENGINE checks
-- (20261013_errands_fare_engine.sql)
--
-- Run this in the Supabase SQL editor (or `psql -f`) against ANY database,
-- including production: the whole file runs inside one transaction that is
-- ROLLED BACK at the end, so nothing is committed and no stored price,
-- service switch or booking is changed.
--
-- A check reports PASS through a NOTICE. The only way this file can fail is
-- by raising an exception that starts with "FAIL -".
--
-- What it locks down, one section at a time:
--   0. Fixtures — deterministic service switches, pricing rules and two
--      customers with one eligible driver (all rolled back).
--   1. The formula — distance charge, base, optional fees, clamps, surge
--      on/off, tax, discount and the earnings split, in integer pesewas.
--   2. Honesty — no rules, empty rules and an unknown category produce an
--      error, never a price.
--   3. Schema — versioned rules, one active row per category, every money
--      table still has no client write path, and the RPCs are granted to
--      exactly the roles that need them.
--   4. Quotes — the server routes (never a straight line), refuses an
--      unusable route, prices with the ACTIVE rule for that category and
--      snapshots the rule it used.
--   5. Booking — ownership, expiry, driver availability, a single-use
--      quote, the driver lock, and re-pricing under the CURRENT rules: a
--      fare that moved is reported instead of silently replaced.
--
-- Client-level coverage (source scans, TTL window, UI honesty) lives in
-- scripts/errands_pricing.test.ts and scripts/errands_fare_engine.test.ts
-- - run `npm test`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Fixtures
-- ---------------------------------------------------------------------

-- Remember what was configured so the file can put it back before rolling
-- back (nothing is committed either way, but an operator reading the
-- notices must never see the wrong state attributed to their database).
create temp table tmp_orig_rules (id uuid primary key, service_category text);
insert into public.errands_pricing_rules (id, service_category)
select id, service_category
  from public.errands_pricing_rules
 where service_category in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND')
   and is_active
on conflict do nothing;

create temp table tmp_cfg (value jsonb);
insert into tmp_cfg (value)
select value from public.platform_settings where key = 'errands_config';

create temp table tmp_quotes (
    label       text primary key,
    quote_id    uuid not null,
    fare        numeric(10,2) not null,
    rules_id    uuid
);

-- Deterministic switches: motorcycle errands ON, car errands OFF (the
-- documented default), passenger rides OFF.
insert into public.platform_settings (key, value, description)
values (
    'errands_config',
    jsonb_build_object(
        'enabled', true,
        'services', jsonb_build_object(
            'ERRAND_MOTORCYCLE', true,
            'CAR_ERRAND',        false,
            'RIDE_CAR',          false
        )
    ),
    'Errands fare checks fixture (rolled back)'
)
on conflict (key) do update set value = excluded.value;

-- One ACTIVE rule per category is what the server prices with, so the
-- fixture owns the motorcycle and car rows for the length of this file.
update public.errands_pricing_rules
   set is_active = false
 where service_category in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND')
   and is_active;

insert into public.errands_pricing_rules (
    id, service_category, vehicle_category,
    base_fare, price_per_km, min_fare, max_fare,
    booking_fee, waiting_charge, waiting_charge_enabled,
    time_charge_per_minute, time_charge_enabled,
    surge_enabled, surge_multiplier, tax_rate_percent, discount_amount,
    driver_earning_percent, platform_commission_percent,
    currency, pricing_version, effective_from, is_active
) values
    -- Motorcycle: GHc5 base + GHc2/km, driver takes everything.
    ('ed000000-0000-4000-a000-00000000f001', 'ERRAND_MOTORCYCLE', 'MOTORCYCLE',
     5.00, 2.00, 0.00, null,
     0.00, 0.00, false, 0.00, false,
     false, 1.00, 0.00, 0.00,
     100.00, 0.00,
     'GHS', 101, now() - interval '1 minute', true),
    -- Car errands: GHc10 base + GHc3/km, 80/20 split. A DIFFERENT price
    -- list for a different vehicle category.
    ('ed000000-0000-4000-a000-00000000f003', 'CAR_ERRAND', 'CAR',
     10.00, 3.00, 0.00, null,
     0.00, 0.00, false, 0.00, false,
     false, 1.00, 0.00, 0.00,
     80.00, 20.00,
     'GHS', 101, now() - interval '1 minute', true);

-- Two customers and one fully eligible motorcycle driver.
insert into auth.users (id, email, created_at, updated_at) values
    ('ed000000-0000-4000-a000-000000000001', 'errands.check.c1@example.invalid', now(), now()),
    ('ed000000-0000-4000-a000-000000000002', 'errands.check.c2@example.invalid', now(), now()),
    ('ed000000-0000-4000-a000-0000000000d1', 'errands.check.driver@example.invalid', now(), now());

insert into public.profiles (id, email, full_name, role) values
    ('ed000000-0000-4000-a000-000000000001', 'errands.check.c1@example.invalid', 'Errands Check C1', 'CUSTOMER'),
    ('ed000000-0000-4000-a000-000000000002', 'errands.check.c2@example.invalid', 'Errands Check C2', 'CUSTOMER'),
    ('ed000000-0000-4000-a000-0000000000d1', 'errands.check.driver@example.invalid', 'Errands Check Driver', 'COURIER');

insert into public.couriers (
    id, vehicle_type, vehicle_plate, verification_status,
    is_approved, is_online, availability_status,
    current_latitude, current_longitude, current_location_updated_at,
    last_seen_at, rating
) values (
    'ed000000-0000-4000-a000-0000000000d1', 'Motorcycle', 'AS-000-24', 'APPROVED',
    true, true, 'AVAILABLE',
    5.6037, -0.1870, now(), now(), 4.80
);

insert into public.driver_service_capabilities (
    courier_id, errands_enabled, motorcycle_errands, car_errands, car_rides
) values (
    'ed000000-0000-4000-a000-0000000000d1', true, true, false, false
);

do $$
begin
    if public.get_active_errands_pricing_rule('ERRAND_MOTORCYCLE') is null then
        raise exception 'FAIL - the motorcycle fixture rule is not active';
    end if;
    if public.get_active_errands_pricing_rule('CAR_ERRAND') is null then
        raise exception 'FAIL - the car-errand fixture rule is not active';
    end if;
    if not public.errands_driver_is_available(
            'ed000000-0000-4000-a000-0000000000d1'::uuid, 'ERRAND_MOTORCYCLE') then
        raise exception 'FAIL - the fixture driver must be eligible for motorcycle errands';
    end if;
    if public.errands_driver_is_available(
            'ed000000-0000-4000-a000-0000000000d1'::uuid, 'CAR_ERRAND') then
        raise exception 'FAIL - a motorcycle driver without the car-errand capability must not be eligible for car errands';
    end if;
    if public.errands_driver_is_available(
            'ed000000-0000-4000-a000-0000000000d1'::uuid, 'RIDE_CAR') then
        raise exception 'FAIL - a driver without the passenger-ride capability must not be eligible for rides';
    end if;
    raise notice 'PASS 0 - fixtures load: two active rule sets (per category) and one eligible driver';
end $$;

-- ---------------------------------------------------------------------
-- 1. THE FORMULA — explicit rules, so these checks never read (or change)
--    a stored price.
-- ---------------------------------------------------------------------

do $$
declare v jsonb;
begin
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":0,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "waiting_charge":0,"waiting_charge_enabled":false,
          "time_charge_per_minute":0,"time_charge_enabled":false,
          "surge_enabled":false,"surge_multiplier":1,"tax_rate_percent":0,
          "discount_amount":0,"driver_earning_percent":100,
          "platform_commission_percent":0,"currency":"GHS"}'::jsonb);

    if (v ->> 'distance_charge')::numeric <> 16.00 then
        raise exception 'FAIL - 8 km at GHc2/km: expected distance charge 16.00, got %',
            (v ->> 'distance_charge');
    end if;
    if (v ->> 'estimated_fare')::numeric <> 16.00 then
        raise exception 'FAIL - the fare IS the distance: expected 16.00, got %',
            (v ->> 'estimated_fare');
    end if;
    if (v ->> 'driver_earning')::numeric <> 16.00
       or (v ->> 'platform_revenue')::numeric <> 0.00
       or (v ->> 'tax_amount')::numeric <> 0.00 then
        raise exception 'FAIL - a 100 percent driver share must pay the driver the whole total';
    end if;
    if (v ->> 'currency') <> 'GHS' then
        raise exception 'FAIL - the currency must be GHS';
    end if;
    raise notice 'PASS 1a - 8 km x GHc2/km = GHc16.00, driver earns the total';
end $$;

do $$
declare v jsonb;
begin
    -- A base fare is a real, configurable component: +GHc5 on the same trip.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "waiting_charge_enabled":false,"time_charge_enabled":false,
          "surge_enabled":false,"surge_multiplier":1,"tax_rate_percent":0,
          "discount_amount":0,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'base_fare')::numeric <> 5.00
       or (v ->> 'estimated_fare')::numeric <> 21.00 then
        raise exception 'FAIL - base 5 + distance 16 must price GHc21.00, got %',
            (v ->> 'estimated_fare');
    end if;

    -- Rounding is half-away-from-zero, on pesewas, and agrees with the
    -- documented examples (17.806 => 17.81, 17.804 => 17.80).
    v := public.errands_fare_amounts(
        8.903, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":0,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 17.81 then
        raise exception 'FAIL - 8.903 km must round to GHc17.81, got %', (v ->> 'estimated_fare');
    end if;

    v := public.errands_fare_amounts(
        8.902, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":0,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 17.80 then
        raise exception 'FAIL - 8.902 km must round to GHc17.80, got %', (v ->> 'estimated_fare');
    end if;

    -- Tax is a percentage of the fare; the driver's share is a percentage
    -- of what the customer pays; the three parts always add back up.
    v := public.errands_fare_amounts(
        10.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":0,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "surge_enabled":false,"surge_multiplier":1,"tax_rate_percent":15,
          "discount_amount":0,"driver_earning_percent":80,
          "platform_commission_percent":20}'::jsonb);
    if (v ->> 'trip_fare')::numeric <> 20.00
       or (v ->> 'tax_amount')::numeric <> 3.00
       or (v ->> 'estimated_fare')::numeric <> 23.00 then
        raise exception 'FAIL - tax must be 15 percent of the trip fare (GHc3.00 on GHc20.00)';
    end if;
    if (v ->> 'driver_earning')::numeric <> 18.40 then
        raise exception 'FAIL - 80 percent of GHc23.00 must be GHc18.40, got %',
            (v ->> 'driver_earning');
    end if;
    if (v ->> 'driver_earning')::numeric + (v ->> 'platform_revenue')::numeric
       + (v ->> 'tax_amount')::numeric <> (v ->> 'estimated_fare')::numeric then
        raise exception 'FAIL - driver + platform + tax must equal what the customer pays';
    end if;
    raise notice 'PASS 1b - base fare, pesewa rounding and the tax/earnings split';
end $$;

do $$
declare v jsonb;
begin
    -- Floor.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":30,"max_fare":0,
          "booking_fee":0,"surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 30.00 then
        raise exception 'FAIL - the minimum fare must lift the trip to GHc30.00, got %',
            (v ->> 'estimated_fare');
    end if;

    -- Ceiling.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":12,
          "booking_fee":0,"surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 12.00 then
        raise exception 'FAIL - the maximum fare must cap the trip at GHc12.00, got %',
            (v ->> 'estimated_fare');
    end if;

    -- A ceiling of 0 (or blank) means NO ceiling — never a free fare.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,
          "booking_fee":0,"surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 21.00 then
        raise exception 'FAIL - max_fare 0 must mean "no ceiling", got %',
            (v ->> 'estimated_fare');
    end if;
    if (v ->> 'max_fare') is not null then
        raise exception 'FAIL - the breakdown must report no ceiling when none is set';
    end if;
    raise notice 'PASS 1c - the floor lifts, the ceiling caps, and 0 means no ceiling';
end $$;

do $$
declare v jsonb;
begin
    -- Surge multiplies the trip components ONLY: the booking fee stays flat.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":2,
          "surge_enabled":true,"surge_multiplier":1.5,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 33.50 then
        raise exception 'FAIL - (5 + 16) x 1.5 + 2 = GHc33.50, got %',
            (v ->> 'estimated_fare');
    end if;
    if (v ->> 'booking_fee')::numeric <> 2.00 then
        raise exception 'FAIL - surge must never multiply the booking fee';
    end if;
    if (v ->> 'surge_amount')::numeric <> 10.50 then
        raise exception 'FAIL - the surge line must show what the multiplier added (10.50), got %',
            (v ->> 'surge_amount');
    end if;

    -- The same multiplier with the switch OFF changes nothing: a number
    -- typed into a disabled field is not a price.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":2,
          "surge_enabled":false,"surge_multiplier":1.5,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 23.00 then
        raise exception 'FAIL - disabled surge must not change the price, got %',
            (v ->> 'estimated_fare');
    end if;
    if coalesce((v ->> 'surge_rule_active')::boolean, false) then
        raise exception 'FAIL - a disabled surge must not be disclosed as an active one';
    end if;
    raise notice 'PASS 1d - surge applies only when it is switched on, and never to the booking fee';
end $$;

do $$
declare v jsonb;
begin
    -- Waiting charge: off by default, added once when it is switched on.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "waiting_charge":3,"waiting_charge_enabled":false,
          "surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 21.00
       or (v ->> 'waiting_charge')::numeric <> 0.00 then
        raise exception 'FAIL - an enabled-looking waiting amount must stay at 0 while the switch is off';
    end if;

    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "waiting_charge":3,"waiting_charge_enabled":true,
          "surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 24.00 then
        raise exception 'FAIL - the waiting charge must be added once it is switched on, got %',
            (v ->> 'estimated_fare');
    end if;

    -- Time charge: priced on the routed duration, off unless switched on.
    v := public.errands_fare_amounts(
        8.00, 900, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "time_charge_per_minute":0.50,"time_charge_enabled":false,
          "surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'time_charge')::numeric <> 0.00 then
        raise exception 'FAIL - a time charge must stay at 0 while its switch is off';
    end if;

    v := public.errands_fare_amounts(
        8.00, 900, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "time_charge_per_minute":0.50,"time_charge_enabled":true,
          "surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'time_charge')::numeric <> 7.50
       or (v ->> 'estimated_fare')::numeric <> 28.50 then
        raise exception 'FAIL - 15 minutes at GHc0.50 must add GHc7.50, got %',
            (v ->> 'time_charge');
    end if;

    -- Discount is subtracted BEFORE tax, and a discount can never make a
    -- negative fare.
    v := public.errands_fare_amounts(
        8.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "surge_enabled":false,"tax_rate_percent":10,"discount_amount":5,
          "driver_earning_percent":100}'::jsonb);
    if (v ->> 'discount_amount')::numeric <> 5.00
       or (v ->> 'tax_amount')::numeric <> 1.60
       or (v ->> 'estimated_fare')::numeric <> 17.60 then
        raise exception 'FAIL - (21 - 5) plus 10 percent tax must be GHc17.60, got %',
            (v ->> 'estimated_fare');
    end if;

    v := public.errands_fare_amounts(
        2.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":0,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "surge_enabled":false,"tax_rate_percent":0,"discount_amount":999,
          "driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric < 0 then
        raise exception 'FAIL - a discount can never push a fare below zero';
    end if;

    -- A negative or missing distance is 0 km, never garbage.
    v := public.errands_fare_amounts(
        -10.00, null, 'ERRAND_MOTORCYCLE',
        '{"base_fare":5,"price_per_km":2,"min_fare":0,"max_fare":0,"booking_fee":0,
          "surge_enabled":false,"driver_earning_percent":100}'::jsonb);
    if (v ->> 'estimated_fare')::numeric <> 5.00 then
        raise exception 'FAIL - a negative distance must be treated as 0 km, got %',
            (v ->> 'estimated_fare');
    end if;
    raise notice 'PASS 1e - optional charges are off unless enabled, and discount/tax/clamps stay sane';
end $$;

-- ---------------------------------------------------------------------
-- 2. HONESTY — no configuration, no number.
-- ---------------------------------------------------------------------

do $$
begin
    begin
        perform public.errands_fare_amounts(8.00, null, 'ERRAND_MOTORCYCLE', null);
        raise exception 'FAIL - null rules produced a price';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%has not been configured%' then
            raise exception 'FAIL - null rules must raise the unconfigured message, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 2a - null rules raise the admin-required message instead of a fare';
end $$;

do $$
begin
    begin
        perform public.errands_fare_amounts(
            8.00, null, 'ERRAND_MOTORCYCLE',
            '{"base_fare":0,"price_per_km":0,"min_fare":0,"max_fare":0,
              "booking_fee":0,"driver_earning_percent":100}'::jsonb);
        raise exception 'FAIL - an all-zero rule set produced a price';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%has not been configured%' then
            raise exception 'FAIL - an empty rule set must raise the unconfigured message, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 2b - a rule set with no money in it prices NOTHING (never GHc0.00)';
end $$;

do $$
begin
    begin
        perform public.errands_fare_amounts(
            8.00, null, 'DELIVERY_DRONE',
            '{"base_fare":5,"price_per_km":2,"driver_earning_percent":100}'::jsonb);
        raise exception 'FAIL - an unknown service category produced a price';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%not supported%' then
            raise exception 'FAIL - an unknown category must be rejected, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 2c - an unknown service category is refused';
end $$;

-- ---------------------------------------------------------------------
-- 3. SCHEMA — versioned rules, one active row, no client write paths,
--    and exactly the right roles on every money RPC.
-- ---------------------------------------------------------------------

do $$
begin
    if to_regclass('public.errands_pricing_rules') is null then
        raise exception 'FAIL - errands_pricing_rules is missing';
    end if;
    if to_regclass('public.errands_pricing_rules_active_uniq') is null then
        raise exception 'FAIL - only one rule set per category may be active at a time';
    end if;
    if not exists (
        select 1 from pg_constraint
         where conname = 'errands_pricing_rules_not_free_check'
           and conrelid = 'public.errands_pricing_rules'::regclass
    ) then
        raise exception 'FAIL - a rule set with no money in it must be refused at write time';
    end if;
    if not exists (
        select 1 from pg_constraint
         where conname = 'errands_pricing_rules_band_check'
           and conrelid = 'public.errands_pricing_rules'::regclass
    ) then
        raise exception 'FAIL - max_fare must never sit below min_fare';
    end if;
    if not exists (
        select 1 from pg_constraint
         where conname = 'errands_pricing_rules_share_check'
           and conrelid = 'public.errands_pricing_rules'::regclass
    ) then
        raise exception 'FAIL - the driver/platform shares must add up to 100';
    end if;
    if not exists (
        select 1 from pg_constraint
         where conname = 'errands_pricing_rules_vehicle_check'
           and conrelid = 'public.errands_pricing_rules'::regclass
    ) then
        raise exception 'FAIL - the vehicle category must match the service category';
    end if;

    -- The band, share, vehicle and "never free" rules are enforced at
    -- write time, not just documented. Every probe row is inactive so the
    -- one-active-row-per-category index never interferes.
    begin
        insert into public.errands_pricing_rules
            (service_category, vehicle_category, base_fare, price_per_km,
             min_fare, max_fare, driver_earning_percent, platform_commission_percent, is_active)
        values ('RIDE_CAR', 'CAR', 5.00, 2.00, 30.00, 10.00, 100.00, 0.00, false);
        raise exception 'FAIL - a ceiling below the floor was accepted';
    exception
        when check_violation then null;
        when others then
            if sqlerrm like 'FAIL%' then raise; end if;
            raise;
    end;

    begin
        insert into public.errands_pricing_rules
            (service_category, vehicle_category, base_fare, price_per_km,
             min_fare, max_fare, driver_earning_percent, platform_commission_percent, is_active)
        values ('RIDE_CAR', 'CAR', 5.00, 2.00, 0.00, null, 70.00, 20.00, false);
        raise exception 'FAIL - a 70/20 split was accepted';
    exception
        when check_violation then null;
        when others then
            if sqlerrm like 'FAIL%' then raise; end if;
            raise;
    end;

    begin
        insert into public.errands_pricing_rules
            (service_category, vehicle_category, base_fare, price_per_km,
             min_fare, max_fare, driver_earning_percent, platform_commission_percent, is_active)
        values ('CAR_ERRAND', 'MOTORCYCLE', 5.00, 2.00, 0.00, null, 100.00, 0.00, false);
        raise exception 'FAIL - a motorcycle rule set was accepted for a car service';
    exception
        when check_violation then null;
        when others then
            if sqlerrm like 'FAIL%' then raise; end if;
            raise;
    end;

    begin
        insert into public.errands_pricing_rules
            (service_category, vehicle_category, base_fare, price_per_km,
             min_fare, max_fare, driver_earning_percent, platform_commission_percent, is_active)
        values ('ERRAND_MOTORCYCLE', 'MOTORCYCLE', 0.00, 0.00, 0.00, null, 100.00, 0.00, false);
        raise exception 'FAIL - a free (unconfigured) rule set was accepted';
    exception
        when check_violation then null;
        when others then
            if sqlerrm like 'FAIL%' then raise; end if;
            raise;
    end;
    raise notice 'PASS 3a - the rules table is versioned, banded, split-checked and never free';
end $$;

do $$
begin
    if exists (
        select 1 from pg_policies
         where schemaname = 'public'
           and tablename in ('errands_pricing_rules', 'errands_quotes',
                             'errands_bookings', 'driver_service_capabilities')
           and cmd in ('INSERT', 'UPDATE', 'DELETE')
    ) then
        raise exception 'FAIL - a money table gained a client write policy; writes must go through SECURITY DEFINER RPCs';
    end if;
    raise notice 'PASS 3b - no INSERT/UPDATE/DELETE policy on any money table';
end $$;

do $$
declare v_args text[];
begin
    -- The quote RPC: reachable only from the Edge Function's service role.
    if has_function_privilege('anon',
        'public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text)',
        'execute') then
        raise exception 'FAIL - anon can execute the quote RPC';
    end if;
    if has_function_privilege('authenticated',
        'public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text)',
        'execute') then
        raise exception 'FAIL - the browser can execute the quote RPC directly (it must go through the Edge Function)';
    end if;
    if not has_function_privilege('service_role',
        'public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text)',
        'execute') then
        raise exception 'FAIL - the service role cannot execute the quote RPC';
    end if;

    -- The fare formula is server-only too.
    if has_function_privilege('anon', 'public.errands_fare_amounts(numeric, integer, text, jsonb)', 'execute')
       or has_function_privilege('authenticated',
            'public.errands_fare_amounts(numeric, integer, text, jsonb)', 'execute') then
        raise exception 'FAIL - the fare formula must not be callable from the browser';
    end if;
    if not has_function_privilege('service_role',
        'public.errands_fare_amounts(numeric, integer, text, jsonb)', 'execute') then
        raise exception 'FAIL - the service role cannot compute a fare';
    end if;

    -- The price list itself is readable (for the admin screen) but its
    -- only writer is the SECURITY DEFINER setter.
    if has_function_privilege('anon', 'public.get_errands_pricing_rules()', 'execute') then
        raise exception 'FAIL - anon can read the whole price list';
    end if;
    if not has_function_privilege('authenticated', 'public.get_errands_pricing_rules()', 'execute') then
        raise exception 'FAIL - a super admin cannot read the price list';
    end if;
    if has_function_privilege('anon', 'public.set_errands_pricing_rules(text, text, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, boolean, boolean, numeric, numeric, numeric, numeric, numeric, text, timestamptz, boolean)', 'execute') then
        raise exception 'FAIL - anon can write the price list';
    end if;

    -- Booking takes IDs and NOTHING else: no fare, no distance, no
    -- driver earnings. The client can never post a price it invented.
    select p.proargnames into v_args
      from pg_proc p
     where p.oid = 'public.create_errands_booking(uuid, uuid)'::regprocedure;
    if v_args <> array['p_quote_id', 'p_driver_id']::text[] then
        raise exception 'FAIL - create_errands_booking must accept only (quote, driver), got %',
            array_to_string(v_args, ', ');
    end if;

    select p.proargnames into v_args
      from pg_proc p
     where p.oid = 'public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text)'::regprocedure;
    if not ('p_route_distance_km' = any (v_args)) then
        raise exception 'FAIL - the quote RPC must receive the distance the SERVER routed';
    end if;
    if exists (
        select 1 from unnest(v_args) a
         where a like '%fare%' or a like '%earning%' or a like '%commission%'
    ) then
        raise exception 'FAIL - the quote RPC must not accept a fare from its caller';
    end if;
    raise notice 'PASS 3c - the quote and fare RPCs are service-role only; booking accepts IDs only';
end $$;

-- ---------------------------------------------------------------------
-- 4. QUOTES — the server routes, refuses bad input and snapshots the
--    rule it priced with.
-- ---------------------------------------------------------------------

do $$
declare v jsonb;
begin
    v := public.create_errands_quote(
        p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
        p_pickup_lat       => 5.6037::double precision,
        p_pickup_lng       => -0.1870::double precision,
        p_pickup_address   => 'Osu, Accra',
        p_dest_lat         => 5.6341::double precision,
        p_dest_lng         => -0.1750::double precision,
        p_dest_address     => 'East Legon, Accra',
        p_service_category => 'ERRAND_MOTORCYCLE',
        p_route_distance_km   => 4.50::numeric,
        p_route_duration_seconds => 900,
        p_route_provider   => 'TEST'
    );

    -- base 5 + 4.5 km x 2 = GHc14.00
    if (v ->> 'estimated_fare')::numeric <> 14.00 then
        raise exception 'FAIL - the quote must price base + distance (GHc14.00), got %',
            (v ->> 'estimated_fare');
    end if;
    if (v ->> 'distance_source') <> 'ROAD_ROUTE' then
        raise exception 'FAIL - the distance source must be ROAD_ROUTE, got %', (v ->> 'distance_source');
    end if;
    if (v ->> 'route_provider') <> 'TEST' then
        raise exception 'FAIL - the quote must record which provider routed the trip';
    end if;
    if (v ->> 'route_distance_metres')::numeric <> 4500 then
        raise exception 'FAIL - the stored route distance must be the routed one';
    end if;
    if (v ->> 'straight_line_km')::numeric is null
       or (v ->> 'straight_line_km')::numeric >= (v ->> 'route_distance_metres')::numeric / 1000.0 then
        raise exception 'FAIL - the crow-fly distance must be recorded for auditing only, never as the route';
    end if;
    if (v ->> 'breakdown') is null
       or not (v -> 'breakdown') ? 'estimated_total'
       or not (v -> 'breakdown') ? 'base_fare'
       or not (v -> 'breakdown') ? 'distance_charge' then
        raise exception 'FAIL - the quote must carry a full breakdown for the customer to review';
    end if;
    if (v ->> 'status') <> 'ACTIVE' then
        raise exception 'FAIL - a fresh quote must be ACTIVE';
    end if;

    insert into tmp_quotes (label, quote_id, fare, rules_id)
    values ('q_happy',
            (v ->> 'quote_id')::uuid,
            (v ->> 'estimated_fare')::numeric,
            (v ->> 'pricing_rules_id')::uuid)
    on conflict (label) do update
        set quote_id = excluded.quote_id,
            fare = excluded.fare,
            rules_id = excluded.rules_id;

    if not exists (
        select 1 from public.errands_quotes q
         where q.id = (v ->> 'quote_id')::uuid
           and q.customer_id = 'ed000000-0000-4000-a000-000000000001'::uuid
           and q.status = 'ACTIVE'
           and q.expires_at > now()
           and q.pricing_rules_id = 'ed000000-0000-4000-a000-00000000f001'::uuid
           and q.distance_source = 'ROAD_ROUTE'
    ) then
        raise exception 'FAIL - the stored quote must belong to the customer, expire in the future and point at the rule that priced it';
    end if;
    raise notice 'PASS 4a - a routed quote is priced, snapshotted and stored with an expiry';
end $$;

do $$
begin
    begin
        perform public.create_errands_quote(
            p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
            p_pickup_lat       => 5.6037::double precision,
            p_pickup_lng       => -0.1870::double precision,
            p_pickup_address   => 'Osu, Accra',
            p_dest_lat         => 5.6341::double precision,
            p_dest_lng         => -0.1750::double precision,
            p_dest_address     => 'East Legon, Accra',
            p_service_category => 'ERRAND_MOTORCYCLE',
            p_route_distance_km   => null,
            p_route_duration_seconds => 900
        );
        raise exception 'FAIL - a quote without a road route was issued';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%could not find a road route%' then
            raise exception 'FAIL - a missing route must be reported honestly, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 4b - no road route means no price (no straight-line fallback)';
end $$;

do $$
begin
    -- 50 km for endpoints that are ~3.6 km apart in a straight line: an
    -- implausible "route" is refused rather than believed.
    begin
        perform public.create_errands_quote(
            p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
            p_pickup_lat       => 5.6037::double precision,
            p_pickup_lng       => -0.1870::double precision,
            p_pickup_address   => 'Osu, Accra',
            p_dest_lat         => 5.6341::double precision,
            p_dest_lng         => -0.1750::double precision,
            p_dest_address     => 'East Legon, Accra',
            p_service_category => 'ERRAND_MOTORCYCLE',
            p_route_distance_km   => 50.00::numeric,
            p_route_duration_seconds => 900
        );
        raise exception 'FAIL - an implausible route distance was accepted';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%could not be verified%' then
            raise exception 'FAIL - an implausible route must be refused, got %', sqlerrm;
        end if;
    end;

    -- Identical endpoints are not a trip.
    begin
        perform public.create_errands_quote(
            p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
            p_pickup_lat       => 5.6037::double precision,
            p_pickup_lng       => -0.1870::double precision,
            p_pickup_address   => 'Osu, Accra',
            p_dest_lat         => 5.6037::double precision,
            p_dest_lng         => -0.1870::double precision,
            p_dest_address     => 'Osu, Accra',
            p_service_category => 'ERRAND_MOTORCYCLE',
            p_route_distance_km   => 4.50::numeric
        );
        raise exception 'FAIL - a zero-length trip was quoted';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%same place%' then
            raise exception 'FAIL - identical endpoints must be refused, got %', sqlerrm;
        end if;
    end;

    -- Outside the service area: no price, and no lie about availability.
    begin
        perform public.create_errands_quote(
            p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
            p_pickup_lat       => 40.7128::double precision,
            p_pickup_lng       => -74.0060::double precision,
            p_pickup_address   => 'New York',
            p_dest_lat         => 40.7580::double precision,
            p_dest_lng         => -73.9855::double precision,
            p_dest_address     => 'Times Square',
            p_service_category => 'ERRAND_MOTORCYCLE',
            p_route_distance_km   => 3.00::numeric
        );
        raise exception 'FAIL - a quote outside the service area was issued';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%service area%' then
            raise exception 'FAIL - an out-of-area trip must be reported, got %', sqlerrm;
        end if;
    end;

    -- A service that is switched OFF cannot be quoted (car errands default
    -- to off, and this fixture sets them off explicitly).
    begin
        perform public.create_errands_quote(
            p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
            p_pickup_lat       => 5.6037::double precision,
            p_pickup_lng       => -0.1870::double precision,
            p_pickup_address   => 'Osu, Accra',
            p_dest_lat         => 5.6341::double precision,
            p_dest_lng         => -0.1750::double precision,
            p_dest_address     => 'East Legon, Accra',
            p_service_category => 'CAR_ERRAND',
            p_route_distance_km   => 4.50::numeric
        );
        raise exception 'FAIL - a switched-off service was quoted';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%not available%' then
            raise exception 'FAIL - a switched-off service must be reported, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 4c - bad routes, identical endpoints, out-of-area trips and switched-off services are refused';
end $$;

-- Per-category pricing: the car price list is NOT the motorcycle one.
do $$
declare v_moto jsonb; v_car jsonb;
begin
    v_moto := public.get_active_errands_pricing_rule('ERRAND_MOTORCYCLE');
    v_car   := public.get_active_errands_pricing_rule('CAR_ERRAND');
    if v_moto is null or v_car is null then
        raise exception 'FAIL - both categories must resolve to their own active rule';
    end if;
    if (v_moto ->> 'price_per_km')::numeric = (v_car ->> 'price_per_km')::numeric then
        raise exception 'FAIL - per-category pricing must be independently configurable';
    end if;
    if (v_moto ->> 'vehicle_category') <> 'MOTORCYCLE'
       or (v_car ->> 'vehicle_category') <> 'CAR' then
        raise exception 'FAIL - each rule set must carry its vehicle category';
    end if;
    raise notice 'PASS 4d - each service category prices with its own rule set';
end $$;

-- With pricing switched off for the category, NO quote may be issued.
update public.errands_pricing_rules set is_active = false
 where service_category = 'ERRAND_MOTORCYCLE' and is_active;

do $$
begin
    begin
        perform public.create_errands_quote(
            p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
            p_pickup_lat       => 5.6037::double precision,
            p_pickup_lng       => -0.1870::double precision,
            p_pickup_address   => 'Osu, Accra',
            p_dest_lat         => 5.6341::double precision,
            p_dest_lng         => -0.1750::double precision,
            p_dest_address     => 'East Legon, Accra',
            p_service_category => 'ERRAND_MOTORCYCLE',
            p_route_distance_km   => 4.50::numeric
        );
        raise exception 'FAIL - a price was issued with no rules configured';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%has not been configured%' then
            raise exception 'FAIL - missing rules must raise the admin-required message, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 4e - missing pricing rules mean NO quote (the super-admin message, never GHc0.00)';
end $$;

update public.errands_pricing_rules set is_active = true
 where id = 'ed000000-0000-4000-a000-00000000f001'::uuid;

-- ---------------------------------------------------------------------
-- 5. BOOKING — ownership, expiry, the driver lock, single-use quotes and
--    re-pricing under the CURRENT rules.
-- ---------------------------------------------------------------------

-- 5a. An expired quote can never become a booking.
insert into tmp_quotes (label, quote_id, fare, rules_id)
select 'q_expired', q.id, q.estimated_fare, q.pricing_rules_id
  from public.errands_quotes q
 where q.id = (select quote_id from tmp_quotes where label = 'q_happy');
update public.errands_quotes
   set expires_at = now() - interval '1 minute'
 where id = (select quote_id from tmp_quotes where label = 'q_expired');

select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub',  'ed000000-0000-4000-a000-000000000001',
        'role', 'authenticated'
    )::text,
    true
);
set local role authenticated;

do $$
begin
    begin
        perform public.create_errands_booking(
            (select quote_id from tmp_quotes where label = 'q_expired'),
            'ed000000-0000-4000-a000-0000000000d1'::uuid);
        raise exception 'FAIL - an expired quote was accepted';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%expired%' then
            raise exception 'FAIL - an expired quote must be reported, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 5a - an expired quote can never be booked';
end $$;

reset role;

-- 5b. The operator changes the price while the customer is reviewing it:
--     the booking refuses and asks for a fresh quote instead of charging
--     either number silently.
update public.errands_pricing_rules set is_active = false
 where id = 'ed000000-0000-4000-a000-00000000f001'::uuid;

insert into public.errands_pricing_rules (
    id, service_category, vehicle_category, base_fare, price_per_km,
    min_fare, max_fare, booking_fee, driver_earning_percent,
    platform_commission_percent, currency, pricing_version, effective_from, is_active
) values (
    'ed000000-0000-4000-a000-00000000f002', 'ERRAND_MOTORCYCLE', 'MOTORCYCLE',
    7.00, 2.00, 0.00, null, 0.00, 100.00, 0.00, 'GHS', 102, now(), true
);

-- A fresh quote under the OLD rules is issued below (the re-price test
-- needs a live quote that was priced before the price moved). Retire the
-- new row FIRST: only one row per category may be active at a time.
update public.errands_pricing_rules set is_active = false
 where id = 'ed000000-0000-4000-a000-00000000f002'::uuid;
update public.errands_pricing_rules set is_active = true
 where id = 'ed000000-0000-4000-a000-00000000f001'::uuid;

do $$
declare v_q jsonb;
begin
    v_q := public.create_errands_quote(
        p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
        p_pickup_lat       => 5.6037::double precision,
        p_pickup_lng       => -0.1870::double precision,
        p_pickup_address   => 'Osu, Accra',
        p_dest_lat         => 5.6341::double precision,
        p_dest_lng         => -0.1750::double precision,
        p_dest_address     => 'East Legon, Accra',
        p_service_category => 'ERRAND_MOTORCYCLE',
        p_route_distance_km   => 4.50::numeric,
        p_route_duration_seconds => 900
    );
    insert into tmp_quotes (label, quote_id, fare, rules_id)
    values ('q_changed', (v_q ->> 'quote_id')::uuid, (v_q ->> 'estimated_fare')::numeric,
            (v_q ->> 'pricing_rules_id')::uuid)
    on conflict (label) do update
        set quote_id = excluded.quote_id,
            fare = excluded.fare,
            rules_id = excluded.rules_id;
end $$;

-- Now move the price under the customer's feet.
update public.errands_pricing_rules set is_active = false
 where id = 'ed000000-0000-4000-a000-00000000f001'::uuid;
update public.errands_pricing_rules set is_active = true
 where id = 'ed000000-0000-4000-a000-00000000f002'::uuid;

select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub',  'ed000000-0000-4000-a000-000000000001',
        'role', 'authenticated'
    )::text,
    true
);
set local role authenticated;

do $$
begin
    begin
        perform public.create_errands_booking(
            (select quote_id from tmp_quotes where label = 'q_changed'),
            'ed000000-0000-4000-a000-0000000000d1'::uuid);
        raise exception 'FAIL - a booking was created against a price that moved';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%fare changed while you were reviewing it%' then
            raise exception 'FAIL - a moved price must be reported, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 5b - a fare that changed under the customer is reported, never silently replaced';
end $$;

reset role;

-- Restore the original motorcycle rule so every later quote prices the
-- same way the customer would see it (retire the replacement first).
update public.errands_pricing_rules set is_active = false
 where id = 'ed000000-0000-4000-a000-00000000f002'::uuid;
update public.errands_pricing_rules set is_active = true
 where id = 'ed000000-0000-4000-a000-00000000f001'::uuid;

-- 5c. A driver who goes offline between selection and confirmation.
update public.couriers
   set is_online = false, availability_status = 'OFFLINE', updated_at = now()
 where id = 'ed000000-0000-4000-a000-0000000000d1'::uuid;

select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub',  'ed000000-0000-4000-a000-000000000001',
        'role', 'authenticated'
    )::text,
    true
);
set local role authenticated;

do $$
begin
    begin
        perform public.create_errands_booking(
            (select quote_id from tmp_quotes where label = 'q_changed'),
            'ed000000-0000-4000-a000-0000000000d1'::uuid);
        raise exception 'FAIL - an offline driver was booked';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%just became unavailable%' then
            raise exception 'FAIL - an offline driver must be reported, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 5c - a driver who went offline is refused under the row lock';
end $$;

reset role;

update public.couriers
   set is_online = true, availability_status = 'AVAILABLE', updated_at = now()
 where id = 'ed000000-0000-4000-a000-0000000000d1'::uuid;

-- 5d. The happy path: the approved price becomes the agreed price.
do $$
declare v_q jsonb;
begin
    v_q := public.create_errands_quote(
        p_customer_id      => 'ed000000-0000-4000-a000-000000000001'::uuid,
        p_pickup_lat       => 5.6037::double precision,
        p_pickup_lng       => -0.1870::double precision,
        p_pickup_address   => 'Osu, Accra',
        p_dest_lat         => 5.6341::double precision,
        p_dest_lng         => -0.1750::double precision,
        p_dest_address     => 'East Legon, Accra',
        p_service_category => 'ERRAND_MOTORCYCLE',
        p_route_distance_km   => 4.50::numeric,
        p_route_duration_seconds => 900
    );
    insert into tmp_quotes (label, quote_id, fare, rules_id)
    values ('q_book', (v_q ->> 'quote_id')::uuid, (v_q ->> 'estimated_fare')::numeric,
            (v_q ->> 'pricing_rules_id')::uuid)
    on conflict (label) do update
        set quote_id = excluded.quote_id,
            fare = excluded.fare,
            rules_id = excluded.rules_id;
end $$;

select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub',  'ed000000-0000-4000-a000-000000000001',
        'role', 'authenticated'
    )::text,
    true
);
set local role authenticated;

do $$
declare v_b jsonb; v_fare numeric;
begin
    v_b := public.create_errands_booking(
        (select quote_id from tmp_quotes where label = 'q_book'),
        'ed000000-0000-4000-a000-0000000000d1'::uuid);

    if (v_b ->> 'status') is distinct from 'REQUESTED' then
        raise exception 'FAIL - a new booking must start as REQUESTED, got %', (v_b ->> 'status');
    end if;

    select fare into v_fare from tmp_quotes where label = 'q_book';

    if not exists (
        select 1 from public.errands_bookings b
         where b.customer_id = 'ed000000-0000-4000-a000-000000000001'::uuid
           and b.driver_id  = 'ed000000-0000-4000-a000-0000000000d1'::uuid
           and b.status = 'REQUESTED'
           and b.estimated_fare = v_fare
           and b.service_category = 'ERRAND_MOTORCYCLE'
    ) then
        raise exception 'FAIL - the booking must store the agreed price verbatim (expected %)', v_fare;
    end if;

    if not exists (
        select 1 from public.errands_quotes q
         where q.id = (select quote_id from tmp_quotes where label = 'q_book')
           and q.status = 'CONSUMED'
    ) then
        raise exception 'FAIL - the quote must be marked CONSUMED so it cannot be spent twice';
    end if;
    raise notice 'PASS 5d - the booking stores the agreed fare and consumes the quote';
end $$;

reset role;

-- 5e. The driver is now reserved: a second customer cannot take them.
do $$
declare v_q jsonb;
begin
    v_q := public.create_errands_quote(
        p_customer_id      => 'ed000000-0000-4000-a000-000000000002'::uuid,
        p_pickup_lat       => 5.6037::double precision,
        p_pickup_lng       => -0.1870::double precision,
        p_pickup_address   => 'Osu, Accra',
        p_dest_lat         => 5.6341::double precision,
        p_dest_lng         => -0.1750::double precision,
        p_dest_address     => 'East Legon, Accra',
        p_service_category => 'ERRAND_MOTORCYCLE',
        p_route_distance_km   => 4.50::numeric,
        p_route_duration_seconds => 900
    );
    insert into tmp_quotes (label, quote_id, fare, rules_id)
    values ('q_c2', (v_q ->> 'quote_id')::uuid, (v_q ->> 'estimated_fare')::numeric,
            (v_q ->> 'pricing_rules_id')::uuid)
    on conflict (label) do update
        set quote_id = excluded.quote_id,
            fare = excluded.fare,
            rules_id = excluded.rules_id;
end $$;

select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub',  'ed000000-0000-4000-a000-000000000002',
        'role', 'authenticated'
    )::text,
    true
);
set local role authenticated;

do $$
begin
    begin
        perform public.create_errands_booking(
            (select quote_id from tmp_quotes where label = 'q_c2'),
            'ed000000-0000-4000-a000-0000000000d1'::uuid);
        raise exception 'FAIL - the same driver was handed to two customers at once';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%just became unavailable%'
           and sqlerrm not like '%no longer available%' then
            raise exception 'FAIL - a busy driver must be reported, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 5e - the driver lock keeps a driver out of two bookings at once';
end $$;

-- 5f. Ownership: customer 2 cannot spend customer 1's quote, even when it
--     is still live and unused.
do $$
begin
    begin
        perform public.create_errands_booking(
            (select quote_id from tmp_quotes where label = 'q_changed'),
            'ed000000-0000-4000-a000-0000000000d1'::uuid);
        raise exception 'FAIL - a quote was spent by another customer';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%no longer valid%' then
            raise exception 'FAIL - a foreign quote must be reported, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 5f - a quote belongs to the customer it was issued to';
end $$;

reset role;

-- 5g. Single use: cancel the trip, then the SAME quote still cannot be
--     spent a second time.
update public.errands_bookings
   set status = 'CANCELLED'
 where customer_id = 'ed000000-0000-4000-a000-000000000001'::uuid
   and status = 'REQUESTED';

select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub',  'ed000000-0000-4000-a000-000000000001',
        'role', 'authenticated'
    )::text,
    true
);
set local role authenticated;

do $$
begin
    begin
        perform public.create_errands_booking(
            (select quote_id from tmp_quotes where label = 'q_book'),
            'ed000000-0000-4000-a000-0000000000d1'::uuid);
        raise exception 'FAIL - a consumed quote was spent a second time';
    exception when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        if sqlerrm not like '%already been used%' then
            raise exception 'FAIL - a consumed quote must be reported, got %', sqlerrm;
        end if;
    end;
    raise notice 'PASS 5g - a quote is single-use, even after the booking it created is cancelled';
end $$;

reset role;

do $$
begin
    if (select count(*) from public.errands_bookings
         where customer_id = 'ed000000-0000-4000-a000-000000000001'::uuid) <> 1 then
        raise exception 'FAIL - every failed attempt must leave NO booking behind (exactly one total)';
    end if;
    if (select count(*) from public.errands_bookings
         where customer_id = 'ed000000-0000-4000-a000-000000000002'::uuid) <> 0 then
        raise exception 'FAIL - a refused booking attempt must never create a row';
    end if;
    raise notice 'PASS 5h - six attempts, one booking: nothing is created when a check fails';
end $$;

-- ---------------------------------------------------------------------
-- 6. Put the operator's configuration back (the transaction is rolled
--    back below, so this changes nothing either way — it keeps the file
--    honest if it is ever run without the trailing rollback).
-- ---------------------------------------------------------------------

delete from public.errands_pricing_rules
 where id in (
    'ed000000-0000-4000-a000-00000000f001'::uuid,
    'ed000000-0000-4000-a000-00000000f002'::uuid,
    'ed000000-0000-4000-a000-00000000f003'::uuid
 );

update public.errands_pricing_rules r
   set is_active = true
  from tmp_orig_rules o
 where r.id = o.id;

delete from public.platform_settings ps
 where ps.key = 'errands_config'
   and not exists (select 1 from tmp_cfg);

insert into public.platform_settings (key, value)
select 'errands_config', value from tmp_cfg
on conflict (key) do update set value = excluded.value;

do $$
begin
    raise notice 'DONE - Errands fare engine checks passed; nothing was committed.';
end $$;

rollback;
