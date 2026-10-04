import { Order, OrderSettlementAdjustment, PlatformPricingSettings } from '../types/database';
import { aggregateFinancials, isCommissionRecognized, round2 } from './commission';

/**
 * Distance-based delivery pricing — the CLIENT-side preview helpers.
 *
 * Everything here exists to render a number the server has already (or is
 * about to) calculate: the trusted distance, fee and courier earning come
 * from the database through `create_delivery_quote()` (see
 * src/lib/deliveryQuote.ts). Nothing on this screen can be trusted for
 * settlement, and nothing here is ever sent to the server as money.
 *
 * Formula (mirrors public.delivery_pricing_amounts()):
 *   fee = clamp(base_fee + distance_km × per_km_rate, min_fee, max_fee?)
 *
 * Restaurant commission deliberately does NOT live here: it is a separate
 * calculation on the food subtotal only (see src/lib/commission.ts).
 */

export const DEFAULT_PRICING: PlatformPricingSettings = {
  base_fee: 12.0,
  per_km_rate: 2.5,
  min_fee: 10.0,
  max_fee: 60.0,
  currency: 'GHS',
  surge_multiplier: 1.0,
  // Phase 1: the courier receives the full delivery fee (0% commission).
  courier_earning_percentage: 100.0,
  pricing_version: 1,
  // Deprecated legacy keys (kept for stored JSON compatibility).
  // Courier earnings are derived from CommissionSettings
  // .courier_commission_percentage — 0% in Phase 1, i.e. the courier
  // receives the full delivery fee.
  courier_payout_percentage: 100.0,
  platform_commission_percentage: 0.0,
};

/**
 * Calculates the great-circle distance between two GPS coordinates using the Haversine formula
 * Returns distance in kilometers (km)
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return Number(d.toFixed(2));
}

/** Is this a usable, precise delivery point (never a fabricated default)? */
export function isValidDeliveryPoint(
  lat: number | null | undefined,
  lng: number | null | undefined
): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // (0, 0) is the "no GPS fix" sentinel, not a place anyone lives.
  return !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

/**
 * Calculates delivery fee based on actual distance and platform pricing rules.
 *
 * The maximum fee is OPTIONAL: when it is absent/null the fee is only
 * clamped by the minimum floor. This is a preview of the server formula —
 * the database recalculates the authoritative value on every quote/order.
 */
export function calculateDeliveryFee(
  distanceKm: number,
  settings: PlatformPricingSettings = DEFAULT_PRICING
): number {
  const base = num(settings.base_fee, DEFAULT_PRICING.base_fee);
  const rate = num(settings.per_km_rate, DEFAULT_PRICING.per_km_rate);
  const min = num(settings.min_fee, DEFAULT_PRICING.min_fee);
  const surge = num(settings.surge_multiplier, 1);
  const max =
    settings.max_fee === null || settings.max_fee === undefined
      ? null
      : num(settings.max_fee, DEFAULT_PRICING.max_fee ?? 0);

  const safeDistance = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const multiplier = surge > 0 ? surge : 1;

  let fee = round2((base + safeDistance * rate) * multiplier);
  fee = Math.max(min, fee);
  if (max !== null) fee = Math.min(max, fee);
  return round2(Math.max(0, fee));
}

const num = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** "850 m" / "6.4 km" — the delivery distance exactly as it is stored. */
export function formatDistanceKm(distanceKm: number | null | undefined): string {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return '—';
  if (distanceKm < 1) return `${Math.max(10, Math.round((distanceKm * 1000) / 10) * 10)} m`;
  return `${distanceKm.toFixed(1)} km`;
}

/**
 * Formats Ghanaian Cedis cleanly
 */
export function formatGHS(amount: number): string {
  return `GH₵ ${Number(amount || 0).toFixed(2)}`;
}

/** Aggregated delivery economics, straight from real order rows. */
export interface DeliveryStats {
  /** Orders the statistics were computed from (delivered & paid). */
  orders: number;
  /** Total delivery fees collected (net of delivery refunds). */
  totalDeliveryFees: number;
  /** Total courier delivery earnings (net of courier refunds). */
  totalCourierEarnings: number;
  /** Sum of the delivery distances the platform actually travelled. */
  totalDistanceKm: number;
  averageDistanceKm: number;
  averageDeliveryFee: number;
  /** How many of those orders carried a stored route distance. */
  measuredOrders: number;
}

export const EMPTY_DELIVERY_STATS: DeliveryStats = {
  orders: 0,
  totalDeliveryFees: 0,
  totalCourierEarnings: 0,
  totalDistanceKm: 0,
  averageDistanceKm: 0,
  averageDeliveryFee: 0,
  measuredOrders: 0,
};

/**
 * Delivery reporting — every figure is summed from stored order rows
 * (delivery_distance_km / delivery_fee / courier_earning). No mock data,
 * no estimates: orders without a stored distance are simply not counted
 * in the distance averages.
 *
 * Money is netted against the append-only refund adjustments so a
 * refunded delivery never inflates "collected".
 */
export function aggregateDeliveryStats(
  orders: Order[],
  adjustments: OrderSettlementAdjustment[] = []
): DeliveryStats {
  const money = aggregateFinancials(orders, adjustments);
  if (money.recognizedOrders === 0) return { ...EMPTY_DELIVERY_STATS };

  const recognized = orders.filter(isCommissionRecognized);
  const recognizedIds = new Set(recognized.map((order) => order.id));

  let totalDistanceKm = 0;
  let measuredOrders = 0;
  for (const order of recognized) {
    const distance = order.delivery_distance_km;
    if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) continue;
    totalDistanceKm += distance;
    measuredOrders += 1;
  }

  // Courier earnings are already netted by aggregateFinancials (via
  // courier_earning_adjustment); delivery refunds are netted here because
  // the customer got that money back.
  const deliveryRefunded = adjustments.reduce(
    (sum, adj) =>
      recognizedIds.has(adj.order_id) ? sum + (adj.delivery_amount_refunded || 0) : sum,
    0
  );
  const totalDeliveryFees = round2(money.deliveryFees - deliveryRefunded);

  return {
    orders: money.recognizedOrders,
    totalDeliveryFees,
    totalCourierEarnings: money.courierEarnings,
    totalDistanceKm: round2(totalDistanceKm),
    averageDistanceKm: measuredOrders > 0 ? round2(totalDistanceKm / measuredOrders) : 0,
    averageDeliveryFee:
      money.recognizedOrders > 0 ? round2(totalDeliveryFees / money.recognizedOrders) : 0,
    measuredOrders,
  };
}
