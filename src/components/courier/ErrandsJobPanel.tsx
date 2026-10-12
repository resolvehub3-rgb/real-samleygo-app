import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bike,
  Car,
  Check,
  Clock,
  MapPin,
  Navigation,
  Package,
  Phone,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { formatDistanceKm, formatGHS } from '../../lib/pricing';
import type { LatLng } from '../../lib/routing';
import {
  expireStaleErrandsBookings,
  fetchDriverErrandsBookings,
  fetchErrandsBooking,
  setErrandsBookingStatus,
} from '../../lib/errands/booking';
import {
  fetchMyErrandsCapability,
  setErrandsAvailability,
} from '../../lib/errands/availability';
import {
  ACTIVE_ERRANDS_STATUSES,
  ERRANDS_SERVICE_LABELS,
  ERRANDS_STATUS_LABELS,
  TERMINAL_ERRANDS_STATUSES,
  canTransition,
  type ErrandsBooking,
  type ErrandsBookingDetails,
  type ErrandsBookingStatus,
  type ErrandsDriverCapability,
  type ErrandsServiceCategory,
} from '../../lib/errands/types';

/**
 * Safety-net cadence. Realtime is push-only: if the websocket drops, the
 * panel must still notice a new request, an acceptance or an expiry.
 */
const ERRANDS_POLL_MS = 8_000;
/** How many of this driver's bookings are kept in memory. */
const ERRANDS_BOOKINGS_LIMIT = 20;
/** Coalesces a burst of realtime events into one read. */
const ERRANDS_REFETCH_DEBOUNCE_MS = 300;
/**
 * The job itself. `REQUESTED` is handled separately — it is a request waiting
 * for an answer, not a trip the driver has committed to.
 */
const JOB_STATUSES: readonly ErrandsBookingStatus[] = ACTIVE_ERRANDS_STATUSES.filter(
  (status) => status !== 'REQUESTED'
);

/**
 * The live trip as the dashboard's maps need it. Every field is a server
 * value: the booking row's status and the exact endpoints that
 * `errands_booking_details` reveals ONLY after this driver accepted. The
 * panel never synthesises a coordinate — while the endpoints are invisible
 * (or there is no accepted job) it reports `null` and the map draws nothing.
 */
export interface ErrandsTripInfo {
  bookingId: string;
  status: ErrandsBookingStatus;
  pickup: LatLng | null;
  destination: LatLng | null;
  pickupAddress?: string;
  destinationAddress?: string;
}

export interface ErrandsJobPanelProps {
  /**
   * Reports whether a booking is live (any status in
   * `ACTIVE_ERRANDS_STATUSES`). The dashboard uses the SAME flag to publish
   * GPS at the active cadence and to pause incoming food requests.
   */
  onActiveChange?: (active: boolean) => void;
  /**
   * Fires when a NEW booking lands on this driver in `REQUESTED` — the
   * dashboard passes its existing food-request alert so the errand rings the
   * same chime.
   */
  onRequestAccepted?: () => void;
  /**
   * Reports the accepted trip's real pickup/drop-off so the dashboard's live
   * map and full-screen navigation can draw the actual road route — the same
   * route engine the food flow uses. `null` whenever there is no accepted job
   * with visible endpoints (unmount included), so a finished trip clears the
   * line instead of leaving a stale one behind.
   */
  onTripInfoChange?: (trip: ErrandsTripInfo | null) => void;
}

type StatusActionInput = {
  bookingId: string;
  status: ErrandsBookingStatus;
  note?: string;
  tripPin?: string;
};

const serviceIcon = (category: ErrandsServiceCategory): React.ReactNode =>
  category === 'ERRAND_MOTORCYCLE' ? <Bike className="h-4 w-4" /> : <Car className="h-4 w-4" />;

const primaryButtonClass =
  'flex min-h-[48px] w-full flex-1 items-center justify-center gap-2 rounded-[12px] bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const dangerButtonClass =
  'min-h-[48px] w-full rounded-[12px] border border-rose-200 bg-white px-4 text-[13px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

/**
 * The driver's Errands & on-demand rides surface. Mounted inside
 * `CourierDashboard`, styled as one more section of that screen.
 *
 * Honesty rules kept here: every number, address and status on screen is a
 * server row reached through `src/lib/errands` — there is no mock request, no
 * invented earning and no simulated realtime (an 8 s poll backs the socket and
 * every channel is `removeChannel()`d on unmount). Loading, empty and failure
 * are rendered as themselves: the database's own sentence is shown verbatim,
 * and a missing capability or address is reported instead of papered over.
 *
 * The trip PIN is submitted to the server and then forgotten — it is never
 * rendered, logged or kept anywhere in this component.
 */
export const ErrandsJobPanel: React.FC<ErrandsJobPanelProps> = ({
  onActiveChange,
  onRequestAccepted,
  onTripInfoChange,
}) => {
  const { user } = useAuth();

  // ── Availability ────────────────────────────────────────────────────
  const [capability, setCapability] = useState<ErrandsDriverCapability | null>(null);
  const [isCapabilityLoading, setIsCapabilityLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  // ── Bookings ────────────────────────────────────────────────────────
  const [bookings, setBookings] = useState<ErrandsBooking[]>([]);
  const [isBookingsLoading, setIsBookingsLoading] = useState(true);
  /** The booking this panel follows — its terminal state becomes a summary. */
  const [followedId, setFollowedId] = useState<string | null>(null);
  /** Finished jobs the driver already dismissed with "Done". */
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  // ── Actions ─────────────────────────────────────────────────────────
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tripPin, setTripPin] = useState('');
  const [failureNote, setFailureNote] = useState('');
  const [showFailureForm, setShowFailureForm] = useState(false);

  // ── Exact addresses (visible to the driver only after acceptance) ───
  const [jobDetails, setJobDetails] = useState<{
    id: string;
    details: ErrandsBookingDetails | null;
  } | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [detailsAttempt, setDetailsAttempt] = useState(0);

  /** Countdown clock — only ticks while a request is waiting for an answer. */
  const [now, setNow] = useState(() => Date.now());

  const onActiveChangeRef = useRef(onActiveChange);
  const onRequestAcceptedRef = useRef(onRequestAccepted);
  const onTripInfoChangeRef = useRef(onTripInfoChange);
  /** Booking ids already seen — a request only counts as NEW if absent here. */
  const knownBookingIdsRef = useRef<Set<string> | null>(null);
  const bookingsSeqRef = useRef(0);
  const expiredFiredRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  });
  useEffect(() => {
    onRequestAcceptedRef.current = onRequestAccepted;
  });
  useEffect(() => {
    onTripInfoChangeRef.current = onTripInfoChange;
  });

  // ── Capability: what this account is allowed to run ─────────────────
  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setIsCapabilityLoading(false);
      return;
    }
    fetchMyErrandsCapability().then((result) => {
      if (cancelled) return;
      setCapability(result);
      setIsCapabilityLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBookings = useCallback(async () => {
    const seq = ++bookingsSeqRef.current;
    try {
      const rows = await fetchDriverErrandsBookings(ERRANDS_BOOKINGS_LIMIT);
      if (seq !== bookingsSeqRef.current || !mountedRef.current) return;

      const known = knownBookingIdsRef.current;
      if (known) {
        const hasNewRequest = rows.some(
          (booking) => booking.status === 'REQUESTED' && !known.has(booking.id)
        );
        if (hasNewRequest) onRequestAcceptedRef.current?.();
      }
      knownBookingIdsRef.current = new Set(rows.map((booking) => booking.id));
      setBookings(rows);
    } catch {
      // The library never throws; whatever is already on screen stays.
    } finally {
      if (seq === bookingsSeqRef.current && mountedRef.current) {
        setIsBookingsLoading(false);
      }
    }
  }, []);

  // ── Realtime + 8 s poll (the socket is a push, the poll is the net) ─
  useEffect(() => {
    mountedRef.current = true;
    if (!user?.id || !isSupabaseConfigured) {
      setIsBookingsLoading(false);
      return;
    }

    // Auth can resolve after mount: show the honest skeleton again instead of
    // flashing the empty state while the very first read is still in flight.
    if (knownBookingIdsRef.current === null) setIsBookingsLoading(true);
    loadBookings();

    const poll = window.setInterval(() => {
      if (document.hidden) return;
      loadBookings();
    }, ERRANDS_POLL_MS);

    let refetchTimer: number | null = null;
    const channel = supabase
      .channel(`courier-errands-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'errands_bookings',
          filter: `driver_id=eq.${user.id}`,
        },
        () => {
          if (refetchTimer !== null) window.clearTimeout(refetchTimer);
          refetchTimer = window.setTimeout(() => {
            refetchTimer = null;
            loadBookings();
          }, ERRANDS_REFETCH_DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      if (refetchTimer !== null) window.clearTimeout(refetchTimer);
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [user?.id, loadBookings]);

  // ── Which cards are on screen ───────────────────────────────────────
  const incoming = useMemo(
    () => bookings.find((booking) => booking.status === 'REQUESTED') ?? null,
    [bookings]
  );

  const liveJob = useMemo(() => {
    const followed = followedId
      ? bookings.find((booking) => booking.id === followedId) ?? null
      : null;
    if (followed) return dismissedIds.includes(followed.id) ? null : followed;
    return (
      bookings.find(
        (booking) => JOB_STATUSES.includes(booking.status) && !dismissedIds.includes(booking.id)
      ) ?? null
    );
  }, [bookings, followedId, dismissedIds]);

  // A job found through the fallback scan becomes the followed one, so its
  // eventual terminal state still collapses into a summary.
  useEffect(() => {
    if (!followedId && liveJob) setFollowedId(liveJob.id);
  }, [followedId, liveJob]);

  // ── One flag back into the dashboard (GPS cadence + food pause) ─────
  const isActiveJob = Boolean(liveJob && ACTIVE_ERRANDS_STATUSES.includes(liveJob.status));

  useEffect(() => {
    onActiveChangeRef.current?.(isActiveJob);
  }, [isActiveJob]);

  useEffect(() => {
    return () => {
      onActiveChangeRef.current?.(false);
    };
  }, []);

  // ── Exact addresses for the job in hand ─────────────────────────────
  useEffect(() => {
    const job = liveJob;
    if (!job || job.status === 'REQUESTED') {
      setIsDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setIsDetailsLoading(true);
    fetchErrandsBooking(job.id).then((full) => {
      if (cancelled) return;
      setJobDetails({
        id: job.id,
        details: full && full.id === job.id ? full.details : null,
      });
      setIsDetailsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // A new job id, a status change or a retry each deserve a fresh read;
    // the stored row is keyed by id so an old job's address is never drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJob?.id, liveJob?.status, detailsAttempt]);

  const exactDetails: ErrandsBookingDetails | null =
    jobDetails && liveJob && jobDetails.id === liveJob.id ? jobDetails.details : null;

  // ── Routing endpoints for the dashboard's map ────────────────────────────
  /**
   * The accepted trip's real pickup/drop-off, keyed on primitives (job id,
   * status, the details row) rather than the booking object: the 8 s poll
   * hands back fresh rows with identical content, and a new object identity
   * must not redraw the route every eight seconds. Stays `null` until the
   * server has revealed the endpoints post-acceptance — a still-loading or
   * refused details read means NO line, never a guessed one.
   */
  const tripInfo = useMemo<ErrandsTripInfo | null>(() => {
    const job = liveJob;
    if (!job || !ACTIVE_ERRANDS_STATUSES.includes(job.status)) return null;
    if (!jobDetails || jobDetails.id !== job.id || !jobDetails.details) return null;
    const details = jobDetails.details;
    return {
      bookingId: job.id,
      status: job.status,
      pickup:
        details.pickupLatitude != null && details.pickupLongitude != null
          ? { lat: details.pickupLatitude, lng: details.pickupLongitude }
          : null,
      destination:
        details.destinationLatitude != null && details.destinationLongitude != null
          ? { lat: details.destinationLatitude, lng: details.destinationLongitude }
          : null,
      pickupAddress: details.pickupAddress ?? undefined,
      destinationAddress: details.destinationAddress ?? undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the primitives that fully identify the job content
  }, [liveJob?.id, liveJob?.status, jobDetails]);

  // Hand the trip to the dashboard whenever it changes (including → null when
  // the job ends or is dismissed, which clears the drawn route).
  useEffect(() => {
    onTripInfoChangeRef.current?.(tripInfo);
  }, [tripInfo]);

  // …and forget it on unmount so no dashboard keeps a dead trip on its map.
  useEffect(() => {
    return () => {
      onTripInfoChangeRef.current?.(null);
    };
  }, []);

  // ── Countdown to `requested_expires_at` ─────────────────────────────
  useEffect(() => {
    if (!incoming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [incoming?.id]);

  const expiresAtMs = incoming ? Date.parse(incoming.requestedExpiresAt) : Number.NaN;
  const secondsLeft = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.ceil((expiresAtMs - now) / 1000))
    : 0;

  useEffect(() => {
    if (!incoming || !Number.isFinite(expiresAtMs)) return;
    if (expiresAtMs > Date.now()) return;
    if (expiredFiredRef.current === incoming.id) return;
    expiredFiredRef.current = incoming.id;
    (async () => {
      await expireStaleErrandsBookings();
      if (mountedRef.current) loadBookings();
    })();
  }, [incoming, expiresAtMs, secondsLeft, loadBookings]);

  // A different job on screen ⇒ an error typed for the old one is stale.
  useEffect(() => {
    setActionError(null);
    setShowFailureForm(false);
    setFailureNote('');
    setTripPin('');
  }, [incoming?.id, liveJob?.id]);

  const isAvailabilityEnabled = Boolean(capability?.errandsEnabled);
  /** With no row yet, nothing is granted — the note below is still true. */
  const hasGrantedServices = !isSupabaseConfigured
    ? false
    : capability
      ? capability.motorcycleErrands || capability.carRides
      : false;

  const toggleAvailability = async () => {
    if (isToggling || isCapabilityLoading) return;
    const next = !isAvailabilityEnabled;
    setIsToggling(true);
    setAvailabilityError(null);
    const result = await setErrandsAvailability(next);
    if (result.ok) setCapability(result.capability);
    else setAvailabilityError(result.error);
    setIsToggling(false);
  };

  const runStatusAction = async (input: StatusActionInput, follow = false) => {
    if (isSubmitting) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      const result = await setErrandsBookingStatus(input);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      if (follow) setFollowedId(input.bookingId);
      setShowFailureForm(false);
      setFailureNote('');
      setTripPin('');
      await loadBookings();
    } finally {
      setIsSubmitting(false);
    }
  };

  const dismissJob = () => {
    if (!liveJob) return;
    const id = liveJob.id;
    setDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setFollowedId(null);
    setActionError(null);
  };

  // Step flow — every button below exists only where the database says it does.
  const jobStatus = liveJob?.status;
  const isTerminal = Boolean(liveJob && TERMINAL_ERRANDS_STATUSES.includes(liveJob.status));
  const primaryAction: { label: string; to: ErrandsBookingStatus; icon: React.ReactNode } | null =
    !liveJob || isTerminal
      ? null
      : liveJob.status === 'DRIVER_ACCEPTED'
        ? {
            label: "I'm on the way",
            to: 'DRIVER_ARRIVING',
            icon: <Navigation className="h-4 w-4" />,
          }
        : liveJob.status === 'DRIVER_ARRIVING'
          ? { label: "I've arrived", to: 'DRIVER_ARRIVED', icon: <MapPin className="h-4 w-4" /> }
          : liveJob.status === 'DRIVER_ARRIVED' &&
              liveJob.serviceCategory !== 'RIDE_CAR'
            ? {
                label: 'Start delivery',
                to: 'IN_PROGRESS',
                icon: <Package className="h-4 w-4" />,
              }
            : liveJob.status === 'IN_PROGRESS'
              ? { label: 'Complete', to: 'COMPLETED', icon: <Check className="h-4 w-4" /> }
              : null;

  const showPickupBlock = jobStatus === 'DRIVER_ARRIVED';
  const showDestinationBlock = jobStatus === 'IN_PROGRESS';

  /** Address copy for the current step — honest about a failed lookup. */
  const renderAddress = (label: string, address: string | null, tone: 'amber' | 'slate') => (
    <div className="min-w-0">
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
          tone === 'amber' ? 'text-amber-700' : 'text-slate-500'
        }`}
      >
        {label}
      </p>
      {isDetailsLoading ? (
        <div
          className={`mt-1 h-3.5 w-40 animate-pulse rounded ${
            tone === 'amber' ? 'bg-amber-100' : 'bg-slate-200'
          }`}
          aria-hidden="true"
        />
      ) : address ? (
        <p className="mt-0.5 text-[13px] font-semibold leading-snug text-slate-900">{address}</p>
      ) : (
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
          The exact address could not be loaded.{' '}
          <button
            type="button"
            onClick={() => setDetailsAttempt((attempt) => attempt + 1)}
            className="font-bold underline underline-offset-2 hover:text-slate-700"
          >
            Retry
          </button>
        </p>
      )}
    </div>
  );

  return (
    <section
      aria-label="Errands and rides"
      className="border-b border-slate-100 bg-white px-4 py-4 md:px-6"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-slate-900">Errands &amp; rides</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            Parcel deliveries and passenger rides booked with you
          </p>
        </div>
        {(incoming || liveJob) && (
          <span className="shrink-0 rounded-[8px] bg-[#fd6902]/10 px-2 py-1 text-[11px] font-bold text-[#fd6902]">
            {incoming ? 'New request' : isTerminal ? 'Finished' : 'Active'}
          </span>
        )}
      </div>

      {/* ── Availability ─────────────────────────────────────────────── */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] border border-slate-200 bg-slate-50 p-3.5">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-slate-900">Available for Errands</p>
          {isCapabilityLoading ? (
            <div
              className="mt-1.5 h-3 w-44 animate-pulse rounded bg-slate-200"
              aria-hidden="true"
            />
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-500">
              {isAvailabilityEnabled
                ? 'You are receiving Errands requests near you.'
                : 'Turn this on to receive Errands requests near you.'}
            </p>
          )}

          {availabilityError && (
            <p className="mt-2 flex items-start gap-1.5 rounded-[10px] border border-rose-200 bg-rose-50 p-2 text-[11px] leading-snug text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
              <span>{availabilityError}</span>
            </p>
          )}

          {!isCapabilityLoading && !isSupabaseConfigured && (
            <p className="mt-2 text-[11px] text-slate-500">
              Connect Supabase to manage your Errands availability.
            </p>
          )}

          {!isCapabilityLoading && isSupabaseConfigured && !hasGrantedServices && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                No Errands services are enabled for your account yet — SamleyGo administration
                grants these after approval.
              </span>
            </p>
          )}
        </div>

        {isCapabilityLoading ? (
          <span
            className="h-7 w-12 shrink-0 animate-pulse rounded-full bg-slate-200"
            aria-hidden="true"
          />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={isAvailabilityEnabled}
            aria-label="Available for Errands"
            disabled={isToggling || !isSupabaseConfigured}
            onClick={toggleAvailability}
            className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isAvailabilityEnabled ? 'bg-emerald-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                isAvailabilityEnabled ? 'left-6' : 'left-1'
              }`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* One place for the server's own sentence after any failed action. */}
      {actionError && (
        <p className="mt-3 flex items-start gap-2 rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-[11px] leading-snug text-rose-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
          <span>{actionError}</span>
        </p>
      )}

      {/* ── Loading ──────────────────────────────────────────────────── */}
      {isBookingsLoading && (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
          <div className="h-24 animate-pulse rounded-[14px] bg-slate-100" />
        </div>
      )}

      {/* ── Incoming request — the highest priority card ─────────────── */}
      {!isBookingsLoading && incoming && (
        <div className="mt-3 space-y-3 rounded-[14px] border-2 border-emerald-300 bg-emerald-50/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#02472d] text-white"
                aria-hidden="true"
              >
                {serviceIcon(incoming.serviceCategory)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                  New request · {ERRANDS_SERVICE_LABELS[incoming.serviceCategory]}
                </p>
                <p className="truncate text-[13px] font-bold text-slate-900">
                  #{incoming.bookingNumber}
                </p>
              </div>
            </div>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-[8px] border px-2 py-1 text-[11px] font-bold tabular-nums ${
                secondsLeft > 0
                  ? 'border-slate-200 bg-white text-slate-700'
                  : 'border-rose-200 bg-rose-50 text-rose-600'
              }`}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {secondsLeft > 0 ? `${secondsLeft}s` : 'Expired'}
            </span>
          </div>

          <div className="space-y-1.5 rounded-[12px] border border-white bg-white p-3 text-xs text-slate-600">
            <p className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0">
                <strong>Pickup:</strong> {incoming.pickupArea}
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <Navigation className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="min-w-0">
                <strong>Drop-off:</strong> {incoming.destinationArea}
              </span>
            </p>
          </div>

          {/* What the driver keeps — the customer's total is not their number. */}
          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-emerald-200 bg-white px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                You earn
              </p>
              <p className="text-[17px] font-bold leading-tight tabular-nums text-emerald-700">
                {formatGHS(incoming.driverEarning)}
              </p>
            </div>
            <span className="shrink-0 rounded-[8px] border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold tabular-nums text-slate-600">
              {formatDistanceKm(incoming.routeDistanceKm)}
            </span>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={() =>
                runStatusAction({ bookingId: incoming.id, status: 'DRIVER_ACCEPTED' }, true)
              }
              disabled={isSubmitting || secondsLeft <= 0}
              className="flex min-h-[44px] w-full flex-1 items-center justify-center gap-2 rounded-[12px] bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              <Check className="h-4 w-4" />
              <span>{isSubmitting ? 'Working…' : 'Accept'}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                runStatusAction({
                  bookingId: incoming.id,
                  status: 'CANCELLED',
                  note: 'Declined by driver',
                })
              }
              disabled={isSubmitting || secondsLeft <= 0}
              className="min-h-[44px] w-full rounded-[12px] border border-rose-200 bg-white px-4 text-[13px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* ── The job in hand — steps, or a terminal summary ───────────── */}
      {!isBookingsLoading && liveJob && (
        <div className="mt-3 rounded-[14px] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isTerminal ? 'bg-slate-300' : 'bg-[#fd6902]'
                }`}
                aria-hidden="true"
              />
              <h3 className="truncate text-[13px] font-bold text-slate-900">
                {isTerminal ? 'Errand summary' : 'Active errand'}{' '}
                <span className="font-semibold text-slate-500">#{liveJob.bookingNumber}</span>
              </h3>
            </div>
            <span className="shrink-0 rounded-[6px] border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {ERRANDS_SERVICE_LABELS[liveJob.serviceCategory]}
            </span>
          </div>

          <p className="mt-1.5 text-xs font-semibold text-slate-600">
            {ERRANDS_STATUS_LABELS[liveJob.status]}
          </p>

          {!isTerminal && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
              <Navigation className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{formatDistanceKm(liveJob.routeDistanceKm)} route</span>
            </p>
          )}

          {/* Coarse areas — always visible; the exact endpoints appear per step. */}
          <div className="mt-3 divide-y divide-slate-100 rounded-[14px] border border-slate-200">
            <div className="flex gap-3 p-3.5">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500 ring-4 ring-amber-100"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Pickup
                </p>
                <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900">
                  {liveJob.pickupArea}
                </p>
              </div>
            </div>
            <div className="flex gap-3 p-3.5">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-800 ring-4 ring-slate-100"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Drop-off
                </p>
                <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900">
                  {liveJob.destinationArea}
                </p>
              </div>
            </div>
          </div>

          {/* Arrived at the pickup: the exact address the server released. */}
          {showPickupBlock && (
            <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start justify-between gap-2">
                {renderAddress('Pickup point', exactDetails?.pickupAddress ?? null, 'amber')}
                {exactDetails?.customerPhone && (
                  <a
                    href={`tel:${exactDetails.customerPhone}`}
                    className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[10px] bg-white px-3 text-[11px] font-bold text-amber-800 transition hover:bg-amber-100"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span>{exactDetails.customerName || 'Call customer'}</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Under way: the exact drop-off the server released. */}
          {showDestinationBlock && (
            <div className="mt-3 rounded-[12px] border border-slate-200 bg-slate-50 p-3">
              {renderAddress('Destination', exactDetails?.destinationAddress ?? null, 'slate')}
            </div>
          )}

          {/* Passenger rides are PIN-gated: the driver submits it, never reads it. */}
          {!isTerminal && jobStatus === 'DRIVER_ARRIVED' && liveJob.serviceCategory === 'RIDE_CAR' && (
            <div className="mt-3 rounded-[12px] border border-slate-200 bg-slate-50 p-3">
              <label
                htmlFor="errands-trip-pin"
                className="block text-[11px] font-bold text-slate-700"
              >
                Trip PIN
              </label>
              <input
                id="errands-trip-pin"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={tripPin}
                onChange={(event) => setTripPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="mt-1.5 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2.5 text-center text-[18px] font-bold tracking-[0.5em] text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
              <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                Ask the customer for their 4-digit PIN. The PIN is never shown in your app.
              </p>
            </div>
          )}

          {/* What this job pays — always the driver's number, never the fare. */}
          {!isTerminal && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  You earn
                </p>
                <p className="text-[17px] font-bold leading-tight tabular-nums text-emerald-700">
                  {formatGHS(liveJob.driverEarning)}
                </p>
              </div>
              <span className="shrink-0 rounded-[8px] border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold tabular-nums text-slate-600">
                {formatDistanceKm(liveJob.routeDistanceKm)}
              </span>
            </div>
          )}

          {/* Terminal: the settled numbers, then a way to clear the card. */}
          {isTerminal && (
            <>
              {(liveJob.cancellationReason || liveJob.failureNote) && (
                <p className="mt-3 rounded-[10px] border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-snug text-slate-600">
                  <strong>{liveJob.failureNote ? 'Note: ' : 'Reason: '}</strong>
                  {liveJob.failureNote || liveJob.cancellationReason}
                </p>
              )}
              {liveJob.status === 'COMPLETED' && (
                <dl className="mt-3 grid grid-cols-2 gap-2 rounded-[12px] border border-slate-100 bg-slate-50 p-3.5 text-center">
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Trip fare
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-900">
                      {liveJob.finalFare != null ? formatGHS(liveJob.finalFare) : '—'}
                    </dd>
                  </div>
                  <div className="border-l border-slate-200/70">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                      You earn
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-emerald-700">
                      {formatGHS(liveJob.driverEarning)}
                    </dd>
                  </div>
                </dl>
              )}
            </>
          )}

          {/* ── Step actions — one primary operational action per state ── */}
          {!isTerminal && (
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              {primaryAction &&
                jobStatus &&
                canTransition(jobStatus, primaryAction.to, 'DRIVER') && (
                  <button
                    type="button"
                    onClick={() =>
                      runStatusAction({
                        bookingId: liveJob.id,
                        status: primaryAction.to,
                      })
                    }
                    disabled={isSubmitting}
                    className={primaryButtonClass}
                  >
                    {primaryAction.icon}
                    <span>{primaryAction.label}</span>
                  </button>
                )}

              {jobStatus === 'DRIVER_ARRIVED' && liveJob.serviceCategory === 'RIDE_CAR' && (
                <button
                  type="button"
                  onClick={() =>
                    runStatusAction({
                      bookingId: liveJob.id,
                      status: 'IN_PROGRESS',
                      tripPin,
                    })
                  }
                  disabled={isSubmitting || tripPin.length !== 4}
                  className={primaryButtonClass}
                >
                  <Car className="h-4 w-4" />
                  <span>{isSubmitting ? 'Working…' : 'Start ride'}</span>
                </button>
              )}

              {jobStatus && canTransition(jobStatus, 'CANCELLED', 'DRIVER') && (
                <button
                  type="button"
                  onClick={() =>
                    runStatusAction({
                      bookingId: liveJob.id,
                      status: 'CANCELLED',
                      note: 'Cancelled by driver',
                    })
                  }
                  disabled={isSubmitting}
                  className={dangerButtonClass}
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* ── Failed trips carry a short note for support ────────────── */}
          {!isTerminal && jobStatus && canTransition(jobStatus, 'FAILED', 'DRIVER') && (
            <div className="mt-3">
              {showFailureForm ? (
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 p-3">
                  <label
                    htmlFor="errands-failure-note"
                    className="block text-[11px] font-bold text-rose-800"
                  >
                    What went wrong?
                  </label>
                  <input
                    id="errands-failure-note"
                    type="text"
                    maxLength={200}
                    value={failureNote}
                    onChange={(event) => setFailureNote(event.target.value)}
                    placeholder="Short note for support"
                    className="mt-1.5 w-full rounded-[10px] border border-rose-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  />
                  <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() =>
                        runStatusAction({
                          bookingId: liveJob.id,
                          status: 'FAILED',
                          note: failureNote.trim(),
                        })
                      }
                      disabled={isSubmitting || !failureNote.trim()}
                      className="min-h-[40px] flex-1 rounded-[10px] bg-rose-600 px-3 text-[12px] font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Mark as failed
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowFailureForm(false);
                        setFailureNote('');
                      }}
                      className="min-h-[40px] rounded-[10px] border border-rose-200 bg-white px-3 text-[12px] font-bold text-rose-600 transition hover:bg-rose-50"
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowFailureForm(true)}
                  disabled={isSubmitting}
                  className="inline-flex min-h-[40px] items-center gap-1.5 text-[11px] font-bold text-rose-600 underline underline-offset-2 hover:text-rose-700 disabled:opacity-60"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Report a problem</span>
                </button>
              )}
            </div>
          )}

          {/* ── Finished: collapse to a summary and clear it ──────────── */}
          {isTerminal && (
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={dismissJob}
                className="min-h-[48px] w-full rounded-[12px] bg-slate-900 px-4 text-[13px] font-bold text-white transition hover:bg-slate-800 active:scale-[0.98] sm:w-auto"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Honest empty state — only once the first read lands ──────── */}
      {!isBookingsLoading && !incoming && !liveJob && (
        <div className="mt-3 max-w-md rounded-[14px] border border-slate-200 bg-white p-5 text-center">
          <Package className="mx-auto h-7 w-7 text-slate-300" />
          <h3 className="mt-2 text-[13px] font-semibold text-slate-700">
            {isAvailabilityEnabled
              ? 'No Errands requests right now'
              : 'Turn on availability to receive Errands jobs'}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            {isAvailabilityEnabled
              ? 'A new request will appear here and chime the moment a customer books you.'
              : 'Switch “Available for Errands” on above to start receiving requests near you.'}
          </p>
        </div>
      )}
    </section>
  );
};
