-- =====================================================================
-- SamleyGo — Distance-based delivery pricing, delivery quotes and the
-- order-level delivery financial snapshot.
-- Run this in the Supabase SQL editor (Supabase Dashboard -> SQL Editor).
-- Idempotent: safe to run multiple times.
--
-- WHAT THIS MIGRATION DOES
--   1. Normalizes the `delivery_pricing` platform settings (base fee,
--      per-km rate, minimum, OPTIONAL maximum, surge, courier earning
--      percentage, pricing version) and reads them through one helper.
--   2. Adds set_delivery_pricing() — the only way to change delivery
--      pricing. Validates server-side and bumps `pricing_version`, so
--      every quote/order can snapshot which rules it was priced with.
--   3. Adds public.delivery_quotes — a short-lived, server-calculated
--      quote (distance + delivery fee + courier earning) that the
--      customer sees before paying.
--   4. Adds create_delivery_quote() — the trusted calculator:
--        restaurant coords (from the DB) -> customer coords ->
--        route distance -> pricing rules -> fee.
--      A client-supplied road distance is only accepted when it is
--      plausible against the server's own straight-line measurement;
--      otherwise the server distance wins. Nothing is trusted blindly.
--   5. Extends public.orders with the immutable delivery snapshot:
--        delivery_distance_km, delivery_distance_source,
--        delivery_pricing_version, delivery_quote_id.
--   6. Rewrites apply_order_financials() so an order INSERT validates
--      the delivery location, consumes a valid quote (or recalculates a
--      fresh one) and ALWAYS stores a server-derived distance + fee.
--   7. Backfills delivery_distance_km for historical orders from the
--      coordinates already stored on them.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
--   Restaurant commission is untouched. It is still computed from the
--   FOOD SUBTOTAL only, by 20261004_payment_commission_model.sql.
--   The delivery fee never enters the restaurant commission formula and
--   the delivery distance never enters it either.
--
-- FINANCIAL SEPARATION (Phase 1)
--   Customer   : food subtotal + distance-based delivery fee (+ tip)
--   Restaurant : commission on eligible food sales only
--   Courier    : delivery earning (courier commission 0% => keeps the fee)
--   SamleyGo   : the restaurant commission
-- =====================================================================

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
                   ('public.profiles'),
                   ('public.restaurants'),
                   ('public.platform_settings')) v(t)
     where to_regclass(v.t) is null;

    if missing is not null then
        raise exception E'SamleyGo schema not found - missing %.\nThis query is running in a DIFFERENT database than the app uses.\nOpen https://supabase.com/dashboard/project/xvflryuspotcmgvedxcj/sql/new\n(the project in VITE_SUPABASE_URL) - or leave any preview branch - and run it there.', missing;
    end if;

    if to_regprocedure('public.get_commission_settings()') is null then
        raise exception E'The commission model is missing (public.get_commission_settings).\nRun supabase/migrations/20261004_payment_commission_model.sql first - delivery pricing and restaurant commission stay separate, but both read the same settings tables.';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. SETTINGS HELPERS
-- ---------------------------------------------------------------------

-- Casts a jsonb leaf to numeric without ever raising: only a real number
-- or a strictly numeric string is accepted, anything else is the default.
create or replace function public.safe_numeric(p_value jsonb, p_default numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
    select coalesce(
        case jsonb_typeof(p_value)
            when 'number' then (p_value #>> '{}')::numeric
            when 'string' then
                case when (p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
                     then (p_value #>> '{}')::numeric
                end
        end,
        p_default
    );
$$;

-- Normalized delivery pricing rules. Every consumer (quote, order
-- trigger, admin console) reads the SAME numbers from the database —
-- there are no hard-coded prices anywhere in the frontend.
create or replace function public.get_delivery_pricing_settings()
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
     where key = 'delivery_pricing';

    if coalesce(jsonb_typeof(v_raw), 'object') <> 'object' then
        v_raw := '{}'::jsonb;
    end if;

    -- `max_fee` is OPTIONAL: a missing or null value means "no cap".
    return jsonb_strip_nulls(
        jsonb_build_object(
            'base_fee',                  public.safe_numeric(v_raw -> 'base_fee', 12.00),
            'per_km_rate',               public.safe_numeric(v_raw -> 'per_km_rate', 2.50),
            'min_fee',                   public.safe_numeric(v_raw -> 'min_fee', 10.00),
            'max_fee',
                case
                    when jsonb_typeof(v_raw -> 'max_fee') in ('number', 'string')
                        then public.safe_numeric(v_raw -> 'max_fee', 60.00)
                end,
            'surge_multiplier',          public.safe_numeric(v_raw -> 'surge_multiplier', 1.00),
            'courier_earning_percentage',
                coalesce(
                    case when jsonb_typeof(v_raw -> 'courier_earning_percentage') in ('number', 'string')
                         then public.safe_numeric(v_raw -> 'courier_earning_percentage', 100.00)
                    end,
                    -- Phase 1 default: the courier keeps the whole fee
                    -- (courier commission 0%).
                    100 - public.safe_numeric(
                        public.get_commission_settings() -> 'courier_commission_percentage', 0)
                ),
            'pricing_version',           greatest(1, public.safe_numeric(v_raw -> 'pricing_version', 1)::int),
            'currency',                  coalesce(nullif(v_raw ->> 'currency', ''), 'GHS')
        )
    );
end;
$$;

-- Distance in kilometres between two GPS points (great-circle). Used for
-- validation and as the honest fallback when no road route is available.
create or replace function public.haversine_km(
    p_lat1 double precision,
    p_lng1 double precision,
    p_lat2 double precision,
    p_lng2 double precision
)
returns numeric
language sql
immutable
set search_path = public
as $$
    select round(
        (2 * 6371 * asin(least(1.0, sqrt(
            power(sin(radians((p_lat2 - p_lat1) / 2)), 2) +
            cos(radians(p_lat1)) * cos(radians(p_lat2)) *
            power(sin(radians((p_lng2 - p_lng1) / 2)), 2)
        ))))::numeric
    , 3);
$$;

-- Rejects anything that is not a real, precise delivery point.
-- Raises the exact customer-facing message from the spec.
create or replace function public.assert_delivery_location(
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
        raise exception 'Please select a valid delivery location to calculate your delivery fee.';
    end if;
end;
$$;

-- The single pricing formula: base + (km x rate) x surge, clamped by the
-- minimum floor and the OPTIONAL maximum cap, then split into the
-- courier earning. All numeric arithmetic, rounded to whole pesewas.
create or replace function public.delivery_pricing_amounts(
    p_distance_km numeric,
    p_settings jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_s       jsonb := coalesce(p_settings, public.get_delivery_pricing_settings());
    v_dist    numeric := coalesce(p_distance_km, 0);
    v_base    numeric;
    v_rate    numeric;
    v_min     numeric;
    v_max     numeric;
    v_surge   numeric;
    v_version int;
    v_earning numeric;
    v_fee     numeric;
    v_courier numeric;
begin
    v_base    := coalesce(public.safe_numeric(v_s -> 'base_fee', 12.00), 0);
    v_rate    := coalesce(public.safe_numeric(v_s -> 'per_km_rate', 2.50), 0);
    v_min     := coalesce(public.safe_numeric(v_s -> 'min_fee', 10.00), 0);
    v_max     := case when jsonb_typeof(v_s -> 'max_fee') in ('number', 'string')
                      then public.safe_numeric(v_s -> 'max_fee', 60.00) end;
    v_surge   := coalesce(public.safe_numeric(v_s -> 'surge_multiplier', 1.00), 1.00);
    v_version := coalesce(public.safe_numeric(v_s -> 'pricing_version', 1)::int, 1);
    v_earning := coalesce(public.safe_numeric(v_s -> 'courier_earning_percentage', 100.00), 100.00);

    if v_surge <= 0 then v_surge := 1.00; end if;
    if v_dist is null or v_dist < 0 then v_dist := 0; end if;
    if v_min < 0 then v_min := 0; end if;
    if v_max is not null and v_max < 0 then v_max := null; end if;
    if v_earning < 0 then v_earning := 0; end if;
    if v_earning > 100 then v_earning := 100; end if;

    v_fee := round((v_base + v_dist * v_rate) * v_surge, 2);
    if v_min is not null then v_fee := greatest(v_min, v_fee); end if;
    if v_max is not null then v_fee := least(v_max, v_fee); end if;   -- null cap = uncapped
    if v_fee < 0 then v_fee := 0; end if;

    -- Courier share of the DELIVERY FEE only. The tip is tracked on
    -- orders.tip and always belongs to the courier.
    v_courier := round(v_fee * v_earning / 100, 2);

    return jsonb_build_object(
        'delivery_fee', v_fee,
        'courier_earning', v_courier,
        'courier_earning_percentage', v_earning,
        'courier_commission_percentage', round(100 - v_earning, 2),
        'base_fee', v_base,
        'per_km_rate', v_rate,
        'min_fee', v_min,
        'max_fee', v_max,
        'surge_multiplier', v_surge,
        'pricing_version', v_version,
        'currency', coalesce(v_s ->> 'currency', 'GHS')
    );
end;
$$;

-- Server-authoritative fee for a pickup -> drop-off pair. Kept (with its
-- original signature) because the orders trigger and older callers use it.
create or replace function public.calculate_delivery_fee_server(
    p_rest_lat double precision,
    p_rest_lng double precision,
    p_del_lat double precision,
    p_del_lng double precision
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_dist numeric;
begin
    v_dist := round(public.haversine_km(p_rest_lat, p_rest_lng, p_del_lat, p_del_lng), 2);
    return (public.delivery_pricing_amounts(v_dist) ->> 'delivery_fee')::numeric;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. set_delivery_pricing() — the only supported way to change the
--    delivery pricing rules. Validates in the database (the browser's
--    numbers are only a convenience), bumps pricing_version so every
--    quote/order can record which rules it used, and keeps the courier
--    commission in step with the courier earning percentage.
-- ---------------------------------------------------------------------
create or replace function public.set_delivery_pricing(
    p_base_fee numeric,
    p_per_km_rate numeric,
    p_min_fee numeric,
    p_max_fee numeric,
    p_courier_earning_percentage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_current     jsonb;
    v_next        jsonb;
    v_version     int;
    v_commission  jsonb;
    v_commission_pct numeric;
begin
    if auth.uid() is null or not exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can change delivery pricing';
    end if;

    -- BETWEEN rejects NULL, NaN, Infinity and out-of-range values.
    if p_base_fee is null or p_base_fee not between 0 and 9999.99 then
        raise exception 'Base delivery fee must be a number between 0 and 9999.99';
    end if;
    if p_per_km_rate is null or p_per_km_rate not between 0 and 9999.99 then
        raise exception 'Price per kilometre must be a number between 0 and 9999.99';
    end if;
    if p_min_fee is null or p_min_fee not between 0 and 999999.99 then
        raise exception 'Minimum delivery fee must be a number between 0 and 999999.99';
    end if;
    if p_max_fee is not null and p_max_fee not between 0 and 999999.99 then
        raise exception 'Maximum delivery fee must be empty (no cap) or a number between 0 and 999999.99';
    end if;
    if p_max_fee is not null and p_max_fee < p_min_fee then
        raise exception 'The maximum delivery fee cannot be lower than the minimum';
    end if;
    if p_courier_earning_percentage is null
       or p_courier_earning_percentage not between 0 and 100 then
        raise exception 'Courier earning percentage must be between 0 and 100';
    end if;

    v_current := public.get_delivery_pricing_settings();
    v_version := greatest(1, coalesce((v_current ->> 'pricing_version')::int, 1)) + 1;

    v_next := jsonb_strip_nulls(
        jsonb_build_object(
            'base_fee', p_base_fee,
            'per_km_rate', p_per_km_rate,
            'min_fee', p_min_fee,
            'max_fee', p_max_fee,
            'surge_multiplier', coalesce(public.safe_numeric(v_current -> 'surge_multiplier', 1.00), 1.00),
            'courier_earning_percentage', p_courier_earning_percentage,
            'pricing_version', v_version,
            'currency', coalesce(v_current ->> 'currency', 'GHS'),
            'updated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
    );

    insert into public.platform_settings (key, value, description)
    values ('delivery_pricing', v_next,
            'Distance-based delivery pricing (base fee + per km, min/max, courier earning) — versioned, applied to new quotes/orders only')
    on conflict (key) do update
        set value = excluded.value,
            description = excluded.description,
            updated_at = now();

    -- Keep the commission rules consistent: the two views of the same
    -- Phase 1 rule are "courier earns X%" and "courier pays (100-X)%".
    v_commission := public.get_commission_settings();
    v_commission_pct := round(100 - p_courier_earning_percentage, 2);

    v_commission := v_commission || jsonb_build_object(
        'courier_commission_percentage', v_commission_pct,
        'courier_earning_percentage', p_courier_earning_percentage,
        'updated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    insert into public.platform_settings (key, value, description)
    values ('commission', v_commission,
            'Phase 1 marketplace commission rules — restaurant commission is charged per order on food subtotal; couriers pay 0% commission.')
    on conflict (key) do update
        set value = excluded.value,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (
        auth.uid(),
        'DELIVERY_PRICING_UPDATED',
        'settings',
        'delivery_pricing',
        v_next
    );

    return v_next;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. DELIVERY QUOTES — short-lived, server-calculated distance + fee.
--    The customer sees the quote before paying; the orders trigger later
--    consumes it (or recalculates) so the browser can never set the fee.
-- ---------------------------------------------------------------------
create table if not exists public.delivery_quotes (
    id                       uuid primary key default gen_random_uuid(),
    customer_id              uuid not null references public.profiles(id) on delete cascade,
    restaurant_id            uuid not null references public.restaurants(id) on delete cascade,
    -- Snapshot of BOTH endpoints at quote time (audit trail).
    pickup_latitude          double precision not null,
    pickup_longitude         double precision not null,
    delivery_latitude        double precision not null,
    delivery_longitude       double precision not null,
    -- Distance actually used for pricing.
    distance_km              numeric(6,2) not null,
    distance_source          text not null default 'STRAIGHT_LINE',
    straight_line_km         numeric(6,3) not null,
    -- Pricing rules the quote was priced with (versioning).
    base_fee                 numeric(10,2) not null,
    per_km_rate              numeric(10,2) not null,
    min_fee                  numeric(10,2) not null,
    max_fee                  numeric(10,2),
    surge_multiplier         numeric(6,3) not null default 1.000,
    courier_earning_percentage numeric(5,2) not null default 100.00,
    pricing_version          integer not null default 1,
    -- Money.
    delivery_fee             numeric(10,2) not null,
    courier_earning          numeric(10,2) not null,
    currency                 text not null default 'GHS',
    -- Lifecycle.
    expires_at               timestamptz not null,
    consumed_at              timestamptz,
    created_at               timestamptz not null default now(),
    constraint delivery_quotes_source_check
        check (distance_source in ('ROAD_ROUTE', 'STRAIGHT_LINE')),
    constraint delivery_quotes_distance_check
        check (distance_km between 0.01 and 9999.99),
    constraint delivery_quotes_fee_check
        check (delivery_fee between 0 and 99999999.99),
    constraint delivery_quotes_earning_check
        check (courier_earning between 0 and 99999999.99),
    constraint delivery_quotes_earning_pct_check
        check (courier_earning_percentage between 0 and 100),
    constraint delivery_quotes_expiry_check
        check (expires_at > created_at)
);

create index if not exists idx_delivery_quotes_customer
    on public.delivery_quotes(customer_id, created_at desc);
create index if not exists idx_delivery_quotes_open
    on public.delivery_quotes(expires_at)
    where consumed_at is null;

alter table public.delivery_quotes enable row level security;

-- Customers read their own quotes; super admins read every quote (the
-- app does not otherwise expose quotes — the RPC returns them directly).
drop policy if exists "Customers can view their delivery quotes" on public.delivery_quotes;
create policy "Customers can view their delivery quotes" on public.delivery_quotes
    for select using (
        customer_id = auth.uid() or exists (
            select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );

-- No INSERT / UPDATE / DELETE policies on purpose: quotes are created by
-- create_delivery_quote() and consumed by the orders trigger only.
grant select on public.delivery_quotes to authenticated;
grant all on public.delivery_quotes to service_role;
revoke all on public.delivery_quotes from anon;

-- ---------------------------------------------------------------------
-- 4. create_delivery_quote() — THE trusted distance/fee calculator.
--
--    1. Reads the restaurant coordinates from the database (never from
--       the request body).
--    2. Validates the customer's delivery coordinates.
--    3. Measures the straight-line distance server-side.
--    4. Accepts a client-supplied ROAD distance only when it is
--       plausible against that measurement (a route can never be shorter
--       than the crow-fly distance, nor absurdly longer); otherwise the
--       server's own number is used. Road distance therefore wins when
--       the mapping service supports it, and is never faked.
--    5. Loads the live pricing rules and returns the quote.
-- ---------------------------------------------------------------------
create or replace function public.create_delivery_quote(
    p_restaurant_id uuid,
    p_delivery_lat double precision,
    p_delivery_lng double precision,
    p_road_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid      uuid := auth.uid();
    v_rest     record;
    v_straight numeric;
    v_distance numeric;
    v_source   text;
    v_settings jsonb;
    v_amounts  jsonb;
    v_quote_id uuid;
    v_expires  timestamptz;
begin
    if v_uid is null then
        raise exception 'Sign in to get a delivery quote.';
    end if;

    perform public.assert_delivery_location(p_delivery_lat, p_delivery_lng);

    select id, name, latitude, longitude
      into v_rest
      from public.restaurants
     where id = p_restaurant_id;
    if not found then
        raise exception 'That kitchen is not available.';
    end if;
    if v_rest.latitude is null or v_rest.longitude is null then
        raise exception 'This kitchen has not set its pickup location yet, so the delivery fee cannot be calculated.';
    end if;
    perform public.assert_delivery_location(v_rest.latitude, v_rest.longitude);

    -- Server measurement of restaurant -> customer.
    v_straight := round(
        public.haversine_km(v_rest.latitude, v_rest.longitude, p_delivery_lat, p_delivery_lng), 2);

    v_distance := v_straight;
    v_source   := 'STRAIGHT_LINE';

    -- A mapping-service route distance is only believable when it is
    -- (a) at least the straight-line distance (minus rounding slack) and
    -- (b) not more than a very generous detour factor. Anything else is
    -- discarded and the server's own measurement is priced instead.
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

    v_settings := public.get_delivery_pricing_settings();
    v_amounts  := public.delivery_pricing_amounts(v_distance, v_settings);
    v_expires  := now() + interval '5 minutes';

    -- Housekeeping: forget this customer's stale, unused quotes.
    delete from public.delivery_quotes
     where customer_id = v_uid
       and consumed_at is null
       and expires_at < now() - interval '1 day';

    insert into public.delivery_quotes (
        customer_id, restaurant_id,
        pickup_latitude, pickup_longitude,
        delivery_latitude, delivery_longitude,
        distance_km, distance_source, straight_line_km,
        base_fee, per_km_rate, min_fee, max_fee, surge_multiplier,
        courier_earning_percentage, pricing_version,
        delivery_fee, courier_earning, currency,
        expires_at
    ) values (
        v_uid, v_rest.id,
        v_rest.latitude, v_rest.longitude,
        p_delivery_lat, p_delivery_lng,
        v_distance, v_source, v_straight,
        public.safe_numeric(v_settings -> 'base_fee', 12.00),
        public.safe_numeric(v_settings -> 'per_km_rate', 2.50),
        public.safe_numeric(v_settings -> 'min_fee', 10.00),
        case when jsonb_typeof(v_settings -> 'max_fee') in ('number', 'string')
             then public.safe_numeric(v_settings -> 'max_fee', 60.00) end,
        public.safe_numeric(v_settings -> 'surge_multiplier', 1.00),
        public.safe_numeric(v_settings -> 'courier_earning_percentage', 100.00),
        (v_settings ->> 'pricing_version')::int,
        (v_amounts ->> 'delivery_fee')::numeric,
        (v_amounts ->> 'courier_earning')::numeric,
        v_amounts ->> 'currency',
        v_expires
    ) returning id into v_quote_id;

    return v_amounts || jsonb_build_object(
        'quote_id', v_quote_id,
        'restaurant_id', v_rest.id,
        'restaurant_name', v_rest.name,
        'distance_km', v_distance,
        'distance_source', v_source,
        'straight_line_km', v_straight,
        'issued_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expires_at', to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
end;
$$;

-- Only signed-in customers may ask for a quote; the internals stay out of
-- the public API surface.
revoke execute on function public.create_delivery_quote(uuid, double precision, double precision, numeric)
    from public, anon;
revoke execute on function public.safe_numeric(jsonb, numeric) from public, anon;
revoke execute on function public.delivery_pricing_amounts(numeric, jsonb) from public, anon;
revoke execute on function public.get_delivery_pricing_settings() from public, anon;
revoke execute on function public.assert_delivery_location(double precision, double precision) from public, anon;
revoke execute on function public.set_delivery_pricing(numeric, numeric, numeric, numeric, numeric)
    from public, anon;

grant execute on function public.create_delivery_quote(uuid, double precision, double precision, numeric)
    to authenticated;
grant execute on function public.set_delivery_pricing(numeric, numeric, numeric, numeric, numeric)
    to authenticated;
-- Read-only view of the current rules (so no screen re-implements them).
grant execute on function public.get_delivery_pricing_settings() to authenticated;

-- ---------------------------------------------------------------------
-- 5. ORDER-LEVEL DELIVERY SNAPSHOT — historical orders keep the exact
--    distance, fee and pricing version they were placed with. A later
--    GH₵2/km -> GH₵2.50/km change never reaches them.
-- ---------------------------------------------------------------------
alter table public.orders
    add column if not exists delivery_distance_km numeric(6,2),
    add column if not exists delivery_distance_source text,
    add column if not exists delivery_pricing_version integer,
    add column if not exists delivery_quote_id uuid;

-- A quote pointer is provenance, not money: if the quote row ever goes
-- away the snapshot stored on the order stays exactly as it was.
alter table public.orders drop constraint if exists orders_delivery_quote_id_fkey;
alter table public.orders add constraint orders_delivery_quote_id_fkey
    foreign key (delivery_quote_id) references public.delivery_quotes(id)
    on delete set null;

alter table public.orders drop constraint if exists orders_delivery_distance_check;
alter table public.orders add constraint orders_delivery_distance_check
    check (delivery_distance_km is null or delivery_distance_km between 0 and 9999.99);

alter table public.orders drop constraint if exists orders_delivery_distance_source_check;
alter table public.orders add constraint orders_delivery_distance_source_check
    check (delivery_distance_source is null or delivery_distance_source in ('ROAD_ROUTE', 'STRAIGHT_LINE'));

-- ---------------------------------------------------------------------
-- 6. ORDERS TRIGGER — on INSERT the delivery location is validated, a
--    valid quote is consumed (or a fresh quote is recalculated), and the
--    distance + fee stored on the row are ALWAYS server-derived.
--    Restaurant commission keeps being computed from the FOOD SUBTOTAL
--    only (unchanged: see section "Commission" below).
-- ---------------------------------------------------------------------
create or replace function public.apply_order_financials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_internal boolean :=
        coalesce(current_setting('samleygo.internal_financial_write', true), '') = '1';
    v_rest_lat double precision;
    v_rest_lng double precision;
    v_rate numeric;
    v_courier_comm numeric;
    v_courier_share numeric;
    v_has_money_change boolean;
    v_quote public.delivery_quotes%rowtype;
    v_quote_valid boolean := false;
    v_settings jsonb;
begin
    if tg_op = 'INSERT' then
        -- 1. Basic validation of what the customer controls.
        if new.subtotal is null or new.subtotal not between 0 and 99999999.99 then
            raise exception 'Invalid food subtotal';
        end if;
        if new.tip is null or new.tip not between 0 and 99999999.99 then
            raise exception 'Invalid tip';
        end if;
        new.delivery_fee := coalesce(new.delivery_fee, 0);
        if new.delivery_fee not between 0 and 99999999.99 then
            raise exception 'Invalid delivery fee';
        end if;

        -- 2. A real, precise delivery location is mandatory: without it
        --    there is no distance, and without a distance there is no
        --    honest delivery fee.
        perform public.assert_delivery_location(new.delivery_latitude, new.delivery_longitude);

        select r.latitude, r.longitude
          into v_rest_lat, v_rest_lng
          from public.restaurants r
         where r.id = new.restaurant_id;
        if not found then
            raise exception 'Order restaurant not found';
        end if;
        if v_rest_lat is null or v_rest_lng is null then
            raise exception 'This kitchen has not set its pickup location yet, so the delivery fee cannot be calculated.';
        end if;

        -- 3. Consume the customer's quote when it is still good: right
        --    customer, right kitchen, right drop-off, not expired, not
        --    already used. Anything else is ignored and re-derived.
        if new.delivery_quote_id is not null then
            select * into v_quote from public.delivery_quotes
             where id = new.delivery_quote_id;
            if found
               and v_quote.customer_id = new.customer_id
               and v_quote.restaurant_id = new.restaurant_id
               and v_quote.consumed_at is null
               and v_quote.expires_at > now()
               and abs(v_quote.delivery_latitude - new.delivery_latitude) <= 0.0001
               and abs(v_quote.delivery_longitude - new.delivery_longitude) <= 0.0001 then
                v_quote_valid := true;
            end if;
        end if;

        if v_quote_valid then
            new.delivery_distance_km := v_quote.distance_km;
            new.delivery_distance_source := v_quote.distance_source;
            new.delivery_pricing_version := v_quote.pricing_version;
            new.delivery_fee := v_quote.delivery_fee;
            update public.delivery_quotes
               set consumed_at = now()
             where id = v_quote.id and consumed_at is null;
        else
            -- Fresh, trusted calculation from the stored coordinates.
            -- The submitted pointer (if any) pointed at a quote that is
            -- expired, already used or not this order's — never keep it.
            new.delivery_quote_id := null;
            new.delivery_distance_km := round(
                public.haversine_km(v_rest_lat, v_rest_lng,
                                    new.delivery_latitude, new.delivery_longitude), 2);
            new.delivery_distance_source := 'STRAIGHT_LINE';
            v_settings := public.get_delivery_pricing_settings();
            new.delivery_pricing_version :=
                greatest(1, coalesce((v_settings ->> 'pricing_version')::int, 1));
            new.delivery_fee := (
                public.delivery_pricing_amounts(new.delivery_distance_km, v_settings)
                    ->> 'delivery_fee')::numeric;
        end if;

        if new.delivery_distance_km is null or new.delivery_distance_km not between 0 and 9999.99 then
            raise exception 'Delivery distance could not be calculated';
        end if;
        if new.delivery_fee not between 0 and 99999999.99 then
            raise exception 'Invalid delivery fee';
        end if;

        -- 4. Commission rate is SNAPSHOTTED here (commission versioning):
        --    later platform rate changes never rewrite this order.
        --    NOTE: commission applies to the FOOD SUBTOTAL only — the
        --    delivery fee above never enters this formula.
        new.commission_rate := round(public.get_restaurant_commission_rate(new.restaurant_id), 2);
        new.currency := coalesce(new.currency, 'GHS');
        new.payment_status := coalesce(new.payment_status, 'PENDING');
        if new.payment_status not in
           ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED') then
            raise exception 'Invalid payment status %', new.payment_status;
        end if;
        new.settlement_status := 'PENDING';
        new.settlement_updated_at := now();

    elsif tg_op = 'UPDATE' then
        -- Financial, payment and delivery-snapshot fields are
        -- server-managed. Refuse any write coming from an authenticated
        -- client. Internal bookkeeping — and direct DBA / service-role
        -- work, which PostgREST never issues — passes. `status` is
        -- deliberately NOT protected: the lifecycle is driven by people.
        if not v_internal and auth.uid() is not null and (
            new.order_number is distinct from old.order_number or
            new.customer_id is distinct from old.customer_id or
            new.restaurant_id is distinct from old.restaurant_id or
            new.subtotal is distinct from old.subtotal or
            new.delivery_fee is distinct from old.delivery_fee or
            new.delivery_distance_km is distinct from old.delivery_distance_km or
            new.delivery_distance_source is distinct from old.delivery_distance_source or
            new.delivery_pricing_version is distinct from old.delivery_pricing_version or
            new.delivery_quote_id is distinct from old.delivery_quote_id or
            new.delivery_latitude is distinct from old.delivery_latitude or
            new.delivery_longitude is distinct from old.delivery_longitude or
            new.tip is distinct from old.tip or
            new.total_amount is distinct from old.total_amount or
            new.commission_rate is distinct from old.commission_rate or
            new.commission_amount is distinct from old.commission_amount or
            new.restaurant_gross_amount is distinct from old.restaurant_gross_amount or
            new.restaurant_net_amount is distinct from old.restaurant_net_amount or
            new.courier_earning is distinct from old.courier_earning or
            new.platform_revenue is distinct from old.platform_revenue or
            new.currency is distinct from old.currency or
            new.settlement_status is distinct from old.settlement_status or
            new.commission_calculated_at is distinct from old.commission_calculated_at or
            new.settlement_updated_at is distinct from old.settlement_updated_at or
            new.payment_method is distinct from old.payment_method or
            new.payment_status is distinct from old.payment_status or
            new.payment_reference is distinct from old.payment_reference
        ) then
            raise exception
                'The financial fields of an order are managed by the SamleyGo server and cannot be modified from the client';
        end if;

        -- Settlement lifecycle (kept separate from payment state):
        --   delivered/completed + paid  -> ELIGIBLE (commission earned)
        --   cancelled/rejected/failed   -> CANCELLED (never recognized)
        if new.status is distinct from old.status then
            if new.status in ('DELIVERED', 'COMPLETED') then
                if new.payment_status in ('COMPLETED', 'PAID')
                   and coalesce(old.settlement_status, 'PENDING') in ('PENDING', 'ELIGIBLE') then
                    new.settlement_status := 'ELIGIBLE';
                    new.settlement_updated_at := now();
                end if;
            elsif new.status in ('CANCELLED', 'REJECTED', 'FAILED') then
                if old.settlement_status = 'PAID' then
                    new.settlement_status := 'REVERSED';
                elsif coalesce(old.settlement_status, 'PENDING') not in ('REVERSED', 'CANCELLED') then
                    new.settlement_status := 'CANCELLED';
                end if;
                new.settlement_updated_at := now();
            end if;
        end if;

        -- A late payment confirmation also promotes a delivered order.
        if new.payment_status is distinct from old.payment_status
           and new.payment_status in ('COMPLETED', 'PAID')
           and new.status in ('DELIVERED', 'COMPLETED')
           and coalesce(old.settlement_status, 'PENDING') = 'PENDING' then
            new.settlement_status := 'ELIGIBLE';
            new.settlement_updated_at := now();
        end if;
    end if;

    -- 7. (Re)compute every derived amount whenever the underlying money
    --    moved. The snapshotted rate is preserved on updates so a rate
    --    change can never rewrite history. (OLD is only valid in UPDATE
    --    triggers, so the branches are kept separate.)
    --
    --    STRICT SEPARATION: commission_amount and restaurant_net_amount
    --    are derived from `subtotal` ONLY. The delivery fee and the
    --    delivery distance are never an input to restaurant commission.
    if tg_op = 'INSERT' then
        v_has_money_change := true;
    else
        v_has_money_change := new.subtotal is distinct from old.subtotal
            or new.delivery_fee is distinct from old.delivery_fee
            or new.tip is distinct from old.tip;
    end if;

    if v_has_money_change then
        v_rate := coalesce(new.commission_rate,
                           public.get_restaurant_commission_rate(new.restaurant_id));
        if v_rate is null or v_rate < 0 or v_rate > 50 then
            raise exception 'Restaurant commission rate % is outside the permitted 0-50%% range', v_rate;
        end if;
        v_courier_comm := coalesce(
            (public.get_commission_settings() ->> 'courier_commission_percentage')::numeric, 0);
        if v_courier_comm is null or v_courier_comm < 0 or v_courier_comm > 50 then
            raise exception 'Courier commission rate % is outside the permitted 0-50%% range', v_courier_comm;
        end if;

        new.commission_rate         := round(v_rate, 2);
        new.commission_amount       := round(new.subtotal * v_rate / 100, 2);
        new.restaurant_gross_amount := new.subtotal;
        new.restaurant_net_amount   := new.subtotal - round(new.subtotal * v_rate / 100, 2);
        v_courier_share             := round(new.delivery_fee * (100 - v_courier_comm) / 100, 2);
        new.courier_earning         := v_courier_share;
        new.platform_revenue        := new.commission_amount + (new.delivery_fee - v_courier_share);
        new.commission_calculated_at := now();
        new.currency                := coalesce(new.currency, 'GHS');
        -- Customer total = food + delivery fee (+ tip). Nothing else.
        new.total_amount            := new.subtotal + new.delivery_fee + new.tip;
    elsif new.total_amount is distinct from (new.subtotal + new.delivery_fee + new.tip) then
        -- Self-heal a corrupted customer total.
        new.total_amount := new.subtotal + new.delivery_fee + new.tip;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_orders_apply_financials on public.orders;
create trigger trg_orders_apply_financials
    before insert or update on public.orders
    for each row execute function public.apply_order_financials();

-- ---------------------------------------------------------------------
-- 7. BACKFILL — derive the distance of existing orders from the
--    coordinates already stored on them. Nothing is invented: rows
--    without coordinates keep a NULL distance (the column is nullable
--    precisely so history is never fabricated), and no money is changed.
-- ---------------------------------------------------------------------
update public.orders o
   set delivery_distance_km = round(
           public.haversine_km(r.latitude, r.longitude,
                               o.delivery_latitude, o.delivery_longitude), 2),
       delivery_distance_source = 'STRAIGHT_LINE'
  from public.restaurants r
 where r.id = o.restaurant_id
   and o.delivery_distance_km is null
   and r.latitude is not null
   and r.longitude is not null
   and o.delivery_latitude is not null
   and o.delivery_longitude is not null;

-- ---------------------------------------------------------------------
-- 8. Refresh PostgREST's schema cache so the new RPC is immediately
--    usable from the app.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
