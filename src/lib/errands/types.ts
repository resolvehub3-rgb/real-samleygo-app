/**
 * Errands & On-Demand Rides — shared types and status rules.
 *
 * These mirror the database contract in
 * `supabase/migrations/20261012_errands_module.sql`. The browser never
 * decides money, identity or availability — it renders what the server
 * answered and posts back only IDs (quote_id, driver_id) plus status moves.
 */

/** The three service categories the platform offers. */
export type ErrandsServiceCategory = 'ERRAND_MOTORCYCLE' | 'CAR_ERRAND' | 'RIDE_CAR';

export const ERRANDS_SERVICES: readonly ErrandsServiceCategory[] = [
  'ERRAND_MOTORCYCLE',
  'CAR_ERRAND',
  'RIDE_CAR',
];

/** Human labels for each service category. */
export const ERRANDS_SERVICE_LABELS: Record<ErrandsServiceCategory, string> = {
  ERRAND_MOTORCYCLE: 'Motorcycle errand',
  CAR_ERRAND: 'Car errand',
  RIDE_CAR: 'Passenger ride',
};

/** Short descriptions shown on the service picker. */
export const ERRANDS_SERVICE_BLURBS: Record<ErrandsServiceCategory, string> = {
  ERRAND_MOTORCYCLE: 'Parcels, food and small deliveries across town',
  CAR_ERRAND: 'Bigger parcels and deliveries that need a car',
  RIDE_CAR: 'A car picks you up and takes you there',
};

/**
 * The booking lifecycle. `DRIVER_ASSIGNED` from the original spec is
 * intentionally absent: the customer picks a specific driver, so a booking is
 * created already reserved for that driver — REQUESTED *is* the assigned
 * state, and acceptance, decline and timeout are explicit.
 */
export type ErrandsBookingStatus =
  | 'REQUESTED'
  | 'DRIVER_ACCEPTED'
  | 'DRIVER_ARRIVING'
  | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

/** Statuses that mean a trip is live (driver is committed, customer is waiting). */
export const ACTIVE_ERRANDS_STATUSES: readonly ErrandsBookingStatus[] = [
  'REQUESTED',
  'DRIVER_ACCEPTED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

/** Statuses that end a trip (money settles, driver is released). */
export const TERMINAL_ERRANDS_STATUSES: readonly ErrandsBookingStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
];

/**
 * Who may move a booking out of each status, mirroring the CASE in
 * `errands_set_booking_status()` one-for-one (a test asserts this stays in
 * sync with the migration). The database remains the authority — this map
 * only lets the UI show/hide buttons without guessing.
 */
export const ERRANDS_ALLOWED_TRANSITIONS: Record<
  ErrandsBookingStatus,
  readonly { to: ErrandsBookingStatus; actors: readonly ErrandsActor[] }[]
> = {
  REQUESTED: [
    { to: 'DRIVER_ACCEPTED', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['DRIVER', 'CUSTOMER', 'ADMIN'] },
    // Only once the response window has genuinely passed.
    { to: 'EXPIRED', actors: ['DRIVER', 'CUSTOMER', 'ADMIN'] },
  ],
  DRIVER_ACCEPTED: [
    { to: 'DRIVER_ARRIVING', actors: ['DRIVER'] },
    { to: 'DRIVER_ARRIVED', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['DRIVER', 'CUSTOMER', 'ADMIN'] },
    { to: 'FAILED', actors: ['DRIVER', 'ADMIN'] },
  ],
  DRIVER_ARRIVING: [
    { to: 'DRIVER_ARRIVED', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['DRIVER', 'CUSTOMER', 'ADMIN'] },
    { to: 'FAILED', actors: ['DRIVER', 'ADMIN'] },
  ],
  DRIVER_ARRIVED: [
    // RIDE_CAR additionally requires the customer's trip PIN (checked in the
    // database; the driver submits it but can never read it).
    { to: 'IN_PROGRESS', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['DRIVER', 'CUSTOMER', 'ADMIN'] },
    { to: 'FAILED', actors: ['DRIVER', 'ADMIN'] },
  ],
  IN_PROGRESS: [
    { to: 'COMPLETED', actors: ['DRIVER'] },
    { to: 'FAILED', actors: ['DRIVER', 'ADMIN'] },
  ],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
};

export type ErrandsActor = 'DRIVER' | 'CUSTOMER' | 'ADMIN';

/** May `actor` move a booking out of `from` into `to`? */
export function canTransition(
  from: ErrandsBookingStatus,
  to: ErrandsBookingStatus,
  actor: ErrandsActor
): boolean {
  return ERRANDS_ALLOWED_TRANSITIONS[from].some(
    (entry) => entry.to === to && entry.actors.includes(actor)
  );
}

/** Status copy a customer reads on the tracking card. */
export const ERRANDS_STATUS_LABELS: Record<ErrandsBookingStatus, string> = {
  REQUESTED: 'Waiting for your driver to accept',
  DRIVER_ACCEPTED: 'Your driver accepted — on the way to you',
  DRIVER_ARRIVING: 'Your driver is arriving',
  DRIVER_ARRIVED: 'Your driver has arrived',
  IN_PROGRESS: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'The driver did not respond in time',
  FAILED: 'Trip failed',
};

/** A driver as returned by `errands_nearby_drivers()` (minimal disclosure). */
export interface ErrandsNearbyDriver {
  driverId: string;
  fullName: string | null;
  avatarUrl: string | null;
  vehicleType: string | null;
  /** 'MOTORCYCLE' or 'CAR' — which map marker to draw. */
  vehicleCategory: string;
  rating: number | null;
  totalDeliveries: number | null;
  latitude: number | null;
  longitude: number | null;
  locationUpdatedAt: string | null;
  locationAgeSeconds: number | null;
  /** Straight-line distance from the pickup point, in km. */
  distanceKm: number | null;
  isVerified: boolean;
}

/** The exact route/contact row — visible to the driver only AFTER accepting. */
export interface ErrandsBookingDetails {
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  pickupAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  destinationAddress: string | null;
  customerName: string | null;
  customerPhone: string | null;
  driverName: string | null;
  driverAvatarUrl: string | null;
  driverVehicleType: string | null;
  driverVehiclePlate: string | null;
  driverRating: number | null;
}

/** A booking as returned by `errands_booking_payload()`. */
export interface ErrandsBooking {
  id: string;
  bookingNumber: string;
  customerId: string;
  driverId: string;
  serviceCategory: ErrandsServiceCategory;
  status: ErrandsBookingStatus;
  pickupArea: string | null;
  destinationArea: string | null;
  routeDistanceKm: number;
  distanceSource: 'ROAD_ROUTE' | 'STRAIGHT_LINE';
  estimatedDurationSeconds: number | null;
  estimatedFare: number;
  finalFare: number | null;
  driverEarning: number;
  currency: string;
  pricingVersion: number;
  quoteId: string | null;
  requestedExpiresAt: string;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  failureNote: string | null;
  createdAt: string;
  /** Exact endpoints/contacts — `null` for a driver who has not accepted. */
  details: ErrandsBookingDetails | null;
  /** 4-digit passenger-ride PIN — only ever returned to the customer. */
  tripPin: string | null;
}

/** Per-driver service opt-in, as reported by `driver_capability_payload()`. */
export interface ErrandsDriverCapability {
  courierId: string;
  errandsEnabled: boolean;
  motorcycleErrands: boolean;
  /** Car deliveries — granted by an operator, never self-service. */
  carErrands: boolean;
  carRides: boolean;
}

/** Operator switches, as reported by `get_errands_config()`. */
export interface ErrandsConfig {
  enabled: boolean;
  services: Record<ErrandsServiceCategory, boolean>;
  currency: string;
}

/** Pricing rules, as reported by `get_errands_pricing_settings()`. */
export interface ErrandsPricingSettings {
  configured: boolean;
  currency: string;
  pricingVersion: number;
  /** The fare IS this rate × the route distance — there is no fixed part. */
  perKmRate: number;
  taxRatePercent: number;
  surgeMultiplier: number;
  driverEarningPercentage: number;
  quoteTtlMinutes: number;
  requestTtlSeconds: number;
}

/**
 * One versioned row of `errands_pricing_rules` — the authoritative fare
 * configuration for a single service (and vehicle) category. Exactly one
 * row per category is `isActive`; the rest are the history that issued
 * quotes still point at. Amounts are GHS as stored by the database.
 */
export interface ErrandsPricingRule {
  id: string;
  serviceCategory: ErrandsServiceCategory;
  vehicleCategory: 'MOTORCYCLE' | 'CAR';
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
  platformCommissionPercent: number;
  currency: string;
  pricingVersion: number;
  effectiveFrom: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
