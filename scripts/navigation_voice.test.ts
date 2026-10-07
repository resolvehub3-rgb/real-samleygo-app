/**
 * SamleyGo navigation voice guidance — test suite.
 *
 *   pnpm test   (tsx scripts/navigation_voice.test.ts)
 *
 * What is covered (the spec's ~15 required scenarios, plus the formatters):
 *   1. Turn announcements in all three distance bands (FAR / NEAR /
 *      IMMEDIATE), with and without road names, roundabout ordinals, U-turns
 *      and keep left/right — every word derived from routing maneuver data.
 *   2. Duplicate suppression: repeated GPS fixes, two mounted maps and a
 *      routine route refresh can never repeat or interrupt an instruction.
 *   3. Lifecycle: reroute cancels old speech and follows the NEW route,
 *      destination change resets and re-anchors, arrival speaks exactly once,
 *      order cancellation / detach (logout) stop everything.
 *   4. Safety: disabled voice, unsupported platform, blocked autoplay,
 *      off-route and untrusted-accuracy fixes — all silent, none crashy.
 *   5. Coordination: the courier-request bell ducks speech, then the
 *      interrupted instruction is re-announced.
 *   6. Source scans: one TTS touchpoint, courier-only feeding, no database
 *      writes, the existing bell left intact.
 *
 * The engine is driven through its public API with a fake speech service and
 * a controlled clock — exactly the seams production uses (the real TTS is
 * exercised only by the browser).
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createNavigationVoiceGuidance,
  formatSpokenDistance,
  VOICE_THRESHOLDS,
  type NavigationVoiceGuidance,
  type VoiceUpdate,
} from '../src/lib/navigationVoice';
import { AUDIO_ALERT_EVENT } from '../src/lib/soundAlerts';
import type { NavigationSpeechService, NavigationSpeechState } from '../src/lib/speech';
import {
  type NavigationPhase,
  type NavigationRoute,
  type NavigationStep,
  type UpcomingManeuver,
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
// Fake speech service — records instead of synthesizing
// ---------------------------------------------------------------------------

class FakeSpeech implements NavigationSpeechService {
  supported = true;
  blocked = false;
  enabled = true;
  spoken: string[] = [];
  cancels = 0;
  unlocks = 0;
  private readonly listeners = new Set<(state: NavigationSpeechState) => void>();

  speak(text: string): void {
    if (!this.enabled || !this.supported || this.blocked) return;
    this.spoken.push(text);
  }

  cancel(): void {
    this.cancels += 1;
  }

  isSupported(): boolean {
    return this.supported;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    this.emit();
  }

  setVolume(): void {}

  setRate(): void {}

  unlock(): void {
    this.unlocks += 1;
    this.blocked = false;
    this.emit();
  }

  isBlocked(): boolean {
    return this.blocked;
  }

  subscribe(listener: (state: NavigationSpeechState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) {
      listener({ enabled: this.enabled, supported: this.supported, blocked: this.blocked });
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures — real Accra coordinates, provider-shaped steps
// ---------------------------------------------------------------------------

const RESTAURANT = { lat: 5.6037, lng: -0.187 };
const CUSTOMER = { lat: 5.6101, lng: -0.1912 };
const RESTAURANT_KEY = '5.6037,-0.187';
const CUSTOMER_KEY = '5.6101,-0.1912';

const makeStep = (over: Partial<NavigationStep>): NavigationStep => ({
  instruction: 'Continue',
  distanceMeters: 200,
  durationSeconds: 60,
  maneuverType: 'continue',
  location: RESTAURANT,
  cumulativeMeters: 0,
  ...over,
});

const makeRoute = (
  steps: NavigationStep[],
  over: Partial<NavigationRoute> = {}
): NavigationRoute => ({
  distanceMeters: steps.reduce((sum, step) => sum + step.distanceMeters, 0) || 500,
  durationSeconds: 300,
  geometry: { coordinates: [RESTAURANT, CUSTOMER] },
  steps,
  calculatedAt: '2026-10-07T10:00:00.000Z',
  provider: 'TEST',
  ...over,
});

const DEPART_STEP = makeStep({
  instruction: 'Head north on Patrice Lumumba Road',
  maneuverType: 'depart',
  maneuverBearingAfter: 10,
  roadName: 'Patrice Lumumba Road',
  distanceMeters: 300,
  cumulativeMeters: 0,
});
const RIGHT_STEP = makeStep({
  instruction: 'Turn right onto Ring Road',
  maneuverType: 'turn',
  maneuverModifier: 'right',
  roadName: 'Ring Road',
  distanceMeters: 200,
  cumulativeMeters: 300,
});
const ARRIVE_STEP = makeStep({
  instruction: 'You have arrived',
  maneuverType: 'arrive',
  roadName: '',
  distanceMeters: 0,
  durationSeconds: 0,
  cumulativeMeters: 500,
});

const BASE_ROUTE = makeRoute([DEPART_STEP, RIGHT_STEP, ARRIVE_STEP]);

/** A plain right turn with no road name (spec test 1 wording). */
const PLAIN_RIGHT = makeStep({ maneuverType: 'turn', maneuverModifier: 'right' });
const PLAIN_LEFT = makeStep({ maneuverType: 'turn', maneuverModifier: 'left' });

const maneuverTo = (step: NavigationStep, index: number, distanceMeters: number): UpcomingManeuver => ({
  step,
  index,
  distanceMeters,
});

// ---------------------------------------------------------------------------
// Harness: one engine, one fake speech service, one controlled clock
// ---------------------------------------------------------------------------

interface HarnessOptions {
  route?: NavigationRoute;
  maneuver?: UpcomingManeuver;
  sessionKey?: string;
  phase?: NavigationPhase;
}

interface Harness {
  engine: NavigationVoiceGuidance;
  speech: FakeSpeech;
  bell: EventTarget;
  tick: (ms: number) => void;
  now: () => number;
  sample: (over?: Partial<VoiceUpdate>) => VoiceUpdate;
  update: (over?: Partial<VoiceUpdate>, owner?: string) => void;
  ringBell: () => void;
}

const createHarness = (options: HarnessOptions = {}): Harness => {
  const speech = new FakeSpeech();
  const bell = new EventTarget();
  let clock = 1_770_000_000_000; // fixed epoch ms — time only moves via tick()

  const engine = createNavigationVoiceGuidance({
    speech,
    now: () => clock,
    persist: false,
    eventTarget: bell,
  });
  engine.attach('map-a');

  const defaults = {
    owner: 'map-a',
    sessionKey: options.sessionKey ?? CUSTOMER_KEY,
    phase: options.phase ?? ('TO_CUSTOMER' as NavigationPhase),
    route: options.route ?? BASE_ROUTE,
    maneuver: options.maneuver ?? maneuverTo(RIGHT_STEP, 1, 300),
    alongMeters: 0,
    offRouteMeters: 5,
    arrived: false,
    accuracyMeters: 20,
    speedMps: 8,
  };

  const sample = (over: Partial<VoiceUpdate> = {}): VoiceUpdate => ({ ...defaults, ...over });
  const update = (over: Partial<VoiceUpdate> = {}, owner = 'map-a'): void =>
    engine.update(sample({ ...over, owner }));

  return {
    engine,
    speech,
    bell,
    tick: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    sample,
    update,
    ringBell: () => bell.dispatchEvent(new Event(AUDIO_ALERT_EVENT)),
  };
};

/**
 * First fix of a journey: adopts the session (and may speak the departure
 * line), steps past the anti-jitter gap, then starts the recorder clean so a
 * test only sees the announcements it is about.
 */
const start = (h: Harness, over: Partial<VoiceUpdate> = {}): void => {
  h.update(over);
  h.tick(1500);
  h.speech.spoken.length = 0;
};

// ---------------------------------------------------------------------------

console.log('\n1. Spoken formatting');

test('distances read like a navigator, not a spreadsheet', () => {
  assert.equal(formatSpokenDistance(30), '30 meters');
  assert.equal(formatSpokenDistance(100), '100 meters');
  assert.equal(formatSpokenDistance(250), '250 meters');
  assert.equal(formatSpokenDistance(500), '500 meters');
  assert.equal(formatSpokenDistance(1000), '1 kilometer');
  assert.equal(formatSpokenDistance(1500), '1.5 kilometers');
  assert.equal(formatSpokenDistance(2000), '2 kilometers');
  assert.equal(formatSpokenDistance(760), '760 meters');
  // Never absurd units or negative junk.
  assert.equal(formatSpokenDistance(0.4), '5 meters');
  assert.equal(formatSpokenDistance(-20), '0 meters');
  assert.equal(formatSpokenDistance(Number.NaN), '0 meters');
});

test('the default bands match the spec (300 / 100 / 30 m)', () => {
  assert.deepEqual(VOICE_THRESHOLDS, { FAR_TURN: 300, NEAR_TURN: 100, IMMEDIATE_TURN: 30 });
});

console.log('\n2. Turn announcements');

test('a right turn is announced at the 300 m band without a road name', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(PLAIN_RIGHT, 1, 300) });
  assert.deepEqual(h.speech.spoken, ['In 300 meters, turn right.']);
});

test('a left turn is announced at the 300 m band', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(PLAIN_LEFT, 1, 300) });
  assert.deepEqual(h.speech.spoken, ['In 300 meters, turn left.']);
});

test('the FAR band includes the road name from the routing maneuver', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.deepEqual(h.speech.spoken, ['In 300 meters, turn right onto Ring Road.']);
});

test('the near band drops the road name (spec wording)', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 100) });
  assert.deepEqual(h.speech.spoken, ['In 100 meters, turn right.']);
});

test('the immediate band is the bare command', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 30) });
  assert.deepEqual(h.speech.spoken, ['Turn right.']);
});

test('the departure line speaks once at the start of the trip', () => {
  const h = createHarness();
  h.update({ alongMeters: 0 });
  assert.deepEqual(h.speech.spoken, ['Head north on Patrice Lumumba Road.']);
  h.tick(1500);
  h.update({ alongMeters: 0, maneuver: maneuverTo(PLAIN_RIGHT, 1, 300) });
  assert.equal(
    h.speech.spoken.filter((line) => line.startsWith('Head north')).length,
    1,
    'the departure line is never repeated'
  );
});

test('no departure line mid-route — only the current band speaks', () => {
  const h = createHarness();
  h.update({ alongMeters: 480 });
  assert.equal(
    h.speech.spoken.some((line) => line.startsWith('Head ')),
    false
  );
  assert.deepEqual(h.speech.spoken, ['In 300 meters, turn right onto Ring Road.']);
});

test('a roundabout uses a spoken ordinal, with and without the road name', () => {
  const roundabout = makeStep({
    instruction: 'At the roundabout, take exit 2 onto Palace Road',
    maneuverType: 'roundabout',
    maneuverExit: 2,
    roadName: 'Palace Road',
    distanceMeters: 200,
    cumulativeMeters: 300,
  });
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(roundabout, 1, 300) });
  assert.deepEqual(h.speech.spoken, [
    'In 300 meters, at the roundabout, take the second exit onto Palace Road.',
  ]);
  h.tick(1300);
  h.update({ maneuver: maneuverTo(roundabout, 1, 30) });
  assert.deepEqual(h.speech.spoken[1], 'At the roundabout, take the second exit.');
});

test('U-turn and keep left/right are phrased for speaking', () => {
  const uTurn = makeStep({ maneuverType: 'turn', maneuverModifier: 'uturn' });
  const keepLeft = makeStep({ maneuverType: 'continue', maneuverModifier: 'slight left' });
  const keepRight = makeStep({ maneuverType: 'continue', maneuverModifier: 'slight right' });

  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(uTurn, 1, 300) });
  assert.deepEqual(h.speech.spoken, ['In 300 meters, make a U-turn.']);
  h.tick(1300);
  h.update({ maneuver: maneuverTo(keepLeft, 1, 300) });
  assert.deepEqual(h.speech.spoken[1], 'In 300 meters, keep left.');
  h.tick(1300);
  h.update({ maneuver: maneuverTo(keepRight, 1, 300) });
  assert.deepEqual(h.speech.spoken[2], 'In 300 meters, keep right.');
});

test('a missing road name is never spoken as "undefined"', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(PLAIN_RIGHT, 1, 300) });
  h.tick(1300);
  h.update({ maneuver: maneuverTo(PLAIN_RIGHT, 1, 100) });
  h.tick(1300);
  h.update({ maneuver: maneuverTo(PLAIN_RIGHT, 1, 30) });
  assert.equal(h.speech.spoken.length, 3, 'FAR → NEAR → IMMEDIATE, one each');
  for (const line of h.speech.spoken) {
    assert.equal(line.includes('undefined'), false, line);
    assert.equal(line.includes('null'), false, line);
  }
});

test('a long straight leg gets one calm "Continue straight for …"', () => {
  const straight = makeStep({
    instruction: 'Continue straight on Liberation Road',
    maneuverType: 'continue',
    roadName: 'Liberation Road',
    distanceMeters: 1200,
    cumulativeMeters: 150,
  });
  const route = makeRoute(
    [
      DEPART_STEP,
      makeStep({ maneuverType: 'turn', maneuverModifier: 'left', cumulativeMeters: 100, distanceMeters: 50 }),
      straight,
      { ...ARRIVE_STEP, cumulativeMeters: 1350 },
    ],
    { distanceMeters: 1350 }
  );
  const h = createHarness({ route, maneuver: maneuverTo(ARRIVE_STEP, 3, 1200) });

  h.update({ alongMeters: 150 });
  assert.deepEqual(h.speech.spoken, ['Continue straight for 1.2 kilometers.']);
  h.tick(1500);
  h.update({ alongMeters: 150 });
  assert.equal(h.speech.spoken.length, 1, 'the same straight leg is never re-announced');
});

console.log('\n3. Duplicate suppression');

test('repeated GPS fixes at the same distance announce once', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.equal(h.speech.spoken.length, 1);
  h.tick(1300);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 295) });
  h.tick(1300);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 305) }); // GPS jitter backwards
  h.tick(1300);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.equal(h.speech.spoken.length, 1, 'one band, one announcement');
});

test('a routine route refresh neither repeats nor interrupts', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) }); // one announcement
  h.tick(1300);
  const cancelsBefore = h.speech.cancels;
  const refreshed = makeRoute(BASE_ROUTE.steps, {
    calculatedAt: '2026-10-07T10:01:00.000Z', // 45 s origin refresh
  });
  h.update({ route: refreshed, maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.equal(h.speech.spoken.length, 1, 'the refresh re-uses the announcement record');
  assert.equal(h.speech.cancels, cancelsBefore, 'nothing in flight is interrupted');
});

test('two mounted maps reporting the same progress announce once', () => {
  const h = createHarness();
  h.engine.attach('modal-map');
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) }, 'map-a');
  const before = h.speech.spoken.length;
  h.tick(1300);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) }, 'modal-map');
  assert.equal(h.speech.spoken.length, before, 'the second surface adds no duplicate');
});

test('an un-attached screen can never speak', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  const before = h.speech.spoken.length;
  h.engine.update(
    h.sample({ owner: 'customer-screen', maneuver: maneuverTo(PLAIN_LEFT, 1, 100) })
  );
  assert.equal(h.speech.spoken.length, before, 'only attached navigation surfaces feed voice');
});

console.log('\n4. Lifecycle: reroute, destination, arrival, cancellation');

test('a reroute cancels the old instruction and follows the new route', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) }); // old route's instruction
  h.tick(1300);

  h.engine.noteDeviationReroute();
  const newLeft = makeStep({
    instruction: 'Turn left onto Osu Street',
    maneuverType: 'turn',
    maneuverModifier: 'left',
    roadName: 'Osu Street',
    distanceMeters: 200,
    cumulativeMeters: 300,
  });
  const newRoute = makeRoute([DEPART_STEP, newLeft, ARRIVE_STEP], {
    calculatedAt: '2026-10-07T10:05:00.000Z',
  });
  const newManeuver = maneuverTo(newLeft, 1, 300);

  h.update({ route: newRoute, maneuver: newManeuver });
  assert.ok(h.speech.cancels >= 1, 'old speech cancelled');
  assert.ok(h.speech.spoken.includes('Recalculating route.'), 'recalculation is announced');

  h.tick(1500);
  h.update({ route: newRoute, maneuver: newManeuver });
  assert.ok(
    h.speech.spoken.some((line) => line.startsWith('In 300 meters, turn left')),
    'the NEW route supplies the instruction'
  );
  assert.equal(
    h.speech.spoken.filter((line) => line.includes('turn right')).length,
    1,
    'the old route never speaks again'
  );
});

test('"Recalculating route." is never repeated for consecutive reroutes', () => {
  const h = createHarness();
  start(h);
  h.engine.noteDeviationReroute();
  const routeB = makeRoute(BASE_ROUTE.steps, { calculatedAt: '2026-10-07T10:05:00.000Z' });
  h.update({ route: routeB });
  assert.equal(h.speech.spoken.filter((line) => line === 'Recalculating route.').length, 1);

  h.tick(4000); // second deviation inside the 15 s debounce
  h.engine.noteDeviationReroute();
  const routeC = makeRoute(BASE_ROUTE.steps, { calculatedAt: '2026-10-07T10:06:00.000Z' });
  h.update({ route: routeC });
  assert.equal(
    h.speech.spoken.filter((line) => line === 'Recalculating route.').length,
    1,
    'debounced'
  );
});

test('a destination change stops the old trip and re-anchors the new one', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  h.tick(1300);

  // Customer → restaurant (phase flip + new coordinates)
  const spokenBeforeSwitch = h.speech.spoken.length;
  h.update({
    sessionKey: RESTAURANT_KEY,
    phase: 'TO_RESTAURANT',
    maneuver: maneuverTo(PLAIN_RIGHT, 1, 300),
  });
  assert.ok(h.speech.cancels >= 1, 'the old destination stops talking');
  const afterSwitch = h.speech.spoken.slice(spokenBeforeSwitch);
  assert.ok(afterSwitch.includes('Destination changed.'), 'and the change is announced');
  assert.equal(
    afterSwitch.some((line) => line.includes('onto Ring Road')),
    false,
    'no restaurant trip quotes the customer trip'
  );

  // …and back to the customer after the pickup
  h.tick(5100);
  h.update({
    sessionKey: CUSTOMER_KEY,
    phase: 'TO_CUSTOMER',
    maneuver: maneuverTo(RIGHT_STEP, 1, 300),
  });
  assert.ok(h.speech.spoken.includes('Navigation updated. Continue to the customer.'));
});

test('arrival is announced exactly once and then voice stops', () => {
  const h = createHarness();
  start(h);
  h.update({ arrived: true });
  assert.deepEqual(h.speech.spoken, ['You have arrived at your destination.']);

  h.tick(1500);
  h.update({ arrived: true });
  h.tick(1500);
  h.update({ arrived: true, maneuver: maneuverTo(PLAIN_LEFT, 1, 100) });
  assert.equal(
    h.speech.spoken.filter((line) => line.startsWith('You have arrived')).length,
    1,
    'arrival is a one-shot event'
  );
  assert.equal(h.speech.spoken.length, 1, 'no maneuver speech after arrival');
});

test('arrival wording follows the phase (restaurant vs customer)', () => {
  const h = createHarness({ sessionKey: RESTAURANT_KEY, phase: 'TO_RESTAURANT' });
  start(h);
  h.update({ arrived: true });
  assert.deepEqual(h.speech.spoken, ['You have arrived at the restaurant.']);
});

test('cancelling the order stops voice immediately and keeps it stopped', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  h.tick(1300);
  const spokenBefore = h.speech.spoken.length;

  h.update({ sessionKey: '', phase: 'IDLE', route: null, maneuver: null });
  assert.ok(h.speech.cancels >= 1, 'speech cancelled with the order');
  h.update({ sessionKey: '', phase: 'IDLE', route: null, maneuver: null });
  assert.equal(h.speech.spoken.length, spokenBefore, 'nothing announces without a destination');
});

test('logout (last detach) stops speech; a surviving surface keeps it alive', () => {
  const h = createHarness();
  h.engine.attach('modal-map');
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  const spokenBefore = h.speech.spoken.length;
  const cancelsBefore = h.speech.cancels;

  h.engine.detach('map-a');
  assert.equal(h.speech.cancels, cancelsBefore, 'a mounted surface keeps the session alive');
  h.tick(1300);
  h.update({ maneuver: maneuverTo(PLAIN_LEFT, 1, 300) }, 'modal-map');
  assert.equal(
    h.speech.spoken.length,
    spokenBefore + 1,
    'the surviving surface still feeds the engine'
  );

  h.engine.detach('modal-map');
  assert.ok(h.speech.cancels > cancelsBefore, 'the last detach stops all speech');
  h.tick(1300);
  h.update({ maneuver: maneuverTo(PLAIN_RIGHT, 1, 300) }, 'modal-map');
  assert.equal(h.speech.spoken.length, spokenBefore + 1, 'detached owners are ignored');
});

test('stop() cancels everything and is safe to call again', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  const cancelsBefore = h.speech.cancels;
  h.engine.stop();
  assert.ok(h.speech.cancels > cancelsBefore, 'stop cancels in-flight speech');
  h.engine.stop(); // idempotent
  assert.ok(true);
});

console.log('\n5. Safety: mute, unsupported, blocked, untrusted fixes');

test('disabled voice produces no speech at all', () => {
  const h = createHarness();
  h.engine.setEnabled(false);
  assert.equal(h.engine.isEnabled(), false);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 30) });
  h.update({ arrived: true });
  assert.deepEqual(h.speech.spoken, []);

  h.engine.setEnabled(true);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.ok(h.speech.spoken.length > 0, 'speech resumes after re-enabling');
});

test('an unsupported platform never throws and never speaks', () => {
  const h = createHarness();
  h.speech.supported = false;
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  h.update({ arrived: true });
  assert.deepEqual(h.speech.spoken, []);
  assert.equal(h.engine.getState().supported, false, 'the HUD can show "unavailable"');
});

test('a blocked (autoplay) platform stays silent until re-armed', () => {
  const h = createHarness();
  h.speech.blocked = true;
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.deepEqual(h.speech.spoken, []);
  assert.equal(h.engine.getState().blocked, true, 'the HUD can show the tap hint');

  h.speech.blocked = false; // the tap gesture unlocked it
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.ok(h.speech.spoken.length > 0, 'speech resumes once the platform allows it');
});

test('unlock() re-arms the speech backend from a user gesture', () => {
  const h = createHarness();
  h.speech.blocked = true;
  h.engine.unlock();
  assert.equal(h.speech.unlocks, 1);
  assert.equal(h.engine.getState().blocked, false);
});

test('off-route and untrusted-accuracy fixes never announce', () => {
  const h = createHarness();
  start(h);

  h.update({ offRouteMeters: 250, accuracyMeters: 30 }); // genuinely lost
  assert.deepEqual(h.speech.spoken, [], 'a lost courier hears nothing until the reroute');

  h.update({ offRouteMeters: 5, accuracyMeters: 800 }); // garbage fix
  assert.deepEqual(h.speech.spoken, [], 'an untrusted fix speaks nothing');

  h.update({ offRouteMeters: 5, accuracyMeters: 25 }); // healthy again
  assert.deepEqual(h.speech.spoken, ['In 300 meters, turn right onto Ring Road.']);
});

test('bands adapt to speed: fast warns earlier, slow waits', () => {
  const fast = createHarness();
  start(fast, { speedMps: 16 });
  fast.update({ speedMps: 16, maneuver: maneuverTo(RIGHT_STEP, 1, 400) });
  assert.deepEqual(fast.speech.spoken, ['In 400 meters, turn right onto Ring Road.']);

  const slow = createHarness();
  start(slow, { speedMps: 2 });
  slow.update({ speedMps: 2, maneuver: maneuverTo(RIGHT_STEP, 1, 400) });
  assert.deepEqual(slow.speech.spoken, [], 'at walking pace the band starts closer in');
});

test('a throwing speech backend cannot break the update loop', () => {
  const speech = new FakeSpeech();
  speech.speak = () => {
    throw new Error('engine exploded');
  };
  const engine = createNavigationVoiceGuidance({ speech, now: () => 1_770_000_000_000, persist: false });
  engine.attach('map-a');
  assert.doesNotThrow(() => {
    engine.update({
      owner: 'map-a',
      sessionKey: CUSTOMER_KEY,
      phase: 'TO_CUSTOMER',
      route: BASE_ROUTE,
      maneuver: maneuverTo(RIGHT_STEP, 1, 300),
      alongMeters: 0,
      offRouteMeters: 5,
      arrived: false,
      accuracyMeters: 20,
      speedMps: 8,
    });
  });
  // And the engine keeps working afterwards.
  speech.speak = () => {};
  assert.doesNotThrow(() => engine.stop());
});

console.log('\n6. Coordination: courier-request bell + UI state');

test('the courier bell ducks voice, then the instruction is re-announced', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  const before = h.speech.spoken.length;
  h.tick(1300);

  h.ringBell();
  assert.ok(h.speech.cancels >= 1, 'the bell ducks navigation speech immediately');

  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.equal(h.speech.spoken.length, before, 'voice stays quiet through the chime');

  h.tick(3000); // past the 2.5 s quiet window
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  assert.equal(h.speech.spoken.length, before + 1, 'the interrupted instruction is not lost');
  assert.equal(
    h.speech.spoken[before],
    'In 300 meters, turn right onto Ring Road.',
    'and it is the SAME instruction, re-announced'
  );
});

test('the bell hook follows the screen lifecycle (detach disarms, attach re-arms)', () => {
  const h = createHarness();
  start(h);
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) });
  h.ringBell();
  assert.ok(h.speech.cancels >= 1, 'attached: the bell ducks voice');

  h.engine.detach('map-a'); // last screen gone → listener removed + speech stopped
  const afterDetach = h.speech.cancels;
  h.ringBell();
  assert.equal(h.speech.cancels, afterDetach, 'detached: a stray bell cannot touch voice');

  h.engine.attach('map-a'); // screen mounts again → listener re-armed
  h.update({ maneuver: maneuverTo(RIGHT_STEP, 1, 300) }); // session re-adopted
  h.ringBell();
  assert.ok(
    h.speech.cancels > afterDetach,
    're-attached: coordination works again (no stale or missing listener)'
  );
});

test('UI state and subscription behave for the HUD toggle', () => {
  const h = createHarness();
  const initial = h.engine.getState();
  assert.deepEqual(initial, { enabled: true, supported: true, blocked: false });

  let seen = 0;
  const unsubscribe = h.engine.subscribe(() => {
    seen += 1;
  });
  h.engine.setEnabled(false);
  assert.ok(seen >= 1, 'the toggle re-renders the button');
  const afterUnsubscribe = seen;
  unsubscribe();
  h.engine.setEnabled(true);
  assert.equal(seen, afterUnsubscribe, 'unsubscribed listeners hear nothing');
  assert.equal(h.engine.isEnabled(), true);
  assert.equal(h.speech.isEnabled(), true, 'the backend follows the engine');
});

console.log('\n7. Source scans');

test('exactly one module touches the browser speech API', () => {
  assert.deepEqual(filesWith('speechSynthesis'), ['src/lib/speech.ts']);
});

test('the voice engine is fed from courier navigation only', () => {
  assert.deepEqual(filesWith('navigationVoice'), [
    'src/components/courier/CourierLiveMap.tsx',
    'src/lib/navigationVoice.ts',
  ]);
});

test('the map feeds voice only behind the courier HUD flag, with attach/detach', () => {
  const map = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.ok(
    /if \(showNavigationHud\) \{\s*navigationVoice\.update\(/.test(map),
    'every update is gated on the courier-only HUD flag'
  );
  assert.ok(map.includes('navigationVoice.attach('), 'the screen joins the session');
  assert.ok(map.includes('navigationVoice.detach('), 'and leaves it on unmount');
  assert.ok(map.includes('navigationVoice.noteDeviationReroute()'), 'reroute coordination');
  assert.ok(map.includes("'Voice ON'") && map.includes("'Voice OFF'"), 'HUD toggle (spec §31)');
  assert.ok(
    map.includes('navigationVoice.getState()') && map.includes('navigationVoice.subscribe('),
    'the button mirrors engine state'
  );
});

test('voice never writes to the database or the realtime layer', () => {
  const voice = read('src', 'lib', 'navigationVoice.ts');
  assert.equal(/supabase/i.test(voice), false, 'no Supabase in the voice engine');
  assert.equal(/\.\s*from\(\s*['"`]/.test(voice), false, 'no table reads/writes');
  const speech = read('src', 'lib', 'speech.ts');
  assert.equal(/supabase/i.test(speech), false, 'no Supabase in the TTS service');
  assert.equal(/\.\s*from\(\s*['"`]/.test(speech), false, 'no table reads/writes there either');
});

test('the courier-request bell stays intact and notifies listeners', () => {
  const alerts = read('src', 'lib', 'soundAlerts.ts');
  assert.ok(
    alerts.includes('export function playCourierAssignedAlert'),
    'the existing bell is untouched'
  );
  assert.ok(alerts.includes('AUDIO_ALERT_EVENT'), 'coordination event is defined');
  assert.ok(alerts.includes('announceAudioAlert'), 'and dispatched before the chime');
  assert.equal(
    alerts.includes('playAudioWithFallback'),
    true,
    'the bell still plays the same asset with the same fallback'
  );
});

test('the TTS service keeps a single queue and prefers Ghana English', () => {
  const speech = stripComments(read('src', 'lib', 'speech.ts'));
  assert.ok(speech.includes("'en-GH'"), 'en-GH is the first preference');
  assert.ok(speech.includes('MAX_PENDING_UTTERANCES'), 'the queue is bounded');
  assert.ok(speech.includes('generation'), 'stale callbacks are invalidated on cancel');
});

// ---------------------------------------------------------------------------

console.log('');
if (failures.length > 0) {
  console.error(`${passed} passed, ${failures.length} FAILED`);
  for (const failure of failures) {
    console.error(`  ✗ ${failure.name}: ${failure.error.message}`);
  }
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
