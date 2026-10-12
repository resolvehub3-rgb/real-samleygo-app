/**
 * Errands fare preview — the admin screen's COPY of the server formula in
 * `errands_fare_amounts()` (see
 * `supabase/migrations/20261013_errands_fare_engine.sql`).
 *
 * The database is the authority: it prices the route when a quote is issued
 * AND re-prices it when the booking is created, so this function only exists
 * to render a settings preview. It is never used to show a customer a price —
 * customers only ever see what `create_errands_quote()` answered — and a test
 * asserts it stays in sync with the SQL.
 *
 * Fare structure (deterministic, computed in INTEGER pesewas):
 *   distance charge = km x price_per_km
 *   trip            = base + distance + (time) + (waiting)
 *   after surge     = trip x multiplier            [only when enabled]
 *   raw             = after surge + booking fee    [only if configured]
 *   estimated fare  = clamp(raw, min, max) - discount + tax
 *   driver pay      = fare x driver_earning_percent / 100
 *   platform share  = fare - driver pay - tax      (tax is a pass-through)
 *
 * A rule with no money in it (no base, no per-km rate, no minimum) prices
 * NOTHING: `null` is returned so the caller shows the "not configured"
 * message instead of GH₵0.00.
 */

const num = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Convert a GH₵ amount to integer pesewas. The `toFixed` round-trip repairs
 * the binary-float artefact (`2.675 * 100 === 267.49999999999997`) so the
 * result matches Postgres' exact-decimal `round()` on the same literal.
 */
const toPesewas = (ghs: number): number => Math.round(Number((ghs * 100).toFixed(4)));

/** Round a pesewa figure to a whole pesewa, half away from zero. */
const roundPw = (value: number): number => Math.round(Number(value.toFixed(4)));

/** The editable rule fields the admin form and the SQL setter share. */
export interface ErrandsFareRule {
  baseFare: number;
  pricePerKm: number;
  minFare: number;
  maxFare: number | null;
  bookingFee: number;
  waitingCharge: number;
  waitingChargeEnabled: boolean;
  timeChargePerMinute: number;
  timeChargeEnabled: boolean;
  surgeEnabled: boolean;
  surgeMultiplier: number;
  taxRatePercent: number;
  discountAmount: number;
  driverEarningPercent: number;
  currency?: string;
}

export interface ErrandsFareBreakdown {
  /** Fixed part of the fare, before anything else. */
  baseFare: number;
  /** km x price_per_km. */
  distanceCharge: number;
  /** Optional, only when the time charge is switched on. */
  timeCharge: number;
  /** Optional, only when the waiting charge is switched on. */
  waitingCharge: number;
  /** Flat service charge — never multiplied by surge. */
  bookingFee: number;
  /** Signed: positive when surge > 1, negative when it is a discount. */
  surgeAmount: number;
  /** Trip components + booking fee, after the capped discount, before tax. */
  tripFare: number;
  discountAmount: number;
  taxAmount: number;
  /** What the customer pays (the number shown on the quote card). */
  total: number;
  /** What the driver earns from that total. */
  driverEarning: number;
  /** Platform share after tax is handed over. */
  platformRevenue: number;
  currency: string;
}

/**
 * Price a route with one category's rules. Returns `null` when the rules are
 * missing or carry no money at all — the caller must then show the
 * admin-required message and NEVER invent a price.
 *
 * `durationSeconds` only matters when the rule enables a time charge;
 * pass `null` when the route has no duration and the charge stays at 0.
 */
export function calculateErrandsFare(
  distanceKm: number,
  durationSeconds: number | null | undefined,
  rule: ErrandsFareRule | null | undefined
): ErrandsFareBreakdown | null {
  if (!rule) return null;

  const basePw = toPesewas(Math.max(0, num(rule.baseFare, 0)));
  const ratePw = Math.max(0, num(rule.pricePerKm, 0)) * 100;
  const minPw = toPesewas(Math.max(0, num(rule.minFare, 0)));
  const rawMax = num(rule.maxFare, 0);
  const maxPw = rawMax > 0 ? toPesewas(rawMax) : null;
  const bookingPw = toPesewas(Math.max(0, num(rule.bookingFee, 0)));
  const discountPw = toPesewas(Math.max(0, num(rule.discountAmount, 0)));

  // No base, no per-km rate and no minimum means nothing to charge: refuse,
  // like the database does, rather than quoting a free trip.
  if (basePw <= 0 && ratePw <= 0 && minPw <= 0) return null;

  const waitingPw = rule.waitingChargeEnabled
    ? toPesewas(Math.max(0, num(rule.waitingCharge, 0)))
    : 0;

  const minutes = Math.max(0, num(durationSeconds, 0)) / 60;
  const timePw = rule.timeChargeEnabled
    ? roundPw(minutes * Math.max(0, num(rule.timeChargePerMinute, 0)) * 100)
    : 0;

  const safeDistance = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const distancePw = roundPw(safeDistance * ratePw);

  const tripPw = basePw + distancePw + timePw + waitingPw;

  const surgeRaw = num(rule.surgeMultiplier, 1);
  const surge = surgeRaw > 0 ? surgeRaw : 1;
  const surgedPw = rule.surgeEnabled && surge !== 1 ? roundPw(tripPw * surge) : tripPw;
  const surgeAmountPw = surgedPw - tripPw;

  const rawPw = surgedPw + bookingPw;

  // Floor then ceiling, in that order.
  let clampedPw = rawPw;
  if (minPw > 0 && clampedPw < minPw) clampedPw = minPw;
  if (maxPw !== null && clampedPw > maxPw) clampedPw = maxPw;

  const afterDiscountPw = Math.max(0, clampedPw - Math.min(discountPw, clampedPw));
  const taxPct = Math.min(100, Math.max(0, num(rule.taxRatePercent, 0)));
  const taxPw = roundPw((afterDiscountPw * taxPct) / 100);
  const totalPw = afterDiscountPw + taxPw;

  const earnPct = Math.min(100, Math.max(0, num(rule.driverEarningPercent, 100)));
  const driverPw = roundPw((totalPw * earnPct) / 100);
  const platformPw = Math.max(0, totalPw - driverPw - taxPw);

  return {
    baseFare: basePw / 100,
    distanceCharge: distancePw / 100,
    timeCharge: timePw / 100,
    waitingCharge: waitingPw / 100,
    bookingFee: bookingPw / 100,
    surgeAmount: surgeAmountPw / 100,
    tripFare: (surgedPw + bookingPw - Math.min(discountPw, clampedPw)) / 100,
    discountAmount: Math.min(discountPw, clampedPw) / 100,
    taxAmount: taxPw / 100,
    total: totalPw / 100,
    driverEarning: driverPw / 100,
    platformRevenue: platformPw / 100,
    currency: rule.currency || 'GHS',
  };
}

/** The message shown wherever a fare cannot honestly be produced. */
export const ERRANDS_PRICING_UNCONFIGURED_MESSAGE =
  'Errands pricing has not been configured yet. A super admin must save the fare rules in Settings → Errands before customers can be shown a price.';
