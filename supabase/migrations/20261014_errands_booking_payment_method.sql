-- ---------------------------------------------------------------------------
-- Errands & On-Demand Rides — record how the customer will settle a trip.
-- ---------------------------------------------------------------------------
-- The ride-selection screen offers the SAME payment methods the food checkout
-- already records (cash, MTN MoMo, Telecel Cash, AT Money, card). Until now an
-- errand booking carried none of that, so nobody downstream could tell whether
-- the driver should collect cash.
--
-- This adds the column and a THIN booking overload that sets it in the same
-- transaction as the booking itself. The booking body is not duplicated: the
-- new function calls the existing `create_errands_booking(uuid, uuid)` and then
-- writes the tender, scoped to the caller's own row. The 2-argument function is
-- left untouched, so a client that has not been updated (or a project where
-- only part of this ships) keeps working and cash stays the honest default.
-- ---------------------------------------------------------------------------

begin;

alter table public.errands_bookings
    add column if not exists payment_method text not null default 'CASH';

alter table public.errands_bookings
    drop constraint if exists errands_bookings_payment_method_check;

alter table public.errands_bookings
    add constraint errands_bookings_payment_method_check
    check (payment_method in ('CASH', 'MTN_MOMO', 'TELECEL_CASH', 'AT_MONEY', 'CARD'));

-- ---------------------------------------------------------------------
-- Booking + tender, atomically. Same owner-only row write as the booking
-- function itself: `errands_booking_payload` then returns the column as part
-- of `to_jsonb(v_row)`, so the customer's trip card, the driver's job and the
-- admin table all see it with no extra RPC.
-- ---------------------------------------------------------------------
create or replace function public.create_errands_booking(
    p_quote_id uuid,
    p_driver_id uuid,
    p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := auth.uid();
    v_result  jsonb;
    v_method  text;
begin
    if v_uid is null then
        raise exception 'Sign in to book an Errand.';
    end if;

    if p_quote_id is null or p_driver_id is null then
        raise exception 'Select a driver to continue.';
    end if;

    -- Anything blank, unknown or tampered with falls back to cash — the only
    -- tender that needs no third party — rather than being echoed back.
    v_method := coalesce(nullif(trim(p_payment_method), ''), 'CASH');

    if v_method not in ('CASH', 'MTN_MOMO', 'TELECEL_CASH', 'AT_MONEY', 'CARD') then
        raise exception 'That payment method is not supported.';
    end if;

    -- Quote validation, single-use consumption, driver reservation, details,
    -- PIN and notifications all happen inside the original function, under its
    -- own row lock — this overload adds nothing to that logic.
    v_result := public.create_errands_booking(p_quote_id, p_driver_id);

    update public.errands_bookings
       set payment_method = v_method
     where id = (v_result->>'booking_id')::uuid
       and customer_id = v_uid;

    return v_result;
end;
$$;

-- Same audience as the booking function it wraps.
revoke execute on function public.create_errands_booking(uuid, uuid, text) from public, anon;

grant execute on function public.create_errands_booking(uuid, uuid, text) to authenticated, service_role;

commit;
