/**
 * Ride-selection presentation data for the customer Errands screen.
 *
 * The CATEGORIES that exist are the ones the backend prices and the operator
 * switched on (`errands_pricing_rules` + the service switches) — this module
 * only maps those categories onto the short names the ride list uses. It never
 * adds a service: a category that has no backend support has no entry here, so
 * the screen has nothing to render for it and cannot offer it as bookable.
 *
 * The payment methods are the ones SamleyGo already records on a customer's
 * order (the same list the food checkout uses). There is no payment gateway:
 * they describe how the customer settles with the platform / driver, and the
 * choice is stored on the booking so the driver can see it.
 */

import type { ErrandsServiceCategory } from './types';

/** The names the ride-selection list and its buttons use. */
export const RIDE_OPTION_LABELS: Record<ErrandsServiceCategory, string> = {
  ERRAND_MOTORCYCLE: 'Send Motorbike',
  CAR_ERRAND: 'Car Delivery',
  RIDE_CAR: 'Car Ride',
};

/** One honest line per service — no marketing claims, no invented capacity. */
export const RIDE_OPTION_BLURBS: Record<ErrandsServiceCategory, string> = {
  ERRAND_MOTORCYCLE: 'A rider collects your parcel and delivers it across town',
  CAR_ERRAND: 'A car courier for bigger parcels and heavier loads',
  RIDE_CAR: 'A car for you and your passengers',
};

/** The button label for a service: `Select Car Ride`, never another brand. */
export const selectRideLabel = (category: ErrandsServiceCategory): string =>
  `Select ${RIDE_OPTION_LABELS[category]}`;

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export type ErrandsPaymentMethodId =
  | 'CASH'
  | 'MTN_MOMO'
  | 'TELECEL_CASH'
  | 'AT_MONEY'
  | 'CARD';

export interface ErrandsPaymentMethod {
  id: ErrandsPaymentMethodId;
  label: string;
  /** Short, factual qualifier — a dial string or when the money changes hands. */
  hint: string;
  icon: 'cash' | 'mobile' | 'card';
}

export const ERRANDS_PAYMENT_METHODS: readonly ErrandsPaymentMethod[] = [
  { id: 'CASH', label: 'Cash', hint: 'Settle with your driver', icon: 'cash' },
  { id: 'MTN_MOMO', label: 'MTN Mobile Money', hint: 'MTN MoMo · *170#', icon: 'mobile' },
  { id: 'TELECEL_CASH', label: 'Telecel Cash', hint: 'Telecel · *110#', icon: 'mobile' },
  { id: 'AT_MONEY', label: 'AT Money', hint: 'AT Money · *110#', icon: 'mobile' },
  { id: 'CARD', label: 'Debit / Credit Card', hint: 'Visa / Mastercard', icon: 'card' },
];

/** Cash is the default because it is the only tender with no third party. */
export const DEFAULT_ERRANDS_PAYMENT_METHOD: ErrandsPaymentMethodId = 'CASH';

export const isErrandsPaymentMethod = (value: unknown): value is ErrandsPaymentMethodId =>
  ERRANDS_PAYMENT_METHODS.some((method) => method.id === value);

/** Display copy for whatever the booking row carries (never throws). */
export const errandsPaymentLabel = (value: unknown): string =>
  ERRANDS_PAYMENT_METHODS.find((method) => method.id === value)?.label ?? 'Cash';

// ---------------------------------------------------------------------------
// Pickup ETA formatting
// ---------------------------------------------------------------------------

/**
 * The row-level "how long until the rider reaches you" line. The number is a
 * real road ETA from the nearest eligible driver to the pickup point; when the
 * routing engine could not answer, `null` is returned so the caller can fall
 * back to the honest straight-line distance instead of a made-up minute count.
 */
export const formatPickupEta = (seconds: number | null | undefined): string | null => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
};

/**
 * Arrival clock label for the drop-off callout: now + the server's estimated
 * trip duration. `null` when there is no duration to build a time from — the
 * callout then shows the label only, never a fabricated time.
 */
export const formatArrivalClock = (
  durationSeconds: number | null | undefined,
  nowMs: number = Date.now()
): string | null => {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  const arrival = new Date(nowMs + durationSeconds * 1000);
  const hours24 = arrival.getHours();
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours}:${String(arrival.getMinutes()).padStart(2, '0')}`;
};
