-- =====================================================================
-- SamleyGo Phase 1 — Production payment & restaurant commission model
-- Run this in the Supabase SQL editor (Supabase Dashboard -> SQL Editor).
-- Idempotent: safe to run multiple times.
--
-- WHAT THIS MIGRATION DOES
--   1. Extends public.orders with an immutable, per-order financial
--      record (commission versioning) instead of creating duplicate
--      financial tables:
--        commission_rate, commission_amount, restaurant_gross_amount,
--        restaurant_net_amount, courier_earning, platform_revenue,
--        currency, settlement_status.
--   2. Seeds the configurable marketplace rules in platform_settings:
--        restaurant commission = 15% (Phase 1 platform revenue)
--        courier commission    = 0%  (courier receives the delivery fee)
--   3. Adds SQL triggers that calculate EVERY money value server-side.
--      A client can no longer tamper with food price, delivery fee,
--      commission, restaurant payout or courier payout — the database
--      recomputes and, on update, refuses financial writes from clients.
--   4. Adds public.order_settlement_adjustments — an append-only table
--      for refund/cancellation reversals. Historical financial records
--      are never rewritten destructively.
--   5. Adds payments RLS policies (the table existed with RLS enabled
--      and NO policy, so every payment row was silently dropped).
--   6. Backfills existing orders from data already in the database
--      (subtotal + the commission rate that was in effect). Nothing is
--      invented: orders whose status never completed are marked
--      settlement_status = 'CANCELLED' / 'PENDING', never 'ELIGIBLE'.
--
-- BUSINESS MODEL (Phase 1)
--   Customer pays : food subtotal + delivery fee (+ optional tip)
--   Restaurant    : pays commission on FOOD SUBTOTAL only (default 15%)
--   Courier       : receives the delivery earning, pays 0% commission
--   SamleyGo      : earns the restaurant commission
--   Delivery fee and restaurant commission are separate economics.
--
-- COMMISSION VERSIONING
--   The rate is snapshotted onto the order at creation. Changing the
--   platform rate later NEVER rewrites historical orders.
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
                   ('public.order_items'),
                   ('public.platform_settings')) v(t)
     where to_regclass(v.t) is null;

    if missing is not null then
        raise exception E'SamleyGo schema not found - missing %.\nThis query is running in a DIFFERENT database than the app uses.\nOpen https://supabase.com/dashboard/project/xvflryuspotcmgvedxcj/sql/new\n(the project in VITE_SUPABASE_URL) - or leave any preview branch - and run it there.', missing;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. ORDER-LEVEL FINANCIAL RECORD (extend the existing orders table —
--    one restaurant per order, so a single commission record per order
--    is correct; no redundant financial tables are created).
--    All columns are nullable/defaults first so the migration is safe on
--    live data, then backfilled further down.
-- ---------------------------------------------------------------------
alter table public.orders
    add column if not exists commission_rate numeric(5,2),
    add column if not exists commission_amount numeric(10,2),
    add column if not exists restaurant_gross_amount numeric(10,2),
    add column if not exists restaurant_net_amount numeric(10,2),
    add column if not exists courier_earning numeric(10,2),
    add column if not exists platform_revenue numeric(10,2),
    add column if not exists currency text not null default 'GHS',
    add column if not exists settlement_status text not null default 'PENDING',
    add column if not exists commission_calculated_at timestamptz,
    add column if not exists settlement_updated_at timestamptz;

-- Money must be a real, finite, non-negative amount. The upper bound
-- also rejects NaN and Infinity (PostgreSQL treats NaN as larger than
-- every other numeric, so `x <= 99999999.99` is false for it).
alter table public.orders drop constraint if exists orders_money_non_negative;
alter table public.orders add constraint orders_money_non_negative
    check (
        subtotal between 0 and 99999999.99 and
        delivery_fee between 0 and 99999999.99 and
        tip between 0 and 99999999.99 and
        total_amount between 0 and 99999999.99
    );

alter table public.orders drop constraint if exists orders_commission_rate_check;
alter table public.orders add constraint orders_commission_rate_check
    check (commission_rate is null or commission_rate between 0 and 50);

alter table public.orders drop constraint if exists orders_commission_amount_check;
alter table public.orders add constraint orders_commission_amount_check
    check (commission_amount is null or commission_amount between 0 and 99999999.99);

alter table public.orders drop constraint if exists orders_restaurant_gross_check;
alter table public.orders add constraint orders_restaurant_gross_check
    check (restaurant_gross_amount is null or restaurant_gross_amount between 0 and 99999999.99);

alter table public.orders drop constraint if exists orders_restaurant_net_check;
alter table public.orders add constraint orders_restaurant_net_check
    check (restaurant_net_amount is null or restaurant_net_amount between 0 and 99999999.99);

alter table public.orders drop constraint if exists orders_courier_earning_check;
alter table public.orders add constraint orders_courier_earning_check
    check (courier_earning is null or courier_earning between 0 and 99999999.99);

alter table public.orders drop constraint if exists orders_platform_revenue_check;
alter table public.orders add constraint orders_platform_revenue_check
    check (platform_revenue is null or platform_revenue between 0 and 99999999.99);

-- Settlement state is kept separate from payment state (Phase 1 model).
alter table public.orders drop constraint if exists orders_settlement_status_check;
alter table public.orders add constraint orders_settlement_status_check
    check (settlement_status in ('PENDING', 'ELIGIBLE', 'PROCESSING', 'PAID', 'REVERSED', 'CANCELLED'));

-- Payment lifecycle: the three states the app already used, plus the
-- refund states the settlement flow needs.
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
    check (payment_status in ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'));

-- ---------------------------------------------------------------------
-- 2. APPEND-ONLY SETTLEMENT ADJUSTMENTS (refunds & reversals).
--    Never rewrite an order's historical financial record — record the
--    reversal alongside it instead.
-- ---------------------------------------------------------------------
create table if not exists public.order_settlement_adjustments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    adjustment_type text not null,
    refund_amount numeric(10,2) not null default 0,
    food_amount_refunded numeric(10,2) not null default 0,
    delivery_amount_refunded numeric(10,2) not null default 0,
    -- Signed adjustments: negative means money moving back out of that
    -- bucket. Net recognition = order amount + SUM(adjustments).
    commission_adjustment numeric(10,2) not null default 0,
    restaurant_net_adjustment numeric(10,2) not null default 0,
    courier_earning_adjustment numeric(10,2) not null default 0,
    platform_revenue_adjustment numeric(10,2) not null default 0,
    reason text,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    constraint order_settlement_adjustments_type_check
        check (adjustment_type in ('REFUND', 'PARTIAL_REFUND', 'CANCELLATION', 'CORRECTION')),
    constraint order_settlement_adjustments_amount_check
        check (refund_amount between 0 and 99999999.99)
);

create index if not exists idx_settlement_adjustments_order
    on public.order_settlement_adjustments(order_id);

alter table public.order_settlement_adjustments enable row level security;

-- Order participants may READ their own money movements. The customer
-- deliberately does NOT see commission reversals — that is an internal
-- marketplace settlement calculation.
drop policy if exists "Participants can view settlement adjustments" on public.order_settlement_adjustments;
create policy "Participants can view settlement adjustments" on public.order_settlement_adjustments
    for select using (
        exists (
            select 1 from public.profiles
             where id = auth.uid() and role = 'SUPER_ADMIN'
        ) or exists (
            select 1 from public.orders o
             where o.id = order_settlement_adjustments.order_id
               and (o.courier_id = auth.uid() or exists (
                   select 1 from public.restaurants r
                    where r.id = o.restaurant_id and r.owner_id = auth.uid()
               ))
        )
    );

-- Only a super admin records adjustments (the refund RPC below is the
-- normal writer; this policy covers direct admin tooling).
drop policy if exists "Super admins can record settlement adjustments" on public.order_settlement_adjustments;
create policy "Super admins can record settlement adjustments" on public.order_settlement_adjustments
    for insert with check (
        exists (
            select 1 from public.profiles
             where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );

-- No UPDATE / DELETE policies on purpose: adjustments are append-only.
grant select, insert on public.order_settlement_adjustments to authenticated;
grant all on public.order_settlement_adjustments to service_role;
revoke all on public.order_settlement_adjustments from anon;

-- ---------------------------------------------------------------------
-- 3. CONFIGURABLE COMMISSION SETTINGS (platform_settings, publicly
--    readable — prices are public anyway; only super admins may write).
-- ---------------------------------------------------------------------
insert into public.platform_settings (key, value, description)
values (
    'commission',
    '{
        "restaurant_commission_percentage": 15.00,
        "courier_commission_percentage": 0.00,
        "max_restaurant_commission_percentage": 50.00,
        "max_courier_commission_percentage": 50.00,
        "currency": "GHS"
    }'::jsonb,
    'Phase 1 marketplace commission rules — restaurant commission is charged per order on food subtotal; couriers pay 0% commission.'
)
on conflict (key) do nothing;

-- Phase 1: the courier receives the delivery earning (courier commission
-- 0%). Keep the legacy delivery_pricing key consistent with the new rule
-- so nothing stored in the database contradicts the model. The key is
-- deprecated — courier earnings are now derived from
-- commission.courier_commission_percentage.
do $$
begin
    update public.platform_settings
       set value = jsonb_set(value, '{courier_payout_percentage}', '100.00'::jsonb, true),
           updated_at = now()
     where key = 'delivery_pricing'
       and jsonb_typeof(value -> 'courier_payout_percentage') = 'number'
       and (value ->> 'courier_payout_percentage')::numeric <> 100.00;
exception
    when others then
        raise notice 'courier_payout_percentage sync skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 4. restaurants.commission_rate becomes an OPTIONAL per-restaurant
--    override. NULL = "use the platform-wide rate from settings".
--    Existing rows equal to the platform default (15%) become NULL so a
--    future platform-wide change reaches them; a genuinely customized
--    rate stays as an explicit override. Historical orders are NOT
--    touched here — they are versioned in section 9.
-- ---------------------------------------------------------------------
alter table public.restaurants alter column commission_rate drop default;
alter table public.restaurants alter column commission_rate drop not null;
update public.restaurants
   set commission_rate = null
 where commission_rate = 15.00;

-- ---------------------------------------------------------------------
-- 5. SERVER-SIDE MONEY HELPERS (all numeric arithmetic — never float).
-- ---------------------------------------------------------------------

-- Reads the commission settings with safe Phase 1 defaults.
create or replace function public.get_commission_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select value from public.platform_settings where key = 'commission'),
        '{
            "restaurant_commission_percentage": 15.00,
            "courier_commission_percentage": 0.00,
            "max_restaurant_commission_percentage": 50.00,
            "max_courier_commission_percentage": 50.00
        }'::jsonb
    );
$$;

-- Effective commission rate for an order: explicit per-restaurant
-- override first, then the platform-wide setting, then the 15% default.
create or replace function public.get_restaurant_commission_rate(p_restaurant_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select r.commission_rate from public.restaurants r where r.id = p_restaurant_id),
        nullif(public.get_commission_settings() ->> 'restaurant_commission_percentage', '')::numeric,
        15.00
    );
$$;

-- Server-authoritative delivery fee. Mirrors src/lib/pricing.ts exactly
-- (haversine rounded to 2dp, then base + km*rate, surge, clamp), reading
-- the live platform_settings instead of browser defaults.
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
    v_settings jsonb;
    v_base numeric := 12.00;
    v_per_km numeric := 2.50;
    v_min numeric := 10.00;
    v_max numeric := 60.00;
    v_surge numeric := 1.0;
    v_dist numeric;
    v_fee numeric;
begin
    v_settings := coalesce(
        (select value from public.platform_settings where key = 'delivery_pricing'),
        '{}'::jsonb
    );
    begin
        v_base  := coalesce((v_settings ->> 'base_fee')::numeric, 12.00);
        v_per_km := coalesce((v_settings ->> 'per_km_rate')::numeric, 2.50);
        v_min   := coalesce((v_settings ->> 'min_fee')::numeric, 10.00);
        v_max   := coalesce((v_settings ->> 'max_fee')::numeric, 60.00);
        v_surge := coalesce((v_settings ->> 'surge_multiplier')::numeric, 1.0);
    exception when invalid_text_representation then
        null; -- a corrupted setting falls back to the Phase 1 defaults above
    end;

    -- Haversine, rounded to 2dp exactly like calculateDistanceKm().
    v_dist := round(
        (2 * 6371 * asin(least(1.0, sqrt(
            power(sin(radians((p_del_lat - p_rest_lat) / 2)), 2) +
            cos(radians(p_rest_lat)) * cos(radians(p_del_lat)) *
            power(sin(radians((p_del_lng - p_rest_lng) / 2)), 2)
        ))))::numeric
    , 2);

    if v_dist <= 0 then
        return round(v_base, 2);
    end if;

    v_fee := (v_base + v_dist * v_per_km) * v_surge;
    v_fee := least(v_max, greatest(v_min, v_fee));
    return round(v_fee, 2);
end;
$$;

-- The single source of truth for an order's financial split.
create or replace function public.compute_order_financials(
    p_restaurant_id uuid,
    p_food_subtotal numeric,
    p_delivery_fee numeric
)
returns table (
    commission_rate numeric,
    commission_amount numeric,
    restaurant_gross_amount numeric,
    restaurant_net_amount numeric,
    courier_earning numeric,
    platform_revenue numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sub numeric := coalesce(p_food_subtotal, 0);
    v_fee numeric := coalesce(p_delivery_fee, 0);
    v_rate numeric;
    v_courier_comm numeric;
    v_courier_share numeric;
begin
    v_rate := public.get_restaurant_commission_rate(p_restaurant_id);
    if v_rate is null or v_rate < 0 or v_rate > 50 then
        raise exception 'Restaurant commission rate % is outside the permitted 0-50%% range', v_rate;
    end if;

    v_courier_comm := coalesce(
        (public.get_commission_settings() ->> 'courier_commission_percentage')::numeric, 0);
    if v_courier_comm is null or v_courier_comm < 0 or v_courier_comm > 50 then
        raise exception 'Courier commission rate % is outside the permitted 0-50%% range', v_courier_comm;
    end if;

    commission_rate            := round(v_rate, 2);
    commission_amount          := round(v_sub * v_rate / 100, 2);
    restaurant_gross_amount    := v_sub;
    restaurant_net_amount      := v_sub - round(v_sub * v_rate / 100, 2);

    -- Courier receives the delivery earning minus the courier commission
    -- (0% in Phase 1 => full delivery fee). The tip is tracked separately
    -- on orders.tip and always belongs to the courier.
    v_courier_share            := round(v_fee * (100 - v_courier_comm) / 100, 2);
    courier_earning            := v_courier_share;

    -- Platform revenue = restaurant commission + its share of the
    -- delivery fee (0 in Phase 1). Never the customer's money.
    platform_revenue           := commission_amount + (v_fee - v_courier_share);
    return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. ORDERS TRIGGER — every financial value is computed here, server
--    side, on INSERT and whenever the underlying amounts change. Client
--    submissions of commission/payout/total are always overwritten.
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

        -- 2. Delivery fee is re-derived from server-side pricing rules
        --    whenever the real coordinates are known; otherwise it is
        --    clamped into the configured [min, max] band so a client can
        --    never submit a zero or inflated fee.
        select r.latitude, r.longitude
          into v_rest_lat, v_rest_lng
          from public.restaurants r
         where r.id = new.restaurant_id;

        if v_rest_lat is not null and v_rest_lng is not null
           and new.delivery_latitude is not null and new.delivery_longitude is not null then
            new.delivery_fee := public.calculate_delivery_fee_server(
                v_rest_lat, v_rest_lng,
                new.delivery_latitude, new.delivery_longitude
            );
        else
            declare
                v_min numeric := 10.00;
                v_max numeric := 60.00;
                v_settings jsonb;
            begin
                v_settings := coalesce(
                    (select value from public.platform_settings where key = 'delivery_pricing'),
                    '{}'::jsonb);
                begin
                    v_min := coalesce((v_settings ->> 'min_fee')::numeric, 10.00);
                    v_max := coalesce((v_settings ->> 'max_fee')::numeric, 60.00);
                exception when invalid_text_representation then
                    null;
                end;
                new.delivery_fee := least(v_max, greatest(v_min, new.delivery_fee));
            end;
        end if;

        -- 3. Commission rate is SNAPSHOTTED here (commission versioning):
        --    later platform rate changes never rewrite this order.
        new.commission_rate := round(public.get_restaurant_commission_rate(new.restaurant_id), 2);
        new.currency := 'GHS';
        new.payment_status := coalesce(new.payment_status, 'PENDING');
        if new.payment_status not in
           ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED') then
            raise exception 'Invalid payment status %', new.payment_status;
        end if;
        new.settlement_status := 'PENDING';
        new.settlement_updated_at := now();

    elsif tg_op = 'UPDATE' then
        -- Financial and payment fields are server-managed. Refuse any
        -- write coming from an authenticated client (a browser, an RPC
        -- caller, a tampered payload). Internal bookkeeping — and direct
        -- DBA / service-role work, which PostgREST never issues — passes.
        -- `status` is deliberately NOT protected: the kitchen, courier and
        -- customer drive the order lifecycle through it.
        if not v_internal and auth.uid() is not null and (
            new.order_number is distinct from old.order_number or
            new.customer_id is distinct from old.customer_id or
            new.restaurant_id is distinct from old.restaurant_id or
            new.subtotal is distinct from old.subtotal or
            new.delivery_fee is distinct from old.delivery_fee or
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

    -- 4. (Re)compute every derived amount whenever the underlying money
    --    moved. The snapshotted rate is preserved on updates so a rate
    --    change can never rewrite history. (OLD is only valid in UPDATE
    --    triggers, so the branches are kept separate.)
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
-- 7. ORDER ITEMS — the item price comes from the menu (server truth),
--    the line subtotal is recomputed, and the parent order's food
--    subtotal + commission are re-derived from the actual lines.
-- ---------------------------------------------------------------------
create or replace function public.enforce_order_item_pricing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order_restaurant uuid;
    v_menu record;
begin
    select restaurant_id into v_order_restaurant
      from public.orders where id = new.order_id;
    if v_order_restaurant is null then
        raise exception 'Order % does not exist', new.order_id;
    end if;

    if new.quantity is null or new.quantity < 1 or new.quantity > 500 then
        raise exception 'Invalid item quantity';
    end if;

    if new.menu_item_id is not null then
        select id, restaurant_id, name, price
          into v_menu
          from public.menu_items
         where id = new.menu_item_id;
        if not found then
            raise exception 'Menu item % is no longer available', new.menu_item_id;
        end if;
        if v_menu.restaurant_id <> v_order_restaurant then
            raise exception 'Menu item % does not belong to the ordering restaurant', new.menu_item_id;
        end if;
        if v_menu.price is null or v_menu.price not between 0 and 99999999.99 then
            raise exception 'Menu item % has an invalid price', new.menu_item_id;
        end if;
        -- Server truth over whatever the client submitted.
        new.item_name := v_menu.name;
        new.item_price := v_menu.price;
    end if;

    if new.item_price is null or new.item_price not between 0 and 99999999.99 then
        raise exception 'Invalid item price';
    end if;

    new.subtotal := round(new.item_price * new.quantity, 2);
    return new;
end;
$$;

drop trigger if exists trg_order_items_pricing on public.order_items;
create trigger trg_order_items_pricing
    before insert or update on public.order_items
    for each row execute function public.enforce_order_item_pricing();

-- Recomputes the parent order's food subtotal from its lines. SECURITY
-- DEFINER + the internal-write flag lets it pass the orders update
-- guard; the orders trigger then re-derives commission, payouts and the
-- customer total from the corrected subtotal.
create or replace function public.recalc_single_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
    v_items_total numeric;
begin
    perform set_config('samleygo.internal_financial_write', '1', true);

    select count(*), coalesce(sum(subtotal), 0)
      into v_count, v_items_total
      from public.order_items
     where order_id = p_order_id;

    -- An order shell before its lines land keeps the submitted subtotal;
    -- once lines exist, the lines ARE the food subtotal.
    if v_count = 0 then
        return;
    end if;

    update public.orders
       set subtotal = v_items_total
     where id = p_order_id
       and subtotal is distinct from v_items_total;
end;
$$;

create or replace function public.recalc_order_after_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'UPDATE' then
        if new.order_id is distinct from old.order_id then
            perform public.recalc_single_order(old.order_id);
        end if;
        perform public.recalc_single_order(new.order_id);
    elsif tg_op = 'DELETE' then
        perform public.recalc_single_order(old.order_id);
    else
        perform public.recalc_single_order(new.order_id);
    end if;
    return null;
end;
$$;

drop trigger if exists trg_order_items_recalc_insert on public.order_items;
create trigger trg_order_items_recalc_insert
    after insert on public.order_items
    for each row execute function public.recalc_order_after_items();

drop trigger if exists trg_order_items_recalc_update on public.order_items;
create trigger trg_order_items_recalc_update
    after update on public.order_items
    for each row execute function public.recalc_order_after_items();

drop trigger if exists trg_order_items_recalc_delete on public.order_items;
create trigger trg_order_items_recalc_delete
    after delete on public.order_items
    for each row execute function public.recalc_order_after_items();

-- ---------------------------------------------------------------------
-- 8. PAYMENTS — validate and pin every row to the order's server-side
--    total so a client can never record a doctored amount.
-- ---------------------------------------------------------------------
create or replace function public.validate_payment_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
begin
    if tg_op = 'UPDATE' then
        if coalesce(current_setting('samleygo.internal_financial_write', true), '') <> '1'
           and auth.uid() is not null then
            raise exception 'Payment records are immutable from the client';
        end if;
        return new;
    end if;

    select * into v_order from public.orders where id = new.order_id;
    if not found then
        raise exception 'Order % does not exist', new.order_id;
    end if;
    if auth.uid() is not null and v_order.customer_id <> auth.uid() then
        raise exception 'You can only record payments for your own orders';
    end if;

    new.customer_id := v_order.customer_id;
    new.amount := v_order.total_amount;       -- server-side total, not the client's
    new.currency := coalesce(v_order.currency, 'GHS');
    new.payment_reference := coalesce(v_order.payment_reference, new.payment_reference);
    if new.status is null or new.status not in
       ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED') then
        raise exception 'Invalid payment status %', new.status;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_payments_validate_insert on public.payments;
create trigger trg_payments_validate_insert
    before insert on public.payments
    for each row execute function public.validate_payment_record();

drop trigger if exists trg_payments_validate_update on public.payments;
create trigger trg_payments_validate_update
    before update on public.payments
    for each row execute function public.validate_payment_record();

-- Payments RLS: the table had RLS enabled and NO policy, so every row
-- the app wrote was silently discarded. Participants may read; only the
-- owning customer may insert; nobody but the server may update.
drop policy if exists "Payments are visible to their order participants" on public.payments;
create policy "Payments are visible to their order participants" on public.payments
    for select using (
        customer_id = auth.uid() or exists (
            select 1 from public.orders o
             where o.id = payments.order_id
               and (
                   o.customer_id = auth.uid() or
                   o.courier_id = auth.uid() or
                   exists (
                       select 1 from public.restaurants r
                        where r.id = o.restaurant_id and r.owner_id = auth.uid()
                   ) or
                   exists (
                       select 1 from public.profiles p
                        where p.id = auth.uid() and p.role = 'SUPER_ADMIN'
                   )
               )
        )
    );

drop policy if exists "Customers can record payments for their own orders" on public.payments;
create policy "Customers can record payments for their own orders" on public.payments
    for insert with check (
        auth.uid() is not null
        and customer_id = auth.uid()
        and exists (
            select 1 from public.orders o
             where o.id = payments.order_id and o.customer_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------
-- 9. BACKFILL existing orders from data already in the database.
--    • commission rate = the rate actually in effect for that restaurant
--      (always the 15% default — nothing ever wrote this column);
--    • amounts are derived arithmetically from the stored subtotal and
--      delivery fee — nothing is invented;
--    • only DELIVERED/COMPLETED orders become ELIGIBLE; cancelled ones
--      are marked CANCELLED so no commission is ever recognized on them.
--    Re-running the migration skips finished rows (commission_amount
--    IS NOT NULL), so a later platform rate change cannot rewrite
--    historical orders.
-- ---------------------------------------------------------------------
update public.orders o
   set commission_rate = f.commission_rate,
       commission_amount = f.commission_amount,
       restaurant_gross_amount = f.restaurant_gross_amount,
       restaurant_net_amount = f.restaurant_net_amount,
       courier_earning = f.courier_earning,
       platform_revenue = f.platform_revenue,
       commission_calculated_at = now(),
       settlement_status = case
           when o.status in ('DELIVERED', 'COMPLETED')
                and o.payment_status in ('COMPLETED', 'PAID') then 'ELIGIBLE'
           when o.status in ('CANCELLED', 'REJECTED', 'FAILED') then 'CANCELLED'
           else 'PENDING'
       end,
       settlement_updated_at = now()
  from lateral public.compute_order_financials(o.restaurant_id, o.subtotal, o.delivery_fee) f
 where o.commission_amount is null;

-- ---------------------------------------------------------------------
-- 10. ADMIN RPCs (server-validated; callable only by a super admin).
-- ---------------------------------------------------------------------

-- Configure the marketplace commission rates. Validation happens here,
-- in the database — the browser's numbers are only a convenience.
create or replace function public.set_commission_settings(
    p_restaurant_commission_percentage numeric,
    p_courier_commission_percentage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_settings jsonb;
    v_max_rest numeric;
    v_max_cour numeric;
begin
    if auth.uid() is null or not exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can change commission settings';
    end if;

    v_settings := public.get_commission_settings();
    v_max_rest := coalesce((v_settings ->> 'max_restaurant_commission_percentage')::numeric, 50);
    v_max_cour := coalesce((v_settings ->> 'max_courier_commission_percentage')::numeric, 50);

    -- BETWEEN rejects NULL, NaN, Infinity and out-of-range values.
    if p_restaurant_commission_percentage is null
       or p_restaurant_commission_percentage not between 0 and v_max_rest then
        raise exception 'Restaurant commission must be a number between 0 and %', v_max_rest;
    end if;
    if p_courier_commission_percentage is null
       or p_courier_commission_percentage not between 0 and v_max_cour then
        raise exception 'Courier commission must be a number between 0 and %', v_max_cour;
    end if;

    v_settings := v_settings || jsonb_build_object(
        'restaurant_commission_percentage', round(p_restaurant_commission_percentage, 2),
        'courier_commission_percentage', round(p_courier_commission_percentage, 2),
        'updated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    insert into public.platform_settings (key, value, description)
    values ('commission', v_settings,
            'Phase 1 marketplace commission rules — restaurant commission is charged per order on food subtotal; couriers pay 0% commission.')
    on conflict (key) do update
        set value = excluded.value,
            description = excluded.description,
            updated_at = now();

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (
        auth.uid(),
        'COMMISSION_SETTINGS_UPDATED',
        'settings',
        'commission',
        jsonb_build_object(
            'restaurant_commission_percentage', round(p_restaurant_commission_percentage, 2),
            'courier_commission_percentage', round(p_courier_commission_percentage, 2)
        )
    );

    return v_settings;
end;
$$;

-- Record a (partial) refund against a paid order. Creates an adjustment
-- row instead of rewriting history: commission reverses proportionally
-- to the refunded FOOD amount, the restaurant payout reverses by the net
-- food amount, and the courier reverses its share of the refunded
-- delivery fee. Tip refunds are covered by refund_amount (tips are not
-- part of courier_earning or platform_revenue).
create or replace function public.record_order_refund(
    p_order_id uuid,
    p_refund_amount numeric,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
    v_prior_refunds numeric := 0;
    v_total_refunded numeric;
    v_food_refund numeric;
    v_delivery_refund numeric;
    v_tip_refund numeric;
    v_remaining numeric;
    v_commission_rev numeric;
    v_restaurant_adj numeric;
    v_courier_comm numeric;
    v_courier_adj numeric;
    v_platform_adj numeric;
    v_new_payment_status text;
    v_new_settlement_status text;
begin
    if auth.uid() is null or not exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can record refunds';
    end if;

    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'Order not found';
    end if;
    if v_order.payment_status not in ('COMPLETED', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') then
        raise exception 'Only a paid order can be refunded';
    end if;
    if p_refund_amount is null or p_refund_amount not between 0.01 and 99999999.99 then
        raise exception 'Refund amount must be a positive number';
    end if;

    select coalesce(sum(refund_amount), 0)
      into v_prior_refunds
      from public.order_settlement_adjustments
     where order_id = p_order_id;

    v_total_refunded := v_prior_refunds + p_refund_amount;
    if v_total_refunded > v_order.total_amount then
        raise exception 'Refund of % would exceed the paid total (% already refunded)',
            p_refund_amount, v_prior_refunds;
    end if;

    -- Split the refund: food first (commission reverses with it), then
    -- the delivery fee, then the tip.
    v_food_refund := least(p_refund_amount,
        coalesce(v_order.restaurant_gross_amount, v_order.subtotal, 0));
    v_remaining := p_refund_amount - v_food_refund;
    v_delivery_refund := least(v_remaining, v_order.delivery_fee);
    v_remaining := v_remaining - v_delivery_refund;
    v_tip_refund := least(v_remaining, v_order.tip);

    -- Signed adjustments (negative = reversal).
    v_commission_rev := -round(v_food_refund * coalesce(v_order.commission_rate, 0) / 100, 2);
    v_restaurant_adj := -(v_food_refund + v_commission_rev);

    v_courier_comm := coalesce(
        (public.get_commission_settings() ->> 'courier_commission_percentage')::numeric, 0);
    v_courier_adj := -round(v_delivery_refund * (100 - v_courier_comm) / 100, 2);
    v_platform_adj := v_commission_rev - round(v_delivery_refund * v_courier_comm / 100, 2);

    insert into public.order_settlement_adjustments (
        order_id, adjustment_type, refund_amount,
        food_amount_refunded, delivery_amount_refunded,
        commission_adjustment, restaurant_net_adjustment,
        courier_earning_adjustment, platform_revenue_adjustment,
        reason, created_by
    ) values (
        p_order_id,
        case when v_total_refunded >= v_order.total_amount
             then 'REFUND' else 'PARTIAL_REFUND' end,
        p_refund_amount, v_food_refund, v_delivery_refund,
        v_commission_rev, v_restaurant_adj, v_courier_adj, v_platform_adj,
        p_reason, auth.uid()
    );

    v_new_payment_status := case
        when v_total_refunded >= v_order.total_amount then 'REFUNDED'
        else 'PARTIALLY_REFUNDED'
    end;
    v_new_settlement_status := case
        when v_total_refunded >= v_order.total_amount then 'REVERSED'
        else coalesce(v_order.settlement_status, 'PENDING')
    end;

    perform set_config('samleygo.internal_financial_write', '1', true);

    update public.orders
       set payment_status = v_new_payment_status,
           settlement_status = v_new_settlement_status,
           settlement_updated_at = now()
     where id = p_order_id;

    update public.payments
       set status = v_new_payment_status
     where order_id = p_order_id;

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (
        auth.uid(),
        'ORDER_REFUNDED',
        'order',
        p_order_id::text,
        jsonb_build_object(
            'refund_amount', p_refund_amount,
            'food_amount_refunded', v_food_refund,
            'delivery_amount_refunded', v_delivery_refund,
            'commission_adjustment', v_commission_rev,
            'payment_status', v_new_payment_status,
            'settlement_status', v_new_settlement_status,
            'reason', coalesce(p_reason, '')
        )
    );

    return jsonb_build_object(
        'payment_status', v_new_payment_status,
        'settlement_status', v_new_settlement_status,
        'refund_amount', p_refund_amount,
        'commission_adjustment', v_commission_rev,
        'restaurant_net_adjustment', v_restaurant_adj,
        'courier_earning_adjustment', v_courier_adj,
        'platform_revenue_adjustment', v_platform_adj
    );
end;
$$;

-- Explicit settlement progression (payment success alone NEVER marks a
-- restaurant as paid out): ELIGIBLE -> PROCESSING -> PAID.
create or replace function public.set_order_settlement_status(
    p_order_id uuid,
    p_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
begin
    if auth.uid() is null or not exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ) then
        raise exception 'Only a super admin can advance a settlement';
    end if;

    if p_status not in ('PROCESSING', 'PAID') then
        raise exception 'Settlement can only be advanced to PROCESSING or PAID';
    end if;

    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'Order not found';
    end if;
    if v_order.status not in ('DELIVERED', 'COMPLETED') then
        raise exception 'Only a delivered order can be settled';
    end if;
    if p_status = 'PROCESSING' and v_order.settlement_status <> 'ELIGIBLE' then
        raise exception 'Settlement must be ELIGIBLE before it can move to PROCESSING';
    end if;
    if p_status = 'PAID' and v_order.settlement_status not in ('ELIGIBLE', 'PROCESSING') then
        raise exception 'Settlement must be ELIGIBLE or PROCESSING before it can be marked PAID';
    end if;

    perform set_config('samleygo.internal_financial_write', '1', true);

    update public.orders
       set settlement_status = p_status,
           settlement_updated_at = now()
     where id = p_order_id;

    insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'ORDER_SETTLEMENT_' || p_status, 'order', p_order_id::text,
            jsonb_build_object('settlement_status', p_status));

    return p_status;
end;
$$;

-- Only the super-admin console may execute these; internals stay out of
-- the API surface (triggers fire without an execute grant).
revoke execute on function public.set_commission_settings(numeric, numeric) from public, anon;
revoke execute on function public.record_order_refund(uuid, numeric, text) from public, anon;
revoke execute on function public.set_order_settlement_status(uuid, text) from public, anon;
grant execute on function public.set_commission_settings(numeric, numeric) to authenticated;
grant execute on function public.record_order_refund(uuid, numeric, text) to authenticated;
grant execute on function public.set_order_settlement_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Refresh PostgREST's schema cache so the new columns and RPCs are
--     immediately usable from the app.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
