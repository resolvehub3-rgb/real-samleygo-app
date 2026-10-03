import { geocodeAddress } from './routing';

/**
 * Kitchens as the maps draw them.
 *
 * Every live map in the platform (the courier's network view, the dispatch
 * boards) paints one pin per registered restaurant, so the courier always sees
 * the full kitchen network around them instead of only the pickup of the order
 * they are currently riding.
 */
export interface RestaurantMapPin {
  id: string;
  lat: number;
  lng: number;
  name?: string;
}

/** The columns a map needs from `public.restaurants`. */
export const RESTAURANT_PIN_COLUMNS = 'id, name, address, city, latitude, longitude';

/** A raw `restaurants` row, typed loosely so a partial select still fits. */
export interface RestaurantPinRow {
  id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * A coordinate is only drawn when it is finite, in range and not "null island"
 * (0,0) — the classic artifact of a column that was never really filled in.
 */
export const isUsableCoordinate = (
  lat: number | null | undefined,
  lng: number | null | undefined
): boolean =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);

/** The row's saved GPS point, or `null` when it has none worth drawing. */
export const pinFromRow = (row: RestaurantPinRow | null | undefined): RestaurantMapPin | null => {
  if (!row?.id) return null;
  const lat = typeof row.latitude === 'number' ? row.latitude : null;
  const lng = typeof row.longitude === 'number' ? row.longitude : null;
  if (lat === null || lng === null || !isUsableCoordinate(lat, lng)) return null;
  return { id: row.id, lat, lng, name: row.name ?? undefined };
};

/** "Korle Gonno, Accra" for the geocoder, or `null` when the row has no address. */
export const restaurantAddressQuery = (row: RestaurantPinRow | null | undefined): string | null => {
  const query = [row?.address, row?.city]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ');
  return query.length >= 4 ? query : null;
};

/**
 * Nominatim's public API allows roughly one request per second per IP, and
 * rejects (or bans) anything faster.
 */
const MIN_GEOCODE_GAP_MS = 1100;

/** Serialises every lookup so a page full of un-pinned kitchens stays polite. */
let geocodeChain: Promise<unknown> = Promise.resolve();
let lastGeocodeAt = 0;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Turn a kitchen that never saved a GPS point into a drawable pin by looking
 * its address text up.
 *
 * Lookups run strictly one at a time with a ~1 s gap, and every result (hit or
 * miss) lands in `geocodeAddress`'s cache, so re-rendering the map — or another
 * map asking about the same kitchen — costs nothing extra. Failures resolve to
 * `null`: a pin that cannot be placed is simply left off the map, never thrown.
 */
export function geocodeRestaurantPin(row: RestaurantPinRow | null | undefined): Promise<RestaurantMapPin | null> {
  const query = restaurantAddressQuery(row);
  if (!row?.id || !query) return Promise.resolve(null);

  const id = row.id;
  const name = row.name ?? undefined;

  const run = geocodeChain.then(async (): Promise<RestaurantMapPin | null> => {
    const waitMs = lastGeocodeAt + MIN_GEOCODE_GAP_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastGeocodeAt = Date.now();

    try {
      const point = await geocodeAddress(query);
      return point ? { id, lat: point.lat, lng: point.lng, name } : null;
    } catch {
      // Offline / rate-limited / malformed address — best effort, no pin.
      return null;
    }
  });

  // The next caller waits for this one, even if it rejects (it cannot).
  geocodeChain = run;
  return run;
}
