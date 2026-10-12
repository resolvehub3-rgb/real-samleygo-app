-- =====================================================================
-- SamleyGo — Errands & Rides: CONFIGURABLE, SERVER-ROUTED FARE ENGINE
--
-- Supersedes the strictly-per-distance rules in
-- 20261012_errands_per_distance_pricing.sql. Run AFTER steps 10 and 11.
--
-- Why this exists
-- ---------------
--  * The fare must be a real road-route price, never a crow-fly guess.
--    `create_errands_quote()` now REQUIRES a routed distance: when the
--    routing service cannot produce one it raises instead of quietly
--    pricing a straight line.
--  * The routing call must not be payable by the browser. The RPC is
--    revoked from `anon`/`authenticated` and is only executed by the
--    `errand-quote` Edge Function (service role), which verifies the
--    customer's JWT, routes with the privileged key, and passes the
--    distance it measured itself.
--  * Each service category prices independently (motorcycle errands, car
--    errands, passenger trips) from its own `errands_pricing_rules` row:
--    base fare, per-km rate, floor/ceiling, booking fee, optional waiting
--    and time charges, optional surge, tax, driver/platform split.
--  * Money is computed in INTEGER PESEWAS end to end, so no binary
--    floating point ever touches a price.
--
-- What this migration does (idempotent)
-- -------------------------------------
--   1. CAR_ERRAND becomes a third bookable service category (default OFF:
--      an operator must switch it on, exactly like passenger rides).
--   2. New table `errands_pricing_rules` — one active row per category,
--      versioned and auditable, so an issued quote keeps its own snapshot.
--   3. `errands_fare_amounts()` — the single deterministic formula.
--   4. `create_errands_quote()` — rewritten: road route required, rules
--      loaded from the active row, breakdown snapshotted, rate limited.
--   5. `create_errands_booking()` — revalidates the quote against the
--      CURRENT rules and refuses (never silently re-prices) on change.
--   6. Admin setters: `set_errands_pricing_rules()`, 4-argument
--      `set_errands_config()` and `set_driver_service_capabilities()`.
--
-- Pricing invariants are asserted by supabase/tests/errands_fare_checks.sql
-- and scripts/errands_fare_engine.test.ts (`npm test`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THIRD SERVICE CATEGORY: CAR_ERRAND
--
--    Existing rows and the two live categories are untouched; the new
--    category ships switched OFF so nothing changes for customers until
--    an operator enables it from the dashboard.
-- ---------------------------------------------------------------------
alter table public.errands_quotes
    drop constraint if exists errands_quotes_service_check;
alter table public.errands_quotes
    add constraint errands_quotes_service_check
        check (service_category in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR'));

alter table public.errands_bookings
    drop constraint if exists errands_bookings_service_check;
alter table public.errands_bookings
    add constraint errands_bookings_service_check
        check (service_category in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR'));

-- Car errands are a regulated capability, exactly like passenger rides:
-- an operator grants them per driver, a driver never grants themself.
alter table public.driver_service_capabilities
    add column if not exists car_errands boolean not null default false;

-- Service switches: expose CAR_ERRAND (default false — never enabled by
-- simply running the migration).
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
            'CAR_ERRAND',
                coalesce((v_raw -> 'services' ->> 'CAR_ERRAND')::boolean, false),
            'RIDE_CAR',
                coalesce((v_raw -> 'services' ->> 'RIDE_CAR')::boolean, false)
        ),
        'currency', coalesce(nullif(v_raw ->> 'currency', ''), 'GHS')
    );
end;
$$;

comment on function public.get_errands_config() IS
    'Errands service switches (master + per-service, including CAR_ERRAND). SECURITY DEFINER so customers can read them without a platform_settings policy.';

-- 4-argument setter (the car-errand switch is the new argument). The old
-- 3-argument signature is dropped so no caller can save a config that
-- silently drops the new category.
drop function if exists public.set_errands_config(boolean, boolean, boolean);

create or replace function public.set_errands_config(
    p_enabled boolean,
    p_service_motorcycle boolean,
    p_service_car_errand boolean,
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

    if p_enabled is null
       or p_service_motorcycle is null
       or p_service_car_errand is null
       or p_service_ride_car is null then
        raise exception 'Service switches cannot be empty';
    end if;

    v_next := jsonb_build_object(
        'enabled', p_enabled,
        'services', jsonb_build_object(
            'ERRAND_MOTORCYCLE', p_service_motorcycle,
            'CAR_ERRAND', p_service_car_errand,
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

-- Eligibility: a car errand needs a car (or van) AND the granted capability.
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
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR') then
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
           coalesce(cap.car_errands, false)      as car_errands,
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
    elsif p_service_category = 'CAR_ERRAND' then
        if v_c.vehicle_type not in ('Car', 'Van') then return false; end if;
        if v_c.car_errands = false then return false; end if;
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
    'The single eligibility rule for Errands discovery and booking, covering motorcycle errands, car errands and passenger rides. SECURITY DEFINER so a customer can be told "available" without read access to private courier rows.';

-- Discovery: accept the new category and label its vehicles honestly.
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
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR') then
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
        case when p_service_category = 'ERRAND_MOTORCYCLE'
             then 'MOTORCYCLE' else 'CAR' end
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
    'Eligible, live, fresh-positioned drivers around a pickup point for one service category (motorcycle errand, car errand or passenger ride). Returns no plate/phone/verification data.';

-- Capability payload + admin setter now carry the car-errand grant.
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
            'car_errands', false,
            'car_rides', false
        );
    end if;

    return jsonb_build_object(
        'courier_id', v_row.courier_id,
        'errands_enabled', v_row.errands_enabled,
        'motorcycle_errands', v_row.motorcycle_errands,
        'car_errands', v_row.car_errands,
        'car_rides', v_row.car_rides,
        'updated_at', to_char(v_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
end;
$$;

drop function if exists public.set_driver_service_capabilities(uuid, boolean, boolean);

create or replace function public.set_driver_service_capabilities(
    p_courier_id uuid,
    p_motorcycle_errands boolean,
    p_car_errands boolean,
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
    if p_courier_id is null
       or p_motorcycle_errands is null
       or p_car_errands is null
       or p_car_rides is null then
        raise exception 'Missing capability values';
    end if;
    if not exists (select 1 from public.couriers where id = p_courier_id) then
        raise exception 'Courier not found';
    end if;

    insert into public.driver_service_capabilities
        (courier_id, motorcycle_errands, car_errands, car_rides)
    values (p_courier_id, p_motorcycle_errands, p_car_errands, p_car_rides)
    on conflict (courier_id) do update
        set motorcycle_errands = excluded.motorcycle_errands,
            car_errands = excluded.car_errands,
            car_rides = excluded.car_rides,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'DRIVER_SERVICE_CAPABILITIES_UPDATED', 'courier', p_courier_id::text,
            jsonb_build_object('motorcycle_errands', p_motorcycle_errands,
                               'car_errands', p_car_errands,
                               'car_rides', p_car_rides));

    return public.driver_capability_payload(p_courier_id);
end;
$$;

-- A driver can never grant themself ANY service category.
create or replace function public.protect_driver_service_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if (new.motorcycle_errands is distinct from old.motorcycle_errands
        or new.car_errands is distinct from old.car_errands
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

-- ---------------------------------------------------------------------
-- 2. PRICING CONFIGURATION — one versioned, auditable row per service
--    category. Supersedes the single platform_settings blob: rates are
--    per category AND per vehicle category, they carry their own
--    effective date, and old rows are kept (is_active = false) so a
--    quote issued yesterday still points at the rules that priced it.
-- ---------------------------------------------------------------------
create table if not exists public.errands_pricing_rules (
    id                        uuid primary key default gen_random_uuid(),
    service_category          text not null
        check (service_category in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR')),
    vehicle_category          text not null
        check (vehicle_category in ('MOTORCYCLE', 'CAR')),

    -- Distance model: fare = base + km x rate (+ optional charges below)
    base_fare                 numeric(10,2) not null default 0
        check (base_fare between 0 and 99999.99),
    price_per_km              numeric(10,2) not null default 0
        check (price_per_km between 0 and 9999.99),
    min_fare                  numeric(10,2) not null default 0
        check (min_fare between 0 and 99999.99),
    max_fare                  numeric(10,2)
        check (max_fare is null or max_fare between 0 and 99999.99),

    -- Optional charges — each one is off unless an operator turns it on,
    -- so nothing is ever added to a price silently.
    booking_fee               numeric(10,2) not null default 0
        check (booking_fee between 0 and 99999.99),
    waiting_charge            numeric(10,2) not null default 0
        check (waiting_charge between 0 and 9999.99),
    waiting_charge_enabled    boolean not null default false,
    time_charge_per_minute    numeric(10,2) not null default 0
        check (time_charge_per_minute between 0 and 9999.99),
    time_charge_enabled       boolean not null default false,

    surge_enabled             boolean not null default false,
    surge_multiplier          numeric(4,2) not null default 1.00
        check (surge_multiplier between 0.10 and 5.00),
    tax_rate_percent          numeric(5,2) not null default 0
        check (tax_rate_percent between 0 and 100),
    discount_amount           numeric(10,2) not null default 0
        check (discount_amount between 0 and 99999.99),

    -- Earnings split of the fare the customer pays. Both halves are
    -- stored because both are reported; they must always add up to 100.
    driver_earning_percent    numeric(5,2) not null default 100
        check (driver_earning_percent between 0 and 100),
    platform_commission_percent numeric(5,2) not null default 0
        check (platform_commission_percent between 0 and 100),

    currency                  text not null default 'GHS'
        check (currency in ('GHS')),
    pricing_version           integer not null default 1 check (pricing_version > 0),
    effective_from            timestamptz not null default now(),
    is_active                 boolean not null default true,

    created_by                uuid references public.profiles(id) on delete set null,
    created_at                timestamptz not null default now(),
    updated_by                uuid references public.profiles(id) on delete set null,
    updated_at                timestamptz not null default now(),

    constraint errands_pricing_rules_share_check
        check (driver_earning_percent + platform_commission_percent = 100),
    constraint errands_pricing_rules_band_check
        check (max_fare is null or max_fare >= min_fare),
    -- A rule set with no money in it at all is not a price list: refuse
    -- it at write time so nobody can save an unconfigured category.
    constraint errands_pricing_rules_not_free_check
        check (base_fare > 0 or price_per_km > 0 or min_fare > 0),
    constraint errands_pricing_rules_vehicle_check
        check (
            (service_category = 'ERRAND_MOTORCYCLE' and vehicle_category = 'MOTORCYCLE')
            or (service_category in ('CAR_ERRAND', 'RIDE_CAR') and vehicle_category = 'CAR')
        )
);

create unique index if not exists errands_pricing_rules_active_uniq
    on public.errands_pricing_rules (service_category)
    where is_active;

create index if not exists errands_pricing_rules_service_idx
    on public.errands_pricing_rules (service_category, effective_from desc);

-- Prices are read through SECURITY DEFINER RPCs only: no direct reads or
-- writes, so a rate can never be edited from the browser console.
alter table public.errands_pricing_rules enable row level security;
revoke all on table public.errands_pricing_rules from anon;
grant select on table public.errands_pricing_rules to authenticated, service_role;

drop trigger if exists trg_errands_pricing_rules_updated_at
    on public.errands_pricing_rules;
create trigger trg_errands_pricing_rules_updated_at
    before update on public.errands_pricing_rules
    for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------
--    Snapshot columns on the quote: what the customer was shown, and
--    which rule version produced it.
-- ---------------------------------------------------------------------
alter table public.errands_quotes
    add column if not exists base_fare            numeric(10,2) not null default 0,
    add column if not exists distance_charge      numeric(10,2) not null default 0,
    add column if not exists time_charge          numeric(10,2) not null default 0,
    add column if not exists waiting_charge       numeric(10,2) not null default 0,
    add column if not exists booking_fee          numeric(10,2) not null default 0,
    add column if not exists surge_amount         numeric(10,2) not null default 0,
    add column if not exists tax_amount           numeric(10,2) not null default 0,
    add column if not exists discount_amount      numeric(10,2) not null default 0,
    add column if not exists fare_breakdown       jsonb,
    add column if not exists route_distance_metres integer,
    add column if not exists route_duration_seconds integer,
    add column if not exists route_provider       text not null default 'UNKNOWN',
    add column if not exists pricing_rules_id     uuid
        references public.errands_pricing_rules(id) on delete set null,
    add column if not exists status               text not null default 'ACTIVE';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'errands_quotes_status_check'
    ) then
        alter table public.errands_quotes
            add constraint errands_quotes_status_check
                check (status in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED'));
    end if;
end $$;

create index if not exists errands_quotes_customer_recent_idx
    on public.errands_quotes (customer_id, created_at desc);

-- ---------------------------------------------------------------------
-- 3. Service area — both endpoints must be inside the operating box.
--    Defaults to the same Ghana bounds the address search biases to;
--    an operator can override them from platform_settings without a
--    code change.
-- ---------------------------------------------------------------------
create or replace function public.errands_in_service_area(
    p_lat double precision,
    p_lng double precision
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_area   jsonb;
    v_north  numeric := 11.50;
    v_south  numeric := 4.80;
    v_east   numeric := 1.40;
    v_west   numeric := -3.40;
begin
    if p_lat is null or p_lng is null then
        return false;
    end if;
    if abs(p_lat) > 90 or abs(p_lng) > 180 then
        return false;
    end if;

    select coalesce(value, '{}'::jsonb) into v_area
      from public.platform_settings
     where key = 'errands_service_area';

    if coalesce(jsonb_typeof(v_area), 'object') = 'object' then
        v_north := coalesce(public.safe_numeric(v_area -> 'north', v_north), v_north);
        v_south := coalesce(public.safe_numeric(v_area -> 'south', v_south), v_south);
        v_east  := coalesce(public.safe_numeric(v_area -> 'east',  v_east),  v_east);
        v_west  := coalesce(public.safe_numeric(v_area -> 'west',  v_west),  v_west);
    end if;

    return p_lat between v_south and v_north
       and p_lng between v_west  and v_east;
end;
$$;

comment on function public.errands_in_service_area(double precision, double precision) IS
    'True when a coordinate lies inside the configured Errands operating box (defaults to Ghana).';

-- The active rule for a category: SECURITY DEFINER so the quote path and
-- the admin screen read exactly the same row.
create or replace function public.get_active_errands_pricing_rule(
    p_service_category text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_rule jsonb;
begin
    if p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR') then
        return null;
    end if;

    select to_jsonb(r) into v_rule
      from public.errands_pricing_rules r
     where r.service_category = p_service_category
       and r.is_active
     order by r.effective_from desc, r.pricing_version desc
     limit 1;

    return v_rule;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. THE FARE ENGINE — deterministic, in integer pesewas.
--
--    distance charge = km x price_per_km
--    trip            = base + distance + (time) + (waiting)
--    after surge     = trip x multiplier        [only when enabled]
--    raw             = after surge + booking fee [only if configured]
--    estimated fare  = clamp(raw, min, max) - discount + tax
--    driver pay      = fare x driver_earning_percent / 100
--    platform share  = fare - driver pay - tax (tax is a pass-through)
--
--    Every step is integer arithmetic on pesewas: no binary floating
--    point value ever becomes a price, and round() is half-away-from-
--    zero so the browser, this function and the tests agree to the
--    pesewa. Granted to service_role only — the browser cannot call it,
--    and neither the client nor this function may invent a distance: the
--    caller must supply a road distance it measured itself.
-- ---------------------------------------------------------------------
create or replace function public.errands_fare_amounts(
    p_distance_km numeric,
    p_duration_seconds integer,
    p_service_category text,
    p_rules jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_distance_km  numeric := greatest(0, coalesce(p_distance_km, 0));
    v_minutes      numeric := greatest(0, coalesce(p_duration_seconds, 0)) / 60.0;

    v_base_pw      bigint;
    v_rate_pw      numeric;
    v_distance_pw  bigint;
    v_min_pw       bigint;
    v_max_pw       bigint := null;
    v_booking_pw   bigint;
    v_waiting_pw   bigint;
    v_time_pw      bigint;
    v_discount_pw  bigint;
    v_surge        numeric;
    v_surge_on     boolean;
    v_tax_pct      numeric;
    v_earn_pct     numeric;
    v_comm_pct     numeric;

    v_trip_pw      bigint;
    v_surged_pw    bigint;
    v_raw_pw       bigint;
    v_clamped_pw   bigint;
    v_after_pw     bigint;
    v_tax_pw       bigint;
    v_total_pw     bigint;
    v_driver_pw    bigint;
    v_platform_pw  bigint;
begin
    if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
        raise exception 'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.';
    end if;

    if p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR') then
        raise exception 'That Errands service is not supported.';
    end if;

    v_base_pw := round(coalesce(public.safe_numeric(p_rules -> 'base_fare', 0), 0) * 100)::bigint;
    v_rate_pw := coalesce(public.safe_numeric(p_rules -> 'price_per_km', 0), 0) * 100;
    v_min_pw  := round(coalesce(public.safe_numeric(p_rules -> 'min_fare', 0), 0) * 100)::bigint;

    -- A ceiling of zero would be a free fare, so only a positive value
    -- is treated as a real maximum.
    v_max_pw  := case
        when coalesce(public.safe_numeric(p_rules -> 'max_fare', 0), 0) > 0
            then round(public.safe_numeric(p_rules -> 'max_fare', 0) * 100)::bigint
        else null
    end;

    v_booking_pw := round(coalesce(public.safe_numeric(p_rules -> 'booking_fee', 0), 0) * 100)::bigint;
    v_discount_pw := round(coalesce(public.safe_numeric(p_rules -> 'discount_amount', 0), 0) * 100)::bigint;

    v_waiting_pw := case
        when coalesce((p_rules ->> 'waiting_charge_enabled')::boolean, false)
            then round(coalesce(public.safe_numeric(p_rules -> 'waiting_charge', 0), 0) * 100)::bigint
        else 0
    end;

    v_time_pw := case
        when coalesce((p_rules ->> 'time_charge_enabled')::boolean, false)
            then round(v_minutes
                 * coalesce(public.safe_numeric(p_rules -> 'time_charge_per_minute', 0), 0) * 100)::bigint
        else 0
    end;

    v_surge_on := coalesce((p_rules ->> 'surge_enabled')::boolean, false);
    v_surge    := coalesce(public.safe_numeric(p_rules -> 'surge_multiplier', 1), 1);
    if v_surge <= 0 then v_surge := 1; end if;

    v_tax_pct := least(100, greatest(0,
        coalesce(public.safe_numeric(p_rules -> 'tax_rate_percent', 0), 0)));
    v_earn_pct := least(100, greatest(0,
        coalesce(public.safe_numeric(p_rules -> 'driver_earning_percent',
                                     coalesce(public.safe_numeric(p_rules -> 'driver_earning_percentage', 100), 100)), 100)));
    v_comm_pct := least(100, greatest(0,
        coalesce(public.safe_numeric(p_rules -> 'platform_commission_percent',
                                     greatest(0, 100 - v_earn_pct)), 0)));

    -- Nothing configured at all means nothing to charge: refuse rather
    -- than show a customer GH₵0.00 as if it were a real quote.
    if v_base_pw <= 0 and v_rate_pw <= 0 and v_min_pw <= 0 then
        raise exception 'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.';
    end if;

    v_distance_pw := round(v_distance_km * v_rate_pw)::bigint;

    -- Fixed and distance components, plus the optional charges.
    v_trip_pw := v_base_pw + v_distance_pw + v_time_pw + v_waiting_pw;

    -- Surge applies to the trip components only: the booking fee is a
    -- flat service charge and is never multiplied.
    v_surged_pw := case
        when v_surge_on and v_surge <> 1 then round(v_trip_pw * v_surge)::bigint
        else v_trip_pw
    end;

    v_raw_pw := v_surged_pw + v_booking_pw;

    -- Floor then ceiling, in that order (the band check keeps them sane).
    v_clamped_pw := v_raw_pw;
    if v_min_pw > 0 and v_clamped_pw < v_min_pw then
        v_clamped_pw := v_min_pw;
    end if;
    if v_max_pw is not null and v_clamped_pw > v_max_pw then
        v_clamped_pw := v_max_pw;
    end if;

    v_after_pw := greatest(0, v_clamped_pw - least(v_discount_pw, v_clamped_pw));
    v_tax_pw   := round(v_after_pw * v_tax_pct / 100)::bigint;
    v_total_pw := v_after_pw + v_tax_pw;

    v_driver_pw   := round(v_total_pw * v_earn_pct / 100)::bigint;
    v_platform_pw := greatest(0, v_total_pw - v_driver_pw - v_tax_pw);

    return jsonb_build_object(
        'configured', true,
        'service_category', p_service_category,
        'distance_km', round(v_distance_km, 2),
        -- Legacy keys (the admin preview and the quote card read these).
        'trip_fare', round(v_surged_pw + v_booking_pw - least(v_discount_pw, v_clamped_pw), 2)::numeric / 100,
        'base_fare', v_base_pw::numeric / 100,
        'distance_charge', v_distance_pw::numeric / 100,
        'time_charge', v_time_pw::numeric / 100,
        'waiting_charge', v_waiting_pw::numeric / 100,
        'booking_fee', v_booking_pw::numeric / 100,
        'surge_amount', (v_surged_pw - v_trip_pw)::numeric / 100,
        'surge_applied', (v_surged_pw - v_trip_pw) <> 0,
        'min_fare', v_min_pw::numeric / 100,
        'max_fare', case when v_max_pw is null then null else v_max_pw::numeric / 100 end,
        'tax_amount', v_tax_pw::numeric / 100,
        'tax_rate_percent', v_tax_pct,
        'discount_amount', least(v_discount_pw, v_clamped_pw)::numeric / 100,
        'estimated_fare', v_total_pw::numeric / 100,
        'driver_earning', v_driver_pw::numeric / 100,
        'driver_earning_percentage', v_earn_pct,
        'platform_revenue', v_platform_pw::numeric / 100,
        'platform_commission_percentage', v_comm_pct,
        'per_km_rate', round(v_rate_pw / 100, 2),
        'price_per_km', round(v_rate_pw / 100, 2),
        'surge_multiplier', v_surge,
        'surge_enabled', v_surge_on,
        'surge_rule_active', (v_surged_pw - v_trip_pw) <> 0,
        'currency', coalesce(nullif(p_rules ->> 'currency', ''), 'GHS'),
        'pricing_version', coalesce((p_rules ->> 'pricing_version')::int, 1),
        'pricing_rules_id', case
            when (p_rules ->> 'id') is null or jsonb_typeof(p_rules -> 'id') = 'null'
                then null
            else (p_rules ->> 'id')::uuid
        end,
        'effective_from', case
            when (p_rules ->> 'effective_from') is null
              or jsonb_typeof(p_rules -> 'effective_from') = 'null'
                then null
            else p_rules ->> 'effective_from'
        end
    );
end;
$$;

comment on function public.errands_fare_amounts(numeric, integer, text, jsonb) IS
    'The single deterministic Errands fare formula, computed in integer pesewas from a pricing-rule snapshot. service_role only.';

-- ---------------------------------------------------------------------
-- 5. THE QUOTE RPC — rewritten.
--
--    The browser no longer routes and no longer sends a distance: the
--    `errand-quote` Edge Function verifies the customer's JWT, calls the
--    routing service with the privileged key, and only then calls this
--    function with the distance IT measured. That is why the function is
--    revoked from anon/authenticated: a client-supplied distance would
--    let anyone choose their own price.
--
--    When routing produced nothing, there is no price — this function
--    raises instead of falling back to a straight line.
-- ---------------------------------------------------------------------
drop function if exists public.create_errands_quote(
    double precision, double precision, text,
    double precision, double precision, text,
    text, numeric, integer
);

create or replace function public.create_errands_quote(
    p_customer_id uuid,
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_pickup_address text,
    p_dest_lat double precision,
    p_dest_lng double precision,
    p_dest_address text,
    p_service_category text,
    p_route_distance_km numeric,
    p_route_duration_seconds integer,
    p_route_provider text default 'UNKNOWN'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_straight  numeric;
    v_distance  numeric;
    v_duration  integer := null;
    v_rules     jsonb;
    v_amounts   jsonb;
    v_quote_id  uuid;
    v_expires   timestamptz;
    v_pickup    text;
    v_dest      text;
    v_ttl       integer;
    v_recent    integer;
    v_breakdown jsonb;
begin
    if p_customer_id is null
       or not exists (select 1 from public.profiles where id = p_customer_id) then
        raise exception 'Sign in to see your Errands fare.';
    end if;

    if p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR') then
        raise exception 'That Errands service is not supported.';
    end if;

    perform public.assert_errands_location(p_pickup_lat, p_pickup_lng);
    perform public.assert_errands_location(p_dest_lat, p_dest_lng);

    if p_pickup_lat = p_dest_lat and p_pickup_lng = p_dest_lng then
        raise exception 'Pickup and destination are the same place — choose a real destination.';
    end if;

    if not public.errands_in_service_area(p_pickup_lat, p_pickup_lng)
       or not public.errands_in_service_area(p_dest_lat, p_dest_lng) then
        raise exception 'SamleyGo does not run trips to that location yet — pickup and destination must both be inside the service area.';
    end if;

    if not public.errands_service_enabled(p_service_category) then
        raise exception 'This service is not available right now.';
    end if;

    -- Reasonable rate limiting: a burst of quote requests is usually a
    -- retry loop or a script, and every one of them costs a routing call.
    select count(*) into v_recent
      from public.errands_quotes
     where customer_id = p_customer_id
       and created_at > now() - interval '1 minute';
    if v_recent >= 30 then
        raise exception 'You are requesting fares too quickly — please wait a moment and try again.';
    end if;

    v_pickup := left(coalesce(nullif(trim(p_pickup_address), ''),
                              concat(p_pickup_lat, ', ', p_pickup_lng)), 300);
    v_dest   := left(coalesce(nullif(trim(p_dest_address), ''),
                              concat(p_dest_lat, ', ', p_dest_lng)), 300);

    -- The server still measures the crow-fly distance, but ONLY to
    -- sanity-check the route it was handed. It is never priced.
    v_straight := round(
        public.haversine_km(p_pickup_lat, p_pickup_lng, p_dest_lat, p_dest_lng), 2);

    if p_route_distance_km is null or p_route_distance_km <= 0 then
        raise exception 'We could not find a road route between those addresses. Please try again in a moment.';
    end if;

    if p_route_distance_km > 9999.99
       or p_route_distance_km < greatest(0.01, v_straight * 0.90)
       or p_route_distance_km > greatest(1.0, v_straight * 3.0) then
        raise exception 'The road route for those addresses could not be verified. Please try again.';
    end if;

    v_distance := round(p_route_distance_km, 2);

    if p_route_duration_seconds is not null
       and p_route_duration_seconds between 15 and 86400 then
        v_duration := p_route_duration_seconds;
    end if;

    v_rules := public.get_active_errands_pricing_rule(p_service_category);
    if v_rules is null then
        raise exception 'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.';
    end if;

    v_amounts := public.errands_fare_amounts(
        v_distance, v_duration, p_service_category, v_rules);

    select greatest(1, coalesce(
        (public.get_errands_pricing_settings() ->> 'quote_ttl_minutes')::int, 5))
      into v_ttl;
    v_expires := now() + make_interval(mins => v_ttl);

    -- Housekeeping: forget this customer's stale, unused quotes.
    delete from public.errands_quotes
     where customer_id = p_customer_id
       and consumed_at is null
       and expires_at < now() - interval '1 day';

    v_breakdown := jsonb_build_object(
        'base_fare', v_amounts -> 'base_fare',
        'distance_charge', v_amounts -> 'distance_charge',
        'time_charge', v_amounts -> 'time_charge',
        'waiting_charge', v_amounts -> 'waiting_charge',
        'booking_fee', v_amounts -> 'booking_fee',
        'surge_amount', v_amounts -> 'surge_amount',
        'discount_amount', v_amounts -> 'discount_amount',
        'tax_amount', v_amounts -> 'tax_amount',
        'subtotal', (v_amounts ->> 'trip_fare')::numeric,
        'estimated_total', (v_amounts ->> 'estimated_fare')::numeric,
        'currency', v_amounts ->> 'currency',
        'route_distance_km', round(v_distance, 2),
        'route_duration_seconds', v_duration,
        'route_provider', coalesce(nullif(p_route_provider, ''), 'UNKNOWN'),
        'pricing_version', (v_amounts ->> 'pricing_version')::int,
        'surge_rule_active', coalesce((v_amounts ->> 'surge_rule_active')::boolean, false),
        'variable_charge_note', case
            when coalesce((v_amounts ->> 'surge_rule_active')::boolean, false)
                then 'This trip is priced with an active surge multiplier. Your final fare is locked once you confirm — it will not change after that.'
            else null
        end
    );

    insert into public.errands_quotes (
        customer_id, service_category,
        pickup_address, pickup_latitude, pickup_longitude,
        destination_address, destination_latitude, destination_longitude,
        straight_line_km, distance_km, distance_source, estimated_duration_seconds,
        per_km_rate, tax_rate_percent,
        surge_multiplier, driver_earning_percentage, pricing_version,
        estimated_fare, driver_earning, currency,
        base_fare, distance_charge, time_charge, waiting_charge,
        booking_fee, surge_amount, tax_amount, discount_amount,
        fare_breakdown, route_distance_metres, route_duration_seconds,
        route_provider, pricing_rules_id, status,
        expires_at
    ) values (
        p_customer_id, p_service_category,
        v_pickup, p_pickup_lat, p_pickup_lng,
        v_dest, p_dest_lat, p_dest_lng,
        v_straight, v_distance, 'ROAD_ROUTE', v_duration,
        (v_amounts ->> 'per_km_rate')::numeric,
        (v_amounts ->> 'tax_rate_percent')::numeric,
        (v_amounts ->> 'surge_multiplier')::numeric,
        (v_amounts ->> 'driver_earning_percentage')::numeric,
        (v_amounts ->> 'pricing_version')::int,
        (v_amounts ->> 'estimated_fare')::numeric,
        (v_amounts ->> 'driver_earning')::numeric,
        v_amounts ->> 'currency',
        (v_amounts ->> 'base_fare')::numeric,
        (v_amounts ->> 'distance_charge')::numeric,
        (v_amounts ->> 'time_charge')::numeric,
        (v_amounts ->> 'waiting_charge')::numeric,
        (v_amounts ->> 'booking_fee')::numeric,
        (v_amounts ->> 'surge_amount')::numeric,
        (v_amounts ->> 'tax_amount')::numeric,
        (v_amounts ->> 'discount_amount')::numeric,
        v_breakdown,
        round(v_distance * 1000)::int,
        v_duration,
        coalesce(nullif(p_route_provider, ''), 'UNKNOWN'),
        (v_amounts ->> 'pricing_rules_id')::uuid,
        'ACTIVE',
        v_expires
    ) returning id into v_quote_id;

    return v_amounts || jsonb_build_object(
        'quote_id', v_quote_id,
        'status', 'ACTIVE',
        'pickup_address', v_pickup,
        'destination_address', v_dest,
        'straight_line_km', v_straight,
        'distance_km', v_distance,
        'route_distance_metres', round(v_distance * 1000)::int,
        'distance_source', 'ROAD_ROUTE',
        'route_provider', coalesce(nullif(p_route_provider, ''), 'UNKNOWN'),
        'estimated_duration_seconds', v_duration,
        'breakdown', v_breakdown,
        'issued_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expires_at', to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
end;
$$;

comment on function public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text) IS
    'Server-side fare quote. Called only by the errand-quote Edge Function (service role) after IT has routed pickup -> destination: the caller supplies a distance it measured, never one the browser chose, and no straight-line fallback exists.';

-- ---------------------------------------------------------------------
-- 6. Booking: revalidate the approved price before money moves.
--    (Full rewrite of the function — the price check is the new part,
--    everything else is byte-for-byte the behaviour that shipped in the
--    errands module.)
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
    v_rules       jsonb;
    v_recheck     jsonb;
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
    if v_quote.consumed_at is not null or v_quote.status = 'CONSUMED' then
        raise exception 'This fare quote has already been used. Please request a fresh quote.';
    end if;
    if v_quote.expires_at <= now() then
        raise exception 'This fare has expired. Refresh to get a current price.';
    end if;

    if not public.errands_service_enabled(v_quote.service_category) then
        raise exception 'This service is not available right now.';
    end if;

    -- 2b. Re-price the very same route under the CURRENT rules. The
    --     customer approved the number on the quote: if an admin moved
    --     the price in the meantime we refuse and ask for a fresh quote
    --     rather than silently charging either the old or the new one.
    v_rules := public.get_active_errands_pricing_rule(v_quote.service_category);
    if v_rules is null then
        raise exception 'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.';
    end if;

    v_recheck := public.errands_fare_amounts(
        v_quote.distance_km,
        v_quote.estimated_duration_seconds,
        v_quote.service_category,
        v_rules);

    if round((v_recheck ->> 'estimated_fare')::numeric, 2)
       <> round(v_quote.estimated_fare, 2) then
        raise exception 'The fare changed while you were reviewing it. Refresh the price to see the new amount before confirming.';
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
       set consumed_at = now(),
           status = 'CONSUMED'
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
        'breakdown', v_quote.fare_breakdown,
        -- The caller IS the customer (auth.uid() owned the quote), so the
        -- passenger PIN is returned here for display — the driver's own RPC
        -- path never receives it.
        'trip_pin', v_pin,
        'expires_at', to_char((now() + make_interval(secs => v_ttl))
                              at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Admin: save one category's rules. Every save is a NEW versioned row
--    (the previous one is retired, not overwritten) so a quote already
--    in a customer's hands keeps pointing at the rules that priced it,
--    and audit_logs records who changed what and when.
-- ---------------------------------------------------------------------
create or replace function public.set_errands_pricing_rules(
    p_service_category text,
    p_vehicle_category text,
    p_base_fare numeric,
    p_price_per_km numeric,
    p_min_fare numeric,
    p_max_fare numeric,
    p_booking_fee numeric,
    p_waiting_charge numeric,
    p_waiting_charge_enabled boolean,
    p_time_charge_per_minute numeric,
    p_time_charge_enabled boolean,
    p_surge_enabled boolean,
    p_surge_multiplier numeric,
    p_tax_rate_percent numeric,
    p_discount_amount numeric,
    p_driver_earning_percent numeric,
    p_platform_commission_percent numeric,
    p_currency text default 'GHS',
    p_effective_from timestamptz default null,
    p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_version   integer;
    v_id        uuid;
    v_row       jsonb;
    v_base      numeric;
    v_rate      numeric;
    v_min       numeric;
    v_max       numeric;
    v_booking   numeric;
    v_waiting   numeric;
    v_time      numeric;
    v_surge     numeric;
    v_tax       numeric;
    v_discount  numeric;
    v_earning   numeric;
    v_commission numeric;
begin
    if v_uid is null or not exists (
        select 1 from public.profiles where id = v_uid and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can change Errands pricing.';
    end if;

    if p_service_category is null
       or p_service_category not in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR') then
        raise exception 'That Errands service is not supported.';
    end if;

    if p_vehicle_category is null
       or p_vehicle_category not in ('MOTORCYCLE', 'CAR') then
        raise exception 'That vehicle category is not supported.';
    end if;

    if (p_service_category = 'ERRAND_MOTORCYCLE' and p_vehicle_category <> 'MOTORCYCLE')
       or (p_service_category in ('CAR_ERRAND', 'RIDE_CAR') and p_vehicle_category <> 'CAR') then
        raise exception 'Vehicle category does not match the service.';
    end if;

    v_base       := coalesce(p_base_fare, 0);
    v_rate       := coalesce(p_price_per_km, 0);
    v_min        := coalesce(p_min_fare, 0);
    v_max        := nullif(coalesce(p_max_fare, 0), 0);
    v_booking    := coalesce(p_booking_fee, 0);
    v_waiting    := coalesce(p_waiting_charge, 0);
    v_time       := coalesce(p_time_charge_per_minute, 0);
    v_surge      := coalesce(p_surge_multiplier, 1);
    v_tax        := coalesce(p_tax_rate_percent, 0);
    v_discount   := coalesce(p_discount_amount, 0);
    v_earning    := coalesce(p_driver_earning_percent, 100);
    v_commission := coalesce(p_platform_commission_percent, 0);

    if v_base < 0 or v_base > 99999.99
       or v_rate < 0 or v_rate > 9999.99
       or v_min < 0 or v_min > 99999.99
       or (v_max is not null and (v_max < 0 or v_max > 99999.99))
       or v_booking < 0 or v_booking > 99999.99
       or v_waiting < 0 or v_waiting > 9999.99
       or v_time < 0 or v_time > 9999.99
       or v_discount < 0 or v_discount > 99999.99 then
        raise exception 'One of the fares is outside the allowed range.';
    end if;

    if v_max is not null and v_max < v_min then
        raise exception 'The maximum fare cannot be lower than the minimum fare.';
    end if;

    if v_surge < 0.10 or v_surge > 5.00 then
        raise exception 'The surge multiplier must be between 0.10 and 5.00.';
    end if;

    if v_tax < 0 or v_tax > 100
       or v_earning < 0 or v_earning > 100
       or v_commission < 0 or v_commission > 100 then
        raise exception 'Percentages must be between 0 and 100.';
    end if;

    if round(v_earning + v_commission, 2) <> 100 then
        raise exception 'Driver and platform shares must add up to 100 percent.';
    end if;

    if v_base <= 0 and v_rate <= 0 and v_min <= 0 then
        raise exception 'Set at least one of base fare, price per kilometre or minimum fare — a category with no rates cannot be saved.';
    end if;

    if coalesce(nullif(trim(upper(p_currency)), ''), 'GHS') <> 'GHS' then
        raise exception 'Only GHS is supported.';
    end if;

    if coalesce(p_is_active, false) = false then
        raise exception 'Deactivate a category by saving its replacement, or switch the service off from the service settings.';
    end if;

    -- Retire the current active row (kept for audit / old quotes), then
    -- insert this one as the next version.
    update public.errands_pricing_rules
       set is_active = false,
           updated_by = v_uid,
           updated_at = now()
     where service_category = p_service_category
       and is_active;

    select coalesce(max(pricing_version), 0) + 1
      into v_version
      from public.errands_pricing_rules
     where service_category = p_service_category;

    insert into public.errands_pricing_rules (
        service_category, vehicle_category,
        base_fare, price_per_km, min_fare, max_fare,
        booking_fee, waiting_charge, waiting_charge_enabled,
        time_charge_per_minute, time_charge_enabled,
        surge_enabled, surge_multiplier, tax_rate_percent, discount_amount,
        driver_earning_percent, platform_commission_percent,
        currency, pricing_version, effective_from, is_active,
        created_by, updated_by
    ) values (
        p_service_category, p_vehicle_category,
        v_base, v_rate, v_min, v_max,
        v_booking, v_waiting, coalesce(p_waiting_charge_enabled, false),
        v_time, coalesce(p_time_charge_enabled, false),
        coalesce(p_surge_enabled, false),
        case when coalesce(p_surge_enabled, false) then v_surge else 1 end,
        v_tax, v_discount,
        v_earning, v_commission,
        'GHS', v_version,
        coalesce(p_effective_from, now()),
        true,
        v_uid, v_uid
    ) returning id into v_id;

    select to_jsonb(r) into v_row
      from public.errands_pricing_rules r
     where r.id = v_id;

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (v_uid, 'ERRANDS_PRICING_RULES_UPDATED', 'errands_pricing_rules',
            v_id::text, v_row);

    return v_row;
end;
$$;

comment on function public.set_errands_pricing_rules(text, text, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, boolean, boolean, numeric, numeric, numeric, numeric, numeric, text, timestamptz, boolean) IS
    'Super-admin only: save one service category fare rule set as a new version. Old versions are retired, not deleted.';

-- Admin read: every version of every category, newest first.
create or replace function public.get_errands_pricing_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
begin
    if v_uid is null or not exists (
        select 1 from public.profiles where id = v_uid and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can read Errands pricing rules.';
    end if;

    return coalesce(
        (
            select jsonb_agg(to_jsonb(r) order by r.service_category,
                     case when r.is_active then 0 else 1 end, r.pricing_version desc)
              from public.errands_pricing_rules r
        ),
        '[]'::jsonb
    );
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Grants.
--
--    The quote RPC is service_role only: the browser reaches it through
--    the errand-quote Edge Function, never directly. Everything else a
--    signed-in user needs is explicitly granted, and anon gets nothing.
-- ---------------------------------------------------------------------
revoke all on function public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text)
    from public, anon, authenticated;
grant execute on function public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text)
    to service_role;

revoke all on function public.errands_fare_amounts(numeric, integer, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.errands_fare_amounts(numeric, integer, text, jsonb)
    to service_role;

revoke all on function public.get_active_errands_pricing_rule(text) from public, anon;
grant execute on function public.get_active_errands_pricing_rule(text)
    to authenticated, service_role;

revoke all on function public.set_errands_pricing_rules(text, text, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, boolean, boolean, numeric, numeric, numeric, numeric, numeric, text, timestamptz, boolean)
    from public, anon;
grant execute on function public.set_errands_pricing_rules(text, text, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, boolean, boolean, numeric, numeric, numeric, numeric, numeric, text, timestamptz, boolean)
    to authenticated, service_role;

revoke all on function public.get_errands_pricing_rules() from public, anon;
grant execute on function public.get_errands_pricing_rules() to authenticated, service_role;

revoke all on function public.errands_in_service_area(double precision, double precision) from public, anon;
grant execute on function public.errands_in_service_area(double precision, double precision)
    to authenticated, service_role;

-- The signature of these changed above (4 arguments now); make sure the
-- caller roles match the new definitions.
revoke all on function public.set_errands_config(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_errands_config(boolean, boolean, boolean, boolean)
    to authenticated, service_role;

revoke all on function public.set_driver_service_capabilities(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_driver_service_capabilities(uuid, boolean, boolean, boolean)
    to authenticated, service_role;

revoke all on function public.errands_nearby_drivers(double precision, double precision, text, numeric, integer) from public, anon;
grant execute on function public.errands_nearby_drivers(double precision, double precision, text, numeric, integer)
    to authenticated, service_role;

revoke all on function public.errands_driver_is_available(uuid, text) from public, anon;
grant execute on function public.errands_driver_is_available(uuid, text)
    to authenticated, service_role;

revoke all on function public.get_errands_config() from public, anon;
grant execute on function public.get_errands_config() to authenticated, service_role;

notify pgrst, 'reload schema';
