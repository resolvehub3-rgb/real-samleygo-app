import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Bike,
  Power,
  Navigation,
  MapPin,
  Clock,
  Phone,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  Package,
  ShieldCheck,
  ClipboardCheck,
  Hash,
  EyeOff,
  Eye,
  Bell,
  X,
  Plus,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Courier, CourierDocument, Order } from '../../types/database';
import { formatGHS } from '../../lib/pricing';
import { DocumentImage } from '../../components/common/DocumentImage';
import {
  VERIFICATION_META,
  maskGhanaCardNumber,
  maskLicenseNumber,
} from '../../lib/verification';
import { watchPositionSafe, GeoError, describeGeoError } from '../../lib/geolocation';
import { keepScreenAwake } from '../../lib/wakeLock';
import { usePlaceLabel } from '../../hooks/usePlaceLabel';
import { CourierLiveMap, MapRestaurantPin } from '../../components/courier/CourierLiveMap';
import {
  RESTAURANT_PIN_COLUMNS,
  geocodeRestaurantPin,
  pinFromRow,
  type RestaurantPinRow,
} from '../../lib/restaurantPins';
import { UserAvatar } from '../../components/common/UserAvatar';
import { LiveDeliveryMapModal } from '../../components/common/LiveDeliveryMapModal';
import { playCourierAssignedAlert, initAudioUnlock } from '../../lib/soundAlerts';
import { TestRingBellButton } from '../../components/common/TestRingBellButton';

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
  const releaseWakeLockRef = useRef<(() => void) | null>(null);
  // Mirror of activeDelivery so the GPS watcher (a long-lived closure) always
  // breadcrumb-logs for the CURRENT delivery, not the one from when tracking began.
  const activeDeliveryRef = useRef<Order | null>(null);

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
        const { lat, lng } = point;
        setCurrentCoords({ lat, lng });
        setLocationStatus('GPS Live · updating every few seconds');

        // Throttle database writes (minimum 10 seconds between writes to preserve battery & network)
        const now = Date.now();
        if (now - lastWriteTimeRef.current > 10000 && user) {
          lastWriteTimeRef.current = now;

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

            // If currently delivering an order, log breadcrumb to delivery_locations
            // (ref keeps this current — the watcher closure would be stale)
            if (activeDeliveryRef.current) {
              const { error: breadcrumbError } = await supabase.from('delivery_locations').insert({
                order_id: activeDeliveryRef.current.id,
                courier_id: user.id,
                latitude: lat,
                longitude: lng,
              });
              if (breadcrumbError) {
                console.warn('[GPS] delivery breadcrumb write failed:', breadcrumbError.message);
              }
            }
          } catch (err) {
            // Network failure — keep watching, retry on next tick
            console.warn('[GPS] location write threw:', err instanceof Error ? err.message : err);
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
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Real-time Restaurant Assignment Ringing Alert Banner (Bolt/Yango driver style) */}
        {incomingAssignedAlert && (
          <div className="bg-gradient-to-r from-emerald-600 via-teal-700 to-slate-900 text-white p-4 sm:p-5 rounded-3xl shadow-xl border border-emerald-400 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-white text-emerald-700 flex items-center justify-center flex-shrink-0 shadow-md">
                <Bell className="w-6 h-6 animate-bounce" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/30 border border-emerald-400/40 px-2 py-0.5 rounded-full">
                    ⚡ New Request Assigned by Restaurant
                  </span>
                  <span className="font-mono font-black text-sm">#{incomingAssignedAlert.orderNumber}</span>
                </div>
                <h3 className="font-extrabold text-sm sm:text-base mt-0.5">
                  You have been assigned to deliver this order!
                </h3>
                {incomingAssignedAlert.deliveryAddress && (
                  <p className="text-xs text-emerald-100/90 truncate mt-0.5">
                    Drop-off: {incomingAssignedAlert.deliveryAddress}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowLiveMapModal(true);
                  setIncomingAssignedAlert(null);
                }}
                className="px-4 py-2.5 rounded-xl bg-white hover:bg-emerald-50 active:scale-95 text-slate-950 font-black text-xs shadow-md transition flex items-center gap-1.5"
              >
                <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                <span>Open Live Map</span>
              </button>
              <button
                type="button"
                onClick={() => setIncomingAssignedAlert(null)}
                className="p-2.5 rounded-xl text-emerald-200 hover:text-white hover:bg-white/10 transition"
                title="Dismiss Alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        
        {/* Header & Status Card */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <Link
                to="/profile"
                title="Add or change your profile photo"
                className="relative group"
              >
                <UserAvatar
                  src={courier?.profile?.avatar_url}
                  name={courier?.profile?.full_name || user?.email?.split('@')[0]}
                  sizeClassName="w-12 h-12"
                  shapeClassName="rounded-2xl"
                  className="shadow-md ring-2 ring-emerald-100 group-hover:ring-emerald-300 transition"
                  fallback={<Bike className="w-6 h-6" />}
                />
                {!courier?.profile?.avatar_url && (
                  <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-600 text-white border-2 border-white flex items-center justify-center">
                    <Plus className="w-3 h-3" />
                  </span>
                )}
              </Link>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Courier Hub · Ghana
                </span>
                <h1 className="text-xl font-black text-slate-900">
                  {courier?.profile?.full_name || user?.email?.split('@')[0]}
                </h1>
                <p className="text-xs text-slate-500">
                  {courier?.vehicle_type || 'Motorcycle'}
                  {courier?.vehicle_plate ? ` · ${courier.vehicle_plate}` : ''} ·{' '}
                  <span
                    className={`font-bold px-1.5 py-0.5 rounded ${
                      verificationMeta.chipClass
                    }`}
                  >
                    {verificationMeta.label}
                  </span>
                </p>
              </div>
            </div>

            {/* Online Toggle Button */}
            <button
              onClick={toggleOnline}
              disabled={isUpdatingOnline || !canGoOnline}
              title={
                canGoOnline
                  ? 'Toggle your availability'
                  : 'Available once your identity documents are approved'
              }
              className={`flex items-center justify-center gap-2 py-3 px-6 rounded-2xl font-bold text-xs shadow-md transition transform active:scale-95 ${
                !canGoOnline
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : courier?.is_online
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/30'
                    : 'bg-slate-800 text-slate-100 hover:bg-slate-900'
              }`}
            >
              <Power className="w-4 h-4" />
              <span>
                {!canGoOnline
                  ? 'Verification Required'
                  : courier?.is_online
                    ? 'You are ONLINE'
                    : 'Go ONLINE'}
              </span>
            </button>
          </div>

          {/* Verification Status Banner (updates in realtime after admin review) */}
          {!canGoOnline && (
            <div className="mt-4 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
              <p className="font-black flex items-center gap-1.5">
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
            <div className="mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-[11px] text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-500" />
              <span>{verificationNotice}</span>
            </div>
          )}          {/* Submitted identity documents — hidden once approved; the profile page
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

          {/* Live GPS Telemetry Bar */}
          <div className="mt-4 pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  gpsActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                }`}
              />
              <span className="font-semibold">{locationStatus}</span>
            </div>
            <div className="flex items-center gap-3">
              <TestRingBellButton
                tone="courier"
                className="px-3 py-1 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200"
                iconClassName="text-emerald-600 animate-pulse"
              />
              {currentCoords && (
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg"
                  title="Live GPS position"
                >
                  <MapPin className="w-3 h-3 text-emerald-600" />
                  <span className="truncate max-w-[220px]">
                    {currentPlaceLabel || 'Locating your area…'}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Live GPS Map — the courier's own position with delivery pins.
            Shows whenever tracking is on; pins appear once an order is active. */}
        {(gpsActive || activeDelivery) && (
          <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-emerald-600" />
                Live GPS Map
              </h2>
              <div className="flex items-center gap-2">
                {activeDelivery && (
                  <button
                    type="button"
                    onClick={() => setShowLiveMapModal(true)}
                    className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Live Map</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsInlineMapHidden(!isInlineMapHidden)}
                  className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs flex items-center gap-1 transition"
                  title={isInlineMapHidden ? 'Show live map on screen' : 'Hide map from screen'}
                >
                  {isInlineMapHidden ? (
                    <>
                      <Eye className="w-3.5 h-3.5 text-slate-500" />
                      <span>Show Map</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                      <span>Hide Map</span>
                    </>
                  )}
                </button>
                {gpsActive && (
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Tracking
                  </span>
                )}
              </div>
            </div>

            {!isInlineMapHidden ? (
              <>
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
                  className="h-56 sm:h-64"
                />

                {!activeDelivery && (
                  <p className="text-[11px] text-slate-400 text-center">
                    Accept a delivery to see the pickup and customer pins on your map.
                  </p>
                )}
              </>
            ) : (
              <div className="py-3 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <EyeOff className="w-4 h-4 text-slate-400" />
                  <span>Map hidden. Real-time GPS tracking remains active.</span>
                </span>
                <div className="flex items-center gap-2">
                  {activeDelivery && (
                    <button
                      type="button"
                      onClick={() => setShowLiveMapModal(true)}
                      className="font-bold text-emerald-600 hover:text-emerald-700"
                    >
                      Open Live Map
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsInlineMapHidden(false)}
                    className="font-bold text-slate-700 hover:text-slate-900 underline"
                  >
                    Show Map
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active Ongoing Delivery Section */}
        {activeDelivery ? (
          <div className="bg-white rounded-3xl p-6 border-2 border-emerald-600 shadow-lg space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-600 animate-ping" />
                <h2 className="text-base font-black text-slate-900">
                  Active Delivery #{activeDelivery.order_number}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLiveMapModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Live Map</span>
                </button>
                <span className="text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl">
                  {activeDelivery.status.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            {/* Pickup + drop-off sit side by side (stacked on small screens) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              {/* Restaurant Pickup Info */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Pickup From Kitchen
                  </span>
                  {activeDelivery.restaurant?.phone && (
                    <a
                      href={`tel:${activeDelivery.restaurant.phone}`}
                      className="flex items-center gap-1 text-xs font-bold text-slate-700 bg-slate-200/80 px-2.5 py-1 rounded-lg"
                    >
                      <Phone className="w-3 h-3" />
                      <span>{activeDelivery.restaurant.phone}</span>
                    </a>
                  )}
                </div>
                <h3 className="font-bold text-sm text-slate-900 truncate">
                  {activeDelivery.restaurant?.name}
                </h3>
                <p className="text-xs text-slate-600 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>{activeDelivery.restaurant?.address}, {activeDelivery.restaurant?.city}</span>
                </p>
              </div>

              {/* Customer Drop-off Info */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Deliver To Customer
                  </span>
                  {activeDelivery.customer_phone && (
                    <a
                      href={`tel:${activeDelivery.customer_phone}`}
                      className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-lg"
                    >
                      <Phone className="w-3 h-3" />
                      <span>Call Customer</span>
                    </a>
                  )}
                </div>
                <h3 className="font-bold text-sm text-slate-900 truncate">
                  {activeDelivery.customer?.full_name || 'Customer'}
                </h3>
                <p className="text-xs text-slate-600 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>{activeDelivery.delivery_address}</span>
                </p>
                {activeDelivery.delivery_notes && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                    <strong>Notes:</strong> {activeDelivery.delivery_notes}
                  </p>
                )}
              </div>
            </div>

            {/* Courier Step Actions */}
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              {activeDelivery.status === 'COURIER_ASSIGNED' && (
                <>
                  <button
                    onClick={() => handleAcceptOrder(activeDelivery.id)}
                    className="w-full sm:w-auto flex-1 py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md transition flex items-center justify-center gap-2 active:scale-95"
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
                    className="w-full sm:w-auto py-3.5 px-4 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 font-bold text-xs transition"
                  >
                    Decline
                  </button>
                </>
              )}

              {activeDelivery.status === 'COURIER_ACCEPTED' && (
                <button
                  onClick={() => handleUpdateOrderStatus('PICKED_UP')}
                  className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md transition"
                >
                  Confirm Food Picked Up from Kitchen
                </button>
              )}

              {activeDelivery.status === 'PICKED_UP' && (
                <button
                  onClick={() => handleUpdateOrderStatus('ARRIVED')}
                  className="w-full py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs shadow-md transition"
                >
                  I have Arrived at Customer Location
                </button>
              )}

              {activeDelivery.status === 'ARRIVED' && (
                <button
                  onClick={() => handleUpdateOrderStatus('DELIVERED')}
                  className="w-full py-3.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs shadow-md transition"
                >
                  Complete Delivery &amp; Collect Payment
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* Available Delivery Requests Queue */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                Available Delivery Requests
              </h2>
              <p className="text-xs text-slate-500">
                Ready for courier pickup across your service zone
              </p>
            </div>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
              {availableRequests.length} Available
            </span>
          </div>

          {!canGoOnline ? (
            <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200 text-center text-xs text-amber-800">
              <ShieldCheck className="w-8 h-8 text-amber-600 mx-auto mb-2" />
              <p className="font-bold">Identity verification is {verificationMeta.label}</p>
              <p className="mt-1">{verificationMeta.hint}</p>
            </div>
          ) : !courier?.is_online ? (
            <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200 text-center text-xs text-amber-800">
              <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto mb-2" />
              <p className="font-bold">You are currently OFFLINE</p>
              <p className="mt-1">
                Toggle your status to ONLINE above to receive and accept ready delivery jobs.
              </p>
            </div>
          ) : availableRequests.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center max-w-md mx-auto">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-800">
                No orders ready for pickup right now
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Realtime notifications will chime as soon as kitchens mark dishes ready!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {availableRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs hover:border-emerald-500 transition space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-sm text-slate-900">
                        #{req.order_number}
                      </span>
                      <p className="text-xs font-semibold text-emerald-700">
                        {req.restaurant?.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-black text-sm text-slate-900">
                        Payout: {formatGHS(req.delivery_fee * 0.8 + req.tip)}
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        Fee: {formatGHS(req.delivery_fee)} + Tip: {formatGHS(req.tip)}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      <span><strong>Pickup:</strong> {req.restaurant?.address}</span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                      <span><strong>Drop-off:</strong> {req.delivery_address}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => handleAcceptOrder(req.id)}
                    className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition"
                  >
                    Accept Delivery Request
                  </button>
                </div>
              ))}
            </div>
          )}
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
        />

      </div>
    </div>
  );
};
