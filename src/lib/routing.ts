/**
 * Map routing & geocoding helpers for the live delivery map.
 *
 * Road routes come from the free OSRM demo server and address lookups from
 * OpenStreetMap Nominatim — both keyless public endpoints, which means they
 * are best-effort. Every call here is therefore defensive:
 *
 *  - a hard timeout via AbortController (never hangs a UI)
 *  - in-memory cache + in-flight de-duplication so rapid pings never hammer
 *    the service (and repeat requests resolve instantly)
 *  - requests are NEVER cancelled by callers: an aborted request would poison
 *    the cache with a false "no result". Callers simply drop stale replies.
 *  - ANY failure resolves to `null` instead of throwing — callers fall back
 *    to the straight-line route or simply hide the pin.
 *
 * Nothing in here can surface an error to the user.
 */

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

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

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

const routeCache = new Map<string, CacheEntry<RoadRoute | null>>();
const geocodeCache = new Map<string, CacheEntry<LatLng | null>>();
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

const routeCacheKey = (from: LatLng, to: LatLng): string =>
  `${round(from.lat, 4)},${round(from.lng, 4)}>${round(to.lat, 4)},${round(to.lng, 4)}`;

/**
 * Fetch the driving route between two points.
 *
 * @returns the road polyline with distance/ETA, or `null` when no route can be
 * resolved (caller draws its straight-line fallback instead).
 */
export async function fetchRoadRoute(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
  if (!isCoordinate(from) || !isCoordinate(to)) return null;
  // Degenerate requests (a few metres apart) add nothing to the map.
  if (Math.abs(from.lat - to.lat) < 1e-6 && Math.abs(from.lng - to.lng) < 1e-6) return null;

  prune(routeCache as Map<string, CacheEntry<unknown>>);

  const key = routeCacheKey(from, to);
  const cached = routeCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<RoadRoute | null>;

  const request = (async (): Promise<RoadRoute | null> => {
    const url = `${OSRM_URL}/${from.lng},${from.lat};${to.lng},${to.lat}` +
      '?overview=full&geometries=geojson&alternatives=false&steps=false';

    const json = (await getJson(url)) as {
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: unknown };
      }>;
    } | null;

    const route = json?.routes?.[0];
    const raw = Array.isArray(route?.geometry?.coordinates)
      ? (route.geometry.coordinates as unknown[])
      : [];

    const coordinates: LatLng[] = [];
    for (const point of raw) {
      if (Array.isArray(point) && point.length >= 2) {
        const [lng, lat] = point as [unknown, unknown];
        if (typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)) {
          coordinates.push({ lat, lng });
        }
      }
    }

    if (coordinates.length < 2 || !route?.distance || !route?.duration) {
      // No route (islands, water, service gap) — remember briefly to avoid retry storms.
      routeCache.set(key, { value: null, expires: Date.now() + ROUTE_MISS_TTL_MS });
      return null;
    }

    const value: RoadRoute = {
      coordinates,
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
    };
    routeCache.set(key, { value, expires: Date.now() + ROUTE_CACHE_TTL_MS });
    return value;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
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
