-- ==============================================================================
-- SAMLEYGO — FULL FACTORY RESET
-- Wipes every row of data, keeps the schema, RLS policies, triggers and
-- migrations exactly as they are.
--
-- WHAT IT DELETES
--   • every account (auth.users → profiles, customers, couriers, courier docs)
--   • every restaurant, category and menu item
--   • every order, order item, status history entry, delivery location,
--     payment and review
--   • notifications, audit logs, signup diagnostics
--   • every file in the courier-documents / avatars / restaurant-media buckets
--   • then restores the default platform pricing settings
--
-- WHAT IT KEEPS
--   • all tables, columns, indexes, enums
--   • all RLS policies, triggers, functions, realtime publication
--   • the storage buckets themselves
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste this file → Run.
--   It is irreversible. Take a backup first if you care about anything in here.
--
-- AFTERWARDS you must sign up again and re-promote your admin account
-- (see the commented block at the bottom of this file).
-- ==============================================================================

-- ▼▼▼ THIS SCRIPT DELETES ALL DATA. MAKE SURE YOU HAVE A BACKUP. ▼▼▼

begin;

-- ------------------------------------------------------------------------------
-- 1. ORDER-ROOTED DATA
--    (order_items / order_status_history / delivery_locations / payments /
--     reviews all cascade from orders anyway — deleting them explicitly first
--     keeps the script readable and guarantees nothing is missed.)
-- ------------------------------------------------------------------------------
delete from public.order_items;
delete from public.order_status_history;
delete from public.delivery_locations;
delete from public.order_settlement_adjustments;
delete from public.payments;
delete from public.reviews;
delete from public.orders;

-- ------------------------------------------------------------------------------
-- 2. COMMERCE DIRECTORY
-- ------------------------------------------------------------------------------
delete from public.menu_items;
delete from public.restaurant_categories;
delete from public.restaurants;

-- ------------------------------------------------------------------------------
-- 3. PLATFORM BOOKKEEPING
-- ------------------------------------------------------------------------------
delete from public.notifications;
delete from public.audit_logs;
delete from public.signup_debug;

-- ------------------------------------------------------------------------------
-- 4. ACCOUNTS
--    auth.users cascades into public.profiles, which cascades into
--    customers, couriers and courier_documents. Restaurants are already gone
--    (step 2) so the owner_id foreign key cannot block the delete.
-- ------------------------------------------------------------------------------
delete from public.courier_documents;
delete from auth.users;

-- Belt and braces: these should already be empty via the cascades above.
delete from public.couriers;
delete from public.customers;
delete from public.profiles;

-- ------------------------------------------------------------------------------
-- 5. STORAGE FILES (buckets themselves stay)
-- ------------------------------------------------------------------------------
do $$
begin
    delete from storage.objects
     where bucket_id in ('courier-documents', 'avatars', 'restaurant-media');
exception
    when insufficient_privilege then
        raise notice 'storage.objects was not cleared (permission denied) — delete the files from Dashboard → Storage instead.';
end $$;

-- ------------------------------------------------------------------------------
-- 6. RESTORE DEFAULT PLATFORM SETTINGS (Ghana Cedi defaults)
-- ------------------------------------------------------------------------------
insert into public.platform_settings (key, value, description)
values
    ('delivery_pricing', '{"base_fee": 12.00, "per_km_rate": 2.50, "min_fee": 10.00, "max_fee": 60.00, "currency": "GHS", "surge_multiplier": 1.0, "courier_payout_percentage": 100.00, "platform_commission_percentage": 20.0}'::jsonb, 'Ghana delivery pricing configuration'),
    ('commission', '{"restaurant_commission_percentage": 15.00, "courier_commission_percentage": 0.00, "max_restaurant_commission_percentage": 50.00, "max_courier_commission_percentage": 50.00, "currency": "GHS"}'::jsonb, 'Phase 1 marketplace commission rules — restaurant commission is charged per order on food subtotal; couriers pay 0% commission.'),
    ('operational_regions', '{"supported_cities": ["Accra", "Kumasi", "Tema", "Takoradi", "Cape Coast", "Tamale"], "currency": "GHS", "country": "Ghana"}'::jsonb, 'Supported operational regions')
on conflict (key) do update
   set value = excluded.value,
       description = excluded.description,
       updated_at = now();

commit;

-- ------------------------------------------------------------------------------
-- 7. AFTER THE RESET — run these once, after you have signed up again.
-- ------------------------------------------------------------------------------
-- 7a. Promote your own account to admin (the role-protection trigger only
--     blocks in-app updates, never a direct SQL call):
-- update public.profiles set role = 'SUPER_ADMIN' where email = 'you@example.com';
--
-- 7b. Or create a test trio in one go (they still need real sign-ups for
--     auth.users — the handle_new_user() trigger creates the rows below from
--     your metadata when you register through the app):
--     • sign up as a customer with role=CUSTOMER
--     • sign up as a rider   with role=COURIER   + vehicle_plate + ghana_card_number
--     • sign up as a kitchen with role=RESTAURANT_OWNER, then create a
--       restaurant from the restaurant dashboard.
