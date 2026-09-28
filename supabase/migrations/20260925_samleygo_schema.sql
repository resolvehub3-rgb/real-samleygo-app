-- ==============================================================================
-- SAMLEYGO PRODUCTION SUPABASE DATABASE SCHEMA & RLS POLICIES
-- Ghana Food Delivery Platform SaaS & Mobile PWA
-- ==============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. ENUMS & DOMAINS
do $$
begin
    if not exists (select 1 from pg_type where typname = 'user_role') then
        create type user_role as enum ('CUSTOMER', 'COURIER', 'RESTAURANT_OWNER', 'SUPER_ADMIN');
    end if;
end$$;

-- 2. PROFILES TABLE (Linked to auth.users)
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    full_name text not null,
    phone text,
    role user_role not null default 'CUSTOMER',
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 3. CUSTOMER DETAILS
create table if not exists public.customers (
    id uuid primary key references public.profiles(id) on delete cascade,
    default_address text,
    latitude double precision,
    longitude double precision,
    created_at timestamptz not null default now()
);

-- 4. RESTAURANTS
create table if not exists public.restaurants (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles(id) on delete cascade,
    name text not null,
    description text,
    cuisine_type text not null,
    phone text not null,
    email text,
    address text not null,
    city text not null default 'Accra',
    latitude double precision,
    longitude double precision,
    logo_url text,
    cover_url text,
    is_open boolean not null default true,
    is_approved boolean not null default false,
    opening_time text default '08:00',
    closing_time text default '22:00',
    min_order_amount numeric(10,2) not null default 0.00,
    commission_rate numeric(5,2) not null default 15.00,
    rating numeric(3,2) not null default 0.00,
    total_reviews integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 5. RESTAURANT CATEGORIES
create table if not exists public.restaurant_categories (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    name text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

-- 6. MENU ITEMS
create table if not exists public.menu_items (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    category_id uuid references public.restaurant_categories(id) on delete set null,
    name text not null,
    description text,
    price numeric(10,2) not null,
    image_url text,
    is_available boolean not null default true,
    preparation_time_minutes integer not null default 20,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 7. COURIERS (operational record + verification status)
--    Ghana Card / licence numbers and photos are NOT stored here: this table is
--    readable by every signed-in user, so identity PII lives in courier_documents.
create table if not exists public.couriers (
    id uuid primary key references public.profiles(id) on delete cascade,
    vehicle_type text not null default 'Motorcycle', -- Motorcycle, Bicycle, Car, Van
    vehicle_plate text,
    verification_status text not null default 'UNSUBMITTED', -- UNSUBMITTED, PENDING, APPROVED, REJECTED
    verification_submitted_at timestamptz,
    verification_reviewed_at timestamptz,
    verification_note text,
    is_approved boolean not null default false,
    is_online boolean not null default false,
    availability_status text not null default 'OFFLINE', -- OFFLINE, AVAILABLE, ON_DELIVERY
    current_latitude double precision,
    current_longitude double precision,
    current_location_updated_at timestamptz,
    last_seen_at timestamptz,
    total_deliveries integer not null default 0,
    rating numeric(3,2) not null default 0.00,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint couriers_verification_status_check
        check (verification_status in ('UNSUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'))
);

-- 8. COURIER DOCUMENTS — the single, RLS-protected store for courier identity PII
--    (Ghana Card PIN, licence ID, Ghana Card front/back photos)
create table if not exists public.courier_documents (
    id uuid primary key default gen_random_uuid(),
    courier_id uuid not null references public.couriers(id) on delete cascade,
    document_type text not null, -- GHANA_CARD_FRONT, GHANA_CARD_BACK, DRIVING_LICENCE, VEHICLE_INSURANCE, ROAD_WORTHY
    document_side text,          -- FRONT, BACK (null for single-sided documents)
    document_number text,        -- Identifier printed on the document (Ghana Card PIN / Licence ID)
    document_url text,           -- Inline (data) URL or signed URL; null for text-only records such as a licence ID
    storage_path text,           -- Private path inside the courier-documents bucket (null for fallback data URLs)
    status text not null default 'PENDING', -- PENDING, APPROVED, REJECTED
    rejection_reason text,
    uploaded_at timestamptz not null default now(),
    reviewed_at timestamptz,
    updated_at timestamptz not null default now(),
    -- One row per document type per courier so re-submissions upsert instead of duplicating
    constraint uq_courier_documents_type unique (courier_id, document_type)
);

-- 9. ORDERS
create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    order_number text unique not null,
    customer_id uuid not null references public.profiles(id),
    restaurant_id uuid not null references public.restaurants(id),
    courier_id uuid references public.profiles(id),
    status text not null default 'PENDING_PAYMENT',
    subtotal numeric(10,2) not null,
    delivery_fee numeric(10,2) not null default 0.00,
    tip numeric(10,2) not null default 0.00,
    total_amount numeric(10,2) not null,
    delivery_address text not null,
    delivery_latitude double precision,
    delivery_longitude double precision,
    customer_phone text not null,
    delivery_notes text,
    payment_method text not null, -- Mobile Money (MTN MoMo, Telecel Cash, AT Money), Card, Cash on Delivery
    payment_status text not null default 'PENDING', -- PENDING, COMPLETED, FAILED
    payment_reference text,
    estimated_delivery_time timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 10. ORDER ITEMS
create table if not exists public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    menu_item_id uuid references public.menu_items(id) on delete set null,
    item_name text not null,
    item_price numeric(10,2) not null,
    quantity integer not null,
    notes text,
    subtotal numeric(10,2) not null
);

-- 11. ORDER STATUS HISTORY
create table if not exists public.order_status_history (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    status text not null,
    note text,
    changed_by uuid references public.profiles(id),
    created_at timestamptz not null default now()
);

-- 12. DELIVERY LOCATIONS (Realtime courier breadcrumbs)
create table if not exists public.delivery_locations (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    courier_id uuid not null references public.profiles(id),
    latitude double precision not null,
    longitude double precision not null,
    recorded_at timestamptz not null default now()
);

-- 13. PAYMENTS & TRANSACTIONS
create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    customer_id uuid not null references public.profiles(id),
    amount numeric(10,2) not null,
    currency text not null default 'GHS',
    provider text not null, -- Paystack / Hubtel / Mobile Money
    payment_method text not null,
    status text not null default 'PENDING',
    payment_reference text not null unique,
    transaction_reference text,
    paid_at timestamptz,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- 14. REVIEWS
create table if not exists public.reviews (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    customer_id uuid not null references public.profiles(id),
    restaurant_id uuid not null references public.restaurants(id),
    courier_id uuid references public.profiles(id),
    restaurant_rating integer check (restaurant_rating >= 1 and restaurant_rating <= 5),
    restaurant_comment text,
    courier_rating integer check (courier_rating >= 1 and courier_rating <= 5),
    courier_comment text,
    created_at timestamptz not null default now()
);

-- 15. NOTIFICATIONS
create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    title text not null,
    message text not null,
    type text not null, -- ORDER_STATUS, COURIER_ASSIGNED, DELIVERY_ARRIVED, PAYMENT, SYSTEM
    link text,
    is_read boolean not null default false,
    created_at timestamptz not null default now()
);

-- 16. PLATFORM SETTINGS
create table if not exists public.platform_settings (
    key text primary key,
    value jsonb not null,
    description text,
    updated_at timestamptz not null default now()
);

-- 17. AUDIT LOGS
create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.profiles(id),
    action text not null,
    target_type text,
    target_id text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- INDEXES FOR HIGH-TRAFFIC QUERIES
create index if not exists idx_restaurants_owner on public.restaurants(owner_id);
create index if not exists idx_restaurants_approved on public.restaurants(is_approved, is_open);
create index if not exists idx_menu_items_restaurant on public.menu_items(restaurant_id);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_restaurant on public.orders(restaurant_id);
create index if not exists idx_orders_courier on public.orders(courier_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_delivery_locations_order on public.delivery_locations(order_id);
create index if not exists idx_notifications_user on public.notifications(user_id, is_read);
create index if not exists idx_couriers_verification on public.couriers(verification_status, is_approved);
create index if not exists idx_courier_documents_courier on public.courier_documents(courier_id, status);

-- REALTIME CONFIGURATION: Enable publication on active tables
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.couriers;
alter publication supabase_realtime add table public.courier_documents;
alter publication supabase_realtime add table public.delivery_locations;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.restaurants;
alter publication supabase_realtime add table public.menu_items;

-- ------------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.couriers enable row level security;
alter table public.courier_documents enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.delivery_locations enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.platform_settings enable row level security;
alter table public.audit_logs enable row level security;

-- PROFILES
create policy "Users can view all public profiles" on public.profiles
    for select using (true);
create policy "Users can update their own profile" on public.profiles
    for update using (auth.uid() = id);
create policy "Users can insert their own profile" on public.profiles
    for insert with check (auth.uid() = id and role <> 'SUPER_ADMIN');

-- ROLE PROTECTION: only a super admin (or a session-less SQL / service-role call)
-- may change an account's role. Stops any signed-in user from promoting
-- themselves to SUPER_ADMIN through the profiles update policy.
create or replace function public.protect_profile_role()
returns trigger as $$
begin
    if new.role is distinct from old.role
       and auth.uid() is not null
       and not exists (
           select 1 from public.profiles
            where id = auth.uid() and role = 'SUPER_ADMIN'
       ) then
        raise exception 'Only a super admin can change account roles';
    end if;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists protect_profiles_role on public.profiles;
create trigger protect_profiles_role
    before update on public.profiles
    for each row execute function public.protect_profile_role();

-- RESTAURANTS
create policy "Anyone can view approved restaurants" on public.restaurants
    for select using (is_approved = true or auth.uid() = owner_id or exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));
create policy "Restaurant owners can create restaurants" on public.restaurants
    for insert with check (auth.uid() = owner_id);
create policy "Restaurant owners can update their own restaurant" on public.restaurants
    for update using (auth.uid() = owner_id or exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));

-- MENU ITEMS & CATEGORIES
create policy "Anyone can view menu items of approved restaurants" on public.menu_items
    for select using (true);
create policy "Restaurant owners can manage menu items" on public.menu_items
    for all using (exists (
        select 1 from public.restaurants where id = menu_items.restaurant_id and owner_id = auth.uid()
    ) or exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));

create policy "Anyone can view categories" on public.restaurant_categories
    for select using (true);
create policy "Restaurant owners can manage categories" on public.restaurant_categories
    for all using (exists (
        select 1 from public.restaurants where id = restaurant_categories.restaurant_id and owner_id = auth.uid()
    ) or exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));

-- COURIERS
create policy "Approved couriers are visible to customers and restaurants on orders" on public.couriers
    for select using (true);
create policy "Couriers can update their own availability and location" on public.couriers
    for update using (auth.uid() = id or exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));
create policy "Couriers can insert own courier profile" on public.couriers
    for insert with check (auth.uid() = id);

-- COURIER DOCUMENTS (Ghana Card photos, licences, roadworthy certificates)
-- Only the courier who owns the documents and the platform admins can ever read them.
create policy "Couriers can view their own verification documents" on public.courier_documents
    for select using (
        auth.uid() = courier_id or exists (
            select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );
create policy "Couriers can submit their own verification documents" on public.courier_documents
    for insert with check (auth.uid() = courier_id);
create policy "Couriers can resubmit their own verification documents" on public.courier_documents
    for update using (
        auth.uid() = courier_id or exists (
            select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
        )
    );

-- PRIVACY HARDENING: anonymous visitors never read Ghana Card / licence numbers from couriers.
revoke select on table public.couriers from anon;
grant select (
    id, vehicle_type, vehicle_plate, is_approved, is_online, availability_status,
    current_latitude, current_longitude, current_location_updated_at, last_seen_at,
    total_deliveries, rating, verification_status, created_at, updated_at
) on table public.couriers to anon;

-- ORDERS
create policy "Users can view their related orders" on public.orders
    for select using (
        auth.uid() = customer_id or
        auth.uid() = courier_id or
        exists (select 1 from public.restaurants where id = orders.restaurant_id and owner_id = auth.uid()) or
        exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN') or
        (status in ('READY_FOR_PICKUP', 'RESTAURANT_ACCEPTED') and exists (
            select 1 from public.couriers where id = auth.uid() and is_approved = true and is_online = true
        ))
    );

create policy "Customers can insert their orders" on public.orders
    for insert with check (auth.uid() = customer_id);

create policy "Authorized parties can update order status" on public.orders
    for update using (
        auth.uid() = customer_id or
        auth.uid() = courier_id or
        exists (select 1 from public.restaurants where id = orders.restaurant_id and owner_id = auth.uid()) or
        exists (select 1 from public.couriers where id = auth.uid() and is_approved = true) or
        exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN')
    );

-- ORDER ITEMS
create policy "Users can view items for authorized orders" on public.order_items
    for select using (exists (
        select 1 from public.orders where id = order_items.order_id and (
            customer_id = auth.uid() or
            courier_id = auth.uid() or
            exists (select 1 from public.restaurants where id = orders.restaurant_id and owner_id = auth.uid()) or
            exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN')
        )
    ));
create policy "Customers can insert order items" on public.order_items
    for insert with check (exists (
        select 1 from public.orders where id = order_items.order_id and customer_id = auth.uid()
    ));

-- DELIVERY LOCATIONS (Realtime courier GPS)
create policy "Order participants can view delivery locations" on public.delivery_locations
    for select using (exists (
        select 1 from public.orders where id = delivery_locations.order_id and (
            customer_id = auth.uid() or courier_id = auth.uid() or exists (
                select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
            )
        )
    ));
create policy "Couriers can log their delivery location" on public.delivery_locations
    for insert with check (auth.uid() = courier_id);

-- NOTIFICATIONS
create policy "Users can view and manage their own notifications" on public.notifications
    for all using (auth.uid() = user_id);

-- PLATFORM SETTINGS
create policy "Public can read platform settings" on public.platform_settings
    for select using (true);
create policy "Super admin can manage settings" on public.platform_settings
    for all using (exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));

-- AUDIT LOGS
create policy "Super admin can view audit logs" on public.audit_logs
    for select using (exists (
        select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
    ));
create policy "Authenticated users can insert audit logs" on public.audit_logs
    for insert with check (auth.uid() is not null);

-- ------------------------------------------------------------------------------
-- STORAGE: Courier verification photos (Ghana Card front & back)
-- PRIVATE bucket: photos are only reachable through signed URLs issued to the
-- courier who owns them or to a super admin (never a public link).
-- ------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('courier-documents', 'courier-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "Couriers can upload their own verification photos" on storage.objects
    for insert to authenticated with check (
        bucket_id = 'courier-documents'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Verification photos are visible to their owner and to admins" on storage.objects
    for select to authenticated using (
        bucket_id = 'courier-documents'
        and (
            (storage.foldername(name))[1] = auth.uid()::text
            or exists (
                select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
            )
        )
    );

-- Keep updated_at fresh so realtime subscribers always receive a changed payload
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_couriers_updated_at on public.couriers;
create trigger set_couriers_updated_at
    before update on public.couriers
    for each row execute function public.handle_updated_at();

drop trigger if exists set_courier_documents_updated_at on public.courier_documents;
create trigger set_courier_documents_updated_at
    before update on public.courier_documents
    for each row execute function public.handle_updated_at();

-- NOTE (2026-09-27): the handle_new_user() below is SUPERSEDED by
-- 20260927_signup_repair.sql, whose version pins search_path, schema-qualifies
-- every object and can never block a signup. Re-running this file reinstalls
-- the older search_path-sensitive definition ("Database error saving new user")
-- — if you do, run 20260927_signup_repair.sql straight afterwards.
-- AUTOMATIC PROFILE TRIGGER ON AUTH.SIGNUP
create or replace function public.handle_new_user()
returns trigger as $$
declare
    user_role_val user_role := 'CUSTOMER';
    requested_role text;
begin
    requested_role := new.raw_user_meta_data->>'role';
    if requested_role in ('CUSTOMER', 'COURIER', 'RESTAURANT_OWNER', 'SUPER_ADMIN') then
        user_role_val := requested_role::user_role;
    end if;

    insert into public.profiles (id, email, full_name, phone, role)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'phone',
        user_role_val
    );

    if user_role_val = 'CUSTOMER' then
        insert into public.customers (id) values (new.id);
    elsif user_role_val = 'COURIER' then
        insert into public.couriers (
            id, vehicle_type, vehicle_plate, verification_status, verification_submitted_at
        ) values (
            new.id,
            coalesce(new.raw_user_meta_data->>'vehicle_type', 'Motorcycle'),
            nullif(trim(coalesce(new.raw_user_meta_data->>'vehicle_plate', '')), ''),
            case
                when nullif(trim(coalesce(new.raw_user_meta_data->>'ghana_card_number', '')), '') is null
                    then 'UNSUBMITTED'
                else 'PENDING'
            end,
            case
                when nullif(trim(coalesce(new.raw_user_meta_data->>'ghana_card_number', '')), '') is null
                    then null
                else now()
            end
        );

        -- Persist the submitted identity numbers even if the browser could not
        -- finish the follow-up writes (photo uploads fill in document_url later).
        if nullif(trim(coalesce(new.raw_user_meta_data->>'ghana_card_number', '')), '') is not null then
            insert into public.courier_documents (courier_id, document_type, document_side, document_number, status)
            values
                (new.id, 'GHANA_CARD_FRONT', 'FRONT',
                 nullif(trim(new.raw_user_meta_data->>'ghana_card_number'), ''), 'PENDING'),
                (new.id, 'GHANA_CARD_BACK', 'BACK',
                 nullif(trim(new.raw_user_meta_data->>'ghana_card_number'), ''), 'PENDING')
            on conflict (courier_id, document_type) do nothing;
        end if;

        if nullif(trim(coalesce(new.raw_user_meta_data->>'license_number', '')), '') is not null then
            insert into public.courier_documents (courier_id, document_type, document_number, status)
            values (
                new.id, 'DRIVING_LICENCE',
                nullif(trim(new.raw_user_meta_data->>'license_number'), ''), 'PENDING'
            )
            on conflict (courier_id, document_type) do nothing;
        end if;
    end if;

    return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- DEFAULT PLATFORM SETTINGS SEED (Ghana Cedi standard defaults)
insert into public.platform_settings (key, value, description)
values 
    ('delivery_pricing', '{"base_fee": 12.00, "per_km_rate": 2.50, "min_fee": 10.00, "max_fee": 60.00, "currency": "GHS", "surge_multiplier": 1.0, "courier_payout_percentage": 80.0, "platform_commission_percentage": 20.0}'::jsonb, 'Ghana delivery pricing configuration'),
    ('operational_regions', '{"supported_cities": ["Accra", "Kumasi", "Tema", "Takoradi", "Cape Coast", "Tamale"], "currency": "GHS", "country": "Ghana"}'::jsonb, 'Supported operational regions')
on conflict (key) do nothing;
