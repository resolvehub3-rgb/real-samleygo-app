/**
 * Errands driver discovery — the client's wrapper around the secured
 * `errands_nearby_drivers()` RPC.
 *
 * The database does the eligibility work (approved, verified, online,
 * Errands-enabled, not busy, fresh position, right vehicle, in radius) with
 * the SAME function the booking RPC re-checks, so the driver a customer sees
 * here is exactly the driver the database will let them book.
 *
 * Discovery is polled (the couriers table is not subscribable: its RLS only
 * exposes a driver to their own order/booking participants, so a realtime
 * channel would deliver nothing). Positions are only ever real GPS the driver
 * published — there are no mock drivers and no fabricated coordinates.
 */

import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../supabase';
import { isValidDeliveryPoint } from '../pricing';
import type { ErrandsNearbyDriver, ErrandsServiceCategory } from './types';

/** How fresh a driver position must be to be shown as live (mirrors SQL). */
export const ERRANDS_LOCATION_FRESHNESS_SECONDS = 120;

/** Default poll interval while the customer is choosing a driver. */
export const ERRANDS_DISCOVERY_POLL_MS = 12_000;

/** Search radius around the pickup point (clamped server-side to 50 km). */
export const ERRANDS_DISCOVERY_RADIUS_KM = 15;

export type ErrandsDiscoveryResult =
  | { ok: true; drivers: ErrandsNearbyDriver[] }
  | { ok: false; error: string };

interface DriverRow {
  driver_id?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  vehicle_type?: string | null;
  vehicle_category?: string | null;
  rating?: number | null;
  total_deliveries?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  location_updated_at?: string | null;
  location_age_seconds?: number | null;
  distance_km?: number | null;
  is_verified?: boolean | null;
}

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const parseDriver = (row: DriverRow): ErrandsNearbyDriver | null => {
  const driverId = asString(row.driver_id);
  if (!driverId) return null;
  return {
    driverId,
    fullName: asString(row.full_name),
    avatarUrl: asString(row.avatar_url),
    vehicleType: asString(row.vehicle_type),
    vehicleCategory: row.vehicle_category === 'CAR' ? 'CAR' : 'MOTORCYCLE',
    rating: asNullableNumber(row.rating),
    totalDeliveries: asNullableNumber(row.total_deliveries),
    latitude: asNullableNumber(row.latitude),
    longitude: asNullableNumber(row.longitude),
    locationUpdatedAt: asString(row.location_updated_at),
    locationAgeSeconds: asNullableNumber(row.location_age_seconds),
    distanceKm: asNullableNumber(row.distance_km),
    isVerified: row.is_verified === true,
  };
};

/**
 * Find eligible drivers near a pickup point.
 *
 * Never throws. An empty array is an honest "nobody is available right now" —
 * it is never padded with placeholder drivers.
 */
export async function fetchNearbyErrandsDrivers(input: {
  pickup: { lat: number; lng: number };
  serviceCategory: ErrandsServiceCategory;
  radiusKm?: number;
  limit?: number;
}): Promise<ErrandsDiscoveryResult> {
  const { pickup, serviceCategory } = input;

  if (!isValidDeliveryPoint(pickup?.lat, pickup?.lng)) {
    return { ok: false, error: 'Choose a valid pickup point to find drivers.' };
  }
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Connect Supabase to find nearby Errands drivers.',
    };
  }

  const { data, error } = await supabase.rpc('errands_nearby_drivers', {
    p_lat: pickup.lat,
    p_lng: pickup.lng,
    p_service_category: serviceCategory,
    p_radius_km: input.radiusKm ?? ERRANDS_DISCOVERY_RADIUS_KM,
    p_limit: input.limit ?? 25,
  });

  if (error) {
    const message = cleanRpcErrorMessage(
      error.message,
      'Could not look up nearby drivers.'
    );
    if (/not available right now/i.test(message)) return { ok: false, error: message };
    if (/sign in|jwt|not authorized|permission denied/i.test(message)) {
      return { ok: false, error: 'Sign in to find nearby Errands drivers.' };
    }
    if (/does not exist|schema cache/i.test(message)) {
      return {
        ok: false,
        error: 'Errands is not switched on for this project yet — please try again shortly.',
      };
    }
    return { ok: false, error: message };
  }

  const rows = Array.isArray(data) ? (data as DriverRow[]) : [];
  const drivers = rows
    .map(parseDriver)
    .filter((driver): driver is ErrandsNearbyDriver => driver !== null)
    // Nearest first, then best rated — mirrors the SQL ORDER BY as a safety
    // net in case the backend ordering ever changes.
    .sort((a, b) => {
      const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });

  return { ok: true, drivers };
}

/** Has this driver's position gone stale on the client side too? */
export function isDriverPositionFresh(driver: ErrandsNearbyDriver): boolean {
  const age = driver.locationAgeSeconds;
  if (age === null) return false;
  return age <= ERRANDS_LOCATION_FRESHNESS_SECONDS;
}
