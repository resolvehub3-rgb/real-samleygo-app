/**
 * SamleyGo Errands — FARE ENGINE acceptance suite.
 *
 *   tsx scripts/errands_fare_engine.test.ts   (part of `npm test`)
 *
 * This file is the acceptance matrix for the automatic, distance-based fare
 * system. `scripts/errands_pricing.test.ts` covers the wider Errands module;
 * this one proves the money rules end to end:
 *
 *   1. Distance charge        — the fare IS the routed distance × rate.
 *   2. Minimum / maximum      — the floor lifts, the ceiling caps, 0 = no cap.
 *   3. Currency rounding      — whole pesewas, half away from zero, and the
 *                               binary-float artefact is repaired.
 *   4. Vehicle-specific rates — motorcycle, car-errand and ride rules are
 *                               independent, and only eligible drivers are
 *                               priced for a category.
 *   5. Optional fees          — booking fee, waiting, time, discount, tax:
 *                               each is off unless explicitly enabled.
 *   6. Disabled surge         — a multiplier in a switched-off field is not
 *                               a price.
 *   7. Missing configuration  — no rule ⇒ NO number (never GH₵0.00).
 *   8. Invalid route          — no road route ⇒ no quote; the server routes,
 *                               never the browser, never a straight line.
 *   9. Expired quotes         — refused by the server, hidden by the client.
 *  10. Modified client fares  — booking posts IDs only; the server re-prices.
 *  11. Driver unavailability  — ONE eligibility function for discovery and
 *                               booking, checked under the driver lock.
 *  12. Concurrent bookings    — row lock + single-use quote ⇒ one winner.
 *  13. Pricing change         — versioned rows + snapshot: an old quote keeps
 *                               the rules it was priced with.
 *
 * The formula itself is exercised through the client mirror
 * (`calculateErrandsFare`), which the SQL test asserts stays identical to
 * `errands_fare_amounts()`. Everything the browser cannot execute is locked
 * down by source-scanning the migration, the Edge Function and the client
 * libraries — the same style the rest of this repo's suites use.
 *
 * IMPORTANT: the database is still the authority. Nothing here can make the
 * client price a customer's trip; it only proves that nothing else can.
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
  isQuoteUsable,
  secondsUntilQuoteExpiry,
  type ErrandsQuote,
} from '../src/lib/errands/quote';

// ---------------------------------------------------------------------------
// Tiny test runner (no extra dependencies)
// ---------------------------------------------------------------------------

let passed = 0;
const failures: { name: string; error: Error }[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error: error as Error });
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segments: string[]) => readFileSync(path.join(ROOT, ...segments), 'utf8');

/** Drops comments + collapses whitespace so source scans stay stable. */
const strip = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

const MIGRATION = read('supabase', 'migrations', '20261013_errands_fare_engine.sql');
const MIGRATION_STRIPPED = strip(MIGRATION);
const QUOTE_FUNCTION = read('supabase', 'functions', 'errand-quote', 'index.ts');
const QUOTE_LIB = read('src', 'lib', 'errands', 'quote.ts');
const BOOKING_LIB = read('src', 'lib', 'errands', 'booking.ts');
const DISCOVERY_LIB = read('src', 'lib', 'errands', 'discovery.ts');
const CONFIG_LIB = read('src', 'lib', 'errands', 'config.ts');
const ADMIN_PAGE = read('src', 'pages', 'admin', 'AdminDashboard.tsx');

// ---------------------------------------------------------------------------
// Fixtures — one rule set per vehicle category, exactly as the admin saves
// them (motorcycle GH₵0 + GH₵2/km, car errands GH₵10 + GH₵3/km).
// ---------------------------------------------------------------------------

const motorcycleRule: ErrandsFareRule = {
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
  ...motorcycleRule,
  ...overrides,
});

const money = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// 1. Distance charge
// ---------------------------------------------------------------------------

test('the distance charge is km × price per kilometre — nothing else', () => {
  const fare = calculateErrandsFare(8, null, motorcycleRule);
  assert.ok(fare, 'a configured rule set must produce a fare');
  assert.equal(fare.distanceCharge, 16, '8 km × GH₵2');
  assert.equal(fare.baseFare, 0, 'this rule set has no base fare');
  assert.equal(fare.tripFare, 16, 'trip fare = distance charge alone');
  assert.equal(fare.total, 16, 'no tax, no fee: the customer pays the trip fare');
});

test('the price tracks the routed distance proportionally', () => {
  assert.equal(calculateErrandsFare(4, null, motorcycleRule)?.distanceCharge, 8);
  assert.equal(calculateErrandsFare(12, null, motorcycleRule)?.distanceCharge, 24);
  assert.equal(
    calculateErrandsFare(125.5, null, motorcycleRule)?.distanceCharge,
    251,
    'long routes stay exact, in whole pesewas'
  );
  assert.equal(
    calculateErrandsFare(0.001, null, motorcycleRule)?.distanceCharge,
    0,
    'a sub-pesewa distance rounds to nothing rather than inventing a minimum'
  );
});

test('an unroutable distance (0, negative, NaN) never invents a charge', () => {
  assert.equal(calculateErrandsFare(0, null, motorcycleRule)?.distanceCharge, 0);
  assert.equal(calculateErrandsFare(-5, null, motorcycleRule)?.distanceCharge, 0);
  assert.equal(calculateErrandsFare(Number.NaN, null, motorcycleRule)?.distanceCharge, 0);
  assert.equal(
    calculateErrandsFare(Number.POSITIVE_INFINITY, null, motorcycleRule)?.distanceCharge,
    0,
    'an infinite distance is refused, not priced'
  );
});

test('a base fare rides alongside the distance charge', () => {
  const fare = calculateErrandsFare(8, null, rule({ baseFare: 5 }));
  assert.equal(fare?.baseFare, 5);
  assert.equal(fare?.distanceCharge, 16);
  assert.equal(fare?.tripFare, 21, 'base + distance');
  assert.equal(calculateErrandsFare(0, null, rule({ baseFare: 5 }))?.total, 5, 'base only');
});

// ---------------------------------------------------------------------------
// 2. Minimum / maximum
// ---------------------------------------------------------------------------

test('the minimum fare lifts a short trip to the floor', () => {
  const short = calculateErrandsFare(1, null, rule({ baseFare: 5, minFare: 30 }));
  assert.equal(short?.tripFare, 7, 'raw price before the floor (GH₵5 + 1 km)');
  assert.equal(short?.total, 30, 'the floor wins');

  const long = calculateErrandsFare(50, null, rule({ baseFare: 5, minFare: 30 }));
  assert.equal(long?.total, 105, 'a fare above the floor is untouched');
});

test('the maximum fare caps a long trip', () => {
  const long = calculateErrandsFare(50, null, rule({ baseFare: 5, maxFare: 40 }));
  assert.equal(long?.tripFare, 105, 'raw price before the cap');
  assert.equal(long?.total, 40, 'the ceiling wins');

  const short = calculateErrandsFare(2, null, rule({ baseFare: 5, maxFare: 40 }));
  assert.equal(short?.total, 9, 'a fare below the ceiling is untouched');
});

test('max fare 0 or null means NO ceiling — never a free fare', () => {
  const openEnded = calculateErrandsFare(50, null, rule({ baseFare: 5, maxFare: 0 }));
  assert.equal(openEnded?.total, 105, 'a blank ceiling must not clamp to zero');
  assert.equal(openEnded?.tripFare, 105);

  const nullCeiling = calculateErrandsFare(50, null, rule({ baseFare: 5, maxFare: null }));
  assert.equal(nullCeiling?.total, 105, 'an unset ceiling behaves the same way');
});

test('floor then ceiling, in that documented order', () => {
  const both = rule({ baseFare: 5, pricePerKm: 2, minFare: 30, maxFare: 60 });
  assert.equal(calculateErrandsFare(0, null, both)?.total, 30, 'below the floor ⇒ floor');
  assert.equal(calculateErrandsFare(15, null, both)?.total, 35, 'in band ⇒ raw price (5 + 30)');
  assert.equal(calculateErrandsFare(100, null, both)?.total, 60, 'above the ceiling ⇒ ceiling');
});

test('a minimum on its own is a valid, fully configured rule set', () => {
  const minimumOnly = calculateErrandsFare(0, null, rule({ baseFare: 0, pricePerKm: 0, minFare: 30 }));
  assert.ok(minimumOnly, 'min > 0 satisfies "at least one rate"');
  assert.equal(minimumOnly.total, 30, 'the floor prices a 0 km trip too');
});

// ---------------------------------------------------------------------------
// 3. Currency rounding
// ---------------------------------------------------------------------------

test('amounts land on whole pesewas, half away from zero', () => {
  // 8.903 × 2 = 17.806 ⇒ 17.81 ; 8.902 × 2 = 17.804 ⇒ 17.80
  assert.equal(calculateErrandsFare(8.903, null, motorcycleRule)?.total, 17.81);
  assert.equal(calculateErrandsFare(8.902, null, motorcycleRule)?.total, 17.8);
  // 2.5 pesewas ⇒ 3 (half away from zero, not banker's rounding).
  assert.equal(calculateErrandsFare(0.0125, null, motorcycleRule)?.total, 0.03);
});

test('the binary-float artefact never reaches the customer (2.675 ⇒ 2.68)', () => {
  // 2.675 * 100 === 267.49999999999997 in float — a naive round gives 2.67.
  const fare = calculateErrandsFare(0, null, rule({ baseFare: 2.675, pricePerKm: 0 }));
  assert.equal(fare?.baseFare, 2.68, 'the fare matches Postgres exact-decimal round()');
  assert.equal(fare?.total, 2.68);
});

test('tax and the earnings split round on pesewas and always add back up', () => {
  const taxed = calculateErrandsFare(0, null, rule({ baseFare: 1.1, taxRatePercent: 7.5 }));
  assert.equal(taxed?.tripFare, 1.1);
  assert.equal(taxed?.taxAmount, 0.08, '8.25 pesewas ⇒ 8');
  assert.equal(taxed?.total, 1.18);

  const split = calculateErrandsFare(10, null, rule({ driverEarningPercent: 33 }));
  assert.ok(split);
  assert.equal(split.driverEarning, 6.6, '33% of the GH₵20 total');
  assert.equal(split.platformRevenue, 13.4, 'the platform takes the remainder, not a rounding fee');
  assert.equal(
    money(split.driverEarning)! + money(split.platformRevenue)! + money(split.taxAmount)!,
    money(split.total),
    'driver + platform + tax must equal what the customer pays'
  );
});

test('a percentage is clamped to 0…100 — no driver is paid more than the fare', () => {
  const overpaid = calculateErrandsFare(10, null, rule({ driverEarningPercent: 250 }));
  assert.equal(overpaid?.driverEarning, 20, 'an impossible share is clamped to 100%');

  const taxed = calculateErrandsFare(10, null, rule({ taxRatePercent: 400 }));
  assert.equal(taxed?.taxAmount, 20, 'an impossible tax rate is clamped to 100%');
});

// ---------------------------------------------------------------------------
// 4. Vehicle-specific pricing
// ---------------------------------------------------------------------------

test('motorcycle and car-errand rule sets price the same route differently', () => {
  const moto = calculateErrandsFare(10, null, rule({ baseFare: 0, pricePerKm: 2 }));
  const car = calculateErrandsFare(10, null, rule({ baseFare: 10, pricePerKm: 3 }));

  assert.equal(moto?.total, 20, 'motorcycle: 10 × GH₵2');
  assert.equal(car?.total, 40, 'car errand: GH₵10 + 10 × GH₵3');
  assert.notEqual(moto?.total, car?.total, 'each category carries its own price list');
  assert.equal(moto?.currency, 'GHS');
  assert.equal(car?.currency, 'GHS');
});

test('the server stores one ACTIVE rule set per category and picks it by service', () => {
  assert.ok(
    MIGRATION_STRIPPED.includes(
      'create unique index if not exists errands_pricing_rules_active_uniq'
    ),
    'only one rule set per service category may be active at a time'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "where r.service_category = p_service_category and r.is_active order by r.effective_from desc, r.pricing_version desc limit 1"
    ),
    'the active rule is chosen by service category, newest effective row first'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes("raise exception 'That vehicle category is not supported.'"),
    'an unknown vehicle category is refused'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes("raise exception 'Vehicle category does not match the service.'"),
    'a motorcycle rule set can never price a car service'
  );
});

test('only eligible drivers are priced for a category (vehicle + capability)', () => {
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "if p_service_category = 'ERRAND_MOTORCYCLE' then if v_c.vehicle_type not in ('Motorcycle', 'Bicycle') then return false; end if; if v_c.motorcycle_errands = false then return false; end if;"
    ),
    'motorcycle errands need a motorcycle/bicycle AND the capability'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "elsif p_service_category = 'CAR_ERRAND' then if v_c.vehicle_type not in ('Car', 'Van') then return false; end if; if v_c.car_errands = false then return false; end if;"
    ),
    'car errands need a car/van AND the admin-granted capability'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "elsif p_service_category = 'RIDE_CAR' then if v_c.vehicle_type <> 'Car' then return false; end if; if v_c.car_rides = false then return false; end if;"
    ),
    'passenger trips need a car AND the passenger capability'
  );
  assert.ok(
    /add column if not exists car_errands boolean not null default false/.test(MIGRATION),
    'the car-errand capability defaults to OFF and is granted by an admin'
  );
});

test('the admin screen saves one category at a time, through the setter', () => {
  assert.ok(
    /saveErrandsPricingRule\(/.test(ADMIN_PAGE),
    'the fare-rules form saves per category'
  );
  assert.ok(
    /rpc\('set_errands_pricing_rules'/.test(CONFIG_LIB),
    'rules are written only through the SECURITY DEFINER setter'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes("'ERRANDS_PRICING_RULES_UPDATED'"),
    'every price change is audited with who and when'
  );
});

// ---------------------------------------------------------------------------
// 5. Optional fees
// ---------------------------------------------------------------------------

test('the booking fee is flat — added once, never multiplied by surge', () => {
  const fee = calculateErrandsFare(8, null, rule({ baseFare: 5, bookingFee: 2 }));
  assert.equal(fee?.bookingFee, 2);
  assert.equal(fee?.total, 23, 'GH₵5 + GH₵16 + GH₵2');

  const surged = calculateErrandsFare(
    8,
    null,
    rule({ baseFare: 5, bookingFee: 2, surgeEnabled: true, surgeMultiplier: 1.5 })
  );
  assert.equal(surged?.total, 33.5, '(5 + 16) × 1.5 + 2 — the fee sits outside the multiplier');
  assert.equal(surged?.bookingFee, 2, 'and is reported unchanged');
});

test('the waiting charge is 0 until it is switched on', () => {
  const off = calculateErrandsFare(8, null, rule({ baseFare: 5, waitingCharge: 3 }));
  assert.equal(off?.waitingCharge, 0, 'a value in a disabled field is not a price');
  assert.equal(off?.total, 21);

  const on = calculateErrandsFare(
    8,
    null,
    rule({ baseFare: 5, waitingCharge: 3, waitingChargeEnabled: true })
  );
  assert.equal(on?.waitingCharge, 3);
  assert.equal(on?.total, 24, 'added once, after the distance');
});

test('the time charge prices the routed duration only when enabled', () => {
  const off = calculateErrandsFare(
    8,
    900,
    rule({ baseFare: 5, timeChargePerMinute: 0.5, timeChargeEnabled: false })
  );
  assert.equal(off?.timeCharge, 0, 'disabled ⇒ the duration changes nothing');
  assert.equal(off?.total, 21);

  const on = calculateErrandsFare(
    8,
    900,
    rule({ baseFare: 5, timeChargePerMinute: 0.5, timeChargeEnabled: true })
  );
  assert.equal(on?.timeCharge, 7.5, '15 minutes × GH₵0.50');
  assert.equal(on?.total, 28.5);

  const noDuration = calculateErrandsFare(
    8,
    null,
    rule({ baseFare: 5, timeChargePerMinute: 0.5, timeChargeEnabled: true })
  );
  assert.equal(noDuration?.timeCharge, 0, 'a missing duration is 0, never NaN');
});

test('discount comes off before tax, and can never make a negative fare', () => {
  const discounted = calculateErrandsFare(
    8,
    null,
    rule({ baseFare: 5, discountAmount: 5, taxRatePercent: 10 })
  );
  assert.equal(discounted?.discountAmount, 5, 'GH₵21 − GH₵5');
  assert.equal(discounted?.taxAmount, 1.6, '10% of GH₵16, not of GH₵21');
  assert.equal(discounted?.total, 17.6);

  const silly = calculateErrandsFare(
    4,
    null,
    rule({ baseFare: 0, discountAmount: 999 })
  );
  assert.equal(silly?.tripFare, 0, 'the discount is capped at the fare, so the trip costs nothing');
  assert.equal(silly?.discountAmount, 8, 'the discount is capped at the fare');
  assert.equal(silly?.total, 0, 'a discount can never pay the customer');
  assert.ok(silly !== null, '…but the rule set is still valid and priced');
});

// ---------------------------------------------------------------------------
// 6. Disabled surge
// ---------------------------------------------------------------------------

test('surge multiplies the trip only, and only while the switch is on', () => {
  const on = calculateErrandsFare(
    8,
    null,
    rule({ baseFare: 5, surgeEnabled: true, surgeMultiplier: 1.5 })
  );
  assert.equal(on?.tripFare, 31.5, '(5 + 16) × 1.5');
  assert.equal(on?.surgeAmount, 10.5, 'the surge line shows exactly what it added');
  assert.equal(on?.total, 31.5);
});

test('a multiplier in a switched-off field is ignored', () => {
  const off = calculateErrandsFare(
    8,
    null,
    rule({ baseFare: 5, surgeEnabled: false, surgeMultiplier: 1.5 })
  );
  assert.equal(off?.tripFare, 21, 'the price is identical to having no surge at all');
  assert.equal(off?.surgeAmount, 0, 'and no surge appears on the breakdown');
});

test('surge 1, or a nonsensical multiplier, changes nothing', () => {
  const unity = calculateErrandsFare(
    8,
    null,
    rule({ baseFare: 5, surgeEnabled: true, surgeMultiplier: 1 })
  );
  assert.equal(unity?.surgeAmount, 0, '× 1 adds nothing');

  for (const multiplier of [0, -2, Number.NaN]) {
    const guarded = calculateErrandsFare(
      8,
      null,
      rule({ baseFare: 5, surgeEnabled: true, surgeMultiplier: multiplier })
    );
    assert.equal(guarded?.total, 21, `a multiplier of ${multiplier} must never shrink the fare`);
  }
});

// ---------------------------------------------------------------------------
// 7. Missing configuration
// ---------------------------------------------------------------------------

test('no rule set means NO fare — the admin-required message instead', () => {
  assert.equal(calculateErrandsFare(8, null, null), null);
  assert.equal(calculateErrandsFare(8, null, undefined), null);
  assert.equal(
    calculateErrandsFare(8, null, rule({ baseFare: 0, pricePerKm: 0, minFare: 0 })),
    null,
    'a rule set with no money in it prices nothing (never GH₵0.00)'
  );
  assert.equal(
    calculateErrandsFare(8, null, rule({ baseFare: -5, pricePerKm: -2, minFare: -1 })),
    null,
    'negative rates are refused, not clamped into a free trip'
  );
  assert.ok(
    ERRANDS_PRICING_UNCONFIGURED_MESSAGE.includes('has not been configured'),
    'the client shows the required admin-facing sentence'
  );
  assert.ok(
    ERRANDS_PRICING_UNCONFIGURED_MESSAGE.includes('super admin'),
    'and says who must fix it'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings -> Errands before customers can be shown a price.'"
    ),
    'the server raises the same sentence'
  );
});

test('the server refuses to SAVE an unconfigured category', () => {
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'Set at least one of base fare, price per kilometre or minimum fare — a category with no rates cannot be saved.'"
    ),
    'a zero-everything rule row can never be written'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'Driver and platform shares must add up to 100 percent.'"
    ),
    'the earnings split is validated before it is stored'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'The maximum fare cannot be lower than the minimum fare.'"
    ),
    'a ceiling below the floor is refused'
  );
});

// ---------------------------------------------------------------------------
// 8. Invalid route
// ---------------------------------------------------------------------------

test('no road route, no price — the server refuses instead of guessing', () => {
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'We could not find a road route between those addresses. Please try again in a moment.'"
    ),
    'a missing route is reported honestly (no straight-line fallback)'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'The road route for those addresses could not be verified. Please try again.'"
    ),
    'an implausible route distance is refused, not believed'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      'p_route_distance_km < greatest(0.01, v_straight * 0.90) or p_route_distance_km > greatest(1.0, v_straight * 3.0)'
    ),
    'the plausibility window is 0.90×–3.0× the crow-fly distance'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes("'ROAD_ROUTE'"),
    'the distance source is recorded as a road route, never as the crow flies'
  );
  assert.ok(
    /'straight_line_km', v_straight/.test(MIGRATION),
    'the crow-fly distance is kept for auditing only, never priced'
  );
});

test('the browser never routes or measures — the Edge Function does', () => {
  assert.ok(
    /supabase\.functions\.invoke\('errand-quote'/.test(QUOTE_LIB),
    'the client asks the Edge Function for a quote'
  );
  const invokeAt = QUOTE_LIB.indexOf("invoke('errand-quote'");
  const bodyStart = QUOTE_LIB.indexOf('body: {', invokeAt);
  const bodyEnd = QUOTE_LIB.indexOf('serviceCategory,', bodyStart);
  assert.ok(invokeAt > 0 && bodyStart > invokeAt && bodyEnd > bodyStart, 'the quote request carries a body');
  assert.equal(
    /distance|duration|fare|estimate/i.test(QUOTE_LIB.slice(bodyStart, bodyEnd)),
    false,
    'the quote request body carries no distance, duration or fare'
  );
  assert.ok(
    /auth\.auth\.getUser\(\)/.test(QUOTE_FUNCTION),
    'the function verifies the caller\'s JWT before doing anything'
  );
  assert.ok(
    /GOOGLE_MAPS_SERVER_API_KEY/.test(QUOTE_FUNCTION),
    'routing credentials live on the server, never in the browser'
  );
  assert.ok(
    /routeWithOSRM/.test(QUOTE_FUNCTION),
    'the existing OSRM provider is the fallback'
  );
  assert.ok(
    /AbortSignal\.timeout\(ROUTE_TIMEOUT_MS\)/.test(QUOTE_FUNCTION),
    'a hanging router cannot hang the quote'
  );
  assert.ok(
    /ROUTE_UNAVAILABLE/.test(QUOTE_FUNCTION),
    'an unroutable trip answers with an explicit error code'
  );
});

test('the quote RPC is called only by the service role, with the routed distance', () => {
  assert.ok(
    /admin\.rpc\('create_errands_quote'/.test(QUOTE_FUNCTION),
    'the Edge Function hands the measured route to the database'
  );
  assert.ok(
    /p_route_distance_km: Number\(\(measured\.distanceMetres \/ 1000\)\.toFixed\(3\)\)/.test(
      QUOTE_FUNCTION
    ),
    'the distance is the one that was actually routed'
  );
  assert.ok(
    !/p_estimated_fare|p_fare|p_base_fare/.test(QUOTE_FUNCTION),
    'nobody — not even the service role — can submit a price'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      'revoke all on function public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text) from public, anon, authenticated'
    ),
    'the browser cannot call the quote RPC directly'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      'grant execute on function public.create_errands_quote(uuid, double precision, double precision, text, double precision, double precision, text, text, numeric, integer, text) to service_role'
    ),
    'and the service role can'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      'revoke all on function public.errands_fare_amounts(numeric, integer, text, jsonb) from public, anon, authenticated'
    ),
    'the fare formula itself is server-only'
  );
});

// ---------------------------------------------------------------------------
// 9. Expired quotes
// ---------------------------------------------------------------------------

test('the server refuses a quote whose expiry has passed', () => {
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "if v_quote.expires_at <= now() then raise exception 'This fare has expired. Refresh to get a current price.'"
    ),
    'expiry is checked against the database clock, not the browser'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes("check (status in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED')"),
    'expiry is also a visible status'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes("'quote_ttl_minutes'"),
    'the TTL is configurable, with a documented default'
  );
});

test('the client hides an expired quote and counts down honestly', () => {
  const quoteAt = (expiresAt: string): ErrandsQuote => ({
    quoteId: 'q1',
    serviceCategory: 'ERRAND_MOTORCYCLE',
    pickupAddress: 'Osu, Accra',
    destinationAddress: 'East Legon, Accra',
    straightLineKm: 3.63,
    distanceKm: 4.5,
    distanceSource: 'ROAD_ROUTE',
    routeProvider: 'GOOGLE_ROUTES',
    routeDistanceMetres: 4500,
    estimatedDurationSeconds: 900,
    perKmRate: 2,
    surgeMultiplier: 1,
    baseFare: 5,
    distanceCharge: 9,
    timeCharge: 0,
    waitingCharge: 0,
    bookingFee: 0,
    surgeAmount: 0,
    discountAmount: 0,
    tripFare: 14,
    taxAmount: 0,
    estimatedFare: 14,
    minFare: 0,
    maxFare: null,
    driverEarning: 14,
    surgeRuleActive: false,
    variableChargeNote: null,
    routeNote: null,
    currency: 'GHS',
    pricingVersion: 1,
    status: 'ACTIVE',
    issuedAt: new Date(Date.parse(expiresAt) - 300_000).toISOString(),
    expiresAt,
  });

  const now = Date.now();
  const live = quoteAt(new Date(now + 60_000).toISOString());
  const dead = quoteAt(new Date(now - 1_000).toISOString());

  assert.equal(isQuoteUsable(live, now), true, 'inside the TTL it is usable');
  assert.equal(isQuoteUsable(dead, now), false, 'past it, never');
  assert.equal(isQuoteUsable(null, now), false);
  assert.equal(
    secondsUntilQuoteExpiry(dead, now),
    0,
    'the countdown never goes negative'
  );
  assert.equal(secondsUntilQuoteExpiry(live, now), 60);
});

// ---------------------------------------------------------------------------
// 10. Modified client fares
// ---------------------------------------------------------------------------

test('the booking call posts IDs only — no fare, no distance, no earnings', () => {
  const rpcBlock = BOOKING_LIB.slice(
    BOOKING_LIB.indexOf("rpc('create_errands_booking'"),
    BOOKING_LIB.indexOf("rpc('create_errands_booking'") + 220
  );
  assert.ok(rpcBlock.length > 0, 'the client books through the RPC');
  assert.ok(/p_quote_id: input\.quoteId/.test(rpcBlock), 'it sends the quote id');
  assert.ok(/p_driver_id: input\.driverId/.test(rpcBlock), 'and the driver id');
  assert.equal(
    /p_estimated_fare|p_fare|p_distance|p_base_fare|p_driver_earning/.test(rpcBlock),
    false,
    'and nothing that could carry a price'
  );
  assert.equal(
    /estimatedFare|distanceKm|driverEarning/.test(rpcBlock),
    false,
    'no client-side money fields anywhere near the call'
  );
});

test('the server re-prices under the CURRENT rules and reports any change', () => {
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'The fare changed while you were reviewing it. Refresh the price to see the new amount before confirming.'"
    ),
    'a moved price is reported, never silently replaced'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'This fare quote is no longer valid. Please request a fresh quote.'"
    ),
    'a quote that does not belong to the customer is refused'
  );
  assert.equal(
    /create_errands_booking[\s\S]{0,4000}?p_estimated_fare/.test(MIGRATION),
    false,
    'the booking RPC accepts no fare argument to tamper with'
  );
});

// ---------------------------------------------------------------------------
// 11. Driver unavailability
// ---------------------------------------------------------------------------

test('discovery and booking share ONE eligibility function', () => {
  assert.ok(
    /rpc\('errands_nearby_drivers'/.test(DISCOVERY_LIB),
    'the customer only ever sees drivers the server deems eligible'
  );
  assert.ok(
    /errands_driver_is_available/.test(MIGRATION),
    'the eligibility function exists in the migration'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "if not public.errands_service_enabled(p_service_category) then return false; end if;"
    ),
    'a switched-off service has no eligible drivers at all'
  );
  for (const gate of [
    'if coalesce(v_c.is_approved, false) = false then return false; end if;',
    "if v_c.verification_status <> 'APPROVED' then return false; end if;",
    'if coalesce(v_c.is_online, false) = false then return false; end if;',
    "if v_c.availability_status <> 'AVAILABLE' then return false; end if;",
  ]) {
    assert.ok(MIGRATION_STRIPPED.includes(gate), `eligibility gate present: ${gate.slice(4, 40)}`);
  }
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "v_c.current_location_updated_at < now() - interval '2 minutes'"
    ),
    'a stale position is never presented as a live driver'
  );
});

test('a driver who disappears between selection and confirmation is refused', () => {
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'That driver just became unavailable. Please select another eligible driver.'"
    ),
    'the availability re-check happens inside the booking transaction'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'That driver is no longer available. Please select another eligible driver.'"
    ),
    'and a missing driver is reported the same way'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'This service is not available right now.'"
    ),
    'a service switched off mid-flow is reported honestly'
  );
});

// ---------------------------------------------------------------------------
// 12. Concurrent bookings
// ---------------------------------------------------------------------------

test('the driver row is locked so two bookings cannot claim one driver', () => {
  assert.ok(
    /for update of c;/.test(MIGRATION),
    'the courier row is locked FOR UPDATE before anything is decided'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'You already have an Errand in progress. Finish or cancel it first.'"
    ),
    'a customer cannot open a second errand either'
  );
});

test('a quote is single-use: it is consumed inside the same transaction', () => {
  assert.ok(
    /and consumed_at is null/.test(MIGRATION),
    'the quote is claimed only while unused'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'This fare quote has already been used. Please request a fresh quote.'"
    ),
    'a second attempt with the same quote is refused'
  );
  assert.ok(
    /where id = v_quote\.id and consumed_at is null/.test(MIGRATION),
    'the claim is a conditional UPDATE, so a race loses rather than double-books'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes("check (status in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED')"),
    'and the quote carries a visible lifecycle'
  );
});

// ---------------------------------------------------------------------------
// 13. Pricing change after a quote was issued
// ---------------------------------------------------------------------------

test('rule rows are versioned and only one version is active at a time', () => {
  assert.ok(
    /select coalesce\(max\(pricing_version\), 0\) \+ 1/.test(MIGRATION),
    'each save increments the version instead of overwriting history'
  );
  assert.ok(
    /set is_active = false,/.test(MIGRATION),
    'saving a replacement retires the previous active row'
  );
  assert.ok(
    /create unique index if not exists errands_pricing_rules_active_uniq/.test(MIGRATION),
    'and the index guarantees exactly one active row per category'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      'revoke all on table public.errands_pricing_rules from anon'
    ),
    'the price list is not writable (or even readable) from the browser'
  );
});

test('a quote snapshots the rules it was priced with', () => {
  assert.ok(
    /add column if not exists pricing_rules_id\s+uuid/.test(MIGRATION),
    'the quote points at the exact rule row'
  );
  assert.ok(
    /add column if not exists fare_breakdown\s+jsonb/.test(MIGRATION),
    'and stores the whole breakdown it showed the customer'
  );
  assert.ok(
    /'pricing_rules_id', case/.test(MIGRATION),
    'the id is part of the breakdown returned to the client'
  );
  assert.ok(
    MIGRATION_STRIPPED.includes(
      "raise exception 'The fare changed while you were reviewing it. Refresh the price to see the new amount before confirming.'"
    ),
    'so a later price change is detected instead of silently applied'
  );
});

test('the admin screen never writes the rules table directly', () => {
  assert.equal(
    /\.from\('errands_pricing_rules'\)[\s\S]{0,80}?\.(insert|update|delete)/.test(ADMIN_PAGE),
    false,
    'no client-side INSERT/UPDATE/DELETE on the price list'
  );
  assert.ok(
    /fetchErrandsPricingRules|rpc\('get_errands_pricing_rules'\)/.test(CONFIG_LIB),
    'the rules are read through the read-only RPC'
  );
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
