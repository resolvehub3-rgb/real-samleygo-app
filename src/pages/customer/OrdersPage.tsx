import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, ChevronRight, Clock, MapPin, AlertCircle, Navigation } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Order, Profile } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { formatGHS } from '../../lib/pricing';
import { LiveDeliveryMapModal } from '../../components/common/LiveDeliveryMapModal';
import { ReorderButton } from '../../components/common/ReorderButton';
import { TestRingBellButton } from '../../components/common/TestRingBellButton';
import { playCustomerSound, playCustomerStatusAlert } from '../../lib/soundAlerts';

export const OrdersPage: React.FC = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mapOrder, setMapOrder] = useState<Order | null>(null);
  const [mapCourierPos, setMapCourierPos] = useState<{ lat: number; lng: number } | null>(null);
  // Last status we alerted about per order, so a chime fires exactly once per
  // transition. payload.old is unreliable (REPLICA IDENTITY default only ships
  // the primary key), so the realtime handler compares against this instead.
  const lastAlertedStatusRef = useRef<Record<string, string>>({});
  /** Epoch ms of the last courier position applied to the open map (stale-guard). */
  const lastAppliedPosAtRef = useRef(0);

  // Live GPS courier tracking for the opened map modal on Orders list
  useEffect(() => {
    if (!mapOrder?.courier_id || !isSupabaseConfigured) {
      setMapCourierPos(null);
      return;
    }

    let isMounted = true;
    // Epoch ms of the last position drawn. Realtime can arrive late or replay
    // (socket reconnects, delayed inserts), so anything older than this is
    // dropped — the marker never rides backwards.
    lastAppliedPosAtRef.current = 0;

    const applyPosition = (
      lat: number,
      lng: number,
      at?: string | number | null
    ): void => {
      if (!isMounted) return;
      const ts =
        typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : Number.NaN;
      if (Number.isFinite(ts)) {
        if (ts < lastAppliedPosAtRef.current) return;
        lastAppliedPosAtRef.current = ts;
      }
      setMapCourierPos({ lat, lng });
    };

    // Fetch initial courier location
    supabase
      .from('couriers')
      .select('current_latitude, current_longitude, current_location_updated_at')
      .eq('id', mapOrder.courier_id)
      .maybeSingle() // no courier row yet → null, not HTTP 406
      .then(({ data }) => {
        if (data?.current_latitude && data?.current_longitude) {
          applyPosition(
            data.current_latitude,
            data.current_longitude,
            data.current_location_updated_at ?? null
          );
        }
      });

    // Listen to courier live movements in realtime
    const channel = supabase
      .channel(`modal-courier-track-${mapOrder.courier_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'couriers',
          filter: `id=eq.${mapOrder.courier_id}`,
        },
        (payload) => {
          const next = payload.new as {
            current_latitude?: number | null;
            current_longitude?: number | null;
            current_location_updated_at?: string | null;
          };
          if (next.current_latitude != null && next.current_longitude != null) {
            applyPosition(
              next.current_latitude,
              next.current_longitude,
              next.current_location_updated_at ?? null
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'delivery_locations',
          filter: `courier_id=eq.${mapOrder.courier_id}`,
        },
        (payload) => {
          const loc = payload.new as {
            latitude?: number;
            longitude?: number;
            recorded_at?: string | null;
          };
          if (loc.latitude != null && loc.longitude != null) {
            applyPosition(loc.latitude, loc.longitude, loc.recorded_at ?? null);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${mapOrder.courier_id}`,
        },
        (payload) => {
          // Rider updated their photo/name — refresh the open modal live
          const next = payload.new as Partial<Profile>;
          if (!isMounted || !next?.id) return;
          setMapOrder((prev) => {
            if (!prev || !prev.courier || prev.courier_id !== next.id) return prev;
            return { ...prev, courier: { ...prev.courier, ...next } as Profile };
          });
        }
      )
      .subscribe(() => {
        // Quiet: profiles realtime is a bonus; the order list refresh covers it
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [mapOrder?.courier_id]);

  const fetchOrders = async () => {
    if (!user || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, restaurant:restaurants(*), courier:profiles!orders_courier_id_fkey(*)')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setOrders(data as Order[]);

        // Remember the statuses already on screen (so an order that is
        // mid-flight when the page opens never replays a chime), while
        // keeping anything alerted since the previous fetch.
        const known: Record<string, string> = {};
        data.forEach((row) => {
          if (row.status) known[row.id] = row.status;
        });
        lastAlertedStatusRef.current = { ...known, ...lastAlertedStatusRef.current };
      }
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();

    // Realtime subscription to customer's orders
    if (user && isSupabaseConfigured) {
      const channel = supabase
        .channel(`customer-orders-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `customer_id=eq.${user.id}`,
          },
          (payload) => {
            const newOrder = payload.new as Order | undefined;

            if (payload.eventType === 'UPDATE' && newOrder?.id && newOrder.status) {
              const previous = lastAlertedStatusRef.current[newOrder.id];

              if (previous !== newOrder.status) {
                // Record first so a refetch landing mid-flight cannot replay it.
                lastAlertedStatusRef.current[newOrder.id] = newOrder.status;

                if (newOrder.status === 'PICKED_UP') {
                  // Courier started the trip — customer-sound.mp3 three times.
                  playCustomerSound(3);
                } else if (newOrder.status === 'DELIVERED' || newOrder.status === 'COMPLETED') {
                  // Completed rings three times, once per order: DELIVERED and
                  // COMPLETED are two milestones of the same celebration.
                  if (previous !== 'DELIVERED' && previous !== 'COMPLETED') {
                    playCustomerSound(3);
                  }
                } else {
                  // Kitchen milestones ("New Incoming", "In Cooking",
                  // "Ready / Dispatched") and courier arrival. Statuses
                  // without an alert are a silent no-op.
                  playCustomerStatusAlert(newOrder.status);
                }
              }
            }

            fetchOrders();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200 shadow-xs">
          <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Sign in to view orders</h2>
          <p className="text-xs text-slate-500 mt-1">
            Sign in to track your food preparation and live courier delivery status.
          </p>
          <Link
            to="/login?redirect=/orders"
            className="mt-6 inline-block w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              My Orders
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Live updates and order history in Ghana
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TestRingBellButton
              tone="customer"
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs"
              iconClassName="text-emerald-600"
            />
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl">
              {orders.length} {orders.length === 1 ? 'Order' : 'Orders'}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs animate-pulse space-y-3">
                <div className="h-4 bg-slate-200 rounded w-1/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          /* Real Data Empty State */
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-md mx-auto my-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No orders yet</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              You haven&apos;t placed any orders yet. Discover delicious Ghanaian meals and place your first order!
            </p>
            <Link
              to="/restaurants"
              className="mt-6 inline-block px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition"
            >
              Order Food Now
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const isActive = ![
                'DELIVERED',
                'COMPLETED',
                'CANCELLED',
                'REJECTED',
                'FAILED',
              ].includes(order.status);

              return (
                <Link
                  key={order.id}
                  to={`/orders/${order.id}`}
                  className="block bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:border-emerald-500/50 hover:shadow-md transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-slate-900">
                          #{order.order_number}
                        </span>
                        <span
                          className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                            isActive
                              ? 'bg-amber-500 text-white animate-pulse'
                              : order.status === 'COMPLETED' || order.status === 'DELIVERED'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {order.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <h4 className="font-bold text-sm text-slate-800 mt-1">
                        {order.restaurant?.name || 'Local Kitchen'}
                      </h4>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="font-black text-sm text-emerald-700 block">
                        {formatGHS(order.total_amount)}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(order.created_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 truncate max-w-xs sm:max-w-md">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="truncate">{order.delivery_address}</span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isActive && (
                        <ReorderButton order={order} className="px-2.5 py-1 text-[11px]" />
                      )}
                      {isActive && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMapOrder(order);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-[11px] flex items-center gap-1 shadow-xs transition"
                        >
                          <Navigation className="w-3 h-3" />
                          <span>Live Map</span>
                        </button>
                      )}
                      <div className="flex items-center gap-1 text-emerald-700 font-bold">
                        <span>{isActive ? 'Track Live' : 'View Details'}</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Live Delivery Map Modal */}
        {mapOrder && (
          <LiveDeliveryMapModal
            isOpen={Boolean(mapOrder)}
            onClose={() => setMapOrder(null)}
            orderNumber={mapOrder.order_number}
            status={mapOrder.status}
            courierPosition={mapCourierPos}
            pickup={
              mapOrder.restaurant?.latitude && mapOrder.restaurant?.longitude
                ? { lat: mapOrder.restaurant.latitude, lng: mapOrder.restaurant.longitude }
                : null
            }
            pickupName={mapOrder.restaurant?.name}
            pickupAddress={
              mapOrder.restaurant
                ? `${mapOrder.restaurant.address}, ${mapOrder.restaurant.city}`
                : undefined
            }
            destination={
              mapOrder.delivery_latitude && mapOrder.delivery_longitude
                ? { lat: mapOrder.delivery_latitude, lng: mapOrder.delivery_longitude }
                : null
            }
            destinationName={mapOrder.customer?.full_name || 'Delivery Address'}
            destinationAddress={mapOrder.delivery_address}
            courierName={mapOrder.courier?.full_name || 'Assigned Courier'}
            courierPhoto={mapOrder.courier?.avatar_url || null}
            customerPhone={mapOrder.customer_phone}
            role="CUSTOMER"
          />
        )}
      </div>
    </div>
  );
};
