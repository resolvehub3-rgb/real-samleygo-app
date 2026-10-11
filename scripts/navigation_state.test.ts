/**
 * SamleyGo navigation state machine, banner and full-screen UI — test suite.
 *
 *   pnpm test   (tsx scripts/navigation_state.test.ts)
 *
 * What is covered:
 *   1. `deriveNavigationState` — the single decision point behind the banner,
 *      in its safety-led priority order (cancel → no destination → no fix →
 *      arrived → deviation → arrive → approach → move → navigate).
 *   2. `maneuverIconKey` — every engine maneuver collapses onto one glyph,
 *      and anything unknown still draws something.
 *   3. `selectBannerInstruction` — the banner always shows the NEXT maneuver
 *      with its real distance, plus the "then …" line once it is imminent.
 *   4. Source scans — the full-screen navigation UI is presentational, the map
 *      owns every side effect, the variant is gated on the courier's own map,
 *      alternatives are only fetched on demand, and the voice engine stays
 *      behind one touchpoint.
 *
 * IMPORTANT: the routing engine and the GPS remain the authorities. These
 * tests lock down the pure decision logic the rider's phone runs between
 * fixes, and the wiring that keeps the full-screen UI honest.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADVANCE_NOTICE_M,
  APPROACH_MANEUVER_M,
  ARRIVAL_RADIUS_M,
  GPS_UNAVAILABLE_MS,
  ROUTE_READY_ALONG_M,
  deriveNavigationState,
  maneuverIconKey,
  selectBannerInstruction,
  type ManeuverIconKey,
  type NavigationRoute,
  type NavigationState,
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

const ACCRA = { lat: 5.6037, lng: -0.187 };

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
  location: ACCRA,
  cumulativeMeters: 0,
  ...over,
});

/** Oxford Street → Ring Road → arrival: 2.2 km with three real maneuvers. */
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

/** A fix on the route, mid-way, moving as the tests below describe. */
const cruising = (over: Partial<Parameters<typeof deriveNavigationState>[0]> = {}) => ({
  hasDestination: true,
  hasRoute: true,
  alongMeters: 500,
  remainingMeters: 1716,
  distanceToManeuver: 600,
  offRouteMeters: 5,
  accuracyMeters: 10,
  gpsAgeMs: 1500,
  ...over,
});

// ---------------------------------------------------------------------------

console.log('\n1. Navigation state machine');

test('no destination means IDLE, whatever else is true', () => {
  assert.equal(deriveNavigationState({ ...cruising(), hasDestination: false, arrived: true }), 'IDLE');
});

test('cancellation wins over every other signal', () => {
  const state = deriveNavigationState(
    cruising({ cancelled: true, arrived: true, remainingMeters: 0, gpsAgeMs: 99_999 })
  );
  assert.equal(state, 'CANCELLED');
});

test('a missing or stale fix is GPS_UNAVAILABLE — never a confident route', () => {
  assert.equal(deriveNavigationState(cruising({ gpsAgeMs: null })), 'GPS_UNAVAILABLE');
  assert.equal(deriveNavigationState(cruising({ gpsAgeMs: Number.NaN })), 'GPS_UNAVAILABLE');
  assert.equal(deriveNavigationState(cruising({ gpsAgeMs: GPS_UNAVAILABLE_MS + 1 })), 'GPS_UNAVAILABLE');
  assert.equal(deriveNavigationState(cruising({ gpsAgeMs: GPS_UNAVAILABLE_MS })), 'NAVIGATING');
});

test('arrival beats deviation — the trip is done', () => {
  assert.equal(deriveNavigationState(cruising({ arrived: true, offRouteMeters: 400 })), 'ARRIVED');
});

test('inside the arrival radius the state is ARRIVING', () => {
  const near = cruising({ remainingMeters: ARRIVAL_RADIUS_M - 1 });
  assert.equal(deriveNavigationState(near), 'ARRIVING');
  assert.equal(deriveNavigationState(cruising({ remainingMeters: ARRIVAL_RADIUS_M + 1 })), 'NAVIGATING');
});

test('an obvious deviation is OFF_ROUTE until a replacement is fetched', () => {
  const off = cruising({ offRouteMeters: 120 });
  assert.equal(deriveNavigationState(off), 'OFF_ROUTE');
  assert.equal(deriveNavigationState(cruising({ offRouteMeters: 120, routeStatus: 'recalculating' })), 'REROUTING');
});

test('a single noisy fix never counts as a deviation — the streak is required', () => {
  // 60 m off with a 40 m fix: over the 45 m floor but under accuracy×1.6 = 64 m.
  const noisy = { offRouteMeters: 60, accuracyMeters: 40 };
  assert.equal(
    deriveNavigationState(cruising({ ...noisy, offRouteStreak: 1 })),
    'NAVIGATING',
    'one questionable reading keeps the route on screen'
  );
  assert.equal(
    deriveNavigationState(cruising({ ...noisy, offRouteStreak: 2 })),
    'OFF_ROUTE',
    'a repeated deviation is real'
  );
  assert.equal(
    deriveNavigationState(cruising({ offRouteMeters: 5, offRouteStreak: 2 })),
    'OFF_ROUTE',
    'a clean deviation streak still triggers on its own'
  );
});

test('a stale GPS during a reroute surfaces GPS_UNAVAILABLE, not REROUTING', () => {
  const state = deriveNavigationState(
    cruising({ routeStatus: 'recalculating', gpsAgeMs: GPS_UNAVAILABLE_MS + 5_000 })
  );
  assert.equal(state, 'GPS_UNAVAILABLE');
});

test('a recalculating request with no line at all shows ROUTE_CALCULATING', () => {
  assert.equal(deriveNavigationState(cruising({ hasRoute: false, routeStatus: 'recalculating' })), 'ROUTE_CALCULATING');
  assert.equal(deriveNavigationState(cruising({ hasRoute: false, routeStatus: 'retrying' })), 'ROUTE_CALCULATING');
  assert.equal(deriveNavigationState(cruising({ hasRoute: false })), 'ROUTE_CALCULATING');
});

test('a refresh in flight keeps the existing route and its state', () => {
  assert.equal(deriveNavigationState(cruising({ routeStatus: 'recalculating' })), 'NAVIGATING');
});

test('a fresh route with the rider still parked is ROUTE_READY', () => {
  const parked = cruising({ alongMeters: ROUTE_READY_ALONG_M - 2, distanceToManeuver: 2000 });
  assert.equal(deriveNavigationState(parked), 'ROUTE_READY');
  assert.equal(
    deriveNavigationState(cruising({ alongMeters: ROUTE_READY_ALONG_M + 5, distanceToManeuver: 2000 })),
    'NAVIGATING'
  );
});

test('APPROACHING fires inside the maneuver radius and not before', () => {
  const close = cruising({ distanceToManeuver: APPROACH_MANEUVER_M });
  assert.equal(deriveNavigationState(close), 'APPROACHING');
  assert.equal(
    deriveNavigationState(cruising({ distanceToManeuver: APPROACH_MANEUVER_M + 1 })),
    'NAVIGATING'
  );
});

test('arrival outranks the next maneuver on the final stretch', () => {
  const state = deriveNavigationState(
    cruising({ remainingMeters: ARRIVAL_RADIUS_M - 3, distanceToManeuver: 20 })
  );
  assert.equal(state, 'ARRIVING');
});

test('every constant is finite, positive and in a sane order', () => {
  for (const value of [ROUTE_READY_ALONG_M, APPROACH_MANEUVER_M, ARRIVAL_RADIUS_M, GPS_UNAVAILABLE_MS, ADVANCE_NOTICE_M]) {
    assert.ok(Number.isFinite(value) && value > 0, `bad constant ${value}`);
  }
  assert.ok(ROUTE_READY_ALONG_M < APPROACH_MANEUVER_M, 'the rider must move before a maneuver can be imminent');
  assert.ok(APPROACH_MANEUVER_M < ARRIVAL_RADIUS_M, 'approach is announced before arrival');
  assert.ok(ADVANCE_NOTICE_M > APPROACH_MANEUVER_M, 'the "then …" line only appears once the turn is imminent');
});

// ---------------------------------------------------------------------------

console.log('\n2. Maneuver glyphs');

test('each engine maneuver type+modifier maps to its own icon family', () => {
  const cases: Array<[Partial<NavigationStep>, ManeuverIconKey]> = [
    [{ maneuverType: 'depart' }, 'depart'],
    [{ maneuverType: 'continue' }, 'straight'],
    [{ maneuverType: 'turn', maneuverModifier: 'left' }, 'left'],
    [{ maneuverType: 'turn', maneuverModifier: 'right' }, 'right'],
    [{ maneuverType: 'turn', maneuverModifier: 'uturn' }, 'uturn'],
    [{ maneuverType: 'turn', maneuverModifier: 'slight left' }, 'slight-left'],
    [{ maneuverType: 'turn', maneuverModifier: 'slight right' }, 'slight-right'],
    [{ maneuverType: 'turn', maneuverModifier: 'sharp left' }, 'sharp-left'],
    [{ maneuverType: 'turn', maneuverModifier: 'sharp right' }, 'sharp-right'],
    [{ maneuverType: 'rotary' }, 'roundabout'],
    [{ maneuverType: 'roundabout' }, 'roundabout'],
    [{ maneuverType: 'exit rotary' }, 'exit-roundabout'],
    [{ maneuverType: 'exit roundabout' }, 'exit-roundabout'],
    [{ maneuverType: 'on ramp' }, 'ramp'],
    [{ maneuverType: 'on ramp', maneuverModifier: 'slight left' }, 'ramp-left'],
    [{ maneuverType: 'on ramp', maneuverModifier: 'slight right' }, 'ramp-right'],
    [{ maneuverType: 'fork' }, 'fork'],
    [{ maneuverType: 'fork', maneuverModifier: 'slight left' }, 'fork-left'],
    [{ maneuverType: 'fork', maneuverModifier: 'slight right' }, 'fork-right'],
    [{ maneuverType: 'merge' }, 'merge'],
    [{ maneuverType: 'merge', maneuverModifier: 'slight left' }, 'merge-left'],
    [{ maneuverType: 'merge', maneuverModifier: 'slight right' }, 'merge-right'],
    [{ maneuverType: 'new name' }, 'straight'],
    [{ maneuverType: 'arrive' }, 'arrive'],
    [{ maneuverType: 'end of road', maneuverModifier: 'right' }, 'right'],
    [{ maneuverType: 'off ramp', maneuverModifier: 'slight left' }, 'slight-left'],
  ];
  for (const [step, expected] of cases) {
    assert.equal(maneuverIconKey(makeStep(step)), expected, `${step.maneuverType}/${step.maneuverModifier ?? ''}`);
  }
});

test('unknown or missing maneuvers still render a glyph', () => {
  assert.equal(maneuverIconKey(makeStep({ maneuverType: 'generic', maneuverModifier: 'bear left' })), 'continue');
  assert.equal(maneuverIconKey(makeStep({ maneuverType: '' })), 'continue');
  assert.equal(maneuverIconKey(null), 'continue');
  assert.equal(maneuverIconKey(undefined), 'continue');
});

test('case and whitespace from the engine never change the glyph', () => {
  assert.equal(maneuverIconKey(makeStep({ maneuverType: ' TURN ', maneuverModifier: 'Right' })), 'right');
});

// ---------------------------------------------------------------------------

console.log('\n3. Banner instruction');

test('the banner shows the NEXT maneuver with the engine’s own words', () => {
  const banner = selectBannerInstruction(SAMPLE_ROUTE, 500);
  assert.ok(banner, 'a banner exists mid-route');
  assert.equal(banner.instruction, 'Turn right onto Ring Road');
  assert.equal(banner.roadName, 'Ring Road');
  assert.equal(banner.icon, 'right');
  assert.equal(banner.distanceMeters, 600, 'real metres to the maneuver, from the route');
  assert.equal(banner.advance, null, 'the "then …" line waits until the turn is imminent');
});

test('the "then …" line appears only inside the advance-notice window', () => {
  const far = selectBannerInstruction(SAMPLE_ROUTE, 1100 - (ADVANCE_NOTICE_M + 20));
  assert.equal(far?.advance, null);

  const near = selectBannerInstruction(SAMPLE_ROUTE, 1100 - 40);
  assert.ok(near, 'a banner exists close to the turn');
  assert.equal(near.icon, 'right');
  assert.equal(near.distanceMeters, 40);
  assert.ok(near.advance, 'the following step is announced');
  assert.equal(near.advance.instruction, 'You have arrived', 'the advance line is a real step, not invented copy');
  assert.equal(near.advance.distanceMeters, 2200 - (1100 - 40));
});

test('after the last maneuver the banner falls back to the arrival card input', () => {
  const banner = selectBannerInstruction(SAMPLE_ROUTE, 2200);
  assert.ok(banner, 'the arrival step still produces a banner');
  assert.equal(banner.icon, 'arrive');
  assert.equal(banner.distanceMeters, 0);
});

test('a past-the-end position never yields a negative distance', () => {
  const banner = selectBannerInstruction(SAMPLE_ROUTE, 5000);
  assert.equal(banner?.distanceMeters, 0);
});

test('no route or no steps means no banner — the UI shows the arrival card', () => {
  assert.equal(selectBannerInstruction(null, 500), null);
  assert.equal(selectBannerInstruction(undefined, 500), null);
  assert.equal(selectBannerInstruction({ steps: [] }, 500), null);
});

test('the departure maneuver counts as passed once the rider moves', () => {
  const banner = selectBannerInstruction(SAMPLE_ROUTE, 20);
  assert.equal(banner?.icon, 'right', 'the first turn is announced, not the departure');
});

// ---------------------------------------------------------------------------

console.log('\n4. Source scans');

test('the navigation chrome is presentational — every side effect lives in the map', () => {
  const chrome = stripComments(read('src', 'components', 'navigation', 'NavigationChrome.tsx'));
  assert.equal(/navigator\.|geolocation/i.test(chrome), false, 'no GPS access from the chrome');
  assert.equal(/supabase/i.test(chrome), false, 'no data access from the chrome');
  assert.equal(/navigationVoice\./.test(chrome), false, 'the voice engine is driven by the map only');
  assert.ok(!/onRender|fetchRoadRoute|calculateRoute\(/.test(chrome), 'no routing from the chrome');
  for (const panel of ['destination', 'overview', 'steps', 'report']) {
    assert.ok(chrome.includes(`'${panel}'`), `the ${panel} sheet exists`);
  }
});

test('every control on the full-screen UI performs a real action', () => {
  const chrome = read('src', 'components', 'navigation', 'NavigationChrome.tsx');
  assert.ok(/onExit\)/.test(chrome) || /onClick=\{onExit\}/.test(chrome), 'the ✕ button exits navigation');
  assert.ok(chrome.includes('onRecenter'), 'recenter re-locks the camera on the rider');
  assert.ok(chrome.includes('onResetOrientation'), 'compass resets to north-up');
  assert.ok(chrome.includes('onToggleVoice'), 'voice can be muted');
  assert.ok(chrome.includes('onSelectRoute'), 'a route can be chosen');
  assert.ok(chrome.includes('onLoadRoutes'), 'alternatives can be requested');
  assert.ok(chrome.includes('submitNavigationReport'), 'a report is a real database write');
  assert.ok(chrome.includes('onLoadRoutes'), 'the overview can refresh its routes');
});

test('the full-screen host fills the viewport, locks the body and exits on Escape', () => {
  const screen = stripComments(read('src', 'components', 'navigation', 'NavigationScreen.tsx'));
  assert.ok(screen.includes('fixed inset-0'), 'the host covers the whole viewport');
  assert.ok(screen.includes('z-[1000]'), 'the host sits above every other surface');
  assert.ok(screen.includes("event.key === 'Escape'"), 'Escape leaves navigation');
  assert.ok(/document\.body\.style\.overflow/.test(screen), 'the page behind cannot scroll');
  assert.ok(screen.includes('variant="navigation"'), 'the host mounts the navigation variant');
});

test('the navigation variant is mounted from the courier dashboard only', () => {
  assert.deepEqual(filesWith('NavigationScreen'), [
    'src/components/navigation/NavigationScreen.tsx',
    'src/pages/courier/CourierDashboard.tsx',
  ], 'customers and restaurants never open the rider’s full-screen nav');
  const dash = stripComments(read('src', 'pages', 'courier', 'CourierDashboard.tsx'));
  assert.ok(dash.includes('isNavigating'), 'navigation has a real start/stop lifecycle');
  assert.ok(dash.includes('<NavigationScreen'), 'the screen is mounted');
});

test('the map darkens the basemap and draws a three-layer route only in the variant', () => {
  const map = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.ok(map.includes("colorScheme: mapColorScheme('DARK')"), 'Google’s official dark scheme, not a style hack');
  assert.ok(map.includes('variant === \'navigation\''), 'the dark scheme is construction-only and variant-gated');
  assert.ok(map.includes('tilt: 45'), 'the 3D tilted camera belongs to navigation');
  assert.ok(map.includes('#052e2b'), 'casing under the active line');
  assert.ok(map.includes('#4b5563'), 'the already-ridden leg is drawn back');
  assert.ok(map.includes('#22d3ee'), 'the remaining leg is the cyan line');
});

test('the map owns the state machine, the banner and every navigation side effect', () => {
  const map = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.ok(map.includes('const navigationState: NavigationState = deriveNavigationState('), 'one derivation point');
  assert.ok(map.includes('selectBannerInstruction(activeRoute'), 'the banner comes from the active route');
  assert.ok(map.includes('routes={routeOptions}'), 'the chrome receives the real route set');
  assert.ok(map.includes('onSelectRoute={selectRoute}'), 'selecting a route redraws it');
  assert.ok(map.includes('onLoadRoutes={loadAlternatives}'), 'alternatives load on demand');
  assert.ok(map.includes('calculateRouteSet(courierPosition, leg.target'), 'alternatives use the live origin');
  assert.ok(map.includes('const voiceActive = showNavigationHud || isNavigationVariant'), 'voice follows the HUD');
});

test('alternatives are reset whenever the destination or the primary route changes', () => {
  const map = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.ok(
    /setRoadRoute\([\s\S]{0,400}?setAlternatives\(\[\]\)/.test(map),
    'a route drawn to the previous target drops its alternatives with it'
  );
  assert.ok(map.includes('setPrimaryRoute(null)'), 'the remembered primary is dropped with the destination');
});

test('navigation events are structured, and never carry credentials', () => {
  const lib = read('src', 'lib', 'navigation.ts');
  for (const event of [
    'NAVIGATION_ALTERNATIVE_SELECTED',
    'NAVIGATION_EXITED',
    'NAVIGATION_DEVIATION_DETECTED',
    'NAVIGATION_REROUTE',
  ]) {
    assert.ok(lib.includes(`'${event}'`), `${event} is a declared event`);
  }
  assert.equal(
    /api[_-]?key|secret|token/i.test(stripComments(lib)),
    false,
    'no credential in the log helper'
  );
});

test('reports are real audited writes with a client-side throttle', () => {
  const reports = read('src', 'lib', 'navigationReports.ts');
  assert.ok(reports.includes("supabase.from('audit_logs').insert("), 'a report lands in the audit log');
  assert.ok(reports.includes('resetNavigationReportThrottle'), 'the throttle can be reset between trips');
  const chrome = read('src', 'components', 'navigation', 'NavigationChrome.tsx');
  assert.ok(chrome.includes('submitNavigationReport('), 'the report sheet calls the real submitter');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
failures.forEach((f) => {
  console.error(`  ✗ ${f.name}`);
  console.error(`    ${f.error.message}`);
});
if (failures.length > 0) process.exit(1);
