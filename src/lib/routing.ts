/**
 * Map routing & geocoding helpers for the live delivery map.
 *
 * Road routes come from an OSRM-compatible routing engine (the free
 * router.project-osrm.org demo endpoint by default, overridable with
 * `VITE_ROUTING_API_URL` for a self-hosted or proxied instance) and address
 * lookups from OpenStreetMap Nominatim — keyless public endpoints, which
 * means they are best-effort. Every call here is therefore defensive:
 *
 *  - a hard timeout via AbortController (never hangs a UI)
 *  - in-memory cache + in-flight de-duplication so rapid pings never hammer
 *    the service (and repeat requests resolve instantly)
 *  - requests are NEVER cancelled by callers: an aborted request would poison
 *    the cache with a false "no result". Callers simply drop stale replies.
 *  - ANY failure resolves to `null` instead of throwing — callers fall back
 *    to the straight-line route or simply hide the pin.
 *
 * PROVIDER ABSTRACTION: the app only talks to the {@link RoutingService}
 * interface and the provider-agnostic {@link NavigationRoute} structure (see
 * `src/lib/navigation.ts`). Swapping OSRM for another engine only means
 * re-implementing that one class — no UI, map or state code changes.
 *
 * COORDINATES: this module is the ONLY place that converts SamleyGo's
 * canonical `{ lat, lng }` into a provider's `lon,lat` URL order / GeoJSON
 * `[lng, lat]` pairs. Input coordinates are validated (and obvious lat/lng
 * swaps corrected) by `normalizeCoordinate` before they are sent.
 *
 * Nothing in here can surface an error to the user.
 */

import {
  asCoordinate,
  buildInstruction,
  navLog,
  type NavPoint,
  type NavigationRoute,
  type NavigationStep,
} from './navigation';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoadRoute {
  /** Road-snapped polyline from origin to destination. */
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Base URL of an OSRM-compatible routing API (`…/route/v1`). Defaults to the
 * public demo endpoint; point `VITE_ROUTING_API_URL` at a self-hosted engine
 * or a SamleyGo server proxy when a keyed/commercial provider is adopted —
 * secrets must NEVER ship in the client bundle.
 */
// Vite injects `import.meta.env` at build time. In non-Vite runtimes (the
// node test runners, plain tsx) it does not exist, so fall back to an empty
// value instead of throwing — the default demo endpoint is used.
const routingEnvUrl = (): string => {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return (env?.VITE_ROUTING_API_URL ?? '').trim();
  } catch {
    return '';
  }
};

const ROUTING_API_URL = routingEnvUrl().replace(/\/+$/, '');
const OSRM_BASE_URL = ROUTING_API_URL || 'https://router.project-osrm.org/route/v1';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

const REQUEST_TIMEOUT_MS = 8000;
const ROUTE_CACHE_TTL_MS = 45_000;
/** Negative route results are remembered briefly so a down service isn't retried on every ping. */
const ROUTE_MISS_TTL_MS = 20_000;
const GEOCODE_HIT_TTL_MS = 30 * 60_000;
/** Misses are remembered only briefly: a transient network blip shouldn't hide a pin for minutes. */
const GEOCODE_MISS_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 80;

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const routeCache = new Map<string, CacheEntry<NavigationRoute | null>>();
const geocodeCache = new Map<string, CacheEntry<LatLng | null>>();
const searchCache = new Map<string, CacheEntry<AddressSuggestion[]>>();
const reverseCache = new Map<string, CacheEntry<string | null>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Drops expired entries and caps growth so long-lived pages don't leak memory. */
function prune(cache: Map<string, CacheEntry<unknown>>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const isCoordinate = (value?: LatLng | null): value is LatLng =>
  !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng);

/** GET a JSON document with a hard timeout. Never throws — failures resolve to `null`. */
async function getJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Offline, CORS rejection or timeout — all treated as "no data".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

const routeCacheKey = (from: NavPoint, to: NavPoint, suffix: string): string =>
  `${round(from.lat, 4)},${round(from.lng, 4)}>${round(to.lat, 4)},${round(to.lng, 4)}${suffix}`;

/** Options accepted by every routing request. */
export interface RouteRequestOptions {
  /** Ask the engine for turn-by-turn steps (navigation screens). Default `false`. */
  steps?: boolean;
}

/**
 * The routing abstraction. The rest of the app only ever sees this interface
 * and the provider-agnostic `NavigationRoute` — never an OSRM/Google/Valhalla
 * response shape — so the backend can be replaced without touching a single
 * component.
 */
export interface RoutingService {
  /** Stable identifier, stored on every route it produces. */
  readonly id: string;
  /**
   * Calculate the drivable road route from `origin` to `destination`.
   * Resolves to `null` (never throws) when no route can be resolved.
   */
  calculateRoute(
    origin: NavPoint,
    destination: NavPoint,
    options?: RouteRequestOptions
  ): Promise<NavigationRoute | null>;
}

// ── OSRM response shapes (only ever read here) ─────────────────────────────

interface OsrmManeuverRaw {
  type?: unknown;
  modifier?: unknown;
  location?: unknown;
  bearing_after?: unknown;
  exit?: unknown;
}

interface OsrmStepRaw {
  distance?: unknown;
  duration?: unknown;
  name?: unknown;
  maneuver?: OsrmManeuverRaw;
}

interface OsrmRouteRaw {
  distance?: unknown;
  duration?: unknown;
  geometry?: { coordinates?: unknown };
  legs?: Array<{ steps?: unknown }>;
}

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Decode a GeoJSON LineString into canonical `{ lat, lng }` points.
 *
 * GeoJSON is `[lng, lat]` — the classic source of reversed routes when read
 * as `[lat, lng]`. Every pair is range-checked; malformed pairs are dropped.
 */
const parseGeometryCoordinates = (raw: unknown): NavPoint[] => {
  const points: NavPoint[] = [];
  if (!Array.isArray(raw)) return points;
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lng = toFiniteNumber(pair[0]);
    const lat = toFiniteNumber(pair[1]);
    if (lat === null || lng === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    points.push({ lat, lng });
  }
  return points;
};

/** Flatten every leg's steps into SamleyGo `NavigationStep`s. */
const parseSteps = (route: OsrmRouteRaw): NavigationStep[] => {
  const steps: NavigationStep[] = [];
  let cumulative = 0;

  for (const leg of route.legs ?? []) {
    if (!Array.isArray(leg?.steps)) continue;
    for (const raw of leg.steps as OsrmStepRaw[]) {
      const distance = toFiniteNumber(raw?.distance) ?? 0;
      const duration = toFiniteNumber(raw?.duration) ?? 0;
      const maneuver = raw?.maneuver;
      const locationRaw = Array.isArray(maneuver?.location) ? maneuver.location : null;
      const lng = locationRaw ? toFiniteNumber(locationRaw[0]) : null;
      const lat = locationRaw ? toFiniteNumber(locationRaw[1]) : null;
      const type = typeof maneuver?.type === 'string' ? maneuver.type : 'continue';
      const modifier =
        typeof maneuver?.modifier === 'string' ? maneuver.modifier : undefined;
      const name = typeof raw?.name === 'string' ? raw.name : '';
      const bearingAfter = toFiniteNumber(maneuver?.bearing_after);
      const exit = toFiniteNumber(maneuver?.exit);

      steps.push({
        instruction: buildInstruction({
          type,
          modifier,
          name,
          bearingAfter,
          exit,
        }),
        distanceMeters: Math.round(distance),
        durationSeconds: Math.round(duration),
        maneuverType: type,
        maneuverModifier: modifier,
        roadName: name || undefined,
        // Normalised extras: voice guidance needs the roundabout exit number
        // ("take the second exit") and the departure bearing ("head east"),
        // neither of which can be recovered from the instruction text.
        maneuverExit: exit ?? undefined,
        maneuverBearingAfter: bearingAfter ?? undefined,
        location:
          lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
            ? { lat, lng }
            : { lat: 0, lng: 0 },
        cumulativeMeters: Math.round(cumulative),
      });
      cumulative += distance;
    }
  }

  return steps;
};

/** Turn one decoded OSRM route into the app's `NavigationRoute`. */
const parseOsrmRoute = (route: OsrmRouteRaw | undefined, provider: string): NavigationRoute | null => {
  if (!route) return null;
  const distance = toFiniteNumber(route.distance);
  const duration = toFiniteNumber(route?.duration);
  if (!distance || !duration) return null;

  const coordinates = parseGeometryCoordinates(route.geometry?.coordinates);
  if (coordinates.length < 2) return null;

  return {
    distanceMeters: Math.round(distance),
    durationSeconds: Math.round(duration),
    geometry: { coordinates },
    steps: parseSteps(route),
    calculatedAt: new Date().toISOString(),
    provider,
  };
};

// ── The OSRM-backed service ────────────────────────────────────────────────

class OsrmRoutingService implements RoutingService {
  readonly id = 'OSRM';

  async calculateRoute(
    origin: NavPoint,
    destination: NavPoint,
    options: RouteRequestOptions = {}
  ): Promise<NavigationRoute | null> {
    // Delegates to the module-level function so validation, caching, logging
    // and the never-throw contract stay in exactly one place.
    return calculateRoute(origin, destination, options);
  }
}

/** The routing backend used across the app (swap here to change providers). */
export const routingService: RoutingService = new OsrmRoutingService();

/**
 * Calculate (and cache) a road route through the configured
 * {@link RoutingService}. Never throws; `null` means "no route could be
 * resolved right now".
 *
 * Origin is ALWAYS the caller's first argument — navigation always passes the
 * courier's current GPS fix as origin and the active phase's destination as
 * destination, and this function refuses invalid/swapped coordinates.
 */
export async function calculateRoute(
  origin: NavPoint,
  destination: NavPoint,
  options: RouteRequestOptions = {}
): Promise<NavigationRoute | null> {
  const from = asCoordinate(origin);
  const to = asCoordinate(destination);
  if (!from || !to) {
    navLog('NAVIGATION_ROUTE_FAILURE', { reason: 'INVALID_COORDINATES' }, 'warn');
    return null;
  }
  // Degenerate requests (a few metres apart) add nothing to the map.
  if (Math.abs(from.lat - to.lat) < 1e-6 && Math.abs(from.lng - to.lng) < 1e-6) return null;

  const wantsSteps = options.steps === true;
  prune(routeCache as Map<string, CacheEntry<unknown>>);

  const key = routeCacheKey(from, to, wantsSteps ? ':steps' : '');
  const cached = routeCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<NavigationRoute | null>;

  const startedAt = Date.now();
  navLog('NAVIGATION_ROUTE_REQUEST', {
    provider: routingService.id,
    origin: from,
    destination: to,
    steps: wantsSteps,
  });

  const request = (async (): Promise<NavigationRoute | null> => {
    // Provider boundary: SamleyGo `{lat,lng}` → OSRM `lon,lat` URL order.
    const url =
      `${OSRM_BASE_URL}/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson&alternatives=false&steps=${wantsSteps ? 'true' : 'false'}`;

    const json = (await getJson(url)) as { routes?: OsrmRouteRaw[] } | null;

    if (!json) {
      navLog(
        'NAVIGATION_ROUTE_FAILURE',
        { reason: 'NETWORK_OR_TIMEOUT', provider: routingService.id, ms: Date.now() - startedAt },
        'warn'
      );
      routeCache.set(key, { value: null, expires: Date.now() + ROUTE_MISS_TTL_MS });
      return null;
    }

    const route = parseOsrmRoute(json.routes?.[0], routingService.id);

    if (!route) {
      // No route (islands, water, service gap) — remember briefly to avoid retry storms.
      navLog(
        'NAVIGATION_ROUTE_FAILURE',
        { reason: json.routes?.length ? 'MALFORMED_ROUTE' : 'NO_ROUTE', provider: routingService.id },
        'warn'
      );
      routeCache.set(key, { value: null, expires: Date.now() + ROUTE_MISS_TTL_MS });
      return null;
    }

    navLog('NAVIGATION_ROUTE_SUCCESS', {
      provider: routingService.id,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      steps: route.steps.length,
      ms: Date.now() - startedAt,
    });

    routeCache.set(key, { value: route, expires: Date.now() + ROUTE_CACHE_TTL_MS });
    return route;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Fetch ONLY the road distance (km) between two points — a much lighter
 * request than a full navigation route (no steps), because the delivery-quote
 * flow needs the metre count, not the polyline or instructions.
 *
 * Uses the same cache/timeout/never-throw rules: `null` means "no route
 * could be resolved", and the caller then falls back to the server's own
 * straight-line measurement (which is what the backend validates against).
 */
export async function fetchRoadDistanceKm(from: LatLng, to: LatLng): Promise<number | null> {
  const route = await fetchRoadRoute(from, to);
  if (!route || !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0) return null;
  return Number((route.distanceMeters / 1000).toFixed(3));
}

/**
 * Fetch the driving route between two points (polyline + distance + ETA,
 * no turn-by-turn steps — use {@link calculateRoute} for navigation).
 *
 * @returns the road route, or `null` when no route can be resolved (caller
 * draws its straight-line fallback instead).
 */
export async function fetchRoadRoute(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
  const route = await calculateRoute(from, to, { steps: false });
  if (!route) return null;
  return {
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
  };
}

async function nominatimLookup(url: string): Promise<LatLng | null> {
  const json = (await getJson(url)) as Array<{ lat?: string; lon?: string }> | null;
  const first = Array.isArray(json) ? json[0] : undefined;
  if (!first?.lat || !first?.lon) return null;

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Resolve a free-text address to coordinates so pins can still be shown when
 * the DB column is empty (many restaurants/customers never saved a GPS point).
 *
 * @returns the coordinates, or `null` when the address can't be matched.
 */
export async function geocodeAddress(query: string): Promise<LatLng | null> {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (normalized.length < 4) return null;

  prune(geocodeCache as Map<string, CacheEntry<unknown>>);

  const key = normalized.toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const flightKey = `geocode:${key}`;
  const pending = inFlight.get(flightKey);
  if (pending) return pending as Promise<LatLng | null>;

  const request = (async (): Promise<LatLng | null> => {
    const q = encodeURIComponent(normalized);
    // Ghana-first (the platform only serves Ghana), then a country-agnostic
    // retry for addresses whose locality name Nominatim only knows abroad.
    let value = await nominatimLookup(`${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=gh&q=${q}`);
    if (!value) {
      value = await nominatimLookup(`${NOMINATIM_URL}?format=jsonv2&limit=1&q=${q}`);
    }

    geocodeCache.set(key, {
      value,
      expires: Date.now() + (value ? GEOCODE_HIT_TTL_MS : GEOCODE_MISS_TTL_MS),
    });
    return value;
  })();

  inFlight.set(flightKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(flightKey);
  }
}

/**
 * One row of the address search box — a selectable place with coordinates.
 *
 * `source` records which service produced it: Google Places when the Maps key
 * can use Places, otherwise the keyless OpenStreetMap lookup. Either way the
 * customer ends up with the same thing: a name to read and a point to price.
 */
export interface AddressSuggestion {
  id: string;
  /** Primary line, e.g. "East Legon" or "24 Boundary Road". */
  mainText: string;
  /** Everything after it, e.g. "Accra, Greater Accra Region, Ghana". */
  secondaryText: string;
  point: LatLng;
  source: 'GOOGLE' | 'OSM';
}

/** Shared cache bookkeeping: run a loader once, remember its answer. */
async function cached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  flightKey: string,
  ttlOnHit: number,
  ttlOnMiss: number,
  load: () => Promise<T>,
  isEmpty: (value: T) => boolean
): Promise<T> {
  prune(cache as Map<string, CacheEntry<unknown>>);

  const cachedValue = cache.get(key);
  if (cachedValue && cachedValue.expires > Date.now()) return cachedValue.value;

  const pending = inFlight.get(flightKey);
  if (pending) return pending as Promise<T>;

  const request = (async (): Promise<T> => {
    const value = await load();
    cache.set(key, {
      value,
      expires: Date.now() + (isEmpty(value) ? ttlOnMiss : ttlOnHit),
    });
    return value;
  })();

  inFlight.set(flightKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(flightKey);
  }
}

const splitDisplayName = (displayName: string, fallback: string): [string, string] => {
  const parts = displayName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return [fallback, ''];
  return [parts[0], parts.slice(1).join(', ')];
};

/**
 * Address-as-you-type search (Ghana first, then worldwide).
 *
 * Never throws and never returns garbage: an empty array simply means the
 * customer keeps typing and the text is geocoded on its own (see
 * `geocodeAddress`). Results are cached, and identical in-flight queries are
 * de-duplicated, so a fast typist costs one request per distinct query.
 */
export async function searchAddresses(query: string): Promise<AddressSuggestion[]> {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3) return [];

  const key = normalized.toLowerCase();
  return cached(
    searchCache,
    key,
    `search:${key}`,
    GEOCODE_HIT_TTL_MS,
    GEOCODE_MISS_TTL_MS,
    async () => {
      const encoded = encodeURIComponent(normalized);
      const attempts = [
        `${NOMINATIM_URL}?format=jsonv2&limit=6&countrycodes=gh&q=${encoded}`,
        `${NOMINATIM_URL}?format=jsonv2&limit=6&q=${encoded}`,
      ];

      for (const url of attempts) {
        const json = await getJson(url);
        if (!Array.isArray(json) || json.length === 0) continue;

        const found: AddressSuggestion[] = [];
        const rows = json as Array<Record<string, unknown>>;
        rows.forEach((row, index) => {
          const lat = Number(row.lat);
          const lng = Number(row.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          const [mainText, secondaryText] = splitDisplayName(
            String(row.display_name ?? ''),
            normalized
          );
          found.push({
            id: `${lat.toFixed(5)},${lng.toFixed(5)}:${index}`,
            mainText,
            secondaryText,
            point: { lat, lng },
            source: 'OSM',
          });
        });
        if (found.length > 0) return found;
      }

      return [];
    },
    (value) => value.length === 0
  );
}

/**
 * Turns a pin dropped on the map into an address the customer can read and
 * edit. `null` means "no name for this spot" — the order then keeps whatever
 * the customer typed, never a fabricated label.
 */
export async function reverseGeocodeAddress(point: LatLng): Promise<string | null> {
  if (!isCoordinate(point)) return null;

  const key = `${round(point.lat, 5)},${round(point.lng, 5)}`;
  return cached(
    reverseCache,
    key,
    `reverse:${key}`,
    GEOCODE_HIT_TTL_MS,
    GEOCODE_MISS_TTL_MS,
    async () => {
      const json = await getJson(
        `${NOMINATIM_BASE}/reverse?format=jsonv2&zoom=18&lat=${point.lat}&lon=${point.lng}`
      );
      const name = (json as { display_name?: unknown } | null)?.display_name;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    },
    (value) => value === null
  );
}

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // Earth radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "850 m" / "3.4 km" */
export function formatRouteDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '';
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** "9 min" / "1 hr 12 min" */
export function formatRouteDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}
