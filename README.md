# 🍛 SamleyGo — Ghana Food Delivery SaaS & Installable Mobile PWA

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646cff.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4.x-38bdf8.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%7C%20Auth%20%7C%20Realtime-3ecf8e.svg)](https://supabase.com/)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable%20%26%20Offline-orange.svg)](https://web.dev/progressive-web-apps/)
[![Google Play TWA](https://img.shields.io/badge/Google%20Play-TWA%20Ready-green.svg)](https://developer.android.com/distribute)

> **SamleyGo** is a full-featured, Ghana-localized food ordering and delivery software platform and installable Progressive Web App (PWA). It bridges the gap between hungry diners, authentic Ghanaian restaurants/chop bars, delivery riders (couriers), and central platform administration with real-time tracking, Mobile Money (MoMo) payments, and live data synchronization powered by Supabase.

---

## 📱 App Screenshots & Visual Preview

### 1. Customer Experience & Real-Time Food Search
*Intuitive discovery of authentic Ghanaian dishes (Jollof Rice, Waakye, Banku & Tilapia, Kelewele), real-time search across kitchens and menus, dynamic cart management, and instant ordering in Ghana Cedis (GHS).*

![SamleyGo Customer & Realtime Food Search Experience](./public/screenshots/samleygo-customer-preview.jpg)

---

### 2. Multi-Role Operations: Kitchen Dashboard, Courier Dispatch & Admin Analytics
*Real-time operational command center: Restaurant kitchen live order queue, courier delivery dispatch with GPS navigation, and platform performance monitoring.*

![SamleyGo Multi-Dashboard Operations: Kitchen, Courier Dispatch & Admin](./public/screenshots/samleygo-operations-preview.jpg)

---

## 🌟 Core Highlights & Architectural Principles

- **100% Real Supabase Data**: Zero mock data, zero localhost URLs, zero fake arrays. Every dish, restaurant, customer order, courier status, and payment record queries and persists to Supabase PostgreSQL with strict Row Level Security (RLS).
- **Supabase Realtime Engine**: Immediate push notifications and live UI updates across clients when food items are updated, orders are accepted, or delivery statuses change.
- **Ghana-Localized FinTech & Logistics**:
  - Currency: **Ghana Cedi (GH₵ / GHS)**.
  - Payment Gateways: **MTN Mobile Money (MoMo)**, **Telecel Cash (Vodafone)**, **AT Money (AirtelTigo)**, Card, and **Cash on Delivery (COD)**.
  - Localized Address & Geolocation: Ghana Digital Address (e.g. `GA-183-9024`), landmarks, neighborhood routing across Greater Accra, Kumasi, Takoradi, and nationwide.
- **Progressive Web App (PWA) & TWA Ready**:
  - Installable directly to Android and iOS home screens with custom splash screens and offline service worker caching.
  - Formatted for direct Google Play Store publication as a **Trusted Web Activity (TWA)**.

---

## 👥 Multi-Role User Hierarchy

```
                                  ┌────────────────────────┐
                                  │   Super Administrator  │
                                  │ (Platform Governance)  │
                                  └───────────┬────────────┘
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
        ┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐
        │        Customer        │ │    Restaurant Owner    │ │     Courier Rider      │
        │  (Ordering & Tracking) │ │   (Kitchen & Menus)    │ │ (Dispatch & Delivery)  │
        └────────────────────────┘ └────────────────────────┘ └────────────────────────┘
```

1. **Customer**: Browse menus, live search for Ghanaian cuisine, customize dish notes, manage cart, track order live via status timeline, rate meals.
2. **Restaurant Owner**: Manage restaurant profile, add/edit menu items with prices, categories, and photos, toggle dish availability, receive incoming orders in real time, advance cooking states (`CONFIRMED` ➔ `PREPARING` ➔ `READY_FOR_PICKUP`).
3. **Courier Rider**: View available ready orders nearby, accept delivery assignments, view pickup and customer drop-off routes, call customer/restaurant, advance status (`OUT_FOR_DELIVERY` ➔ `DELIVERED`), track cumulative GHS earnings.
4. **Super Admin**: Approve restaurants and couriers, monitor active orders across all cities, inspect platform commission, audit transaction logs.

---

## 🔄 End-to-End System Workflows

### Workflow 1: Authentication & Role-Based Access Control (RBAC)

```
[User Visits SamleyGo]
       │
       ├─► Unauthenticated: Can freely search dishes, explore restaurants, view menus
       │
       └─► Sign In / Register (/login, /register)
              │
              ├── Authenticates via Supabase Auth (email/password)
              ├── Retrieves role from `public.profiles` (`CUSTOMER`, `RESTAURANT_OWNER`, `COURIER`, `SUPER_ADMIN`)
              └── Routes user dynamically to their dedicated dashboard:
                     • Customer         ➔ / (Home) or /restaurants
                     • Restaurant Owner ➔ /restaurant/dashboard
                     • Courier          ➔ /courier/dashboard
                     • Super Admin      ➔ /admin/dashboard
```

#### Courier onboarding — two-section registration

Courier sign-up is split into two sequential sections (customers and kitchens keep the single-section form):

```
[COURIER SELECTED]
   │
   ├── SECTION 1 · Account Details
   │      • Full name, email, Ghana phone number (+233), password
   │      • Validated inline, then "Continue to Verification"
   │
   └── SECTION 2 · Identity & Vehicle Verification
          • Vehicle type + vehicle number plate (e.g. GR-1234-24)
          • Ghana Card ID number (PIN, GHA-123456789-2)
          • Ghana Card photo — FRONT  ┐ compressed in-browser, uploaded to the
          • Ghana Card photo — BACK   ┘ PRIVATE `courier-documents` bucket
          • Driving licence ID number
          • "Submit for Verification" ➔ account created, documents queued for review
```

- Section 1 data is captured as Supabase Auth **user metadata**, so a database trigger (`handle_new_user`) writes the courier row and identity numbers even if the browser never gets a session.
- Section 2 documents are upserted into `public.courier_documents` (the single RLS-protected store for national ID data) and the courier lands with `verification_status = 'PENDING'`.
- The courier cannot go **ONLINE** until a super admin approves them from the admin dashboard — approval flips `is_approved` / `verification_status` and propagates instantly over Supabase Realtime.

- Passwords and auth tokens are secured using Supabase GoTrue authentication.
- Navigation guards (`<ProtectedRoute allowedRoles={[...]} />`) restrict unauthorized access both on client routes and via PostgreSQL Row Level Security (RLS) policies at the database layer.

---

### Workflow 2: Realtime Food & Kitchen Discovery Search

```
User enters query: "Waakye" or "Jollof"
       │
       ├─► Instant Multi-Query to Supabase:
       │      1. `public.menu_items`: Matches dish name OR description (ilike '%query%')
       │      2. `public.restaurants`: Matches name, cuisine type, or address
       │
       ├─► Supabase Realtime Channel Subscription:
       │      • Listens for INSERT, UPDATE, DELETE on `menu_items` and `restaurants`
       │      • If a restaurant changes price or toggles availability, UI updates live without refresh
       │
       └─► Instant Categorized Display:
              ├── "Dishes & Food" tab (direct "Add to Order" with price in GHS)
              └── "Kitchens & Restaurants" tab (opening hours, rating, delivery time)
```

---

### Workflow 3: Order Placement & Checkout Workflow

```
Customer adds items from Restaurant A
       │
       ├─► Cart Validation:
       │      • Enforces single-restaurant ordering (prevents mixing dishes from different kitchens)
       │      • Calculates subtotal, delivery fee (GH₵), and packaging/service charges
       │
       ├─► Checkout Form (/checkout):
       │      • Captures Delivery Address & Ghana Digital Address
       │      • Browser Geolocation integration to pin customer GPS coordinates
       │      • Customer phone number for delivery updates
       │      • Special cooking notes (e.g., "Extra shito on the side", "Mild pepper")
       │      • Selects Payment Method: MTN MoMo, Telecel Cash, AT Money, or Cash on Delivery
       │
       └─► Supabase Atomic Transaction:
              • Inserts record into `public.orders` with unique `order_number` (e.g. `SLG-84920`)
              • Inserts items into `public.order_items`
              • Inserts initial entry into `public.order_status_history` (`PENDING`)
              • Emits Realtime Postgres event to kitchen
```

---

### Workflow 4: Kitchen Order Fulfillment Lifecycle

```
[Order Placed by Customer]
       │
       ▼ (Supabase Realtime triggers sound & notification on Kitchen Dashboard)
[Status: PENDING] ────► Restaurant reviews items & special cooking requests
       │
       ├── Accept Order ────► [Status: CONFIRMED]
       │                            │
       │                            ▼
       │                     Kitchen begins preparation ────► [Status: PREPARING]
       │                                                            │
       │                                                            ▼
       │                     Food packed and ready ─────────► [Status: READY_FOR_PICKUP]
       │                                                            │
       └── Reject Order ────► [Status: CANCELLED]                   │
                                                                    ▼
                                                       Notifies Couriers in Area
```

---

### Workflow 5: Courier Dispatch & Delivery Execution

```
[Order reaches READY_FOR_PICKUP]
       │
       ▼
Broadcasted in real-time to active, online couriers (`public.couriers.availability_status = 'AVAILABLE'`)
       │
       ├─► Courier views distance, pickup restaurant, customer drop-off area, and delivery fee
       │
       ├─► Courier clicks [Accept Delivery]:
       │      • Updates `orders.courier_id` to current courier's UUID
       │      • Updates courier status to `ON_DELIVERY`
       │      • Customer receives realtime notification: "Courier Assigned"
       │
       ├─► Courier arrives at Restaurant & picks up package:
       │      • Clicks [Confirm Pickup]
       │      • Order transitions to [Status: OUT_FOR_DELIVERY]
       │
       ├─► Courier en route to Customer:
       │      • Realtime location coordinates stream to `public.delivery_locations`
       │      • Quick-dial button to contact customer or restaurant
       │
       └─► Courier reaches drop-off point:
              • Hands order to customer, collects MoMo/COD if applicable
              • Clicks [Mark as Delivered]
              • Order transitions to [Status: DELIVERED]
              • Delivery earnings in GHS automatically credited to `public.courier_earnings`
              • Courier status resets to `AVAILABLE` for the next dispatch
```

---

### Workflow 6: Customer Live Order Tracking

```
Customer views /orders/:id
       │
       ├─► Real-time 6-Step Visual Timeline:
       │      ① Order Placed (PENDING)
       │      ② Confirmed by Restaurant (CONFIRMED)
       │      ③ Preparing in Kitchen (PREPARING)
       │      ④ Ready for Pickup (READY_FOR_PICKUP)
       │      ⑤ Courier on the Way (OUT_FOR_DELIVERY)
       │      ⑥ Delivered Safely (DELIVERED)
       │
       ├─► Live Courier Information Card:
       │      • Courier name, vehicle type (Motorcycle/Bicycle), plate number, and phone link
       │
       └─► Review & Rating:
              • Post-delivery star rating and feedback saved directly to `public.reviews`
```

---

### Workflow 7: Courier & Restaurant Earnings Settlement

```
Delivered Order (e.g. Subtotal: GH₵ 120.00 | Delivery: GH₵ 18.00)
       │
       ├── Restaurant Account:
       │      • Gross: GH₵ 120.00
       │      • Platform Commission (e.g. 15%): -GH₵ 18.00
       │      • Net Kitchen Payout: GH₵ 102.00
       │
       └── Courier Account:
              • Delivery Fee: GH₵ 18.00
              • Customer Tip: GH₵ 5.00
              • Total Rider Credit: GH₵ 23.00
```

---

### Workflow 8: Super Admin Platform Oversight

```
Super Admin Dashboard (/admin/dashboard)
       │
       ├── Restaurant Management:
       │      • Review pending merchant applications
       │      • Verify business certificates & hygiene permits
       │      • Approve / Suspend restaurant stores
       │      • Adjust custom commission rates per vendor
       │
       ├── Courier Verification:
       │      • Inspect uploaded Ghana Card IDs & rider licenses
       │      • Approve or reject courier onboarding
       │
       └── Platform Analytics & Audit:
              • Gross Merchandise Value (GMV) in GHS
              • Realtime active delivery count across all zones
              • System health and dispute resolution
```

---

## 🗄️ Database Schema & Relationships

All tables are defined in PostgreSQL via Supabase migrations (`/supabase/migrations/20260925_samleygo_schema.sql` + `/supabase/migrations/20260925_courier_verification.sql` + `/supabase/migrations/20260925_super_admin_protection.sql`):

| Table Name | Description | Key Relationships |
| :--- | :--- | :--- |
| `public.profiles` | Unified user profile for all roles | `references auth.users(id)` |
| `public.customers` | Customer delivery addresses and GPS coordinates | `references profiles(id)` |
| `public.restaurants` | Food vendor info, opening hours, ratings, and commission | `owner_id ➔ profiles(id)` |
| `public.restaurant_categories` | Menu sections (e.g., Soups, Swallows, Rice, Drinks) | `restaurant_id ➔ restaurants(id)` |
| `public.menu_items` | Dishes, prices (GHS), descriptions, prep times, availability | `restaurant_id ➔ restaurants(id)` |
| `public.couriers` | Courier vehicles, plate, GPS coordinates and **verification status** (`UNSUBMITTED ➔ PENDING ➔ APPROVED/REJECTED`) | `id ➔ profiles(id)` |
| `public.courier_documents` | RLS-protected identity store: Ghana Card PIN (front/back photos), licence ID, insurance, roadworthy | `courier_id ➔ couriers(id)` (unique per `document_type`) |
| `public.orders` | Master orders table, status, payment method, delivery coordinates | `customer_id`, `restaurant_id`, `courier_id` |
| `public.order_items` | Individual dishes and quantities within an order | `order_id ➔ orders(id)`, `menu_item_id` |
| `public.order_status_history` | Audit trail of all state transitions and timestamps | `order_id ➔ orders(id)` |
| `public.delivery_locations` | Realtime courier GPS breadcrumb coordinates | `order_id ➔ orders(id)`, `courier_id` |
| `public.payments` | MoMo, card, or cash transaction records | `order_id ➔ orders(id)` |
| `public.reviews` | Customer ratings (1-5 stars) and feedback comments | `order_id`, `restaurant_id`, `customer_id` |

---

## 🚀 Getting Started & Local Development

### 1. Prerequisites
- Node.js 18+ or 20+
- A Supabase Project ([supabase.com](https://supabase.com))

### 2. Environment Setup
Copy the example environment configuration:

```bash
cp .env.example .env
```

Fill in your real Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3. Database Migration
Run these SQL scripts, **in order**, inside the **Supabase SQL Editor**:

1. `supabase/migrations/20260925_samleygo_schema.sql` — bootstrap all tables, relationships and Row Level Security policies (fresh projects).
2. `supabase/migrations/20260925_courier_verification.sql` — courier identity verification (Ghana Card, licence, number plate). Fully idempotent: safe to run on an already-bootstrapped or live database, and required if your project predates the two-section courier sign-up.
3. `supabase/migrations/20260925_super_admin_protection.sql` — role-change guard so only a super admin can grant the `SUPER_ADMIN` role (the profiles update policy alone did not prevent self-promotion).
4. `supabase/migrations/20260927_signup_repair.sql` — **signup repair**: replaces `handle_new_user()` with a version that pins its `search_path`, schema-qualifies every object, is null-safe on the `NOT NULL` profile columns, and can never block a registration (failures are logged to `public.signup_debug` instead of aborting the `auth.users` insert). Also records a before/after probe of the trigger so the original error is captured verbatim.
5. `supabase/migrations/20260929_courier_avatar.sql` — **profile photos**: public `avatars` Storage bucket (each user can only write inside their own folder) plus a `supabase_realtime` publication entry for `public.profiles`, so a courier uploading a rider photo reaches the customer's live order card and the restaurant's dispatch board immediately.
6. `supabase/migrations/20260930_reviews_ratings.sql` — **customer reviews**: row level security policies for `public.reviews` (it had RLS enabled with zero policies, so every submit was rejected while the app still said "recorded"), one review per order per customer, a `refresh_review_ratings()` trigger that recomputes `restaurants.rating` / `restaurants.total_reviews` and `couriers.rating`, and a backfill of the current averages. Without this the rate form, the kitchen's *Customer Rating* card and the courier's rating never move.
7. `supabase/migrations/20261004_payment_commission_model.sql` — **payments & restaurant commission**: the `commission` settings, the `apply_order_financials()` trigger that writes each order's money snapshot (commission on the **food subtotal only**), the settlement lifecycle and the append-only refund adjustments. Required before step 8 — delivery pricing reads the same settings tables but never touches commission.
8. `supabase/migrations/20261005_distance_delivery_pricing.sql` — **distance-based delivery pricing**: `haversine_km()`, `delivery_pricing_amounts()` (the `base + (km × rate)` formula with its floor and optional cap), the short-lived `delivery_quotes` table (5-minute TTL, server-created only) plus `create_delivery_quote()` and `set_delivery_pricing()`. `apply_order_financials()` now validates the customer's coordinates (raising *"Please select a valid delivery location to calculate your delivery fee."* when there is none), consumes a live quote — recalculating it server-side if it is missing, expired or for another customer/restaurant — and snapshots `delivery_distance_km`, `delivery_fee`, `courier_earning` and `delivery_pricing_version` onto the order. Historical orders are never re-priced. A Super Admin saves pricing from **Settings → Delivery Pricing**, which calls the RPC (it validates, bumps `pricing_version` and keeps courier commission in sync at `100 − earning`).

9. `supabase/migrations/20261011_courier_location_rls.sql` — **courier live-position privacy**: the `couriers` SELECT policy is narrowed to the courier themselves, a super admin and the participants of their live order (through `courier_order_participant()`), and `courier_driver_directory()` is introduced so restaurant dispatch can enumerate riders without reading raw GPS rows. Run before step 10.

10. `supabase/migrations/20261012_errands_module.sql` — **Errands & On-Demand Rides**: the whole on-demand module, server-owned end to end. Service switches (`errands_config`: motorcycle errands ON by default, passenger rides OFF until an operator approves them), pricing rule storage (`errands_pricing`: versioned, and refusing to quote until a Super Admin saves it — the fare formula shipped here is superseded by step 13, the current engine), and the tables `driver_service_capabilities`, `errands_quotes` (5-minute TTL), `errands_bookings` + `errands_booking_details` (exact coordinates/addresses and contacts, revealed to the driver only *after* they accept), `errands_status_history` and `errands_booking_pins` (the passenger trip PIN, readable by the customer and Super Admin only — the driver submits it but can never query it). All money, eligibility and status decisions live in SECURITY DEFINER RPCs: `errands_nearby_drivers()` (one shared eligibility function also re-checked at booking time), `create_errands_quote()`, `create_errands_booking()` (locks the driver row so two customers racing for the same rider produce exactly one winner), `errands_set_booking_status()` (validated REQUESTED → DRIVER_ACCEPTED → DRIVER_ARRIVING → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED lifecycle plus CANCELLED/EXPIRED/FAILED, with the PIN check for passenger rides), `errands_expire_stale_bookings()` and the admin setters. Restaurant dispatch can no longer see a driver who is mid-Errand, and an accepted customer can read exactly one courier row — their own driver's, while the booking is live. Admins manage it from **Errands & Rides** in the dashboard; drivers opt in from the courier app; customers book from the **Book an Errand** button on the home screen.

11. `supabase/migrations/20261012_errands_per_distance_pricing.sql` — **strictly per-distance Errands pricing**: the fare becomes a pure function of the route the customer travels — `trip fare = distance × per-km rate × surge`, tax as a percentage of that fare, the driver's share as a percentage of the total, with **no base fare, no booking fee, no floor and no cap anywhere** (two trips cost the same only when they cover the same road distance). It rewrites `get_errands_pricing_settings()` and `errands_pricing_amounts()` — which now *refuses* any rule set without a positive per-km rate (the honest "not configured" message, never a free trip) — replaces `set_errands_pricing()` with a five-argument signature (per-km rate, tax %, driver earning %, surge, per-service per-km overrides) after dropping the nine-argument original, drops `base_fare`/`min_fare`/`max_fare`/`booking_fee` from the `errands_quotes` snapshot, rewrites `create_errands_quote()` and normalises any stored rules (dead keys stripped, `configured` forced `false` when no positive per-km rate exists). The customer's quote breakdown shows the multiplication (`2.43 km × GH₵2.50/km`) and the admin fare card previews the same numbers; `supabase/tests/errands_module_checks.sql` verifies the formula. Run after step 10. **Superseded in turn by step 13**, which is the engine customers are quoted with today.

12. `supabase/migrations/20261012_order_history_deletion.sql` — **customer-managed order history (soft delete)**: adds `customer_deleted_at` to `orders` and `errands_bookings`, narrows only the *customer's* branch of both SELECT policies so a removed row disappears from that customer's list alone (courier, restaurant, driver, dispatch and Super Admin still see it), and introduces two SECURITY DEFINER RPCs — `delete_customer_order()` and `delete_customer_errands_booking()`. They re-check ownership and terminal status server-side (food: DELIVERED/COMPLETED/CANCELLED/REJECTED/FAILED; Errands: COMPLETED/CANCELLED/EXPIRED/FAILED) and flip exactly one column: an in-flight order or trip can never vanish, and **no write policy** is granted — receipts, commission, settlement and audit records stay intact. Past errands are listed on the Orders screen; `supabase/tests/order_history_deletion_checks.sql` verifies all of it. Run after step 10.

13. `supabase/migrations/20261013_errands_fare_engine.sql` — **automatic, distance-based Errands fares (the current engine)**: the quote is now priced by a real road route and a versioned, per-service price list. New table `errands_pricing_rules` (one **active** row per category via a partial unique index — `ERRAND_MOTORCYCLE`, `CAR_ERRAND`, `RIDE_CAR` — each with base fare, per-km rate, floor, ceiling, booking fee, waiting and time charges, surge, tax, discount, driver/platform split, currency, `effective_from` and `pricing_version`; no INSERT/UPDATE/DELETE policy, no table grant to `anon`, written only through `set_errands_pricing_rules()` which bumps the version, retires the previous row and writes an `audit_logs` entry). The fare itself is `errands_fare_amounts()` — deterministic, computed in **integer pesewas** (`distance = km × rate`, `trip = base + distance + time + waiting`, × surge only when it is switched on, + booking fee, clamp floor then ceiling, − discount, + tax; driver = % of what the customer pays, platform = the rest) and **service-role only**; a rule set with no money in it raises the "not configured" message instead of quoting GH₵0.00. `create_errands_quote()` is rewritten (11 arguments, **service-role only** — the browser cannot call it at all): it validates coordinates and the service area, refuses a missing route or a distance outside 0.90×–3.0× the crow-fly distance (never a straight-line fallback, never an invented distance), rate-limits per customer, prices with the **active rule for that category**, snapshots the whole breakdown plus `pricing_rules_id` into `errands_quotes`, and returns an expiry. `create_errands_booking()` is rewritten: it re-checks the quote's owner and expiry, locks the driver row (`FOR UPDATE`), consumes the quote in the same transaction (single use), re-prices under the rules that are active *now* and raises *"The fare changed while you were reviewing it…"* if the price moved — an approved fare is never silently replaced. Also here: the third service category **`CAR_ERRAND`** (switched **OFF** by default, 4-argument `set_errands_config()`), the `car_errands` column on `driver_service_capabilities` (granted by a Super Admin only) with eligibility that requires a `Car`/`Van`, and `errands_in_service_area()` (Ghana defaults, overridable through `platform_settings.errands_service_area`). The customer's quote card shows pickup, destination, routed distance, duration, each enabled charge, the discount and the estimated total in GH₵; the admin screen edits one category at a time under **Settings → Errands → Fare rules** with a live preview. This supersedes step 11's formula (that migration still runs and keeps its legacy function for reference, but no quote is priced with it any more). Run after steps 10–12; `supabase/tests/errands_fare_checks.sql` verifies it end to end.

14. `supabase/migrations/20261014_errands_booking_payment_method.sql` — **recording how the customer will pay**: adds `payment_method text not null default 'CASH'` to `errands_bookings` with a `CHECK` limited to the same five tenders the food checkout already accepts (`CASH`, `MTN_MOMO`, `TELECEL_CASH`, `AT_MONEY`, `CARD`), and installs a thin third overload of `create_errands_booking(p_quote_id, p_driver_id, p_payment_method)` (`SECURITY DEFINER`, `search_path` pinned) which simply calls the existing two-argument booking function and then updates **only the caller's own row** — the booking body (driver lock, single-use quote, re-pricing, lifecycle insert) is reused, never duplicated, and no money is accepted here: the tender is recorded for the driver panel and the receipt. The RPC returns the booking row as JSON, so `payment_method` flows through automatically. The client sends the three arguments and falls back to the two-argument call if this migration has not been run yet, so an un-migrated database still books. Run after step 13.

#### Deploy the Errands quote function (required for step 13)

Quotes are measured **server-side**: the browser posts addresses only, and the Edge Function routes them before asking the database for a price.

```bash
supabase functions deploy errand-quote
supabase secrets set GOOGLE_MAPS_SERVER_API_KEY=your-google-routes-server-key
```

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically — never put the service-role key in a `VITE_…` variable, and never in this repository.
- `GOOGLE_MAPS_SERVER_API_KEY` is a **server** key (restrict it to the Routes API; HTTP referrer restrictions do not apply to server calls). Without it the function falls back to the project's existing OSRM provider, so routing still works — with it, Google Routes is used first. Either way the routing key never reaches the browser; the map only needs a referrer-restricted (restricted) `VITE_…` rendering key.
- The function verifies the caller's JWT, rate-limits, refuses an unroutable trip with `ROUTE_UNAVAILABLE` and an honest message, and calls `create_errands_quote()` with the service role. Without it deployed, customers see *"Fare calculation is unavailable right now."* instead of a price — which is the intended failure mode: **no price is ever invented**.

All scripts are idempotent and create:

- `courier-documents` — a **private** Storage bucket for Ghana Card front/back photos (accessible only through signed URLs minted by the owning courier or a super admin),
- `avatars` — a **public** Storage bucket for profile photos (courier rider photos are rendered with a plain `<img src>` by customers and restaurants during a delivery),
- RLS policies on `public.courier_documents` (owner + super admin only),
- realtime publication entries for `public.couriers` and `public.courier_documents` so verification status changes push live to the courier and admin dashboards,
- a realtime publication entry for `public.profiles` so avatar/name/phone changes push live to the customer's order screen and the restaurant's dispatch board.

### 4. Install Dependencies & Launch
```bash
npm install
npm run dev
```

The web application runs at `http://localhost:3000`.

### Tests
```bash
npm test            # commission, delivery, errands, fare engine, navigation & marker suites
npm run test:fare   # just the Errands fare-engine acceptance suite
npm run lint        # TypeScript type check (tsc --noEmit)
```

`scripts/commission.test.ts` locks down checkout totals, the 15%-of-food-only restaurant commission, the 0% courier commission and the settlement lifecycle. `scripts/delivery_pricing.test.ts` locks down the distance pricing: the worked example (8 km ⇒ GH₵21 delivery, GH₵100 food ⇒ GH₵121 total, courier earns GH₵21, restaurant commission GH₵15 ⇒ GH₵85 net), the floor/optional-cap clamps, 2-decimal rounding, the 5-minute quote lifecycle, the delivery reporting aggregates, and source scans proving the browser never posts a price (it posts a `delivery_quote_id` instead). `scripts/errands_pricing.test.ts` locks down the Errands & Rides module: the fare formula's client mirror, the quote TTL, the status-transition map mirrored one-for-one from the migration, and source scans proving the browser never posts money or coordinates. `scripts/errands_fare_engine.test.ts` is the fare-engine acceptance matrix — distance charge, floor/ceiling, whole-pesewa rounding (including the `2.675 ⇒ 2.68` float artefact), per-vehicle rule sets and eligibility, every optional fee, disabled surge, missing configuration, and source scans for the rest of the contract: no route ⇒ no quote, the browser never measures a distance, expired quotes are refused, booking posts IDs only and is re-priced under current rules, one eligibility function for discovery and booking, the `FOR UPDATE` driver lock with a single-use quote, and versioned rules snapshotted into each quote. `scripts/errands_ride_ui.test.ts` is the booking-screen contract: the service list offers exactly the categories the backend prices (no invented option), the button names the chosen service, there is no promotional strip and no hardcoded sample fare, the vehicle art is self-contained SVG, pickup ETAs and arrival clocks are measurements or nothing, pricing is automatic with a real retry, the sheet keeps a fixed footer and one drag zone with its heights owned by CSS, payment is limited to the five tenders the platform records and travels through the secure RPC, scheduling and the add-stop control say plainly that they are not supported, and the location bar's close button never touches a booking. The SQL side is verified by `supabase/tests/errands_module_checks.sql` and `supabase/tests/errands_fare_checks.sql` (both roll back — safe on any database).

### 5. Super Admin Access
`/admin/dashboard` is gated by `ProtectedRoute allowedRoles={['SUPER_ADMIN']}` **and** by `profiles.role` in PostgreSQL.

Platform operators are provisioned **without any credentials stored in this repository**: Supabase Dashboard → Authentication → Users → **Add user**, and set the user's metadata to `{"role": "SUPER_ADMIN"}`. The `on_auth_user_created` trigger (`handle_new_user`) then writes the matching `profiles` row with that role, which is the only value `ProtectedRoute` and the RLS policies read. Alternatively create the user normally and promote it from the SQL Editor:

```sql
update public.profiles set role = 'SUPER_ADMIN'
 where lower(email) = 'operator@example.com';
```

The `protect_profile_role` trigger blocks role changes made *from inside the app*, but allows this session-less SQL call. Verify with `select role from public.profiles where lower(email) = 'operator@example.com';` (`role = SUPER_ADMIN`), then sign in at `/login` — a super admin is routed straight to `/admin/dashboard`.

> **Troubleshooting:** if the password grant returns `500: Database error querying schema`, the account's `auth.users` token columns (`confirmation_token`, `recovery_token`, `email_change`, …) are `NULL` — GoTrue rejects the whole request when any of them is null. Set them to `''` and make sure `email_confirmed_at` is populated.

> **Troubleshooting — `Database error saving new user` on `/register`:** every sign-up (customer, kitchen, courier) fails with HTTP 500 `unexpected_failure`, and no `profiles` row is ever written. The cause is the `on_auth_user_created` trigger: `handle_new_user()` declared `user_role_val user_role` without pinning `search_path`, so whenever the auth service's session cannot resolve `public.user_role` the entire `auth.users` insert rolls back. Fix: run `supabase/migrations/20260927_signup_repair.sql` in the SQL Editor. It snapshots the current trigger (owner, `security definer`, `set`, full source), reproduces the failure under two `search_path`s, installs the hardened replacement and verifies both probes return `SUCCESS`. Afterwards, anything the repaired trigger had to swallow is readable with `select kind, detail, recorded_at from public.signup_debug order by recorded_at desc;` (signed-in users only).

---

## 📲 Publishing SamleyGo to Google Play Store (TWA)

SamleyGo is configured as a Progressive Web App (PWA) with full offline support, service workers, and compliant web app manifests, making it ready to be published to the Google Play Store as a **Trusted Web Activity (TWA)**:

### Step 1: Deploy Web Application
Deploy your production build to your hosting provider (e.g. Vercel, Netlify, Cloud Run) with HTTPS enabled.

### Step 2: Generate Android App Bundle (.aab)
1. Go to [PWABuilder](https://www.pwabuilder.com/).
2. Enter your production URL (e.g., `https://samleygo.com`).
3. Click **Package for Android (TWA)**.
4. Set package name (e.g., `com.samleygo.app`), app name (`SamleyGo`), and download your signed `.aab` package and signing keys.

### Step 3: Link Digital Asset Links
Upload your `assetlinks.json` file to:
```
https://your-production-domain.com/.well-known/assetlinks.json
```
This verifies your domain ownership to Android so the app runs full-screen without a browser address bar.

### Step 4: Submit to Google Play Console
1. Open the [Google Play Console](https://play.google.com/console).
2. Create a new App: **SamleyGo Food Delivery**.
3. Upload the generated `.aab` bundle to the **Production** or **Closed Testing** track.
4. Add store listing descriptions, icon (`public/pwa-512x512.png`), feature graphic, and screenshots.
5. Submit for Google review (typically 24–72 hours).

---

## 🛡️ Security & Privacy
- **Row Level Security (RLS)**: Enforced across all tables in PostgreSQL. Customers can only view their own orders; restaurants can only view orders placed at their establishment; couriers can only view available or assigned runs.
- **Client Secrets Protection**: No service-role key or private credentials exist on the frontend.
- **Compliant Terms & Privacy**: Dedicated legal routes implemented at `/terms` and `/privacy`.

---

© 2026 SamleyGo. Crafted for Ghana's vibrant food ecosystem.
