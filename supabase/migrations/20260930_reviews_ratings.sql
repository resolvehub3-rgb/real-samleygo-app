-- =====================================================================
-- Customer reviews: make the submit actually save, and make the ratings it
-- feeds (restaurant rating + courier rating) actually update.
-- Run this in the Supabase SQL editor (Supabase Dashboard -> SQL Editor).
-- Idempotent: safe to run multiple times.
--
-- Why this exists:
--   public.reviews had row level security ENABLED but no policies at all, so
--   Postgres rejected every insert. The order screen ignored that error and
--   still showed "Thank you! Your verified review has been recorded", while
--   restaurants.rating / restaurants.total_reviews / couriers.rating never
--   moved and the courier earnings screen read an empty reviews table.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Confirm this is the app's database (guard)
-- ---------------------------------------------------------------------
-- Two runs of this file died with 42P01 ("relation ... does not exist")
-- because the query reached a database that never saw the SamleyGo schema
-- - a different project picked in the SQL editor, a preview branch, or a
-- local database. Say that in plain English instead.
do $$
declare
    missing text;
begin
    select string_agg(v.t, ', ' order by v.t)
      into missing
      from (values ('public.orders'),
                   ('public.profiles'),
                   ('public.restaurants'),
                   ('public.couriers')) v(t)
     where to_regclass(v.t) is null;

    if missing is not null then
        raise exception E'SamleyGo schema not found - missing %.\nThis query is running in a DIFFERENT database than the app uses.\nOpen https://supabase.com/dashboard/project/xvflryuspotcmgvedxcj/sql/new\n(the project in VITE_SUPABASE_URL) - or leave any preview branch - and run it there.', missing;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 0b. Guarantee the objects this script needs, in the database it lands in
-- ---------------------------------------------------------------------
-- public.reviews is created by 20260925_samleygo_schema.sql. If it is not
-- there (the schema script never finished, or the query ran in another
-- project / database) every later statement dies with
--   ERROR: 42P01: relation "public.reviews" does not exist
-- so create it first. The statement is a no-op where the table already
-- exists, and a failure here names the real problem (a database that never
-- ran the base schema) instead of the symptom.
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

alter table public.reviews enable row level security;

-- Columns the refresh trigger writes must exist as well.
alter table public.restaurants add column if not exists rating numeric(3,2) not null default 0.00;
alter table public.restaurants add column if not exists total_reviews integer not null default 0;
alter table public.couriers add column if not exists rating numeric(3,2) not null default 0.00;

-- ---------------------------------------------------------------------
-- 1. ROW LEVEL SECURITY policies for public.reviews
-- ---------------------------------------------------------------------

-- 1z. Table privileges first: the browser role must be allowed to touch the
--     table at all - row level security then decides which rows it sees.
--     (Granting is idempotent and changes no rows on its own.)
grant usage on schema public to authenticated;
grant select, insert, update on public.reviews to authenticated;

-- 1a. Only the customer who owns the order may write its review.
drop policy if exists "Customers can submit reviews for their orders" on public.reviews;
create policy "Customers can submit reviews for their orders" on public.reviews
    for insert to authenticated
    with check (
        customer_id = auth.uid()
        and exists (
            select 1 from public.orders o
            where o.id = reviews.order_id
              and o.customer_id = auth.uid()
        )
    );

-- 1b. Read access for everyone who legitimately needs to see a review:
--     its author (the "you already reviewed" check on the order screen), the
--     courier who was rated (earnings screen), the kitchen that was rated
--     (dashboard rating + comments), and super admins (admin console).
drop policy if exists "Review parties can read reviews" on public.reviews;
create policy "Review parties can read reviews" on public.reviews
    for select to authenticated
    using (
        customer_id = auth.uid()
        or courier_id = auth.uid()
        or exists (
            select 1 from public.restaurants r
            where r.id = reviews.restaurant_id
              and r.owner_id = auth.uid()
        )
        or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'SUPER_ADMIN'
        )
    );

-- 1c. The author may correct their own review (re-submitting updates it
--     instead of failing on the unique constraint added in section 2).
drop policy if exists "Customers can update their own review" on public.reviews;
create policy "Customers can update their own review" on public.reviews
    for update to authenticated
    using (customer_id = auth.uid())
    with check (customer_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. One review per order per customer
-- ---------------------------------------------------------------------
-- Keeps the order screen's upsert (on conflict order_id, customer_id) working
-- and stops double taps from inflating the averages. Existing duplicates are
-- collapsed to the earliest row first, so index creation cannot fail.
delete from public.reviews a
using public.reviews b
where a.customer_id = b.customer_id
  and a.order_id = b.order_id
  and (a.created_at > b.created_at
       or (a.created_at = b.created_at and a.id > b.id));

create unique index if not exists reviews_one_per_customer_order
    on public.reviews (order_id, customer_id);

-- ---------------------------------------------------------------------
-- 3. Rating aggregates are maintained by the database, not by the browser
-- ---------------------------------------------------------------------
-- The customer's session cannot update public.restaurants (only its owner
-- can) and never could update public.couriers, so the averages are recomputed
-- here. security definer + a pinned search_path: the trigger runs with the
-- table owner's rights and can never be steered into another schema.
create or replace function public.refresh_review_ratings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_restaurant_id uuid;
    v_courier_id uuid;
    v_rest_rating numeric;
    v_rest_count integer;
    v_courier_rating numeric;
begin
    if TG_OP = 'DELETE' then
        v_restaurant_id := old.restaurant_id;
        v_courier_id := old.courier_id;
    else
        v_restaurant_id := new.restaurant_id;
        v_courier_id := new.courier_id;
    end if;

    -- Kitchen: average rating + review count shown on the restaurant
    -- dashboard, restaurant cards, settings and the admin console.
    if v_restaurant_id is not null then
        select round(avg(restaurant_rating), 2),
               count(*) filter (where restaurant_rating is not null)
          into v_rest_rating, v_rest_count
          from public.reviews
         where restaurant_id = v_restaurant_id;

        -- No stored rating at all (e.g. the last review was removed) keeps the
        -- current figure instead of collapsing it to zero.
        update public.restaurants
           set rating = coalesce(v_rest_rating, rating),
               total_reviews = coalesce(v_rest_count, total_reviews)
         where id = v_restaurant_id;
    end if;

    -- Courier: average rating shown on the customer's order card, the
    -- kitchen's courier pool, the earnings screen and the admin console.
    if v_courier_id is not null then
        select round(avg(courier_rating), 2)
          into v_courier_rating
          from public.reviews
         where courier_id = v_courier_id;

        update public.couriers
           set rating = coalesce(v_courier_rating, rating)
         where id = v_courier_id;
    end if;

    if TG_OP = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_reviews_refresh_ratings on public.reviews;
create trigger trg_reviews_refresh_ratings
    after insert or update or delete on public.reviews
    for each row execute function public.refresh_review_ratings();

-- ---------------------------------------------------------------------
-- 4. Backfill: recompute the current numbers from whatever is stored today
--    so a live database starts out correct after this migration.
-- ---------------------------------------------------------------------
update public.restaurants r
   set rating = coalesce(agg.avg_rating, r.rating),
       total_reviews = coalesce(agg.cnt, r.total_reviews)
  from (
        select restaurant_id,
               round(avg(restaurant_rating), 2) as avg_rating,
               count(*) filter (where restaurant_rating is not null) as cnt
          from public.reviews
         group by restaurant_id
       ) agg
 where agg.restaurant_id = r.id;

update public.couriers c
   set rating = coalesce(agg.avg_rating, c.rating)
  from (
        select courier_id,
               round(avg(courier_rating), 2) as avg_rating
          from public.reviews
         where courier_id is not null
         group by courier_id
       ) agg
 where agg.courier_id = c.id;
