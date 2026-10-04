import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from './supabase';
import { fetchRoadDistanceKm, LatLng } from './routing';
import { isValidDeliveryPoint } from './pricing';

/**
 * Delivery quotes — the customer's copy of the SERVER's distance/fee
 * calculation.
 *
 * Flow:
 *   1. Ask the mapping service for the real road route
 *      restaurant -> customer (best effort, short timeout).
 *   2. Call `create_delivery_quote()` with those coordinates (+ the road
 *      distance, when one was resolved).
 *   3. The database reads the restaurant coordinates itself, measures the
 *      straight-line distance, accepts the road distance only if it is
 *      plausible, loads the current pricing rules and returns the quote.
 *
 * Nothing here decides what the customer pays: the browser only renders
 * what the server answered, and the orders INSERT recalculates/validates
 * the same quote again before any money is recorded.
 */

/** The exact message shown when no trustworthy delivery point exists. */
export const DELIVERY_LOCATION_ERROR =
  'Please select a valid delivery location to calculate your delivery fee.';

/** Quotes are priced for 5 minutes (mirrors `interval '5 minutes'` server-side). */
export const DELIVERY_QUOTE_TTL_MS = 5 * 60_000;

/** Refresh a little before expiry so checkout never posts a stale quote. */
const QUOTE_REFRESH_MARGIN_MS = 45_000;

/** A road lookup must never hold the checkout up for long. */
const ROAD_ROUTE_BUDGET_MS = 3_000;

export type DistanceSource = 'ROAD_ROUTE' | 'STRAIGHT_LINE';

export interface DeliveryQuote {
  quoteId: string;
  restaurantId: string;
  /** Restaurant -> customer route distance actually used for pricing. */
  distanceKm: number;
  distanceSource: DistanceSource;
  /** What the customer pays for delivery. */
  deliveryFee: number;
  /** What the courier earns from that fee (100% in Phase 1). */
  courierEarning: number;
  courierEarningPercentage: number;
  currency: string;
  pricingVersion: number;
  issuedAt: string;
  expiresAt: string;
}

export type DeliveryQuoteResult =
  | { ok: true; quote: DeliveryQuote }
  | { ok: false; error: string };

interface QuoteRow {
  quote_id?: string;
  restaurant_id?: string;
  distance_km?: number;
  distance_source?: string;
  delivery_fee?: number;
  courier_earning?: number;
  courier_earning_percentage?: number;
  currency?: string;
  pricing_version?: number;
  issued_at?: string;
  expires_at?: string;
}

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

const parseQuote = (row: QuoteRow): DeliveryQuote => ({
  quoteId: String(row.quote_id ?? ''),
  restaurantId: String(row.restaurant_id ?? ''),
  distanceKm: asNumber(row.distance_km),
  distanceSource: row.distance_source === 'ROAD_ROUTE' ? 'ROAD_ROUTE' : 'STRAIGHT_LINE',
  deliveryFee: asNumber(row.delivery_fee),
  courierEarning: asNumber(row.courier_earning),
  courierEarningPercentage: asNumber(row.courier_earning_percentage, 100),
  currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GHS',
  pricingVersion: Math.round(asNumber(row.pricing_version, 1)),
  issuedAt: String(row.issued_at ?? new Date().toISOString()),
  expiresAt: String(row.expires_at ?? new Date(Date.now() + DELIVERY_QUOTE_TTL_MS).toISOString()),
});

/** Has this quote expired (with a small safety margin)? */
export function isQuoteUsable(quote: DeliveryQuote | null, now = Date.now()): boolean {
  if (!quote || !quote.quoteId) return false;
  const expires = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expires)) return false;
  return expires - QUOTE_REFRESH_MARGIN_MS > now;
}

/** Server messages that really mean "the delivery point is not usable". */
const isLocationError = (message: string): boolean =>
  /valid delivery location/i.test(message);

/**
 * Ask the backend for a delivery quote.
 *
 * Never throws — every failure resolves to `{ ok: false, error }` with
 * customer-facing copy.
 */
export async function requestDeliveryQuote(input: {
  restaurantId: string;
  /** Used only to look up the road route; the server reads its own copy. */
  restaurantPoint: LatLng | null;
  deliveryPoint: LatLng;
}): Promise<DeliveryQuoteResult> {
  const { restaurantId, restaurantPoint, deliveryPoint } = input;

  if (!restaurantId) return { ok: false, error: 'No restaurant selected.' };
  if (!isValidDeliveryPoint(deliveryPoint?.lat, deliveryPoint?.lng)) {
    return { ok: false, error: DELIVERY_LOCATION_ERROR };
  }
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Connect Supabase to calculate a real delivery quote for this address.',
    };
  }

  // Real road distance when the mapping service answers in time; the
  // backend still measures the crow-fly distance itself and validates
  // whatever we send, so a slow or lying route service can never lower
  // the price.
  let roadDistanceKm: number | null = null;
  if (restaurantPoint && isValidDeliveryPoint(restaurantPoint.lat, restaurantPoint.lng)) {
    roadDistanceKm = await Promise.race([
      fetchRoadDistanceKm(restaurantPoint, deliveryPoint).catch(() => null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ROAD_ROUTE_BUDGET_MS)),
    ]);
  }

  const { data, error } = await supabase.rpc('create_delivery_quote', {
    p_restaurant_id: restaurantId,
    p_delivery_lat: deliveryPoint.lat,
    p_delivery_lng: deliveryPoint.lng,
    p_road_distance_km: roadDistanceKm,
  });

  if (error) {
    // PostgREST wraps the exception; unwrap it so the customer reads the
    // database's own sentence (including the required location copy).
    const message = cleanRpcErrorMessage(
      error.message,
      'Could not calculate the delivery fee.'
    );
    if (isLocationError(message)) return { ok: false, error: DELIVERY_LOCATION_ERROR };
    if (/sign in|jwt|not authorized|permission denied/i.test(message)) {
      return {
        ok: false,
        error: 'Sign in to see your delivery fee before checkout.',
      };
    }
    // The pricing migration has not been applied to this project yet — say
    // so plainly instead of leaking an internal function name.
    if (/does not exist|schema cache/i.test(message)) {
      return {
        ok: false,
        error: 'Delivery pricing is not switched on for this project yet — please try again shortly.',
      };
    }
    return { ok: false, error: message };
  }

  const row = data as QuoteRow | null;
  if (!row || !row.quote_id) {
    return { ok: false, error: DELIVERY_LOCATION_ERROR };
  }

  return { ok: true, quote: parseQuote(row) };
}

/**
 * Guarantees a usable quote at checkout time: reuses the one on screen
 * while it is still valid, otherwise asks the backend for a fresh one
 * (an expired quote must never be submitted).
 */
export async function ensureFreshQuote(input: {
  current: DeliveryQuote | null;
  restaurantId: string;
  restaurantPoint: LatLng | null;
  deliveryPoint: LatLng;
}): Promise<DeliveryQuoteResult> {
  if (isQuoteUsable(input.current)) {
    return { ok: true, quote: input.current as DeliveryQuote };
  }
  return requestDeliveryQuote(input);
}
