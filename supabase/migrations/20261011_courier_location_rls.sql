-- =====================================================================
-- SamleyGo — courier location RLS hardening
--
-- Problem
-- -------
-- `public.couriers` shipped with a blanket SELECT policy:
--
--     create policy "Approved couriers are visible to customers and
--       restaurants on orders" on public.couriers for select using (true);
--
-- despite its name it let ANY anon or authenticated role read EVERY courier
-- row, including `current_latitude` / `current_longitude` — the live GPS of
-- every rider on the platform — plus verification notes and last-seen times.
-- The column grants for `anon` even handed out the two coordinate columns.
--
-- What this migration does (no destructive change, no data is touched)
-- --------------------------------------------------------------------
--  1. Replaces the blanket policy with a participant-only policy:
--       · the courier themselves
--       · a SUPER_ADMIN
--       · anyone on an order that courier is assigned to
--         (customer, restaurant owner — checked through the SECURITY
--         DEFINER helper below so the `orders` ⇄ `couriers` policies can
--         never recurse into each other)
--  2. Adds `public.courier_order_participant(...)` — SECURITY DEFINER, so
--     evaluating it from the `couriers` policy does not re-enter the
--     `orders` policy (Postgres would raise "infinite recursion detected").
--  3. Adds `public.courier_driver_directory(...)` — SECURITY DEFINER, the
--     one supported way for a RESTAURANT_OWNER to list riders for the
--     "Assign driver" modal / "food ready" broadcast WITHOUT gaining
--     location or identity-document access. It returns directory data only
--     (no coordinates, no verification fields) and refuses callers who are
--     not a restaurant owner or super admin.
--  4. Revokes the coordinate columns from `anon`.
--
-- Realtime
-- --------
-- Supabase Realtime's `postgres_changes` applies the same RLS policies to
-- the rows it forwards, so narrowing SELECT narrows the courier-position
-- broadcast at the same time: a subscriber now only receives position
-- updates for riders on their own orders. No client-side filter is relied
-- upon, and the service-role key is never shipped to the browser.
--
-- Run this in the Supabase SQL editor (or `psql -f`).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Helper: is the caller on an order this courier is assigned to?
--    SECURITY DEFINER (owner = postgres, the table owner) so that the
--    subquery on `public.orders` is evaluated WITHOUT `orders`' own RLS —
--    that policy itself queries `public.couriers`, and letting the two
--    policies call each other would be infinite recursion.
--    Returns false for an anonymous caller (auth.uid() is null).
-- ---------------------------------------------------------------------
create or replace function public.courier_order_participant(p_courier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.orders o
        where o.courier_id = p_courier_id
          and (
              o.customer_id = auth.uid()
              or exists (
                  select 1
                  from public.restaurants r
                  where r.id = o.restaurant_id
                    and r.owner_id = auth.uid()
              )
          )
    );
$$;

comment on function public.courier_order_participant(uuid) is
    'True when auth.uid() is the customer or the owning restaurant of an order assigned to p_courier_id. SECURITY DEFINER so the orders/couriers policies cannot recurse.';

revoke execute on function public.courier_order_participant(uuid) from public;
-- `anon` keeps EXECUTE: it is called by the couriers SELECT policy, and a
-- missing privilege would turn "no rows" into a hard permission error for
-- anonymous callers. It can only ever return false for them (auth.uid() null).
grant execute on function public.courier_order_participant(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Replace the blanket SELECT policy.
-- ---------------------------------------------------------------------
drop policy if exists "Approved couriers are visible to customers and restaurants on orders" on public.couriers;

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
    );

-- ---------------------------------------------------------------------
-- 3. Directory listing for the restaurant's "Assign driver" modal and the
--    "food ready" broadcast. Deliberately returns NO location columns and
--    NO verification columns: a restaurant may see who can ride for them,
--    never where any rider currently is.
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
    left join public.profiles p on p.id = c.id
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
    order by c.is_online desc, c.rating desc, c.total_deliveries desc
    limit greatest(least(coalesce(p_limit, 50), 200), 1);
$$;

comment on function public.courier_driver_directory(boolean, boolean, integer) is
    'Directory of riders for a restaurant dispatch screen. No coordinates, no verification data. Callers who are not a RESTAURANT_OWNER/SUPER_ADMIN get zero rows. SECURITY DEFINER so it is not blocked by the participant-only couriers policy.';

revoke execute on function public.courier_driver_directory(boolean, boolean, integer) from public, anon;
grant execute on function public.courier_driver_directory(boolean, boolean, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Anonymous callers keep the harmless directory columns they had, but
--    never the live position.
-- ---------------------------------------------------------------------
revoke select on table public.couriers from anon;
grant select (
    id, vehicle_type, vehicle_plate, is_approved, is_online, availability_status,
    total_deliveries, rating, verification_status, created_at, updated_at
) on table public.couriers to anon;

commit;

-- =====================================================================
-- Self-check (safe on production: everything rolls back)
-- =====================================================================
begin;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'couriers'
          and policyname = 'Courier rows are visible to themselves, admins and order participants'
    ) then
        raise exception 'FAIL — the participant-only couriers SELECT policy is missing';
    end if;

    if exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'couriers'
          and cmd = 'SELECT'
          and qual = 'true'
    ) then
        raise exception 'FAIL — a blanket using (true) SELECT policy still exists on public.couriers';
    end if;

    if exists (
        select 1 from information_schema.column_privileges
        where grantee = 'anon'
          and table_schema = 'public'
          and table_name = 'couriers'
          and column_name in ('current_latitude', 'current_longitude')
          and privilege_type = 'SELECT'
    ) then
        raise exception 'FAIL — anon can still read courier coordinates';
    end if;

    if to_regprocedure('public.courier_order_participant(uuid)') is null then
        raise exception 'FAIL — courier_order_participant() was not created';
    end if;

    if to_regprocedure('public.courier_driver_directory(boolean,boolean,integer)') is null then
        raise exception 'FAIL — courier_driver_directory() was not created';
    end if;

    -- The directory function must be SECURITY DEFINER, otherwise it would be
    -- blocked by the very policy this migration tightens.
    if not exists (
        select 1 from pg_proc
        where proname = 'courier_driver_directory'
          and prosecdef
    ) then
        raise exception 'FAIL — courier_driver_directory() is not SECURITY DEFINER';
    end if;

    raise notice 'PASS — courier location RLS: participant-only SELECT, directory function in place, anon has no coordinates';
end $$;

rollback;
