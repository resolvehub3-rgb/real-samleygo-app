-- ==============================================================================
-- SAMLEYGO — COURIER IDENTITY VERIFICATION MIGRATION (Ghana Card, Licence, Plate)
-- -----------------------------------------------------------------------------
-- Run this AFTER 20260925_samleygo_schema.sql in the Supabase SQL Editor if your
-- project was bootstrapped with the previous version of the schema.
-- Every statement is idempotent: the script can be executed as many times as
-- needed without breaking an existing production database.
--
-- What it adds:
--   * courier verification workflow columns (status, submission & review stamps)
--   * courier_documents becomes the single, RLS-protected store for identity PII
--     (Ghana Card PIN, licence ID, Ghana Card front/back photos)
--   * a PRIVATE Supabase Storage bucket for the Ghana Card photos
--   * realtime publication for courier_documents (live admin review)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. COURIERS: verification workflow columns (no identity PII on this table)
-- ------------------------------------------------------------------------------
alter table public.couriers add column if not exists vehicle_plate text;
alter table public.couriers add column if not exists verification_status text not null default 'UNSUBMITTED';
alter table public.couriers add column if not exists verification_submitted_at timestamptz;
alter table public.couriers add column if not exists verification_reviewed_at timestamptz;
alter table public.couriers add column if not exists verification_note text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'couriers_verification_status_check'
    ) then
        alter table public.couriers
            add constraint couriers_verification_status_check
            check (verification_status in ('UNSUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'));
    end if;
end$$;

-- Backfill: previously approved couriers stay approved, submitted ones go to PENDING
update public.couriers
set verification_status = 'APPROVED',
    verification_reviewed_at = coalesce(verification_reviewed_at, updated_at)
where is_approved = true and verification_status = 'UNSUBMITTED';

-- ------------------------------------------------------------------------------
-- 2. COURIER DOCUMENTS: document identifiers, uniqueness + freshness
-- ------------------------------------------------------------------------------
alter table public.courier_documents add column if not exists document_side text;
alter table public.courier_documents add column if not exists document_number text;
alter table public.courier_documents add column if not exists storage_path text;
alter table public.courier_documents add column if not exists updated_at timestamptz not null default now();

-- A licence ID record may exist without a photo
alter table public.courier_documents alter column document_url drop not null;

create unique index if not exists uq_courier_documents_type
    on public.courier_documents(courier_id, document_type);

create index if not exists idx_courier_documents_courier
    on public.courier_documents(courier_id, status);

create index if not exists idx_couriers_verification
    on public.couriers(verification_status, is_approved);

-- ------------------------------------------------------------------------------
-- 3. REALTIME: publish courier_documents so admin review panels update live
-- ------------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'courier_documents'
    ) then
        alter publication supabase_realtime add table public.courier_documents;
    end if;
end$$;

-- ------------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY: courier document policies (none existed before)
--    courier_documents is the only place Ghana Card / licence data is stored,
--    so these policies are the privacy boundary for national ID information.
-- ------------------------------------------------------------------------------
alter table public.couriers enable row level security;
alter table public.courier_documents enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'courier_documents'
          and policyname = 'Couriers can view their own verification documents'
    ) then
        create policy "Couriers can view their own verification documents" on public.courier_documents
            for select using (
                auth.uid() = courier_id or exists (
                    select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
                )
            );
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'courier_documents'
          and policyname = 'Couriers can submit their own verification documents'
    ) then
        create policy "Couriers can submit their own verification documents" on public.courier_documents
            for insert with check (auth.uid() = courier_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'courier_documents'
          and policyname = 'Couriers can resubmit their own verification documents'
    ) then
        create policy "Couriers can resubmit their own verification documents" on public.courier_documents
            for update using (
                auth.uid() = courier_id or exists (
                    select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN'
                )
            );
    end if;
end$$;

-- ------------------------------------------------------------------------------
-- 5. PRIVACY: anonymous traffic can no longer read the couriers table wholesale
-- ------------------------------------------------------------------------------
revoke select on table public.couriers from anon;
grant select (
    id, vehicle_type, vehicle_plate, is_approved, is_online, availability_status,
    current_latitude, current_longitude, current_location_updated_at, last_seen_at,
    total_deliveries, rating, verification_status, created_at, updated_at
) on table public.couriers to anon;

-- ------------------------------------------------------------------------------
-- 6. STORAGE: PRIVATE bucket for Ghana Card front & back photos
-- ------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('courier-documents', 'courier-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'Couriers can upload their own verification photos'
    ) then
        create policy "Couriers can upload their own verification photos" on storage.objects
            for insert to authenticated with check (
                bucket_id = 'courier-documents'
                and (storage.foldername(name))[1] = auth.uid()::text
            );
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'Verification photos are visible to their owner and to admins'
    ) then
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
    end if;
end$$;

-- ------------------------------------------------------------------------------
-- 7. UPDATED_AT TRIGGERS (keeps realtime payloads freshly stamped)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 8. SIGNUP TRIGGER: persist courier identity details coming from auth metadata
--    (works even when the browser has no active session right after signUp)
--
--    NOTE (2026-09-27): SUPERSEDED by 20260927_signup_repair.sql — its version
--    pins search_path, schema-qualifies every object and can never block a
--    signup. Re-running this file reinstalls the older search_path-sensitive
--    definition ("Database error saving new user"), so run the repair file
--    straight afterwards.
-- ------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
declare
    user_role_val user_role := 'CUSTOMER';
    requested_role text;
    card_pin text;
    licence_id text;
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
        card_pin := nullif(trim(coalesce(new.raw_user_meta_data->>'ghana_card_number', '')), '');
        licence_id := nullif(trim(coalesce(new.raw_user_meta_data->>'license_number', '')), '');

        insert into public.couriers (
            id, vehicle_type, vehicle_plate, verification_status, verification_submitted_at
        ) values (
            new.id,
            coalesce(new.raw_user_meta_data->>'vehicle_type', 'Motorcycle'),
            nullif(trim(coalesce(new.raw_user_meta_data->>'vehicle_plate', '')), ''),
            case when card_pin is null then 'UNSUBMITTED' else 'PENDING' end,
            case when card_pin is null then null else now() end
        );

        -- Identity numbers survive even if the browser could not finish its
        -- follow-up writes; photo uploads fill document_url in afterwards.
        if card_pin is not null then
            insert into public.courier_documents (courier_id, document_type, document_side, document_number, status)
            values
                (new.id, 'GHANA_CARD_FRONT', 'FRONT', card_pin, 'PENDING'),
                (new.id, 'GHANA_CARD_BACK', 'BACK', card_pin, 'PENDING')
            on conflict (courier_id, document_type) do nothing;
        end if;

        if licence_id is not null then
            insert into public.courier_documents (courier_id, document_type, document_number, status)
            values (new.id, 'DRIVING_LICENCE', licence_id, 'PENDING')
            on conflict (courier_id, document_type) do nothing;
        end if;
    end if;

    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ==============================================================================
-- END OF MIGRATION
-- ==============================================================================
