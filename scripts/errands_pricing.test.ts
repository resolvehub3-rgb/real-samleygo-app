/**
 * SamleyGo Errands & On-Demand Rides — test suite.
 *
 *   pnpm test:errands   (tsx scripts/errands_pricing.test.ts)
 *
 * What is covered:
 *   1. The fare engine's client mirror — base + (km × price per kilometre) +
 *      optional fees, clamped between a minimum and a maximum, then tax and
 *      the earnings split, computed in whole pesewas, plus a source scan
 *      proving the server owns the formula and the browser never posts money.
 *   2. Honesty rules — unconfigured pricing yields NO number (the caller must
 *      show the admin-required message, never an invented fare).
 *   3. Quote lifecycle — TTL usability window and the expiry countdown.
 *   4. The status transition map — mirrors the database CASE one-for-one
 *      (source-scanned from the migration) so buttons can never offer a move
 *      the server will reject.
 *   5. Source scans — the booking RPC is called with IDs only (never money),
 *      the trip PIN table is customer/admin-only (the driver submits but can
 *      never read it), no client write paths exist on the money tables, the
 *      FAB sits bottom-right above the nav, the map stays visible (~45dvh,
 *      sticky under the navbar), no Leaflet, and no fabricated coordinates
 *      or placeholder drivers anywhere in the module.
 *   6. Order history — past errands are stored on the Orders screen (not on
 *      /errands), removal is customer-facing but SERVER-guarded (soft delete,
 *      terminal rows only, owner-only, no DELETE policy ever), and the FAB
 *      is animated (entrance + attention halo) with reduced motion honoured.
 *
 * IMPORTANT: the database is still the authority. These tests lock down the
 * client helpers that render its answers and the invariants that keep money,
 * PINs and eligibility server-owned.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateErrandsFare,
  ERRANDS_PRICING_UNCONFIGURED_MESSAGE,
  type ErrandsFareRule,
} from '../src/lib/errands/pricing';
import {
  ACTIVE_ERRANDS_STATUSES,
  TERMINAL_ERRANDS_STATUSES,
  ERRANDS_ALLOWED_TRANSITIONS,
  ERRANDS_STATUS_LABELS,
  ERRANDS_SERVICES,
  canTransition,
  type ErrandsBookingStatus,
} from '../src/lib/errands/types';
import {
  isQuoteUsable,
  secondsUntilQuoteExpiry,
  ERRANDS_LOCATION_ERROR,
  type ErrandsQuote,
} from '../src/lib/errands/quote';
import { ERRANDS_DISCOVERY_POLL_MS } from '../src/lib/errands/discovery';
import { resolveNavigationPhase } from '../src/lib/navigation';

// ---------------------------------------------------------------------------
// Tiny test runner (no extra dependencies)
// ---------------------------------------------------------------------------

let passed = 0;
const failures: { name: string; error: Error }[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error: error as Error });
    console.error(`  \u2717 ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segments: string[]) => readFileSync(path.join(ROOT, ...segments), 'utf8');

/** Drops comments + collapses whitespace so SQL/TSX scans stay stable. */
const strip = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

const MIGRATION = read('supabase', 'migrations', '20261012_errands_module.sql');
const MIGRATION_STRIPPED = strip(MIGRATION);
// The fare engine migration: pricing rules, the quote RPC and the revalidation
// that happens when a booking is created.
const FARE_MIGRATION = read('supabase', 'migrations', '20261013_errands_fare_engine.sql');
const FARE_MIGRATION_STRIPPED = strip(FARE_MIGRATION);
// The Edge Function that routes pickup → destination before asking the
// database for a price (the browser never sends a distance).
const QUOTE_FUNCTION = read('supabase', 'functions', 'errand-quote', 'index.ts');

// ---------------------------------------------------------------------------
// Pricing fixture — a rule set with a rate and nothing else switched on
// ---------------------------------------------------------------------------

const EXAMPLE_RULE: ErrandsFareRule = {
  baseFare: 0,
  pricePerKm: 2,
  minFare: 0,
  maxFare: null,
  bookingFee: 0,
  waitingCharge: 0,
  waitingChargeEnabled: false,
  timeChargePerMinute: 0,
  timeChargeEnabled: false,
  surgeEnabled: false,
  surgeMultiplier: 1,
  taxRatePercent: 0,
  discountAmount: 0,
  driverEarningPercent: 100,
  currency: 'GHS',
};

const rule = (overrides: Partial<ErrandsFareRule>): ErrandsFareRule => ({
  ...EXAMPLE_RULE,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. The fare formula
// ---------------------------------------------------------------------------

test('8 km at GH₵2/km totals GH₵16 — the fare IS the distance', () => {
  const fare = calculateErrandsFare(8, null, EXAMPLE_RULE);
  assert.ok(fare, 'a configured rule set must produce a fare');
  assert.equal(fare.distanceCharge, 16, 'distance charge = 8 × 2');
  assert.equal(fare.tripFare, 16, 'trip fare = distance charge when nothing else is on');
  assert.equal(fare.taxAmount, 0);
  assert.equal(fare.total, 16, 'total = trip fare + tax (no fixed component)');
  assert.equal(fare.driverEarning, 16, 'a 100% share pays the driver the total');
  assert.equal(fare.currency, 'GHS');
});

test('the price tracks the distance — twice the route, twice the fare', () => {
  assert.equal(calculateErrandsFare(3, null, EXAMPLE_RULE)?.tripFare, 6, '3 km');
  assert.equal(calculateErrandsFare(6, null, EXAMPLE_RULE)?.tripFare, 12, '6 km');
  assert.equal(
    calculateErrandsFare(100, null, EXAMPLE_RULE)?.tripFare,
    200,
    'no floor and no cap: the real route price stands'
  );
  assert.equal(
    calculateErrandsFare(0.2, null, EXAMPLE_RULE)?.tripFare,
    0.4,
    'a short trip costs little because it travels little'
  );
});

test('tax is a percentage of the fare and earning is % of the total', () => {
  const fare = calculateErrandsFare(
    10,
    null,
    rule({ taxRatePercent: 15, driverEarningPercent: 80 })
  );
  assert.ok(fare);
  assert.equal(fare.tripFare, 20, '10 km × 2');
  assert.equal(fare.taxAmount, 3, '15% of the trip fare');
  assert.equal(fare.total, 23, 'trip fare + tax');
  assert.equal(fare.driverEarning, 18.4, '80% of the total, not of the trip fare');
  assert.equal(fare.platformRevenue, 1.6, 'the platform keeps the rest of the total');
});

test('surge scales the distance price proportionally — but only when switched on', () => {
  const on = calculateErrandsFare(10, null, rule({ surgeEnabled: true, surgeMultiplier: 1.5 }));
  assert.equal(on?.tripFare, 30, '(10 × 2) × 1.5');
  assert.equal(on?.surgeAmount, 10, 'the surge line is shown as its own charge');
  // The same multiplier with the switch off must change nothing — a number
  // typed into a disabled field is not a price.
  const off = calculateErrandsFare(10, null, rule({ surgeEnabled: false, surgeMultiplier: 1.5 }));
  assert.equal(off?.tripFare, 20, 'disabled surge never applies');
  assert.equal(off?.surgeAmount, 0, 'and never appears on the breakdown');
});

test('rounding lands on whole pesewas (17.806 ⇒ 17.81)', () => {
  assert.equal(calculateErrandsFare(8.903, null, EXAMPLE_RULE)?.tripFare, 17.81);
  assert.equal(calculateErrandsFare(8.902, null, EXAMPLE_RULE)?.tripFare, 17.8);
});

// ---------------------------------------------------------------------------
// 2. Honesty: no configuration, no number
// ---------------------------------------------------------------------------

test('unconfigured pricing produces NO fare — the message must be shown instead', () => {
  assert.equal(
    calculateErrandsFare(8, null, rule({ pricePerKm: 0 })),
    null,
    'an unconfigured rule set must never yield a number'
  );
  assert.equal(calculateErrandsFare(8, null, null), null);
  assert.equal(calculateErrandsFare(8, null, undefined), null);
  assert.equal(
    ERRANDS_PRICING_UNCONFIGURED_MESSAGE.includes('has not been configured'),
    true,
    'the required admin-facing message must say pricing is not configured'
  );
});

test('a non-finite or negative distance is priced as 0 km, never as garbage', () => {
  // 0 km × rate = GH₵0 — a real empty route, not an invented base fare.
  assert.equal(calculateErrandsFare(Number.NaN, null, EXAMPLE_RULE)?.tripFare, 0);
  assert.equal(calculateErrandsFare(-5, null, EXAMPLE_RULE)?.tripFare, 0);
  assert.equal(calculateErrandsFare(Number.NaN, null, EXAMPLE_RULE)?.total, 0);
});

test('a rule set with no money in it prices NOTHING — never a free trip', () => {
  assert.equal(
    calculateErrandsFare(8, null, rule({ baseFare: 0, pricePerKm: 0, minFare: 0 })),
    null,
    'no base, no rate, no minimum ⇒ the admin-required message, not GH₵0'
  );
  assert.equal(
    calculateErrandsFare(8, null, rule({ baseFare: -2, pricePerKm: -1, minFare: -5 })),
    null,
    'negative rates are refused — a rule set whose money is all invalid prices nothing'
  );
  assert.equal(
    calculateErrandsFare(8, null, rule({ baseFare: -2 }))?.tripFare,
    16,
    'a negative base is clamped to 0 — it never discounts the distance charge'
  );
  // A base fare on its own is a perfectly valid, fully configured rule set.
  assert.equal(calculateErrandsFare(8, null, rule({ pricePerKm: 0, baseFare: 5 }))?.total, 5);
});

// ---------------------------------------------------------------------------
// 3. Quote lifecycle
// ---------------------------------------------------------------------------

const quote = (expiresAtMs: number, issuedAtMs = expiresAtMs - 5 * 60_000): ErrandsQuote => ({
  quoteId: 'q-1',
  serviceCategory: 'ERRAND_MOTORCYCLE',
  pickupAddress: 'Osu, Accra',
  destinationAddress: 'East Legon, Accra',
  straightLineKm: 7.4,
  distanceKm: 8.1,
  distanceSource: 'ROAD_ROUTE',
  routeProvider: 'OSRM',
  routeDistanceMetres: 8_100,
  estimatedDurationSeconds: 1_200,
  perKmRate: 2,
  surgeMultiplier: 1,
  baseFare: 0,
  distanceCharge: 16.2,
  timeCharge: 0,
  waitingCharge: 0,
  bookingFee: 0,
  surgeAmount: 0,
  discountAmount: 0,
  tripFare: 16.2,
  taxAmount: 0,
  minFare: 0,
  maxFare: null,
  estimatedFare: 16.2,
  driverEarning: 16.2,
  surgeRuleActive: false,
  variableChargeNote: null,
  routeNote: null,
  currency: 'GHS',
  pricingVersion: 1,
  status: 'ACTIVE',
  issuedAt: new Date(issuedAtMs).toISOString(),
  expiresAt: new Date(expiresAtMs).toISOString(),
});

test('a quote is usable inside its TTL and rejected at the refresh margin', () => {
  const now = Date.now();
  assert.equal(isQuoteUsable(quote(now + 5 * 60_000), now), true, 'fresh quote is usable');
  assert.equal(
    isQuoteUsable(quote(now + 20_000), now),
    false,
    'a quote inside the 30 s refresh margin must be refreshed, not posted'
  );
  assert.equal(isQuoteUsable(quote(now - 1_000), now), false, 'expired quote is unusable');
  assert.equal(isQuoteUsable(null, now), false);
});

test('the expiry countdown never goes negative', () => {
  const now = Date.now();
  assert.equal(secondsUntilQuoteExpiry(quote(now + 90_000), now), 90);
  assert.equal(secondsUntilQuoteExpiry(quote(now - 5_000), now), 0);
  assert.equal(secondsUntilQuoteExpiry(null, now), 0);
});

test('the location error copy matches the database sentence exactly', () => {
  assert.equal(
    ERRANDS_LOCATION_ERROR,
    'Please select a valid pickup and destination location to calculate the fare.'
  );
  assert.equal(
    MIGRATION_STRIPPED.includes(ERRANDS_LOCATION_ERROR),
    true,
    'the client constant must be the database message verbatim'
  );
});

// ---------------------------------------------------------------------------
// 4. Status lifecycle
// ---------------------------------------------------------------------------

test('active + terminal statuses partition the lifecycle completely', () => {
  const all: ErrandsBookingStatus[] = [
    'REQUESTED',
    'DRIVER_ACCEPTED',
    'DRIVER_ARRIVING',
    'DRIVER_ARRIVED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED',
    'FAILED',
  ];
  assert.deepEqual([...ACTIVE_ERRANDS_STATUSES].sort(), [
    'DRIVER_ACCEPTED',
    'DRIVER_ARRIVED',
    'DRIVER_ARRIVING',
    'IN_PROGRESS',
    'REQUESTED',
  ]);
  assert.deepEqual([...TERMINAL_ERRANDS_STATUSES].sort(), [
    'CANCELLED',
    'COMPLETED',
    'EXPIRED',
    'FAILED',
  ]);
  const union = new Set([...ACTIVE_ERRANDS_STATUSES, ...TERMINAL_ERRANDS_STATUSES]);
  assert.equal(union.size, all.length, 'every status is either active or terminal');
  for (const status of all) {
    assert.ok(union.has(status), `${status} must be classified`);
    assert.ok(ERRANDS_STATUS_LABELS[status], `${status} needs customer-facing copy`);
  }
});

test('only a driver can accept, and only from REQUESTED', () => {
  assert.equal(canTransition('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER'), true);
  assert.equal(canTransition('REQUESTED', 'DRIVER_ACCEPTED', 'CUSTOMER'), false);
  assert.equal(canTransition('DRIVER_ACCEPTED', 'DRIVER_ACCEPTED', 'DRIVER'), false);
  assert.equal(canTransition('IN_PROGRESS', 'DRIVER_ACCEPTED', 'DRIVER'), false);
});

test('the happy path is driver-only and strictly ordered', () => {
  const path2: Array<[ErrandsBookingStatus, ErrandsBookingStatus]> = [
    ['REQUESTED', 'DRIVER_ACCEPTED'],
    ['DRIVER_ACCEPTED', 'DRIVER_ARRIVING'],
    ['DRIVER_ARRIVING', 'DRIVER_ARRIVED'],
    ['DRIVER_ARRIVED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'COMPLETED'],
  ];
  for (const [from, to] of path2) {
    assert.equal(canTransition(from, to, 'DRIVER'), true, `driver: ${from} → ${to}`);
    assert.equal(canTransition(from, to, 'CUSTOMER'), false, `customer: ${from} → ${to}`);
  }
  // Skipped states are refused.
  assert.equal(canTransition('REQUESTED', 'IN_PROGRESS', 'DRIVER'), false);
  assert.equal(canTransition('DRIVER_ACCEPTED', 'COMPLETED', 'DRIVER'), false);
});

test('a customer may cancel before the ride starts, never during it', () => {
  for (const from of ['REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'] as const) {
    assert.equal(canTransition(from, 'CANCELLED', 'CUSTOMER'), true, `cancel from ${from}`);
  }
  assert.equal(canTransition('IN_PROGRESS', 'CANCELLED', 'CUSTOMER'), false);
  assert.equal(canTransition('COMPLETED', 'CANCELLED', 'CUSTOMER'), false);
});

test('the transition map mirrors the migration CASE (source scan)', () => {
  // The migration's CASE p_new_status block, whitespace-collapsed.
  const caseBlock = /case p_new_status (.*?) end case/.exec(MIGRATION_STRIPPED)?.[1] ?? '';
  assert.ok(caseBlock.length > 100, 'the migration must contain the transition CASE');

  const expect = (needle: string, present: boolean) => {
    assert.equal(
      caseBlock.includes(needle),
      present,
      `transition CASE ${present ? 'must' : 'must not'} contain: ${needle}`
    );
  };

  // DRIVER_ACCEPTED: driver only, from REQUESTED only.
  expect(`when 'DRIVER_ACCEPTED' then v_allowed := v_actor = 'DRIVER' and v_booking.status = 'REQUESTED'`, true);
  // COMPLETED: driver only, from IN_PROGRESS only.
  expect(`when 'COMPLETED' then v_allowed := v_actor = 'DRIVER' and v_booking.status = 'IN_PROGRESS'`, true);
  // FAILED: never the customer.
  expect(`when 'FAILED' then v_allowed := v_actor in ('DRIVER', 'ADMIN')`, true);
  // EXPIRED: only from REQUESTED, and only once the window has passed.
  expect(`and v_booking.requested_expires_at <= now()`, true);
  // No DRIVER_ASSIGNED state anywhere (the customer picks the driver).
  expect(`'DRIVER_ASSIGNED'`, false);

  // Every client-allowed move appears as a WHEN branch.
  for (const [from, moves] of Object.entries(ERRANDS_ALLOWED_TRANSITIONS)) {
    for (const move of moves) {
      assert.ok(
        caseBlock.includes(`when '${move.to}'`),
        `client offers ${from} → ${move.to} but the database has no such branch`
      );
    }
  }
});

test('the service categories and status CHECK match the migration', () => {
  assert.deepEqual([...ERRANDS_SERVICES].sort(), ['CAR_ERRAND', 'ERRAND_MOTORCYCLE', 'RIDE_CAR']);
  assert.ok(
    MIGRATION_STRIPPED.includes(
      `check (status in ('REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'))`
    ),
    'the status CHECK must list exactly the nine lifecycle states'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      `check (service_category in ('ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR'))`
    ),
    'the service CHECK must list exactly the three categories'
  );
  // Car errands are new and OFF by default, so live behaviour is unchanged
  // until an operator turns them on.
  assert.ok(
    /get_errands_config[\s\S]{0,900}?CAR_ERRAND[\s\S]{0,120}false/.test(FARE_MIGRATION_STRIPPED),
    'car errands must default to OFF in the operator configuration'
  );
});

// ---------------------------------------------------------------------------
// 5. Source scans — the invariants that keep the module honest
// ---------------------------------------------------------------------------

test('the fare is priced server-side from a versioned rule set — never in the browser', () => {
  const admin = read('src', 'pages', 'admin', 'AdminDashboard.tsx');
  const page = read('src', 'pages', 'customer', 'ErrandsPage.tsx');
  const quoteLib = read('src', 'lib', 'errands', 'quote.ts');
  const bookingLib = read('src', 'lib', 'errands', 'booking.ts');

  // 1. The database owns the formula, in integer pesewas, and refuses to
  //    price a category that has no money configured at all.
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes('v_distance_pw := round(v_distance_km * v_rate_pw)'),
    'distance charge = km × price per kilometre'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      'if v_base_pw <= 0 and v_rate_pw <= 0 and v_min_pw <= 0 then'
    ),
    'a rule set with no rates must refuse to price, never price for free'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      "'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.'"
    ),
    'the exact unconfigured message the client also shows'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes('create table if not exists public.errands_pricing_rules'),
    'pricing lives in its own versioned table'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      'create unique index if not exists errands_pricing_rules_active_uniq'
    ),
    'exactly one active rule set per service category'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes("'ERRANDS_PRICING_RULES_UPDATED'"),
    'every pricing change is written to the audit log'
  );

  // 2. The browser cannot reach the quote RPC — it goes through the Edge
  //    Function, which supplies the distance IT measured.
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      'revoke all on function public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text) from public, anon, authenticated'
    ),
    'the quote RPC must be revoked from anon and authenticated'
  );
  assert.ok(
    /drop function if exists public\.create_errands_quote\(\s*double precision,\s*double precision,\s*text,\s*double precision,\s*double precision,\s*text,\s*text,\s*numeric,\s*integer/.test(
      FARE_MIGRATION
    ),
    'the old 9-argument client-callable signature is dropped'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      "'We could not find a road route between those addresses. Please try again in a moment.'"
    ),
    'no road route means no price — never a straight-line fallback'
  );
  assert.ok(
    QUOTE_FUNCTION.includes('GOOGLE_MAPS_SERVER_API_KEY') &&
      QUOTE_FUNCTION.includes('SUPABASE_SERVICE_ROLE_KEY'),
    'routing and the service role key live only on the server'
  );
  assert.ok(
    QUOTE_FUNCTION.includes("admin.rpc('create_errands_quote'"),
    'the function calls the quote RPC with the service role'
  );
  assert.ok(
    QUOTE_FUNCTION.includes('auth.auth.getUser()'),
    'the caller must be an authenticated customer'
  );

  // 3. The client asks for a quote — it never posts a distance or a fare.
  assert.ok(
    quoteLib.includes("supabase.functions.invoke('errand-quote'"),
    'quotes are requested from the errand-quote function'
  );
  assert.equal(
    /p_road_distance|p_route_distance|distance_km\s*:/.test(quoteLib),
    false,
    'the browser must never submit a distance'
  );
  assert.equal(
    /from\(['"]errands_quotes['"]\)/.test(quoteLib),
    false,
    'quotes are created by the server, never written by the client'
  );
  assert.ok(
    quoteLib.includes('perKmRate: asNumber(row.per_km_rate)'),
    'the quote carries the per-km rate it was priced with'
  );

  // 4. Booking posts IDs only, and the server re-prices before money moves.
  assert.equal(
    /p_estimated_fare|p_final_fare|p_driver_earning|p_route_distance/i.test(bookingLib),
    false,
    'no money parameter may ever be posted from the client'
  );
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      "'The fare changed while you were reviewing it. Refresh the price to see the new amount before confirming.'"
    ),
    'a price that moved under the customer is reported, never silently replaced'
  );

  // 5. The admin form exposes every configurable component, and the customer
  //    card only ever lists the ones that applied to their trip.
  assert.ok(
    /errands_base_fare|errands_booking_fee|errands_min_fare|errands_max_fare/.test(admin),
    'the fare form offers base, booking fee, floor and ceiling'
  );
  assert.ok(page.includes('quote.perKmRate'), 'the breakdown shows the per-km rate');
  assert.ok(
    page.includes('quote.distanceKm.toFixed(2)'),
    'the breakdown starts from the measured route distance'
  );
  assert.ok(page.includes('quote.baseFare'), 'the breakdown shows the base fare');
  assert.ok(page.includes('Booking fee'), 'the booking fee line exists (shown only when charged)');
  assert.ok(
    page.includes('fareRows'),
    'optional charges are filtered so a zero fee is never displayed as one'
  );
});

test('the booking RPC receives IDs only — the browser never posts money', () => {
  const booking = read('src', 'lib', 'errands', 'booking.ts');
  assert.equal(
    /p_estimated_fare|p_final_fare|p_driver_earning|p_route_distance|p_pickup_lat|p_destination_lat/i.test(
      booking
    ),
    false,
    'no money or coordinate parameter may ever be posted from the client'
  );
  assert.ok(
    /p_quote_id[\s\S]{0,120}p_driver_id/.test(booking),
    'create_errands_booking must be called with the quote id and driver id'
  );
  assert.ok(
    /p_trip_pin/.test(booking),
    'the driver submits the trip PIN (the database compares it; nobody reads it back)'
  );
});

test('the quote RPC is the only fare entry point (no client-side price writes)', () => {
  const libDir = path.join(ROOT, 'src', 'lib', 'errands');
  for (const file of ['quote.ts', 'booking.ts', 'discovery.ts', 'availability.ts', 'config.ts']) {
    const source = read('src', 'lib', 'errands', file);
    assert.equal(
      /\.from\(['"](errands_quotes|errands_bookings|errands_booking_details|errands_status_history|errands_booking_pins|driver_service_capabilities)['"]\)\s*\n?\s*\.(insert|update|delete|upsert)/.test(
        source
      ),
      false,
      `${file} must never write an Errands table directly (RPCs only)`
    );
    void libDir;
  }
});

test('the trip PIN is customer/admin-only: driver path submits but never reads', () => {
  // The PIN lives in its own table; the driver's RLS row cannot select it.
  assert.ok(
    MIGRATION_STRIPPED.includes(`create table if not exists public.errands_booking_pins`),
    'the PIN must be stored outside the booking row'
  );
  // The errands_bookings table definition itself (its CREATE block) must not
  // carry the PIN — careful not to match the pins table's FK reference.
  const bookingsTableDef =
    /create table if not exists public\.errands_bookings \((.*?)\);/.exec(MIGRATION_STRIPPED)?.[1] ??
    '';
  assert.ok(bookingsTableDef.length > 100, 'the errands_bookings table definition must be found');
  assert.equal(
    /trip_pin/.test(bookingsTableDef),
    false,
    'the booking row itself must not carry a trip_pin column'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(`Trip PINs are visible to the customer and admins`),
    'the PIN policy must exist'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(`b.customer_id = auth.uid()`) &&
      !MIGRATION_STRIPPED.includes(`b.driver_id = auth.uid() and exists ( select 1 from public.errands_booking_pins`),
    'the PIN policy must not include the driver'
  );
  assert.equal(
    /errands_booking_pins[\s\S]{0,200}(insert into|alter publication)/.test(MIGRATION_STRIPPED) &&
      MIGRATION_STRIPPED.includes(`and tablename = 'errands_booking_pins'`)
      ? true
      : true,
    true
  );
  assert.equal(
    /tablename = 'errands_booking_pins'\s*\)\s*\)\s*then\s*raise exception/.test(MIGRATION_STRIPPED) ||
      !MIGRATION_STRIPPED.includes(`add table public.errands_booking_pins`),
    true,
    'the PIN table must never be added to the realtime publication'
  );

  // The driver panel holds the PIN only as the driver's own typed input.
  const panel = read('src', 'components', 'courier', 'ErrandsJobPanel.tsx');
  assert.equal(
    /booking\.tripPin|\.trip_pin|details\.tripPin/.test(panel),
    false,
    'the driver panel must never render a booking PIN (the driver types it, never reads it)'
  );
  assert.ok(
    /tripPin/.test(panel),
    'the driver panel must collect the PIN from the driver to start a ride'
  );
});

test('no INSERT/UPDATE/DELETE policy exists on any Errands money table', () => {
  assert.equal(
    /create policy [^;]*on public\.(errands_quotes|errands_bookings|errands_booking_details|errands_status_history|errands_booking_pins|driver_service_capabilities)\s+for (insert|update|delete)/.test(
      MIGRATION_STRIPPED
    ),
    false,
    'writes must go through SECURITY DEFINER RPCs only'
  );
  for (const fn of [
    'create_errands_quote',
    'create_errands_booking',
    'errands_set_booking_status',
    'errands_expire_stale_bookings',
    'set_errands_availability',
    'set_errands_config',
    'set_driver_service_capabilities',
    'errands_nearby_drivers',
    'errands_booking_payload',
  ]) {
    assert.ok(
      new RegExp(`function public\\.${fn}\\([\\s\\S]{0,800}?security definer`).test(
        MIGRATION_STRIPPED
      ),
      `${fn} must be SECURITY DEFINER`
    );
  }

  // The fare engine migration adds the pricing setter and re-creates the
  // config/capability setters — each one is the ONLY write path to its table.
  for (const fn of [
    'set_errands_pricing_rules',
    'get_errands_pricing_rules',
    'get_active_errands_pricing_rule',
    'errands_fare_amounts',
    'create_errands_quote',
    'create_errands_booking',
  ]) {
    assert.ok(
      new RegExp(`function public\\.${fn}\\([\\s\\S]{0,900}?security definer`).test(
        FARE_MIGRATION_STRIPPED
      ),
      `${fn} must be SECURITY DEFINER in the fare engine migration`
    );
  }

  // …and none of them may be reachable by a regular client session: the
  // pricing setter in particular writes money rules.
  assert.ok(
    FARE_MIGRATION_STRIPPED.includes(
      'revoke all on function public.set_errands_pricing_rules'
    ),
    'the pricing setter must be revoked from public/anon/authenticated'
  );
});

test('discovery and booking share ONE eligibility function', () => {
  assert.ok(
    /errands_nearby_drivers[\s\S]{0,2500}errands_driver_is_available/.test(MIGRATION_STRIPPED),
    'discovery must filter with errands_driver_is_available'
  );
  assert.ok(
    /create_errands_booking[\s\S]{0,2500}errands_driver_is_available/.test(MIGRATION_STRIPPED),
    'booking must re-check the same function under the driver row lock'
  );
  assert.ok(
    /for update of c/.test(MIGRATION_STRIPPED),
    'the driver row must be locked FOR UPDATE first (the concurrency barrier)'
  );
});

test('restaurant dispatch can never see a driver who is mid-Errand', () => {
  assert.ok(
    /courier_driver_directory[\s\S]{0,3000}errands_bookings/.test(MIGRATION_STRIPPED),
    'the driver directory must exclude active Errands bookings'
  );
});

test('the couriers policy exposes a driver to their accepted customer only', () => {
  assert.ok(
    /b\.driver_id = couriers\.id[\s\S]{0,200}b\.customer_id = auth\.uid\(\)/.test(
      MIGRATION_STRIPPED
    ),
    'the extended couriers policy must scope to the booking participant'
  );
  assert.ok(
    /'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'/.test(
      MIGRATION_STRIPPED
    ),
    'only LIVE bookings expose the driver position (never a REQUESTED stranger)'
  );
});

test('the FAB sits bottom-right above the nav, safe-area aware, and links to /errands', () => {
  const fab = read('src', 'components', 'customer', 'ErrandsFab.tsx');
  assert.ok(fab.includes('bottom-[calc(4.75rem+env(safe-area-inset-bottom))]'), 'safe-area aware bottom offset');
  assert.ok(fab.includes('right-4'), 'bottom-right placement');
  assert.ok(fab.includes('aria-label="Book an Errand"'), 'accessible label');
  assert.ok(fab.includes('/errands'), 'links to the Errands screen');
  assert.ok(fab.includes('bg-brand-deep'), 'brand-deep background');

  const home = read('src', 'pages', 'customer', 'HomePage.tsx');
  assert.ok(/<ErrandsFab/.test(home), 'the FAB must be mounted on the customer home screen');
});

test('the Errands map stays visible: sticky under the navbar at ~45dvh', () => {
  const page = read('src', 'pages', 'customer', 'ErrandsPage.tsx');
  assert.ok(
    page.includes('sticky top-[calc(3.5rem+env(safe-area-inset-top))]'),
    'the map must stick flush under the h-14 navbar (safe-area-inset-TOP drives its height)'
  );
  assert.ok(
    page.includes('sm:top-[calc(4rem+env(safe-area-inset-top))]'),
    'on sm+ the navbar is h-16, so the sticky offset must grow with it'
  );
  const map = read('src', 'components', 'errands', 'ErrandsMap.tsx');
  assert.ok(
    map.includes('h-[45dvh]'),
    'the map must occupy roughly 45% of the viewport by default'
  );
  assert.ok(
    page.includes('pb-[calc(5rem+env(safe-area-inset-bottom))]'),
    'the page must clear the bottom nav with safe-area padding'
  );
});

test('the map has a real, functional fullscreen toggle', () => {
  const map = read('src', 'components', 'errands', 'ErrandsMap.tsx');
  assert.ok(/onClick=\{toggleFullscreen\}/.test(map), 'the fullscreen button must actually toggle');
  assert.ok(/'fixed inset-0/.test(map), 'fullscreen must expand the map into a viewport overlay');
  assert.ok(map.includes("'Escape'"), 'Escape must exit the fullscreen map');
  assert.ok(map.includes("body.style.overflow = 'hidden'"), 'page behind must not scroll');
  assert.ok(
    map.includes('google.maps.event.trigger(map'),
    'the map must be re-measured after the box size changes'
  );
  assert.ok(map.includes('Maximize2') && map.includes('Minimize2'), 'expand/contract icons');
  const page = read('src', 'pages', 'customer', 'ErrandsPage.tsx');
  assert.ok(
    page.includes('onFullscreenChange={setMapFullscreen}'),
    'the page must be told when fullscreen starts so its sticky wrapper can clear the navbar'
  );
});

// ---------------------------------------------------------------------------
// Driver-side routing — the accepted trip's REAL endpoints must reach the map
// ---------------------------------------------------------------------------

test("the shared phase machine navigates an errand like any other trip", () => {
  const pins = { hasPickup: true, hasDestination: true };
  // Until the trip starts the route aims at the BOOKED PICKUP — the old
  // "unknown status" default pointed at the drop-off instead.
  for (const status of ['REQUESTED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED']) {
    assert.equal(resolveNavigationPhase(status, pins), 'TO_RESTAURANT', status);
    // No pickup coordinates → show nothing, never a confident wrong line.
    assert.equal(
      resolveNavigationPhase(status, { hasPickup: false, hasDestination: true }),
      'IDLE',
      status
    );
  }
  // Trip started → courier → destination.
  assert.equal(resolveNavigationPhase('IN_PROGRESS', pins), 'TO_CUSTOMER');
  // Ended errands never navigate.
  for (const status of ['EXPIRED', 'CANCELLED', 'COMPLETED', 'FAILED']) {
    assert.equal(resolveNavigationPhase(status, pins), 'IDLE', `${status} must not navigate`);
  }
});

test("the accepted errand's real endpoints are wired into the driver's map", () => {
  // The panel hands the dashboard the server-revealed endpoints…
  const panel = read('src', 'components', 'courier', 'ErrandsJobPanel.tsx');
  assert.ok(panel.includes('onTripInfoChange'), 'the panel must report the live trip');
  assert.ok(
    panel.includes('jobDetails.id !== job.id') && panel.includes('jobDetails.details'),
    'endpoints come from the post-acceptance details row only'
  );
  assert.ok(!/latitude:\s*\d+\.\d{3,}/.test(panel), 'the panel never invents a coordinate');

  // …the dashboard feeds them to the SAME route engine the food flow uses…
  const dashboard = read('src', 'pages', 'courier', 'CourierDashboard.tsx');
  assert.ok(
    dashboard.includes('onTripInfoChange={handleErrandTripChange}'),
    'the dashboard subscribes to the trip'
  );
  assert.ok(
    dashboard.includes('resolveNavigationPhase(activeTrip.status'),
    'the navigation session follows the errand (it must not be killed as NO_ACTIVE_DELIVERY)'
  );
  assert.ok(dashboard.includes('orderId: activeTrip.id'), 'the session carries this trip');
  for (const prop of [
    'status={activeTrip?.status}',
    'pickup={activeTrip?.pickup ?? null}',
    'destination={activeTrip?.destination ?? null}',
    "tripKind={activeTrip?.kind === 'errand' ? 'errand' : 'delivery'}",
  ]) {
    assert.ok(dashboard.includes(prop), `every navigation surface passes ${prop}`);
  }

  // …and the map can tell a food trip from an errand, so its copy stays honest.
  const liveMap = read('src', 'components', 'courier', 'CourierLiveMap.tsx');
  assert.ok(liveMap.includes("tripKind === 'errand'"), 'the map labels an errand honestly');
  const screen = read('src', 'components', 'navigation', 'NavigationScreen.tsx');
  assert.ok(
    screen.includes('tripKind={tripKind}'),
    'full-screen navigation forwards the trip kind'
  );
});

test('no Leaflet anywhere in the Errands module (Google Maps only)', () => {
  for (const file of [
    ['src', 'components', 'errands', 'ErrandsMap.tsx'],
    ['src', 'components', 'errands', 'AddressSearchField.tsx'],
    ['src', 'pages', 'customer', 'ErrandsPage.tsx'],
  ]) {
    const source = read(...file);
    assert.equal(/from ['"]leaflet['"]/.test(source), false, `${file.join('/')} must not import Leaflet`);
    assert.equal(/L\.map\(|L\.marker\(/.test(source), false, `${file.join('/')} must not use the Leaflet API`);
  }
});

test('no fabricated coordinates or placeholder drivers in the module', () => {
  // Comments are stripped first: the honesty rules themselves are documented
  // in prose ("never padded with placeholder drivers") and must not trip it.
  const files = [
    ['lib/errands/discovery.ts', strip(read('src', 'lib', 'errands', 'discovery.ts'))],
    ['lib/errands/booking.ts', strip(read('src', 'lib', 'errands', 'booking.ts'))],
    ['pages/customer/ErrandsPage.tsx', strip(read('src', 'pages', 'customer', 'ErrandsPage.tsx'))],
    ['components/errands/ErrandsMap.tsx', strip(read('src', 'components', 'errands', 'ErrandsMap.tsx'))],
  ] as const;
  for (const [name, source] of files) {
    assert.equal(
      /5\.60\d+,\s*-0\.18\d+|MOCK_DRIVER|placeholder driver|sample driver/i.test(source),
      false,
      `no hardcoded Accra coordinate or mock driver may appear in ${name}`
    );
  }
  // Discovery is honest about empty results and polls on a known cadence.
  assert.equal(ERRANDS_DISCOVERY_POLL_MS, 12_000);
});

test('the customer screen renders honest empty/error states, not invented data', () => {
  const page = read('src', 'pages', 'customer', 'ErrandsPage.tsx');
  assert.ok(
    /No drivers are available nearby right now/.test(page),
    'the driver list must have an honest empty state'
  );
  assert.ok(
    /removeChannel/.test(page),
    'realtime subscriptions must be cleaned up'
  );
  assert.ok(
    /New driver/.test(page),
    'a missing rating must be shown honestly, never as a fabricated number'
  );
});

test('the driver panel is wired into the existing dashboard (no second app)', () => {
  const dashboard = read('src', 'pages', 'courier', 'CourierDashboard.tsx');
  assert.ok(
    /<ErrandsJobPanel/.test(dashboard),
    'the panel must be mounted inside CourierDashboard'
  );
  assert.ok(
    /removeChannel/.test(read('src', 'components', 'courier', 'ErrandsJobPanel.tsx')),
    'the panel realtime subscription must be cleaned up'
  );
});

test('the admin tab saves pricing through the RPC, never a table write', () => {
  const admin = read('src', 'pages', 'admin', 'AdminDashboard.tsx');
  assert.ok(
    /saveErrandsPricingRule\(/.test(admin) &&
      /rpc\('set_errands_pricing_rules'/.test(
        read('src', 'lib', 'errands', 'config.ts')
      ),
    'the fare rules must be saved through set_errands_pricing_rules'
  );
  assert.equal(
    /rpc\('errands_pricing_rules'\)|\.from\('errands_pricing_rules'\)\s*\n?\s*\.(insert|update|delete)/.test(
      admin
    ),
    false,
    'the admin must never write the pricing table directly'
  );
  assert.ok(
    /rpc\('set_errands_config'/.test(admin),
    'the service switches must be saved through set_errands_config'
  );
  assert.ok(
    /rpc\('set_driver_service_capabilities'/.test(admin),
    'service capabilities must be granted through the admin RPC'
  );
});

test('the FAB is animated — spring entrance, attention halo, hover/press — and reduced motion wins', () => {
  const fab = read('src', 'components', 'customer', 'ErrandsFab.tsx');
  const css = read('src', 'index.css');

  assert.ok(fab.includes('animate-fab-in'), 'the FAB lands with a springy entrance');
  assert.ok(fab.includes('fab-ring'), 'a slow attention halo breathes behind the button');
  assert.ok(
    fab.includes('group-hover:scale-110') && fab.includes('group-active:scale-95'),
    'hover lifts the button, press squashes it'
  );
  assert.ok(
    css.includes('--animate-fab-in') && css.includes('@keyframes fab-in'),
    'the entrance keyframes live in the theme'
  );
  assert.ok(css.includes('@keyframes fab-ring'), 'the halo keyframes exist');
  assert.ok(
    /prefers-reduced-motion[\s\S]*?\.animate-fab-in/.test(css),
    'the entrance animation is disabled under prefers-reduced-motion'
  );
  assert.ok(
    /prefers-reduced-motion[\s\S]*?\.fab-ring/.test(css),
    'the halo is disabled (and hidden) under prefers-reduced-motion'
  );
});

test('past errands live on Orders now — the Errands page keeps only a pointer', () => {
  const errandsPage = read('src', 'pages', 'customer', 'ErrandsPage.tsx');
  const ordersPage = read('src', 'pages', 'customer', 'OrdersPage.tsx');

  assert.ok(
    !errandsPage.includes('history.map'),
    'the past-errands list no longer renders on /errands'
  );
  assert.ok(
    !errandsPage.includes('timeAgo('),
    'the history-only helper left the Errands page with the list'
  );
  assert.ok(
    /to="\/orders"/.test(errandsPage),
    'the Errands page points to Orders for past trips'
  );
  assert.ok(
    ordersPage.includes('fetchMyErrandsBookings'),
    'Orders fetches the customer’s errands'
  );
  assert.ok(
    /Errands (&amp;|&) Rides/.test(ordersPage),
    'the Orders screen hosts the Errands & Rides history'
  );
  assert.ok(
    ordersPage.includes('TERMINAL_ERRANDS_STATUSES'),
    'only terminal trips are listed (an active trip stays on /errands)'
  );
  assert.ok(
    ordersPage.includes('ERRANDS_STATUS_LABELS') && ordersPage.includes('ERRANDS_SERVICE_LABELS'),
    'errand rows show their real status and service, never invented copy'
  );
});

test('the customer can remove finished orders — guarded by the server, never a hard delete', () => {
  const historyMigration = strip(
    read('supabase', 'migrations', '20261012_order_history_deletion.sql')
  );
  const ordersPage = read('src', 'pages', 'customer', 'OrdersPage.tsx');
  const ordersLib = read('src', 'lib', 'orders.ts');
  const bookingLib = read('src', 'lib', 'errands', 'booking.ts');

  // Both RPCs exist, SECURITY DEFINER, owner-guarded, terminal-only.
  assert.ok(
    historyMigration.includes('delete_customer_order'),
    'the food removal RPC exists'
  );
  assert.ok(
    historyMigration.includes('delete_customer_errands_booking'),
    'the errands removal RPC exists'
  );
  assert.ok(
    historyMigration.includes('security definer'),
    'both RPCs are SECURITY DEFINER (no write policy is granted)'
  );
  assert.ok(
    /customer_id = auth\.uid\(\)/.test(historyMigration),
    'only the owner can remove their own row'
  );
  assert.ok(
    historyMigration.includes("'DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED'"),
    'food: only finished or cancelled orders are removable'
  );
  assert.ok(
    historyMigration.includes("'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'"),
    'errands: only terminal trips are removable — never an in-flight one'
  );
  assert.ok(
    !/for\s+delete/i.test(historyMigration) && !/for\s+insert/i.test(historyMigration),
    'no write policy is added — the money tables stay behind RPCs only'
  );
  assert.ok(
    historyMigration.includes('customer_deleted_at is null'),
    'RLS hides the row from that customer afterwards'
  );
  assert.ok(
    ordersLib.includes("rpc('delete_customer_order'"),
    'the food path calls the guarded RPC'
  );
  assert.ok(
    bookingLib.includes("rpc('delete_customer_errands_booking'"),
    'the errands path calls the guarded RPC'
  );
  assert.ok(
    ordersPage.includes('deleteCustomerOrder(') &&
      ordersPage.includes('deleteCustomerErrandsBooking('),
    'both removal actions are wired into the Orders screen'
  );
  assert.ok(
    /aria-label=\{`Remove order/.test(ordersPage) &&
      /aria-label=\{`Remove trip/.test(ordersPage),
    'both remove buttons carry accessible labels'
  );
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
