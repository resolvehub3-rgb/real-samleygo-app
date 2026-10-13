import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Bike,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Star,
  Wallet,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatDistanceKm, formatGHS, isValidDeliveryPoint } from '../../lib/pricing';
import {
  LatLng,
  formatRouteDuration,
  fetchRoadRoute,
  geocodeAddress,
  reverseGeocodeAddress,
} from '../../lib/routing';
import {
  describeGeoError,
  getCurrentPositionSafe,
  isGeolocationAvailable,
} from '../../lib/geolocation';
import { fetchErrandsConfig, isServiceEnabled } from '../../lib/errands/config';
import {
  ensureFreshErrandsQuote,
  isQuoteUsable,
  requestErrandsQuote,
  secondsUntilQuoteExpiry,
  type ErrandsQuote,
  type ErrandsQuoteInput,
} from '../../lib/errands/quote';
import { ERRANDS_DISCOVERY_POLL_MS, fetchNearbyErrandsDrivers } from '../../lib/errands/discovery';
import {
  createErrandsBooking,
  expireStaleErrandsBookings,
  fetchErrandsBooking,
  fetchMyErrandsBookings,
  setErrandsBookingStatus,
} from '../../lib/errands/booking';
import {
  ACTIVE_ERRANDS_STATUSES,
  ERRANDS_SERVICES,
  ERRANDS_STATUS_LABELS,
  canTransition,
  type ErrandsBooking,
  type ErrandsNearbyDriver,
  type ErrandsServiceCategory,
} from '../../lib/errands/types';
import {
  DEFAULT_ERRANDS_PAYMENT_METHOD,
  ERRANDS_PAYMENT_METHODS,
  RIDE_OPTION_BLURBS,
  RIDE_OPTION_LABELS,
  errandsPaymentLabel,
  formatArrivalClock,
  formatPickupEta,
  isErrandsPaymentMethod,
  selectRideLabel,
  type ErrandsPaymentMethodId,
} from '../../lib/errands/rideOptions';
import { AddressSearchField } from '../../components/common/AddressSearchField';
import { ErrandsMap } from '../../components/errands/ErrandsMap';
import { RideLocationBar } from '../../components/errands/RideLocationBar';
import { RideSheet } from '../../components/errands/RideSheet';
import { RIDE_VEHICLE_ART } from '../../components/errands/VehicleArt';
import { EmptyState, ErrorState } from '../../components/customer/States';

/**
 * Errands & On-Demand Rides — the customer's booking surface.
 *
 * Everything on this page is real server data or an honest empty/loading/
 * error state: fares come only from `create_errands_quote` (through the
 * quote client), drivers only from `errands_nearby_drivers`, positions only
 * from the GPS the drivers themselves published, and every status move is
 * re-validated by the database. The browser never decides money or identity.
 */

/** Statuses where the driver's live GPS is readable by this customer. */
const LIVE_DRIVER_POSITION_STATUSES = [
  'DRIVER_ACCEPTED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
] as const;

/** Statuses where the passenger-ride PIN is still worth showing. */
const PIN_VISIBLE_STATUSES = [
  'REQUESTED',
  'DRIVER_ACCEPTED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
] as const;

const samePoint = (a: LatLng | null, b: LatLng | null): boolean =>
  (!a && !b) || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

/** Two quote requests describe the same trip when their endpoints match. */
const sameQuoteInput = (a: ErrandsQuoteInput, b: ErrandsQuoteInput): boolean =>
  a.serviceCategory === b.serviceCategory &&
  a.pickup.address === b.pickup.address &&
  a.destination.address === b.destination.address &&
  samePoint(a.pickup.point, b.pickup.point) &&
  samePoint(a.destination.point, b.destination.point);

/**
 * What makes a quote request "the same trip" for the purpose of deciding
 * whether a fresh price is needed. The address text is deliberately left
 * out: editing it clears the coordinates, which changes this key anyway.
 */
const quoteKey = (input: ErrandsQuoteInput): string =>
  `${input.serviceCategory}|${input.pickup.point.lat.toFixed(6)},${input.pickup.point.lng.toFixed(6)}` +
  `|${input.destination.point.lat.toFixed(6)},${input.destination.point.lng.toFixed(6)}`;

/** How long the form settles before a price is requested (one routing burst). */
const AUTO_QUOTE_DEBOUNCE_MS = 700;

const asPoint = (lat: number | null | undefined, lng: number | null | undefined): LatLng | null =>
  lat != null && lng != null && isValidDeliveryPoint(lat, lng) ? { lat, lng } : null;

/** Honest rating display: stars for a real rating, "New driver" when null. */
const RatingStars: React.FC<{ rating: number | null }> = ({ rating }) => {
  if (rating === null || !Number.isFinite(rating)) {
    return <span className="text-[11px] font-medium text-slate-400">New driver</span>;
  }
  const filled = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <span className="inline-flex items-center gap-1">
      <span className="flex" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <Star
            key={index}
            className={`h-3 w-3 ${index < filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
          />
        ))}
      </span>
      <span className="text-[11px] font-semibold text-slate-600">{rating.toFixed(1)}</span>
    </span>
  );
};

/** Avatar with an honest vehicle-emoji fallback (no photo → no broken image). */
const DriverAvatar: React.FC<{ driver: ErrandsNearbyDriver }> = ({ driver }) => {
  const [failed, setFailed] = useState(false);
  if (driver.avatarUrl && !failed) {
    return (
      <img
        src={driver.avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        className="h-11 w-11 flex-shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xl"
      aria-hidden="true"
    >
      {driver.vehicleCategory === 'CAR' ? '🚗' : '🏍️'}
    </span>
  );
};

/** A driver's published GPS, or `null` when they have never reported one. */
const driverPoint = (driver: ErrandsNearbyDriver): LatLng | null =>
  driver.latitude != null &&
  driver.longitude != null &&
  isValidDeliveryPoint(driver.latitude, driver.longitude)
    ? { lat: driver.latitude, lng: driver.longitude }
    : null;

/** Per-service discovery: what `errands_nearby_drivers` answered for a category. */
type CategoryDrivers = { drivers: ErrandsNearbyDriver[]; error: string | null };

/** The real road ETA (and distance) from the nearest rider to the pickup. */
interface PickupEta {
  seconds: number | null;
  km: number | null;
}

export const ErrandsPage: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // ── Operator configuration ────────────────────────────────────────────────
  const [config, setConfig] = useState<Awaited<ReturnType<typeof fetchErrandsConfig>>>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // ── Booking form ──────────────────────────────────────────────────────────
  const [service, setService] = useState<ErrandsServiceCategory | null>(null);
  const [pickupText, setPickupText] = useState('');
  const [pickupPoint, setPickupPoint] = useState<LatLng | null>(null);
  const [destText, setDestText] = useState('');
  const [destPoint, setDestPoint] = useState<LatLng | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [pickupGeoError, setPickupGeoError] = useState<string | null>(null);

  // ── Quote ─────────────────────────────────────────────────────────────────
  const [quote, setQuote] = useState<ErrandsQuote | null>(null);
  const [quoteInput, setQuoteInput] = useState<ErrandsQuoteInput | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [priceNotice, setPriceNotice] = useState<string | null>(null);
  const [quoteNow, setQuoteNow] = useState(() => Date.now());

  // ── Driver discovery (one pass covers every enabled service) ─────────────
  const [driversByCategory, setDriversByCategory] = useState<
    Partial<Record<ErrandsServiceCategory, CategoryDrivers>>
  >({});
  const [driversLoading, setDriversLoading] = useState(false);
  const [discoveryNonce, setDiscoveryNonce] = useState(0);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  /** Real road ETA from the (selected or nearest) rider to the pickup point. */
  const [driverToPickupSeconds, setDriverToPickupSeconds] = useState<number | null>(null);
  /** Real road ETA per service, from each category's nearest eligible rider. */
  const [pickupEtas, setPickupEtas] = useState<
    Partial<Record<ErrandsServiceCategory, PickupEta>>
  >({});

  // ── Ride-selection screen chrome ──────────────────────────────────────────
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<'pickup' | 'destination' | null>(null);
  /** Error raised inside the address editor (unresolvable typed address). */
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [stopNoticeOpen, setStopNoticeOpen] = useState(false);
  const [scheduleNoticeOpen, setScheduleNoticeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ErrandsPaymentMethodId>(
    DEFAULT_ERRANDS_PAYMENT_METHOD
  );
  const [driverHint, setDriverHint] = useState(false);
  /** The customer's own fix, asked for once and refreshed by the recenter. */
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);

  const driversSectionRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  /**
   * While the map is fullscreen it renders as a fixed overlay, but it still
   * lives inside this sticky wrapper — whose stacking context would otherwise
   * paint it underneath the z-40 navbar. So the wrapper is lifted above the
   * navbar for exactly as long as the map is fullscreen.
   */
  const [mapFullscreen, setMapFullscreen] = useState(false);

  // ── Booking actions ───────────────────────────────────────────────────────
  const [confirming, setConfirming] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // ── Active trip + history ─────────────────────────────────────────────────
  const [activeBooking, setActiveBooking] = useState<ErrandsBooking | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [activeDriverPosition, setActiveDriverPosition] = useState<LatLng | null>(null);
  const [history, setHistory] = useState<ErrandsBooking[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);

  const driverPositionAtRef = useRef(0);

  // ── Automatic pricing ─────────────────────────────────────────────────────
  /**
   * One ticket per pricing pass: a slow reply for an earlier destination must
   * never overwrite the quote for the customer's latest selection.
   */
  const quoteSeqRef = useRef(0);
  /** The trip we already priced (or deliberately gave up on) — stops loops. */
  const pricedKeyRef = useRef<string | null>(null);
  /** Estimates for the non-selected services, tagged with their request. */
  const [estimates, setEstimates] = useState<
    Partial<Record<ErrandsServiceCategory, { input: ErrandsQuoteInput; quote: ErrandsQuote }>>
  >({});

  // ── Config ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void fetchErrandsConfig().then((value) => {
      if (cancelled) return;
      setConfig(value);
      setConfigLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledServices = useMemo(
    () => ERRANDS_SERVICES.filter((s) => isServiceEnabled(config, s)),
    [config]
  );

  /** What discovery answered for the service the customer is looking at. */
  const categoryDrivers: CategoryDrivers = useMemo(
    () => driversByCategory[service ?? 'ERRAND_MOTORCYCLE'] ?? { drivers: [], error: null },
    [driversByCategory, service]
  );
  const drivers = categoryDrivers.drivers;
  const driversError = categoryDrivers.error;

  useEffect(() => {
    if (!config) return;
    if (service && isServiceEnabled(config, service)) return;
    const first = ERRANDS_SERVICES.find((s) => isServiceEnabled(config, s)) ?? null;
    setService(first);
    setQuote(null);
    setQuoteInput(null);
    setQuoteError(null);
    setSelectedDriverId(null);
  }, [config]);

  const moduleDisabled = Boolean(config && (!config.enabled || enabledServices.length === 0));
  const formDisabled = !config || moduleDisabled || service === null;

  // ── Bookings (initial load + refresh after actions) ───────────────────────

  const loadBookings = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) {
      setBookingsLoaded(true);
      return;
    }
    const rows = await fetchMyErrandsBookings(10);
    const active =
      rows.find((booking) => ACTIVE_ERRANDS_STATUSES.includes(booking.status)) ?? null;
    if (active) {
      setActiveBooking(active);
      setActiveBookingId(active.id);
    }
    setHistory(
      rows.filter(
        (booking) => booking.id !== active?.id && !ACTIVE_ERRANDS_STATUSES.includes(booking.status)
      )
    );
    setBookingsLoaded(true);
  }, [userId]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  // ── Quote helpers ─────────────────────────────────────────────────────────

  const clearQuote = useCallback(() => {
    setQuote(null);
    setQuoteInput(null);
    setQuoteError(null);
    setPriceNotice(null);
    // Driver markers are keyed to the PICKUP point and polled on their own —
    // re-picking the destination must not blank a list that is still correct.
    // Forget the trip entirely: re-picking the same addresses must price again
    // rather than find a "priced" marker left behind.
    pricedKeyRef.current = null;
    setEstimates({});
    setSelectedDriverId(null);
    setDriverHint(false);
    setBookingError(null);
  }, []);

  /** A typed address is only turned into coordinates when the customer asks. */
  const resolveEndpoint = useCallback(
    async (text: string, point: LatLng | null): Promise<{ point: LatLng; address: string } | null> => {
      const address = text.trim();
      if (point && isValidDeliveryPoint(point.lat, point.lng)) return { point, address };
      if (!address) return null;
      const resolved = await geocodeAddress(address);
      return resolved && isValidDeliveryPoint(resolved.lat, resolved.lng)
        ? { point: resolved, address }
        : null;
    },
    []
  );

  // The 1s ticker runs while a quote (or a waiting request) is on screen: it
  // drives the "price held for…" countdown, the honest "expired" copy, and the
  // drop-off callout's arrival time (now + the server's trip duration).
  useEffect(() => {
    const needsClock = Boolean(quote) || Boolean(activeBooking?.estimatedDurationSeconds);
    if (!needsClock) return;
    const ticker = window.setInterval(() => setQuoteNow(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, [quote, activeBooking?.estimatedDurationSeconds]);

  const quoteSecondsLeft = useMemo(
    () => secondsUntilQuoteExpiry(quote, quoteNow),
    [quote, quoteNow]
  );
  const quoteExpired = quote ? !isQuoteUsable(quote, quoteNow) : true;

  /**
   * The lines the customer is actually charged for. Optional components
   * (booking fee, time, waiting, peak pricing, discount) only appear when
   * they are enabled AND non-zero — nothing is ever shown as a fee that
   * did not apply to this trip.
   */
  const fareRows: { label: string; amount: number }[] = [];
  if (quote) {
    if (quote.baseFare > 0) fareRows.push({ label: 'Base fare', amount: quote.baseFare });
    if (quote.distanceCharge > 0) {
      fareRows.push({
        label: `Distance · ${quote.distanceKm.toFixed(2)} km × ${formatGHS(quote.perKmRate)}`,
        amount: quote.distanceCharge,
      });
    }
    if (quote.timeCharge > 0) fareRows.push({ label: 'Time charge', amount: quote.timeCharge });
    if (quote.waitingCharge > 0)
      fareRows.push({ label: 'Waiting charge', amount: quote.waitingCharge });
    if (quote.bookingFee > 0) fareRows.push({ label: 'Booking fee', amount: quote.bookingFee });
    if (quote.surgeAmount !== 0) {
      fareRows.push({
        label: `Peak pricing ×${quote.surgeMultiplier}`,
        amount: quote.surgeAmount,
      });
    }
    if (quote.discountAmount > 0)
      fareRows.push({ label: 'Discount', amount: -quote.discountAmount });
    if (quote.taxAmount > 0) fareRows.push({ label: 'Tax', amount: quote.taxAmount });
  }

  /**
   * Price every enabled service for one trip in a single pass.
   *
   * The selected category lands in `quote` (the number the customer can act
   * on); the rest become estimates so the service options can show real
   * prices side by side. Nothing is written to the screen by a reply that a
   * newer request has already superseded, and a failure never retries itself
   * — the customer decides that with "Update fare".
   */
  const priceServices = useCallback(
    async (
      selected: ErrandsQuoteInput,
      categories: ErrandsServiceCategory[]
    ) => {
      if (categories.length === 0) return;

      const seq = ++quoteSeqRef.current;
      setQuoteLoading(true);
      setQuoteError(null);

      const results = await Promise.all(
        categories.map(async (category) => {
          const input: ErrandsQuoteInput = { ...selected, serviceCategory: category };
          return { category, input, result: await requestErrandsQuote(input) };
        })
      );

      if (seq !== quoteSeqRef.current) return; // superseded — drop it
      setQuoteLoading(false);

      const previousInput = quoteInput;
      const inputChanged = !previousInput || !sameQuoteInput(previousInput, selected);

      // Estimates for the services the customer is NOT looking at.
      setEstimates((current) => {
        const next = { ...current };
        for (const entry of results) {
          if (entry.category === selected.serviceCategory) continue;
          if (entry.result.ok) {
            next[entry.category] = { input: entry.input, quote: entry.result.quote };
          } else {
            delete next[entry.category];
          }
        }
        return next;
      });

      const chosen = results.find((entry) => entry.category === selected.serviceCategory);
      if (!chosen) return;

      if (!chosen.result.ok) {
        setQuoteError(chosen.result.error);
        return;
      }

      const nextQuote = chosen.result.quote;

      if (!inputChanged && quote && nextQuote.quoteId !== quote.quoteId) {
        setPriceNotice(
          `Your price was updated to ${formatGHS(nextQuote.estimatedFare)} — the previous estimate had expired.`
        );
      } else if (inputChanged) {
        setPriceNotice(null);
      }

      setQuote(nextQuote);
      setQuoteInput(selected);
      if (inputChanged) {
        setSelectedDriverId(null);
        setDriverHint(false);
      }
      setBookingError(null);
    },
    [quote, quoteInput]
  );

  /** The trip currently described by the form, or `null` when incomplete. */
  const formTrip = useMemo(() => {
    if (!service || !pickupPoint || !destPoint) return null;
    if (!isValidDeliveryPoint(pickupPoint.lat, pickupPoint.lng)) return null;
    if (!isValidDeliveryPoint(destPoint.lat, destPoint.lng)) return null;
    return {
      pickup: { point: pickupPoint, address: pickupText.trim() },
      destination: { point: destPoint, address: destText.trim() },
    };
  }, [service, pickupPoint, destPoint, pickupText, destText]);

  /**
   * Switching service tab must not cost a routing call: every enabled
   * category was priced in the same pass, so adopt the cached number.
   * Runs before the pricing effect below and marks the trip as priced.
   */
  useEffect(() => {
    if (!service || !formTrip) return;
    const desired: ErrandsQuoteInput = { ...formTrip, serviceCategory: service };
    if (quoteInput && quote && sameQuoteInput(quoteInput, desired)) {
      pricedKeyRef.current = quoteKey(desired);
      return;
    }
    const cached = estimates[service];
    if (cached && sameQuoteInput(cached.input, desired)) {
      pricedKeyRef.current = quoteKey(desired);
      setQuote(cached.quote);
      setQuoteInput(cached.input);
      setPriceNotice(null);
      setSelectedDriverId(null);
      setDriverHint(false);
      setQuoteError(null);
      return;
    }
    // No price known for THIS service on this trip: never show another
    // service's fare — clear it and let the pricing effect fetch this one.
    if (quoteInput && quoteInput.serviceCategory !== service) {
      setQuote(null);
      setQuoteInput(null);
      setQuoteError(null);
      setPriceNotice(null);
      setSelectedDriverId(null);
      setDriverHint(false);
    }
  }, [service, formTrip, quote, quoteInput, estimates]);

  /** The price shown for one service tab (or `null` when not priced). */
  const estimateFor = (option: ErrandsServiceCategory): ErrandsQuote | null => {
    if (!formTrip) return null;
    const wanted: ErrandsQuoteInput = { ...formTrip, serviceCategory: option };
    if (option === service) {
      return quote && quoteInput && sameQuoteInput(quoteInput, wanted) ? quote : null;
    }
    const cached = estimates[option];
    return cached && sameQuoteInput(cached.input, wanted) ? cached.quote : null;
  };

  /**
   * The fare appears as soon as BOTH endpoints are real coordinates: the
   * customer never has to press a button to find out what a trip costs.
   *
   * The pass is debounced so a burst of GPS/typing settles into one routing
   * burst, and `pricedKeyRef` makes sure the same trip is not priced twice.
   */
  useEffect(() => {
    if (!formTrip || moduleDisabled || activeBooking || !config) return;
    if (!isServiceEnabled(config, service as ErrandsServiceCategory)) return;

    const selectedInput: ErrandsQuoteInput = { ...formTrip, serviceCategory: service! };
    const key = quoteKey(selectedInput);
    if (pricedKeyRef.current === key) return; // already priced this trip

    const timer = window.setTimeout(() => {
      if (pricedKeyRef.current === key) return;
      pricedKeyRef.current = key;
      void priceServices(selectedInput, enabledServices);
    }, AUTO_QUOTE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formTrip,
    moduleDisabled,
    activeBooking,
    config,
    service,
    enabledServices,
    priceServices,
  ]);

  /**
   * Manual price (also the path for a typed address that has not been picked
   * from the drop-down yet): resolve both addresses, then price them.
   */
  const handleGetFare = useCallback(async () => {
    if (!service) return;

    const [pickup, destination] = await Promise.all([
      resolveEndpoint(pickupText, pickupPoint),
      resolveEndpoint(destText, destPoint),
    ]);

    if (!pickup || !destination) {
      setQuoteError('We could not find that address — pick a suggestion from the list.');
      return;
    }

    const selected: ErrandsQuoteInput = { serviceCategory: service, pickup, destination };
    pricedKeyRef.current = quoteKey(selected);
    await priceServices(selected, enabledServices);
  }, [
    service,
    pickupText,
    pickupPoint,
    destText,
    destPoint,
    resolveEndpoint,
    priceServices,
    enabledServices,
  ]);

  // ── Driver discovery (polled: the couriers table is not subscribable) ─────

  /**
   * ONE pass covers every enabled service, so tapping between options never
   * costs a round trip and each row can show its own nearest-rider estimate.
   * Everything returned is real: approved, online, eligible, in radius and
   * freshly located drivers — an empty answer stays empty.
   */
  useEffect(() => {
    if (!pickupPoint || moduleDisabled || activeBooking || enabledServices.length === 0) return;
    let cancelled = false;

    const load = async (initial: boolean) => {
      if (initial) setDriversLoading(true);
      const answers = await Promise.all(
        enabledServices.map(async (category) => ({
          category,
          result: await fetchNearbyErrandsDrivers({
            pickup: pickupPoint,
            serviceCategory: category,
          }),
        }))
      );
      if (cancelled) return;
      setDriversLoading(false);
      setDriversByCategory(() => {
        const next: Partial<Record<ErrandsServiceCategory, CategoryDrivers>> = {};
        for (const { category, result } of answers) {
          next[category] = result.ok
            ? { drivers: result.drivers, error: null }
            : { drivers: [], error: result.error };
        }
        return next;
      });
    };

    void load(true);
    const poll = window.setInterval(() => {
      if (!document.hidden) void load(false);
    }, ERRANDS_DISCOVERY_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pickupPoint?.lat,
    pickupPoint?.lng,
    moduleDisabled,
    activeBooking,
    enabledServices,
    discoveryNonce,
  ]);

  // ── Derived view data (declared here: the ETA effects below depend on it) ─

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.driverId === selectedDriverId) ?? null,
    [drivers, selectedDriverId]
  );

  const activePickup = activeBooking?.details
    ? asPoint(activeBooking.details.pickupLatitude, activeBooking.details.pickupLongitude)
    : null;
  const activeDestination = activeBooking?.details
    ? asPoint(activeBooking.details.destinationLatitude, activeBooking.details.destinationLongitude)
    : null;

  const activeTripPin: ErrandsNearbyDriver[] = useMemo(() => {
    if (!activeBooking || !activeDriverPosition) return [];
    // Only fields the database handed us — everything unknown stays null.
    return [
      {
        driverId: activeBooking.driverId,
        fullName: activeBooking.details?.driverName ?? null,
        avatarUrl: activeBooking.details?.driverAvatarUrl ?? null,
        vehicleType: activeBooking.details?.driverVehicleType ?? null,
        vehicleCategory:
          activeBooking.serviceCategory === 'ERRAND_MOTORCYCLE' ? 'MOTORCYCLE' : 'CAR',
        rating: null,
        totalDeliveries: null,
        latitude: activeDriverPosition.lat,
        longitude: activeDriverPosition.lng,
        locationUpdatedAt: null,
        locationAgeSeconds: null,
        distanceKm: null,
        isVerified: false,
      },
    ];
  }, [activeBooking, activeDriverPosition]);

  /** Where the pickup callout measures to (the live trip's real pickup). */
  const mapPickup = activeBooking ? activePickup : pickupPoint;

  /** Which driver the pickup callout measures FROM (booked → chosen → none). */
  const focusDriverPoint: LatLng | null = activeBooking
    ? activeDriverPosition
    : selectedDriver
      ? driverPoint(selectedDriver)
      : null;

  // ── Pickup estimates — real road routes, or an honest fallback ────────────

  /**
   * Each service's nearest eligible rider, routed to the pickup point. One
   * call per category; `fetchRoadRoute` caches, so a poll that sees no
   * movement costs nothing. When routing cannot answer, the entry is simply
   * missing — the row then falls back to distance, never to a made-up ETA.
   */
  useEffect(() => {
    if (!pickupPoint || moduleDisabled) {
      setPickupEtas({});
      return;
    }

    const targets = enabledServices.map((category) => ({
      category,
      from:
        (driversByCategory[category]?.drivers ?? [])
          .map(driverPoint)
          .find((point): point is LatLng => point !== null) ?? null,
    }));
    if (targets.every((target) => target.from === null)) {
      setPickupEtas({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const next: Partial<Record<ErrandsServiceCategory, PickupEta>> = {};
      await Promise.all(
        targets.map(async ({ category, from }) => {
          if (!from) return;
          const route = await fetchRoadRoute(from, pickupPoint);
          if (cancelled || !route) return;
          next[category] = {
            seconds: Number.isFinite(route.durationSeconds) ? route.durationSeconds : null,
            km: route.distanceMeters / 1000,
          };
        })
      );
      if (cancelled) return;
      setPickupEtas(next);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupPoint?.lat, pickupPoint?.lng, driversByCategory, enabledServices, moduleDisabled]);

  /**
   * The driver-to-pickup ETA behind the green callout: the booked driver's
   * live GPS while a trip runs, otherwise the driver the customer picked.
   * `null` (no driver, or no route) renders the callout WITHOUT a time.
   */
  useEffect(() => {
    if (!mapPickup || !focusDriverPoint) {
      setDriverToPickupSeconds(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const route = await fetchRoadRoute(focusDriverPoint, mapPickup);
      if (cancelled) return;
      setDriverToPickupSeconds(
        route && Number.isFinite(route.durationSeconds) ? route.durationSeconds : null
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapPickup?.lat,
    mapPickup?.lng,
    focusDriverPoint?.lat,
    focusDriverPoint?.lng,
  ]);

  // ── Device location for the pickup point ──────────────────────────────────

  const handleUseMyLocation = useCallback(async () => {
    if (!isGeolocationAvailable()) {
      setPickupGeoError(
        'Location is unavailable here. Open the app over https (or allow location access), or pick a suggestion above.'
      );
      return;
    }
    setIsLocating(true);
    setPickupGeoError(null);
    try {
      const fix = await getCurrentPositionSafe();
      const point: LatLng = { lat: fix.lat, lng: fix.lng };
      const label = await reverseGeocodeAddress(point);
      setPickupPoint(point);
      setPickupText(label ?? 'My current location');
      clearQuote();
    } catch (error) {
      setPickupGeoError(describeGeoError(error));
    } finally {
      setIsLocating(false);
    }
  }, [clearQuote]);

  /**
   * The customer's own position for the map's recenter control. Asked for
   * once on entry and again whenever they tap recenter — a denied permission
   * simply leaves `userLocation` null, which the map treats as "no fix", never
   * as a position to invent.
   */
  const refreshUserLocation = useCallback(async () => {
    if (!isGeolocationAvailable()) return;
    try {
      const fix = await getCurrentPositionSafe();
      setUserLocation({ lat: fix.lat, lng: fix.lng });
    } catch {
      /* no fix: the map keeps its last known camera and the dot stays hidden */
    }
  }, []);

  useEffect(() => {
    void refreshUserLocation();
  }, [refreshUserLocation]);

  /**
   * The location bar's close button: it LEAVES the screen. It never touches a
   * booking, a quote or a status — cancelling lives on the trip card, behind
   * its own confirmation.
   */
  const handleClose = useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate('/');
  }, [navigate]);

  /** Tapping a suggestion writes it through and closes the editor. */
  const handleEndpointPicked = useCallback(() => setEditingEndpoint(null), []);

  /**
   * "Done" on the address editor. A bare typed address with no coordinates is
   * geocoded here so pricing can start; if it cannot be resolved the editor
   * stays open with an honest error rather than silently pricing nothing.
   */
  const handleEndpointDone = useCallback(async () => {
    const field = editingEndpoint;
    if (!field) return;
    const text = (field === 'pickup' ? pickupText : destText).trim();
    const point = field === 'pickup' ? pickupPoint : destPoint;
    if (point || !text) {
      setEditingEndpoint(null);
      return;
    }
    const resolved = await geocodeAddress(text);
    if (!resolved) {
      setEndpointError('We could not find that place — choose a suggestion from the list.');
      return;
    }
    if (field === 'pickup') {
      setPickupPoint(resolved);
      clearQuote();
    } else {
      setDestPoint(resolved);
      clearQuote();
    }
    setEndpointError(null);
    setEditingEndpoint(null);
  }, [
    editingEndpoint,
    pickupText,
    destText,
    pickupPoint,
    destPoint,
    clearQuote,
  ]);

  /** Any tap outside the two anchored notices closes them. */
  useEffect(() => {
    if (!stopNoticeOpen && !scheduleNoticeOpen) return;
    const close = () => {
      setStopNoticeOpen(false);
      setScheduleNoticeOpen(false);
    };
    // `pointerdown` (not `click`) so scrolling the sheet dismisses them too.
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [stopNoticeOpen, scheduleNoticeOpen]);

  // ── Confirm booking ───────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (!quote || !quoteInput || !selectedDriverId) return;
    setConfirming(true);
    setBookingError(null);

    const previousQuoteId = quote.quoteId;
    const ensured = await ensureFreshErrandsQuote(quote, quoteInput);
    if (!ensured.ok) {
      setConfirming(false);
      setBookingError(ensured.error);
      return;
    }
    if (ensured.quote.quoteId !== previousQuoteId) {
      setQuote(ensured.quote); // the price was refreshed — say so below
      setPriceNotice(
        `Your price was updated to ${formatGHS(ensured.quote.estimatedFare)} before booking — the previous estimate had expired.`
      );
    }

    const result = await createErrandsBooking({
      quoteId: ensured.quote.quoteId,
      driverId: selectedDriverId,
      paymentMethod,
    });
    setConfirming(false);

    if (!result.ok) {
      setBookingError(result.error);
      // A lost race for the driver invalidates the on-screen list too.
      if (/unavailable/i.test(result.error)) setDiscoveryNonce((value) => value + 1);
      return;
    }

    setActiveBooking(result.booking);
    setActiveBookingId(result.booking.id);
    setSelectedDriverId(null);
    setQuote(null);
    setQuoteInput(null);
    setPriceNotice(null);
    setCancelOpen(false);
    setCancelNote('');
    void loadBookings();
  }, [quote, quoteInput, selectedDriverId, paymentMethod, loadBookings]);

  /**
   * The footer's `Select …` button. With no driver chosen it opens and scrolls
   * to the driver list; with one chosen it books through the secure RPC.
   */
  const handlePrimary = useCallback(async () => {
    if (!service) return;
    if (selectedDriverId) {
      await handleConfirm();
      return;
    }
    setSheetExpanded(true);
    if (!quote) {
      // Nothing bookable yet: make the pricing pass run (or retry it) instead
      // of scrolling a list that does not exist.
      await handleGetFare();
      return;
    }
    setDriverHint(true);
    // The list lives in the sheet's own scroller — scroll it into view there.
    window.requestAnimationFrame(() =>
      driversSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
  }, [service, selectedDriverId, handleConfirm, quote, handleGetFare]);

  // ── Cancel ────────────────────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    if (!activeBooking) return;
    setCancelling(true);
    setCancelError(null);
    const result = await setErrandsBookingStatus({
      bookingId: activeBooking.id,
      status: 'CANCELLED',
      note: cancelNote.trim() || null,
    });
    setCancelling(false);
    if (!result.ok) {
      setCancelError(result.error);
      return;
    }
    setActiveBooking(result.booking);
    setCancelOpen(false);
    setCancelNote('');
    void loadBookings();
  }, [activeBooking, cancelNote, loadBookings]);

  // ── Active trip: realtime + polling safety net ────────────────────────────

  useEffect(() => {
    const bookingId = activeBookingId;
    if (!userId || !bookingId || !isSupabaseConfigured) return;
    let disposed = false;

    const reload = async () => {
      if (disposed) return;
      let booking = await fetchErrandsBooking(bookingId);
      if (disposed || !booking) return;
      // A REQUESTED trip whose response window passed expires for real —
      // the database releases the driver, and the card says so honestly.
      if (
        booking.status === 'REQUESTED' &&
        Number.isFinite(Date.parse(booking.requestedExpiresAt)) &&
        Date.parse(booking.requestedExpiresAt) <= Date.now()
      ) {
        await expireStaleErrandsBookings();
        if (disposed) return;
        booking = (await fetchErrandsBooking(bookingId)) ?? booking;
      }
      setActiveBooking(booking);
    };

    const channel = supabase
      .channel(`errands-bookings-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'errands_bookings',
          filter: `customer_id=eq.${userId}`,
        },
        () => {
          void reload();
        }
      )
      .subscribe();

    // Realtime is the fast path; the poll keeps the card honest when the
    // socket drops (network switch, backgrounded tab).
    const poll = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 12_000);

    return () => {
      disposed = true;
      supabase.removeChannel(channel);
      window.clearInterval(poll);
    };
  }, [userId, activeBookingId]);

  // ── Live driver GPS (only readable once the driver is committed) ──────────

  useEffect(() => {
    const driverId = activeBooking?.driverId ?? null;
    const status = activeBooking?.status ?? null;
    const live =
      !!driverId &&
      !!status &&
      (LIVE_DRIVER_POSITION_STATUSES as readonly string[]).includes(status);

    if (!live || !driverId || !isSupabaseConfigured) {
      setActiveDriverPosition(null);
      return;
    }

    let disposed = false;
    driverPositionAtRef.current = 0;

    const applyRow = (row: {
      current_latitude?: number | null;
      current_longitude?: number | null;
      current_location_updated_at?: string | null;
    }) => {
      const point = asPoint(row.current_latitude, row.current_longitude);
      if (!point) return;
      const nextTime = row.current_location_updated_at
        ? Date.parse(row.current_location_updated_at)
        : 0;
      // Never move the pin backwards: a replayed/late row must not win.
      if (nextTime && driverPositionAtRef.current && nextTime < driverPositionAtRef.current) return;
      if (nextTime) driverPositionAtRef.current = nextTime;
      setActiveDriverPosition(point);
    };

    const channel = supabase
      .channel(`errands-driver-position-${driverId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'couriers', filter: `id=eq.${driverId}` },
        (payload) => applyRow(payload.new as Parameters<typeof applyRow>[0])
      )
      .subscribe();

    const refreshPosition = async () => {
      if (disposed || document.hidden) return;
      const { data } = await supabase
        .from('couriers')
        .select('current_latitude, current_longitude, current_location_updated_at')
        .eq('id', driverId)
        .maybeSingle();
      if (!disposed && data) applyRow(data as Parameters<typeof applyRow>[0]);
    };

    // First fix straight away, then a 12 s safety net behind the channel.
    void refreshPosition();
    const poll = window.setInterval(() => void refreshPosition(), 12_000);

    return () => {
      disposed = true;
      supabase.removeChannel(channel);
      window.clearInterval(poll);
      setActiveDriverPosition(null);
    };
  }, [activeBooking?.driverId, activeBooking?.status]);

  // ── Reset to the form ─────────────────────────────────────────────────────

  const handleBookAnother = useCallback(() => {
    setActiveBooking(null);
    setActiveBookingId(null);
    setActiveDriverPosition(null);
    setCancelOpen(false);
    setCancelNote('');
    setCancelError(null);
    clearQuote();
    void loadBookings();
  }, [clearQuote, loadBookings]);

  // ── Derived view data ─────────────────────────────────────────────────────

  const showTripPin =
    activeBooking?.serviceCategory === 'RIDE_CAR' &&
    !!activeBooking.tripPin &&
    (PIN_VISIBLE_STATUSES as readonly string[]).includes(activeBooking.status);

  const canCancel = activeBooking
    ? canTransition(activeBooking.status, 'CANCELLED', 'CUSTOMER')
    : false;

  const rideCarNoteVisible =
    !!config?.enabled && service !== null && !isServiceEnabled(config, 'RIDE_CAR');

  // ── Ride-selection view data ──────────────────────────────────────────────

  /**
   * Whether an option can be priced right now — used to decide which rows are
   * genuinely comparable before any "lowest fare"/"fastest" chip is allowed.
   */
  const pricedFor = (option: ErrandsServiceCategory): ErrandsQuote | null => {
    if (!formTrip) return null;
    const wanted: ErrandsQuoteInput = { ...formTrip, serviceCategory: option };
    if (quote && quoteInput && sameQuoteInput(quoteInput, wanted)) return quote;
    const cached = estimates[option];
    return cached && sameQuoteInput(cached.input, wanted) ? cached.quote : null;
  };

  const comparableFares = enabledServices
    .map((option) => ({ option, quote: pricedFor(option) }))
    .filter((entry): entry is { option: ErrandsServiceCategory; quote: ErrandsQuote } =>
      Boolean(entry.quote)
    );
  const comparableEtas = enabledServices
    .map((option) => ({ option, eta: pickupEtas[option] }))
    .filter((entry) => entry.eta?.seconds != null);

  /** Only shown when at least two options can be honestly compared. */
  const lowestFareOption: ErrandsServiceCategory | null =
    comparableFares.length >= 2
      ? comparableFares.reduce((best, entry) =>
          entry.quote.estimatedFare < best.quote.estimatedFare ? entry : best
        ).option
      : null;
  const fastestPickupOption: ErrandsServiceCategory | null =
    comparableEtas.length >= 2
      ? comparableEtas.reduce((best, entry) =>
          (entry.eta?.seconds ?? Infinity) < (best.eta?.seconds ?? Infinity) ? entry : best
        ).option
      : null;

  const badgeFor = (option: ErrandsServiceCategory): string | null => {
    if (option === lowestFareOption) return 'LOWEST FARE';
    if (option === fastestPickupOption) return 'FASTEST';
    return null;
  };

  /** The second line of a service row — real ETA, real distance, or honest. */
  const pickupEtaLine = (option: ErrandsServiceCategory): string => {
    const eta = pickupEtas[option];
    const formatted = formatPickupEta(eta?.seconds);
    if (formatted) return `${formatted} pickup`;
    if (eta?.km != null) return `${formatDistanceKm(eta.km)} away`;
    if (!service || option !== service) return '';
    if (driversLoading) return 'Checking riders…';
    return 'No riders nearby';
  };

  // Callouts — a value only when it can be measured, label alone otherwise.
  const pickupCalloutValue = formatPickupEta(driverToPickupSeconds);
  const destinationCalloutValue = formatArrivalClock(
    activeBooking ? activeBooking.estimatedDurationSeconds : quote?.estimatedDurationSeconds,
    quoteNow
  );

  // Location bar labels: the live trip's endpoints while a booking runs.
  const pickupBarLabel = activeBooking
    ? activeBooking.details?.pickupAddress ?? activeBooking.pickupArea ?? 'Pickup'
    : pickupText.trim() || 'Pickup';
  const destinationBarLabel = activeBooking
    ? activeBooking.details?.destinationAddress ?? activeBooking.destinationArea ?? 'Destination'
    : destText.trim() || 'Destination';

  const selectedPaymentLabel = errandsPaymentLabel(paymentMethod);

  /**
   * The fixed booking footer: payment selector, the large `Select …` action
   * and the schedule control (which says plainly that scheduling is not
   * supported yet rather than pretending to book one). Hidden while a trip is
   * live — the trip card owns its own actions then.
   */
  const sheetFooter = activeBooking ? null : (
    <div className="mx-auto w-full max-w-2xl">
      {bookingError && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-medium leading-snug text-rose-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{bookingError}</span>
        </p>
      )}

      {selectedDriver && quote && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2">
          <Check className="h-3.5 w-3.5 flex-shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">
            {selectedDriver.fullName ?? 'Your driver'} ·{' '}
            {selectedDriver.vehicleType ??
              (selectedDriver.vehicleCategory === 'CAR' ? 'Car' : 'Motorcycle')}
          </span>
          <span className="shrink-0 text-[13px] font-black text-slate-900">
            {formatGHS(quote.estimatedFare)}
            {quoteExpired && (
              <span className="ml-1 text-[9px] font-semibold text-amber-600">refreshing</span>
            )}
          </span>
        </div>
      )}

      {/* Row 1 — payment method (opens the selector) */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setPaymentOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Payment method: ${selectedPaymentLabel}`}
          className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-slate-50 active:scale-[0.99]"
        >
          <Wallet className="h-4 w-4 text-brand-dark" aria-hidden="true" />
          <span className="text-[13px] font-bold text-slate-800">{selectedPaymentLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        </button>
      </div>

      {/* Row 2 — primary action + schedule */}
      <div className="mt-1.5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => void handlePrimary()}
          disabled={formDisabled || confirming || !service}
          className="h-12 min-w-0 flex-1 rounded-full bg-brand px-4 text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(5,150,105,0.32)] transition hover:bg-brand-dark active:scale-[0.98] disabled:opacity-60"
        >
          {confirming ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Booking…
            </span>
          ) : service ? (
            selectRideLabel(service)
          ) : (
            'Select a service'
          )}
        </button>

        <div className="relative flex-shrink-0">
          <button
            type="button"
            aria-disabled="true"
            aria-label="Schedule this ride"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setScheduleNoticeOpen((open) => !open)}
            className="grid h-12 w-12 place-items-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgba(5,150,105,0.32)] transition hover:bg-brand-dark active:scale-95"
          >
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
          </button>

          {scheduleNoticeOpen && (
            <div
              role="status"
              onPointerDown={(event) => event.stopPropagation()}
              className="absolute bottom-full right-0 z-30 mb-2 w-56 rounded-xl bg-slate-900 px-3 py-2.5 text-[11px] font-medium leading-snug text-white shadow-xl"
            >
              <span
                className="absolute -bottom-1.5 right-5 h-3 w-3 rotate-45 bg-slate-900"
                aria-hidden="true"
              />
              Scheduling is not available yet — errand bookings are requested immediately.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="errands-screen relative w-full overflow-hidden bg-canvas">
      {/* ── Map: edge-to-edge across the upper portion of the screen ───── */}
      <div className="absolute inset-x-0 top-0 h-[48%]">
        <ErrandsMap
          pickup={activeBooking ? activePickup : pickupPoint}
          destination={activeBooking ? activeDestination : destPoint}
          drivers={activeBooking ? activeTripPin : drivers}
          selectedDriverId={activeBooking ? activeBooking.driverId : selectedDriverId}
          activeDriverPosition={activeBooking ? activeDriverPosition : null}
          serviceCategory={activeBooking ? activeBooking.serviceCategory : (service ?? 'ERRAND_MOTORCYCLE')}
          pickupCallout={pickupCalloutValue}
          destinationCallout={destinationCalloutValue}
          userLocation={userLocation}
          onRecenter={() => void refreshUserLocation()}
          onFullscreenChange={setMapFullscreen}
          heightClassName="h-full"
        />

        {/* Floating location bar — below the status bar and safe area. */}
        <RideLocationBar
          fixed={mapFullscreen}
          pickupLabel={pickupBarLabel}
          destinationLabel={destinationBarLabel}
          disabled={Boolean(activeBooking)}
          onEditPickup={() => {
            setEndpointError(null);
            setPickupGeoError(null);
            setEditingEndpoint('pickup');
          }}
          onEditDestination={() => {
            setEndpointError(null);
            setEditingEndpoint('destination');
          }}
          onClose={handleClose}
          onAddStop={() => setStopNoticeOpen(true)}
        />

        {stopNoticeOpen && (
          <div
            role="status"
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute inset-x-3 top-[4.5rem] z-30 rounded-xl bg-slate-900 px-3 py-2.5 text-[11px] font-medium leading-snug text-white shadow-xl"
          >
            <span
              className="absolute -top-1.5 right-7 h-3 w-3 rotate-45 bg-slate-900"
              aria-hidden="true"
            />
            Adding a stop is not supported on this route yet — set your destination directly.
          </div>
        )}
      </div>

      {/* ── Bottom sheet: handle, ride list, fixed booking footer ──────── */}
      <RideSheet
        expanded={sheetExpanded}
        onExpandedChange={setSheetExpanded}
        label="Ride options"
        footer={sheetFooter}
      >
        {configLoading && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
            <span>Checking whether Errands is available…</span>
          </div>
        )}

        {moduleDisabled && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium leading-relaxed text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>Errands is currently unavailable.</span>
          </div>
        )}

        {activeBooking ? (
          /* ==================================================================
             ACTIVE TRIP — the booking owns the screen until it ends
             ================================================================== */
          <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  {RIDE_OPTION_LABELS[activeBooking.serviceCategory]} · #{activeBooking.bookingNumber}
                </p>
                <h2 className="mt-1 flex items-center gap-2 text-[15px] font-bold text-slate-900">
                  {ERRANDS_STATUS_LABELS[activeBooking.status]}
                  {!(
                    (['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'] as string[]).includes(
                      activeBooking.status
                    )
                  ) && (
                    <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-brand" aria-hidden="true" />
                  )}
                </h2>
              </div>
              <span className="flex-shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-brand-dark">
                {activeBooking.finalFare != null
                  ? formatGHS(activeBooking.finalFare)
                  : `~ ${formatGHS(activeBooking.estimatedFare)}`}
              </span>
            </div>

            <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-deep" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {activeBooking.details?.pickupAddress ?? activeBooking.pickupArea ?? 'Pickup'}
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Navigation className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-600" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {activeBooking.details?.destinationAddress ?? activeBooking.destinationArea ?? 'Destination'}
                </span>
              </p>
            </div>

            {activeBooking.details?.driverName && (
              <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-slate-100 p-2.5">
                {activeBooking.details.driverAvatarUrl ? (
                  <img
                    src={activeBooking.details.driverAvatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-lg" aria-hidden="true">
                    {activeBooking.serviceCategory === 'RIDE_CAR' ? '🚗' : '🏍️'}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-900">
                    {activeBooking.details.driverName}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {[activeBooking.details.driverVehicleType, activeBooking.details.driverVehiclePlate]
                      .filter(Boolean)
                      .join(' · ') || 'Your driver'}
                  </p>
                </div>
              </div>
            )}

            {activeBooking.paymentMethod && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Wallet className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                <span>Payment:</span>
                <span className="font-bold text-slate-700">
                  {errandsPaymentLabel(activeBooking.paymentMethod)}
                </span>
              </p>
            )}

            {showTripPin && activeBooking.tripPin && (
              <div className="mt-3 rounded-2xl border border-brand/30 bg-emerald-50 p-4 text-center">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-dark">
                  Trip PIN
                </p>
                <p className="mt-1 font-mono text-4xl font-black tracking-[0.3em] text-brand-deep">
                  {activeBooking.tripPin}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                  Share this PIN with your driver to start the ride.
                </p>
              </div>
            )}

            {activeBooking.status === 'REQUESTED' &&
              Number.isFinite(Date.parse(activeBooking.requestedExpiresAt)) && (
                <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {Date.parse(activeBooking.requestedExpiresAt) > quoteNow
                    ? 'Your driver has a short window to respond.'
                    : 'Waiting for the response window to close…'}
                </p>
              )}

            {(activeBooking.status === 'EXPIRED' || activeBooking.status === 'FAILED') && (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                {ERRANDS_STATUS_LABELS[activeBooking.status]}.
                {activeBooking.failureNote ? ` ${activeBooking.failureNote}` : ''}
              </p>
            )}

            {activeBooking.status === 'CANCELLED' && activeBooking.cancellationReason && (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Reason: {activeBooking.cancellationReason}
              </p>
            )}

            {(['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'] as string[]).includes(
              activeBooking.status
            ) ? (
              <div className="mt-4">
                {activeBooking.finalFare != null && (
                  <p className="mb-3 text-center text-xs text-slate-500">
                    Final fare:{' '}
                    <span className="font-bold text-slate-900">
                      {formatGHS(activeBooking.finalFare)}
                    </span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleBookAnother}
                  className="h-12 w-full rounded-xl bg-brand text-xs font-bold text-white transition hover:bg-brand-dark active:scale-[0.99]"
                >
                  Book another errand
                </button>
              </div>
            ) : (
              <div className="mt-4">
                {canCancel && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setCancelOpen((open) => !open);
                        setCancelError(null);
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 transition hover:bg-slate-50 active:scale-[0.99]"
                    >
                      Cancel this trip
                    </button>

                    {cancelOpen && (
                      <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <label
                          htmlFor="errands-cancel-note"
                          className="block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400"
                        >
                          Reason (optional)
                        </label>
                        <textarea
                          id="errands-cancel-note"
                          rows={2}
                          value={cancelNote}
                          onChange={(event) => setCancelNote(event.target.value)}
                          placeholder="Why are you cancelling?"
                          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/50"
                        />
                        {cancelError && (
                          <p className="text-[11px] font-medium leading-relaxed text-rose-600">
                            {cancelError}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCancel()}
                            disabled={cancelling}
                            className="h-11 flex-1 rounded-xl bg-rose-600 text-xs font-bold text-white transition hover:bg-rose-700 active:scale-[0.99] disabled:opacity-60"
                          >
                            {cancelling ? 'Cancelling…' : 'Confirm cancellation'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelOpen(false)}
                            className="h-11 flex-1 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                          >
                            Keep trip
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        ) : (
          /* ==================================================================
             BOOKING FORM — ride list → fare → drivers → confirm
             ================================================================== */
          <>
            <div className="space-y-3">
              {/* Service list — only categories the backend prices AND the
                  operator switched on. Every fare beside a row comes from the
                  server's quote pass: there is no "calculate price" step and
                  nothing on this screen ever makes a price up. */}
              {config?.enabled && enabledServices.length > 0 && (
                <section className="mx-auto max-w-2xl" aria-label="Choose a service">
                  <h2 className="sr-only">Choose a service</h2>
                  <ul>
                    {enabledServices.map((option) => {
                      const estimate = estimateFor(option);
                      const isPricing = Boolean(formTrip) && !estimate && quoteLoading;
                      const badge = badgeFor(option);
                      const Art = RIDE_VEHICLE_ART[option];
                      const isSelected = service === option;
                      const etaLine = pickupEtaLine(option);
                      return (
                        <li key={option}>
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setService(option)}
                            className={`flex w-full items-center gap-3 border-b border-slate-100 px-1 py-2.5 text-left transition active:scale-[0.99] ${
                              isSelected
                                ? 'rounded-xl border-b-slate-100 bg-emerald-50/60 ring-1 ring-brand'
                                : 'rounded-xl hover:bg-slate-50'
                            }`}
                          >
                            <Art
                              className="h-12 w-[76px] flex-shrink-0"
                              title={RIDE_OPTION_LABELS[option]}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13.5px] font-bold leading-tight text-slate-900">
                                  {RIDE_OPTION_LABELS[option]}
                                </span>
                                {badge && (
                                  <span className="flex-shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[8.5px] font-black tracking-[0.06em] text-white">
                                    {badge}
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] leading-snug text-slate-500">
                                {etaLine ? `${etaLine} · ` : ''}
                                {RIDE_OPTION_BLURBS[option]}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              {estimate ? (
                                <>
                                  <span className="block text-[15px] font-black tracking-tight text-slate-900">
                                    {formatGHS(estimate.estimatedFare)}
                                  </span>
                                  <span className="block text-[10px] font-semibold leading-snug text-slate-400">
                                    {estimate.estimatedDurationSeconds
                                      ? `${formatRouteDuration(estimate.estimatedDurationSeconds)} · `
                                      : ''}
                                    {formatDistanceKm(estimate.distanceKm)}
                                  </span>
                                </>
                              ) : isPricing ? (
                                <span className="flex items-center justify-end gap-1 text-[10px] font-semibold text-slate-400">
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                  pricing…
                                </span>
                              ) : (
                                <span className="block text-[11px] font-semibold text-slate-400">
                                  —
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {rideCarNoteVisible && (
                <p className="mx-auto max-w-2xl text-[11px] leading-relaxed text-slate-500">
                  Passenger rides are not available yet.
                </p>
              )}

              {/* Pricing is automatic and debounced: coordinates → real road
                  route → the server's rules → one fare per service. When it
                  cannot answer, the error and its retry live below — this
                  screen never displays a price it did not receive. */}
              {!formTrip && (
                <p className="mx-auto flex max-w-2xl items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                  <span>
                    Choose your pickup and destination — fares update automatically for every
                    service.
                  </span>
                </p>
              )}

              {quoteError && (
                <div className="mx-auto flex max-w-2xl items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium leading-relaxed text-rose-600">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{quoteError}</span>
                  <button
                    type="button"
                    onClick={() => void handleGetFare()}
                    disabled={quoteLoading}
                    className="flex-shrink-0 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                  >
                    {quoteLoading ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              )}

              {priceNotice && (
                <p className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium leading-relaxed text-amber-800">
                  {priceNotice}
                </p>
              )}

              {/* The server's fare — nothing on this page computes money. */}
              {quote && (
                <section
                  className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-4"
                  aria-live="polite"
                >
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        Estimated total
                      </p>
                      <p className="text-2xl font-black tracking-tight text-slate-900">
                        {formatGHS(quote.estimatedFare)}
                      </p>
                    </div>
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-brand-dark">
                      Road route
                    </span>
                  </div>

                  {/* What was measured */}
                  <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-[11px] leading-snug text-slate-600">
                    <p className="flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{quote.pickupAddress}</span>
                    </p>
                    <p className="flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3 w-3 flex-shrink-0 text-rose-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{quote.destinationAddress}</span>
                    </p>
                    <p className="flex items-center gap-1.5 pt-0.5 text-slate-500">
                      <Clock className="h-3 w-3 flex-shrink-0 text-slate-400" aria-hidden="true" />
                      {formatDistanceKm(quote.distanceKm)}
                      {quote.estimatedDurationSeconds
                        ? ` · about ${formatRouteDuration(quote.estimatedDurationSeconds)}`
                        : ''}
                    </p>
                  </div>

                  {/* The breakdown — only the charges that actually apply */}
                  <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
                    {fareRows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3">
                        <dt className="min-w-0 text-slate-500">{row.label}</dt>
                        <dd
                          className={`shrink-0 font-semibold ${
                            row.amount < 0 ? 'text-emerald-600' : 'text-slate-900'
                          }`}
                        >
                          {row.amount < 0 ? `−${formatGHS(Math.abs(row.amount))}` : formatGHS(row.amount)}
                        </dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                      <dt className="font-bold text-slate-900">Total ({quote.currency})</dt>
                      <dd className="font-bold text-slate-900">{formatGHS(quote.estimatedFare)}</dd>
                    </div>
                  </dl>

                  {/* Anything that could still move the price, said out loud */}
                  {quote.variableChargeNote && (
                    <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] font-medium leading-relaxed text-amber-800">
                      {quote.variableChargeNote}
                    </p>
                  )}
                  {quote.routeNote && (
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                      {quote.routeNote}
                    </p>
                  )}

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-slate-400">
                      {quoteSecondsLeft > 30
                        ? `Price held for ${Math.floor(quoteSecondsLeft / 60)}:${String(quoteSecondsLeft % 60).padStart(2, '0')}`
                        : quoteSecondsLeft > 0
                        ? `Price refreshes in ${quoteSecondsLeft}s`
                        : 'This price has expired.'}
                    </p>
                    {quoteSecondsLeft <= 0 && (
                      <button
                        type="button"
                        onClick={() => void handleGetFare()}
                        disabled={quoteLoading}
                        className="flex-shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-brand-dark transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        {quoteLoading ? 'Refreshing…' : 'Refresh price'}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* Drivers — only once a real quote exists */}
              {quote && pickupPoint && (
                <section ref={driversSectionRef} className="mx-auto max-w-2xl">
                  {driverHint && !selectedDriverId && (
                    <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-semibold leading-snug text-brand-dark">
                      {`Choose a driver below, then tap ${selectRideLabel(service ?? 'ERRAND_MOTORCYCLE')} to book.`}
                    </p>
                  )}
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold tracking-tight text-slate-900">
                      Available drivers nearby
                      {!driversLoading && drivers.length > 0 && (
                        <span className="ml-1.5 text-xs font-semibold text-slate-400">
                          ({drivers.length})
                        </span>
                      )}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setDiscoveryNonce((value) => value + 1)}
                      aria-label="Refresh nearby drivers"
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50 active:scale-95"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${driversLoading ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      Refresh
                    </button>
                  </div>

                  {driversError ? (
                    <ErrorState description={driversError} onRetry={() => setDiscoveryNonce((value) => value + 1)} />
                  ) : driversLoading && drivers.length === 0 ? (
                    <div className="space-y-2">
                      {[0, 1].map((index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-card"
                        >
                          <div className="h-11 w-11 flex-shrink-0 animate-pulse rounded-full bg-slate-200/80" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200/80" />
                            <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200/80" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : drivers.length === 0 ? (
                    <EmptyState
                      icon={<Bike className="h-6 w-6" aria-hidden="true" />}
                      title="No drivers are available nearby right now."
                      description="Nobody online matches this route at the moment. Wait a moment and refresh — real drivers appear here the moment they come online."
                      action={
                        <button
                          type="button"
                          onClick={() => setDiscoveryNonce((value) => value + 1)}
                          className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                        >
                          Refresh
                        </button>
                      }
                    />
                  ) : (
                    <ul className="space-y-2">
                      {drivers.map((driver) => {
                        const isSelected = driver.driverId === selectedDriverId;
                        return (
                          <li key={driver.driverId}>
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() =>
                                setSelectedDriverId(isSelected ? null : driver.driverId)
                              }
                              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
                                isSelected
                                  ? 'border-brand bg-emerald-50 ring-1 ring-brand'
                                  : 'border-slate-200 bg-white hover:bg-slate-50'
                              }`}
                            >
                              <DriverAvatar driver={driver} />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate text-[13px] font-bold text-slate-900">
                                    {driver.fullName ?? 'Available driver'}
                                  </span>
                                  {driver.isVerified && (
                                    <BadgeCheck
                                      className="h-3.5 w-3.5 flex-shrink-0 text-brand"
                                      aria-label="Verified driver"
                                    />
                                  )}
                                </span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                                  <span>{driver.vehicleType ?? (driver.vehicleCategory === 'CAR' ? 'Car' : 'Motorcycle')}</span>
                                  {driver.distanceKm != null && (
                                    <span>· {formatDistanceKm(driver.distanceKm)}</span>
                                  )}
                                  <span>·</span>
                                  <RatingStars rating={driver.rating} />
                                </span>
                              </span>
                              {isSelected && (
                                <Check className="h-5 w-5 flex-shrink-0 text-brand" aria-hidden="true" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}

            </div>
          </>
        )}

        {/* Past trips now live in Orders — this page only books and tracks
            the trip in progress. */}
        {history.length > 0 && (
          <section className="mx-auto mt-6 max-w-2xl">
            <Link
              to="/orders"
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-emerald-500/50 hover:shadow-md"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">Your past errands</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {history.length === 1
                    ? '1 past trip'
                    : `${history.length} past trips`}{' '}
                  — kept in your Orders history
                </p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden="true" />
            </Link>
          </section>
        )}
        {bookingsLoaded &&
          history.length === 0 &&
          !activeBooking &&
          !configLoading && (
            <div className="mx-auto mt-4 max-w-2xl">
              <EmptyState
                icon={<Bike className="h-6 w-6" aria-hidden="true" />}
                title="You have not booked any errands yet."
                description="Your errands and rides will appear here once you book your first trip."
              />
            </div>
          )}
      </RideSheet>

      {/* ── Address editor (pickup / destination) ─────────────────────────── */}
      {editingEndpoint && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingEndpoint === 'pickup' ? 'Edit pickup' : 'Edit destination'}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/45"
          onClick={() => {
            setEditingEndpoint(null);
            setEndpointError(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <span
              className="mx-auto mb-3 block h-1 w-10 rounded-full bg-slate-300"
              aria-hidden="true"
            />
            <h2 className="mb-3 text-sm font-bold text-slate-900">
              {editingEndpoint === 'pickup' ? 'Pickup' : 'Destination'}
            </h2>

            {editingEndpoint === 'pickup' ? (
              <AddressSearchField
                label="Pickup"
                value={pickupText}
                placeholder="Where should the driver collect from?"
                disabled={formDisabled}
                onChange={(text) => {
                  setPickupText(text);
                  setPickupPoint(null); // typed text owns no coordinates until picked/geocoded
                  setPickupGeoError(null);
                  setEndpointError(null);
                  clearQuote();
                }}
                onPick={(picked) => {
                  setPickupText(picked.address);
                  setPickupPoint(picked.point);
                  setPickupGeoError(null);
                  setEndpointError(null);
                  clearQuote();
                  handleEndpointPicked();
                }}
              />
            ) : (
              <AddressSearchField
                label="Destination"
                value={destText}
                placeholder="Where is it going?"
                disabled={formDisabled}
                onChange={(text) => {
                  setDestText(text);
                  setDestPoint(null);
                  setEndpointError(null);
                  clearQuote();
                }}
                onPick={(picked) => {
                  setDestText(picked.address);
                  setDestPoint(picked.point);
                  setEndpointError(null);
                  clearQuote();
                  handleEndpointPicked();
                }}
              />
            )}

            {editingEndpoint === 'pickup' && (
              <button
                type="button"
                onClick={() => void handleUseMyLocation()}
                disabled={formDisabled || isLocating}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 text-xs font-bold text-brand-dark transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60"
              >
                {isLocating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{isLocating ? 'Finding your location…' : 'Use my location'}</span>
              </button>
            )}

            {(endpointError || (editingEndpoint === 'pickup' && pickupGeoError)) && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium leading-relaxed text-rose-600">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>{endpointError ?? pickupGeoError}</span>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void handleEndpointDone()}
                disabled={formDisabled}
                className="h-11 flex-1 rounded-xl bg-brand text-xs font-bold text-white transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingEndpoint(null);
                  setEndpointError(null);
                }}
                className="h-11 flex-1 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment method selector (only methods SamleyGo supports) ──────── */}
      {paymentOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Payment method"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/45"
          onClick={() => setPaymentOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl bg-white p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <span
              className="mx-auto mb-3 block h-1 w-10 rounded-full bg-slate-300"
              aria-hidden="true"
            />
            <h2 className="mb-1 text-sm font-bold text-slate-900">Payment method</h2>
            <p className="mb-2 text-[11px] leading-snug text-slate-500">
              Only payment methods SamleyGo already supports are listed.
            </p>

            <ul className="divide-y divide-slate-100">
              {ERRANDS_PAYMENT_METHODS.map((method) => {
                const isActive = method.id === paymentMethod;
                return (
                  <li key={method.id}>
                    <button
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        setPaymentMethod(method.id);
                        setPaymentOpen(false);
                      }}
                      className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-slate-50"
                    >
                      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-emerald-50 text-brand-dark">
                        <Wallet className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-slate-900">
                          {method.label}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {method.hint}
                        </span>
                      </span>
                      {isActive && (
                        <Check className="h-4 w-4 flex-shrink-0 text-brand" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrandsPage;
