/**
 * Errands booking client — status moves, creation and expiry.
 *
 * Money, identity and availability are decided by the database: the browser
 * posts ONLY a quote id, a driver id and status transitions. It never sends a
 * fare, a coordinate or a status it invented.
 *
 * Every call never throws; failures resolve to `{ ok: false, error }` with
 * customer-facing copy (the database's own sentences are unwrapped from the
 * PostgREST envelope).
 */

import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../supabase';
import type { ErrandsBooking, ErrandsBookingStatus } from './types';

/** How long the driver has to respond before a request expires (mirrors SQL). */
export const ERRANDS_REQUEST_TTL_FALLBACK_SECONDS = 90;

export type ErrandsActionResult =
  | { ok: true; booking: ErrandsBooking }
  | { ok: false; error: string };

export type ErrandsCreateResult =
  | {
      ok: true;
      booking: ErrandsBooking;
      /** Only ever present for RIDE_CAR, only ever returned to the customer. */
      tripPin: string | null;
    }
  | { ok: false; error: string };

interface BookingRow {
  id?: string;
  booking_number?: string;
  customer_id?: string;
  driver_id?: string;
  service_category?: string;
  status?: string;
  pickup_area?: string | null;
  destination_area?: string | null;
  route_distance_km?: number;
  distance_source?: string;
  estimated_duration_seconds?: number | null;
  estimated_fare?: number;
  final_fare?: number | null;
  driver_earning?: number;
  currency?: string;
  pricing_version?: number;
  quote_id?: string | null;
  requested_expires_at?: string;
  accepted_at?: string | null;
  arrived_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  failure_note?: string | null;
  created_at?: string;
  details?: Record<string, unknown> | null;
  trip_pin?: string | null;
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

const parseDetails = (raw: unknown): ErrandsBooking['details'] => {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    pickupLatitude: asNullableNumber(row.pickup_latitude),
    pickupLongitude: asNullableNumber(row.pickup_longitude),
    pickupAddress: asString(row.pickup_address),
    destinationLatitude: asNullableNumber(row.destination_latitude),
    destinationLongitude: asNullableNumber(row.destination_longitude),
    destinationAddress: asString(row.destination_address),
    customerName: asString(row.customer_name),
    customerPhone: asString(row.customer_phone),
    driverName: asString(row.driver_name),
    driverAvatarUrl: asString(row.driver_avatar_url),
    driverVehicleType: asString(row.driver_vehicle_type),
    driverVehiclePlate: asString(row.driver_vehicle_plate),
    driverRating: asNullableNumber(row.driver_rating),
  };
};

const STATUS_VALUES: readonly ErrandsBookingStatus[] = [
  'REQUESTED',
  'DRIVER_ACCEPTED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
];

const parseStatus = (value: unknown): ErrandsBookingStatus =>
  STATUS_VALUES.includes(value as ErrandsBookingStatus)
    ? (value as ErrandsBookingStatus)
    : 'REQUESTED';

export function parseBooking(row: BookingRow | null | undefined): ErrandsBooking | null {
  if (!row || !row.id) return null;
  return {
    id: String(row.id),
    bookingNumber: String(row.booking_number ?? ''),
    customerId: String(row.customer_id ?? ''),
    driverId: String(row.driver_id ?? ''),
    serviceCategory: row.service_category === 'RIDE_CAR' ? 'RIDE_CAR' : 'ERRAND_MOTORCYCLE',
    status: parseStatus(row.status),
    pickupArea: asString(row.pickup_area),
    destinationArea: asString(row.destination_area),
    routeDistanceKm: asNumber(row.route_distance_km),
    distanceSource: row.distance_source === 'ROAD_ROUTE' ? 'ROAD_ROUTE' : 'STRAIGHT_LINE',
    estimatedDurationSeconds: asNullableNumber(row.estimated_duration_seconds),
    estimatedFare: asNumber(row.estimated_fare),
    finalFare: asNullableNumber(row.final_fare),
    driverEarning: asNumber(row.driver_earning),
    currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GHS',
    pricingVersion: Math.round(asNumber(row.pricing_version, 1)),
    quoteId: asString(row.quote_id),
    requestedExpiresAt: String(row.requested_expires_at ?? ''),
    acceptedAt: asString(row.accepted_at),
    arrivedAt: asString(row.arrived_at),
    startedAt: asString(row.started_at),
    completedAt: asString(row.completed_at),
    cancelledAt: asString(row.cancelled_at),
    cancellationReason: asString(row.cancellation_reason),
    failureNote: asString(row.failure_note),
    createdAt: String(row.created_at ?? ''),
    details: parseDetails(row.details),
    tripPin: asString(row.trip_pin),
  };
}

/**
 * Customer-facing copy for a failed action. The database's own sentences are
 * preferred (they are written for end users); this only fills the gaps.
 */
function actionError(error: { message?: string | null } | null, fallback: string): string {
  const message = cleanRpcErrorMessage(error?.message, fallback);
  if (/does not exist|schema cache/i.test(message)) {
    return 'Errands is not switched on for this project yet — please try again shortly.';
  }
  if (/sign in|jwt|not authorized|permission denied/i.test(message)) {
    return 'Sign in to manage your Errands booking.';
  }
  return message;
}

/**
 * Reserve a driver for a quote. The database revalidates the quote (owner,
 * expiry, single use) and the driver's eligibility under a row lock, so two
 * customers racing for the same driver resolve to exactly one winner — the
 * loser receives an honest "just became unavailable" message.
 */
export async function createErrandsBooking(input: {
  quoteId: string;
  driverId: string;
}): Promise<ErrandsCreateResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Connect Supabase to book an Errand.' };
  }
  if (!input.quoteId || !input.driverId) {
    return { ok: false, error: 'Select a driver to continue.' };
  }

  const { data, error } = await supabase.rpc('create_errands_booking', {
    p_quote_id: input.quoteId,
    p_driver_id: input.driverId,
  });

  if (error) {
    return { ok: false, error: actionError(error, 'Could not book this driver.') };
  }

  const row = data as BookingRow | null;
  const booking = parseBooking(row);
  if (!booking) {
    return { ok: false, error: 'The booking could not be confirmed. Please try again.' };
  }

  return { ok: true, booking, tripPin: booking.tripPin };
}

/**
 * Move a booking to the next status. For RIDE_CAR the customer's trip PIN is
 * required to start the trip — the driver submits it but can never read it.
 */
export async function setErrandsBookingStatus(input: {
  bookingId: string;
  status: ErrandsBookingStatus;
  note?: string | null;
  tripPin?: string | null;
}): Promise<ErrandsActionResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Connect Supabase to update this booking.' };
  }
  if (!input.bookingId || !input.status) {
    return { ok: false, error: 'Missing booking or status.' };
  }

  const { data, error } = await supabase.rpc('errands_set_booking_status', {
    p_booking_id: input.bookingId,
    p_new_status: input.status,
    p_note: input.note ?? null,
    p_trip_pin: input.tripPin ?? null,
  });

  if (error) {
    return { ok: false, error: actionError(error, 'Could not update this booking.') };
  }

  const booking = parseBooking(data as BookingRow | null);
  if (!booking) {
    return { ok: false, error: 'The booking could not be updated. Please try again.' };
  }
  return { ok: true, booking };
}

/**
 * Expire any REQUESTED booking whose response window has passed. Called by
 * the customer's tracking view and the driver's job panel as a safety net
 * alongside realtime — a request never waits forever.
 */
export async function expireStaleErrandsBookings(): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  const { data, error } = await supabase.rpc('errands_expire_stale_bookings');
  if (error) return 0;
  return typeof data === 'number' && Number.isFinite(data) ? data : 0;
}

/**
 * Fetch one booking the caller is allowed to see (customer, driver after
 * acceptance, or admin). `null` means "not found / not visible" — the caller
 * shows its honest empty state, never a fabricated booking.
 */
export async function fetchErrandsBooking(
  bookingId: string
): Promise<ErrandsBooking | null> {
  if (!isSupabaseConfigured || !bookingId) return null;
  const { data, error } = await supabase.rpc('errands_booking_payload', {
    p_booking_id: bookingId,
  });
  if (error) return null;
  return parseBooking(data as BookingRow | null);
}

/** The customer's bookings, newest first (RLS scopes them server-side). */
export async function fetchMyErrandsBookings(limit = 20): Promise<ErrandsBooking[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('errands_bookings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error || !Array.isArray(data)) return [];
  return (data as BookingRow[])
    .map(parseBooking)
    .filter((booking): booking is ErrandsBooking => booking !== null);
}

/** The driver's assigned requests (RLS scopes them server-side). */
export async function fetchDriverErrandsBookings(limit = 20): Promise<ErrandsBooking[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('errands_bookings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error || !Array.isArray(data)) return [];
  return (data as BookingRow[])
    .map(parseBooking)
    .filter((booking): booking is ErrandsBooking => booking !== null);
}
