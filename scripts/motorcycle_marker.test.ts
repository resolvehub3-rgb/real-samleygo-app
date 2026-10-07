/**
 * SamleyGo courier motorcycle map marker — test suite.
 *
 *   pnpm test   (tsx scripts/motorcycle_marker.test.ts)
 *
 * What is covered:
 *   1. Rotation math: the supplied sheet's side view faces east, so the
 *      marker rotates by `heading − 90°`, always normalised to [−180, 180).
 *   2. Checkerboard keying: background-connected cells go transparent, art —
 *      including interior whites and the orange/green motorcycle itself —
 *      stays opaque.
 *   3. Sprite geometry: both state crops share one content box aligned on the
 *      same wheel-contact anchor, so a Moving↔Idle switch can never shift the
 *      marker's geographic point, and no art is ever clipped by the box.
 *   4. Responsive scale: the content box tracks the map width inside its
 *      84–120 px clamp.
 *   5. Moving/Idle state: only the existing glide + fresh GPS speed/freshness
 *      decide — stale fixes and stopped riders settle on Idle, hysteresis
 *      stops stop-go strobing.
 *   6. Source scans: the shipped asset exists at the exact URL and is the
 *      only copy, the courier marker is created from the motorcycle content
 *      (the emoji pin survives only as the documented load-failure fallback),
 *      pickup/destination pins and the courier's zIndex are untouched, and
 *      the module stays clear of database/secret surface.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IDLE_ANCHOR,
  IDLE_ART,
  MOVING_ANCHOR,
  MOVING_ART,
  MOTORCYCLE_BOX_MAX_W,
  MOTORCYCLE_BOX_MIN_W,
  MOTORCYCLE_SHEET_URL,
  MOVING_FIX_MAX_AGE_MS,
  MOVING_SPEED_MPS,
  IDLE_SPEED_MPS,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  getCourierMovementState,
  isCheckerColor,
  keyCheckerboard,
  motorcycleGeometry,
  motorcycleRotationDeg,
  motorcycleScaleFor,
} from '../src/lib/motorcycleMarker';

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

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const closeTo = (actual: number, expected: number, epsilon = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
};

/** Parse a `"12.3px -45.6px"` CSS pair back into numbers. */
const parsePair = (value: string): [number, number] => {
  const parts = value.split(/\s+/).map((part) => parseFloat(part));
  assert.equal(parts.length, 2, `not a coordinate pair: ${value}`);
  assert.ok(Number.isFinite(parts[0]) && Number.isFinite(parts[1]), `non-finite pair: ${value}`);
  return [parts[0], parts[1]];
};

// ---------------------------------------------------------------------------
// 1. Rotation: side view faces east (bearing 90° → 0°)
// ---------------------------------------------------------------------------

console.log('motorcycleRotationDeg');

test('bearing 90° (east) needs no rotation — the asset faces east', () => {
  assert.equal(motorcycleRotationDeg(90), 0);
});

test('north/east/south/west rotate the bike to face travel', () => {
  assert.equal(motorcycleRotationDeg(0), -90); // north → nose up
  assert.equal(motorcycleRotationDeg(180), 90); // south → nose down
  assert.equal(motorcycleRotationDeg(270), -180); // west → nose left (wrapped)
});

test('diagonals land on ±45° and the range stays within [−180, 180)', () => {
  assert.equal(motorcycleRotationDeg(45), -45);
  assert.equal(motorcycleRotationDeg(135), 45);
  assert.equal(motorcycleRotationDeg(225), 135);
  assert.equal(motorcycleRotationDeg(315), 225 - 360);
  for (let heading = 0; heading <= 360; heading += 1) {
    const rotation = motorcycleRotationDeg(heading);
    assert.ok(rotation >= -180 && rotation < 180, `rotation ${rotation} out of range`);
  }
});

test('wrap-around headings are continuous (359° ≈ −1°)', () => {
  assert.equal(motorcycleRotationDeg(359), -91);
  assert.equal(motorcycleRotationDeg(360), -90);
  assert.equal(motorcycleRotationDeg(-10), -100);
});

// ---------------------------------------------------------------------------
// 2. Checkerboard keying
// ---------------------------------------------------------------------------

console.log('checkerboard keying');

test('both baked cell tones are background; artwork colors are not', () => {
  // Sheet measurements: white cells ~253–255, gray-blue cells ~212–223.
  assert.equal(isCheckerColor(254, 254, 254), true);
  assert.equal(isCheckerColor(248, 249, 250), true); // compression noise
  assert.equal(isCheckerColor(216, 219, 223), true); // gray-blue cell
  assert.equal(isCheckerColor(235, 250, 238), true); // glow tint over a cell
  // Faint green glow dimming a gray cell — the blocky mosaic behind speed
  // lines and the ground ring if left opaque.
  assert.equal(isCheckerColor(216, 244, 222), true);
  assert.equal(isCheckerColor(224, 247, 229), true);
  // Artwork: orange body, SamleyGo green, dark outlines, mid chrome.
  assert.equal(isCheckerColor(245, 120, 40), false);
  assert.equal(isCheckerColor(35, 140, 70), false);
  assert.equal(isCheckerColor(30, 30, 30), false);
  assert.equal(isCheckerColor(200, 200, 200), false);
  // Saturated bright green (streak/ring core) and warm metal stay artwork —
  // they must keep sealing the silhouette even inside the glow zone.
  assert.equal(isCheckerColor(210, 250, 220), false);
  assert.equal(isCheckerColor(230, 225, 215), false);
});

interface RgbaFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const makeFrame = (width: number, height: number): RgbaFrame => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = 254;
    data[i * 4 + 1] = 254;
    data[i * 4 + 2] = 254;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
};

const paint = (frame: RgbaFrame, x: number, y: number, rgb: [number, number, number]): void => {
  const rgba = (y * frame.width + x) * 4;
  frame.data[rgba] = rgb[0];
  frame.data[rgba + 1] = rgb[1];
  frame.data[rgba + 2] = rgb[2];
  frame.data[rgba + 3] = 255;
};

const alphaAt = (frame: RgbaFrame, x: number, y: number): number =>
  frame.data[(y * frame.width + x) * 4 + 3];

test('flood fill removes every border-connected cell, keeps artwork opaque', () => {
  const frame = makeFrame(8, 8);
  paint(frame, 3, 3, [245, 120, 40]);
  paint(frame, 4, 3, [245, 120, 40]);
  paint(frame, 3, 4, [245, 120, 40]);
  paint(frame, 4, 4, [245, 120, 40]);
  const removed = keyCheckerboard(frame.data, frame.width, frame.height);
  assert.equal(removed, 60); // 64 cells − the 4 orange pixels
  assert.equal(alphaAt(frame, 0, 0), 0);
  assert.equal(alphaAt(frame, 7, 7), 0);
  assert.equal(alphaAt(frame, 3, 3), 255);
  assert.equal(alphaAt(frame, 4, 4), 255);
});

test('whites enclosed by an outline survive (they are not border-connected)', () => {
  const frame = makeFrame(10, 10);
  // Dark ring (3,3)–(6,6) around a white interior.
  for (let i = 3; i <= 6; i += 1) {
    paint(frame, i, 3, [30, 30, 30]);
    paint(frame, i, 6, [30, 30, 30]);
    paint(frame, 3, i, [30, 30, 30]);
    paint(frame, 6, i, [30, 30, 30]);
  }
  const removed = keyCheckerboard(frame.data, frame.width, frame.height);
  assert.equal(removed, 84); // 100 − 12 ring − 4 interior whites
  assert.equal(alphaAt(frame, 4, 4), 255); // interior white kept
  assert.equal(alphaAt(frame, 5, 5), 255);
  assert.equal(alphaAt(frame, 3, 3), 255); // outline kept
  assert.equal(alphaAt(frame, 1, 1), 0); // background gone
  assert.equal(alphaAt(frame, 8, 8), 0);
});

// ---------------------------------------------------------------------------
// 3. Sprite geometry: one box, one anchor, both states
// ---------------------------------------------------------------------------

console.log('sprite geometry');

/** Independent derivation of the union box from the exported measurements. */
const expectedBox = () => {
  const extent = (art: typeof MOVING_ART, anchor: typeof MOVING_ANCHOR) => ({
    left: anchor.x - art.x,
    right: art.x + art.w - anchor.x,
    top: anchor.y - art.y,
    bottom: art.y + art.h - anchor.y,
  });
  const moving = extent(MOVING_ART, MOVING_ANCHOR);
  const idle = extent(IDLE_ART, IDLE_ANCHOR);
  const left = Math.max(moving.left, idle.left);
  const top = Math.max(moving.top, idle.top);
  return {
    left,
    top,
    width: left + Math.max(moving.right, idle.right),
    height: top + Math.max(moving.bottom, idle.bottom),
  };
};

test('state art and anchor are inside the sheet and clear of the label pills', () => {
  for (const [art, anchor] of [
    [MOVING_ART, MOVING_ANCHOR],
    [IDLE_ART, IDLE_ANCHOR],
  ] as const) {
    assert.ok(art.y >= 852, `art top ${art.y} overlaps the direction-row label pills`);
    assert.ok(art.x >= 0 && art.y >= 0 && art.x + art.w <= SHEET_WIDTH && art.y + art.h <= SHEET_HEIGHT, 'art outside the sheet');
    assert.ok(
      anchor.x >= art.x && anchor.x <= art.x + art.w && anchor.y >= art.y && anchor.y <= art.y + art.h,
      'anchor outside its art'
    );
  }
  // The anchors sit on the wheel line: the two states must agree within a
  // couple of sheet pixels (~half a display pixel) or a state switch would
  // visibly hop the bike on the road.
  assert.ok(Math.abs(MOVING_ANCHOR.y - IDLE_ANCHOR.y) <= 4, 'anchors disagree vertically');
});

test('box + anchors: the wheel contact lands on the same point for both states', () => {
  const box = expectedBox();
  for (const scale of [0.1, 0.163, 0.3]) {
    const geometry = motorcycleGeometry(scale);
    closeTo(geometry.width, box.width * scale);
    closeTo(geometry.height, box.height * scale);
    closeTo(parseFloat(geometry.anchors.anchorLeft), -box.left * scale);
    closeTo(parseFloat(geometry.anchors.anchorTop), -box.top * scale);
    assert.equal(geometry.origin, `${box.left * scale}px ${box.top * scale}px`);
    assert.equal(geometry.backgroundSize, `${SHEET_WIDTH * scale}px ${SHEET_HEIGHT * scale}px`);

    // anchor point in box coordinates = pos + anchorSrc·scale, identical
    // for Moving and Idle, and equal to (−anchorLeft, −anchorTop).
    const [mx, my] = parsePair(geometry.positions.moving);
    const [ix, iy] = parsePair(geometry.positions.idle);
    closeTo(mx + MOVING_ANCHOR.x * scale, box.left * scale);
    closeTo(my + MOVING_ANCHOR.y * scale, box.top * scale);
    closeTo(ix + IDLE_ANCHOR.x * scale, box.left * scale);
    closeTo(iy + IDLE_ANCHOR.y * scale, box.top * scale);
    assert.notEqual(geometry.positions.moving, geometry.positions.idle, 'states must differ');
  }
});

test('no state art is clipped by the content box', () => {
  const geometry = motorcycleGeometry(0.2);
  const cases = [
    { art: MOVING_ART, pos: geometry.positions.moving },
    { art: IDLE_ART, pos: geometry.positions.idle },
  ];
  for (const { art, pos } of cases) {
    const [px, py] = parsePair(pos);
    const left = px + art.x * 0.2;
    const top = py + art.y * 0.2;
    const right = px + (art.x + art.w) * 0.2;
    const bottom = py + (art.y + art.h) * 0.2;
    assert.ok(left >= -1e-6, `left edge clipped: ${left}`);
    assert.ok(top >= -1e-6, `top edge clipped: ${top}`);
    assert.ok(right <= geometry.width + 1e-6, `right edge clipped: ${right} > ${geometry.width}`);
    assert.ok(bottom <= geometry.height + 1e-6, `bottom clipped: ${bottom} > ${geometry.height}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Responsive scale
// ---------------------------------------------------------------------------

console.log('responsive scale');

test('content box stays inside its 84–120 px clamp at any map width', () => {
  for (const width of [0, -10, Number.NaN, 320, 420, 500, 700, 900, 4000]) {
    const box = motorcycleGeometry(motorcycleScaleFor(width)).width;
    assert.ok(
      box >= MOTORCYCLE_BOX_MIN_W - 1e-6 && box <= MOTORCYCLE_BOX_MAX_W + 1e-6,
      `box ${box} outside clamp for width ${width}`
    );
  }
});

test('the box grows with the map (responsiveness) and clamps at both ends', () => {
  const widths = [320, 500, 700];
  const boxes = widths.map((width) => motorcycleGeometry(motorcycleScaleFor(width)).width);
  assert.ok(boxes[0] <= boxes[1] && boxes[1] <= boxes[2], 'box must be non-decreasing');
  closeTo(boxes[0], MOTORCYCLE_BOX_MIN_W);
  closeTo(motorcycleGeometry(motorcycleScaleFor(4000)).width, MOTORCYCLE_BOX_MAX_W);
});

// ---------------------------------------------------------------------------
// 5. Moving / Idle state
// ---------------------------------------------------------------------------

console.log('movement state');

const movement = (input: Partial<Parameters<typeof getCourierMovementState>[0]>) =>
  getCourierMovementState({
    animating: false,
    speedMps: null,
    fixAgeMs: null,
    previous: 'idle',
    ...input,
  });

test('an active glide between real fixes is always MOVING', () => {
  assert.equal(movement({ animating: true, speedMps: 0, fixAgeMs: 60_000 }), 'moving');
});

test('a fresh, rolling fix is MOVING; a stopped one is IDLE', () => {
  assert.equal(movement({ speedMps: 2, fixAgeMs: 1_000, previous: 'idle' }), 'moving');
  assert.equal(movement({ speedMps: 0, fixAgeMs: 500, previous: 'moving' }), 'idle');
});

test('a stale fix can never keep the bike moving (GPS goes quiet when parked)', () => {
  assert.equal(movement({ speedMps: 4, fixAgeMs: MOVING_FIX_MAX_AGE_MS + 1, previous: 'moving' }), 'idle');
  // Exactly at the limit still counts as fresh — only older is stale.
  assert.equal(movement({ speedMps: 4, fixAgeMs: MOVING_FIX_MAX_AGE_MS, previous: 'idle' }), 'moving');
});

test('hysteresis: stop-go traffic must not strobe the artwork', () => {
  assert.equal(movement({ speedMps: 0.8, fixAgeMs: 500, previous: 'moving' }), 'moving');
  assert.equal(movement({ speedMps: 0.8, fixAgeMs: 500, previous: 'idle' }), 'idle');
  assert.equal(movement({ speedMps: IDLE_SPEED_MPS, fixAgeMs: 500, previous: 'moving' }), 'moving');
  assert.equal(movement({ speedMps: IDLE_SPEED_MPS - 0.01, fixAgeMs: 500, previous: 'moving' }), 'idle');
  assert.equal(movement({ speedMps: MOVING_SPEED_MPS, fixAgeMs: 500, previous: 'idle' }), 'moving');
});

test('missing or invalid speeds fall back to IDLE (never invent motion)', () => {
  assert.equal(movement({ speedMps: null, fixAgeMs: 500, previous: 'moving' }), 'idle');
  assert.equal(movement({ speedMps: undefined, fixAgeMs: 500 }), 'idle');
  assert.equal(movement({ speedMps: Number.NaN, fixAgeMs: 500, previous: 'moving' }), 'idle');
  // No timestamp (customer views don't receive telemetry) — speed alone decides.
  assert.equal(movement({ speedMps: 3, fixAgeMs: null, previous: 'idle' }), 'moving');
});

// ---------------------------------------------------------------------------
// 6. Source scans
// ---------------------------------------------------------------------------

console.log('source scans');

test('the shipped asset exists at the exact served URL — and only once', () => {
  assert.equal(MOTORCYCLE_SHEET_URL, '/assets/motors.png');
  const served = path.join(ROOT, 'public', 'assets', 'motors.png');
  assert.ok(existsSync(served), `missing ${served}`);
  assert.ok(statSync(served).size > 1_000_000, 'asset looks like a placeholder, not the sprite sheet');

  const copies: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/motors[^/]*\.png$/i.test(entry)) copies.push(path.relative(ROOT, full));
    }
  };
  walk(ROOT);
  assert.deepEqual(copies, [path.join('public', 'assets', 'motors.png')], `unexpected copies: ${copies}`);
});

test('motorcycleMarker stays clear of database, secret and speech surface', () => {
  const source = stripComments(read('src', 'lib', 'motorcycleMarker.ts'));
  assert.ok(!source.includes('.from('), 'no Supabase query belongs in a marker module');
  assert.ok(!source.includes('supabase'), 'no Supabase reference');
  assert.ok(!source.includes('speechSynthesis'), 'voice stays in speech.ts');
  assert.ok(!source.includes('import.meta.env.VITE_'), 'no environment secrets');
  assert.ok(!source.includes('fetch('), 'the sheet is a plain same-origin image, not an API call');
});

test('the courier marker is created from the motorcycle content', () => {
  const source = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.equal(count(source, 'const content = makeMotorcycleContent('), 1);
  assert.ok(source.includes('motorcycleGeometry('), 'geometry drives the content box');
  assert.ok(source.includes('...geometry.anchors,'), 'marker anchors come from the measured geometry');
  assert.ok(source.includes('motorcycleRotationDeg('), 'heading rotation uses the measured base heading');
  assert.ok(source.includes(".sg-motorcycle"), 'applyHeading rotates the motorcycle layer');
  assert.ok(source.includes('loadMotorcycleSheet()'), 'sheet load is wired in');
  assert.ok(source.includes('applyMotorcycleSheet('), 'keyed sheet is applied to the marker');
  assert.ok(
    source.includes('refreshMotorcycleState();') && count(source, 'refreshMotorcycleState();') >= 3,
    'Moving/Idle refresh runs on fix, park and lost-signal paths'
  );
});

test('the emoji pin survives only as the documented load-failure fallback', () => {
  const source = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.equal(count(source, "makePinContent('🛵'"), 1, 'exactly one scooter pin — the fallback');
  assert.ok(source.includes('const fallback = makePinContent('), 'fallback is created only on sheet failure');
});

test('pickup/destination/restaurant pins and the courier zIndex are untouched (§15/§24)', () => {
  const source = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.ok(source.includes("makePinContent('🏠'"), 'customer drop-off pin kept');
  assert.ok(source.includes("makePinContent('🍳'"), 'restaurant pickup pin kept');
  assert.ok(source.includes("makePinContent('🏪'"), 'kitchen network pins kept');
  assert.ok(/zIndex:\s*1000/.test(source), 'courier marker stays above route lines');
  assert.ok(/zIndex:\s*600/.test(source), 'trip pins keep their layer below the courier');
});

test('the marker position still comes from the one GPS source of truth (§9/§10)', () => {
  const source = stripComments(read('src', 'components', 'courier', 'CourierLiveMap.tsx'));
  assert.ok(
    source.includes('const target: LatLng = { lat: courierPosition.lat, lng: courierPosition.lng };'),
    'marker target is the existing courierPosition prop'
  );
  const markerModule = stripComments(read('src', 'lib', 'motorcycleMarker.ts'));
  assert.ok(!/\blat:\s*-?\d/.test(markerModule), 'no hardcoded coordinates in the marker module');
  assert.ok(!markerModule.includes('WebSocket') && !markerModule.includes('setInterval'), 'no second realtime channel');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
