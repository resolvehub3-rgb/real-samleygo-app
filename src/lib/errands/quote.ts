/**
 * Errands quotes — the customer's copy of the SERVER's fare.
 *
 * Flow (the browser routes nothing and never sends a distance):
 *   1. Call the `errand-quote` Edge Function with the two endpoints and
 *      the service category.
 *   2. The function verifies the session, measures the real road route
 *      with the privileged key (Google Routes API, falling back to the
 *      platform's OSRM provider) and hands that distance to
 *      `create_errands_quote()` — which is revoked from the browser.
 *   3. The database loads the active pricing rule for the category,
 *      prices it in integer pesewas and stores a short-lived, single-use
 *      snapshot with its full breakdown.
 *
 * Nothing here decides what the customer pays: the browser only renders
 * what the server answered, and `create_errands_booking()` revalidates
 * the quote (owner, expiry, single use) and re-prices it under the
 * CURRENT rules before a booking is created.
 *
 * When routing fails there is no price — the server refuses rather than
 * substituting a straight-line distance, and this module surfaces that
 * refusal as customer-facing copy.
 */

import { supabase, isSupabaseConfigured } from '../supabase';
import { isValidDeliveryPoint } from '../pricing';
import { isPricingUnavailableMessage } from './config';
import type { ErrandsServiceCategory } from './types';

/** The exact message shown when an endpoint is not usable. */
export const ERRANDS_LOCATION_ERROR =
  'Please select a valid pickup and destination location to calculate the fare.';

// Local alias: this module only needs coordinates, not the routing toolkit.
type LatLng = { lat: number; lng: number };

/** Shown when the quote function itself cannot be reached. */
export const ERRANDS_QUOTE_UNAVAILABLE_ERROR =
  'Fare calculation is unavailable right now. Please try again in a moment.';

export type ErrandsDistanceSource = 'ROAD_ROUTE' | 'STRAIGHT_LINE';

export interface ErrandsQuote {
  quoteId: string;
  serviceCategory: ErrandsServiceCategory;
  pickupAddress: string;
  destinationAddress: string;
  straightLineKm: number;
  /** The road distance actually used for pricing. */
  distanceKm: number;
  distanceSource: ErrandsDistanceSource;
  /** Which engine measured the route (Google Routes / OSRM). */
  routeProvider: string;
  /** Route distance in metres, as the server stored it. */
  routeDistanceMetres: number;
  estimatedDurationSeconds: number | null;
  /** The per-km rate this quote was priced with (shown in the breakdown). */
  perKmRate: number;
  /** Demand multiplier baked into the trip fare (1 = none). */
  surgeMultiplier: number;

  // --- Fare breakdown (all server-computed, GHS) ---
  baseFare: number;
  distanceCharge: number;
  timeCharge: number;
  waitingCharge: number;
  bookingFee: number;
  surgeAmount: number;
  discountAmount: number;
  /** Trip components + booking fee, after the capped discount, before tax. */
  tripFare: number;
  taxAmount: number;
  /** What the customer pays (breakdown total, tax included). */
  estimatedFare: number;
  minFare: number;
  maxFare: number | null;
  driverEarning: number;
  /** True when a surge multiplier is actually in force on this quote. */
  surgeRuleActive: boolean;
  /** Set when a variable charge is in force — disclosed before booking. */
  variableChargeNote: string | null;
  /** Motorcycle quotes are measured with driving routing; disclose it. */
  routeNote: string | null;

  currency: string;
  pricingVersion: number;
  status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';
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
  route_distance_metres?: number;
  distance_source?: string;
  route_provider?: string;
  estimated_duration_seconds?: number | null;
  per_km_rate?: number;
  surge_multiplier?: number;
  base_fare?: number;
  distance_charge?: number;
  time_charge?: number;
  waiting_charge?: number;
  booking_fee?: number;
  surge_amount?: number;
  discount_amount?: number;
  trip_fare?: number;
  tax_amount?: number;
  min_fare?: number;
  max_fare?: number | null;
  estimated_fare?: number;
  driver_earning?: number;
  surge_rule_active?: boolean;
  variable_charge_note?: string | null;
  currency?: string;
  pricing_version?: number;
  status?: string;
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

const asBool = (value: unknown): boolean => value === true || value === 'true';

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

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

const parseQuote = (row: QuoteRow, routeNote: string | null): ErrandsQuote => ({
  quoteId: String(row.quote_id ?? ''),
  serviceCategory:
    row.service_category === 'CAR_ERRAND'
      ? 'CAR_ERRAND'
      : row.service_category === 'RIDE_CAR'
        ? 'RIDE_CAR'
        : 'ERRAND_MOTORCYCLE',
  pickupAddress: String(row.pickup_address ?? ''),
  destinationAddress: String(row.destination_address ?? ''),
  straightLineKm: asNumber(row.straight_line_km),
  distanceKm: asNumber(row.distance_km),
  distanceSource: row.distance_source === 'ROAD_ROUTE' ? 'ROAD_ROUTE' : 'STRAIGHT_LINE',
  routeProvider: String(row.route_provider ?? 'UNKNOWN'),
  routeDistanceMetres: Math.round(
    asNumber(row.route_distance_metres, asNumber(row.distance_km) * 1000)
  ),
  estimatedDurationSeconds: asNullableNumber(row.estimated_duration_seconds),
  perKmRate: asNumber(row.per_km_rate),
  surgeMultiplier: asNumber(row.surge_multiplier, 1),
  baseFare: asNumber(row.base_fare),
  distanceCharge: asNumber(row.distance_charge),
  timeCharge: asNumber(row.time_charge),
  waitingCharge: asNumber(row.waiting_charge),
  bookingFee: asNumber(row.booking_fee),
  surgeAmount: asNumber(row.surge_amount),
  discountAmount: asNumber(row.discount_amount),
  tripFare: asNumber(row.trip_fare),
  taxAmount: asNumber(row.tax_amount),
  minFare: asNumber(row.min_fare),
  maxFare: asNullableNumber(row.max_fare),
  estimatedFare: asNumber(row.estimated_fare),
  driverEarning: asNumber(row.driver_earning),
  surgeRuleActive: asBool(row.surge_rule_active),
  variableChargeNote: asText(row.variable_charge_note),
  routeNote,
  currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GHS',
  pricingVersion: Math.round(asNumber(row.pricing_version, 1)),
  status:
    row.status === 'CONSUMED' || row.status === 'EXPIRED' || row.status === 'CANCELLED'
      ? row.status
      : 'ACTIVE',
  issuedAt: String(row.issued_at ?? new Date().toISOString()),
  expiresAt: String(row.expires_at ?? new Date().toISOString()),
});

/** Server messages that really mean "the pickup/destination is not usable". */
const isLocationError = (message: string): boolean =>
  /valid pickup and destination location/i.test(message);

/** Pull the `{ error }` body out of a FunctionsHttpError, if there is one. */
async function readFunctionErrorMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = (await context.json()) as { error?: unknown };
    return typeof body?.error === 'string' && body.error.trim() ? body.error : null;
  } catch {
    return null;
  }
}

function mapQuoteError(message: string): string {
  if (isLocationError(message)) return ERRANDS_LOCATION_ERROR;
  if (isPricingUnavailableMessage(message)) return message;
  if (/service area/i.test(message)) return message;
  if (/road route|could not be verified/i.test(message)) return message;
  if (/not available right now/i.test(message)) return message;
  if (/too quickly/i.test(message)) return message;
  if (/sign in|jwt|not authorized|permission denied|unauthenticated/i.test(message)) {
    return 'Sign in to see your Errands fare.';
  }
  if (/does not exist|schema cache|failed to fetch|network/i.test(message)) {
    return ERRANDS_QUOTE_UNAVAILABLE_ERROR;
  }
  return message;
}

export interface ErrandsQuoteInput {
  serviceCategory: ErrandsServiceCategory;
  pickup: { point: LatLng; address: string };
  destination: { point: LatLng; address: string };
}

/**
 * Ask the backend for an Errands quote.
 *
 * Never throws — every failure resolves to `{ ok: false, error }` with
 * customer-facing copy (including the exact "pricing not configured"
 * message when no fares have been saved yet).
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

  try {
    const { data, error } = await supabase.functions.invoke('errand-quote', {
      body: {
        pickup: {
          lat: pickup.point.lat,
          lng: pickup.point.lng,
          address: pickup.address,
        },
        destination: {
          lat: destination.point.lat,
          lng: destination.point.lng,
          address: destination.address,
        },
        serviceCategory,
      },
    });

    if (error) {
      const detail = await readFunctionErrorMessage(error);
      if (detail) return { ok: false, error: mapQuoteError(detail) };

      // No body: the function is unreachable (not deployed / offline).
      const kind = String((error as { name?: string })?.name ?? '');
      if (kind === 'FunctionsRelayError' || kind === 'FunctionFetchError') {
        return { ok: false, error: ERRANDS_QUOTE_UNAVAILABLE_ERROR };
      }
      return { ok: false, error: ERRANDS_QUOTE_UNAVAILABLE_ERROR };
    }

    const payload = data as { quote?: QuoteRow; route?: { note?: string | null } } | null;
    const row = payload?.quote;
    if (!row || !row.quote_id) {
      return { ok: false, error: ERRANDS_LOCATION_ERROR };
    }

    return { ok: true, quote: parseQuote(row, asText(payload?.route?.note)) };
  } catch {
    return { ok: false, error: ERRANDS_QUOTE_UNAVAILABLE_ERROR };
  }
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
