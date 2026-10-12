/**
 * Errands fare preview — the customer's COPY of the server formula in
 * `errands_pricing_amounts()` (see
 * `supabase/migrations/20261012_errands_module.sql`).
 *
 * The database is the authority: it recomputes the fare when a quote is
 * issued AND again when the booking is created, so this function only exists
 * to render a settings preview in the admin screen. It is never used to show
 * a customer a price — customers only ever see what `create_errands_quote()`
 * answered — and a test asserts it stays in sync with the SQL.
 *
 * Fare structure:
 *   trip_fare   = clamp(round((base + km x per_km) x surge, 2), min, max?)
 *   total       = trip_fare + booking_fee + round((trip_fare + fee) x tax%, 2)
 *   driver pay  = round(total x earning% / 100, 2)
 * `min_fare = 0` means "no floor", `max_fare = null` means "no ceiling".
 */

import type { ErrandsPricingSettings } from './types';

const round2 = (value: number): number => Math.round(value * 100) / 100;

const num = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export interface ErrandsFareBreakdown {
  tripFare: number;
  bookingFee: number;
  taxAmount: number;
  /** What the customer pays. */
  total: number;
  /** What the driver earns from that total. */
  driverEarning: number;
  currency: string;
}

/** Clamp a trip fare between the floor and the OPTIONAL ceiling. */
export function clampTripFare(
  raw: number,
  settings: Pick<ErrandsPricingSettings, 'minFare' | 'maxFare'>
): number {
  let fare = round2(Math.max(0, raw));
  const min = num(settings.minFare, 0);
  if (min > 0) fare = Math.max(min, fare);
  const max =
    settings.maxFare === null || settings.maxFare === undefined
      ? null
      : num(settings.maxFare, 0);
  if (max !== null && max > 0) fare = Math.min(max, fare);
  return round2(Math.max(0, fare));
}

/**
 * Price a route with the given rules. Returns `null` when the rules are not
 * configured — the caller must then show the admin-required message and
 * NEVER invent a price.
 */
export function calculateErrandsFare(
  distanceKm: number,
  settings: ErrandsPricingSettings | null | undefined
): ErrandsFareBreakdown | null {
  if (!settings || !settings.configured) return null;

  const safeDistance = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const base = num(settings.baseFare, 0);
  const rate = num(settings.perKmRate, 0);
  const surgeRaw = num(settings.surgeMultiplier, 1);
  const surge = surgeRaw > 0 ? surgeRaw : 1;

  const tripFare = clampTripFare((base + safeDistance * rate) * surge, settings);

  const bookingFee = Math.max(0, num(settings.bookingFee, 0));
  const taxRaw = num(settings.taxRatePercent, 0);
  const taxPercent = Math.min(100, Math.max(0, taxRaw));
  const taxAmount = round2(((tripFare + bookingFee) * taxPercent) / 100);
  const total = round2(Math.max(0, tripFare + bookingFee + taxAmount));

  const earningRaw = num(settings.driverEarningPercentage, 100);
  const earningPercent = Math.min(100, Math.max(0, earningRaw));
  const driverEarning = round2((total * earningPercent) / 100);

  return {
    tripFare,
    bookingFee,
    taxAmount,
    total,
    driverEarning,
    currency: settings.currency || 'GHS',
  };
}

/** The message shown wherever a fare cannot honestly be produced. */
export const ERRANDS_PRICING_UNCONFIGURED_MESSAGE =
  'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings → Errands before customers can be shown a price.';
