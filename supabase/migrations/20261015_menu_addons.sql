-- ==============================================================================
-- SAMLEYGO — MENU ADD-ONS ("Add extras" / "Make it a combo")
-- Versioned migration for the food-ordering add-on feature.
-- Run AFTER 20261014_errands_booking_payment_method.sql.
--
-- What this adds
--   menu_addons          the extra product a restaurant sells (price, image,
--                        availability, per-add-on quantity cap, offering scope)
--   addon_groups         selection groups ("Choose a drink", "Add protein"),
--                        with required / min / max rules
--   addon_group_items    which extras belong to a group
--   menu_item_addons     meal -> extra association, used when the add-on is
--                        scoped to "only these meals"
--   order_item_extras    the snapshot written onto a placed order
--
-- Money rules carried over from 20261004_payment_commission_model.sql
--   * The client NEVER decides an add-on's price: the BEFORE trigger rewrites
--     name and unit price from menu_addons and recomputes the line subtotal.
--   * The parent order's food subtotal becomes (meal lines + add-on lines), so
--     commission, settlement and the customer total all follow automatically —
--     the commission stays an internal restaurant settlement figure and is
--     never a customer charge (see apply_order_financials()).
--   * order_item_extras has no UPDATE or DELETE policy: once an order is placed
--     its extras are immutable. A price change can never rewrite history.
--
-- Historical accuracy
--   menu_addon_id is NOT NULL ON DELETE RESTRICT: an extra that has ever been
--   ordered cannot be dropped, only archived (is_archived), so the snapshot on
--   the order keeps pointing at a real row. Add-ons that were never ordered can
--   still be deleted. Renames and price changes never touch past orders because
--   the order carries its own addon_name / unit_price snapshot.
--
-- Idempotent: safe to re-run. Nothing here drops or alters existing tables.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ADD-ONS
-- ------------------------------------------------------------------------------
create table if not exists public.menu_addons (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    -- Optional grouping, matching how dishes use restaurant_categories.
    category_id uuid references public.restaurant_categories(id) on delete set null,
    name text not null,
    description text,
    price numeric(10,2) not null,
    image_url text,
    is_available boolean not null default true,
    -- Archived extras stay on old orders but disappear from every menu.
    is_archived boolean not null default false,
    -- Hardest quantity a customer may put on one order line.
    max_quantity integer not null default 10,
    -- ALL  = offered on every dish of the restaurant (the default, so an
    --        add-on works the moment it is created)
    -- SELECT = offered only on the meals listed in menu_item_addons
    offering text not null default 'ALL',
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint menu_addons_name_check check (length(btrim(name)) > 0),
    constraint menu_addons_price_check check (price >= 0 and price <= 99999999.99),
    constraint menu_addons_max_quantity_check check (max_quantity between 1 and 100),
    constraint menu_addons_offering_check check (offering in ('ALL', 'SELECT')),
    constraint menu_addons_sort_order_check check (sort_order >= 0)
);

-- ------------------------------------------------------------------------------
-- 2. SELECTION GROUPS
-- ------------------------------------------------------------------------------
create table if not exists public.addon_groups (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    name text not null,
    description text,
    -- is_required forces at least one selection; min_select/max_select give the
    -- restaurant a finer rule. max_select = 0 means "no maximum".
    is_required boolean not null default false,
    min_select integer not null default 0,
    max_select integer not null default 0,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint addon_groups_name_check check (length(btrim(name)) > 0),
    constraint addon_groups_min_select_check check (min_select >= 0 and min_select <= 50),
    constraint addon_groups_max_select_check check (max_select >= 0 and max_select <= 50),
    constraint addon_groups_max_ge_min_check check (max_select = 0 or max_select >= min_select),
    constraint addon_groups_sort_order_check check (sort_order >= 0)
);

-- Which extras a group offers.
create table if not exists public.addon_group_items (
    id uuid primary key default gen_random_uuid(),
    addon_group_id uuid not null references public.addon_groups(id) on delete cascade,
    menu_addon_id uuid not null references public.menu_addons(id) on delete cascade,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    constraint uq_addon_group_item unique (addon_group_id, menu_addon_id)
);

-- ------------------------------------------------------------------------------
-- 3. MEAL <-> ADD-ON ASSOCIATION (only consulted when offering = 'SELECT')
-- ------------------------------------------------------------------------------
create table if not exists public.menu_item_addons (
    id uuid primary key default gen_random_uuid(),
    menu_item_id uuid not null references public.menu_items(id) on delete cascade,
    menu_addon_id uuid not null references public.menu_addons(id) on delete cascade,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    constraint uq_menu_item_addon unique (menu_item_id, menu_addon_id)
);

-- ------------------------------------------------------------------------------
-- 4. SELECTED ADD-ONS ON ORDER ITEMS — the price snapshot
-- ------------------------------------------------------------------------------
create table if not exists public.order_item_extras (
    id uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references public.order_items(id) on delete cascade,
    -- NOT NULL + RESTRICT: a line can only reference a real add-on, so a client
    -- can never invent a zero-priced extra, and an ordered extra can never be
    -- deleted out from under its receipt.
    menu_addon_id uuid not null references public.menu_addons(id) on delete restrict,
    addon_name text not null,
    unit_price numeric(10,2) not null,
    quantity integer not null,
    subtotal numeric(10,2) not null,
    constraint order_item_extras_name_check check (length(btrim(addon_name)) > 0),
    constraint order_item_extras_quantity_check check (quantity between 1 and 100),
    constraint order_item_extras_price_check check (unit_price >= 0 and unit_price <= 99999999.99),
    constraint order_item_extras_subtotal_check check (subtotal >= 0 and subtotal <= 99999999.99)
);

-- ------------------------------------------------------------------------------
-- 5. INDEXES (every join the menus and receipts perform)
-- ------------------------------------------------------------------------------
create index if not exists idx_menu_addons_restaurant
    on public.menu_addons(restaurant_id, is_archived, is_available);
create index if not exists idx_menu_addons_category on public.menu_addons(category_id);
create index if not exists idx_addon_groups_restaurant on public.addon_groups(restaurant_id);
create index if not exists idx_addon_group_items_group on public.addon_group_items(addon_group_id);
create index if not exists idx_addon_group_items_addon on public.addon_group_items(menu_addon_id);
create index if not exists idx_menu_item_addons_item on public.menu_item_addons(menu_item_id);
create index if not exists idx_menu_item_addons_addon on public.menu_item_addons(menu_addon_id);
create index if not exists idx_order_item_extras_item on public.order_item_extras(order_item_id);
create index if not exists idx_order_item_extras_addon on public.order_item_extras(menu_addon_id);

-- ------------------------------------------------------------------------------
-- 6. updated_at — the same helper the other tables use
-- ------------------------------------------------------------------------------
drop trigger if exists set_menu_addons_updated_at on public.menu_addons;
create trigger set_menu_addons_updated_at
    before update on public.menu_addons
    for each row execute function public.handle_updated_at();

drop trigger if exists set_addon_groups_updated_at on public.addon_groups;
create trigger set_addon_groups_updated_at
    before update on public.addon_groups
    for each row execute function public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 7. REALTIME — a customer watching a menu hears about price/stock changes
--    (guarded: re-running the migration must not fail on an existing entry)
-- ------------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'menu_addons'
    ) then
        alter publication supabase_realtime add table public.menu_addons;
    end if;
exception
    when others then
        null; -- publication already holds it, or realtime is not provisioned
end$$;

-- ------------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
--    Read: everybody (the same trust level menu_items already has).
--    Write: the owning restaurant's owner, or a super admin — enforced here,
--           in the database, never by the client.
-- ------------------------------------------------------------------------------
alter table public.menu_addons enable row level security;
alter table public.addon_groups enable row level security;
alter table public.addon_group_items enable row level security;
alter table public.menu_item_addons enable row level security;
alter table public.order_item_extras enable row level security;

-- MENU ADD-ONS
drop policy if exists "Anyone can view menu add-ons" on public.menu_addons;
create policy "Anyone can view menu add-ons" on public.menu_addons
    for select using (true);
drop policy if exists "Restaurant owners can manage menu add-ons" on public.menu_addons;
create policy "Restaurant owners can manage menu add-ons" on public.menu_addons
    for all using (exists (
        select 1 from public.restaurants where id = menu_addons.restaurant_id and owner_id = auth.uid()
    ) or exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));

-- ADD-ON GROUPS
drop policy if exists "Anyone can view add-on groups" on public.addon_groups;
create policy "Anyone can view add-on groups" on public.addon_groups
    for select using (true);
drop policy if exists "Restaurant owners can manage add-on groups" on public.addon_groups;
create policy "Restaurant owners can manage add-on groups" on public.addon_groups
    for all using (exists (
        select 1 from public.restaurants where id = addon_groups.restaurant_id and owner_id = auth.uid()
    ) or exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));

-- GROUP OPTIONS (ownership travels through the group)
drop policy if exists "Anyone can view add-on group options" on public.addon_group_items;
create policy "Anyone can view add-on group options" on public.addon_group_items
    for select using (true);
drop policy if exists "Restaurant owners can manage add-on group options" on public.addon_group_items;
create policy "Restaurant owners can manage add-on group options" on public.addon_group_items
    for all using (exists (
        select 1
          from public.addon_groups g
          join public.restaurants r on r.id = g.restaurant_id
         where g.id = addon_group_items.addon_group_id
           and (r.owner_id = auth.uid() or exists (
               select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
           ))
    ));

-- MEAL <-> ADD-ON (ownership travels through the meal)
drop policy if exists "Anyone can view meal add-on links" on public.menu_item_addons;
create policy "Anyone can view meal add-on links" on public.menu_item_addons
    for select using (true);
drop policy if exists "Restaurant owners can manage meal add-on links" on public.menu_item_addons;
create policy "Restaurant owners can manage meal add-on links" on public.menu_item_addons
    for all using (exists (
        select 1
          from public.menu_items m
          join public.restaurants r on r.id = m.restaurant_id
         where m.id = menu_item_addons.menu_item_id
           and (r.owner_id = auth.uid() or exists (
               select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
           ))
    ));

-- ORDER ITEM EXTRAS — read by the same parties that may read the order.
-- INSERT only: no UPDATE/DELETE policy exists, so a placed order's extras are
-- frozen at the price the customer actually paid.
drop policy if exists "Users can view extras for authorized orders" on public.order_item_extras;
create policy "Users can view extras for authorized orders" on public.order_item_extras
    for select using (exists (
        select 1
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
         where oi.id = order_item_extras.order_item_id
           and (
               o.customer_id = auth.uid() or
               o.courier_id = auth.uid() or
               exists (select 1 from public.restaurants where id = o.restaurant_id and owner_id = auth.uid()) or
               exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN')
           )
    ));
drop policy if exists "Customers can insert extras on their own order items" on public.order_item_extras;
create policy "Customers can insert extras on their own order items" on public.order_item_extras
    for insert with check (exists (
        select 1
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
         where oi.id = order_item_extras.order_item_id
           and o.customer_id = auth.uid()
    ));

-- ------------------------------------------------------------------------------
-- 9. SERVER-SIDE PRICING FOR A SELECTED ADD-ON
--    Mirrors public.enforce_order_item_pricing(): the client's numbers are
--    thrown away and the database's numbers are used instead.
-- ------------------------------------------------------------------------------
create or replace function public.enforce_order_item_extra_pricing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order_item record;
    v_order_restaurant uuid;
    v_addon record;
begin
    select order_id, quantity as parent_quantity
      into v_order_item
      from public.order_items
     where id = new.order_item_id;
    if not found then
        raise exception 'Order item % does not exist', new.order_item_id;
    end if;

    select restaurant_id into v_order_restaurant
      from public.orders where id = v_order_item.order_id;
    if v_order_restaurant is null then
        raise exception 'Order % does not exist', v_order_item.order_id;
    end if;

    if new.quantity is null or new.quantity < 1 or new.quantity > 100 then
        raise exception 'Invalid add-on quantity';
    end if;

    -- A null reference would let a client post any price it liked, so it is
    -- refused here as well as by the NOT NULL constraint.
    if new.menu_addon_id is null then
        raise exception 'An add-on line must reference a real menu add-on';
    end if;

    select id, restaurant_id, name, price, is_available, is_archived, max_quantity
      into v_addon
      from public.menu_addons
     where id = new.menu_addon_id;
    if not found then
        raise exception 'That add-on is no longer offered by this restaurant';
    end if;
    if v_addon.restaurant_id <> v_order_restaurant then
        raise exception 'Add-on % does not belong to the ordering restaurant', v_addon.name;
    end if;
    if v_addon.is_archived then
        raise exception '% is no longer offered. Remove it to continue.', v_addon.name;
    end if;
    if not v_addon.is_available then
        raise exception '% is currently unavailable. Remove it to continue.', v_addon.name;
    end if;
    if v_addon.price is null or v_addon.price not between 0 and 99999999.99 then
        raise exception 'Add-on % has an invalid price', v_addon.name;
    end if;
    if new.quantity > v_addon.max_quantity then
        raise exception 'Only % of % can be ordered per line', v_addon.max_quantity, v_addon.name;
    end if;

    -- Server truth over whatever the client submitted.
    new.addon_name := v_addon.name;
    new.unit_price := v_addon.price;
    new.subtotal := round(new.unit_price * new.quantity, 2);
    return new;
end;
$$;

drop trigger if exists trg_order_item_extras_pricing on public.order_item_extras;
create trigger trg_order_item_extras_pricing
    before insert or update on public.order_item_extras
    for each row execute function public.enforce_order_item_extra_pricing();

-- ------------------------------------------------------------------------------
-- 10. THE PARENT ORDER'S FOOD SUBTOTAL NOW INCLUDES ITS ADD-ONS
--     Replaces the meals-only version from 20261004. Same contract: SECURITY
--     DEFINER, the internal-write flag, and "the lines are the subtotal".
-- ------------------------------------------------------------------------------
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

    select count(*),
           coalesce(sum(oi.subtotal), 0)
             + coalesce(
                 (select sum(e.subtotal)
                    from public.order_item_extras e
                    join public.order_items x on x.id = e.order_item_id
                   where x.order_id = p_order_id),
                 0
               )
      into v_count, v_items_total
      from public.order_items oi
     where oi.order_id = p_order_id;

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

-- Recomputes the order whenever an add-on line lands, moves or goes.
create or replace function public.recalc_order_after_item_extra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order_id uuid;
begin
    if tg_op = 'DELETE' then
        select order_id into v_order_id from public.order_items where id = old.order_item_id;
    else
        select order_id into v_order_id from public.order_items where id = new.order_item_id;
    end if;

    if v_order_id is not null then
        perform public.recalc_single_order(v_order_id);
    end if;
    return null;
end;
$$;

drop trigger if exists trg_order_item_extras_recalc_insert on public.order_item_extras;
create trigger trg_order_item_extras_recalc_insert
    after insert on public.order_item_extras
    for each row execute function public.recalc_order_after_item_extra();

drop trigger if exists trg_order_item_extras_recalc_update on public.order_item_extras;
create trigger trg_order_item_extras_recalc_update
    after update on public.order_item_extras
    for each row execute function public.recalc_order_after_item_extra();

drop trigger if exists trg_order_item_extras_recalc_delete on public.order_item_extras;
create trigger trg_order_item_extras_recalc_delete
    after delete on public.order_item_extras
    for each row execute function public.recalc_order_after_item_extra();
