/**
 * Errands fare preview — the customer's COPY of the server formula in
 * `errands_pricing_amounts()` (see
 * `supabase/migrations/20261012_errands_per_distance_pricing.sql`).
 *
 * The database is the authority: it recomputes the fare when a quote is
 * issued AND again when the booking is created, so this function only exists
 * to render a settings preview in the admin screen. It is never used to show
 * a customer a price — customers only ever see what `create_errands_quote()`
 * answered — and a test asserts it stays in sync with the SQL.
 *
 * Fare structure — strictly per-distance, no fixed component anywhere:
 *   trip_fare   = round(km x per_km_rate x surge, 2)
 *   tax         = round(trip_fare x tax%, 2)
 *   total       = trip_fare + tax
 *   driver pay  = round(total x earning% / 100, 2)
 * A rule set without a positive per-km rate prices NOTHING: `null` is
 * returned so the caller shows the "not configured" message instead.
 */

import type { ErrandsPricingSettings } from './types';

const round2 = (value: number): number => Math.round(value * 100) / 100;

const num = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export interface ErrandsFareBreakdown {
  tripFare: number;
  taxAmount: number;
  /** What the customer pays (trip fare + tax). */
  total: number;
  /** What the driver earns from that total. */
  driverEarning: number;
  currency: string;
}

/**
 * Price a route with the given rules. Returns `null` when the rules are not
 * configured (or carry no positive per-km rate) — the caller must then show
 * the admin-required message and NEVER invent a price.
 */
export function calculateErrandsFare(
  distanceKm: number,
  settings: ErrandsPricingSettings | null | undefined
): ErrandsFareBreakdown | null {
  if (!settings || !settings.configured) return null;

  const rate = num(settings.perKmRate, 0);
  // No per-km rate means nothing to charge for distance: refuse, like the
  // database does, rather than quoting a free trip.
  if (rate <= 0) return null;

  const safeDistance = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const surgeRaw = num(settings.surgeMultiplier, 1);
  const surge = surgeRaw > 0 ? surgeRaw : 1;

  const tripFare = round2(safeDistance * rate * surge);

  const taxRaw = num(settings.taxRatePercent, 0);
  const taxPercent = Math.min(100, Math.max(0, taxRaw));
  const taxAmount = round2((tripFare * taxPercent) / 100);
  const total = round2(Math.max(0, tripFare + taxAmount));

  const earningRaw = num(settings.driverEarningPercentage, 100);
  const earningPercent = Math.min(100, Math.max(0, earningRaw));
  const driverEarning = round2((total * earningPercent) / 100);

  return {
    tripFare,
    taxAmount,
    total,
    driverEarning,
    currency: settings.currency || 'GHS',
  };
}

/** The message shown wherever a fare cannot honestly be produced. */
export const ERRANDS_PRICING_UNCONFIGURED_MESSAGE =
  'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings → Errands before customers can be shown a price.';
