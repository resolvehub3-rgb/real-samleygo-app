/**
 * Errands quotes — the customer's copy of the SERVER's distance/fare
 * calculation (mirrors `src/lib/deliveryQuote.ts`).
 *
 * Flow:
 *   1. Ask the routing service for the real road route pickup -> destination
 *      (best effort, short timeout).
 *   2. Call `create_errands_quote()` with those coordinates (+ road distance
 *      and duration when resolved).
 *   3. The database measures the straight-line distance itself, accepts the
 *      road distance only when it is plausible against it, prices with the
 *      CURRENT configured rules (refusing when unconfigured) and stores a
 *      short-lived, single-use quote.
 *
 * Nothing here decides what the customer pays: the browser only renders what
 * the server answered, and `create_errands_booking()` revalidates the quote
 * (owner, expiry, single use) and recomputes the fare again.
 */

import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../supabase';
import { fetchRoadRoute, type LatLng } from '../routing';
import { isValidDeliveryPoint } from '../pricing';
import { isPricingUnavailableMessage } from './config';
import type { ErrandsServiceCategory } from './types';

/** The exact message shown when an endpoint is not usable. */
export const ERRANDS_LOCATION_ERROR =
  'Please select a valid pickup and destination location to calculate the fare.';

/** A road lookup must never hold the quote button up for long. */
const ROAD_ROUTE_BUDGET_MS = 4_000;

export type ErrandsDistanceSource = 'ROAD_ROUTE' | 'STRAIGHT_LINE';

export interface ErrandsQuote {
  quoteId: string;
  serviceCategory: ErrandsServiceCategory;
  pickupAddress: string;
  destinationAddress: string;
  straightLineKm: number;
  /** The distance actually used for pricing. */
  distanceKm: number;
  distanceSource: ErrandsDistanceSource;
  estimatedDurationSeconds: number | null;
  tripFare: number;
  bookingFee: number;
  taxAmount: number;
  /** What the customer pays (trip fare + booking fee + tax). */
  estimatedFare: number;
  driverEarning: number;
  currency: string;
  pricingVersion: number;
  issuedAt: string;
  expiresAt: string;
}

export type ErrandsQuoteResult =
  | { ok: true; quote: ErrandsQuote }
  | { ok: false; error: string };

interface QuoteRow {
  quote_id?: string;
  service_category?: string;
  pickup_address?: string;
  destination_address?: string;
  straight_line_km?: number;
  distance_km?: number;
  distance_source?: string;
  estimated_duration_seconds?: number | null;
  trip_fare?: number;
  booking_fee?: number;
  tax_amount?: number;
  estimated_fare?: number;
  driver_earning?: number;
  currency?: string;
  pricing_version?: number;
  issued_at?: string;
  expires_at?: string;
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

/** How long a quote stays usable on the client (server TTL + margin). */
export function quoteTtlMs(quote: ErrandsQuote): number {
  const issued = Date.parse(quote.issuedAt);
  const expires = Date.parse(quote.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return 0;
  return Math.max(0, expires - issued);
}

/** Is this quote still valid (with a small refresh margin)? */
export function isQuoteUsable(quote: ErrandsQuote | null, now = Date.now()): boolean {
  if (!quote || !quote.quoteId) return false;
  const expires = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expires)) return false;
  // Refresh 30s before expiry so checkout never posts a stale quote.
  return expires - 30_000 > now;
}

/** Seconds until this quote expires (never negative). */
export function secondsUntilQuoteExpiry(
  quote: ErrandsQuote | null,
  now = Date.now()
): number {
  if (!quote) return 0;
  const expires = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, Math.ceil((expires - now) / 1000));
}

const parseQuote = (row: QuoteRow): ErrandsQuote => ({
  quoteId: String(row.quote_id ?? ''),
  serviceCategory:
    row.service_category === 'RIDE_CAR' ? 'RIDE_CAR' : 'ERRAND_MOTORCYCLE',
  pickupAddress: String(row.pickup_address ?? ''),
  destinationAddress: String(row.destination_address ?? ''),
  straightLineKm: asNumber(row.straight_line_km),
  distanceKm: asNumber(row.distance_km),
  distanceSource: row.distance_source === 'ROAD_ROUTE' ? 'ROAD_ROUTE' : 'STRAIGHT_LINE',
  estimatedDurationSeconds: asNullableNumber(row.estimated_duration_seconds),
  tripFare: asNumber(row.trip_fare),
  bookingFee: asNumber(row.booking_fee),
  taxAmount: asNumber(row.tax_amount),
  estimatedFare: asNumber(row.estimated_fare),
  driverEarning: asNumber(row.driver_earning),
  currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GHS',
  pricingVersion: Math.round(asNumber(row.pricing_version, 1)),
  issuedAt: String(row.issued_at ?? new Date().toISOString()),
  expiresAt: String(row.expires_at ?? new Date().toISOString()),
});

/** Server messages that really mean "the pickup/destination is not usable". */
const isLocationError = (message: string): boolean =>
  /valid pickup and destination location/i.test(message);

export interface ErrandsQuoteInput {
  serviceCategory: ErrandsServiceCategory;
  pickup: { point: LatLng; address: string };
  destination: { point: LatLng; address: string };
}

/**
 * Ask the backend for an Errands quote.
 *
 * Never throws — every failure resolves to `{ ok: false, error }` with
 * customer-facing copy (including the exact "pricing not configured" message
 * when no fares have been saved yet).
 */
export async function requestErrandsQuote(
  input: ErrandsQuoteInput
): Promise<ErrandsQuoteResult> {
  const { serviceCategory, pickup, destination } = input;

  if (!isValidDeliveryPoint(pickup?.point?.lat, pickup?.point?.lng)) {
    return { ok: false, error: ERRANDS_LOCATION_ERROR };
  }
  if (!isValidDeliveryPoint(destination?.point?.lat, destination?.point?.lng)) {
    return { ok: false, error: ERRANDS_LOCATION_ERROR };
  }
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Connect Supabase to calculate a real Errands fare for this route.',
    };
  }

  // Real road distance/duration when the routing service answers in time.
  // The backend still measures the crow-fly distance itself and validates
  // whatever we send, so a slow or wrong route can never change the price.
  let roadDistanceKm: number | null = null;
  let roadDurationSeconds: number | null = null;
  const route = await Promise.race([
    fetchRoadRoute(pickup.point, destination.point).catch(() => null),
    new Promise<null>((resolve) =>
      window.setTimeout(() => resolve(null), ROAD_ROUTE_BUDGET_MS)
    ),
  ]);
  if (route && Number.isFinite(route.distanceMeters) && route.distanceMeters > 0) {
    roadDistanceKm = Number((route.distanceMeters / 1000).toFixed(3));
    roadDurationSeconds = Number.isFinite(route.durationSeconds)
      ? Math.round(route.durationSeconds)
      : null;
  }

  const { data, error } = await supabase.rpc('create_errands_quote', {
    p_pickup_lat: pickup.point.lat,
    p_pickup_lng: pickup.point.lng,
    p_pickup_address: pickup.address,
    p_dest_lat: destination.point.lat,
    p_dest_lng: destination.point.lng,
    p_dest_address: destination.address,
    p_service_category: serviceCategory,
    p_road_distance_km: roadDistanceKm,
    p_road_duration_seconds: roadDurationSeconds,
  });

  if (error) {
    const message = cleanRpcErrorMessage(error.message, 'Could not calculate the fare.');
    if (isLocationError(message)) return { ok: false, error: ERRANDS_LOCATION_ERROR };
    if (isPricingUnavailableMessage(message)) return { ok: false, error: message };
    if (/not available right now/i.test(message)) return { ok: false, error: message };
    if (/sign in|jwt|not authorized|permission denied/i.test(message)) {
      return { ok: false, error: 'Sign in to see your Errands fare.' };
    }
    if (/does not exist|schema cache/i.test(message)) {
      return {
        ok: false,
        error: 'Errands is not switched on for this project yet — please try again shortly.',
      };
    }
    return { ok: false, error: message };
  }

  const row = data as QuoteRow | null;
  if (!row || !row.quote_id) {
    return { ok: false, error: ERRANDS_LOCATION_ERROR };
  }

  return { ok: true, quote: parseQuote(row) };
}

/**
 * Guarantees a usable quote at booking time: reuses the one on screen while
 * it is still valid, otherwise asks the backend for a fresh one (an expired
 * or already-consumed quote must never be submitted).
 */
export async function ensureFreshErrandsQuote(
  current: ErrandsQuote | null,
  input: ErrandsQuoteInput
): Promise<ErrandsQuoteResult> {
  if (isQuoteUsable(current)) {
    return { ok: true, quote: current as ErrandsQuote };
  }
  return requestErrandsQuote(input);
}
