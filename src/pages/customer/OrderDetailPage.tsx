import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  MapPin,
  CheckCircle2,
  Bike,
  Store,
  Phone,
  Star,
  Navigation,
  Sparkles,
  Receipt,
  Check,
  EyeOff,
  Eye,
  Bell,
  X,
  RotateCcw,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  Order,
  OrderItem,
  OrderStatusHistory,
  DeliveryLocation,
  Courier,
  Profile,
  Review,
} from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { formatDistanceKm, formatGHS } from '../../lib/pricing';
import { CourierLiveMap } from '../../components/courier/CourierLiveMap';
import { LiveDeliveryMapModal } from '../../components/common/LiveDeliveryMapModal';
import { UserAvatar } from '../../components/common/UserAvatar';
import { ReorderButton } from '../../components/common/ReorderButton';
import { TestRingBellButton } from '../../components/common/TestRingBellButton';
import {
  playCustomerArrivedAlert,
  playCustomerSound,
  playCustomerStatusAlert,
} from '../../lib/soundAlerts';

const STATUS_STEPS = [
  { key: 'RESTAURANT_PENDING', label: 'Order Sent', desc: 'Awaiting kitchen confirmation' },
  { key: 'PREPARING', label: 'Cooking', desc: 'Kitchen is preparing your meal' },
  { key: 'READY_FOR_PICKUP', label: 'Ready', desc: 'Food ready for courier pickup' },
  { key: 'ON_THE_WAY', label: 'On The Way', desc: 'Courier traveling to your address' },
  { key: 'DELIVERED', label: 'Delivered', desc: 'Meal received safely' },
];

export const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();

  /** Present when the customer landed here by tapping "Reorder" on a past order. */
  const reorderNote = (
    location.state as { reorder?: { from: string; skipped: string[] } } | null
  )?.reorder;
  const [showReorderNote, setShowReorderNote] = useState(true);

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [history, setHistory] = useState<OrderStatusHistory[]>([]);
  const [courierDetails, setCourierDetails] = useState<Courier | null>(null);
  const [lastLocation, setLastLocation] = useState<DeliveryLocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLiveMapModal, setShowLiveMapModal] = useState(false);
  const [isInlineMapHidden, setIsInlineMapHidden] = useState(false);
  const [soundAlertBanner, setSoundAlertBanner] = useState<{
    type: 'PICKED_UP' | 'ARRIVED' | 'DELIVERED';
    title: string;
    message: string;
  } | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  // Review state
  const [restRating, setRestRating] = useState(5);
  const [restComment, setRestComment] = useState('');
  const [courierRating, setCourierRating] = useState(5);
  const [courierComment, setCourierComment] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  /** Friendly failure copy — the submit is never reported as saved when it isn't. */
  const [reviewError, setReviewError] = useState<string | null>(null);

  const fetchOrderDetails = async () => {
    if (!id || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch Order with joins
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*, restaurant:restaurants(*), courier:profiles!orders_courier_id_fkey(*)')
        .eq('id', id)
        .maybeSingle(); // unknown/hidden order → null instead of an HTTP 406

      if (orderError || !orderData) {
        setIsLoading(false);
        return;
      }

      setOrder(orderData as Order);
      prevStatusRef.current = orderData.status;

      // 2. Fetch Order Items
      const { data: itemsData } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);

      if (itemsData) setItems(itemsData as OrderItem[]);

      // 3. Fetch Status History
      const { data: historyData } = await supabase
        .from('order_status_history')
        .select('*')
        .eq('order_id', id)
        .order('created_at', { ascending: true });

      if (historyData) setHistory(historyData as OrderStatusHistory[]);

      // 4. Fetch Courier Details if assigned
      if (orderData.courier_id) {
        const { data: cData } = await supabase
          .from('couriers')
          .select(
            'id, vehicle_type, vehicle_plate, verification_status, created_at, updated_at, is_approved, is_online, availability_status, total_deliveries, rating, current_latitude, current_longitude, current_location_updated_at, profile:profiles(id, full_name, avatar_url, phone)'
          )
          .eq('id', orderData.courier_id)
          .maybeSingle(); // courier row missing → null, not HTTP 406

        if (cData) {
          setCourierDetails(cData as unknown as Courier);
        }

        // Fetch latest courier GPS location for this order
        const { data: locData } = await supabase
          .from('delivery_locations')
          .select('*')
          .eq('order_id', id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          // maybeSingle: no location row logged yet is the normal case — `.single()`
          // turned it into an HTTP 406 on every order page load
          .maybeSingle();

        if (locData) setLastLocation(locData as DeliveryLocation);
      }

      // 5. Check if user already reviewed
      const { data: revData } = await supabase
        .from('reviews')
        .select('*')
        .eq('order_id', id)
        .limit(1);

      if (revData && revData.length > 0) {
        // Hydrate from what is actually stored, so the screen shows the real
        // restaurant and courier stars the customer gave instead of defaults.
        const stored = revData[0] as Review;
        setReviewSubmitted(true);
        if (stored.restaurant_rating) setRestRating(stored.restaurant_rating);
        if (stored.courier_rating) setCourierRating(stored.courier_rating);
        setRestComment(stored.restaurant_comment || '');
        setCourierComment(stored.courier_comment || '');
      }
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  };  useEffect(() => {
    fetchOrderDetails();

    if (!id || !isSupabaseConfigured) return;

    // Realtime subscription for order updates
    const orderChannel = supabase
      .channel(`order-live-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          const newOrder = payload.new as Order | undefined;
          if (newOrder?.status) {
            const status = newOrder.status;
            const oldStatus = prevStatusRef.current;

            // One alert per transition — a status repeated in an unrelated
            // field update never re-rings.
            if (status !== oldStatus) {
              if (status === 'PICKED_UP') {
                // Courier started the trip — customer-sound.mp3 three times.
                playCustomerSound(3);
                setSoundAlertBanner({
                  type: 'PICKED_UP',
                  title: '🛵 Food Picked Up by Courier!',
                  message:
                    'Your courier has collected your food from the kitchen and is driving towards you.',
                });
                setTimeout(() => setSoundAlertBanner(null), 9000);
              } else if (status === 'ARRIVED') {
                // Courier tapped "I have Arrived at Customer Location" — the
                // meal is waiting at the drop-off. Custom sound + banner.
                playCustomerArrivedAlert();
                setSoundAlertBanner({
                  type: 'ARRIVED',
                  title: '🛵 Courier Has Arrived!',
                  message:
                    'Your courier is at your destination. Meet them at the drop-off point to collect your meal.',
                });
                setTimeout(() => setSoundAlertBanner(null), 15000);
              } else if (status === 'DELIVERED' || status === 'COMPLETED') {
                // Completed rings three times — but only once per order, even
                // though DELIVERED and COMPLETED are two separate milestones.
                if (oldStatus !== 'DELIVERED' && oldStatus !== 'COMPLETED') {
                  playCustomerSound(3);
                  setSoundAlertBanner({
                    type: 'DELIVERED',
                    title: '🎉 Order Delivered Safely!',
                    message: 'Your food has arrived at your destination. Enjoy your meal!',
                  });
                  setTimeout(() => setSoundAlertBanner(null), 12000);
                }
              } else {
                // Kitchen milestones: "New Incoming", "In Cooking" and
                // "Ready / Dispatched" (anything else is a silent no-op).
                playCustomerStatusAlert(status);
              }
            }

            prevStatusRef.current = status;
          }
          fetchOrderDetails();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'delivery_locations',
          filter: `order_id=eq.${id}`,
        },
        (payload) => {
          setLastLocation(payload.new as DeliveryLocation);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(orderChannel);
    };
  }, [id]);

  // Dedicated realtime listener for assigned courier's moving GPS pings
  useEffect(() => {
    if (!order?.courier_id || !isSupabaseConfigured) return;

    const courierChannel = supabase
      .channel(`order-courier-gps-${order.id}-${order.courier_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'couriers',
          filter: `id=eq.${order.courier_id}`,
        },
        (payload) => {
          const next = payload.new as {
            current_latitude?: number | null;
            current_longitude?: number | null;
            current_location_updated_at?: string;
          };
          if (next.current_latitude != null && next.current_longitude != null) {
            setCourierDetails((prev) =>
              prev
                ? ({ ...prev, ...next } as Courier)
                : ({
                    current_latitude: next.current_latitude,
                    current_longitude: next.current_longitude,
                  } as unknown as Courier)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(courierChannel);
    };
  }, [order?.courier_id, order?.id]);

  // Realtime courier identity — the rider changes their photo/name/phone on
  // their profile screen and it must appear HERE (customer's live delivery
  // card) without a refresh. Dedicated channel so a failure can never disturb
  // the GPS/order listeners above; the status callback swallows any error and
  // the 30 s safety-net poll below still picks the change up.
  useEffect(() => {
    const courierId = order?.courier_id;
    if (!courierId || !isSupabaseConfigured) return;

    const photoChannel = supabase
      .channel(`order-courier-photo-${order?.id}-${courierId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${courierId}`,
        },
        (payload) => {
          const next = payload.new as Partial<Profile>;
          if (!next?.id) return;

          setCourierDetails((prev) =>
            prev ? { ...prev, profile: { ...(prev.profile as Profile | undefined), ...next } as Profile } : prev
          );
          setOrder((prev) =>
            prev?.courier ? { ...prev, courier: { ...prev.courier, ...next } } : prev
          );
        }
      )
      .subscribe(() => {
        // Intentionally quiet: realtime is a bonus channel, the poll covers it.
      });

    return () => {
      supabase.removeChannel(photoChannel);
    };
  }, [order?.id, order?.courier_id]);

  // ── Realtime safety net ───────────────────────────────────────────────
  // Order/GPS updates arrive over websockets; if the socket drops (network
  // switch, backgrounded tab) the map would silently freeze. While the
  // delivery is live, re-read the courier's GPS every 30 s so the marker
  // keeps moving until realtime reconnects. Newer pings never regress to
  // older ones, and a failed poll is simply skipped until the next tick.
  const pollCourierId = order?.courier_id ?? null;
  const pollStatus = order?.status ?? '';
  useEffect(() => {
    if (!pollCourierId || !id || !isSupabaseConfigured) return;
    if (
      !['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(
        pollStatus
      )
    ) {
      return;
    }

    const refresh = async () => {
      if (document.hidden) return;

      try {
        const [courierResult, locationResult] = await Promise.all([
          supabase
            .from('couriers')
            // profile rides along so a courier who changed their photo is
            // re-surfaced here even if the realtime channel is unavailable
            .select('current_latitude, current_longitude, current_location_updated_at, profile:profiles(id, full_name, avatar_url, phone)')
            .eq('id', pollCourierId)
            .maybeSingle(),
          supabase
            .from('delivery_locations')
            .select('*')
            .eq('order_id', id)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        const ping = courierResult.data as
          | {
              current_latitude?: number | null;
              current_longitude?: number | null;
              current_location_updated_at?: string | null;
              profile?: Profile | null;
            }
          | null;

        // Fresh copy of the rider's photo/name, even on a tick with no GPS fix
        if (ping?.profile) {
          setCourierDetails((prev) =>
            prev
              ? ({ ...prev, profile: { ...(prev.profile ?? undefined), ...ping.profile } } as Courier)
              : prev
          );
        }

        if (ping?.current_latitude != null && ping.current_longitude != null) {
          setCourierDetails((prev) => {
            if (!prev) return ping as unknown as Courier;
            const prevTime = prev.current_location_updated_at
              ? new Date(prev.current_location_updated_at).getTime()
              : 0;
            const nextTime = ping.current_location_updated_at
              ? new Date(ping.current_location_updated_at).getTime()
              : 0;
            if (prevTime && nextTime && nextTime < prevTime) return prev;
            return { ...prev, ...ping } as unknown as Courier;
          });
        }

        const breadcrumb = locationResult.data as DeliveryLocation | null;
        if (breadcrumb) {
          setLastLocation((prev) => {
            if (!prev) return breadcrumb;
            return new Date(breadcrumb.recorded_at).getTime() >
              new Date(prev.recorded_at).getTime()
              ? breadcrumb
              : prev;
          });
        }
      } catch {
        // Network hiccup — realtime or the next tick recovers on its own.
      }
    };

    // Safety net behind the realtime channels: 15 s while the courier is
    // moving, plus an instant refresh the moment the customer comes back to
    // the tab (a phone that was locked during the trip otherwise keeps a stale
    // marker until the next tick).
    const timer = window.setInterval(refresh, 15_000);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    void refresh();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollCourierId, pollStatus, id]);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !user) return;

    setIsSubmittingReview(true);
    setReviewError(null);
    try {
      // Supabase returns { error } instead of throwing — this screen used to
      // ignore it and claim "recorded in the database" even when row level
      // security rejected the insert. One review per order per customer:
      // re-submitting updates the existing row (unique order_id + customer_id).
      const { error } = await supabase.from('reviews').upsert(
        {
          order_id: order.id,
          customer_id: user.id,
          restaurant_id: order.restaurant_id,
          courier_id: order.courier_id || null,
          restaurant_rating: restRating,
          restaurant_comment: restComment.trim() || null,
          courier_rating: courierRating,
          courier_comment: courierComment.trim() || null,
        },
        { onConflict: 'order_id,customer_id' }
      );

      if (error) {
        console.error('[Review] submit failed:', error.message);
        throw new Error(error.message);
      }

      // The restaurant and courier averages are recomputed by the
      // refresh_review_ratings() database trigger (a customer session cannot
      // update public.restaurants or public.couriers), so just re-read here.
      setReviewSubmitted(true);
      await fetchOrderDetails();
    } catch {
      setReviewError(
        'We could not save your review just now. Please check your connection and try again.'
      );
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const getStepStatus = (stepKey: string) => {
    if (!order) return 'upcoming';
    const status = order.status;

    if (stepKey === 'RESTAURANT_PENDING') return 'completed';

    if (stepKey === 'PREPARING') {
      if (['PREPARING', 'READY_FOR_PICKUP', 'COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'COMPLETED'].includes(status)) {
        return status === 'PREPARING' ? 'active' : 'completed';
      }
      return 'upcoming';
    }

    if (stepKey === 'READY_FOR_PICKUP') {
      if (['READY_FOR_PICKUP', 'COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'COMPLETED'].includes(status)) {
        return status === 'READY_FOR_PICKUP' ? 'active' : 'completed';
      }
      return 'upcoming';
    }

    if (stepKey === 'ON_THE_WAY') {
      if (['PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'COMPLETED'].includes(status)) {
        return ['PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(status) ? 'active' : 'completed';
      }
      return 'upcoming';
    }

    if (stepKey === 'DELIVERED') {
      return ['DELIVERED', 'COMPLETED'].includes(status) ? 'completed' : 'upcoming';
    }

    return 'upcoming';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 max-w-3xl mx-auto space-y-6">
        <div className="h-8 bg-slate-200 rounded w-1/3 animate-pulse" />
        <div className="h-40 bg-slate-200 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Order not found</h2>
          <Link
            to="/orders"
            className="mt-4 inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
          >
            Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  const isDelivered = ['DELIVERED', 'COMPLETED'].includes(order.status);
  const isCancelled = ['CANCELLED', 'REJECTED', 'FAILED'].includes(order.status);

  // "Updated …" reports the freshest GPS the page has seen — whichever of the
  // two live sources (the couriers row ping or the delivery_locations
  // breadcrumb) is newer — so the label never lies about a moving courier.
  const newestPingAt = Math.max(
    lastLocation ? new Date(lastLocation.recorded_at).getTime() : 0,
    courierDetails?.current_location_updated_at
      ? new Date(courierDetails.current_location_updated_at).getTime()
      : 0
  );
  const lastPingAge =
    newestPingAt > 0 ? Math.floor((Date.now() - newestPingAt) / 60000) : null;

  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Back Link & Header */}
        <div className="flex items-center justify-between">
          <Link
            to="/orders"
            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>My Orders</span>
          </Link>

          <span
            className={`text-xs font-black uppercase tracking-wider px-3 py-1 rounded-xl shadow-xs ${
              isDelivered
                ? 'bg-emerald-600 text-white'
                : isCancelled
                ? 'bg-rose-600 text-white'
                : 'bg-amber-500 text-white animate-pulse'
            }`}
          >
            {order.status.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Real-time Order Alert Banner (Bolt/Yango ride style) */}
        {soundAlertBanner && (
          <div
            className={`p-4 sm:p-5 rounded-3xl text-white shadow-xl flex items-center justify-between gap-4 border animate-in fade-in slide-in-from-top-4 ${
              soundAlertBanner.type === 'DELIVERED'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-800 border-emerald-400'
                : soundAlertBanner.type === 'ARRIVED'
                ? 'bg-gradient-to-r from-amber-500 via-orange-600 to-slate-900 border-amber-400'
                : 'bg-gradient-to-r from-sky-600 via-indigo-600 to-slate-900 border-sky-400'
            }`}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-white/15 text-white flex items-center justify-center flex-shrink-0 backdrop-blur-xs ring-1 ring-white/20">
                <Bell className="w-6 h-6 animate-bounce" />
              </div>
              <div className="min-w-0">
                <h3 className="font-extrabold text-sm sm:text-base">
                  {soundAlertBanner.title}
                </h3>
                <p className="text-xs text-white/90 mt-0.5 leading-snug">
                  {soundAlertBanner.message}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSoundAlertBanner(null)}
              className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition flex-shrink-0"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Reorder landed here — proof the new order is live, not queued */}
        {showReorderNote && reorderNote && (
          <div className="p-4 sm:p-5 rounded-3xl bg-emerald-50 border border-emerald-200 shadow-xs flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-emerald-900">Your reorder is live</h3>
                <p className="text-xs text-emerald-800/90 mt-0.5 leading-snug">
                  Order re-placed from #{reorderNote.from}. The kitchen sees it straight away —
                  the status below updates without refreshing.
                </p>
                {reorderNote.skipped.length > 0 && (
                  <p className="text-xs font-bold text-amber-700 mt-1.5">
                    Left out (no longer available): {reorderNote.skipped.join(', ')}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowReorderNote(false)}
              className="p-2 rounded-xl text-emerald-700/60 hover:text-emerald-900 hover:bg-emerald-100 transition flex-shrink-0"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Live Order Banner */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Order Tracking
              </span>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                Order #{order.order_number}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Kitchen: <span className="font-bold text-emerald-700">{order.restaurant?.name}</span>
              </p>
              <div className="pt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowLiveMapModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs shadow-xs transition"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Live Map</span>
                </button>
                {(isDelivered || isCancelled) && (
                  <ReorderButton order={order} className="px-3.5 py-1.5 text-xs" />
                )}
                <TestRingBellButton
                  tone="customer"
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  iconClassName="text-emerald-600"
                />
              </div>
            </div>

            <div className="text-left sm:text-right">
              <span className="text-xs text-slate-400 block">Total Paid</span>
              <span className="text-xl font-black text-emerald-700">
                {formatGHS(order.total_amount)}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Method: {order.payment_method}
              </span>
            </div>
          </div>

          {/* Stepper Progress */}
          <div className="py-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              Realtime Order Progress
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {STATUS_STEPS.map((step) => {
                const statusState = getStepStatus(step.key);
                return (
                  <div
                    key={step.key}
                    className={`p-3 rounded-2xl border transition-all ${
                      statusState === 'completed'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : statusState === 'active'
                        ? 'bg-amber-50 border-amber-400 text-amber-900 shadow-sm ring-2 ring-amber-400/30'
                        : 'bg-slate-50 border-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {statusState === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      ) : (
                        <div
                          className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            statusState === 'active' ? 'bg-amber-500 animate-ping' : 'bg-slate-300'
                          }`}
                        />
                      )}
                      <span className="text-xs font-bold truncate">{step.label}</span>
                    </div>
                    <p className="text-[10px] leading-tight line-clamp-2">{step.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Real GPS Courier Live Breadcrumb & Courier Details */}
          {order.courier_id && (
            <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border border-slate-200/80 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    src={courierDetails?.profile?.avatar_url || order.courier?.avatar_url}
                    name={order.courier?.full_name || courierDetails?.profile?.full_name}
                    sizeClassName="w-10 h-10"
                    shapeClassName="rounded-xl"
                    className="shadow-md ring-2 ring-white"
                    fallback={<Bike className="w-5 h-5" />}
                  />
                  <div>
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
                      Assigned SamleyGo Courier
                    </span>
                    <h4 className="font-bold text-sm text-slate-900">
                      {order.courier?.full_name || 'Delivery Partner'}
                    </h4>
                    {/* Live courier rating — refreshed by the reviews trigger */}
                    {Number(courierDetails?.rating || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-amber-600">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        {Number(courierDetails?.rating).toFixed(1)}
                        <span className="font-bold text-slate-400">· courier rating</span>
                      </span>
                    )}
                    <p className="text-xs text-slate-500">
                      Vehicle: {courierDetails?.vehicle_type || 'Motorcycle'} {courierDetails?.vehicle_plate ? `(${courierDetails.vehicle_plate})` : ''}
                    </p>
                  </div>
                </div>

                {order.courier?.phone && (
                  <a
                    href={`tel:${order.courier.phone}`}
                    className="flex items-center gap-1 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 px-3.5 py-2 rounded-xl shadow-xs transition"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call Courier</span>
                  </a>
                )}
              </div>

              {/* Live Tracking Map — courier position updates in realtime */}
              {(() => {
                const showMap =
                  ['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(order.status) ||
                  (['DELIVERED', 'COMPLETED'].includes(order.status) && lastLocation);
                if (!showMap) return null;

                // Prefer the freshest of breadcrumb vs live couriers-row ping
                const breadcrumbTime = lastLocation
                  ? new Date(lastLocation.recorded_at).getTime()
                  : 0;
                const courierRowTime = courierDetails?.current_location_updated_at
                  ? new Date(courierDetails.current_location_updated_at).getTime()
                  : 0;

                const courierPosition =
                  courierDetails?.current_latitude && courierDetails?.current_longitude && courierRowTime >= breadcrumbTime
                    ? { lat: courierDetails.current_latitude, lng: courierDetails.current_longitude }
                    : lastLocation
                    ? { lat: lastLocation.latitude, lng: lastLocation.longitude }
                    : courierDetails?.current_latitude && courierDetails?.current_longitude
                    ? { lat: courierDetails.current_latitude, lng: courierDetails.current_longitude }
                    : null;

                const destination =
                  order.delivery_latitude && order.delivery_longitude
                    ? { lat: order.delivery_latitude, lng: order.delivery_longitude }
                    : null;

                const pickup =
                  order.restaurant?.latitude && order.restaurant?.longitude
                    ? { lat: order.restaurant.latitude, lng: order.restaurant.longitude }
                    : null;

                const hasAnyPin = courierPosition || destination || pickup;

                return (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 border-b border-slate-100 flex-wrap">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                        <Navigation className="w-4 h-4 text-emerald-600" />
                        <span>Live Tracking</span>
                        {courierPosition && (
                          <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Live
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {lastPingAge !== null && (
                          <span className="text-[10px] text-slate-400">
                            {lastPingAge < 1 ? 'Updated just now' : `Updated ${lastPingAge} min ago`}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowLiveMapModal(true)}
                          className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          <span>Live Map</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsInlineMapHidden(!isInlineMapHidden)}
                          className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs flex items-center gap-1 transition"
                          title={isInlineMapHidden ? 'Show live map on page' : 'Hide map from page'}
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
                      </div>
                    </div>

                    {!isInlineMapHidden ? (
                      hasAnyPin ? (
                        <CourierLiveMap
                          courierPosition={courierPosition}
                          status={order.status}
                          destination={destination}
                          destinationAddress={order.delivery_address}
                          pickup={pickup}
                          pickupAddress={
                            order.restaurant
                              ? `${order.restaurant.address}, ${order.restaurant.city}`
                              : undefined
                          }
                          courierName={order.courier?.full_name}
                          className="h-64 sm:h-72"
                        />
                      ) : (
                        <div className="p-6 text-center text-xs text-slate-500">
                          Waiting for the first GPS ping from your courier…
                        </div>
                      )
                    ) : (
                      <div className="p-4 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <EyeOff className="w-4 h-4 text-slate-400" />
                          <span>Map hidden. Live delivery updates are running in realtime.</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowLiveMapModal(true)}
                            className="font-bold text-emerald-600 hover:text-emerald-700"
                          >
                            Open Live Map
                          </button>
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
                );
              })()}
            </div>
          )}
        </div>

        {/* Order Details & Summary Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Dishes Ordered */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
              <Receipt className="w-4 h-4 text-emerald-600" />
              <span>Items Ordered</span>
            </h3>

            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-900">{item.quantity}x </span>
                    <span className="text-slate-800">{item.item_name}</span>
                    {item.notes && (
                      <p className="text-[11px] text-slate-400 italic">Note: {item.notes}</p>
                    )}
                  </div>
                  <span className="font-bold text-slate-800">{formatGHS(item.subtotal)}</span>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Food subtotal</span>
                <span>{formatGHS(order.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery distance</span>
                <span>{formatDistanceKm(order.delivery_distance_km)}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery fee</span>
                <span>{formatGHS(order.delivery_fee)}</span>
              </div>
              {order.tip > 0 && (
                <div className="flex justify-between">
                  <span>Courier Tip</span>
                  <span>{formatGHS(order.tip)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-sm text-slate-900 pt-1.5 border-t border-slate-100">
                <span>Total</span>
                <span className="text-emerald-700">{formatGHS(order.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Delivery Address & Status History */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span>Delivery Destination</span>
              </h3>
              <p className="text-xs font-medium text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                {order.delivery_address}
              </p>
              {order.delivery_notes && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  <strong className="text-slate-700">Gate Notes:</strong> {order.delivery_notes}
                </p>
              )}
            </div>

            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                <span>Status Log</span>
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="text-[11px] bg-slate-50 p-2 rounded-lg flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-800">{h.status.replace(/_/g, ' ')}</span>
                      {h.note && <p className="text-slate-500">{h.note}</p>}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      {new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Real Review & Rating Section (When Order is Delivered) */}
        {isDelivered && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              <h3 className="text-base font-bold text-slate-900">
                Rate Your SamleyGo Experience
              </h3>
            </div>

            {reviewSubmitted ? (
              <div className="space-y-3">
                <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-900 text-xs font-semibold flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Thank you! Your verified review has been recorded in the database.</span>
                </div>

                {/* The stored stars for the kitchen and the courier */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                      Kitchen rating
                    </span>
                    <span className="text-sm font-extrabold text-slate-800 mt-1 block">
                      {order.restaurant?.name} · {restRating}/5 ★
                    </span>
                    {restComment.trim() && (
                      <p className="text-xs text-slate-500 mt-1 break-words">
                        “{restComment.trim()}”
                      </p>
                    )}
                  </div>

                  {order.courier_id && (
                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                        Courier rating
                      </span>
                      <span className="text-sm font-extrabold text-slate-800 mt-1 block">
                        {order.courier?.full_name || 'Your courier'} · {courierRating}/5 ★
                      </span>
                      {courierComment.trim() && (
                        <p className="text-xs text-slate-500 mt-1 break-words">
                          “{courierComment.trim()}”
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitReview} className="space-y-5">
                {/* Restaurant Rating */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    How was the food from {order.restaurant?.name}?
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRestRating(star)}
                        className="p-1 text-amber-400 hover:scale-110 transition"
                      >
                        <Star
                          className={`w-6 h-6 ${
                            star <= restRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="text-xs font-bold text-slate-600 ml-2">{restRating}/5</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Comments about the taste, packaging, freshness..."
                    value={restComment}
                    onChange={(e) => setRestComment(e.target.value)}
                    className="mt-2 w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Courier Rating */}
                {order.courier_id && (
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      How was the delivery by {order.courier?.full_name}?
                    </label>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setCourierRating(star)}
                          className="p-1 text-amber-400 hover:scale-110 transition"
                        >
                          <Star
                            className={`w-6 h-6 ${
                              star <= courierRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                            }`}
                          />
                        </button>
                      ))}
                      <span className="text-xs font-bold text-slate-600 ml-2">{courierRating}/5</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Delivery speed, courier politeness..."
                      value={courierComment}
                      onChange={(e) => setCourierComment(e.target.value)}
                      className="mt-2 w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                )}

                {/* Never claim success on a failed save — say so plainly. */}
                {reviewError && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                    {reviewError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmittingReview}
                  className="py-2.5 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition disabled:opacity-50"
                >
                  {isSubmittingReview ? 'Submitting Review...' : 'Submit Verified Review'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Customer Live Delivery Map Modal */}
        <LiveDeliveryMapModal
          isOpen={showLiveMapModal}
          onClose={() => setShowLiveMapModal(false)}
          orderNumber={order?.order_number}
          status={order?.status}
          courierPosition={
            courierDetails?.current_latitude && courierDetails?.current_longitude
              ? { lat: courierDetails.current_latitude, lng: courierDetails.current_longitude }
              : lastLocation?.latitude && lastLocation?.longitude
              ? { lat: lastLocation.latitude, lng: lastLocation.longitude }
              : null
          }
          pickup={
            order?.restaurant?.latitude && order?.restaurant?.longitude
              ? { lat: order.restaurant.latitude, lng: order.restaurant.longitude }
              : null
          }
          pickupName={order?.restaurant?.name}
          pickupAddress={
            order?.restaurant
              ? `${order.restaurant.address}, ${order.restaurant.city}`
              : undefined
          }
          destination={
            order?.delivery_latitude && order?.delivery_longitude
              ? { lat: order.delivery_latitude, lng: order.delivery_longitude }
              : null
          }
          destinationName={order?.customer?.full_name || 'Your Address'}
          destinationAddress={order?.delivery_address}
          courierName={order?.courier?.full_name || 'Assigned Courier'}
          courierPhoto={
            courierDetails?.profile?.avatar_url || order?.courier?.avatar_url || null
          }
          courierPhone={order?.courier?.phone}
          customerPhone={order?.customer_phone}
          lastPingAgeMinutes={lastPingAge}
          role="CUSTOMER"
        />

      </div>
    </div>
  );
};
