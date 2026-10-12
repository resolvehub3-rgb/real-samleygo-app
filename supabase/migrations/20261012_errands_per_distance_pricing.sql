-- =====================================================================
-- SamleyGo — Errands & Rides: strictly PER-DISTANCE pricing
--
-- The fare IS the distance the customer travels. The previous formula
-- (base fare + per-km, floor, optional ceiling, booking fee) is gone:
-- there is no fixed component anywhere, so two trips cost the same only
-- when they cover the same road distance.
--
--   trip_fare  = round(distance_km x per_km_rate x surge, 2)
--   tax        = round(trip_fare x tax_rate_percent / 100, 2)
--   total      = trip_fare + tax
--   driver pay = round(total x driver_earning_percentage / 100, 2)
--
-- The distance is the REAL route: create_errands_quote() still prefers
-- the road route from the routing service and only falls back to its
-- own crow-fly measurement when the offered road distance is implausible.
--
-- What this migration does (idempotent; run AFTER the errands module):
--   1. rewrites get_errands_pricing_settings() — dead keys removed;
--   2. rewrites errands_pricing_amounts() — the new formula, which
--      REFUSES a rule set without a positive per-km rate (the honest
--      "not configured" message, never a free trip);
--   3. replaces set_errands_pricing() with a 5-argument signature
--      (per-km rate, tax %, driver earning %, surge, per-service
--      overrides of the per-km rate only) and drops the old 9-argument
--      version;
--   4. drops base_fare / min_fare / max_fare / booking_fee from the
--      errands_quotes snapshot and rewrites create_errands_quote();
--   5. normalises any stored rules (dead keys stripped, `configured`
--      forced false when no positive per-km rate exists).
--
-- Bookings are untouched — they only ever copied totals. The pricing
-- invariants are asserted by supabase/tests/errands_module_checks.sql
-- and by scripts/errands_pricing.test.ts (`npm test`).
-- =====================================================================

-- 1. Settings reader — per-distance keys only. ------------------------------
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
        'per_km_rate', coalesce(public.safe_numeric(v_raw -> 'per_km_rate', 0), 0),
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

-- 2. The single fare formula: price per kilometre x the measured route.
--    Revoked from clients: only the quote/booking RPCs may call it, so a
--    browser can never negotiate its own price.
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
    v_rate    numeric;
    v_tax     numeric;
    v_surge   numeric;
    v_earning numeric;
    v_version int;
    v_trip    numeric;
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

    v_rate    := coalesce(public.safe_numeric(v_eff -> 'per_km_rate', 0), 0);
    v_tax     := coalesce(public.safe_numeric(v_eff -> 'tax_rate_percent', 0), 0);
    v_surge   := coalesce(public.safe_numeric(v_eff -> 'surge_multiplier', 1), 1);
    v_earning := coalesce(public.safe_numeric(v_eff -> 'driver_earning_percentage', 100), 100);
    v_version := coalesce(public.safe_numeric(v_eff -> 'pricing_version', 1)::int, 1);

    if v_surge <= 0 then v_surge := 1; end if;
    if v_dist is null or v_dist < 0 then v_dist := 0; end if;
    if v_tax < 0 then v_tax := 0; end if;
    if v_tax > 100 then v_tax := 100; end if;
    if v_earning < 0 then v_earning := 0; end if;
    if v_earning > 100 then v_earning := 100; end if;

    -- A configured rule set always carries a positive per-km rate. This
    -- guard means a missing/legacy rate can never price a trip for free:
    -- the customer sees the honest "not configured" message instead.
    if v_rate <= 0 then
        raise exception 'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.';
    end if;

    -- The fare IS the distance. No base fare, no floor, no ceiling and no
    -- booking fee: the customer pays for the kilometres they travel.
    v_trip := round(v_dist * v_rate * v_surge, 2);

    v_tax_amt := round(v_trip * v_tax / 100, 2);
    v_total   := round(v_trip + v_tax_amt, 2);
    if v_total < 0 then v_total := 0; end if;

    return jsonb_build_object(
        'configured', true,
        'service_category', p_service_category,
        'distance_km', v_dist,
        'trip_fare', v_trip,
        'tax_amount', v_tax_amt,
        'estimated_fare', v_total,
        'driver_earning', round(v_total * v_earning / 100, 2),
        'driver_earning_percentage', v_earning,
        'per_km_rate', v_rate,
        'tax_rate_percent', v_tax,
        'surge_multiplier', v_surge,
        'pricing_version', v_version,
        'currency', coalesce(v_s ->> 'currency', 'GHS')
    );
end;
$$;

-- 3. The ONLY supported way to publish Errands pricing — now the per-km
--    rate and its multipliers, nothing else. Validates in the database,
--    bumps `pricing_version` and writes an audit log entry.
drop function if exists public.set_errands_pricing(
    numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb);

create or replace function public.set_errands_pricing(
    p_per_km_rate numeric,
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

    if p_per_km_rate is null or p_per_km_rate <= 0 or p_per_km_rate > 9999.99 then
        raise exception 'Price per kilometre must be a number greater than 0 (up to 9999.99) — the fare is calculated from the distance travelled';
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

    -- Per-service overrides: only known services, only the per-km rate.
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
            if (v_val - 'per_km_rate') <> '{}'::jsonb then
                raise exception 'The override for "%" contains an unsupported key', v_key;
            end if;
            if coalesce(jsonb_typeof(v_val -> 'per_km_rate'), 'null')
               not in ('number', 'null') then
                raise exception 'The override for "%" must contain only numbers', v_key;
            end if;
            v_services := v_services || jsonb_build_object(
                v_key,
                jsonb_strip_nulls(
                    jsonb_build_object(
                        'per_km_rate',
                            case when (v_val -> 'per_km_rate') is not null
                                 then public.safe_numeric(v_val -> 'per_km_rate', p_per_km_rate) end
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
            'per_km_rate', p_per_km_rate,
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
            'Per-distance Errands & rides pricing (price per km x route distance, tax, surge, driver earning) — versioned, applied to new quotes only')
    on conflict (key) do update
        set value = excluded.value,
            description = excluded.description,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'ERRANDS_PRICING_UPDATED', 'settings', 'errands_pricing', v_next);

    return v_next;
end;
$$;

-- 4. Quote snapshot: only the per-distance rules are kept.
alter table public.errands_quotes
    drop column if exists base_fare,
    drop column if exists min_fare,
    drop column if exists max_fare,
    drop column if exists booking_fee;

-- 5. The quote RPC, pricing and snapshotting with the new rule set.
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

    -- Raises the honest "not configured" message when nobody has set a
    -- per-km rate (or the stored rate is missing/zero).
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
        per_km_rate, tax_rate_percent,
        surge_multiplier, driver_earning_percentage, pricing_version,
        estimated_fare, driver_earning, currency,
        expires_at
    ) values (
        v_uid, p_service_category,
        v_pickup, p_pickup_lat, p_pickup_lng,
        v_dest, p_dest_lat, p_dest_lng,
        v_straight, v_distance, v_source, v_duration,
        (v_amounts ->> 'per_km_rate')::numeric,
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

-- 6. Normalise any stored rules: strip the removed keys everywhere (root
--    and per-service overrides) and force `configured` false when no
--    positive per-km rate exists — a legacy "base fare only" rule set
--    must never price a trip for free.
do $$
declare
    v_raw      jsonb;
    v_pristine jsonb;
    v_services jsonb := '{}'::jsonb;
    v_key      text;
    v_val      jsonb;
    v_rate     numeric;
begin
    select value into v_raw
      from public.platform_settings
     where key = 'errands_pricing';

    if not found then
        return;
    end if;
    if coalesce(jsonb_typeof(v_raw), 'object') <> 'object' then
        v_raw := '{}'::jsonb;
    end if;

    if jsonb_typeof(v_raw -> 'services') = 'object' then
        for v_key in select jsonb_object_keys(v_raw -> 'services') loop
            v_val := v_raw -> 'services' -> v_key;
            if v_key in ('ERRAND_MOTORCYCLE', 'RIDE_CAR')
               and jsonb_typeof(v_val) = 'object' then
                v_services := v_services || jsonb_build_object(v_key, jsonb_strip_nulls(
                    jsonb_build_object(
                        'per_km_rate',
                            case when (v_val -> 'per_km_rate') is not null
                                 then public.safe_numeric(v_val -> 'per_km_rate', 0) end
                    )));
            end if;
        end loop;
    end if;

    v_rate := coalesce(public.safe_numeric(v_raw -> 'per_km_rate', 0), 0);

    v_pristine := jsonb_strip_nulls(
        jsonb_build_object(
            'configured',
                v_rate > 0 and coalesce(v_raw ->> 'configured', 'false') = 'true',
            'currency', coalesce(nullif(v_raw ->> 'currency', ''), 'GHS'),
            'pricing_version',
                greatest(1, coalesce(public.safe_numeric(v_raw -> 'pricing_version', 1)::int, 1)),
            'per_km_rate', v_rate,
            'tax_rate_percent', coalesce(public.safe_numeric(v_raw -> 'tax_rate_percent', 0), 0),
            'surge_multiplier', coalesce(public.safe_numeric(v_raw -> 'surge_multiplier', 1), 1),
            'driver_earning_percentage',
                coalesce(public.safe_numeric(v_raw -> 'driver_earning_percentage', 100), 100),
            'quote_ttl_minutes',
                greatest(1, coalesce(public.safe_numeric(v_raw -> 'quote_ttl_minutes', 5)::int, 5)),
            'request_ttl_seconds',
                greatest(15, coalesce(public.safe_numeric(v_raw -> 'request_ttl_seconds', 90)::int, 90)),
            'services', v_services,
            'updated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
    );

    update public.platform_settings
       set value = v_pristine,
           description = 'Per-distance Errands & rides pricing (price per km x route distance, tax, surge, driver earning) — versioned, applied to new quotes only',
           updated_at = now()
     where key = 'errands_pricing';
end $$;

-- 7. Grants — the new signature; anon never executes either function.
revoke execute on function public.set_errands_pricing(numeric, numeric, numeric, numeric, jsonb) from public, anon;
grant execute on function public.set_errands_pricing(numeric, numeric, numeric, numeric, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
