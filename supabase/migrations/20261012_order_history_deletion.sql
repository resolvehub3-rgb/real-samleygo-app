-- =====================================================================
-- SamleyGo — customer-managed order history (soft delete)
--
-- The customer can remove a FINISHED food order or a finished Errands
-- trip from THEIR OWN list on the Orders screen. What disappears is that
-- one row's visibility to that one customer: the order, its money, its
-- status history, receipts, settlement and audit records stay exactly
-- where they are for the restaurant, the courier, the driver, support
-- and the Super Admin.
--
-- Why soft, never a hard delete:
--   * a paid order is a financial record (receipt, commission,
--     settlement, refund trail) — erasing it would break the books;
--   * the Errands money tables are deliberately write-locked: this
--     migration adds NO write policy of any kind. The two SECURITY
--     DEFINER RPCs below are the only writers, exactly like the
--     booking lifecycle RPCs in 20261012_errands_module.sql.
--
-- Server-side guard rails (the client only mirrors them in UI):
--   * only the owner (customer_id = auth.uid()) may remove their row;
--   * only TERMINAL rows — food: DELIVERED / COMPLETED / CANCELLED /
--     REJECTED / FAILED; Errands: COMPLETED / CANCELLED / EXPIRED /
--     FAILED — an in-flight trip can never vanish from under a courier
--     or driver;
--   * a second attempt refuses honestly instead of pretending twice;
--   * anon gets no execute; afterwards RLS hides the row from the
--     customer while every other participant keeps seeing it.
--
-- Run manually in the Supabase SQL editor AFTER
-- 20261012_errands_module.sql (same day; this file sorts later: e < o).
-- =====================================================================

-- 1. Columns ---------------------------------------------------------------
alter table public.orders add column if not exists customer_deleted_at timestamptz;
alter table public.errands_bookings add column if not exists customer_deleted_at timestamptz;

comment on column public.orders.customer_deleted_at is
    'Set through delete_customer_order(): the order vanishes from the customer''s own list only. Never a hard delete - receipts, settlement and audit stay intact.';
comment on column public.errands_bookings.customer_deleted_at is
    'Set through delete_customer_errands_booking(): hidden from the customer''s history only; the driver, support and the Super Admin keep the record.';

-- 2. Visibility ------------------------------------------------------------
-- Orders: only the CUSTOMER branch gains the filter. Courier, restaurant
-- owner, dispatch and Super Admin keep seeing the row unchanged.
drop policy if exists "Users can view their related orders" on public.orders;
create policy "Users can view their related orders" on public.orders
    for select using (
        (auth.uid() = customer_id and customer_deleted_at is null) or
        auth.uid() = courier_id or
        exists (select 1 from public.restaurants where id = orders.restaurant_id and owner_id = auth.uid()) or
        exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN') or
        (status in ('READY_FOR_PICKUP', 'RESTAURANT_ACCEPTED') and exists (
            select 1 from public.couriers where id = auth.uid() and is_approved = true and is_online = true
        ))
    );

-- Errands: same contract. The driver's branch is untouched — their trip
-- summary (and pay history) never disappears because the customer tidied
-- their list.
drop policy if exists "Errands bookings are visible to their participants" on public.errands_bookings;
create policy "Errands bookings are visible to their participants"
    on public.errands_bookings
    for select using (
        (customer_id = auth.uid() and customer_deleted_at is null)
        or driver_id = auth.uid()
        or exists (
            select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );

-- 3. RPCs ------------------------------------------------------------------
-- Hide a finished food order from this customer's own list. SECURITY DEFINER
-- so no write policy is needed: it touches exactly one column, only for the
-- caller's own row, only while the order is terminal. The money triggers on
-- `orders` see no financial column move, so nothing is re-priced.
create or replace function public.delete_customer_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Sign in to remove an order from your list.';
    end if;

    update public.orders
       set customer_deleted_at = now()
     where id = p_order_id
       and customer_id = auth.uid()
       and customer_deleted_at is null
       and status in ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED');

    if not found then
        raise exception 'Only finished or cancelled orders can be removed from your list.';
    end if;
end;
$$;

-- Same contract for an Errands / ride trip.
create or replace function public.delete_customer_errands_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Sign in to remove a trip from your list.';
    end if;

    update public.errands_bookings
       set customer_deleted_at = now()
     where id = p_booking_id
       and customer_id = auth.uid()
       and customer_deleted_at is null
       and status in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

    if not found then
        raise exception 'Only completed, cancelled or expired trips can be removed from your list.';
    end if;
end;
$$;

-- 4. Grants -----------------------------------------------------------------
revoke execute on function public.delete_customer_order(uuid) from public, anon;
revoke execute on function public.delete_customer_errands_booking(uuid) from public, anon;

grant execute on function public.delete_customer_order(uuid) to authenticated, service_role;
grant execute on function public.delete_customer_errands_booking(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
