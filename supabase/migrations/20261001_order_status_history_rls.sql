-- =====================================================================
-- Order status history: make the timeline actually write and read.
-- Run this in the Supabase SQL editor (Supabase Dashboard -> SQL Editor).
-- Idempotent: safe to run multiple times.
--
-- Why this exists:
--   public.order_status_history had row level security ENABLED but NO
--   policies at all (see 20260925_samleygo_schema.sql:287). Every
--   insert the app issues — the customer's "order placed" row, the
--   kitchen's accept/ready rows, the courier's picked-up/arrived/
--   delivered rows — was rejected by Postgres, and every select came
--   back empty, so the order screen's status timeline stayed blank
--   even though the status itself changed. supabase-js resolves with
--   { error } instead of throwing, so the failure was silent.
--
-- Same failure class as public.reviews (fixed in 20260930_reviews_ratings.sql).
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
                   ('public.order_status_history')) v(t)
     where to_regclass(v.t) is null;

    if missing is not null then
        raise exception E'SamleyGo schema not found - missing %.\nThis query is running in a DIFFERENT database than the app uses.\nOpen https://supabase.com/dashboard/project/xvflryuspotcmgvedxcj/sql/new\n(the project in VITE_SUPABASE_URL) - or leave any preview branch - and run it there.', missing;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Read: whoever can see the order can see its status timeline
--     (customer, assigned courier, the restaurant's owner, super admin)
-- ---------------------------------------------------------------------
drop policy if exists "Order participants can view status history" on public.order_status_history;
create policy "Order participants can view status history" on public.order_status_history
    for select using (exists (
        select 1 from public.orders where id = order_status_history.order_id and (
            customer_id = auth.uid() or
            courier_id = auth.uid() or
            exists (
                select 1 from public.restaurants
                 where id = orders.restaurant_id and owner_id = auth.uid()
            ) or
            exists (
                select 1 from public.profiles
                 where id = auth.uid() and role = 'SUPER_ADMIN'
            )
        )
    ));

-- ---------------------------------------------------------------------
-- 2. Write: whoever is allowed to move the order may record their own row.
--     changed_by must be the caller so nobody can attribute an entry to
--     somebody else. Every app writer already passes changed_by = auth.uid().
-- ---------------------------------------------------------------------
drop policy if exists "Participants can record status changes" on public.order_status_history;
create policy "Participants can record status changes" on public.order_status_history
    for insert with check (
        changed_by = auth.uid() and exists (
            select 1 from public.orders where id = order_status_history.order_id and (
                customer_id = auth.uid() or
                courier_id = auth.uid() or
                exists (
                    select 1 from public.restaurants
                     where id = orders.restaurant_id and owner_id = auth.uid()
                ) or
                exists (
                    select 1 from public.profiles
                     where id = auth.uid() and role = 'SUPER_ADMIN'
                )
            )
        )
    );

-- No update/delete policies on purpose: the timeline is an append-only audit
-- trail. Only the service role may amend it.
