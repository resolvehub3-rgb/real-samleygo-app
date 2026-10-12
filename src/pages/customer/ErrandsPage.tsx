import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Bike,
  Car,
  Check,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Star,
} from 'lucide-react';

import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatDistanceKm, formatGHS, isValidDeliveryPoint } from '../../lib/pricing';
import {
  LatLng,
  formatRouteDistance,
  formatRouteDuration,
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
  ERRANDS_SERVICE_BLURBS,
  ERRANDS_SERVICE_LABELS,
  ERRANDS_STATUS_LABELS,
  canTransition,
  type ErrandsBooking,
  type ErrandsNearbyDriver,
  type ErrandsServiceCategory,
} from '../../lib/errands/types';
import { AddressSearchField } from '../../components/errands/AddressSearchField';
import { ErrandsMap } from '../../components/errands/ErrandsMap';
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

/** "3 min ago" style helper for the history list. */
const timeAgo = (iso: string): string => {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const mins = Math.floor((Date.now() - time) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const samePoint = (a: LatLng | null, b: LatLng | null): boolean =>
  (!a && !b) || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

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

  // ── Driver discovery ──────────────────────────────────────────────────────
  const [drivers, setDrivers] = useState<ErrandsNearbyDriver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [discoveryNonce, setDiscoveryNonce] = useState(0);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

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
    setDrivers([]);
    setDriversError(null);
    setSelectedDriverId(null);
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

  // The 1s ticker exists while a quote (or a waiting request) is on screen:
  // it drives the "price held for…" countdown and the honest "expired" copy.
  useEffect(() => {
    if (!quote && activeBooking?.status !== 'REQUESTED') return;
    const ticker = window.setInterval(() => setQuoteNow(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, [quote, activeBooking?.status]);

  const quoteSecondsLeft = useMemo(
    () => secondsUntilQuoteExpiry(quote, quoteNow),
    [quote, quoteNow]
  );
  const quoteExpired = quote ? !isQuoteUsable(quote, quoteNow) : true;

  const handleGetFare = useCallback(async () => {
    if (!service) return;
    setQuoteLoading(true);
    setQuoteError(null);
    setPriceNotice(null);

    const [pickup, destination] = await Promise.all([
      resolveEndpoint(pickupText, pickupPoint),
      resolveEndpoint(destText, destPoint),
    ]);

    if (!pickup || !destination) {
      setQuoteLoading(false);
      setQuoteError('We could not find that address — pick a suggestion from the list.');
      return;
    }

    const input: ErrandsQuoteInput = { serviceCategory: service, pickup, destination };

    // Form untouched since the last quote → go through ensureFresh, which
    // reuses the quote on screen or quietly re-prices one about to expire.
    const unchanged = Boolean(
      quoteInput &&
        quote &&
        quoteInput.serviceCategory === input.serviceCategory &&
        quoteInput.pickup.address === input.pickup.address &&
        quoteInput.destination.address === input.destination.address &&
        samePoint(quoteInput.pickup.point, input.pickup.point) &&
        samePoint(quoteInput.destination.point, input.destination.point)
    );

    const result =
      unchanged && quote ? await ensureFreshErrandsQuote(quote, input) : await requestErrandsQuote(input);

    setQuoteLoading(false);
    if (!result.ok) {
      setQuoteError(result.error);
      return;
    }
    if (unchanged && quote && result.quote.quoteId !== quote.quoteId) {
      setPriceNotice(
        `Your price was updated to ${formatGHS(result.quote.estimatedFare)} — the previous estimate had expired.`
      );
    }
    setQuote(result.quote);
    setQuoteInput(input);
    setSelectedDriverId(null);
    setDrivers([]);
    setDriversError(null);
    setBookingError(null);
  }, [
    service,
    pickupText,
    pickupPoint,
    destText,
    destPoint,
    quote,
    quoteInput,
    resolveEndpoint,
  ]);

  // ── Driver discovery (polled: the couriers table is not subscribable) ─────

  useEffect(() => {
    if (!quote || !service || !pickupPoint || moduleDisabled) return;
    let cancelled = false;

    const load = async (initial: boolean) => {
      if (initial) setDriversLoading(true);
      const result = await fetchNearbyErrandsDrivers({
        pickup: pickupPoint,
        serviceCategory: service,
      });
      if (cancelled) return;
      setDriversLoading(false);
      if (result.ok) {
        setDrivers(result.drivers);
        setDriversError(null);
      } else {
        setDriversError(result.error);
      }
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
    quote?.quoteId,
    service,
    pickupPoint?.lat,
    pickupPoint?.lng,
    moduleDisabled,
    discoveryNonce,
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

  // ── Confirm booking ───────────────────────────────────────────────────────

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.driverId === selectedDriverId) ?? null,
    [drivers, selectedDriverId]
  );

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
  }, [quote, quoteInput, selectedDriverId, loadBookings]);

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

  const activeTripPin: ErrandsNearbyDriver[] = useMemo(() => {
    if (!activeBooking || !activeDriverPosition) return [];
    // Only fields the database handed us — everything unknown stays null.
    return [
      {
        driverId: activeBooking.driverId,
        fullName: activeBooking.details?.driverName ?? null,
        avatarUrl: activeBooking.details?.driverAvatarUrl ?? null,
        vehicleType: activeBooking.details?.driverVehicleType ?? null,
        vehicleCategory: activeBooking.serviceCategory === 'RIDE_CAR' ? 'CAR' : 'MOTORCYCLE',
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

  const activePickup = activeBooking?.details
    ? asPoint(activeBooking.details.pickupLatitude, activeBooking.details.pickupLongitude)
    : null;
  const activeDestination = activeBooking?.details
    ? asPoint(activeBooking.details.destinationLatitude, activeBooking.details.destinationLongitude)
    : null;

  const showTripPin =
    activeBooking?.serviceCategory === 'RIDE_CAR' &&
    !!activeBooking.tripPin &&
    (PIN_VISIBLE_STATUSES as readonly string[]).includes(activeBooking.status);

  const canCancel = activeBooking
    ? canTransition(activeBooking.status, 'CANCELLED', 'CUSTOMER')
    : false;

  const rideCarNoteVisible =
    !!config?.enabled && service !== null && !isServiceEnabled(config, 'RIDE_CAR');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-canvas pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12">
      {/* Sticky map — always visible while the form scrolls underneath */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-bottom))] z-30">
        <ErrandsMap
          pickup={activeBooking ? activePickup : pickupPoint}
          destination={activeBooking ? activeDestination : destPoint}
          drivers={activeBooking ? activeTripPin : drivers}
          selectedDriverId={activeBooking ? activeBooking.driverId : selectedDriverId}
          activeDriverPosition={activeBooking ? activeDriverPosition : null}
          serviceCategory={activeBooking ? activeBooking.serviceCategory : (service ?? 'ERRAND_MOTORCYCLE')}
        />
      </div>

      <main className="mx-auto max-w-2xl px-4 pt-4 sm:px-6">
        <div className="mb-4">
          <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
            Errands &amp; Rides
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Send a parcel across town or catch a ride — pick your route, see the real fare, choose
            your driver.
          </p>
        </div>

        {configLoading && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 text-xs font-medium text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
            <span>Checking whether Errands is available…</span>
          </div>
        )}

        {moduleDisabled && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs font-medium leading-relaxed text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>Errands is currently unavailable.</span>
          </div>
        )}

        {activeBooking ? (
          /* ==================================================================
             ACTIVE TRIP — the booking owns the screen until it ends
             ================================================================== */
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  {ERRANDS_SERVICE_LABELS[activeBooking.serviceCategory]} · #{activeBooking.bookingNumber}
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
             BOOKING FORM — locations → service → fare → driver → confirm
             ================================================================== */
          <>
            <div className="space-y-3">
              {/* Service tabs — only services the operator actually enabled */}
              {config?.enabled && enabledServices.length > 0 && (
                <div className="flex gap-2">
                  {enabledServices.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={service === option}
                      onClick={() => {
                        setService(option);
                        clearQuote();
                      }}
                      className={`flex-1 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
                        service === option
                          ? 'border-brand bg-emerald-50 ring-1 ring-brand'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        {option === 'RIDE_CAR' ? (
                          <Car className="h-4 w-4 text-brand-deep" aria-hidden="true" />
                        ) : (
                          <Bike className="h-4 w-4 text-brand-deep" aria-hidden="true" />
                        )}
                        {ERRANDS_SERVICE_LABELS[option]}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
                        {ERRANDS_SERVICE_BLURBS[option]}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {rideCarNoteVisible && (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Passenger rides are not available yet.
                </p>
              )}

              <AddressSearchField
                label="Pickup"
                value={pickupText}
                placeholder="Where should the driver collect from?"
                disabled={formDisabled}
                onChange={(text) => {
                  setPickupText(text);
                  setPickupPoint(null); // typed text owns no coordinates until picked/geocoded
                  setPickupGeoError(null);
                  clearQuote();
                }}
                onPick={(picked) => {
                  setPickupText(picked.address);
                  setPickupPoint(picked.point);
                  setPickupGeoError(null);
                  clearQuote();
                }}
              />

              <button
                type="button"
                onClick={() => void handleUseMyLocation()}
                disabled={formDisabled || isLocating}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 text-xs font-bold text-brand-dark transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60"
              >
                {isLocating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{isLocating ? 'Finding your location…' : 'Use my location'}</span>
              </button>

              {pickupGeoError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium leading-relaxed text-rose-600">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span>{pickupGeoError}</span>
                </div>
              )}

              <AddressSearchField
                label="Destination"
                value={destText}
                placeholder="Where is it going?"
                disabled={formDisabled}
                onChange={(text) => {
                  setDestText(text);
                  setDestPoint(null);
                  clearQuote();
                }}
                onPick={(picked) => {
                  setDestText(picked.address);
                  setDestPoint(picked.point);
                  clearQuote();
                }}
              />

              <button
                type="button"
                onClick={() => void handleGetFare()}
                disabled={formDisabled || quoteLoading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-xs font-bold text-white transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
              >
                {quoteLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{quoteLoading ? 'Calculating the fare…' : quote ? 'Update fare' : 'Get fare'}</span>
              </button>

              {quoteError && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium leading-relaxed text-rose-600">
                  {quoteError}
                </p>
              )}

              {priceNotice && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium leading-relaxed text-amber-800">
                  {priceNotice}
                </p>
              )}

              {/* The server's fare — nothing on this page computes money. */}
              {quote && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        Estimated total
                      </p>
                      <p className="text-2xl font-black tracking-tight text-slate-900">
                        {formatGHS(quote.estimatedFare)}
                      </p>
                    </div>
                    <span
                      className={`rounded-lg px-2 py-1 text-[10px] font-bold ${
                        quote.distanceSource === 'ROAD_ROUTE'
                          ? 'bg-emerald-50 text-brand-dark'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {quote.distanceSource === 'ROAD_ROUTE' ? 'Road route' : 'Straight line'}
                    </span>
                  </div>

                  <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Trip fare</dt>
                      <dd className="font-semibold text-slate-900">{formatGHS(quote.tripFare)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Booking fee</dt>
                      <dd className="font-semibold text-slate-900">{formatGHS(quote.bookingFee)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Tax</dt>
                      <dd className="font-semibold text-slate-900">{formatGHS(quote.taxAmount)}</dd>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                      <dt className="font-bold text-slate-900">Total</dt>
                      <dd className="font-bold text-slate-900">{formatGHS(quote.estimatedFare)}</dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-[11px] text-slate-500">
                    {formatRouteDistance(quote.distanceKm * 1000)}
                    {quote.estimatedDurationSeconds
                      ? ` · about ${formatRouteDuration(quote.estimatedDurationSeconds)}`
                      : ''}
                  </p>

                  <p className="mt-1 text-[10px] text-slate-400">
                    {quoteSecondsLeft > 30
                      ? `Price held for ${Math.floor(quoteSecondsLeft / 60)}:${String(quoteSecondsLeft % 60).padStart(2, '0')}`
                      : quoteSecondsLeft > 0
                      ? `Price refreshes in ${quoteSecondsLeft}s`
                      : 'This price has expired — tap Update fare to refresh.'}
                  </p>
                </div>
              )}

              {/* Drivers — only once a real quote exists */}
              {quote && pickupPoint && (
                <section>
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

              {/* Confirm bar */}
              {quote && selectedDriver && (
                <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-600">
                        {selectedDriver.fullName ?? 'Selected driver'} ·{' '}
                        {selectedDriver.vehicleType ??
                          (selectedDriver.vehicleCategory === 'CAR' ? 'Car' : 'Motorcycle')}
                      </p>
                      <p className="text-[15px] font-black text-slate-900">
                        {formatGHS(quote.estimatedFare)}
                        {quoteExpired && (
                          <span className="ml-1.5 text-[10px] font-semibold text-amber-600">
                            (refreshing on confirm)
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleConfirm()}
                      disabled={confirming}
                      className="h-12 flex-shrink-0 rounded-xl bg-brand-deep px-5 text-xs font-bold text-white transition hover:bg-brand-dark active:scale-95 disabled:opacity-60"
                    >
                      {confirming ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Booking…
                        </span>
                      ) : (
                        'Confirm request'
                      )}
                    </button>
                  </div>
                  {bookingError && (
                    <p className="mt-2 text-[11px] font-medium leading-relaxed text-rose-600">
                      {bookingError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ------------------------------ History ------------------------------ */}
        {history.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-bold tracking-tight text-slate-900">
              Your past errands
            </h2>
            <ul className="space-y-2">
              {history.map((booking) => (
                <li
                  key={booking.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-card"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-bold text-slate-900">
                      {ERRANDS_STATUS_LABELS[booking.status]}
                    </span>
                    <span className="flex-shrink-0 text-xs font-bold text-slate-900">
                      {formatGHS(booking.finalFare ?? booking.estimatedFare)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {booking.pickupArea ?? 'Pickup'} → {booking.destinationArea ?? 'Destination'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {ERRANDS_SERVICE_LABELS[booking.serviceCategory]} · #{booking.bookingNumber}
                    {timeAgo(booking.createdAt) && ` · ${timeAgo(booking.createdAt)}`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          bookingsLoaded &&
          !activeBooking &&
          !configLoading && (
            <div className="mt-6">
              <EmptyState
                icon={<Bike className="h-6 w-6" aria-hidden="true" />}
                title="You have not booked any errands yet."
                description="Your errands and rides will appear here once you book your first trip."
              />
            </div>
          )
        )}
      </main>
    </div>
  );
};

export default ErrandsPage;
