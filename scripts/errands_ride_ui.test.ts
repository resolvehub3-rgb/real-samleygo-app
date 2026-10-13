/**
 * SamleyGo Errands — the ride-selection screen.
 *
 *   npm run test:ride   (tsx scripts/errands_ride_ui.test.ts)
 *
 * What is covered:
 *   1. The service list only offers categories the backend actually prices —
 *      there is no "Okada" or any other invented option, and the button label
 *      always names the chosen service (never another company's product).
 *   2. No promotional/discount strip, no hardcoded sample fares, no third
 *      party's brand anywhere in the screen.
 *   3. Vehicle art is self-contained inline SVG (consistent canvas, no emoji,
 *      no remote image URLs, nothing that touches SamleyGo's own artwork).
 *   4. Pickup ETAs and drop-off arrival times are measurements or nothing —
 *      `null` renders the label alone rather than a fabricated minute count.
 *   5. Pricing is automatic: no "calculate price" button, and a failure always
 *      offers a retry instead of a made-up number.
 *   6. The bottom sheet: handle-first structure, fixed footer, gestures that
 *      never fight the list or the map, heights owned by CSS so a re-render
 *      cannot reset a drag in progress.
 *   7. Payment and scheduling are honest — only methods the platform records,
 *      persisted through the secure RPC; scheduling says plainly that it is
 *      not supported instead of pretending to book a future trip.
 *   8. The location bar edits real endpoints and its close button leaves the
 *      screen without ever touching a booking.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ERRANDS_PAYMENT_METHODS,
  RIDE_OPTION_BLURBS,
  RIDE_OPTION_LABELS,
  errandsPaymentLabel,
  formatArrivalClock,
  formatPickupEta,
  isErrandsPaymentMethod,
  selectRideLabel,
} from '../src/lib/errands/rideOptions';
import { ERRANDS_SERVICES, ERRANDS_SERVICE_LABELS } from '../src/lib/errands/types';

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

const PAGE = read('src', 'pages', 'customer', 'ErrandsPage.tsx');
const SHEET = read('src', 'components', 'errands', 'RideSheet.tsx');
const BAR = read('src', 'components', 'errands', 'RideLocationBar.tsx');
const MAP = read('src', 'components', 'errands', 'ErrandsMap.tsx');
const ART = read('src', 'components', 'errands', 'VehicleArt.tsx');
const CSS = read('src', 'index.css');
const BOOKING = read('src', 'lib', 'errands', 'booking.ts');
const CART = read('src', 'pages', 'customer', 'CartPage.tsx');

// ---------------------------------------------------------------------------
// 1. The services that exist are the services the backend prices
// ---------------------------------------------------------------------------

test('the ride list names exactly the categories the backend can price', () => {
  assert.deepEqual(
    Object.keys(RIDE_OPTION_LABELS).sort(),
    [...ERRANDS_SERVICES].sort(),
    'every backend category needs a display name, and no extra one may exist'
  );
  assert.deepEqual(
    Object.keys(RIDE_OPTION_BLURBS).sort(),
    [...ERRANDS_SERVICES].sort(),
    'and a one-line honest description'
  );
  assert.equal(RIDE_OPTION_LABELS.RIDE_CAR, 'Car Ride');
  assert.equal(RIDE_OPTION_LABELS.ERRAND_MOTORCYCLE, 'Send Motorbike');
  assert.equal(RIDE_OPTION_LABELS.CAR_ERRAND, 'Car Delivery');
});

test('no category the backend does not price is offered as bookable', () => {
  const offered = Object.values(RIDE_OPTION_LABELS).join(' ').toLowerCase();
  const blurb = Object.values(RIDE_OPTION_BLURBS).join(' ').toLowerCase();
  for (const invented of ['okada', 'keke', 'tricycle', 'shuttle', 'premium', 'hatchback']) {
    assert.equal(offered.includes(invented), false, `"${invented}" has no backend category`);
    assert.equal(blurb.includes(invented), false, `"${invented}" has no backend category`);
  }
  // The screen renders from that map — it never hardcodes a service name.
  assert.ok(PAGE.includes('RIDE_OPTION_LABELS[option]'), 'rows read their label from the map');
  assert.equal(
    /Okada/.test(PAGE),
    false,
    'an unconfigured/unsupported category must never be rendered'
  );
});

test('the button label names the chosen service — never another company', () => {
  assert.equal(selectRideLabel('RIDE_CAR'), 'Select Car Ride');
  assert.equal(selectRideLabel('ERRAND_MOTORCYCLE'), 'Select Send Motorbike');
  assert.equal(selectRideLabel('CAR_ERRAND'), 'Select Car Delivery');
  assert.ok(PAGE.includes('selectRideLabel(service)'), 'the footer builds its label from it');

  const haystack = `${PAGE} ${SHEET} ${BAR} ${ART}`.toLowerCase();
  for (const brand of ['bolt', 'uber', 'inride', 'in-driver', 'yango', 'lyft', 'careem']) {
    assert.equal(haystack.includes(brand), false, `"${brand}" must never appear in this module`);
  }
});

// ---------------------------------------------------------------------------
// 2. No promo strip, no invented money
// ---------------------------------------------------------------------------

test('the sheet carries no promotional or discount strip', () => {
  const haystack = `${PAGE} ${SHEET} ${BAR}`.toLowerCase();
  for (const banned of ['5% off', '% off on', 'off on premium', 'voucher', 'coupon', 'promo code']) {
    assert.equal(haystack.includes(banned), false, `"${banned}" is not part of this screen`);
  }
  // "Discount" may only ever describe a line of the server's own breakdown —
  // never a strip promoting one.
  assert.ok(
    PAGE.includes('quote.discountAmount'),
    'a discount, when shown, is a number the quote sent us'
  );
  assert.equal(
    /banner|marquee/i.test(PAGE),
    false,
    'the sheet starts at its handle — nothing promotional sits above it'
  );
  // The sheet begins at the handle — nothing sits above it.
  assert.ok(
    SHEET.includes('h-1 w-10 rounded-full bg-slate-300'),
    'the grey drag handle is the first thing under the sheet edge'
  );
  assert.ok(
    SHEET.indexOf('h-1 w-10 rounded-full bg-slate-300') < SHEET.indexOf('{children}'),
    'and it precedes the scrollable list'
  );
});

test('no hardcoded sample fare can leak into a row or a button', () => {
  const haystack = `${PAGE} ${SHEET}`.replace(/\s/g, '');
  // The reference fares from the design mock must never ship as literals.
  for (const literal of ['GH₵16', 'GH₵19', 'GH₵21', 'GH₵23', 'GHS16', 'GHS19', 'GHS21', 'GHS23']) {
    assert.equal(haystack.includes(literal.replace(/\s/g, '')), false, `${literal} is a mock price`);
  }
  // Every amount on screen is the server's number, formatted — never parsed
  // out of a string, never computed in the browser.
  assert.ok(PAGE.includes('formatGHS(estimate.estimatedFare)'), 'row fares come from the quote');
  assert.equal(
    /estimatedFare\s*[:=]\s*\d/.test(PAGE),
    false,
    'the page must never assign a fare of its own'
  );
});

// ---------------------------------------------------------------------------
// 3. Vehicle art
// ---------------------------------------------------------------------------

test('vehicle art is self-contained inline SVG — no emoji, no remote images', () => {
  assert.ok(ART.includes('<svg'), 'the art is inline SVG');
  assert.equal(/<img/.test(ART), false, 'no <img> tags — a broken link must be impossible');
  assert.equal(
    /https?:\/\/(?!www\.w3\.org)/.test(ART),
    false,
    'no remote artwork URLs (the SVG namespace is the only URL allowed)'
  );
  assert.equal(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ART),
    false,
    'vehicle art is drawn, never an emoji'
  );
  assert.equal(
    /from 'lucide-react'/.test(ART),
    false,
    'icons are not vehicle illustrations'
  );
});

test('every illustration shares one canvas and one scale', () => {
  const viewBoxes = ART.match(/viewBox: '0 0 128 72'/g) ?? [];
  assert.ok(viewBoxes.length >= 1, 'the shared canvas is declared once and reused');
  assert.ok(
    ART.includes('className: className ??'),
    'the caller controls the rendered size so rows stay aligned'
  );
  assert.ok(ART.includes('RIDE_VEHICLE_ART'), 'one illustration per service category');
  assert.ok(PAGE.includes('RIDE_VEHICLE_ART[option]'), 'rows render from that map');
  // Brand colours only — the art must not recolour the product.
  assert.ok(ART.includes('#059669'), 'brand green accents');
});

// ---------------------------------------------------------------------------
// 4. Callouts: a measurement or nothing
// ---------------------------------------------------------------------------

test('the pickup ETA is a measurement or it is absent', () => {
  assert.equal(formatPickupEta(null), null, 'no route → no minute count');
  assert.equal(formatPickupEta(undefined), null);
  assert.equal(formatPickupEta(0), null);
  assert.equal(formatPickupEta(-90), null, 'a negative ETA is nonsense, not a number');
  assert.equal(formatPickupEta(Number.NaN), null);
  assert.equal(formatPickupEta(8 * 60), '8 min');
  assert.equal(formatPickupEta(45), '1 min', 'a sub-minute walk rounds up — never "0 min"');
  assert.equal(formatPickupEta(150), '3 min');
});

test('the arrival clock is built from a real duration, or it is absent', () => {
  assert.equal(formatArrivalClock(null), null);
  assert.equal(formatArrivalClock(undefined), null);
  assert.equal(formatArrivalClock(0), null);
  assert.equal(formatArrivalClock(-60), null);
  assert.equal(formatArrivalClock(Number.NaN), null);

  const label = formatArrivalClock(30 * 60, Date.UTC(2026, 0, 1, 10, 0, 0));
  assert.match(label ?? '', /^\d{1,2}:\d{2}$/, 'a plain clock label, no invented meridiem');
});

test('the two callouts are distinct, anchored and never build markup from values', () => {
  assert.ok(CSS.includes('.sg-callout--pickup'), 'green pickup pill');
  assert.ok(CSS.includes('.sg-callout--dropoff'), 'dark-green drop-off pill');
  assert.ok(CSS.includes('.sg-callout-anchor'), 'the 0×0 anchor sits exactly on the coordinate');
  assert.ok(MAP.includes("makeCallout('Pickup'"), 'the map renders the pickup callout');
  assert.ok(MAP.includes("makeCallout('Dropoff'"), 'and the drop-off one');
  assert.equal(
    /pill\.innerHTML\s*=/.test(MAP),
    false,
    'callout text must be written with textContent, never interpreted as markup'
  );
  // A missing value renders the label alone — the page passes `?? null`.
  assert.ok(MAP.includes('pickupCallout = null') && MAP.includes('destinationCallout = null'));
});

// ---------------------------------------------------------------------------
// 5. Automatic pricing
// ---------------------------------------------------------------------------

test('pricing is automatic: no calculate button, and failures offer a retry', () => {
  assert.equal(
    />\s*Calculate price/i.test(PAGE),
    false,
    'there is no manual price step — fares refresh on their own'
  );
  assert.ok(PAGE.includes('estimateFor(option)'), 'each row prices itself from the quote pass');
  assert.ok(PAGE.includes("onClick={() => void handleGetFare()}"), 'a failure can be retried');
  assert.ok(PAGE.includes("'Retry'"), 'and says so plainly');
  assert.ok(PAGE.includes("'Refresh price'"), 'an expired price can be refreshed');
  assert.ok(PAGE.includes('Choose your pickup and destination'), 'no points → no price, said out loud');
});

test('badges only appear when at least two options can honestly be compared', () => {
  assert.ok(PAGE.includes('lowestFareOption'), 'the lowest-fare chip is computed');
  assert.ok(PAGE.includes('fastestPickupOption'), 'the fastest-pickup chip is computed');
  assert.ok(
    PAGE.includes('comparableFares.length >= 2'),
    'no fare chip without a genuine second price'
  );
  assert.ok(
    PAGE.includes('comparableEtas.length >= 2'),
    'no speed chip without a genuine second ETA'
  );
});

// ---------------------------------------------------------------------------
// 6. The bottom sheet
// ---------------------------------------------------------------------------

test('the sheet keeps a fixed footer and scrolls only its own list', () => {
  assert.ok(SHEET.includes('min-h-0 flex-1 overflow-y-auto'), 'the body is the scroller');
  assert.ok(SHEET.includes('overscroll-contain'), 'scrolling must not chain onto the map');
  assert.ok(
    SHEET.includes('<div className="shrink-0 border-t border-slate-100 bg-white px-4'),
    'the booking footer is pinned, never scrolled away'
  );
  assert.ok(PAGE.includes('sheetFooter'), 'the page supplies that footer');
});

test('only the handle drags the sheet — the list and the map keep their gestures', () => {
  assert.equal(
    (SHEET.match(/onPointerMove=/g) ?? []).length,
    1,
    'exactly one zone captures a drag: the handle'
  );
  assert.ok(SHEET.includes('touch-none'), 'the handle opts out of browser scrolling');
  assert.ok(SHEET.includes('setPointerCapture'), 'the drag survives leaving the bar');
  assert.equal(
    (SHEET.match(/handlePointerMove/g) ?? []).length,
    2,
    'the drag handler is defined once and attached to the handle once — never to the list'
  );
});

test('the resting heights live in CSS so a re-render cannot reset a drag', () => {
  assert.ok(CSS.includes('.sg-sheet'), 'the sheet has a CSS height rule');
  assert.ok(CSS.includes("[data-expanded='true']"), 'and expands via a data attribute');
  assert.equal(
    /style=\{\{[^}]*height/.test(SHEET),
    false,
    'React must not own the value being dragged'
  );
  assert.ok(SHEET.includes("sheet.style.height = `${next}px`"), 'the drag writes it imperatively');
});

// ---------------------------------------------------------------------------
// 7. Payment and scheduling are honest
// ---------------------------------------------------------------------------

test('the payment selector only offers methods the platform already records', () => {
  assert.deepEqual(
    ERRANDS_PAYMENT_METHODS.map((method) => method.id),
    ['CASH', 'MTN_MOMO', 'TELECEL_CASH', 'AT_MONEY', 'CARD']
  );
  for (const method of ERRANDS_PAYMENT_METHODS) {
    assert.ok(
      CART.includes(`'${method.id}'`),
      `${method.id} must be a method the food checkout also offers`
    );
  }
  assert.equal(isErrandsPaymentMethod('APPLE_PAY'), false, 'nothing invented');
  assert.equal(isErrandsPaymentMethod('CASH'), true);
  assert.equal(errandsPaymentLabel('nonsense'), 'Cash', 'an unknown tender reads as cash, not a lie');

  assert.ok(PAGE.includes('ERRANDS_PAYMENT_METHODS.map'), 'the selector renders the shared list');
  assert.ok(PAGE.includes('Only payment methods SamleyGo already supports are listed'), 'said out loud');
  assert.equal(
    /Apple Pay|Google Pay|Stripe|Paystack Checkout/i.test(PAGE),
    false,
    'no provider the backend does not use'
  );
});

test('the chosen payment method is persisted through the secure RPC', () => {
  assert.ok(BOOKING.includes('p_payment_method'), 'the tender travels with the booking');
  assert.ok(BOOKING.includes('DEFAULT_ERRANDS_PAYMENT_METHOD'), 'and falls back to cash');
  assert.equal(
    /p_estimated_fare|p_final_fare|p_driver_earning/.test(BOOKING),
    false,
    'money still never travels from the browser'
  );
  assert.ok(
    /p_quote_id[\s\S]{0,160}p_driver_id/.test(BOOKING),
    'booking still identifies the quote and the driver, nothing else'
  );
  assert.ok(PAGE.includes('paymentMethod,'), 'the page sends what the customer picked');
  assert.ok(PAGE.includes('activeBooking.paymentMethod'), 'and the trip card shows it back');

  const migration = read(
    'supabase',
    'migrations',
    '20261014_errands_booking_payment_method.sql'
  );
  assert.ok(migration.includes("default 'CASH'"), 'cash is the column default');
  assert.ok(migration.includes("'CASH', 'MTN_MOMO', 'TELECEL_CASH', 'AT_MONEY', 'CARD'"), 'CHECKed');
  assert.ok(migration.includes('customer_id = v_uid'), 'only the caller\'s own row is updated');
  assert.ok(
    migration.includes('public.create_errands_booking(p_quote_id, p_driver_id)'),
    'the booking body is reused, never duplicated'
  );
});

test('the schedule control never pretends a future trip can be booked', () => {
  assert.ok(PAGE.includes('Scheduling is not available yet'), 'said plainly');
  assert.ok(PAGE.includes('CalendarClock'), 'the reference-style circular button is rendered');
  assert.ok(PAGE.includes('aria-disabled="true"'), 'and it is marked unavailable');
  assert.equal(
    /rpc\('[^']*schedul/i.test(PAGE),
    false,
    'there is no scheduling RPC — the button must not call one'
  );
  assert.equal(
    /scheduled_at|starts_at|schedule_at/i.test(PAGE),
    false,
    'no scheduling column exists, so none may be referenced'
  );
});

// ---------------------------------------------------------------------------
// 8. The location bar
// ---------------------------------------------------------------------------

test('the location bar edits real endpoints and truncates instead of wrapping', () => {
  assert.ok(BAR.includes('onEditPickup') && BAR.includes('onEditDestination'), 'tap to edit');
  assert.ok((BAR.match(/truncate/g) ?? []).length >= 2, 'both addresses truncate with an ellipsis');
  assert.ok(BAR.includes('onAddStop'), 'the + control is real');
  assert.ok(PAGE.includes('Adding a stop is not supported'), 'and honest about stops');
  assert.ok(PAGE.includes('<AddressSearchField'), 'editing goes through the real address search');
});

test('the location bar close button leaves the screen and never touches a booking', () => {
  const closeBody = PAGE.match(
    /const handleClose[\s\S]{0,420}?\}, \[navigate\]\);/
  )?.[0];
  assert.ok(closeBody, 'the close handler must exist');
  assert.equal(
    /setErrandsBookingStatus|createErrandsBooking|CANCELLED/.test(closeBody!),
    false,
    'closing the screen must never cancel, book or move a booking'
  );
  assert.ok(/navigate\(-1\)/.test(closeBody!) && /navigate\('\/'\)/.test(closeBody!), 'back, with a fallback');
});

// ---------------------------------------------------------------------------
// 9. The map keeps its ride-selection role
// ---------------------------------------------------------------------------

test('the map has a recenter control that only ever uses a real fix', () => {
  assert.ok(MAP.includes('LocateFixed'), 'the right-hand recenter control');
  assert.ok(MAP.includes('onRecenter'), 'and it asks the page for a position');
  assert.equal(
    /navigator\.geolocation\.getCurrentPosition\(\s*\(\)\s*=>/.test(MAP),
    false,
    'the map component never invents a position of its own'
  );
  assert.ok(MAP.includes('userLocation'), 'the dot is the customer\'s shared GPS, or nothing');
  assert.ok(PAGE.includes('onRecenter={() => void refreshUserLocation()}'), 'wired to the page');
});

test('the route is drawn dark and the endpoints are circular markers', () => {
  assert.ok(MAP.includes("strokeColor: '#065f46'"), 'the dark route line');
  assert.ok(MAP.includes("makeEndpointPin('pickup')") && MAP.includes("makeEndpointPin('dropoff')"));
  assert.ok(MAP.includes("google.maps.ControlPosition.RIGHT_CENTER"), 'zoom kept clear of the controls');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
