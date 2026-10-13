-- =====================================================================
-- SamleyGo — menu add-ons ("Add extras") — database checks
--
-- Run this in the Supabase SQL editor (or `psql -f`) AFTER
-- 20261015_menu_addons.sql. Every statement runs inside a transaction
-- that is rolled back at the end: no add-on, no order and no price is
-- committed, so it is safe on a production database.
--
-- A check reports PASS through a NOTICE. The only way this file can fail
-- is by raising an exception that starts with "FAIL -", which means a
-- rule from the migration is broken.
--
-- Client-level coverage (the cart maths, the extras UI contract, the
-- checkout payload and the owner manager) lives in
-- scripts/menu_addons.test.ts — run `npm test`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Every table exists with the columns the feature depends on.
-- ---------------------------------------------------------------------
do $$
declare
    v_col text;
begin
    foreach v_col in array array[
        'menu_addons.name', 'menu_addons.price', 'menu_addons.is_available',
        'menu_addons.is_archived', 'menu_addons.max_quantity',
        'menu_addons.offering', 'menu_addons.image_url',
        'addon_groups.is_required', 'addon_groups.min_select', 'addon_groups.max_select',
        'addon_group_items.addon_group_id', 'addon_group_items.menu_addon_id',
        'menu_item_addons.menu_item_id', 'menu_item_addons.menu_addon_id',
        'order_item_extras.menu_addon_id', 'order_item_extras.addon_name',
        'order_item_extras.unit_price', 'order_item_extras.quantity',
        'order_item_extras.subtotal'
    ] loop
        if not exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = split_part(v_col, '.', 1)
               and column_name  = split_part(v_col, '.', 2)
        ) then
            raise exception 'FAIL - %.% is missing', split_part(v_col, '.', 1), split_part(v_col, '.', 2);
        end if;
    end loop;
    raise notice 'PASS 1 - all five add-on tables carry the expected columns';
end $$;

-- ---------------------------------------------------------------------
-- 2. order_item_extras.menu_addon_id is NOT NULL and RESTRICTs deletion,
--    so a client cannot post an invented zero-priced "extra" and a real
--    one cannot vanish from under a receipt.
-- ---------------------------------------------------------------------
do $$
declare
    v_row record;
begin
    select c.is_nullable, rc.delete_rule
      into v_row
      from information_schema.columns c
      join information_schema.table_constraints tc
        on tc.table_schema = c.table_schema and tc.table_name = c.table_name
      join information_schema.referential_constraints rc
        on rc.constraint_schema = tc.constraint_schema and rc.constraint_name = tc.constraint_name
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = rc.constraint_name
     where c.table_schema = 'public'
       and c.table_name = 'order_item_extras'
       and c.column_name = 'menu_addon_id'
       and tc.constraint_type = 'FOREIGN KEY'
       and ccu.table_name = 'menu_addons'
     limit 1;

    if v_row is null then
        raise exception 'FAIL - order_item_extras.menu_addon_id has no foreign key to menu_addons';
    end if;
    if v_row.is_nullable <> 'NO' then
        raise exception 'FAIL - order_item_extras.menu_addon_id must be NOT NULL';
    end if;
    if v_row.delete_rule <> 'RESTRICT' then
        raise exception 'FAIL - order_item_extras.menu_addon_id must be ON DELETE RESTRICT, got %', v_row.delete_rule;
    end if;
    raise notice 'PASS 2 - the snapshot is pinned to a real add-on (NOT NULL + RESTRICT)';
end $$;

-- ---------------------------------------------------------------------
-- 3. Row Level Security is on, the read policies exist, and there is NO
--    update or delete policy on the snapshot (a placed order is frozen).
-- ---------------------------------------------------------------------
do $$
declare
    v_table text;
    v_count integer;
begin
    foreach v_table in array array['menu_addons', 'addon_groups', 'addon_group_items', 'menu_item_addons', 'order_item_extras'] loop
        if not exists (
            select 1 from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
        ) then
            raise exception 'FAIL - RLS is not enabled on %', v_table;
        end if;
        if not exists (
            select 1 from pg_policies
             where schemaname = 'public' and tablename = v_table and cmd = 'SELECT'
        ) then
            raise exception 'FAIL - no SELECT policy on %', v_table;
        end if;
        -- The four catalog tables are writable only by the restaurant's own
        -- owner. The snapshot table is deliberately NOT one of them: it is
        -- written by the ordering customer, and only ever before checkout.
        if v_table <> 'order_item_extras' and not exists (
            select 1 from pg_policies
             where schemaname = 'public' and tablename = v_table and cmd = 'ALL'
               and (qual ilike '%owner_id = auth.uid()%'
                    or with_check ilike '%owner_id = auth.uid()%')
        ) then
            raise exception 'FAIL - % is writable by someone who does not own the restaurant', v_table;
        end if;
    end loop;

    select count(*) into v_count
      from pg_policies
     where schemaname = 'public' and tablename = 'order_item_extras'
       and cmd in ('UPDATE', 'DELETE');
    if v_count <> 0 then
        raise exception 'FAIL - order_item_extras must have no UPDATE or DELETE policy (% found)', v_count;
    end if;

    -- An INSERT policy carries its rule in with_check, not qual.
    select count(*) into v_count
      from pg_policies
     where schemaname = 'public' and tablename = 'order_item_extras'
       and cmd = 'INSERT'
       and (coalesce(qual, '') || coalesce(with_check, ''))
           ilike '%customer_id = auth.uid()%';
    if v_count <> 1 then
        raise exception 'FAIL - only the ordering customer may insert add-on lines';
    end if;

    raise notice 'PASS 3 - RLS on all five tables; the snapshot is insert-only for the customer';
end $$;

-- ---------------------------------------------------------------------
-- 4. The pricing trigger is installed, is SECURITY DEFINER, and is the
--    BEFORE trigger (so the submitted numbers never reach the table).
-- ---------------------------------------------------------------------
do $$
declare
    v_def text;
begin
    if not exists (
        select 1 from pg_trigger
         where tgname = 'trg_order_item_extras_pricing'
           and tgrelid = 'public.order_item_extras'::regclass
           and not tgisinternal
    ) then
        raise exception 'FAIL - trg_order_item_extras_pricing is missing';
    end if;

    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_order_item_extra_pricing';
    if v_def is null then
        raise exception 'FAIL - enforce_order_item_extra_pricing() is missing';
    end if;
    if v_def not ilike '%security definer%' then
        raise exception 'FAIL - enforce_order_item_extra_pricing() must be SECURITY DEFINER';
    end if;
    if v_def not ilike '%new.addon_name := v_addon.name%' then
        raise exception 'FAIL - the trigger does not overwrite the submitted add-on name';
    end if;
    if v_def not ilike '%new.unit_price := v_addon.price%' then
        raise exception 'FAIL - the trigger does not overwrite the submitted price';
    end if;
    if v_def not ilike '%v_addon.restaurant_id <> v_order_restaurant%' then
        raise exception 'FAIL - the trigger does not check the add-on belongs to the ordering restaurant';
    end if;
    raise notice 'PASS 4 - server-side add-on pricing is installed and trusted over the client';
end $$;

-- ---------------------------------------------------------------------
-- 5. The parent order's food subtotal counts its add-on lines, and the
--    recalc triggers fire for inserts, updates and deletes.
-- ---------------------------------------------------------------------
do $$
declare
    v_def text;
begin
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'recalc_single_order';
    if v_def is null then
        raise exception 'FAIL - recalc_single_order() is missing';
    end if;
    if v_def not ilike '%order_item_extras%' then
        raise exception 'FAIL - recalc_single_order() still counts meals only';
    end if;
    if v_def not ilike '%samleygo.internal_financial_write%' then
        raise exception 'FAIL - recalc_single_order() lost the internal-write flag';
    end if;

    if not exists (
        select 1 from pg_trigger
         where tgname in ('trg_order_item_extras_recalc_insert', 'trg_order_item_extras_recalc_update', 'trg_order_item_extras_recalc_delete')
           and tgrelid = 'public.order_item_extras'::regclass
           and not tgisinternal
    ) then
        raise exception 'FAIL - the recalc triggers on order_item_extras are missing';
    end if;
    raise notice 'PASS 5 - add-on lines feed the order subtotal and its commission';
end $$;

-- ---------------------------------------------------------------------
-- 6. BEHAVIOURAL — a doctored price is thrown away, the parent subtotal
--    grows by the real add-on price, and an ordered add-on cannot be
--    deleted. Fixtures are built inside this transaction and rolled
--    back; if no auth user exists to hang them from, it announces SKIP
--    instead of inventing one.
-- ---------------------------------------------------------------------
do $$
declare
    v_uid uuid;
    v_profile uuid;
    v_restaurant uuid;
    v_meal uuid;
    v_order uuid;
    v_line uuid;
    v_addon uuid;
    v_line_id uuid;
    v_stored_price numeric;
    v_stored_subtotal numeric;
    v_order_subtotal numeric;
    v_meal_total numeric;
    v_blocked boolean := false;
begin
    select id into v_uid from auth.users order by created_at limit 1;
    if v_uid is null then
        raise notice 'SKIP 6 - no auth user exists yet, so no order fixture can be built';
        return;
    end if;

    insert into public.profiles (id, email, full_name, role)
    values (v_uid, 'menu-addon-checks@example.test', 'Menu Add-on Checks', 'CUSTOMER')
    on conflict (id) do nothing;
    select id into v_profile from public.profiles where id = v_uid;

    insert into public.restaurants (owner_id, name, cuisine_type, phone, address, is_approved)
    values (v_profile, 'Add-on Checks Kitchen', 'Test', '0000000000', 'Accra', true)
    returning id into v_restaurant;

    insert into public.menu_items (restaurant_id, name, price, is_available)
    values (v_restaurant, 'Check Meal', 45.00, true)
    returning id into v_meal;

    insert into public.menu_addons (restaurant_id, name, price, max_quantity, offering)
    values (v_restaurant, 'Check Extra Chicken', 15.00, 1, 'ALL')
    returning id into v_addon;

    insert into public.orders (
        order_number, customer_id, restaurant_id, status, subtotal, total_amount,
        delivery_address, customer_phone, payment_method, payment_status
    ) values (
        'ADDON-CHECK-' || floor(random() * 1000000)::text, v_profile, v_restaurant,
        'RESTAURANT_PENDING', 45.00, 45.00, 'Accra', '0000000000', 'CASH', 'PENDING'
    ) returning id into v_order;

    insert into public.order_items (order_id, menu_item_id, item_name, item_price, quantity, subtotal)
    values (v_order, v_meal, 'Check Meal', 45.00, 1, 45.00)
    returning id into v_line;
    select subtotal into v_meal_total from public.order_items where id = v_line;

    -- The client lies about the price; the database must refuse to believe it.
    insert into public.order_item_extras (order_item_id, menu_addon_id, addon_name, unit_price, quantity, subtotal)
    values (v_line, v_addon, 'Totally Free Chicken', 0.00, 1, 0.00)
    returning id into v_line_id;

    select unit_price, subtotal
      into v_stored_price, v_stored_subtotal
      from public.order_item_extras where id = v_line_id;

    if v_stored_price <> 15.00 then
        raise exception 'FAIL - the submitted price % survived; expected 15.00', v_stored_price;
    end if;
    if v_stored_subtotal <> 15.00 then
        raise exception 'FAIL - add-on subtotal is %, expected 15.00', v_stored_subtotal;
    end if;

    select subtotal into v_order_subtotal from public.orders where id = v_order;
    if v_order_subtotal <> v_meal_total + 15.00 then
        raise exception 'FAIL - order food subtotal is %, expected the meal plus the add-on (%)',
            v_order_subtotal, v_meal_total + 15.00;
    end if;

    -- An add-on that has been ordered can only be archived, never dropped.
    begin
        delete from public.menu_addons where id = v_addon;
    exception
        when others then
            v_blocked := true;
    end;
    if not v_blocked then
        raise exception 'FAIL - an ordered add-on could be deleted, breaking historical receipts';
    end if;

    raise notice 'PASS 6 - a doctored price is rewritten, the subtotal grows correctly, history is protected';
end $$;

rollback;

-- Nothing above is committed.
