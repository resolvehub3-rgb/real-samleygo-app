/**
 * SamleyGo navigation domain — the single source of truth for courier
 * navigation.
 *
 * Everything in here is deliberately dependency-free (no DOM, no network, no
 * framework) so the same logic that runs on the courier's phone can be
 * exercised by `scripts/navigation.test.ts`.
 *
 * It owns:
 *
 *  1. Coordinate validation/normalisation. SamleyGo's canonical in-app format
 *     is `{ lat, lng }` (WGS84 degrees) — every store, prop and realtime
 *     payload uses it. Conversion to a provider's format (`lon;lat` URLs,
 *     GeoJSON `[lng, lat]` pairs) happens ONLY at the routing boundary in
 *     `src/lib/routing.ts`. Obvious lat/lng swaps (valid globally, but only
 *     plausible for Ghana when reversed) are corrected here.
 *
 *  2. The navigation phase machine: `TO_RESTAURANT` → `TO_CUSTOMER` → `ARRIVED`
 *     derived from the REAL order status. One resolver, used everywhere, so no
 *     UI component can independently decide where the courier is heading.
 *
 *  3. Turn-by-turn primitives: instruction text generated from a routing
 *     engine's actual step maneuvers (never invented from compass heading
 *     alone), projection of a GPS fix onto a route, the next maneuver, and
 *     remaining distance.
 *
 *  4. Route deviation detection + the reroute gate (debounce/backoff) so a
 *     GPS stream can never turn into a routing-API request storm.
 *
 *  5. A GPS fix filter (accuracy, staleness, impossible jumps) and a
 *     navigation session store with structured `NAVIGATION_*` logging.
 */

// ───────────────────────────────────────────────────────────────────────────
// Coordinates
// ───────────────────────────────────────────────────────────────────────────

/** Canonical SamleyGo coordinate. Never swap the two fields. */
export interface NavPoint {
  lat: number;
  lng: number;
}

/** Loose input accepted by {@link normalizeCoordinate}. */
export type CoordinateLike =
  | { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown }
  | null
  | undefined;

/** Valid latitude range: −90 … +90. */
export const isValidLatitude = (lat: unknown): lat is number =>
  typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90;

/** Valid longitude range: −180 … +180. */
export const isValidLongitude = (lng: unknown): lng is number =>
  typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;

/** "Null island" (0,0) — the classic never-really-filled-in column artifact. */
const isNullIsland = (lat: number, lng: number): boolean =>
  Math.abs(lat) < 0.0005 && Math.abs(lng) < 0.0005;

/** True when the point is finite, in range and not (0,0). */
export function isValidCoordinate(point: CoordinateLike): boolean {
  if (!point || typeof point !== 'object') return false;
  const lat = 'lat' in point ? point.lat : undefined;
  const lng = 'lng' in point ? point.lng : undefined;
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return false;
  return !isNullIsland(lat, lng);
}

// Ghana's operational envelope (all supported service zones: Accra, Tema,
// Kasoa, Kumasi, Ho, Koforidua, Takoradi, Cape Coast, Tamale …). Used ONLY to
// recognise a lat/lng swap — coordinates outside it are still accepted, so no
// location is hard-coded or rejected.
const GHANA_LAT_MIN = 4.4;
const GHANA_LAT_MAX = 11.3;
const GHANA_LNG_MIN = -3.4;
const GHANA_LNG_MAX = 1.4;

const inGhanaLat = (v: number) => v >= GHANA_LAT_MIN && v <= GHANA_LAT_MAX;
const inGhanaLng = (v: number) => v >= GHANA_LNG_MIN && v <= GHANA_LNG_MAX;

/**
 * Validate + normalise a coordinate from any layer (DB column, realtime
 * payload, GPS fix, hand-built object).
 *
 * Accepts both `{ lat, lng }` and `{ latitude, longitude }` spellings.
 * Returns `null` for anything invalid (NaN, strings, out of range, null
 * island, malformed objects). A pair that is only plausible for Ghana when
 * its fields are swapped is corrected (and reported via `wasSwapped`).
 *
 * Arrays are intentionally NOT accepted: `[lng, lat]` vs `[lat, lng]` cannot
 * be inferred safely, so the caller must convert explicitly at the boundary.
 */
export function normalizeCoordinate(
  value: CoordinateLike
): { point: NavPoint; wasSwapped: boolean } | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
  const hasLatField = 'lat' in raw;
  const hasLngField = 'lng' in raw;
  const lat = hasLatField ? raw.lat : raw.latitude;
  const lng = hasLngField ? raw.lng : raw.longitude;

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;
  if (isNullIsland(lat, lng)) return null;

  // Swap detection: valid as-is globally, but reversed it lands in Ghana while
  // forward it does not → the fields were transposed somewhere upstream.
  const wasSwapped =
    !(inGhanaLat(lat) && inGhanaLng(lng)) && inGhanaLat(lng) && inGhanaLng(lat);

  return wasSwapped
    ? { point: { lat: lng, lng: lat }, wasSwapped: true }
    : { point: { lat, lng }, wasSwapped: false };
}

/** Shorthand for callers that only need the (possibly corrected) point. */
export function asCoordinate(value: CoordinateLike): NavPoint | null {
  return normalizeCoordinate(value)?.point ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Distance / bearing
// ───────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(a: NavPoint, b: NavPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Initial bearing (degrees clockwise from north) from `a` to `b`. */
export function bearingDegrees(a: NavPoint, b: NavPoint): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

const COMPASS_8 = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const;

/** Compass word for a bearing: 0 → "north", 90 → "east", … */
export function compassLabel(bearing: number | null | undefined): string {
  if (bearing == null || !Number.isFinite(bearing)) return 'ahead';
  const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS_8[index];
}

// ───────────────────────────────────────────────────────────────────────────
// Order status → navigation phase (ONE source of truth)
// ───────────────────────────────────────────────────────────────────────────

/** How the courier's trip is progressing for the ACTIVE delivery. */
export type NavigationPhase = 'IDLE' | 'TO_RESTAURANT' | 'TO_CUSTOMER' | 'ARRIVED';

/** Statuses where the rider is still driving toward the kitchen. */
export const TO_RESTAURANT_STATUSES: ReadonlySet<string> = new Set([
  'COURIER_ASSIGNED',
  'COURIER_ACCEPTED',
  'RESTAURANT_ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
]);

/** Statuses where the rider has the food and is driving to the customer. */
export const TO_CUSTOMER_STATUSES: ReadonlySet<string> = new Set([
  'PICKED_UP',
  'ON_THE_WAY',
]);

/** Statuses where navigation for this order must not exist at all. */
export const ENDED_ORDER_STATUSES: ReadonlySet<string> = new Set([
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'REFUNDED',
]);

export interface PhaseInput {
  /** Restaurant pickup coordinates are known. */
  hasPickup?: boolean;
  /** Customer delivery coordinates are known. */
  hasDestination?: boolean;
}

/**
 * Map the REAL order status onto the navigation phase.
 *
 * STRICT RULE: a phase only resolves when ITS OWN target exists. A pickup
 * status with no restaurant coordinates is `IDLE`, not "drive to the customer"
 * — falling back to the other pin would draw a confident route to the wrong
 * place. Unknown/unrecognised statuses (a future lifecycle value) keep the
 * historical "whichever pin exists" behaviour, and a missing status (map
 * rendered before the order loaded) prefers the pickup when one exists.
 *
 * `IDLE` means: no navigation target for this order (never navigates anywhere).
 */
export function resolveNavigationPhase(
  status: string | null | undefined,
  input: PhaseInput = {}
): NavigationPhase {
  const { hasPickup = false, hasDestination = false } = input;

  if (!status) return hasPickup ? 'TO_RESTAURANT' : 'IDLE';
  if (ENDED_ORDER_STATUSES.has(status)) return 'IDLE';
  if (status === 'ARRIVED') return hasDestination ? 'ARRIVED' : 'IDLE';
  if (TO_RESTAURANT_STATUSES.has(status)) return hasPickup ? 'TO_RESTAURANT' : 'IDLE';
  if (TO_CUSTOMER_STATUSES.has(status)) return hasDestination ? 'TO_CUSTOMER' : 'IDLE';
  // Unknown status (a future/lifecycle value we don't recognise yet).
  return hasDestination ? 'TO_CUSTOMER' : hasPickup ? 'TO_RESTAURANT' : 'IDLE';
}

/**
 * The ONE destination for a phase. `TO_RESTAURANT` can only ever resolve to
 * the restaurant, `TO_CUSTOMER`/`ARRIVED` only to the customer's delivery pin.
 */
export function destinationForPhase(
  phase: NavigationPhase,
  pickup: NavPoint | null | undefined,
  customer: NavPoint | null | undefined
): NavPoint | null {
  switch (phase) {
    case 'TO_RESTAURANT':
      return pickup ?? null;
    case 'TO_CUSTOMER':
    case 'ARRIVED':
      return customer ?? null;
    case 'IDLE':
    default:
      return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Route + step structures (normalised from any routing provider)
// ───────────────────────────────────────────────────────────────────────────

/** Decoded route polyline, in canonical `{ lat, lng }` order. */
export interface RouteGeometry {
  coordinates: NavPoint[];
}

/** One turn-by-turn instruction, generated from a real routing maneuver. */
export interface NavigationStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  maneuverType: string;
  maneuverModifier?: string;
  /** Road name the maneuver leads onto (empty when the engine has none). */
  roadName?: string;
  /**
   * Roundabout/rotary exit number, when the engine reported one — voice
   * guidance says "take the second exit", which cannot be derived otherwise.
   */
  maneuverExit?: number;
  /** Bearing after the maneuver (degrees) — powers "Head east on …". */
  maneuverBearingAfter?: number;
  /** Where the maneuver happens. */
  location: NavPoint;
  /** Distance from the route origin to this maneuver (metres). */
  cumulativeMeters: number;
}

/** Provider-agnostic route used by the whole app. */
export interface NavigationRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RouteGeometry;
  steps: NavigationStep[];
  /** ISO time this route was calculated (used for staleness checks). */
  calculatedAt: string;
  /** Identifier of the routing backend that produced it. */
  provider?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Turn-by-turn instructions
// ───────────────────────────────────────────────────────────────────────────

export interface ManeuverDescriptor {
  type: string;
  modifier?: string | null;
  name?: string | null;
  bearingAfter?: number | null;
  exit?: number | null;
}

const cleanName = (name?: string | null): string => (name ?? '').trim();

/** "the left"/"the right"/"…" for ramp-style maneuvers. */
const sideWord = (modifier?: string | null): string => {
  switch (normalizeModifier(modifier)) {
    case 'slight left':
    case 'left':
      return 'left';
    case 'slight right':
    case 'right':
      return 'right';
    default:
      return '';
  }
};

const normalizeModifier = (modifier?: string | null): string =>
  (modifier ?? '').toLowerCase().trim();

/** Turn phrase for an OSRM-style modifier, or `null` when none applies. */
const turnPhrase = (modifier?: string | null): string | null => {
  switch (normalizeModifier(modifier)) {
    case 'uturn':
      return 'Make a U-turn';
    case 'sharp left':
      return 'Turn sharply left';
    case 'sharp right':
      return 'Turn sharply right';
    case 'left':
      return 'Turn left';
    case 'right':
      return 'Turn right';
    case 'slight left':
      return 'Keep left';
    case 'slight right':
      return 'Keep right';
    default:
      return null;
  }
};

/**
 * Build the spoken instruction for a routing-engine step.
 *
 * Text is derived from the engine's maneuver type/modifier/road name/bearing —
 * NEVER invented from a compass heading alone.
 */
export function buildInstruction(maneuver: ManeuverDescriptor): string {
  const type = (maneuver.type ?? '').toLowerCase().trim();
  const modifier = maneuver.modifier ?? null;
  const name = cleanName(maneuver.name);
  const onto = name ? ` onto ${name}` : '';
  const on = name ? ` on ${name}` : '';

  switch (type) {
    case 'depart':
      return `Head ${compassLabel(maneuver.bearingAfter)}${on}`;

    case 'arrive':
      return 'You have arrived';

    case 'new name':
      return name ? `Continue onto ${name}` : 'Continue';

    case 'continue':
    case 'default':
      return turnPhrase(modifier)
        ? `${turnPhrase(modifier)}${onto}`
        : `Continue straight${on}`;

    case 'merge':
      return modifier && normalizeModifier(modifier) !== 'straight'
        ? `Merge ${normalizeModifier(modifier).replace('slight ', '')}${onto}`
        : `Merge${onto || (name ? ` onto ${name}` : '')}`;

    case 'fork':
      return `Keep ${sideWord(modifier) || 'straight'}${onto}`;

    case 'on ramp': {
      const side = sideWord(modifier);
      return `Take the ${side ? `${side} ` : ''}ramp${onto}`;
    }

    case 'off ramp': {
      const side = sideWord(modifier);
      return `Take the ${side ? `${side} ` : ''}exit${onto}`;
    }

    case 'roundabout':
    case 'rotary':
    case 'exit roundabout':
      if (maneuver.exit && maneuver.exit > 0) {
        return `At the roundabout, take exit ${maneuver.exit}${onto}`;
      }
      return `Enter the roundabout${onto}`;

    case 'turn':
    case 'end of road':
      return `${turnPhrase(modifier) ?? 'Turn'}${onto}`;

    default: {
      const phrase = turnPhrase(modifier);
      if (phrase) return `${phrase}${onto}`;
      const label = maneuver.type
        ? `${maneuver.type.charAt(0).toUpperCase()}${maneuver.type.slice(1)}`
        : 'Continue';
      return `${label}${onto}`;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Route projection: where is the courier, how far off the road route?
// ───────────────────────────────────────────────────────────────────────────

export interface RouteProjection {
  /** Metres travelled along the route from its origin. */
  alongMeters: number;
  /** Perpendicular distance from the polyline (metres). */
  offRouteMeters: number;
  /** Index of the closest geometry segment. */
  segmentIndex: number;
}

/**
 * Project a GPS fix onto a route polyline (flat-earth metres — correct at
 * street scale). Returns `null` for an empty/short geometry.
 */
export function projectOnRoute(
  route: Pick<NavigationRoute, 'geometry'> | null | undefined,
  point: NavPoint
): RouteProjection | null {
  const coords = route?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;

  const midLat = ((coords[0].lat + point.lat) / 2) * (Math.PI / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(midLat);
  const px = point.lng * mPerDegLng;
  const py = point.lat * mPerDegLat;

  let best = { alongMeters: 0, offRouteMeters: Number.POSITIVE_INFINITY, segmentIndex: 0 };
  let travelled = 0;

  for (let i = 1; i < coords.length; i += 1) {
    const ax = coords[i - 1].lng * mPerDegLng;
    const ay = coords[i - 1].lat * mPerDegLat;
    const dx = coords[i].lng * mPerDegLng - ax;
    const dy = coords[i].lat * mPerDegLat - ay;
    const segLen = Math.hypot(dx, dy);
    const segKm = segLen / 1000;

    const t = segLen > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (segLen * segLen))) : 0;
    const offM = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));

    if (offM < best.offRouteMeters) {
      best = {
        alongMeters: travelled + segKm * 1000 * t,
        offRouteMeters: offM,
        segmentIndex: i - 1,
      };
    }
    travelled += segKm * 1000;
  }

  return best;
}

/** Upcoming maneuver for a position along the route. */
export interface UpcomingManeuver {
  step: NavigationStep;
  index: number;
  /** Metres from the current position to that maneuver. */
  distanceMeters: number;
}

/** Off-route thresholds (metres). */
export const OFF_ROUTE_MIN_M = 45;
export const OFF_ROUTE_MAX_M = 150;
export const OFF_ROUTE_ACCURACY_FACTOR = 1.6;
/** Consecutive off-route fixes required before a reroute is considered real. */
export const OFF_ROUTE_STREAK_REQUIRED = 2;

/**
 * Is this fix genuinely off the route?
 *
 * The threshold scales with GPS accuracy (a 120 m-accurate fix can never prove
 * a 60 m deviation) and is clamped to sane bounds so a wildly inaccurate fix
 * neither hides a real deviation nor triggers one on its own.
 */
export function isOffRoute(
  offRouteMeters: number | null | undefined,
  accuracyMeters?: number | null
): boolean {
  if (offRouteMeters == null || !Number.isFinite(offRouteMeters)) return false;
  const accuracy = accuracyMeters != null && accuracyMeters > 0 ? accuracyMeters : 30;
  const threshold = Math.max(
    OFF_ROUTE_MIN_M,
    Math.min(OFF_ROUTE_MAX_M, accuracy * OFF_ROUTE_ACCURACY_FACTOR)
  );
  return offRouteMeters > threshold;
}

/**
 * Index of the step the courier is currently driving (`alongMeters` metres
 * into the route). Shared by the upcoming-maneuver lookup, the road-name
 * readout and the voice engine so exactly one loop answers "which step am I
 * on?" everywhere.
 */
export function currentStepIndex(
  route: Pick<NavigationRoute, 'steps'> | null | undefined,
  alongMeters: number
): number {
  const steps = route?.steps;
  if (!steps || steps.length === 0) return 0;
  let current = 0;
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].cumulativeMeters <= alongMeters + 1) current = i;
    else break;
  }
  return current;
}

/**
 * The next maneuver ahead of `alongMeters` (the departure maneuver counts as
 * passed once the courier has started moving).
 */
export function nextManeuver(
  route: Pick<NavigationRoute, 'steps'> | null | undefined,
  alongMeters: number
): UpcomingManeuver | null {
  const steps = route?.steps;
  if (!steps || steps.length === 0) return null;

  const current = currentStepIndex(route, alongMeters);
  const upcomingIndex = Math.min(current + 1, steps.length - 1);
  const upcoming = steps[upcomingIndex];
  return {
    step: upcoming,
    index: upcomingIndex,
    distanceMeters: Math.max(0, upcoming.cumulativeMeters - alongMeters),
  };
}

/** Road the courier is currently driving on (step containing `alongMeters`). */
export function currentRoadName(
  route: Pick<NavigationRoute, 'steps'> | null | undefined,
  alongMeters: number
): string | null {
  const steps = route?.steps;
  if (!steps || steps.length === 0) return null;
  return steps[currentStepIndex(route, alongMeters)].roadName?.trim() || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Reroute gate (debounce + backoff) — one request stream, never a storm
// ───────────────────────────────────────────────────────────────────────────

export type RerouteReason =
  | 'NONE'
  | 'NO_ROUTE'
  | 'DESTINATION_CHANGED'
  | 'PHASE_CHANGED'
  | 'ROUTE_DEVIATION'
  | 'ROUTE_ORIGIN_STALE'
  | 'ROUTE_EXPIRED'
  | 'PROVIDER_RETRY';

/** Minimum gap between any two routing requests (protects the API budget). */
export const REROUTE_MIN_GAP_MS = 8_000;
/** Deviations must persist this long before a reroute is allowed again. */
export const DEVIATION_COOLDOWN_MS = 12_000;
export const FAILURE_BACKOFF_BASE_MS = 20_000;
export const FAILURE_BACKOFF_MAX_MS = 120_000;
/** Re-route when the courier drifted this far from the route's origin… */
export const ORIGIN_STALE_M = 200;
/** …and the route is at least this old (otherwise a fresh fix is enough). */
export const ORIGIN_STALE_AGE_MS = 45_000;
/** A route older than this is re-validated unconditionally. */
export const ROUTE_MAX_AGE_MS = 15 * 60_000;

export interface RerouteInput {
  now: number;
  hasRoute: boolean;
  destinationChanged?: boolean;
  phaseChanged?: boolean;
  /** Already evaluated through {@link isOffRoute}. */
  offRoute?: boolean;
  /** Consecutive off-route fixes seen so far. */
  offRouteStreak?: number;
  lastAttemptAt?: number | null;
  failureCount?: number;
  /** How far the courier moved from the origin used for the current route. */
  movedFromRouteOriginMeters?: number | null;
  /** Age of the current route in ms (`null` when there is none). */
  routeAgeMs?: number | null;
}

export interface RerouteDecision {
  recalculate: boolean;
  reason: RerouteReason;
}

const failureBackoffMs = (failures: number): number =>
  Math.min(FAILURE_BACKOFF_BASE_MS * 2 ** Math.min(Math.max(failures, 0), 4), FAILURE_BACKOFF_MAX_MS);

/**
 * Decide whether a routing request may fire right now.
 *
 * Priority order: a changed destination/phase always wins (and bypasses the
 * cooldown — the old route is meaningless), then provider-failure backoff,
 * then genuine deviation (2+ consecutive off-route fixes), then a stale route
 * origin / expired route. Everything else waits for the debounce window.
 */
export function evaluateReroute(input: RerouteInput): RerouteDecision {
  const {
    now,
    hasRoute,
    destinationChanged = false,
    phaseChanged = false,
    offRoute = false,
    offRouteStreak = 0,
    lastAttemptAt = null,
    failureCount = 0,
    movedFromRouteOriginMeters = null,
    routeAgeMs = null,
  } = input;

  const sinceAttempt = lastAttemptAt != null ? now - lastAttemptAt : Number.POSITIVE_INFINITY;
  const backoff = failureBackoffMs(failureCount);

  if (destinationChanged) return { recalculate: true, reason: 'DESTINATION_CHANGED' };
  if (phaseChanged) return { recalculate: true, reason: 'PHASE_CHANGED' };

  if (!hasRoute) {
    // No line at all: honour the failure backoff, then (re)try.
    return sinceAttempt >= backoff
      ? { recalculate: true, reason: failureCount > 0 ? 'PROVIDER_RETRY' : 'NO_ROUTE' }
      : { recalculate: false, reason: 'NONE' };
  }

  if (sinceAttempt < REROUTE_MIN_GAP_MS) return { recalculate: false, reason: 'NONE' };

  if (offRoute && offRouteStreak >= OFF_ROUTE_STREAK_REQUIRED) {
    return sinceAttempt >= DEVIATION_COOLDOWN_MS
      ? { recalculate: true, reason: 'ROUTE_DEVIATION' }
      : { recalculate: false, reason: 'NONE' };
  }

  if (
    movedFromRouteOriginMeters != null &&
    movedFromRouteOriginMeters > ORIGIN_STALE_M &&
    (routeAgeMs == null || routeAgeMs >= ORIGIN_STALE_AGE_MS) &&
    sinceAttempt >= backoff
  ) {
    return { recalculate: true, reason: 'ROUTE_ORIGIN_STALE' };
  }

  if (routeAgeMs != null && routeAgeMs > ROUTE_MAX_AGE_MS && sinceAttempt >= backoff) {
    return { recalculate: true, reason: 'ROUTE_EXPIRED' };
  }

  return { recalculate: false, reason: 'NONE' };
}

// ───────────────────────────────────────────────────────────────────────────
// GPS fix filter
// ───────────────────────────────────────────────────────────────────────────

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  /** Epoch ms reported by the device. */
  timestamp?: number | null;
}

export type GpsRejectionReason =
  | 'INVALID_COORDINATE'
  | 'STALE_TIMESTAMP'
  | 'WEAK_ACCURACY'
  | 'GPS_JUMP';

export interface GpsVerdict {
  ok: boolean;
  reason?: GpsRejectionReason;
  /** Accepted, but with a poor fix (nothing better was available). */
  weak?: boolean;
}

export interface GpsFilterOptions {
  /** Fixes worse than this are ignored while a better one exists. */
  weakAccuracyMeters: number;
  /** Fixes worse than this are always ignored. */
  hardAccuracyMeters: number;
  /** How long a weak fix may starve the marker before it is accepted anyway. */
  weakGraceMs: number;
  /** Reject fixes implying a faster-than-this speed (GPS glitch). */
  maxSpeedMps: number;
  /** Timestamps older than this (vs wall clock) are stale. */
  maxFixAgeMs: number;
  /** Gaps longer than this are treated as an app resume, not a jump. */
  resumeGapMs: number;
}

export const DEFAULT_GPS_FILTER_OPTIONS: GpsFilterOptions = {
  weakAccuracyMeters: 200,
  hardAccuracyMeters: 1000,
  weakGraceMs: 60_000,
  maxSpeedMps: 42, // ~150 km/h — far above a delivery motorcycle in a city
  maxFixAgeMs: 30_000,
  resumeGapMs: 60_000,
};

export interface GpsFilter {
  accept(fix: GpsFix, now?: number): GpsVerdict;
  reset(): void;
}

/** Human-readable copy for a rejected fix (shown on the courier HUD). */
export function gpsRejectionMessage(reason: GpsRejectionReason | undefined): string | null {
  switch (reason) {
    case 'WEAK_ACCURACY':
      return 'GPS signal is weak — waiting for a better fix…';
    case 'GPS_JUMP':
      return 'Ignoring an implausible GPS jump…';
    case 'STALE_TIMESTAMP':
      return null; // silent: an out-of-order fix is simply dropped
    case 'INVALID_COORDINATE':
      return 'Waiting for a valid GPS position…';
    default:
      return null;
  }
}

/**
 * Sequential GPS gate: accuracy, staleness and jump filtering so one bad
 * reading can never teleport the marker or trigger a bogus reroute.
 *
 * Rules:
 *  - invalid / null-island coordinates are always rejected;
 *  - a fix older than the last ACCEPTED one is stale (out of order) — rejected;
 *  - accuracy worse than the hard limit is always rejected;
 *  - accuracy worse than the weak limit is rejected while a recent good fix
 *    exists, and accepted (flagged `weak`) only when nothing better arrived
 *    for `weakGraceMs`;
 *  - a fix implying an impossible speed over the previous one is rejected,
 *    unless the gap looks like the app was resumed (long pause).
 */
export function createGpsFilter(options?: Partial<GpsFilterOptions>): GpsFilter {
  const opts: GpsFilterOptions = { ...DEFAULT_GPS_FILTER_OPTIONS, ...options };

  let lastAcceptedAt = 0;
  let lastAcceptedTs = 0;
  let lastAccepted: NavPoint | null = null;

  return {
    reset() {
      lastAcceptedAt = 0;
      lastAcceptedTs = 0;
      lastAccepted = null;
    },

    accept(fix: GpsFix, now = Date.now()): GpsVerdict {
      const coordinate = asCoordinate(fix);
      if (!coordinate) return { ok: false, reason: 'INVALID_COORDINATE' };

      const rawTs = fix.timestamp != null && Number.isFinite(fix.timestamp) ? fix.timestamp : now;
      // Device clock slightly ahead of ours — clamp rather than reject forever.
      const ts = Math.min(rawTs, now);

      if (lastAcceptedTs > 0 && ts <= lastAcceptedTs) {
        return { ok: false, reason: 'STALE_TIMESTAMP' };
      }
      if (now - ts > opts.maxFixAgeMs) {
        return { ok: false, reason: 'STALE_TIMESTAMP' };
      }

      const accuracy =
        fix.accuracy != null && Number.isFinite(fix.accuracy) && fix.accuracy > 0
          ? fix.accuracy
          : null;

      if (accuracy != null) {
        if (accuracy > opts.hardAccuracyMeters) return { ok: false, reason: 'WEAK_ACCURACY' };

        if (accuracy > opts.weakAccuracyMeters) {
          const starving =
            lastAcceptedAt === 0 || now - lastAcceptedAt > opts.weakGraceMs;
          if (!starving) return { ok: false, reason: 'WEAK_ACCURACY' };
          // Nothing better available — accept, but mark it weak.
          lastAcceptedAt = now;
          lastAcceptedTs = ts;
          lastAccepted = coordinate;
          return { ok: true, weak: true };
        }
      }

      if (lastAccepted) {
        const dtMs = ts - lastAcceptedTs;
        if (dtMs > 0 && dtMs < opts.resumeGapMs) {
          const impliedSpeed = haversineMeters(lastAccepted, coordinate) / (dtMs / 1000);
          if (impliedSpeed > opts.maxSpeedMps) return { ok: false, reason: 'GPS_JUMP' };
        }
      }

      lastAcceptedAt = now;
      lastAcceptedTs = ts;
      lastAccepted = coordinate;
      return { ok: true };
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Navigation session (one per active delivery)
// ───────────────────────────────────────────────────────────────────────────

export interface NavigationSession {
  orderId: string;
  courierId: string;
  phase: NavigationPhase;
  origin: NavPoint | null;
  destination: NavPoint | null;
  route: NavigationRoute | null;
  startedAt: string;
  lastRouteUpdateAt: string | null;
  lastLocationAt: string | null;
}

export interface SyncSessionInput {
  orderId: string;
  courierId: string;
  phase: NavigationPhase;
  origin?: NavPoint | null;
  destination?: NavPoint | null;
}

let activeSession: NavigationSession | null = null;
const sessionListeners = new Set<(session: NavigationSession | null) => void>();

/** Currently active navigation session, if any. */
export function getNavigationSession(): NavigationSession | null {
  return activeSession;
}

/** Subscribe to session changes (used by diagnostics). Returns unsubscribe. */
export function subscribeNavigationSession(
  listener: (session: NavigationSession | null) => void
): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

const emitSession = () => {
  for (const listener of sessionListeners) {
    try {
      listener(activeSession);
    } catch {
      // A listener must never break navigation.
    }
  }
};

/**
 * Start-or-update the single active navigation session.
 *
 * A different order replaces the previous one (with an explicit
 * `NAVIGATION_SESSION_ENDED` for the old), so a courier can never navigate
 * toward another customer's destination by accident.
 */
export function syncNavigationSession(input: SyncSessionInput): NavigationSession {
  const nowIso = new Date().toISOString();

  if (activeSession && activeSession.orderId !== input.orderId) {
    navLog('NAVIGATION_SESSION_ENDED', { orderId: activeSession.orderId, reason: 'REPLACED' }, 'warn');
    activeSession = null;
  }

  const phaseChanged = activeSession !== null && activeSession.phase !== input.phase;

  if (!activeSession) {
    activeSession = {
      orderId: input.orderId,
      courierId: input.courierId,
      phase: input.phase,
      origin: input.origin ?? null,
      destination: input.destination ?? null,
      route: null,
      startedAt: nowIso,
      lastRouteUpdateAt: null,
      lastLocationAt: input.origin ? nowIso : null,
    };
    navLog('NAVIGATION_SESSION_STARTED', {
      orderId: input.orderId,
      phase: input.phase,
      destination: input.destination ?? undefined,
    });
    emitSession();
    return activeSession;
  }

  if (input.origin) {
    activeSession.origin = input.origin;
    activeSession.lastLocationAt = nowIso;
  }
  if (input.destination) activeSession.destination = input.destination;
  activeSession.phase = input.phase;
  if (phaseChanged) {
    navLog('NAVIGATION_DESTINATION_CHANGED', { orderId: input.orderId, phase: input.phase });
  }
  emitSession();
  return activeSession;
}

/** Record the route the session is currently following. */
export function recordSessionRoute(route: NavigationRoute | null): void {
  if (!activeSession) return;
  activeSession.route = route;
  activeSession.lastRouteUpdateAt = route ? new Date().toISOString() : null;
  emitSession();
}

/** End the session (delivery completed/cancelled, or courier logged off). */
export function endNavigationSession(reason = 'ORDER_FINISHED'): void {
  if (!activeSession) return;
  navLog('NAVIGATION_SESSION_ENDED', { orderId: activeSession.orderId, reason }, 'warn');
  activeSession = null;
  emitSession();
}

// ───────────────────────────────────────────────────────────────────────────
// Structured logging
// ───────────────────────────────────────────────────────────────────────────

export type NavigationLogEvent =
  | 'NAVIGATION_ROUTE_REQUEST'
  | 'NAVIGATION_ROUTE_SUCCESS'
  | 'NAVIGATION_ROUTE_FAILURE'
  | 'NAVIGATION_GPS_UPDATE'
  | 'NAVIGATION_GPS_REJECTED'
  | 'NAVIGATION_DEVIATION_DETECTED'
  | 'NAVIGATION_REROUTE'
  | 'NAVIGATION_DESTINATION_CHANGED'
  | 'NAVIGATION_SESSION_STARTED'
  | 'NAVIGATION_SESSION_ENDED'
  | 'NAVIGATION_VOICE_ANNOUNCEMENT'
  | 'NAVIGATION_VOICE_ERROR';

/** Vite inlines `import.meta.env`; in plain Node (tests) it is simply absent. */
const isDevBuild = (): boolean => {
  try {
    return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
};

/**
 * Structured navigation log. Debug-level events only appear in development;
 * warnings (failures, session lifecycle) always log — but never carry API keys,
 * tokens or any credential.
 */
export function navLog(
  event: NavigationLogEvent,
  data?: Record<string, unknown>,
  level: 'debug' | 'warn' = 'debug'
): void {
  try {
    if (level === 'warn') {
      console.warn(`[SamleyGo] ${event}`, data ?? '');
    } else if (isDevBuild()) {
      console.debug(`[SamleyGo] ${event}`, data ?? '');
    }
  } catch {
    // Logging must never break navigation.
  }
}
