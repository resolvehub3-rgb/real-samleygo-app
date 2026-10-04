-- =====================================================================
-- SamleyGo Phase 1 payment & commission model — database checks
--
-- Run this in the Supabase SQL editor (or `psql -f`) against ANY database,
-- including production: every statement runs inside a transaction that is
-- rolled back at the end, so nothing is committed and no data is touched.
--
-- A check reports PASS through a NOTICE. The only way this file can fail is
-- by raising an exception that starts with "FAIL —", which means a rule from
-- supabase/migrations/20261004_payment_commission_model.sql is broken.
--
-- Client-level coverage (checkout totals, rate versioning, refunds,
-- aggregation) lives in scripts/commission.test.ts — run `pnpm test`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Commission math: 15% of the FOOD subtotal, never of the delivery fee,
--    courier keeps the whole fee (0% courier commission), platform revenue
--    = commission only.
-- ---------------------------------------------------------------------
do $$
declare
    v_rate numeric;
    v_comm numeric;
    v_gross numeric;
    v_net numeric;
    v_cour numeric;
    v_plat numeric;
begin
    select commission_rate, commission_amount, restaurant_gross_amount,
           restaurant_net_amount, courier_earning, platform_revenue
      into v_rate, v_comm, v_gross, v_net, v_cour, v_plat
      from public.compute_order_financials(null::uuid, 200::numeric, 25::numeric);

    if v_rate is null or v_rate not between 0 and 50 then
        raise exception 'FAIL — commission rate (%) is outside the permitted 0-50 range', v_rate;
    end if;
    if v_gross is distinct from 200.00 then
        raise exception 'FAIL — restaurant gross must equal the food subtotal (%)', v_gross;
    end if;
    if v_comm is distinct from round(200 * v_rate / 100, 2) then
        raise exception 'FAIL — commission must be the rate applied to the food subtotal (rate %, got %, expected %)',
            v_rate, v_comm, round(200 * v_rate / 100, 2);
    end if;
    if v_net is distinct from v_gross - v_comm then
        raise exception 'FAIL — restaurant net must be gross minus commission (%)', v_net;
    end if;
    if v_cour is distinct from 25.00 then
        raise exception 'FAIL — courier must receive the full delivery fee (got %)', v_cour;
    end if;
    if v_plat is distinct from v_comm then
        raise exception 'FAIL — platform revenue must equal the commission, with no delivery cut (got %, expected %)',
            v_plat, v_comm;
    end if;

    raise notice 'PASS 1 — commission rate % applied to GHc200 food (GHc commission), courier keeps GHc25, platform earns GHc%',
        v_rate, v_plat;
end $$;

-- A bigger delivery fee must not change the commission at all.
do $$
declare
    v_rate numeric;
    v_comm_a numeric;
    v_comm_b numeric;
    v_cour_b numeric;
begin
    select commission_rate, commission_amount into v_rate, v_comm_a
      from public.compute_order_financials(null::uuid, 200::numeric, 25::numeric);
    select commission_rate, commission_amount, courier_earning into v_rate, v_comm_b, v_cour_b
      from public.compute_order_financials(null::uuid, 200::numeric, 90::numeric);

    if v_comm_b is distinct from v_comm_a then
        raise exception 'FAIL — commission changed when only the delivery fee changed (% -> %)',
            v_comm_a, v_comm_b;
    end if;
    if v_cour_b is distinct from 90.00 then
        raise exception 'FAIL — courier share of a GHc90 fee must be GHc90 (got %)', v_cour_b;
    end if;
    raise notice 'PASS 2 — delivery fee never affects the restaurant commission';
end $$;

-- ---------------------------------------------------------------------
-- 2. Commission settings are stored in a valid range.
-- ---------------------------------------------------------------------
do $$
declare
    v_rest numeric;
    v_cour numeric;
    v_max_rest numeric;
    v_max_cour numeric;
begin
    v_rest := (public.get_commission_settings() ->> 'restaurant_commission_percentage')::numeric;
    v_cour := (public.get_commission_settings() ->> 'courier_commission_percentage')::numeric;
    v_max_rest := coalesce((public.get_commission_settings() ->> 'max_restaurant_commission_percentage')::numeric, 50);
    v_max_cour := coalesce((public.get_commission_settings() ->> 'max_courier_commission_percentage')::numeric, 50);

    if v_rest is null or v_rest not between 0 and v_max_rest then
        raise exception 'FAIL — restaurant commission % is not between 0 and %', v_rest, v_max_rest;
    end if;
    if v_cour is null or v_cour not between 0 and v_max_cour then
        raise exception 'FAIL — courier commission % is not between 0 and %', v_cour, v_max_cour;
    end if;

    raise notice 'PASS 3 — commission settings valid: restaurant % percent, courier % percent',
        v_rest, v_cour;
end $$;

-- ---------------------------------------------------------------------
-- 3. Server-side tamper guard: an authenticated client (the customer who
--    owns the order) must NOT be able to rewrite commission, payout or
--    settlement values. The attempt is expected to be rejected by row level
--    security or by the apply_order_financials() trigger — never accepted.
--    Rolled back below like everything else.
-- ---------------------------------------------------------------------
do $$
declare
    v_order public.orders%rowtype;
    v_claims text;
begin
    select * into v_order from public.orders order by created_at desc limit 1;

    if not found then
        raise notice 'SKIP 4 — no orders in this database yet';
        return;
    end if;

    -- Become the order's own customer with an authenticated JWT.
    v_claims := json_build_object('sub', v_order.customer_id, 'role', 'authenticated')::text;
    execute format('set local request.jwt.claims to %L', v_claims);
    set local role authenticated;

    begin
        update public.orders
           set commission_amount = 0,
               restaurant_net_amount = v_order.subtotal,
               courier_earning = 0,
               settlement_status = 'PAID'
         where id = v_order.id;

        raise exception 'FAIL — an authenticated client rewrote protected financial fields';
    exception
        when insufficient_privilege then
            raise notice 'PASS 4 — protected fields blocked by row level security';
        when raise_exception then
            if sqlerrm like 'FAIL%' then
                raise;
            end if;
            raise notice 'PASS 4 — protected fields rejected by the orders trigger: %',
                left(sqlerrm, 140);
    end;

    reset role;
end $$;

rollback;
