import React, { useEffect, useState, useRef } from 'react';
import {
  Bike,
  Navigation,
  MapPin,
  Phone,
  AlertTriangle,
  Package,
  ShieldCheck,
  ClipboardCheck,
  Hash,
  EyeOff,
  Bell,
  X,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Courier, CourierDocument, Order } from '../../types/database';
import { formatDistanceKm, formatGHS } from '../../lib/pricing';
import { getOrderFinancials, round2 } from '../../lib/commission';
import { DocumentImage } from '../../components/common/DocumentImage';
import {
  VERIFICATION_META,
  maskGhanaCardNumber,
  maskLicenseNumber,
} from '../../lib/verification';
import { watchPositionSafe, GeoError, describeGeoError } from '../../lib/geolocation';
import {
  createGpsFilter,
  destinationForPhase,
  endNavigationSession,
  gpsRejectionMessage,
  navLog,
  resolveNavigationPhase,
  syncNavigationSession,
  type GpsFilter,
} from '../../lib/navigation';
import { keepScreenAwake } from '../../lib/wakeLock';
import { usePlaceLabel } from '../../hooks/usePlaceLabel';
import { CourierLiveMap, MapRestaurantPin } from '../../components/courier/CourierLiveMap';
import {
  RESTAURANT_PIN_COLUMNS,
  geocodeRestaurantPin,
  pinFromRow,
  type RestaurantPinRow,
} from '../../lib/restaurantPins';
import { LiveDeliveryMapModal } from '../../components/common/LiveDeliveryMapModal';
import { playCourierAssignedAlert, initAudioUnlock } from '../../lib/soundAlerts';

/**
 * How often the courier's `couriers` row is refreshed — this is what every
 * live map (courier, customer, restaurant) renders. Active deliveries need a
 * tight cadence so the customer can follow along; an idle courier is
 * stationary and would only burn battery and rows.
 */
const LOC_PUBLISH_ACTIVE_MS = 10_000;
const LOC_PUBLISH_IDLE_MS = 25_000;
/**
 * Breadcrumb cadence for `delivery_locations` (the replay/history trail).
 * The live map reads the `couriers` row, so breadcrumbs only need to be
 * dense enough to reconstruct the trip afterwards.
 */
const BREADCRUMB_MS = 60_000;
/** Telemetry handed to the map's deviation filter and diagnostics HUD. */
type CourierFixTelemetry = {
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  timestamp?: number | null;
} | null;

export const CourierDashboard: React.FC = () => {
  const { user } = useAuth();

  const [courier, setCourier] = useState<Courier | null>(null);
  const [documents, setDocuments] = useState<CourierDocument[]>([]);
  const [activeDelivery, setActiveDelivery] = useState<Order | null>(null);
  const [availableRequests, setAvailableRequests] = useState<Order[]>([]);
  const [isUpdatingOnline, setIsUpdatingOnline] = useState(false);
  const [gpsActive, setGpsActive] = useState(false);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Human-readable area for the telemetry bar — replaces a raw "Lat/Lon"
  // readout with e.g. "East Legon, Accra", refreshed live as the rider moves.
  const currentPlaceLabel = usePlaceLabel(currentCoords);
  const [locationStatus, setLocationStatus] = useState<string>('GPS Standby');
  const [isLoading, setIsLoading] = useState(true);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [showLiveMapModal, setShowLiveMapModal] = useState(false);
  const [isInlineMapHidden, setIsInlineMapHidden] = useState(false);
  /** Every restaurant on the platform, drawn as secondary pins on the live map. */
  const [mapRestaurants, setMapRestaurants] = useState<MapRestaurantPin[]>([]);
  /**
   * Pins that came straight from the DB, kept apart from the ones resolved from
   * address text so a background refresh can rebuild the list without dropping
   * (and then re-drawing, one per second) the lookups already paid for.
   */
  const dbPinsRef = useRef<MapRestaurantPin[]>([]);
  /** Address-resolved pins for this session — keys are restaurant ids. */
  const resolvedPinsRef = useRef<Map<string, MapRestaurantPin>>(new Map());
  /** Ids whose address lookup is already waiting its turn in the queue. */
  const queuedLookupsRef = useRef<Set<string>>(new Set());
  /** Newest read wins: a slow, older response never overwrites a fresher list. */
  const mapRestaurantsSeqRef = useRef(0);
  const [incomingAssignedAlert, setIncomingAssignedAlert] = useState<{
    orderNumber: string | number;
    orderId: string;
    deliveryAddress?: string;
  } | null>(null);

  // Restaurants to draw as secondary pins: the whole platform except the active
  // pickup, which already owns the amber 🍳 pin and the route target.
  const otherRestaurants = activeDelivery?.restaurant_id
    ? mapRestaurants.filter((r) => r.id !== activeDelivery.restaurant_id)
    : mapRestaurants;

  // Holds the geolocation watcher's cleanup function (typed as number for ref compatibility)
  const watchIdRef = useRef<number | null>(null);
  const lastWriteTimeRef = useRef<number>(0);
  /** Last `delivery_locations` breadcrumb — a much slower cadence than the row. */
  const lastBreadcrumbTimeRef = useRef<number>(0);
  const releaseWakeLockRef = useRef<(() => void) | null>(null);
  // Mirror of activeDelivery so the GPS watcher (a long-lived closure) always
  // breadcrumb-logs for the CURRENT delivery, not the one from when tracking began.
  const activeDeliveryRef = useRef<Order | null>(null);
  /**
   * Sequential GPS gate (accuracy / staleness / jump filtering). Built once so
   * the fix history survives every re-render — a fresh filter would forget the
   * previous fix and let a teleport through.
   */
  const gpsFilterRef = useRef<GpsFilter | null>(null);
  /** Latest ACCEPTED GPS telemetry — accuracy/heading/speed for the map HUD. */
  const [courierFix, setCourierFix] = useState<CourierFixTelemetry>(null);

  // Surface any non-fatal warning raised while creating the courier account
  useEffect(() => {
    try {
      const warning = sessionStorage.getItem('samleygo_signup_warning');
      if (warning) {
        setVerificationNotice(warning);
        sessionStorage.removeItem('samleygo_signup_warning');
      }
    } catch {
      // Storage unavailable
    }
  }, []);

  // Load Courier profile, verification documents & active deliveries
  const fetchCourierData = async () => {
    if (!user || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch Courier row
      // `.maybeSingle()` all the way down: `.single()` sends an object Accept
      // header, and PostgREST answers 406 whenever zero rows come back — which
      // for a courier with no delivery is *every* load and every 45 s poll.
      const { data: cData } = await supabase
        .from('couriers')
        // profile join: the header shows the courier's name AND photo (the
        // photo is what customers/restaurants see during a delivery)
        .select('*, profile:profiles(id, full_name, avatar_url, phone)')
        .eq('id', user.id)
        .maybeSingle();

      if (!cData) {
        // Create courier record if missing (identity verification still required)
        await supabase.from('couriers').upsert({
          id: user.id,
          vehicle_type: 'Motorcycle',
          is_approved: false,
          is_online: false,
          availability_status: 'OFFLINE',
          verification_status: 'UNSUBMITTED',
        });
      } else {
        setCourier(cData as Courier);
      }

      // 1b. Fetch submitted verification documents (Ghana Card front / back)
      const { data: docData } = await supabase
        .from('courier_documents')
        .select('*')
        .eq('courier_id', user.id)
        .order('uploaded_at', { ascending: false });

      if (docData) {
        setDocuments(docData as CourierDocument[]);
      }

      // 2. Fetch current active delivery (if any)
      // `maybeSingle()` + `limit(1)`: an idle courier matches zero rows, and
      // `.single()`'s object Accept header made PostgREST answer HTTP 406 for
      // that every load and every 45 s refresh. This resolves to null instead.
      const { data: activeOrder } = await supabase
        .from('orders')
        .select('*, restaurant:restaurants(*), customer:profiles!orders_customer_id_fkey(*)')
        .eq('courier_id', user.id)
        .in('status', ['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'])
        .limit(1)
        .maybeSingle();

      if (activeOrder) {
        setActiveDelivery(activeOrder as Order);
      } else {
        setActiveDelivery(null);
      }

      // 3. Fetch available delivery requests awaiting courier dispatch
      const { data: pendingOrders } = await supabase
        .from('orders')
        .select('*, restaurant:restaurants(*)')
        .in('status', ['READY_FOR_PICKUP', 'RESTAURANT_ACCEPTED'])
        .is('courier_id', null)
        .order('created_at', { ascending: false });

      if (pendingOrders) {
        setAvailableRequests(pendingOrders as Order[]);
      }
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  };

  /** Rebuilds the drawn list from the DB rows plus everything resolved so far. */
  const publishMapRestaurants = () => {
    const fromDb = dbPinsRef.current;
    const drawnIds = new Set(fromDb.map((pin) => pin.id));
    const resolved = Array.from(resolvedPinsRef.current.values()).filter(
      (pin) => !drawnIds.has(pin.id)
    );
    setMapRestaurants(
      [...fromDb, ...resolved].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    );
  };

  /**
   * Look one kitchen's address up, then repaint. The lookup joins a queue that
   * runs one request at a time (see `geocodeRestaurantPin`), so a long list of
   * un-pinned kitchens fills in progressively instead of slamming the geocoder.
   */
  const queueRestaurantLookup = (row: RestaurantPinRow) => {
    const id = row.id;
    if (!id || queuedLookupsRef.current.has(id)) return;
    queuedLookupsRef.current.add(id);

    geocodeRestaurantPin(row)
      .then((pin) => {
        if (!pin) return; // Unplaceable address — it stays off the map (and is retried later).
        resolvedPinsRef.current.set(pin.id, pin);
        publishMapRestaurants();
      })
      .catch(() => {
        // Defensive: a rejected lookup must never surface as an unhandled rejection.
      })
      .finally(() => {
        queuedLookupsRef.current.delete(id);
      });
  };

  /**
   * All restaurants for the live map. Only the columns the map needs, bad rows
   * skipped, and every failure swallowed so a bad response can never take the
   * dashboard (or its map) down.
   *
   * Kitchens registered without a GPS point are NOT dropped: their address text
   * is looked up in the background so every registered kitchen still lands on
   * the courier's map (they just pop in a beat later).
   */
  const fetchMapRestaurants = async () => {
    if (!isSupabaseConfigured) return;
    const seq = ++mapRestaurantsSeqRef.current;

    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select(RESTAURANT_PIN_COLUMNS)
        .order('name', { ascending: true });

      if (error || !Array.isArray(data)) return;
      if (seq !== mapRestaurantsSeqRef.current) return; // a newer read already landed

      const rows = data as RestaurantPinRow[];
      const seenIds = new Set<string>();
      const pins: MapRestaurantPin[] = [];
      const needsLookup: RestaurantPinRow[] = [];

      for (const row of rows) {
        if (!row?.id) continue;
        seenIds.add(row.id);
        const pin = pinFromRow(row);
        if (pin) pins.push(pin);
        else if (!resolvedPinsRef.current.has(row.id)) needsLookup.push(row);
      }

      // Drop resolved pins for kitchens that were deleted since last time.
      for (const id of Array.from(resolvedPinsRef.current.keys())) {
        if (!seenIds.has(id)) resolvedPinsRef.current.delete(id);
      }

      dbPinsRef.current = pins;
      publishMapRestaurants();
      needsLookup.forEach(queueRestaurantLookup);
    } catch {
      // Offline / RLS surprise — keep whatever pins are already on screen.
    }
  };

  useEffect(() => {
    fetchCourierData();

    if (!user || !isSupabaseConfigured) return;

    // Realtime channel for order requests & updates
    const channel = supabase
      .channel(`courier-dispatch-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          const newOrder = payload.new as Order | undefined;
          const oldOrder = payload.old as Partial<Order> | undefined;

          // 1. Restaurant assigned this courier to the order!
          if (
            newOrder &&
            newOrder.courier_id === user.id &&
            (oldOrder?.courier_id !== user.id || newOrder.status === 'COURIER_ASSIGNED')
          ) {
            playCourierAssignedAlert();
            setIncomingAssignedAlert({
              orderNumber: newOrder.order_number,
              orderId: newOrder.id,
              deliveryAddress: newOrder.delivery_address,
            });
          }

          // 2. New delivery request posted (ready for pickup, unassigned)
          if (
            payload.eventType === 'INSERT' &&
            newOrder?.status === 'READY_FOR_PICKUP' &&
            !newOrder.courier_id
          ) {
            playCourierAssignedAlert();
          }

          fetchCourierData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Background refresh — realtime is push-only, so if the websocket drops the
  // queue and status chips would go stale. Re-read every 45 s while the tab is
  // visible (each action also refetches right after its own write).
  const fetchCourierDataRef = useRef(fetchCourierData);
  const fetchMapRestaurantsRef = useRef(fetchMapRestaurants);
  useEffect(() => {
    fetchCourierDataRef.current = fetchCourierData;
    fetchMapRestaurantsRef.current = fetchMapRestaurants;
  });

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      fetchCourierDataRef.current();
      fetchMapRestaurantsRef.current();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  // Realtime: keep every restaurant pin live (new partner kitchens, moved pins,
  // closures). The event only *schedules* a debounced refetch, so a partial or
  // malformed websocket payload can never corrupt what's drawn — and the 45 s
  // poll above heals the whole list if this socket ever drops.
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    fetchMapRestaurants();

    let refetchTimer: number | null = null;
    const channel = supabase
      .channel(`courier-restaurant-pins-${user?.id ?? 'public'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurants' },
        () => {
          if (refetchTimer !== null) window.clearTimeout(refetchTimer);
          refetchTimer = window.setTimeout(() => {
            refetchTimer = null;
            fetchMapRestaurants();
          }, 1200);
        }
      )
      .subscribe();

    return () => {
      if (refetchTimer !== null) window.clearTimeout(refetchTimer);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Keep the GPS watcher's view of the active delivery fresh
  useEffect(() => {
    activeDeliveryRef.current = activeDelivery;
  }, [activeDelivery]);

  // ── Navigation session: ONE authoritative record of what this courier is
  // navigating to right now. It follows the order's status, so the phase can
  // never disagree with the map — and a finished/cancelled order ends it.
  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return;

    if (!activeDelivery) {
      endNavigationSession('NO_ACTIVE_DELIVERY');
      return;
    }

    const pickup =
      activeDelivery.restaurant?.latitude != null && activeDelivery.restaurant?.longitude != null
        ? { lat: activeDelivery.restaurant.latitude, lng: activeDelivery.restaurant.longitude }
        : null;
    const dropoff =
      activeDelivery.delivery_latitude != null && activeDelivery.delivery_longitude != null
        ? { lat: activeDelivery.delivery_latitude, lng: activeDelivery.delivery_longitude }
        : null;

    const phase = resolveNavigationPhase(activeDelivery.status, {
      hasPickup: pickup !== null,
      hasDestination: dropoff !== null,
    });
    if (phase === 'IDLE') {
      // Ended/cancelled (or no coordinates at all) — never navigate anywhere.
      endNavigationSession('NO_NAVIGATION_TARGET');
      return;
    }

    syncNavigationSession({
      orderId: activeDelivery.id,
      courierId: user.id,
      phase,
      origin: currentCoords,
      destination: destinationForPhase(phase, pickup, dropoff),
    });
    // `currentCoords` is the courier's latest GPS — the session's origin is
    // always where they are, never where the trip started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeDelivery, currentCoords]);

  // Realtime: approval status & document review updates pushed from the admin console
  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`courier-verification-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'couriers', filter: `id=eq.${user.id}` },
        (payload) => {
          const next = payload.new as Courier;
          setCourier((prev) => (prev ? { ...prev, ...next } : next));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courier_documents', filter: `courier_id=eq.${user.id}` },
        () => {
          fetchCourierData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Online / Offline Toggle
  const toggleOnline = async () => {
    if (!courier || !user || !courier.is_approved) return;
    setIsUpdatingOnline(true);
    // User gesture → unlock AudioContext so future rings can play
    initAudioUnlock();
    const newStatus = !courier.is_online;

    try {
      await supabase
        .from('couriers')
        .update({
          is_online: newStatus,
          availability_status: newStatus ? 'AVAILABLE' : 'OFFLINE',
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      setCourier((prev) =>
        prev
          ? {
              ...prev,
              is_online: newStatus,
              availability_status: newStatus ? 'AVAILABLE' : 'OFFLINE',
            }
          : null
      );

      if (newStatus) {
        startGpsTracking();
      } else {
        stopGpsTracking();
      }
    } catch {
      // Handled
    } finally {
      setIsUpdatingOnline(false);
    }
  };

  // GPS must track whenever the courier is online — regardless of how that
  // state was reached (initial page load, refresh, realtime push from admin,
  // or the manual toggle). This effect keeps the watcher in sync so the
  // dashboard never shows "GPS Offline" for an online courier.
  useEffect(() => {
    if (!user) return;

    if (courier?.is_online) {
      startGpsTracking();
    } else if (gpsActive) {
      stopGpsTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, courier?.is_online]);

  // Real GPS Location tracking using browser Geolocation API
  const startGpsTracking = () => {
    // Already watching — do not create a duplicate watcher (React StrictMode
    // and rapid is_online flips could otherwise stack several watches)
    if (watchIdRef.current !== null) return;

    setGpsActive(true);
    setLocationStatus('Acquiring GPS lock...');

    // Keep the screen on for the trip: with the phone pocketed or locked, the
    // browser stops firing watchPosition callbacks and the live maps freeze.
    if (!releaseWakeLockRef.current) {
      releaseWakeLockRef.current = keepScreenAwake();
    }

    const stopFn = watchPositionSafe(
      async (point) => {
        const now = Date.now();
        const fix = {
          lat: point.lat,
          lng: point.lng,
          accuracy: point.accuracy ?? null,
          heading: point.heading ?? null,
          speed: point.speed ?? null,
          timestamp: point.timestamp ?? null,
        };

        // Sequential gate: accuracy, staleness and implausible-jump filtering.
        // A rejected fix never moves the marker, never gets published, and
        // never triggers a reroute — the last good fix stays authoritative.
        if (!gpsFilterRef.current) gpsFilterRef.current = createGpsFilter();
        const verdict = gpsFilterRef.current.accept(fix, now);
        if (!verdict.ok) {
          navLog('NAVIGATION_GPS_REJECTED', {
            reason: verdict.reason,
            accuracyMeters: fix.accuracy ?? undefined,
          });
          const message = gpsRejectionMessage(verdict.reason);
          if (message) setLocationStatus(message);
          return;
        }

        const { lat, lng } = point;
        setCurrentCoords({ lat, lng });
        setCourierFix({
          accuracy: fix.accuracy,
          heading: fix.heading,
          speed: fix.speed,
          timestamp: fix.timestamp ?? now,
        });
        setLocationStatus(
          verdict.weak
            ? 'GPS signal is weak — using the best available fix'
            : 'GPS Live · updating every few seconds'
        );

        const delivery = activeDeliveryRef.current;

        // Throttle database writes: a delivery in progress publishes every ~10 s
        // (that is what moves the customer's map), an idle courier every ~25 s.
        const publishGap = delivery ? LOC_PUBLISH_ACTIVE_MS : LOC_PUBLISH_IDLE_MS;
        if (now - lastWriteTimeRef.current > publishGap && user) {
          lastWriteTimeRef.current = now;
          navLog('NAVIGATION_GPS_UPDATE', {
            lat,
            lng,
            accuracyMeters: fix.accuracy ?? undefined,
            active: Boolean(delivery),
          });

          try {
            // Update courier coordinates (this is what moves the maps).
            // supabase-js resolves with { error } instead of throwing, so the
            // failure has to be read explicitly or it vanishes silently.
            const { error: coordError } = await supabase
              .from('couriers')
              .update({
                current_latitude: lat,
                current_longitude: lng,
                current_location_updated_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
              })
              .eq('id', user.id);
            if (coordError) {
              console.warn('[GPS] courier coordinate write failed:', coordError.message);
            }
          } catch (err) {
            // Network failure — keep watching, retry on next tick
            console.warn('[GPS] location write threw:', err instanceof Error ? err.message : err);
          }
        }

        // History breadcrumb, on its own slower cadence (the live map does not
        // read it — writing one per fix would multiply DB writes for nothing).
        // (ref keeps this current — the watcher closure would be stale)
        if (delivery && user && now - lastBreadcrumbTimeRef.current > BREADCRUMB_MS) {
          lastBreadcrumbTimeRef.current = now;
          try {
            const { error: breadcrumbError } = await supabase.from('delivery_locations').insert({
              order_id: delivery.id,
              courier_id: user.id,
              latitude: lat,
              longitude: lng,
            });
            if (breadcrumbError) {
              console.warn('[GPS] delivery breadcrumb write failed:', breadcrumbError.message);
            }
          } catch (err) {
            console.warn('[GPS] breadcrumb write threw:', err instanceof Error ? err.message : err);
          }
        }
      },
      (err: GeoError) => {
        setGpsActive(false);
        setLocationStatus(err.message);
      }
    );

    // watchPositionSafe returns a cleanup function; store it so stopGpsTracking can call it
    watchIdRef.current = stopFn ? (stopFn as unknown as number) : null;
    if (!stopFn) {
      setGpsActive(false);
    }
  };

  const stopGpsTracking = () => {
    if (watchIdRef.current !== null) {
      // watchIdRef actually stores the watcher's cleanup function
      (watchIdRef.current as unknown as () => void)();
      watchIdRef.current = null;
    }
    if (releaseWakeLockRef.current) {
      releaseWakeLockRef.current();
      releaseWakeLockRef.current = null;
    }
    // Fresh tracking session → forget the old fix history (its timestamps are
    // from before the gap and would reject the first fix of the new session).
    gpsFilterRef.current?.reset();
    // No GPS → no navigation: end the session so nothing keeps pointing at a
    // destination the courier is no longer tracking (logged off / unmounted).
    endNavigationSession('GPS_STOPPED');
    setGpsActive(false);
    setLocationStatus('GPS Offline');
  };

  useEffect(() => {
    return () => {
      stopGpsTracking();
    };
  }, []);

  // Courier Actions
  const handleAcceptOrder = async (orderId: string) => {
    if (!user) return;
    try {
      await supabase
        .from('orders')
        .update({
          courier_id: user.id,
          status: 'COURIER_ACCEPTED',
        })
        .eq('id', orderId);

      await supabase.from('order_status_history').insert({
        order_id: orderId,
        status: 'COURIER_ACCEPTED',
        note: 'Courier accepted delivery and is moving toward the kitchen.',
        changed_by: user.id,
      });

      fetchCourierData();
    } catch {
      // Handled
    }
  };

  const handleUpdateOrderStatus = async (status: 'PICKED_UP' | 'ARRIVED' | 'DELIVERED') => {
    if (!activeDelivery || !user) return;

    try {
      const updates: { status: string; estimated_delivery_time?: string } = { status };

      const { error: statusError } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', activeDelivery.id);
      if (statusError) {
        console.warn('[Delivery] status update failed:', statusError.message);
        return;
      }

      const { error: historyError } = await supabase.from('order_status_history').insert({
        order_id: activeDelivery.id,
        status,
        note:
          status === 'PICKED_UP'
            ? 'Courier collected food from kitchen. On the way to customer!'
            : status === 'ARRIVED'
            ? 'Courier has arrived at customer gate.'
            : 'Delivery completed successfully.',
        changed_by: user.id,
      });
      if (historyError) {
        console.warn('[Delivery] status history write failed:', historyError.message);
      }

      // If delivered, increment courier completed count
      if (status === 'DELIVERED') {
        await supabase
          .from('couriers')
          .update({
            total_deliveries: (courier?.total_deliveries || 0) + 1,
            availability_status: 'AVAILABLE',
          })
          .eq('id', user.id);
      }

      // The customer's map must show the courier moving from the moment of the
      // transition: drop the 10 s write throttle so the very next GPS fix is
      // published immediately instead of waiting out the gap.
      lastWriteTimeRef.current = 0;

      fetchCourierData();
    } catch (err) {
      console.warn('[Delivery] status update threw:', err instanceof Error ? err.message : err);
    }
  };

  // Verification gating: a courier can only go online once the admin approves
  const verificationStatus = courier?.verification_status || 'UNSUBMITTED';
  const verificationMeta = VERIFICATION_META[verificationStatus] || VERIFICATION_META.UNSUBMITTED;
  const canGoOnline = Boolean(courier?.is_approved);

  // Identity data lives in the RLS-protected courier_documents table
  const ghanaCardDocument = documents.find((d) => d.document_type === 'GHANA_CARD_FRONT');
  const licenceDocument = documents.find((d) => d.document_type === 'DRIVING_LICENCE');
  const photoDocuments = documents.filter(
    (d) => d.document_type === 'GHANA_CARD_FRONT' || d.document_type === 'GHANA_CARD_BACK'
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-8">
      {/* One content column: edge-to-edge bands on a phone, a single framed
          surface on larger screens — no card stacks (§2/§17). */}
      <div className="mx-auto w-full max-w-5xl md:px-6 md:py-6">
        <div className="bg-white md:overflow-hidden md:rounded-[18px] md:border md:border-slate-200 md:shadow-xs">

        {/* Realtime assignment alert — solid SamleyGo green, one brand accent */}
        {incomingAssignedAlert && (
          <div className="flex flex-col gap-3 border-b border-black/10 bg-[#02472d] p-4 text-white sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/10"
                aria-hidden="true"
              >
                <Bell className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-[6px] bg-[#fd6902] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    New assignment
                  </span>
                  <span className="text-xs font-semibold text-emerald-100">
                    #{incomingAssignedAlert.orderNumber}
                  </span>
                </div>
                <p className="mt-1 text-sm font-bold leading-snug">
                  You have been assigned to deliver this order
                </p>
                {incomingAssignedAlert.deliveryAddress && (
                  <p className="mt-0.5 truncate text-[11px] text-emerald-100/85">
                    Drop-off: {incomingAssignedAlert.deliveryAddress}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowLiveMapModal(true);
                  setIncomingAssignedAlert(null);
                }}
                className="flex min-h-[40px] items-center gap-1.5 rounded-[10px] bg-white px-3.5 text-xs font-bold text-[#02472d] transition hover:bg-emerald-50 active:scale-95"
              >
                <Navigation className="h-3.5 w-3.5" />
                <span>Open map</span>
              </button>
              <button
                type="button"
                onClick={() => setIncomingAssignedAlert(null)}
                aria-label="Dismiss assignment alert"
                title="Dismiss alert"
                className="grid h-10 w-10 place-items-center rounded-[10px] text-emerald-100 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        
        {/* ── Courier status strip — compact operational header (§5) ─────── */}
        <section
          className="border-b border-slate-100 bg-white px-4 py-3 md:px-6"
          aria-label="Courier status"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                Courier Hub · Ghana
              </p>
              <h1 className="truncate text-[17px] font-bold leading-tight text-slate-900">
                {courier?.profile?.full_name || user?.email?.split('@')[0]}
              </h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                <span className="truncate">
                  {courier?.vehicle_type || 'Motorcycle'}
                  {courier?.vehicle_plate ? ` · ${courier.vehicle_plate}` : ''}
                </span>
                <span
                  className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold ${verificationMeta.chipClass}`}
                >
                  {verificationMeta.label}
                </span>
              </p>
            </div>

            {/* Availability control — dot + label, never colour alone (§5/§23) */}
            <button
              onClick={toggleOnline}
              disabled={isUpdatingOnline || !canGoOnline}
              aria-pressed={courier?.is_online ?? false}
              title={
                canGoOnline
                  ? 'Toggle your availability'
                  : 'Available once your identity documents are approved'
              }
              className={`flex h-11 shrink-0 items-center gap-2 rounded-[10px] px-3.5 text-[12px] font-bold transition active:scale-[0.97] ${
                !canGoOnline
                  ? 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400'
                  : courier?.is_online
                    ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                    : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  !canGoOnline
                    ? 'bg-slate-300'
                    : courier?.is_online
                      ? 'animate-pulse bg-white'
                      : 'bg-slate-400'
                }`}
              />
              <span>
                {!canGoOnline
                  ? 'Verification required'
                  : courier?.is_online
                    ? 'ONLINE'
                    : 'OFFLINE'}
              </span>
            </button>
          </div>

          {/* GPS + current area — the rider's real telemetry line (§5) */}
          <div className="mt-2.5 flex items-center gap-3 border-t border-slate-100 pt-2.5 text-[11px]">
            <span
              className={`flex min-w-0 items-center gap-1.5 font-semibold ${
                gpsActive ? 'text-emerald-700' : 'text-slate-500'
              }`}
              title={locationStatus}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  gpsActive ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'
                }`}
                aria-hidden="true"
              />
              <span className="truncate">{locationStatus}</span>
            </span>
            {currentCoords && (
              <span
                className="ml-auto flex min-w-0 shrink items-center gap-1.5 text-slate-500"
                title="Live GPS position"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[#fd6902]" aria-hidden="true" />
                <span className="truncate">{currentPlaceLabel || 'Locating your area…'}</span>
              </span>
            )}
          </div>

          {/* Verification Status Banner (updates in realtime after admin review) */}
          {!canGoOnline && (
            <div className="mt-3 space-y-1 rounded-[12px] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
                Identity verification · {verificationMeta.label}
              </p>
              <p className="text-[11px] text-amber-800">{verificationMeta.hint}</p>
              {courier?.verification_submitted_at && (
                <p className="text-[11px] text-amber-700">
                  Submitted{' '}
                  {new Date(courier.verification_submitted_at).toLocaleString('en-GH', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              )}
            </div>
          )}

          {verificationNotice && (
            <div className="mt-3 flex items-start gap-2 rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-500" />
              <span>{verificationNotice}</span>
            </div>
          )}

          {/* Submitted identity documents — hidden once approved; the profile page
              offers a "View Submitted Docs" modal instead (privacy on shared screens). */}
          {!canGoOnline && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Submitted Verification Documents
              </span>
              <span className="text-[10px] font-bold text-slate-500">
                {documents.length} on file
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                  <Hash className="w-3 h-3" /> Vehicle &amp; Licence
                </span>
                <p className="font-bold text-slate-800">
                  Plate: {courier?.vehicle_plate || '—'}
                </p>
                <p className="text-slate-600">
                  Licence ID: {maskLicenseNumber(licenceDocument?.document_number)}
                </p>
                <p className="text-slate-600">
                  Ghana Card: {maskGhanaCardNumber(ghanaCardDocument?.document_number)}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                  <ClipboardCheck className="w-3 h-3" /> Ghana Card Photos
                </span>
                {photoDocuments.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    No photos uploaded yet. Contact support to complete verification.
                  </p>
                ) : (
                  <div className="flex gap-2">
                    {photoDocuments.map((doc) => (
                      <div key={doc.id} className="flex-1">
                        <DocumentImage
                          document={doc}
                          className="w-full h-20 object-cover rounded-lg border border-slate-200"
                        />
                        <span className="block text-[9px] font-bold text-slate-500 mt-1 text-center">
                          {doc.document_side === 'BACK' ? 'Back' : 'Front'} ·{' '}
                          {doc.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          )}
        </section>

        {/* ── Live navigation map — the screen's primary surface (§6) ─────── */}
        {(gpsActive || activeDelivery) && (
          <section
            className="border-b border-slate-100 bg-white pb-3"
            aria-label="Live navigation map"
          >
            {/* Map toolbar: live indicator + visibility control (§14) */}
            <div className="flex items-center justify-between gap-2 px-4 pt-3 md:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-bold text-slate-900">
                  Live navigation
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                    gpsActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      gpsActive ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  {gpsActive ? 'Live' : 'Standby'}
                </span>
              </div>

              <div
                className="flex shrink-0 items-center gap-0.5 rounded-[10px] bg-slate-100 p-0.5"
                role="group"
                aria-label="Map visibility"
              >
                <button
                  type="button"
                  onClick={() => setIsInlineMapHidden(false)}
                  aria-pressed={!isInlineMapHidden}
                  className={`rounded-[8px] px-3 py-1.5 text-[11px] font-bold transition ${
                    !isInlineMapHidden
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Map
                </button>
                <button
                  type="button"
                  onClick={() => setIsInlineMapHidden(true)}
                  aria-pressed={isInlineMapHidden}
                  className={`rounded-[8px] px-3 py-1.5 text-[11px] font-bold transition ${
                    isInlineMapHidden
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Hide
                </button>
              </div>
            </div>

            {!isInlineMapHidden ? (
              <div className="mt-3">
                <CourierLiveMap
                  courierPosition={currentCoords}
                  status={activeDelivery?.status}
                  destination={
                    activeDelivery?.delivery_latitude && activeDelivery?.delivery_longitude
                      ? { lat: activeDelivery.delivery_latitude, lng: activeDelivery.delivery_longitude }
                      : null
                  }
                  destinationAddress={activeDelivery?.delivery_address}
                  pickup={
                    activeDelivery?.restaurant?.latitude && activeDelivery?.restaurant?.longitude
                      ? { lat: activeDelivery.restaurant.latitude, lng: activeDelivery.restaurant.longitude }
                      : null
                  }
                  pickupAddress={
                    activeDelivery?.restaurant
                      ? `${activeDelivery.restaurant.address}, ${activeDelivery.restaurant.city}`
                      : undefined
                  }
                  restaurants={otherRestaurants}
                  courierFix={courierFix}
                  showNavigationHud
                  flat
                  className="h-[clamp(300px,48dvh,560px)]"
                />

                {!activeDelivery && (
                  <p className="px-4 pt-2 text-[11px] text-slate-400 md:px-6">
                    Accept a delivery to see the pickup and customer pins on your map.
                  </p>
                )}
              </div>
            ) : (
              <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-slate-200 bg-slate-50 px-3.5 py-3 md:mx-6">
                <span className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
                  <EyeOff className="h-4 w-4 shrink-0 text-slate-400" />
                  <span>Map hidden. GPS tracking stays active.</span>
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  {activeDelivery && (
                    <button
                      type="button"
                      onClick={() => setShowLiveMapModal(true)}
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-800"
                    >
                      Open live map
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsInlineMapHidden(false)}
                    className="text-xs font-bold text-slate-700 underline underline-offset-2 hover:text-slate-900"
                  >
                    Show map
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Delivery information — one calm section, no double borders (§26) ── */}
        {activeDelivery ? (
          <section
            className="border-b border-slate-100 bg-white px-4 py-4 md:px-6"
            aria-label="Active delivery"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-[#fd6902]"
                  aria-hidden="true"
                />
                <h2 className="truncate text-[15px] font-bold text-slate-900">
                  Active delivery{' '}
                  <span className="font-semibold text-slate-500">
                    #{activeDelivery.order_number}
                  </span>
                </h2>
                <span className="shrink-0 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                  {activeDelivery.status.replace(/_/g, ' ')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowLiveMapModal(true)}
                className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 active:scale-95"
              >
                <Navigation className="h-3.5 w-3.5 text-emerald-600" />
                <span>Live map</span>
              </button>
            </div>

            {/* Route endpoints — one connected list: orange marker = pickup
                (matches the map's pickup pin), slate = drop-off (§26) */}
            <div className="mt-3 divide-y divide-slate-100 rounded-[14px] border border-slate-200">
              {/* Restaurant Pickup Info */}
              <div className="flex gap-3 p-3.5">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500 ring-4 ring-amber-100"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      Pickup · Kitchen
                    </p>
                    {activeDelivery.restaurant?.phone && (
                      <a
                        href={`tel:${activeDelivery.restaurant.phone}`}
                        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[10px] bg-slate-100 px-3 text-[11px] font-bold text-slate-700 transition hover:bg-slate-200"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{activeDelivery.restaurant.phone}</span>
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900">
                    {activeDelivery.restaurant?.name}
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="min-w-0">
                      {activeDelivery.restaurant?.address}, {activeDelivery.restaurant?.city}
                    </span>
                  </p>
                </div>
              </div>

              {/* Customer Drop-off Info */}
              <div className="flex gap-3 p-3.5">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-800 ring-4 ring-slate-100"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      Drop-off · Customer
                    </p>
                    {activeDelivery.customer_phone && (
                      <a
                        href={`tel:${activeDelivery.customer_phone}`}
                        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[10px] bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Call customer</span>
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900">
                    {activeDelivery.customer?.full_name || 'Customer'}
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-800" />
                    <span className="min-w-0">{activeDelivery.delivery_address}</span>
                  </p>
                  {activeDelivery.delivery_notes && (
                    <p className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-800">
                      <strong>Delivery notes:</strong> {activeDelivery.delivery_notes}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* What this job pays — straight from the order's server-written
                financial snapshot: distance, fee, courier earning. */}
            {(() => {
              const f = getOrderFinancials(activeDelivery);
              return (
                <dl className="mt-3 grid grid-cols-3 gap-2 rounded-[12px] border border-slate-100 bg-slate-50 p-3.5 text-center">
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Distance
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-900">
                      {formatDistanceKm(activeDelivery.delivery_distance_km)}
                    </dd>
                  </div>
                  <div className="border-x border-slate-200/70">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Delivery fee
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-900">
                      {formatGHS(f.deliveryFee)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                      Courier earning
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-emerald-700">
                      {formatGHS(f.courierEarning)}
                      {f.tip > 0 && (
                        <span className="block text-[10px] font-semibold text-emerald-600">
                          + {formatGHS(f.tip)} tip
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              );
            })()}

            {/* Courier step actions — one primary operational action per state */}
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              {activeDelivery.status === 'COURIER_ASSIGNED' && (
                <>
                  <button
                    onClick={() => handleAcceptOrder(activeDelivery.id)}
                    className="flex min-h-[48px] w-full flex-1 items-center justify-center gap-2 rounded-[12px] bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] sm:w-auto"
                  >
                    <Bike className="w-4 h-4" />
                    <span>Accept Assigned Delivery</span>
                  </button>
                  <button
                    onClick={async () => {
                      await supabase
                        .from('orders')
                        .update({ courier_id: null, status: 'READY_FOR_PICKUP' })
                        .eq('id', activeDelivery.id);
                      fetchCourierData();
                    }}
                    className="min-h-[48px] w-full rounded-[12px] border border-rose-200 px-4 text-[13px] font-bold text-rose-600 transition hover:bg-rose-50 sm:w-auto"
                  >
                    Decline
                  </button>
                </>
              )}

              {activeDelivery.status === 'COURIER_ACCEPTED' && (
                <button
                  onClick={() => handleUpdateOrderStatus('PICKED_UP')}
                  className="min-h-[48px] w-full rounded-[12px] bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                >
                  Confirm Food Picked Up from Kitchen
                </button>
              )}

              {activeDelivery.status === 'PICKED_UP' && (
                <button
                  onClick={() => handleUpdateOrderStatus('ARRIVED')}
                  className="min-h-[48px] w-full rounded-[12px] bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                >
                  I have Arrived at Customer Location
                </button>
              )}

              {activeDelivery.status === 'ARRIVED' && (
                <button
                  onClick={() => handleUpdateOrderStatus('DELIVERED')}
                  className="min-h-[48px] w-full rounded-[12px] bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                >
                  Complete Delivery &amp; Collect Payment
                </button>
              )}
            </div>
          </section>
        ) : null}

        {/* ── Available delivery requests ─────────────────────────────────── */}
        <section className="bg-white px-4 py-4 md:px-6" aria-label="Available delivery requests">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900">Available requests</h2>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                Ready for courier pickup across your service zone
              </p>
            </div>
            <span className="shrink-0 rounded-[8px] bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
              {availableRequests.length} available
            </span>
          </div>

          {!canGoOnline ? (
            <div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-center text-xs text-amber-800">
              <ShieldCheck className="mx-auto mb-2 h-7 w-7 text-amber-600" />
              <p className="font-bold">Identity verification is {verificationMeta.label}</p>
              <p className="mt-1">{verificationMeta.hint}</p>
            </div>
          ) : !courier?.is_online ? (
            <div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-center text-xs text-amber-800">
              <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-amber-600" />
              <p className="font-bold">You are currently OFFLINE</p>
              <p className="mt-1">
                Toggle your status to ONLINE above to receive and accept ready delivery jobs.
              </p>
            </div>
          ) : availableRequests.length === 0 ? (
            <div className="mt-3 max-w-md rounded-[14px] border border-slate-200 bg-white p-6 text-center">
              <Package className="mx-auto h-8 w-8 text-slate-300" />
              <h3 className="mt-2 text-[13px] font-semibold text-slate-700">
                No orders ready for pickup right now
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Realtime notifications will chime as soon as kitchens mark dishes ready.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {availableRequests.map((req) => {
                // Money straight from the order's server-written snapshot:
                // distance, the fee the customer paid and what the courier
                // keeps (Phase 1: 100% of the fee, tip included in payout).
                const f = getOrderFinancials(req);
                return (
                <div
                  key={req.id}
                  className="space-y-3 rounded-[14px] border border-slate-200 bg-white p-4 transition hover:border-emerald-400 sm:p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-slate-900">
                        #{req.order_number}
                      </span>
                      <p className="truncate text-xs font-semibold text-emerald-700">
                        {req.restaurant?.name}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums text-slate-900">
                        Payout: {formatGHS(round2(f.courierEarning + f.tip))}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        Fee {formatGHS(f.courierEarning)} · Tip {formatGHS(f.tip)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-slate-600">
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="min-w-0 truncate">
                        <strong>Pickup:</strong> {req.restaurant?.address}
                      </span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Navigation className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span className="min-w-0 truncate">
                        <strong>Drop-off:</strong> {req.delivery_address}
                      </span>
                    </p>
                  </div>

                  {/* Distance → delivery fee → courier earning: the three
                      numbers that decide whether a job is worth taking. */}
                  <dl className="grid grid-cols-3 gap-2 rounded-[12px] border border-slate-100 bg-slate-50 p-3 text-center">
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Distance
                      </dt>
                      <dd className="text-xs font-bold tabular-nums text-slate-900">
                        {formatDistanceKm(req.delivery_distance_km)}
                      </dd>
                    </div>
                    <div className="border-x border-slate-200/70">
                      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Delivery fee
                      </dt>
                      <dd className="text-xs font-bold tabular-nums text-slate-900">
                        {formatGHS(f.deliveryFee)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        Courier earning
                      </dt>
                      <dd className="text-xs font-bold tabular-nums text-emerald-700">
                        {formatGHS(f.courierEarning)}
                      </dd>
                    </div>
                  </dl>

                  <button
                    onClick={() => handleAcceptOrder(req.id)}
                    className="min-h-[44px] w-full rounded-[12px] bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                  >
                    Accept Delivery Request
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Desktop framing closes before the fixed-overlay modal */}
        </div>

        {/* Live Map Modal for Courier */}
        <LiveDeliveryMapModal
          isOpen={showLiveMapModal}
          onClose={() => setShowLiveMapModal(false)}
          orderNumber={activeDelivery?.order_number}
          status={activeDelivery?.status}
          courierPosition={currentCoords}
          pickup={
            activeDelivery?.restaurant?.latitude && activeDelivery?.restaurant?.longitude
              ? { lat: activeDelivery.restaurant.latitude, lng: activeDelivery.restaurant.longitude }
              : null
          }
          pickupName={activeDelivery?.restaurant?.name}
          pickupAddress={
            activeDelivery?.restaurant
              ? `${activeDelivery.restaurant.address}, ${activeDelivery.restaurant.city}`
              : undefined
          }
          destination={
            activeDelivery?.delivery_latitude && activeDelivery?.delivery_longitude
              ? { lat: activeDelivery.delivery_latitude, lng: activeDelivery.delivery_longitude }
              : null
          }
          destinationName={activeDelivery?.customer?.full_name}
          destinationAddress={activeDelivery?.delivery_address}
          restaurants={otherRestaurants}
          courierName={courier?.profile?.full_name || 'You (Courier)'}
          courierPhone={courier?.profile?.phone}
          customerPhone={activeDelivery?.customer_phone}
          role="COURIER"
          courierFix={courierFix}
        />

      </div>
    </div>
  );
};
