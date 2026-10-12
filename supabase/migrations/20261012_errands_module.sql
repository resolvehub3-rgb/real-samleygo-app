-- =====================================================================
-- SamleyGo — Errands & On-Demand Rides module
-- Run this in the Supabase SQL editor (Supabase Dashboard -> SQL Editor).
-- Idempotent: safe to run multiple times.
--
-- WHAT THIS MIGRATION DOES
--   1. Service configuration (`platform_settings` key `errands_config`):
--      a master enable switch plus a per-service switch, so an operator can
--      turn Errands (and, separately, passenger rides) on or off without a
--      deploy. Passenger rides (RIDE_CAR) default to OFF: they must be
--      enabled deliberately once the operational/regulatory requirements
--      for carrying passengers have been reviewed.
--   2. Distance-based pricing (`platform_settings` key `errands_pricing`):
--      base fare, per-km rate, minimum, OPTIONAL maximum, booking fee,
--      optional tax, surge, driver earning share, per-service overrides,
--      quote TTL and request TTL — versioned through `pricing_version`.
--      If the row does not exist the module reports "pricing not
--      configured" and refuses to quote: no invented fare is ever shown.
--   3. Tables:
--        driver_service_capabilities — explicit per-driver service opt-in
--          (food-delivery availability NEVER implies passenger transport).
--        errands_quotes              — short-lived, server-calculated quote.
--        errands_bookings            — the booking + status lifecycle.
--        errands_booking_details     — exact coordinates/addresses and
--                                       contact data, revealed to the
--                                       driver only AFTER acceptance.
--        errands_status_history      — append-only transition audit.
--   4. Secure server-side operations (all SECURITY DEFINER, browser never
--      decides money, identity or availability):
--        get_errands_config() / set_errands_config()
--        get_errands_pricing_settings() / errands_pricing_amounts()
--        set_errands_pricing()
--        create_errands_quote()
--        errands_nearby_drivers()         — eligibility-filtered discovery
--        errands_driver_is_available()    — one driver, same rules
--        create_errands_booking()         — ATOMIC driver reservation
--        errands_set_booking_status()     — validated transitions only
--        errands_expire_stale_bookings()  — no booking waits forever
--        set_errands_availability()       — driver opt-in/opt-out
--        set_driver_service_capabilities()— admin approval per service
--   5. Row Level Security: customers see their own bookings, drivers see
--      requests offered to them (and exact details only after accepting),
--      restaurant owners see nothing, super admins see everything.
--   6. Extends the couriers SELECT policy so an accepted customer may read
--      the live position of THEIR driver (and nobody else's), and filters
--      busy drivers out of `courier_driver_directory()` so restaurant
--      dispatch can never double-book an Errands driver.
--
-- STATUS LIFECYCLE
--   REQUESTED -> DRIVER_ACCEPTED -> (DRIVER_ARRIVING) -> DRIVER_ARRIVED
--        -> IN_PROGRESS -> COMPLETED
--   plus CANCELLED / EXPIRED / FAILED. `DRIVER_ASSIGNED` from the spec is
--   intentionally not used: the customer selects a specific driver, so a
--   booking is created already reserved for that driver — REQUESTED *is*
--   the assigned state, and acceptance, decline and timeout are explicit.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
--   * No pricing figures are invented: until a super admin saves the fare
--     rules through set_errands_pricing(), every quote request fails with
--     an honest "not configured" message.
--   * No food-delivery behaviour changes, except that `courier_driver_directory`
--     no longer offers a driver who is mid-Errand to restaurant dispatch.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Confirm this is the app's database (guard)
-- ---------------------------------------------------------------------
do $$
declare
    missing text;
begin
    select string_agg(v.t, ', ' order by v.t)
      into missing
      from (values ('public.orders'),
                   ('public.couriers'),
                   ('public.profiles'),
                   ('public.platform_settings'),
                   ('public.notifications'),
                   ('public.audit_logs')) v(t)
     where to_regclass(v.t) is null;

    if missing is not null then
        raise exception E'SamleyGo schema not found - missing %.\nThis query is running in a DIFFERENT database than the app uses.\nRun it against the project in VITE_SUPABASE_URL.', missing;
    end if;

    if to_regprocedure('public.haversine_km(double precision,double precision,double precision,double precision)') is null
       or to_regprocedure('public.get_delivery_pricing_settings()') is null then
        raise exception E'The delivery pricing migration is missing.\nRun supabase/migrations/20261005_distance_delivery_pricing.sql first - Errands reuses its safe_numeric()/haversine_km() helpers.';
    end if;

    if to_regprocedure('public.courier_order_participant(uuid)') is null then
        raise exception E'The courier location RLS migration is missing.\nRun supabase/migrations/20261011_courier_location_rls.sql first - the extended couriers policy below builds on courier_order_participant().';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. SERVICE CONFIGURATION
--    `enabled` is the master switch; `services` decides which categories
--    are offered. Default: motorcycle errands ON (same operational profile
--    as the existing food delivery), passenger rides OFF until an operator
--    explicitly approves them.
-- ---------------------------------------------------------------------
create or replace function public.get_errands_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_raw jsonb;
begin
    select coalesce(value, '{}'::jsonb)
      into v_raw
      from public.platform_settings
     where key = 'errands_config';

    if coalesce(jsonb_typeof(v_raw), 'object') <> 'object' then
        v_raw := '{}'::jsonb;
    end if;

    if coalesce(jsonb_typeof(v_raw -> 'services'), 'object') <> 'object' then
        v_raw := v_raw || jsonb_build_object('services', '{}'::jsonb);
    end if;

    return jsonb_build_object(
        'enabled', coalesce((v_raw ->> 'enabled')::boolean, true),
        'services', jsonb_build_object(
            'ERRAND_MOTORCYCLE',
                coalesce((v_raw -> 'services' ->> 'ERRAND_MOTORCYCLE')::boolean, true),
            'RIDE_CAR',
                coalesce((v_raw -> 'services' ->> 'RIDE_CAR')::boolean, false)
        ),
        'currency', coalesce(nullif(v_raw ->> 'currency', ''), 'GHS')
    );
end;
$$;

create or replace function public.errands_service_enabled(p_service_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (public.get_errands_config() ->> 'enabled')::boolean,
        false
    )
    and coalesce(
        (public.get_errands_config() -> 'services' ->> p_service_category)::boolean,
        false
    );
$$;

comment on function public.get_errands_config() IS
    'Errands service switches (master + per-service). SECURITY DEFINER so customers can read them without a platform_settings policy.';
comment on function public.errands_service_enabled(text) IS
    'True only when the module AND the requested service category are switched on.';

create or replace function public.set_errands_config(
    p_enabled boolean,
    p_service_motorcycle boolean,
    p_service_ride_car boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_next jsonb;
begin
    if auth.uid() is null or not exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can change Errands service settings';
    end if;

    if p_enabled is null or p_service_motorcycle is null or p_service_ride_car is null then
        raise exception 'Service switches cannot be empty';
    end if;

    v_next := jsonb_build_object(
        'enabled', p_enabled,
        'services', jsonb_build_object(
            'ERRAND_MOTORCYCLE', p_service_motorcycle,
            'RIDE_CAR', p_service_ride_car
        ),
        'updated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    insert into public.platform_settings (key, value, description)
    values ('errands_config', v_next,
            'Errands & rides service switches — master enable plus per-service categories')
    on conflict (key) do update
        set value = excluded.value,
            description = excluded.description,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'ERRANDS_CONFIG_UPDATED', 'settings', 'errands_config', v_next);

    return v_next;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. PRICING SETTINGS + THE ONE FARE FORMULA
--
--    Pricing lives in `platform_settings` (key `errands_pricing`) exactly
--    like delivery pricing, so the same admin, audit and versioning rules
--    apply. `configured` is ONLY ever written by set_errands_pricing():
--    until then every quote raises instead of inventing a fare.
--
--    Fare structure (documented, additive, rounded to whole pesewas):
--      trip_fare   = clamp(round((base_fare + km x per_km_rate) x surge, 2),
--                          min_fare, max_fare)
--      total       = trip_fare + booking_fee + round((trip_fare + booking_fee) x tax%, 2)
--      driver pay  = round(total x driver_earning_percentage / 100, 2)
--    min_fare = 0 and max_fare = NULL mean "no floor"/"no ceiling".
-- ---------------------------------------------------------------------
create or replace function public.get_errands_pricing_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_raw jsonb;
    v_configured boolean := false;
begin
    select coalesce(value, '{}'::jsonb)
      into v_raw
      from public.platform_settings
     where key = 'errands_pricing';

    if coalesce(jsonb_typeof(v_raw), 'object') <> 'object' then
        v_raw := '{}'::jsonb;
    end if;

    if coalesce(jsonb_typeof(v_raw -> 'services'), 'object') <> 'object' then
        v_raw := v_raw || jsonb_build_object('services', '{}'::jsonb);
    end if;

    v_configured := coalesce(v_raw ->> 'configured', 'false') = 'true';

    return jsonb_build_object(
        'configured', v_configured,
        'currency', coalesce(nullif(v_raw ->> 'currency', ''), 'GHS'),
        'pricing_version',
            greatest(1, coalesce(public.safe_numeric(v_raw -> 'pricing_version', 1)::int, 1)),
        'base_fare', coalesce(public.safe_numeric(v_raw -> 'base_fare', 0), 0),
        'per_km_rate', coalesce(public.safe_numeric(v_raw -> 'per_km_rate', 0), 0),
        'min_fare', coalesce(public.safe_numeric(v_raw -> 'min_fare', 0), 0),
        -- max_fare is OPTIONAL: absent/null means "no ceiling".
        'max_fare',
            case
                when jsonb_typeof(v_raw -> 'max_fare') in ('number', 'string')
                    then public.safe_numeric(v_raw -> 'max_fare', 0)
            end,
        'booking_fee', coalesce(public.safe_numeric(v_raw -> 'booking_fee', 0), 0),
        'tax_rate_percent', coalesce(public.safe_numeric(v_raw -> 'tax_rate_percent', 0), 0),
        'surge_multiplier', coalesce(public.safe_numeric(v_raw -> 'surge_multiplier', 1), 1),
        'driver_earning_percentage',
            coalesce(public.safe_numeric(v_raw -> 'driver_earning_percentage', 100), 100),
        'quote_ttl_minutes',
            greatest(1, coalesce(public.safe_numeric(v_raw -> 'quote_ttl_minutes', 5)::int, 5)),
        'request_ttl_seconds',
            greatest(15, coalesce(public.safe_numeric(v_raw -> 'request_ttl_seconds', 90)::int, 90)),
        'services', v_raw -> 'services'
    );
end;
$$;

-- The single fare formula. Revoked from clients: only the quote/booking
-- RPCs may call it, so a browser can never negotiate its own price.
create or replace function public.errands_pricing_amounts(
    p_distance_km numeric,
    p_service_category text,
    p_settings jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_s       jsonb := coalesce(p_settings, public.get_errands_pricing_settings());
    v_eff     jsonb;
    v_over    jsonb;
    v_dist    numeric := coalesce(p_distance_km, 0);
    v_base    numeric;
    v_rate    numeric;
    v_min     numeric;
    v_max     numeric;
    v_booking numeric;
    v_tax     numeric;
    v_surge   numeric;
    v_earning numeric;
    v_version int;
    v_trip    numeric;
    v_fees    numeric;
    v_tax_amt numeric;
    v_total   numeric;
begin
    if coalesce(v_s ->> 'configured', 'false') <> 'true' then
        raise exception 'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.';
    end if;

    if p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'RIDE_CAR') then
        raise exception 'That Errands service is not supported.';
    end if;

    -- Per-service overrides replace the shared rules key by key; anything
    -- the operator did not override keeps the platform-wide value.
    v_over := case
        when jsonb_typeof(v_s -> 'services' -> p_service_category) = 'object'
            then v_s -> 'services' -> p_service_category
        else '{}'::jsonb
    end;
    v_eff := (v_s - 'services') || v_over;

    v_base    := coalesce(public.safe_numeric(v_eff -> 'base_fare', 0), 0);
    v_rate    := coalesce(public.safe_numeric(v_eff -> 'per_km_rate', 0), 0);
    v_min     := coalesce(public.safe_numeric(v_eff -> 'min_fare', 0), 0);
    v_max     := case
                    when jsonb_typeof(v_eff -> 'max_fare') in ('number', 'string')
                        then public.safe_numeric(v_eff -> 'max_fare', 0)
                 end;
    v_booking := coalesce(public.safe_numeric(v_eff -> 'booking_fee', 0), 0);
    v_tax     := coalesce(public.safe_numeric(v_eff -> 'tax_rate_percent', 0), 0);
    v_surge   := coalesce(public.safe_numeric(v_eff -> 'surge_multiplier', 1), 1);
    v_earning := coalesce(public.safe_numeric(v_eff -> 'driver_earning_percentage', 100), 100);
    v_version := coalesce(public.safe_numeric(v_eff -> 'pricing_version', 1)::int, 1);

    if v_surge <= 0 then v_surge := 1; end if;
    if v_dist is null or v_dist < 0 then v_dist := 0; end if;
    if v_min < 0 then v_min := 0; end if;
    if v_max is not null and v_max <= 0 then v_max := null; end if;
    if v_booking < 0 then v_booking := 0; end if;
    if v_tax < 0 then v_tax := 0; end if;
    if v_tax > 100 then v_tax := 100; end if;
    if v_earning < 0 then v_earning := 0; end if;
    if v_earning > 100 then v_earning := 100; end if;

    -- Distance component, clamped by the floor and the OPTIONAL ceiling.
    v_trip := round((v_base + v_dist * v_rate) * v_surge, 2);
    if v_min > 0 then v_trip := greatest(v_min, v_trip); end if;
    if v_max is not null then v_trip := least(v_max, v_trip); end if;
    if v_trip < 0 then v_trip := 0; end if;

    -- Configured fees are ADDED after the clamp so a booking fee is never
    -- silently swallowed by the minimum fare.
    v_fees   := v_booking;
    v_tax_amt := round((v_trip + v_fees) * v_tax / 100, 2);
    v_total  := round(v_trip + v_fees + v_tax_amt, 2);
    if v_total < 0 then v_total := 0; end if;

    return jsonb_build_object(
        'configured', true,
        'service_category', p_service_category,
        'distance_km', v_dist,
        'trip_fare', v_trip,
        'booking_fee', v_fees,
        'tax_amount', v_tax_amt,
        'estimated_fare', v_total,
        'driver_earning', round(v_total * v_earning / 100, 2),
        'driver_earning_percentage', v_earning,
        'base_fare', v_base,
        'per_km_rate', v_rate,
        'min_fare', v_min,
        'max_fare', v_max,
        'tax_rate_percent', v_tax,
        'surge_multiplier', v_surge,
        'pricing_version', v_version,
        'currency', coalesce(v_s ->> 'currency', 'GHS')
    );
end;
$$;

-- The ONLY supported way to publish Errands pricing. Validates in the
-- database, bumps `pricing_version` (so every quote and booking can record
-- which rules it used) and writes an audit log entry.
create or replace function public.set_errands_pricing(
    p_base_fare numeric,
    p_per_km_rate numeric,
    p_min_fare numeric,
    p_max_fare numeric,
    p_booking_fee numeric,
    p_tax_rate_percent numeric,
    p_driver_earning_percentage numeric,
    p_surge_multiplier numeric,
    p_services jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_current  jsonb;
    v_version  int;
    v_next     jsonb;
    v_services jsonb := '{}'::jsonb;
    v_key      text;
    v_val      jsonb;
begin
    if auth.uid() is null or not exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can change Errands pricing';
    end if;

    if p_base_fare is null or p_base_fare not between 0 and 9999.99 then
        raise exception 'Base fare must be a number between 0 and 9999.99';
    end if;
    if p_per_km_rate is null or p_per_km_rate not between 0 and 9999.99 then
        raise exception 'Price per kilometre must be a number between 0 and 9999.99';
    end if;
    if p_min_fare is null or p_min_fare not between 0 and 999999.99 then
        raise exception 'Minimum fare must be a number between 0 and 999999.99';
    end if;
    if p_max_fare is not null and p_max_fare not between 0 and 999999.99 then
        raise exception 'Maximum fare must be empty (no cap) or a number between 0 and 999999.99';
    end if;
    if p_max_fare is not null and p_max_fare < p_min_fare then
        raise exception 'The maximum fare cannot be lower than the minimum fare';
    end if;
    if p_booking_fee is null or p_booking_fee not between 0 and 9999.99 then
        raise exception 'Booking fee must be a number between 0 and 9999.99';
    end if;
    if p_tax_rate_percent is null or p_tax_rate_percent not between 0 and 100 then
        raise exception 'Tax rate must be between 0 and 100 percent';
    end if;
    if p_driver_earning_percentage is null
       or p_driver_earning_percentage not between 0 and 100 then
        raise exception 'Driver earning percentage must be between 0 and 100';
    end if;
    if p_surge_multiplier is null or p_surge_multiplier not between 0.1 and 5 then
        raise exception 'Surge multiplier must be between 0.1 and 5 (use 1 when surge pricing is not in effect)';
    end if;

    -- Per-service overrides: only known services, only known keys, only numbers.
    if p_services is not null then
        if jsonb_typeof(p_services) <> 'object' then
            raise exception 'Service pricing overrides must be an object';
        end if;
        for v_key in select jsonb_object_keys(p_services) loop
            if v_key not in ('ERRAND_MOTORCYCLE', 'RIDE_CAR') then
                raise exception 'Unknown Errands service "%"', v_key;
            end if;
            v_val := p_services -> v_key;
            if jsonb_typeof(v_val) <> 'object' then
                raise exception 'The override for "%" must be an object', v_key;
            end if;
            if (v_val - 'base_fare' - 'per_km_rate' - 'min_fare' - 'max_fare' - 'booking_fee')
               <> '{}'::jsonb then
                raise exception 'The override for "%" contains an unsupported key', v_key;
            end if;
            if coalesce(jsonb_typeof(v_val -> 'base_fare'), 'null') not in ('number', 'null')
               or coalesce(jsonb_typeof(v_val -> 'per_km_rate'), 'null') not in ('number', 'null')
               or coalesce(jsonb_typeof(v_val -> 'min_fare'), 'null') not in ('number', 'null')
               or coalesce(jsonb_typeof(v_val -> 'max_fare'), 'null') not in ('number', 'null')
               or coalesce(jsonb_typeof(v_val -> 'booking_fee'), 'null') not in ('number', 'null') then
                raise exception 'The override for "%" must contain only numbers', v_key;
            end if;
            v_services := v_services || jsonb_build_object(
                v_key,
                jsonb_strip_nulls(
                    jsonb_build_object(
                        'base_fare',
                            case when (v_val -> 'base_fare') is not null
                                 then public.safe_numeric(v_val -> 'base_fare', p_base_fare) end,
                        'per_km_rate',
                            case when (v_val -> 'per_km_rate') is not null
                                 then public.safe_numeric(v_val -> 'per_km_rate', p_per_km_rate) end,
                        'min_fare',
                            case when (v_val -> 'min_fare') is not null
                                 then public.safe_numeric(v_val -> 'min_fare', p_min_fare) end,
                        'max_fare',
                            case when jsonb_typeof(v_val -> 'max_fare') in ('number', 'string')
                                 then public.safe_numeric(v_val -> 'max_fare', 0) end,
                        'booking_fee',
                            case when (v_val -> 'booking_fee') is not null
                                 then public.safe_numeric(v_val -> 'booking_fee', p_booking_fee) end
                    )
                )
            );
        end loop;
    end if;

    v_current := public.get_errands_pricing_settings();
    v_version := greatest(1, coalesce((v_current ->> 'pricing_version')::int, 1)) + 1;

    v_next := jsonb_strip_nulls(
        jsonb_build_object(
            'configured', true,
            'currency', coalesce(v_current ->> 'currency', 'GHS'),
            'pricing_version', v_version,
            'base_fare', p_base_fare,
            'per_km_rate', p_per_km_rate,
            'min_fare', p_min_fare,
            'max_fare', p_max_fare,
            'booking_fee', p_booking_fee,
            'tax_rate_percent', p_tax_rate_percent,
            'driver_earning_percentage', p_driver_earning_percentage,
            'surge_multiplier', p_surge_multiplier,
            'quote_ttl_minutes',
                greatest(1, coalesce((v_current ->> 'quote_ttl_minutes')::int, 5)),
            'request_ttl_seconds',
                greatest(15, coalesce((v_current ->> 'request_ttl_seconds')::int, 90)),
            'services', v_services,
            'updated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
    );

    insert into public.platform_settings (key, value, description)
    values ('errands_pricing', v_next,
            'Distance-based Errands & rides pricing (base + per km, min/max, booking fee, tax, surge, driver earning) — versioned, applied to new quotes only')
    on conflict (key) do update
        set value = excluded.value,
            description = excluded.description,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'ERRANDS_PRICING_UPDATED', 'settings', 'errands_pricing', v_next);

    return v_next;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. TABLES
-- ---------------------------------------------------------------------

-- 3a. Per-driver service capabilities. Food-delivery availability NEVER
--     implies passenger transport: `car_rides` starts false for everyone
--     and is granted by a super admin after the operator's own approval
--     process (insurance/licensing is an operational decision, not a
--     checkbox a driver sets about themselves).
create table if not exists public.driver_service_capabilities (
    courier_id          uuid primary key references public.couriers(id) on delete cascade,
    errands_enabled     boolean not null default false,
    motorcycle_errands  boolean not null default true,
    car_rides           boolean not null default false,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

alter table public.driver_service_capabilities enable row level security;

drop trigger if exists trg_driver_service_capabilities_updated_at
    on public.driver_service_capabilities;
create trigger trg_driver_service_capabilities_updated_at
    before update on public.driver_service_capabilities
    for each row execute function public.handle_updated_at();

-- Defence in depth: even if someone later adds an UPDATE policy, a driver
-- can never grant themselves a regulated service category.
create or replace function public.protect_driver_service_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if (new.motorcycle_errands is distinct from old.motorcycle_errands
        or new.car_rides is distinct from old.car_rides)
       and auth.uid() is not null
       and not exists (
           select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
       ) then
        raise exception 'Service capabilities are granted by SamleyGo administration and cannot be changed from the app';
    end if;
    if new.courier_id is distinct from old.courier_id then
        raise exception 'A capability row cannot move to another driver';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_protect_driver_service_capabilities
    on public.driver_service_capabilities;
create trigger trg_protect_driver_service_capabilities
    before update on public.driver_service_capabilities
    for each row execute function public.protect_driver_service_capabilities();

-- 3b. Quotes — short-lived, server-calculated distance + fare.
create table if not exists public.errands_quotes (
    id                       uuid primary key default gen_random_uuid(),
    customer_id              uuid not null references public.profiles(id) on delete cascade,
    service_category         text not null,
    -- Snapshot of both endpoints at quote time (audit trail).
    pickup_address           text not null,
    pickup_latitude          double precision not null,
    pickup_longitude         double precision not null,
    destination_address      text not null,
    destination_latitude     double precision not null,
    destination_longitude    double precision not null,
    -- Distance actually used for pricing.
    straight_line_km         numeric(6,3) not null,
    distance_km              numeric(6,2) not null,
    distance_source          text not null default 'STRAIGHT_LINE',
    estimated_duration_seconds integer,
    -- Pricing rules the quote was priced with (versioning snapshot).
    base_fare                numeric(10,2) not null,
    per_km_rate              numeric(10,2) not null,
    min_fare                 numeric(10,2) not null,
    max_fare                 numeric(10,2),
    booking_fee              numeric(10,2) not null default 0,
    tax_rate_percent         numeric(5,2) not null default 0,
    surge_multiplier         numeric(6,3) not null default 1.000,
    driver_earning_percentage numeric(5,2) not null default 100.00,
    pricing_version          integer not null default 1,
    -- Money.
    estimated_fare           numeric(10,2) not null,
    driver_earning           numeric(10,2) not null,
    currency                 text not null default 'GHS',
    -- Lifecycle.
    expires_at               timestamptz not null,
    consumed_at              timestamptz,
    created_at               timestamptz not null default now(),
    constraint errands_quotes_service_check
        check (service_category in ('ERRAND_MOTORCYCLE', 'RIDE_CAR')),
    constraint errands_quotes_source_check
        check (distance_source in ('ROAD_ROUTE', 'STRAIGHT_LINE')),
    constraint errands_quotes_distance_check
        check (distance_km between 0.01 and 9999.99),
    constraint errands_quotes_fare_check
        check (estimated_fare between 0 and 99999999.99),
    constraint errands_quotes_earning_check
        check (driver_earning between 0 and 99999999.99),
    constraint errands_quotes_expiry_check
        check (expires_at > created_at)
);

create index if not exists idx_errands_quotes_customer
    on public.errands_quotes(customer_id, created_at desc);
create index if not exists idx_errands_quotes_open
    on public.errands_quotes(expires_at)
    where consumed_at is null;

alter table public.errands_quotes enable row level security;

-- 3c. Bookings — the customer-visible, driver-visible lifecycle row.
--     Exact coordinates, addresses and contact data live in 3d so a driver
--     never sees them before accepting.
create table if not exists public.errands_bookings (
    id                       uuid primary key default gen_random_uuid(),
    booking_number           text unique not null,
    customer_id              uuid not null references public.profiles(id) on delete cascade,
    driver_id                uuid not null references public.profiles(id),
    service_category         text not null,
    status                   text not null default 'REQUESTED',
    -- Coarse areas only — shared with the driver BEFORE acceptance.
    pickup_area              text not null,
    destination_area         text not null,
    -- Route + fare snapshot (server-written, immutable from clients).
    route_distance_km        numeric(6,2) not null,
    distance_source          text not null default 'STRAIGHT_LINE',
    estimated_duration_seconds integer,
    estimated_fare           numeric(10,2) not null,
    final_fare               numeric(10,2),
    driver_earning           numeric(10,2) not null,
    currency                 text not null default 'GHS',
    pricing_version          integer not null default 1,
    quote_id                 uuid references public.errands_quotes(id) on delete set null,
    -- Request lifecycle.
    requested_expires_at     timestamptz not null,
    accepted_at              timestamptz,
    arrived_at               timestamptz,
    started_at               timestamptz,
    completed_at             timestamptz,
    cancelled_at             timestamptz,
    cancelled_by             uuid references public.profiles(id),
    cancellation_reason      text,
    failure_note             text,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    constraint errands_bookings_service_check
        check (service_category in ('ERRAND_MOTORCYCLE', 'RIDE_CAR')),
    constraint errands_bookings_status_check
        check (status in ('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                          'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED',
                          'CANCELLED', 'EXPIRED', 'FAILED')),
    constraint errands_bookings_distance_check
        check (route_distance_km between 0.01 and 9999.99),
    constraint errands_bookings_source_check
        check (distance_source in ('ROAD_ROUTE', 'STRAIGHT_LINE')),
    constraint errands_bookings_money_check
        check (estimated_fare between 0 and 99999999.99
               and driver_earning between 0 and 99999999.99
               and (final_fare is null or final_fare between 0 and 99999999.99)),
    constraint errands_bookings_request_expiry_check
        check (requested_expires_at > created_at)
);

create index if not exists idx_errands_bookings_customer
    on public.errands_bookings(customer_id, created_at desc);
create index if not exists idx_errands_bookings_driver
    on public.errands_bookings(driver_id, status);
create index if not exists idx_errands_bookings_status
    on public.errands_bookings(status, created_at desc);
create index if not exists idx_errands_bookings_driver_active
    on public.errands_bookings(driver_id)
    where status in ('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                     'DRIVER_ARRIVED', 'IN_PROGRESS');
create index if not exists idx_errands_bookings_customer_active
    on public.errands_bookings(customer_id)
    where status in ('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                     'DRIVER_ARRIVED', 'IN_PROGRESS');

alter table public.errands_bookings enable row level security;

drop trigger if exists trg_errands_bookings_updated_at on public.errands_bookings;
create trigger trg_errands_bookings_updated_at
    before update on public.errands_bookings
    for each row execute function public.handle_updated_at();

-- 3d. Booking details — exact route endpoints + contact data. The customer
--     can always read their own; the driver only AFTER accepting.
create table if not exists public.errands_booking_details (
    booking_id              uuid primary key references public.errands_bookings(id) on delete cascade,
    pickup_latitude         double precision not null,
    pickup_longitude        double precision not null,
    pickup_address          text not null,
    destination_latitude    double precision not null,
    destination_longitude   double precision not null,
    destination_address     text not null,
    customer_name           text,
    customer_phone          text,
    -- Driver snapshot so the customer sees the right bike/car even if the
    -- driver later edits their profile.
    driver_name             text,
    driver_avatar_url       text,
    driver_vehicle_type     text,
    driver_vehicle_plate    text,
    driver_rating           numeric(3,2),
    created_at              timestamptz not null default now()
);

alter table public.errands_booking_details enable row level security;

-- 3e. Append-only transition history (support & audit).
create table if not exists public.errands_status_history (
    id          uuid primary key default gen_random_uuid(),
    booking_id  uuid not null references public.errands_bookings(id) on delete cascade,
    from_status text,
    to_status   text not null,
    changed_by  uuid references public.profiles(id),
    note        text,
    created_at  timestamptz not null default now()
);

create index if not exists idx_errands_status_history_booking
    on public.errands_status_history(booking_id, created_at);

alter table public.errands_status_history enable row level security;

-- 3f. Trip-start PINs — kept in their OWN table on purpose. The driver must
--     be able to type the PIN but never to read it: RLS below only lets the
--     customer who booked and a super admin select this row, so a curious
--     driver querying their own passenger's booking cannot fish the PIN out.
create table if not exists public.errands_booking_pins (
    booking_id  uuid primary key references public.errands_bookings(id) on delete cascade,
    trip_pin    text not null,
    created_at  timestamptz not null default now(),
    constraint errands_booking_pins_pin_check check (trip_pin ~ '^[0-9]{4}$')
);

alter table public.errands_booking_pins enable row level security;

-- ---------------------------------------------------------------------
-- 4. RLS
--    Quotes / details / history are created by SECURITY DEFINER functions
--    only: no INSERT, UPDATE or DELETE policy exists on purpose, so the
--    browser can never write money, coordinates or status directly.
-- ---------------------------------------------------------------------

drop policy if exists "Customers can view their Errands quotes" on public.errands_quotes;
create policy "Customers can view their Errands quotes" on public.errands_quotes
    for select using (
        customer_id = auth.uid() or exists (
            select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );

drop policy if exists "Errands bookings are visible to their participants" on public.errands_bookings;
create policy "Errands bookings are visible to their participants"
    on public.errands_bookings
    for select using (
        customer_id = auth.uid()
        or driver_id = auth.uid()
        or exists (
            select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );

drop policy if exists "Errands booking details follow the booking" on public.errands_booking_details;
create policy "Errands booking details follow the booking"
    on public.errands_booking_details
    for select using (
        -- The customer (and the platform) always see their own endpoints…
        exists (
            select 1 from public.errands_bookings b
             where b.id = booking_id
               and (b.customer_id = auth.uid()
                    or exists (
                        select 1 from public.profiles p
                         where p.id = auth.uid() and p.role = 'SUPER_ADMIN'
                    ))
        )
        -- …the driver only once they have accepted the booking.
        or exists (
            select 1 from public.errands_bookings b
             where b.id = booking_id
               and b.driver_id = auth.uid()
               and b.accepted_at is not null
        )
    );

drop policy if exists "Errands status history follows the booking" on public.errands_status_history;
create policy "Errands status history follows the booking"
    on public.errands_status_history
    for select using (
        exists (
            select 1 from public.errands_bookings b
             where b.id = booking_id
               and (b.customer_id = auth.uid()
                    or b.driver_id = auth.uid()
                    or exists (
                        select 1 from public.profiles p
                         where p.id = auth.uid() and p.role = 'SUPER_ADMIN'
                    ))
        )
    );

drop policy if exists "Drivers read their own service capabilities" on public.driver_service_capabilities;
create policy "Drivers read their own service capabilities"
    on public.driver_service_capabilities
    for select using (
        courier_id = auth.uid() or exists (
            select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );

-- The trip PIN is customer/admin-only: the driver submits it but the row is
-- never readable by them (the status RPC compares it server-side instead).
drop policy if exists "Trip PINs are visible to the customer and admins" on public.errands_booking_pins;
create policy "Trip PINs are visible to the customer and admins"
    on public.errands_booking_pins
    for select using (
        exists (
            select 1 from public.errands_bookings b
             where b.id = booking_id
               and (b.customer_id = auth.uid()
                    or exists (
                        select 1 from public.profiles p
                         where p.id = auth.uid() and p.role = 'SUPER_ADMIN'
                    ))
        )
    );

-- Grants: strip the Supabase default (ALL to anon/authenticated) and hand
-- back only what each role needs.
revoke all on table public.errands_quotes from anon;
revoke all on table public.errands_bookings from anon;
revoke all on table public.errands_booking_details from anon;
revoke all on table public.errands_status_history from anon;
revoke all on table public.errands_booking_pins from anon;
revoke all on table public.driver_service_capabilities from anon;

grant select on table public.errands_quotes to authenticated;
grant select on table public.errands_bookings to authenticated;
grant select on table public.errands_booking_details to authenticated;
grant select on table public.errands_status_history to authenticated;
grant select on table public.errands_booking_pins to authenticated;
grant select on table public.driver_service_capabilities to authenticated;

grant all on table public.errands_quotes to service_role;
grant all on table public.errands_bookings to service_role;
grant all on table public.errands_booking_details to service_role;
grant all on table public.errands_status_history to service_role;
grant all on table public.errands_booking_pins to service_role;
grant all on table public.driver_service_capabilities to service_role;

-- ---------------------------------------------------------------------
-- 5. ELIGIBILITY — ONE function, used by discovery AND booking, so the
--    driver a customer sees is exactly the driver the database will let
--    them book.
--
--    A driver is eligible for a service only when ALL of this holds:
--      * account approved and identity verification APPROVED
--      * online, availability_status = AVAILABLE (not mid-job)
--      * opted in to Errands (driver_service_capabilities.errands_enabled)
--      * the service category is enabled by the operator
--      * the vehicle supports that category AND the capability allows it
--      * the last location write is fresher than 2 minutes
--      * no active Errands booking and no active food delivery
-- ---------------------------------------------------------------------
create or replace function public.errands_driver_is_available(
    p_driver_id uuid,
    p_service_category text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_c record;
begin
    if p_driver_id is null
       or p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'RIDE_CAR') then
        return false;
    end if;

    if not public.errands_service_enabled(p_service_category) then
        return false;
    end if;

    select c.id,
           c.vehicle_type,
           c.is_approved,
           c.verification_status,
           c.is_online,
           c.availability_status,
           c.current_location_updated_at,
           coalesce(cap.errands_enabled, false)  as errands_enabled,
           coalesce(cap.motorcycle_errands, false) as motorcycle_errands,
           coalesce(cap.car_rides, false)        as car_rides,
           pr.role
      into v_c
      from public.couriers c
      join public.profiles pr on pr.id = c.id
      left join public.driver_service_capabilities cap on cap.courier_id = c.id
     where c.id = p_driver_id;

    if not found then
        return false;
    end if;

    if v_c.role <> 'COURIER' then return false; end if;
    if coalesce(v_c.is_approved, false) = false then return false; end if;
    if v_c.verification_status <> 'APPROVED' then return false; end if;
    if coalesce(v_c.is_online, false) = false then return false; end if;
    if v_c.availability_status <> 'AVAILABLE' then return false; end if;

    -- A stale position is never presented as "live".
    if v_c.current_location_updated_at is null
       or v_c.current_location_updated_at < now() - interval '2 minutes' then
        return false;
    end if;

    if v_c.errands_enabled = false then return false; end if;

    if p_service_category = 'ERRAND_MOTORCYCLE' then
        if v_c.vehicle_type not in ('Motorcycle', 'Bicycle') then return false; end if;
        if v_c.motorcycle_errands = false then return false; end if;
    elsif p_service_category = 'RIDE_CAR' then
        if v_c.vehicle_type <> 'Car' then return false; end if;
        if v_c.car_rides = false then return false; end if;
    end if;

    -- Not already committed to an incompatible job (either module).
    if exists (
        select 1 from public.errands_bookings b
         where b.driver_id = p_driver_id
           and b.status in ('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                            'DRIVER_ARRIVED', 'IN_PROGRESS')
    ) then
        return false;
    end if;

    if exists (
        select 1 from public.orders o
         where o.courier_id = p_driver_id
           and o.status in ('COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP',
                            'ON_THE_WAY', 'ARRIVED')
    ) then
        return false;
    end if;

    return true;
end;
$$;

comment on function public.errands_driver_is_available(uuid, text) IS
    'The single eligibility rule for Errands discovery and booking. SECURITY DEFINER so a customer can be told "available" without read access to private courier rows.';

-- Rejects anything that is not a real, precise endpoint. Raises the exact
-- customer-facing message the Errands screens surface. Defined here because
-- discovery and the quote RPC below both call it.
create or replace function public.assert_errands_location(
    p_lat double precision,
    p_lng double precision
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
    if p_lat is null or p_lng is null
       or p_lat not between -90 and 90
       or p_lng not between -180 and 180
       or (abs(p_lat) < 0.000001 and abs(p_lng) < 0.000001) then
        raise exception 'Please select a valid pickup and destination location to calculate the fare.';
    end if;
end;
$$;

-- Coarse, privacy-safe area label for what the driver sees BEFORE they
-- accept: first address segment, street number stripped, 60 chars max.
create or replace function public.errands_area_label(p_address text)
returns text
language sql
immutable
set search_path = public
as $$
    select nullif(
        left(
            regexp_replace(
                coalesce(nullif(split_part(coalesce(p_address, ''), ',', 1), ''),
                         coalesce(p_address, '')),
                '^\s*[0-9]+[A-Za-z]?\s*',
                ''
            ),
            60
        ),
        ''
    );
$$;

-- ---------------------------------------------------------------------
-- 6. DISCOVERY — nearby eligible drivers for a pickup point.
--    Returns ONLY the fields the map/list need (minimal disclosure): no
--    plate, no phone, no verification documents, and a location only when
--    it is genuinely fresh.
-- ---------------------------------------------------------------------
create or replace function public.errands_nearby_drivers(
    p_lat double precision,
    p_lng double precision,
    p_service_category text,
    p_radius_km numeric default 15,
    p_limit integer default 25
)
returns table (
    driver_id uuid,
    full_name text,
    avatar_url text,
    vehicle_type text,
    vehicle_category text,
    rating numeric,
    total_deliveries integer,
    latitude double precision,
    longitude double precision,
    location_updated_at timestamptz,
    location_age_seconds integer,
    distance_km numeric,
    is_verified boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_radius numeric;
    v_limit  integer;
begin
    -- Discovery requires a signed-in user: anonymous callers get nothing.
    if auth.uid() is null then
        return;
    end if;

    if p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'RIDE_CAR') then
        return;
    end if;

    if not public.errands_service_enabled(p_service_category) then
        return;
    end if;

    perform public.assert_errands_location(p_lat, p_lng);

    v_radius := coalesce(p_radius_km, 15);
    if v_radius <= 0 then v_radius := 15; end if;
    if v_radius > 50 then v_radius := 50; end if;

    v_limit := coalesce(p_limit, 25);
    if v_limit < 1 then v_limit := 25; end if;
    if v_limit > 50 then v_limit := 50; end if;

    return query
    select
        c.id as driver_id,
        pr.full_name,
        pr.avatar_url,
        c.vehicle_type,
        case when p_service_category = 'RIDE_CAR' then 'CAR' else 'MOTORCYCLE' end
            as vehicle_category,
        c.rating,
        c.total_deliveries,
        c.current_latitude as latitude,
        c.current_longitude as longitude,
        c.current_location_updated_at as location_updated_at,
        greatest(0, round(extract(epoch from (now() - c.current_location_updated_at)))::int)
            as location_age_seconds,
        round(
            public.haversine_km(p_lat, p_lng, c.current_latitude, c.current_longitude), 2
        ) as distance_km,
        true as is_verified
    from public.couriers c
    join public.profiles pr on pr.id = c.id
    where c.current_latitude is not null
      and c.current_longitude is not null
      and public.errands_driver_is_available(c.id, p_service_category)
      and public.haversine_km(p_lat, p_lng, c.current_latitude, c.current_longitude)
          <= v_radius
    order by public.haversine_km(p_lat, p_lng, c.current_latitude, c.current_longitude),
             c.rating desc
    limit v_limit;
end;
$$;

comment on function public.errands_nearby_drivers(double precision, double precision, text, numeric, integer) IS
    'Eligible, live, fresh-positioned drivers around a pickup point for one service category. Returns no plate/phone/verification data.';

-- ---------------------------------------------------------------------
-- 7. QUOTE — the trusted fare calculator.
--    * validates both endpoints (no (0,0) sentinels, inside world bounds)
--    * measures the crow-fly distance itself
--    * accepts a client road distance ONLY when plausible against it
--    * prices with the CURRENT configured rules (refuses when unconfigured)
--    * stores a full auditable snapshot with a TTL
-- ---------------------------------------------------------------------
create or replace function public.create_errands_quote(
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_pickup_address text,
    p_dest_lat double precision,
    p_dest_lng double precision,
    p_dest_address text,
    p_service_category text,
    p_road_distance_km numeric default null,
    p_road_duration_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_straight  numeric;
    v_distance  numeric;
    v_source    text;
    v_duration  integer := null;
    v_settings  jsonb;
    v_amounts   jsonb;
    v_quote_id  uuid;
    v_expires   timestamptz;
    v_pickup    text;
    v_dest      text;
begin
    if v_uid is null then
        raise exception 'Sign in to see your Errands fare.';
    end if;

    if p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'RIDE_CAR') then
        raise exception 'That Errands service is not supported.';
    end if;

    perform public.assert_errands_location(p_pickup_lat, p_pickup_lng);
    perform public.assert_errands_location(p_dest_lat, p_dest_lng);

    if p_pickup_lat = p_dest_lat and p_pickup_lng = p_dest_lng then
        raise exception 'Pickup and destination are the same place — choose a real destination.';
    end if;

    if not public.errands_service_enabled(p_service_category) then
        raise exception 'This service is not available right now.';
    end if;

    v_pickup := left(coalesce(nullif(trim(p_pickup_address), ''),
                              concat(p_pickup_lat, ', ', p_pickup_lng)), 300);
    v_dest   := left(coalesce(nullif(trim(p_dest_address), ''),
                              concat(p_dest_lat, ', ', p_dest_lng)), 300);

    -- Server-side measurement of pickup -> destination.
    v_straight := round(
        public.haversine_km(p_pickup_lat, p_pickup_lng, p_dest_lat, p_dest_lng), 2);

    v_distance := v_straight;
    v_source   := 'STRAIGHT_LINE';

    -- A routing-service distance is only believable when it is at least
    -- the crow-fly distance (minus rounding slack) and not an absurd
    -- detour; otherwise the server's own measurement is priced instead.
    if p_road_distance_km is not null and p_road_distance_km > 0 then
        if p_road_distance_km >= greatest(0.01, v_straight * 0.90)
           and p_road_distance_km <= greatest(1.0, v_straight * 3.0)
           and p_road_distance_km <= 9999.99 then
            v_distance := round(p_road_distance_km, 2);
            v_source   := 'ROAD_ROUTE';
        end if;
    end if;

    if v_distance is null or v_distance < 0.01 then
        v_distance := 0.01;
    end if;

    if p_road_duration_seconds is not null
       and p_road_duration_seconds between 30 and 86400 then
        v_duration := p_road_duration_seconds;
    end if;

    -- Raises the honest "not configured" message when nobody has set fares.
    v_settings := public.get_errands_pricing_settings();
    v_amounts  := public.errands_pricing_amounts(v_distance, p_service_category, v_settings);
    v_expires  := now() + make_interval(mins => greatest(
                       1, coalesce((v_settings ->> 'quote_ttl_minutes')::int, 5)));

    -- Housekeeping: forget this customer's stale, unused quotes.
    delete from public.errands_quotes
     where customer_id = v_uid
       and consumed_at is null
       and expires_at < now() - interval '1 day';

    insert into public.errands_quotes (
        customer_id, service_category,
        pickup_address, pickup_latitude, pickup_longitude,
        destination_address, destination_latitude, destination_longitude,
        straight_line_km, distance_km, distance_source, estimated_duration_seconds,
        base_fare, per_km_rate, min_fare, max_fare, booking_fee, tax_rate_percent,
        surge_multiplier, driver_earning_percentage, pricing_version,
        estimated_fare, driver_earning, currency,
        expires_at
    ) values (
        v_uid, p_service_category,
        v_pickup, p_pickup_lat, p_pickup_lng,
        v_dest, p_dest_lat, p_dest_lng,
        v_straight, v_distance, v_source, v_duration,
        (v_amounts ->> 'base_fare')::numeric,
        (v_amounts ->> 'per_km_rate')::numeric,
        (v_amounts ->> 'min_fare')::numeric,
        case when v_amounts -> 'max_fare' is not null
                  and jsonb_typeof(v_amounts -> 'max_fare') in ('number', 'string')
             then (v_amounts ->> 'max_fare')::numeric end,
        (v_amounts ->> 'booking_fee')::numeric,
        (v_amounts ->> 'tax_rate_percent')::numeric,
        (v_amounts ->> 'surge_multiplier')::numeric,
        (v_amounts ->> 'driver_earning_percentage')::numeric,
        (v_amounts ->> 'pricing_version')::int,
        (v_amounts ->> 'estimated_fare')::numeric,
        (v_amounts ->> 'driver_earning')::numeric,
        v_amounts ->> 'currency',
        v_expires
    ) returning id into v_quote_id;

    return v_amounts || jsonb_build_object(
        'quote_id', v_quote_id,
        'pickup_address', v_pickup,
        'destination_address', v_dest,
        'straight_line_km', v_straight,
        'distance_km', v_distance,
        'distance_source', v_source,
        'estimated_duration_seconds', v_duration,
        'issued_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expires_at', to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
end;
$$;

-- ---------------------------------------------------------------------
-- 8. BOOKING — ATOMIC driver reservation.
--
--    The courier row is locked FOR UPDATE first, so two customers racing
--    for the same driver serialize: the first commit wins, the second one
--    fails the eligibility re-check with an honest message. The quote is
--    revalidated (owner, expiry, single use) and the fare copied from the
--    server's own snapshot — the browser never submits money.
-- ---------------------------------------------------------------------
create or replace function public.create_errands_booking(
    p_quote_id uuid,
    p_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid         uuid := auth.uid();
    v_quote       public.errands_quotes%rowtype;
    v_profile     record;
    v_driver      record;
    v_settings    jsonb;
    v_ttl         integer;
    v_booking_id  uuid;
    v_number      text;
    v_pin         text := null;
    v_count       integer;
begin
    if v_uid is null then
        raise exception 'Sign in to book an Errand.';
    end if;
    if p_quote_id is null or p_driver_id is null then
        raise exception 'Select a driver to continue.';
    end if;

    -- One active Errand per customer keeps the flow (and support) sane.
    select count(*) into v_count
      from public.errands_bookings
     where customer_id = v_uid
       and status in ('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                      'DRIVER_ARRIVED', 'IN_PROGRESS');
    if v_count > 0 then
        raise exception 'You already have an Errand in progress. Finish or cancel it first.';
    end if;

    -- 1. Lock the driver: this is the concurrency barrier.
    select c.id, c.vehicle_type, c.vehicle_plate, c.rating, p2.full_name, p2.avatar_url
      into v_driver
      from public.couriers c
      join public.profiles p2 on p2.id = c.id
     where c.id = p_driver_id
       for update of c;

    if not found then
        raise exception 'That driver is no longer available. Please select another eligible driver.';
    end if;

    -- 2. Revalidate the quote: right customer, not expired, not reused.
    select * into v_quote from public.errands_quotes where id = p_quote_id;
    if not found or v_quote.customer_id <> v_uid then
        raise exception 'This fare quote is no longer valid. Please request a fresh quote.';
    end if;
    if v_quote.consumed_at is not null then
        raise exception 'This fare quote has already been used. Please request a fresh quote.';
    end if;
    if v_quote.expires_at <= now() then
        raise exception 'This fare has expired. Refresh to get a current price.';
    end if;

    if not public.errands_service_enabled(v_quote.service_category) then
        raise exception 'This service is not available right now.';
    end if;

    -- 3. Revalidate the driver under the lock: approved, online, fresh,
    --    opted in, right vehicle, and not busy in either module.
    if not public.errands_driver_is_available(p_driver_id, v_quote.service_category) then
        raise exception 'That driver just became unavailable. Please select another eligible driver.';
    end if;

    -- 4. Build the booking row (areas only — exact endpoints stay in details).
    v_number := concat('ER-', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    v_settings := public.get_errands_pricing_settings();
    v_ttl := greatest(15, coalesce((v_settings ->> 'request_ttl_seconds')::int, 90));

    if v_quote.service_category = 'RIDE_CAR' then
        -- The passenger PIN lives in its own table: the driver types it to
        -- start the trip but RLS never lets them read it back.
        v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
    end if;

    insert into public.errands_bookings (
        booking_number, customer_id, driver_id, service_category, status,
        pickup_area, destination_area,
        route_distance_km, distance_source, estimated_duration_seconds,
        estimated_fare, driver_earning, currency, pricing_version, quote_id,
        requested_expires_at
    ) values (
        v_number,
        v_uid,
        p_driver_id,
        v_quote.service_category,
        'REQUESTED',
        coalesce(public.errands_area_label(v_quote.pickup_address),
                 left(split_part(v_quote.pickup_address, ',', 1), 120), 'Pickup area'),
        coalesce(public.errands_area_label(v_quote.destination_address),
                 left(split_part(v_quote.destination_address, ',', 1), 120), 'Destination area'),
        v_quote.distance_km,
        v_quote.distance_source,
        v_quote.estimated_duration_seconds,
        v_quote.estimated_fare,
        v_quote.driver_earning,
        v_quote.currency,
        v_quote.pricing_version,
        v_quote.id,
        now() + make_interval(secs => v_ttl)
    ) returning id into v_booking_id;

    if v_pin is not null then
        insert into public.errands_booking_pins (booking_id, trip_pin)
        values (v_booking_id, v_pin)
        on conflict (booking_id) do update set trip_pin = excluded.trip_pin;
    end if;

    -- Exact endpoints + contact data: visible to the customer immediately,
    -- to the driver only after acceptance (RLS below).
    insert into public.errands_booking_details (
        booking_id,
        pickup_latitude, pickup_longitude, pickup_address,
        destination_latitude, destination_longitude, destination_address,
        customer_name, customer_phone,
        driver_name, driver_avatar_url, driver_vehicle_type, driver_vehicle_plate,
        driver_rating
    )
    select
        v_booking_id,
        v_quote.pickup_latitude, v_quote.pickup_longitude, v_quote.pickup_address,
        v_quote.destination_latitude, v_quote.destination_longitude, v_quote.destination_address,
        cp.full_name, cp.phone,
        v_driver.full_name, v_driver.avatar_url, v_driver.vehicle_type,
        v_driver.vehicle_plate, v_driver.rating
    from public.profiles cp
    where cp.id = v_uid;

    -- 5. Consume the quote and reserve the driver's availability.
    update public.errands_quotes
       set consumed_at = now()
     where id = v_quote.id and consumed_at is null;

    update public.couriers
       set availability_status = 'ON_DELIVERY',
           last_seen_at = now()
     where id = p_driver_id;

    insert into public.errands_status_history (booking_id, from_status, to_status, changed_by, note)
    values (v_booking_id, null, 'REQUESTED', v_uid,
            'Booking created and reserved for the selected driver.');

    -- 6. Notify the driver through the existing notification channel.
    insert into public.notifications (user_id, title, message, type, link)
    values (
        p_driver_id,
        'New Errands request',
        concat('A customer requested a ',
               case when v_quote.service_category = 'RIDE_CAR' then 'ride' else 'delivery' end,
               ' · ', left(split_part(v_quote.pickup_address, ',', 1), 60),
               ' · earning ', v_quote.driver_earning, ' ', v_quote.currency),
        'ERRANDS_REQUEST',
        '/courier/dashboard'
    );

    return jsonb_build_object(
        'booking_id', v_booking_id,
        'booking_number', v_number,
        'status', 'REQUESTED',
        'service_category', v_quote.service_category,
        'estimated_fare', v_quote.estimated_fare,
        'driver_earning', v_quote.driver_earning,
        'currency', v_quote.currency,
        'route_distance_km', v_quote.distance_km,
        -- The caller IS the customer (auth.uid() owned the quote), so the
        -- passenger PIN is returned here for display — the driver's own RPC
        -- path never receives it.
        'trip_pin', v_pin,
        'expires_at', to_char((now() + make_interval(secs => v_ttl))
                              at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
end;
$$;

-- Convenience payload for the RPC callers (full row + exact details when
-- the caller is allowed to see them). SECURITY DEFINER so the driver path
-- does not fight the details policy while it is still flipping — which is
-- exactly why the visibility rules are repeated IN this function: before
-- acceptance a driver gets areas only, never coordinates, addresses or the
-- customer's phone, and never the trip PIN.
create or replace function public.errands_booking_payload(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_row public.errands_bookings%rowtype;
    v_detail public.errands_booking_details%rowtype;
    v_is_admin boolean := false;
    v_is_customer boolean := false;
    v_is_driver boolean := false;
    v_details_visible boolean := false;
    v_pin text;
begin
    select * into v_row from public.errands_bookings where id = p_booking_id;
    if not found then
        return null;
    end if;

    if v_uid is null then
        return null;
    end if;

    v_is_customer := v_row.customer_id = v_uid;
    v_is_driver   := v_row.driver_id = v_uid;
    v_is_admin    := exists (
        select 1 from public.profiles where id = v_uid and role = 'SUPER_ADMIN'
    );

    if not (v_is_customer or v_is_driver or v_is_admin) then
        return null;
    end if;

    -- Exact endpoints/contact data: the customer and the platform always,
    -- the driver only once they have accepted.
    v_details_visible := v_is_customer or v_is_admin
                         or (v_is_driver and v_row.accepted_at is not null);

    if v_details_visible then
        select * into v_detail
          from public.errands_booking_details
         where booking_id = p_booking_id;
    end if;

    -- The passenger PIN is for the customer (and the platform) to DISPLAY;
    -- the driver submits it through errands_set_booking_status but never
    -- receives it here.
    if v_is_customer or v_is_admin then
        select t.trip_pin into v_pin
          from public.errands_booking_pins t
         where t.booking_id = p_booking_id;
    end if;

    return to_jsonb(v_row)
        || jsonb_build_object(
               'details', case when v_details_visible
                               then to_jsonb(v_detail)
                               else 'null'::jsonb end,
               'trip_pin', v_pin
           );
end;
$$;

-- ---------------------------------------------------------------------
-- 9. STATUS TRANSITIONS — validated server-side, audited, with role rules.
--
--    REQUESTED -> DRIVER_ACCEPTED -> (DRIVER_ARRIVING) -> DRIVER_ARRIVED
--              -> IN_PROGRESS -> COMPLETED
--    + CANCELLED / EXPIRED / FAILED. Customers cannot move a booking they
--    do not own, drivers cannot touch somebody else's, and money/status
--    never comes from the request body — it is derived from the row.
-- ---------------------------------------------------------------------
create or replace function public.errands_set_booking_status(
    p_booking_id uuid,
    p_new_status text,
    p_note text default null,
    p_trip_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := auth.uid();
    v_booking public.errands_bookings%rowtype;
    v_actor   text;
    v_allowed boolean := false;
    v_pin     text;
begin
    if v_uid is null then
        raise exception 'Sign in to update this booking.';
    end if;
    if p_booking_id is null or p_new_status is null then
        raise exception 'Missing booking or status.';
    end if;

    -- Lock the row: two devices tapping at once serialize here.
    select * into v_booking
      from public.errands_bookings
     where id = p_booking_id
       for update;

    if not found then
        raise exception 'Booking not found.';
    end if;

    if exists (select 1 from public.profiles where id = v_uid and role = 'SUPER_ADMIN') then
        v_actor := 'ADMIN';
    elsif v_booking.driver_id = v_uid then
        v_actor := 'DRIVER';
    elsif v_booking.customer_id = v_uid then
        v_actor := 'CUSTOMER';
    else
        raise exception 'You do not have access to this booking.';
    end if;

    if v_booking.status = p_new_status then
        -- Idempotent replay (double tap / lost response): report the row
        -- as it stands instead of corrupting the history.
        return public.errands_booking_payload(v_booking.id);
    end if;

    case p_new_status
        when 'DRIVER_ACCEPTED' then
            v_allowed := v_actor = 'DRIVER' and v_booking.status = 'REQUESTED';
        when 'DRIVER_ARRIVING' then
            v_allowed := v_actor = 'DRIVER' and v_booking.status = 'DRIVER_ACCEPTED';
        when 'DRIVER_ARRIVED' then
            v_allowed := v_actor = 'DRIVER'
                         and v_booking.status in ('DRIVER_ACCEPTED', 'DRIVER_ARRIVING');
        when 'IN_PROGRESS' then
            v_allowed := v_actor = 'DRIVER' and v_booking.status = 'DRIVER_ARRIVED';
        when 'COMPLETED' then
            v_allowed := v_actor = 'DRIVER' and v_booking.status = 'IN_PROGRESS';
        when 'CANCELLED' then
            v_allowed := v_actor in ('DRIVER', 'CUSTOMER', 'ADMIN')
                         and v_booking.status in ('REQUESTED', 'DRIVER_ACCEPTED',
                                                  'DRIVER_ARRIVING', 'DRIVER_ARRIVED');
        when 'FAILED' then
            v_allowed := v_actor in ('DRIVER', 'ADMIN')
                         and v_booking.status in ('DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                                                  'DRIVER_ARRIVED', 'IN_PROGRESS');
        when 'EXPIRED' then
            v_allowed := v_actor in ('DRIVER', 'CUSTOMER', 'ADMIN')
                         and v_booking.status = 'REQUESTED'
                         and v_booking.requested_expires_at <= now();
        else
            v_allowed := false;
    end case;

    if not v_allowed then
        raise exception 'This booking cannot move from % to %.', v_booking.status, p_new_status;
    end if;

    -- Passenger rides require a trip-start PIN. The PIN is read from the
    -- customer-only table here (SECURITY DEFINER), compared in the database
    -- and never returned: the driver submits it but cannot read it.
    if p_new_status = 'IN_PROGRESS' then
        if v_booking.service_category = 'RIDE_CAR' then
            select t.trip_pin into v_pin
              from public.errands_booking_pins t
             where t.booking_id = v_booking.id;

            -- ltrim/right handles a driver typing "123" for PIN "0123".
            if v_pin is null or p_trip_pin is null
               or right('0000' || ltrim(p_trip_pin, '0'), 4) is distinct from v_pin then
                raise exception 'The trip PIN is incorrect. Ask the customer for the 4-digit PIN shown on their booking.';
            end if;
        end if;
    end if;

    update public.errands_bookings
       set status = p_new_status,
           accepted_at   = case when p_new_status = 'DRIVER_ACCEPTED'   then now() else accepted_at end,
           arrived_at    = case when p_new_status = 'DRIVER_ARRIVED'    then now() else arrived_at end,
           started_at    = case when p_new_status = 'IN_PROGRESS'       then now() else started_at end,
           completed_at  = case when p_new_status = 'COMPLETED'         then now() else completed_at end,
           cancelled_at  = case when p_new_status = 'CANCELLED'         then now() else cancelled_at end,
           cancelled_by  = case when p_new_status = 'CANCELLED'         then v_uid else cancelled_by end,
           cancellation_reason = case when p_new_status = 'CANCELLED'
                                      then coalesce(p_note, 'Cancelled') end,
           failure_note  = case when p_new_status = 'FAILED' then coalesce(p_note, 'Trip failed') end,
           -- The fare charged is the quoted fare unless a rule says
           -- otherwise; no cancellation fee is configured in this release.
           final_fare    = case when p_new_status = 'COMPLETED' then estimated_fare
                                when p_new_status in ('CANCELLED', 'EXPIRED', 'FAILED') then null
                                else final_fare end
     where id = p_booking_id;

    -- Release the driver on every terminal state.
    if p_new_status in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED') then
        update public.couriers c
           set availability_status = case when c.is_online then 'AVAILABLE' else 'OFFLINE' end,
               last_seen_at = now()
         where c.id = v_booking.driver_id;
    end if;

    insert into public.errands_status_history (booking_id, from_status, to_status, changed_by, note)
    values (p_booking_id, v_booking.status, p_new_status, v_uid,
            left(coalesce(p_note, ''), 500));

    -- Keep the other side informed through the existing notification system.
    if p_new_status = 'DRIVER_ACCEPTED' then
        insert into public.notifications (user_id, title, message, type, link)
        values (v_booking.customer_id, 'Your driver accepted',
                concat('Your driver is on the way to ', v_booking.pickup_area, '.'),
                'ERRANDS_STATUS', '/errands');
    elsif p_new_status = 'DRIVER_ARRIVED' then
        insert into public.notifications (user_id, title, message, type, link)
        values (v_booking.customer_id, 'Your driver has arrived',
                'Your driver is waiting at the pickup point.',
                'ERRANDS_STATUS', '/errands');
    elsif p_new_status = 'COMPLETED' then
        insert into public.notifications (user_id, title, message, type, link)
        values (v_booking.customer_id, 'Errand complete',
                concat('Your trip ', v_booking.booking_number, ' is complete. Thank you!'),
                'ERRANDS_STATUS', '/errands');
    elsif p_new_status = 'CANCELLED' then
        if v_actor = 'DRIVER' then
            insert into public.notifications (user_id, title, message, type, link)
            values (v_booking.customer_id, 'Request declined',
                    'The driver declined your request. You can choose another eligible driver.',
                    'ERRANDS_STATUS', '/errands');
        elsif v_actor = 'CUSTOMER' then
            insert into public.notifications (user_id, title, message, type, link)
            values (v_booking.driver_id, 'Errands request cancelled',
                    concat('The customer cancelled booking ', v_booking.booking_number, '.'),
                    'ERRANDS_STATUS', '/courier/dashboard');
        end if;
    end if;

    return public.errands_booking_payload(p_booking_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 10. EXPIRY — a request never waits forever. Any signed-in participant
--     (or the app's own polling) may call this; it only ever touches
--     REQUESTED bookings whose response window has genuinely passed, and
--     releases the reserved driver.
-- ---------------------------------------------------------------------
create or replace function public.errands_expire_stale_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.errands_bookings%rowtype;
    v_count integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sign in first.';
    end if;

    for v_row in
        select * from public.errands_bookings
         where status = 'REQUESTED'
           and requested_expires_at <= now()
         for update
    loop
        update public.errands_bookings
           set status = 'EXPIRED',
               cancellation_reason = 'The driver did not respond in time.'
         where id = v_row.id;

        update public.couriers c
           set availability_status = case when c.is_online then 'AVAILABLE' else 'OFFLINE' end,
               last_seen_at = now()
         where c.id = v_row.driver_id
           and c.availability_status = 'ON_DELIVERY';

        insert into public.errands_status_history (booking_id, from_status, to_status, changed_by, note)
        values (v_row.id, 'REQUESTED', 'EXPIRED', auth.uid(),
                'No driver response before the request expired.');

        insert into public.notifications (user_id, title, message, type, link)
        values (v_row.customer_id, 'Request expired',
                'Your driver did not respond in time. Choose another eligible driver to continue.',
                'ERRANDS_STATUS', '/errands');

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. AVAILABILITY + CAPABILITY RPCs
-- ---------------------------------------------------------------------

-- Driver opt-in / opt-out of Errands discovery. Availability is a driver
-- decision; every other eligibility rule is still enforced server-side.
create or replace function public.set_errands_availability(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_courier record;
begin
    if v_uid is null then
        raise exception 'Sign in first.';
    end if;
    if p_enabled is null then
        raise exception 'Missing availability value.';
    end if;

    select c.id, c.is_approved, c.verification_status, c.is_online
      into v_courier
      from public.couriers c
     where c.id = v_uid;

    if not found then
        raise exception 'No courier profile found for this account.';
    end if;
    if coalesce(v_courier.is_approved, false) = false
       or v_courier.verification_status <> 'APPROVED' then
        raise exception 'Your account must be approved before you can take Errands jobs.';
    end if;

    insert into public.driver_service_capabilities (courier_id, errands_enabled)
    values (v_uid, p_enabled)
    on conflict (courier_id) do update
        set errands_enabled = excluded.errands_enabled,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (v_uid,
            case when p_enabled then 'ERRANDS_AVAILABILITY_ENABLED' else 'ERRANDS_AVAILABILITY_DISABLED' end,
            'courier', v_uid::text,
            jsonb_build_object('errands_enabled', p_enabled));

    return public.driver_capability_payload(v_uid);
end;
$$;

create or replace function public.driver_capability_payload(p_courier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_row public.driver_service_capabilities%rowtype;
begin
    select * into v_row
      from public.driver_service_capabilities
     where courier_id = p_courier_id;

    if not found then
        return jsonb_build_object(
            'courier_id', p_courier_id,
            'errands_enabled', false,
            'motorcycle_errands', false,
            'car_rides', false
        );
    end if;

    return jsonb_build_object(
        'courier_id', v_row.courier_id,
        'errands_enabled', v_row.errands_enabled,
        'motorcycle_errands', v_row.motorcycle_errands,
        'car_rides', v_row.car_rides,
        'updated_at', to_char(v_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
end;
$$;

-- Super admin: grant or withdraw a service category for one driver
-- (passenger-transport approval is an operator decision, never a
-- self-service toggle).
create or replace function public.set_driver_service_capabilities(
    p_courier_id uuid,
    p_motorcycle_errands boolean,
    p_car_rides boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can change service capabilities';
    end if;
    if p_courier_id is null or p_motorcycle_errands is null or p_car_rides is null then
        raise exception 'Missing capability values';
    end if;
    if not exists (select 1 from public.couriers where id = p_courier_id) then
        raise exception 'Courier not found';
    end if;

    insert into public.driver_service_capabilities
        (courier_id, motorcycle_errands, car_rides)
    values (p_courier_id, p_motorcycle_errands, p_car_rides)
    on conflict (courier_id) do update
        set motorcycle_errands = excluded.motorcycle_errands,
            car_rides = excluded.car_rides,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'DRIVER_SERVICE_CAPABILITIES_UPDATED', 'courier', p_courier_id::text,
            jsonb_build_object('motorcycle_errands', p_motorcycle_errands,
                               'car_rides', p_car_rides));

    return public.driver_capability_payload(p_courier_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 12. RESTAURANT DISPATCH — a driver mid-Errand must never be offered to
--     a kitchen. Same directory, one extra exclusion.
-- ---------------------------------------------------------------------
create or replace function public.courier_driver_directory(
    p_only_online boolean default false,
    p_only_approved boolean default false,
    p_limit integer default 50
)
returns table (
    id uuid,
    vehicle_type text,
    vehicle_plate text,
    is_approved boolean,
    is_online boolean,
    availability_status text,
    total_deliveries integer,
    rating numeric,
    profile jsonb
)
language sql
stable
security definer
set search_path = public
as $$
    select
        c.id,
        c.vehicle_type,
        c.vehicle_plate,
        c.is_approved,
        c.is_online,
        c.availability_status,
        c.total_deliveries,
        c.rating,
        jsonb_build_object(
            'id', p.id,
            'full_name', p.full_name,
            'avatar_url', p.avatar_url,
            'phone', p.phone
        ) as profile
    from public.couriers c
    join public.profiles p on p.id = c.id
    where (
        -- Only a restaurant owner (or the platform) may enumerate riders.
        exists (
            select 1 from public.profiles me
            where me.id = auth.uid()
              and me.role in ('RESTAURANT_OWNER', 'SUPER_ADMIN')
        )
      )
      and (p_only_online is false or c.is_online is true)
      and (p_only_approved is false or c.is_approved is true)
      -- Never offer a driver who is committed to an active Errands job.
      and not exists (
          select 1 from public.errands_bookings eb
           where eb.driver_id = c.id
             and eb.status in ('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                               'DRIVER_ARRIVED', 'IN_PROGRESS')
      )
    order by c.is_online desc, c.rating desc, c.total_deliveries desc
    limit greatest(least(coalesce(p_limit, 50), 200), 1);
$$;

-- ---------------------------------------------------------------------
-- 13. LIVE TRACKING — an accepted customer may read exactly one courier:
--     their own driver, while the booking is live. (RLS on `couriers` is
--     what Supabase Realtime enforces for the position stream.)
-- ---------------------------------------------------------------------
drop policy if exists "Courier rows are visible to themselves, admins and order participants"
    on public.couriers;

create policy "Courier rows are visible to themselves, admins and order participants"
    on public.couriers
    for select
    using (
        auth.uid() = id
        or exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'SUPER_ADMIN'
        )
        or public.courier_order_participant(id)
        or exists (
            select 1 from public.errands_bookings b
             where b.driver_id = couriers.id
               and b.customer_id = auth.uid()
               and b.status in ('DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                                'DRIVER_ARRIVED', 'IN_PROGRESS')
        )
    );

-- ---------------------------------------------------------------------
-- 14. REALTIME — customers learn about their booking, drivers about new
--     requests, through the same postgres_changes channels the rest of
--     the app uses (RLS applies to every forwarded row).
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'errands_bookings'
    ) then
        alter publication supabase_realtime add table public.errands_bookings;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'errands_status_history'
    ) then
        alter publication supabase_realtime add table public.errands_status_history;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 15. EXECUTE GRANTS — internals stay out of the client API surface.
-- ---------------------------------------------------------------------
revoke execute on function public.get_errands_config() from public, anon;
revoke execute on function public.errands_service_enabled(text) from public, anon;
revoke execute on function public.get_errands_pricing_settings() from public, anon;
revoke execute on function public.errands_pricing_amounts(numeric, text, jsonb) from public, anon;
revoke execute on function public.set_errands_config(boolean, boolean, boolean) from public, anon;
revoke execute on function public.set_errands_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) from public, anon;
revoke execute on function public.errands_driver_is_available(uuid, text) from public, anon;
revoke execute on function public.assert_errands_location(double precision, double precision) from public, anon;
revoke execute on function public.errands_area_label(text) from public, anon;
revoke execute on function public.errands_nearby_drivers(double precision, double precision, text, numeric, integer) from public, anon;
revoke execute on function public.create_errands_quote(double precision, double precision, text, double precision, double precision, text, text, numeric, integer) from public, anon;
revoke execute on function public.create_errands_booking(uuid, uuid) from public, anon;
revoke execute on function public.errands_set_booking_status(uuid, text, text, text) from public, anon;
revoke execute on function public.errands_booking_payload(uuid) from public, anon;
revoke execute on function public.errands_expire_stale_bookings() from public, anon;
revoke execute on function public.set_errands_availability(boolean) from public, anon;
revoke execute on function public.driver_capability_payload(uuid) from public, anon;
revoke execute on function public.set_driver_service_capabilities(uuid, boolean, boolean) from public, anon;
revoke execute on function public.protect_driver_service_capabilities() from public, anon;

grant execute on function public.get_errands_config() to authenticated, service_role;
grant execute on function public.errands_service_enabled(text) to authenticated, service_role;
grant execute on function public.get_errands_pricing_settings() to authenticated, service_role;
grant execute on function public.set_errands_config(boolean, boolean, boolean) to authenticated, service_role;
grant execute on function public.set_errands_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) to authenticated, service_role;
grant execute on function public.errands_driver_is_available(uuid, text) to authenticated, service_role;
grant execute on function public.assert_errands_location(double precision, double precision) to authenticated, service_role;
grant execute on function public.errands_area_label(text) to authenticated, service_role;
grant execute on function public.errands_nearby_drivers(double precision, double precision, text, numeric, integer) to authenticated, service_role;
grant execute on function public.create_errands_quote(double precision, double precision, text, double precision, double precision, text, text, numeric, integer) to authenticated, service_role;
grant execute on function public.create_errands_booking(uuid, uuid) to authenticated, service_role;
grant execute on function public.errands_set_booking_status(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.errands_booking_payload(uuid) to authenticated, service_role;
grant execute on function public.errands_expire_stale_bookings() to authenticated, service_role;
grant execute on function public.set_errands_availability(boolean) to authenticated, service_role;
grant execute on function public.driver_capability_payload(uuid) to authenticated, service_role;
grant execute on function public.set_driver_service_capabilities(uuid, boolean, boolean) to authenticated, service_role;

-- The fare engine and the config readers stay callable by the quote RPC
-- chain only — never from the browser.
grant execute on function public.errands_pricing_amounts(numeric, text, jsonb) to service_role;

commit;

-- Refresh PostgREST's schema cache so every new RPC is immediately usable.
notify pgrst, 'reload schema';
