/**
 * SamleyGo courier navigation — test suite.
 *
 *   pnpm test   (tsx scripts/navigation.test.ts)
 *
 * What is covered:
 *   1. Coordinate validation — range checks, null island, strings/NaN, the
 *      Ghana lat/lng swap correction, and the refusal to guess array order.
 *   2. The ONE status → phase machine, including the rule that a phase NEVER
 *      falls back to the other pin (no confident route to the wrong place).
 *   3. Turn-by-turn instructions generated from real routing maneuvers.
 *   4. Route projection: where the courier is along the route, how far off it
 *      is, the next maneuver and the road it is driving on.
 *   5. Deviation thresholds (scaled by GPS accuracy, streak required) and the
 *      reroute gate (debounce, cooldown, failure backoff, route staleness).
 *   6. The GPS fix filter: accuracy, staleness, out-of-order and teleport
 *      rejection.
 *   7. The navigation session store: one session, newest order wins, clean end.
 *   8. Source scans — navigation uses the step-aware route with the courier as
 *      origin, the HUD is courier-only, customers timestamp-guard their pings,
 *      and the delivery fee still prices the real road distance.
 *
 * IMPORTANT: the routing engine and the database remain the authorities. These
 * tests lock down the pure logic the courier's phone runs between fixes, and
 * the wiring invariants that keep the maps honest.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildInstruction,
  compassLabel,
  createGpsFilter,
  currentRoadName,
  destinationForPhase,
  endNavigationSession,
  evaluateReroute,
  getNavigationSession,
  gpsRejectionMessage,
  haversineMeters,
  isOffRoute,
  isValidCoordinate,
  nextManeuver,
  normalizeCoordinate,
  projectOnRoute,
  recordSessionRoute,
  resolveNavigationPhase,
  subscribeNavigationSession,
  syncNavigationSession,
  DEVIATION_COOLDOWN_MS,
  OFF_ROUTE_STREAK_REQUIRED,
  REROUTE_MIN_GAP_MS,
  ROUTE_MAX_AGE_MS,
  type NavigationRoute,
  type NavigationStep,
} from '../src/lib/navigation';

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

/** Drop comments so source scans look at behaviour, not prose. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every .ts/.tsx file under `src` whose text contains `needle`. */
const filesWith = (needle: string): string[] => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && readFileSync(full, 'utf8').includes(needle)) {
        hits.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return hits.sort();
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Osu, Accra — a real Ghanaian coordinate pair. */
const ACCRA = { lat: 5.6037, lng: -0.187 };
const KITCHEN = { lat: 5.6037, lng: -0.187 };
const CUSTOMER = { lat: 5.6101, lng: -0.1912 };

/** East→west street at lat 5.6: 0.01° of longitude ≈ 1108 m. */
const EAST_WEST = [
  { lat: 5.6, lng: -0.2 },
  { lat: 5.6, lng: -0.19 },
  { lat: 5.6, lng: -0.18 },
];

const makeStep = (over: Partial<NavigationStep>): NavigationStep => ({
  instruction: 'Continue',
  distanceMeters: 1100,
  durationSeconds: 180,
  maneuverType: 'continue',
  roadName: 'Oxford Street',
  location: KITCHEN,
  cumulativeMeters: 0,
  ...over,
});

const SAMPLE_ROUTE: NavigationRoute = {
  distanceMeters: 2216,
  durationSeconds: 360,
  geometry: { coordinates: EAST_WEST },
  steps: [
    makeStep({
      instruction: 'Head east on Oxford Street',
      maneuverType: 'depart',
      cumulativeMeters: 0,
    }),
    makeStep({
      instruction: 'Turn right onto Ring Road',
      maneuverType: 'turn',
      maneuverModifier: 'right',
      roadName: 'Ring Road',
      cumulativeMeters: 1100,
    }),
    makeStep({
      instruction: 'You have arrived',
      maneuverType: 'arrive',
      roadName: 'Palace Road',
      cumulativeMeters: 2200,
      distanceMeters: 0,
      durationSeconds: 0,
    }),
  ],
  calculatedAt: '2026-10-04T09:00:00.000Z',
  provider: 'TEST',
};

// ---------------------------------------------------------------------------

console.log('\n1. Coordinates');

test('a valid Ghana coordinate passes through untouched', () => {
  const norm = normalizeCoordinate(ACCRA);
  assert.ok(norm, 'a real Accra point must be accepted');
  assert.deepEqual(norm.point, ACCRA, 'the canonical format is { lat, lng }');
  assert.equal(norm.wasSwapped, false, 'nothing to correct');
  assert.equal(isValidCoordinate(ACCRA), true);
});

test('invalid coordinates are rejected, never guessed', () => {
  const bad: unknown[] = [
    null,
    undefined,
    '5.6037,-0.187',
    [-0.187, 5.6037], // array order cannot be inferred safely
    { lat: Number.NaN, lng: -0.187 },
    { lat: '5.6037', lng: '-0.187' }, // strings are not coordinates
    { lat: 91, lng: -0.187 },
    { lat: 5.6037, lng: 181 },
    { lat: 0, lng: 0 }, // null island — the "never filled in" artifact
    { lat: 5.6037 },
    {},
  ];

  for (const value of bad) {
    const label = JSON.stringify(value) ?? String(value);
    assert.equal(normalizeCoordinate(value as never), null, `${label} must be rejected`);
    assert.equal(isValidCoordinate(value as never), false, `${label} must be invalid`);
  }
});

test('a Ghana lat/lng swap is corrected at the routing boundary', () => {
  const swapped = normalizeCoordinate({ lat: -0.187, lng: 5.6037 });
  assert.ok(swapped);
  assert.equal(swapped.wasSwapped, true, 'reversed, it lands in Ghana');
  assert.deepEqual(swapped.point, { lat: 5.6037, lng: -0.187 });

  // Outside Ghana there is nothing to infer — the point stays as given.
  const paris = normalizeCoordinate({ lat: 48.85, lng: 2.35 });
  assert.ok(paris);
  assert.equal(paris.wasSwapped, false);
  assert.deepEqual(paris.point, { lat: 48.85, lng: 2.35 });

  // The `latitude`/`longitude` spelling is accepted too.
  const spelled = normalizeCoordinate({ latitude: 5.6037, longitude: -0.187 });
  assert.ok(spelled);
  assert.deepEqual(spelled.point, ACCRA);
});

test('distance and bearing use real geometry', () => {
  const north = { lat: 5.6137, lng: -0.187 };
  const metres = haversineMeters(ACCRA, north);
  assert.ok(metres > 1100 && metres < 1120, `0.01° of latitude ≈ 1111 m, got ${metres}`);
  assert.equal(compassLabel(0), 'north');
  assert.equal(compassLabel(90), 'east');
  assert.equal(compassLabel(null), 'ahead');
});

// ---------------------------------------------------------------------------

console.log('\n2. Status → phase (ONE source of truth)');

test('the real order status drives the phase', () => {
  const pins = { hasPickup: true, hasDestination: true };

  for (const status of ['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'READY_FOR_PICKUP']) {
    assert.equal(resolveNavigationPhase(status, pins), 'TO_RESTAURANT', status);
  }
  for (const status of ['PICKED_UP', 'ON_THE_WAY']) {
    assert.equal(resolveNavigationPhase(status, pins), 'TO_CUSTOMER', status);
  }
  assert.equal(resolveNavigationPhase('ARRIVED', pins), 'ARRIVED');
  for (const status of ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'REFUNDED']) {
    assert.equal(resolveNavigationPhase(status, pins), 'IDLE', `${status} must not navigate`);
  }
});

test('a phase never falls back to the wrong pin', () => {
  const destinationOnly = { hasPickup: false, hasDestination: true };
  const pickupOnly = { hasPickup: true, hasDestination: false };

  // Still driving to the kitchen, but the kitchen has no coordinates: show no
  // route rather than a confident line to the customer.
  assert.equal(resolveNavigationPhase('COURIER_ASSIGNED', destinationOnly), 'IDLE');
  // Food is on board but the drop-off is unknown: never back to the kitchen.
  assert.equal(resolveNavigationPhase('PICKED_UP', pickupOnly), 'IDLE');
  assert.equal(resolveNavigationPhase('ARRIVED', pickupOnly), 'IDLE');
  // Order not loaded yet: pickup first, otherwise nothing.
  assert.equal(resolveNavigationPhase(null, pickupOnly), 'TO_RESTAURANT');
  assert.equal(resolveNavigationPhase(undefined, destinationOnly), 'IDLE');
});

test('a phase resolves to exactly its own destination', () => {
  assert.deepEqual(destinationForPhase('TO_RESTAURANT', KITCHEN, CUSTOMER), KITCHEN);
  assert.deepEqual(destinationForPhase('TO_CUSTOMER', KITCHEN, CUSTOMER), CUSTOMER);
  assert.deepEqual(destinationForPhase('ARRIVED', KITCHEN, CUSTOMER), CUSTOMER);
  assert.equal(destinationForPhase('IDLE', KITCHEN, CUSTOMER), null);
  assert.equal(destinationForPhase('TO_RESTAURANT', null, CUSTOMER), null, 'never the wrong pin');
  assert.equal(destinationForPhase('TO_CUSTOMER', KITCHEN, null), null, 'never the wrong pin');
});

// ---------------------------------------------------------------------------

console.log('\n3. Turn-by-turn instructions');

test('instructions are generated from routing maneuvers', () => {
  assert.equal(
    buildInstruction({ type: 'depart', bearingAfter: 90, name: 'Oxford Street' }),
    'Head east on Oxford Street'
  );
  assert.equal(buildInstruction({ type: 'turn', modifier: 'left', name: 'Ring Road' }), 'Turn left onto Ring Road');
  assert.equal(buildInstruction({ type: 'turn', modifier: 'right' }), 'Turn right');
  assert.equal(buildInstruction({ type: 'arrive' }), 'You have arrived');
  assert.equal(
    buildInstruction({ type: 'roundabout', exit: 2, name: 'Palace Road' }),
    'At the roundabout, take exit 2 onto Palace Road'
  );
  assert.equal(
    buildInstruction({ type: 'fork', modifier: 'slight right', name: 'Spintex Road' }),
    'Keep right onto Spintex Road'
  );
  assert.equal(buildInstruction({ type: 'new name', name: '37 Street' }), 'Continue onto 37 Street');
  assert.equal(buildInstruction({ type: 'continue' }), 'Continue straight');
  assert.equal(buildInstruction({ type: 'uturn', modifier: 'uturn' }), 'Make a U-turn');
  assert.equal(compassLabel(180), 'south');
});

// ---------------------------------------------------------------------------

console.log('\n4. Projection, next maneuver and remaining distance');

test('a fix projects onto the route it is driving', () => {
  const onRoute = projectOnRoute(SAMPLE_ROUTE, { lat: 5.6, lng: -0.19 });
  assert.ok(onRoute, 'a real geometry must project');
  assert.ok(
    Math.abs(onRoute.alongMeters - 1108) < 5,
    `0.01° of longitude ≈ 1108 m, got ${onRoute.alongMeters}`
  );
  assert.ok(onRoute.offRouteMeters < 1, 'a point on the line has no offset');

  const beside = projectOnRoute(SAMPLE_ROUTE, { lat: 5.601, lng: -0.19 });
  assert.ok(beside);
  assert.ok(
    Math.abs(beside.offRouteMeters - 111.3) < 4,
    `0.001° of latitude ≈ 111 m off the road, got ${beside.offRouteMeters}`
  );
  assert.ok(Math.abs(beside.alongMeters - onRoute.alongMeters) < 5, 'the offset does not slide along');

  assert.equal(projectOnRoute(null, ACCRA), null, 'no geometry → no projection');
  assert.equal(projectOnRoute({ geometry: { coordinates: [] } }, ACCRA), null);
});

test('the next maneuver and current road follow the courier along the route', () => {
  const first = nextManeuver(SAMPLE_ROUTE, 0);
  assert.ok(first);
  assert.equal(first.index, 1, 'the departure step counts as passed once moving');
  assert.equal(first.distanceMeters, 1100);
  assert.equal(first.step.instruction, 'Turn right onto Ring Road');

  const midway = nextManeuver(SAMPLE_ROUTE, 1105);
  assert.ok(midway);
  assert.equal(midway.index, 2);
  assert.equal(midway.distanceMeters, 1095);

  const done = nextManeuver(SAMPLE_ROUTE, 9999);
  assert.ok(done);
  assert.equal(done.distanceMeters, 0, 'nothing left to announce');

  assert.equal(currentRoadName(SAMPLE_ROUTE, 500), 'Oxford Street');
  assert.equal(currentRoadName(SAMPLE_ROUTE, 1105), 'Ring Road');
  assert.equal(nextManeuver({ steps: [] }, 0), null, 'no steps → no invented instruction');
  assert.equal(currentRoadName(null, 0), null);

  const projection = projectOnRoute(SAMPLE_ROUTE, { lat: 5.6, lng: -0.19 });
  assert.ok(projection);
  const remaining = Math.round(SAMPLE_ROUTE.distanceMeters - projection.alongMeters);
  assert.ok(remaining > 1100 && remaining < 1110, `remaining ≈ 1108 m, got ${remaining}`);
});

// ---------------------------------------------------------------------------

console.log('\n5. Deviation detection & the reroute gate');

test('off-route thresholds scale with GPS accuracy', () => {
  assert.equal(isOffRoute(30, 30), false, 'a meter off the line is not a deviation');
  assert.equal(isOffRoute(100, 30), true, 'well beyond a 48 m threshold');
  assert.equal(isOffRoute(60, 120), false, 'a 120 m-accurate fix cannot prove a 60 m deviation');
  assert.equal(isOffRoute(200, 120), true, 'clamped to a 150 m ceiling');
  assert.equal(isOffRoute(120, 5_000), false, 'the ceiling also caps a hopeless fix');
  assert.equal(isOffRoute(null, 30), false, 'no projection → no deviation');
  assert.equal(OFF_ROUTE_STREAK_REQUIRED, 2, 'one noisy reading never reroutes');
});

test('a changed destination reroutes at once, everything else is gated', () => {
  const now = 1_700_000_000_000;

  assert.deepEqual(
    evaluateReroute({ now, hasRoute: true, destinationChanged: true, lastAttemptAt: now - 100 }),
    { recalculate: true, reason: 'DESTINATION_CHANGED' },
    'the old route is meaningless the moment the target changes'
  );

  // Deviation needs BOTH the streak and the cooldown.
  assert.equal(
    evaluateReroute({
      now,
      hasRoute: true,
      offRoute: true,
      offRouteStreak: 1,
      lastAttemptAt: now - 60_000,
    }).recalculate,
    false,
    'a single off-route fix is not enough'
  );
  assert.equal(
    evaluateReroute({
      now,
      hasRoute: true,
      offRoute: true,
      offRouteStreak: 2,
      lastAttemptAt: now - 5_000,
    }).recalculate,
    false,
    `debounced inside ${REROUTE_MIN_GAP_MS} ms`
  );
  assert.deepEqual(
    evaluateReroute({
      now,
      hasRoute: true,
      offRoute: true,
      offRouteStreak: 2,
      lastAttemptAt: now - (DEVIATION_COOLDOWN_MS + 2_000),
    }),
    { recalculate: true, reason: 'ROUTE_DEVIATION' }
  );
});

test('failures back off and stale routes are refreshed deliberately', () => {
  const now = 1_700_000_000_000;

  // No line at all: first attempt goes immediately, retries wait for backoff.
  assert.deepEqual(evaluateReroute({ now, hasRoute: false }), {
    recalculate: true,
    reason: 'NO_ROUTE',
  });
  assert.equal(
    evaluateReroute({ now, hasRoute: false, lastAttemptAt: now - 1_000, failureCount: 1 })
      .recalculate,
    false,
    'failure #1 backs off'
  );
  assert.deepEqual(
    evaluateReroute({ now, hasRoute: false, lastAttemptAt: now - 45_000, failureCount: 1 }),
    { recalculate: true, reason: 'PROVIDER_RETRY' }
  );

  // Origin staleness needs BOTH a real move and an old route.
  assert.deepEqual(
    evaluateReroute({
      now,
      hasRoute: true,
      lastAttemptAt: now - 20_000,
      movedFromRouteOriginMeters: 400,
      routeAgeMs: 60_000,
    }),
    { recalculate: true, reason: 'ROUTE_ORIGIN_STALE' }
  );
  assert.equal(
    evaluateReroute({
      now,
      hasRoute: true,
      lastAttemptAt: now - 20_000,
      movedFromRouteOriginMeters: 400,
      routeAgeMs: 5_000,
    }).recalculate,
    false,
    'a fresh route does not need a new origin'
  );
  assert.equal(
    evaluateReroute({
      now,
      hasRoute: true,
      lastAttemptAt: now - 20_000,
      movedFromRouteOriginMeters: 100,
      routeAgeMs: 60_000,
    }).recalculate,
    false,
    '100 m of jitter is not a stale origin'
  );

  assert.deepEqual(
    evaluateReroute({
      now,
      hasRoute: true,
      lastAttemptAt: now - 20_000,
      routeAgeMs: ROUTE_MAX_AGE_MS + 1,
    }),
    { recalculate: true, reason: 'ROUTE_EXPIRED' }
  );
});

// ---------------------------------------------------------------------------

console.log('\n6. GPS fix filter');

test('a clean fix passes the gate', () => {
  const now = 1_700_000_000_000;
  const verdict = createGpsFilter().accept(
    { ...ACCRA, accuracy: 12, heading: 120, speed: 8, timestamp: now },
    now
  );
  assert.deepEqual(verdict, { ok: true });
  assert.equal(gpsRejectionMessage(undefined), null);
});

test('a bad fix can never move the marker', () => {
  const now = 1_700_000_000_000;
  const filter = () => createGpsFilter();

  assert.equal(filter().accept({ lat: 0, lng: 0 }, now).reason, 'INVALID_COORDINATE');
  assert.equal(
    filter().accept({ lat: ACCRA.lat, lng: ACCRA.lng, timestamp: now - 60_000 }, now).reason,
    'STALE_TIMESTAMP',
    'a fix older than the allowed window is dropped'
  );
  assert.equal(
    filter()
      .accept({ lat: ACCRA.lat, lng: ACCRA.lng, accuracy: 5_000, timestamp: now }, now)
      .reason,
    'WEAK_ACCURACY',
    'a hopeless fix is always rejected'
  );
  assert.equal(gpsRejectionMessage('WEAK_ACCURACY'), 'GPS signal is weak — waiting for a better fix…');
  assert.equal(gpsRejectionMessage('STALE_TIMESTAMP'), null, 'out-of-order fixes are dropped silently');
});

test('weak fixes wait for a better one, stale ones wait for a newer one', () => {
  const now = 1_700_000_000_000;
  const filter = createGpsFilter();

  assert.equal(
    filter.accept({ lat: ACCRA.lat, lng: ACCRA.lng, accuracy: 10, timestamp: now }, now).ok,
    true
  );

  // Parked while a recent good fix exists…
  const weak = filter.accept(
    { lat: ACCRA.lat + 0.0001, lng: ACCRA.lng, accuracy: 400, timestamp: now + 1_000 },
    now + 1_000
  );
  assert.equal(weak.ok, false);
  assert.equal(weak.reason, 'WEAK_ACCURACY');

  // …accepted (and flagged) once nothing better arrived for the grace window.
  const starving = filter.accept(
    { lat: ACCRA.lat + 0.0002, lng: ACCRA.lng, accuracy: 400, timestamp: now + 61_000 },
    now + 61_000
  );
  assert.equal(starving.ok, true);
  assert.equal(starving.weak, true);

  // An out-of-order fix is dropped, not applied on top.
  const ordered = createGpsFilter();
  ordered.accept({ lat: ACCRA.lat, lng: ACCRA.lng, timestamp: now }, now);
  assert.equal(
    ordered.accept(
      { lat: ACCRA.lat, lng: ACCRA.lng - 0.001, timestamp: now - 5_000 },
      now + 2_000
    ).reason,
    'STALE_TIMESTAMP'
  );
});

test('teleports are rejected but an app resume is not', () => {
  const now = 1_700_000_000_000;
  const filter = createGpsFilter();

  filter.accept({ lat: ACCRA.lat, lng: ACCRA.lng, timestamp: now }, now);

  const teleport = filter.accept(
    { lat: ACCRA.lat + 0.05, lng: ACCRA.lng, timestamp: now + 1_000 },
    now + 1_000
  );
  assert.equal(teleport.reason, 'GPS_JUMP', '≈5.5 km in one second is not a motorcycle');

  const resumed = filter.accept(
    { lat: ACCRA.lat + 0.05, lng: ACCRA.lng, timestamp: now + 120_000 },
    now + 120_000
  );
  assert.equal(resumed.ok, true, 'a long gap means the app was backgrounded, not teleported');
});

// ---------------------------------------------------------------------------

console.log('\n7. Navigation session');

test('exactly one session exists, and the newest order wins', () => {
  assert.equal(getNavigationSession(), null, 'no delivery → no session');

  let notifications = 0;
  const unsubscribe = subscribeNavigationSession(() => {
    notifications += 1;
  });

  const session = syncNavigationSession({
    orderId: 'order-1',
    courierId: 'courier-1',
    phase: 'TO_RESTAURANT',
    origin: ACCRA,
    destination: KITCHEN,
  });
  assert.equal(session.orderId, 'order-1');
  assert.equal(session.phase, 'TO_RESTAURANT');
  assert.deepEqual(session.destination, KITCHEN);

  // The origin is where the courier IS, not where the trip started.
  syncNavigationSession({
    orderId: 'order-1',
    courierId: 'courier-1',
    phase: 'TO_RESTAURANT',
    origin: { lat: 5.61, lng: -0.19 },
  });
  assert.deepEqual(getNavigationSession()?.origin, { lat: 5.61, lng: -0.19 });

  // Phase follows the order.
  syncNavigationSession({
    orderId: 'order-1',
    courierId: 'courier-1',
    phase: 'TO_CUSTOMER',
    destination: CUSTOMER,
  });
  assert.equal(getNavigationSession()?.phase, 'TO_CUSTOMER');
  assert.deepEqual(getNavigationSession()?.destination, CUSTOMER);

  // A different order REPLACES it — never a blend of two destinations.
  const replacement = syncNavigationSession({
    orderId: 'order-2',
    courierId: 'courier-1',
    phase: 'TO_RESTAURANT',
    destination: KITCHEN,
  });
  assert.equal(replacement.orderId, 'order-2');
  assert.equal(getNavigationSession()?.orderId, 'order-2');

  recordSessionRoute(SAMPLE_ROUTE);
  assert.equal(getNavigationSession()?.route?.distanceMeters, SAMPLE_ROUTE.distanceMeters);
  assert.ok(notifications > 0, 'subscribers are told about every change');

  unsubscribe();
  const before = notifications;
  endNavigationSession('TEST');
  assert.equal(getNavigationSession(), null, 'a finished delivery ends the session');
  assert.equal(notifications, before, 'unsubscribed listeners hear nothing');
  notifications = 0;
});

// ---------------------------------------------------------------------------

console.log('\n8. Source scans');

test('navigation routes from the courier to the phase target, with steps', () => {
  const map = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));

  assert.ok(
    /calculateRoute\(\s*courierPosition,\s*leg\.target/.test(map),
    'the origin is ALWAYS the courier’s live GPS fix'
  );
  assert.ok(/steps:\s*true/.test(map), 'navigation asks for turn-by-turn steps');
  assert.ok(map.includes('resolveNavigationPhase'), 'the shared phase machine decides the leg');
  assert.equal(/TO_PICKUP_STATUSES/.test(map), false, 'no locally re-invented status list');
  assert.equal(
    /fetchRoadRoute\(/.test(map),
    false,
    'the map draws the step-aware navigation route, not the bare polyline'
  );
  assert.equal(
    /calculateRoute\(\s*(destination|pickup)/.test(map),
    false,
    'never Customer→Courier or Restaurant→Courier'
  );
});

test('the routing provider is abstracted and keyless in the client', () => {
  const routing = read('src', 'lib', 'routing.ts');
  assert.ok(/export interface RoutingService/.test(routing), 'one abstraction to swap providers');
  assert.ok(/export async function calculateRoute/.test(routing));
  assert.ok(/VITE_ROUTING_API_URL/.test(routing), 'the endpoint comes from the environment');
  assert.ok(/router\.project-osrm\.org/.test(routing), 'a keyless default that works out of the box');
  assert.equal(/AIza[0-9A-Za-z_-]{10,}/.test(routing), false, 'no Google key pasted into routing');
  assert.equal(
    /\[lng,\s*lat\]/.test(routing) || /GeoJSON/.test(routing),
    true,
    'the provider’s [lng, lat] order is handled at the boundary only'
  );
  assert.ok(read('.env.example').includes('VITE_ROUTING_API_URL'), 'documented for local setup');
});

test('only courier screens ever show turn-by-turn', () => {
  assert.deepEqual(
    filesWith('showNavigationHud'),
    [
      'src/components/common/LiveDeliveryMapModal.tsx',
      'src/components/courier/CourierLiveMap.tsx',
      'src/pages/courier/CourierDashboard.tsx',
    ],
    'customers/restaurants never receive the HUD prop'
  );

  const modal = read('src', 'components', 'common', 'LiveDeliveryMapModal.tsx');
  assert.ok(
    /showNavigationHud=\{role === 'COURIER'\}/.test(modal),
    'the HUD is gated on the courier role'
  );
  assert.ok(modal.includes('courierFix={courierFix}'), 'the courier’s own telemetry feeds the map');
});

test('the courier publishes a filtered GPS stream on a battery-aware cadence', () => {
  const dashboard = stripComments(read('src', 'pages', 'courier', 'CourierDashboard.tsx'));
  assert.ok(dashboard.includes('createGpsFilter'), 'every fix passes the gate first');
  assert.ok(dashboard.includes('NAVIGATION_GPS_REJECTED'), 'rejections are logged');
  assert.ok(dashboard.includes('gpsRejectionMessage'), 'the rider is told why');
  assert.ok(dashboard.includes('LOC_PUBLISH_ACTIVE_MS'), 'a live delivery publishes tightly');
  assert.ok(dashboard.includes('LOC_PUBLISH_IDLE_MS'), 'an idle courier publishes sparsely');
  assert.ok(dashboard.includes('BREADCRUMB_MS'), 'breadcrumbs have their own slower cadence');
  assert.ok(dashboard.includes('syncNavigationSession'), 'the session follows the active order');
  assert.ok(dashboard.includes('endNavigationSession'), 'and ends with it');
});

test('customers never see a marker ride backwards', () => {
  const detail = stripComments(read('src', 'pages', 'customer', 'OrderDetailPage.tsx'));
  assert.ok(
    detail.includes('nextTime < prevTime'),
    'the couriers-row ping is timestamp-guarded before it moves the marker'
  );
  assert.ok(
    /incomingTime < prevTime/.test(detail),
    'an out-of-order breadcrumb is dropped'
  );

  const orders = stripComments(read('src', 'pages', 'customer', 'OrdersPage.tsx'));
  assert.ok(
    orders.includes('lastAppliedPosAtRef'),
    'the list view remembers the last applied timestamp'
  );
  assert.ok(
    /ts < lastAppliedPosAtRef\.current/.test(orders),
    'a replayed realtime event can never regress the position'
  );
});

test('the delivery fee still prices the real road distance', () => {
  const quote = read('src', 'lib', 'deliveryQuote.ts');
  assert.ok(/fetchRoadDistanceKm\(/.test(quote), 'quotes keep using the road distance');
  const routing = read('src', 'lib', 'routing.ts');
  assert.ok(
    /export async function fetchRoadDistanceKm/.test(routing),
    'the road-distance helper still exists for pricing'
  );
  assert.equal(
    /commission/i.test(read('src', 'lib', 'navigation.ts')),
    false,
    'navigation never touches money'
  );
});

test('the navigation domain stays dependency-free', () => {
  const nav = stripComments(read('src', 'lib', 'navigation.ts'));
  assert.equal(/^\s*import\s/m.test(nav), false, 'no imports: pure logic, testable in Node');
  assert.equal(/\bfetch\(/.test(nav), false, 'no network calls');
  assert.equal(/\bwindow\.|\bdocument\./.test(nav), false, 'no DOM');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
