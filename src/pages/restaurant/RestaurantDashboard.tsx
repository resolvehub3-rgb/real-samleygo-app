import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChefHat,
  Clock,
  CheckCircle,
  TrendingUp,
  Store,
  Bike,
  Bell,
  AlertCircle,
  X,
  Sparkles,
  Star,
  Inbox,
  Navigation,
  EyeOff,
  Eye,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Restaurant, Order } from '../../types/database';
import { formatGHS } from '../../lib/pricing';
import { RestaurantShell } from '../../components/restaurant/RestaurantShell';
import { CourierLiveMap, LatLng } from '../../components/courier/CourierLiveMap';
import { haversineKm } from '../../lib/routing';
import { LiveDeliveryMapModal } from '../../components/common/LiveDeliveryMapModal';
import { playRestaurantOrderAlert } from '../../lib/soundAlerts';

// "3 min ago" style helper for order cards
function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Status pill colors used across order cards
function statusChipClass(status: string) {
  switch (status) {
    case 'RESTAURANT_PENDING':
      return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200';
    case 'PREPARING':
      return 'bg-sky-100 text-sky-800 ring-1 ring-sky-200';
    case 'READY_FOR_PICKUP':
      return 'bg-orange-100 text-orange-800 ring-1 ring-orange-200';
    case 'COURIER_ASSIGNED':
    case 'COURIER_ACCEPTED':
    case 'PICKED_UP':
    case 'ON_THE_WAY':
    case 'ARRIVED':
      return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200';
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
  }
}

export const RestaurantDashboard: React.FC = () => {
  const { user, role, isLoading: isAuthLoading } = useAuth();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED'>('PENDING');
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingOpenStatus, setIsUpdatingOpenStatus] = useState(false);

  // Live courier GPS positions for dispatched orders, keyed by courier id.
  // Seeded from the couriers table and updated via realtime.
  const [courierPositions, setCourierPositions] = useState<
    Record<string, { lat: number; lng: number; updatedAt?: string; name?: string; phone?: string }>
  >({});
  const [selectedMapOrder, setSelectedMapOrder] = useState<Order | null>(null);

  // Realtime alerts & Driver assignment
  const [newOrderAlert, setNewOrderAlert] = useState<string | null>(null);
  const [assignDriverOrder, setAssignDriverOrder] = useState<Order | null>(null);
  const [availableCouriers, setAvailableCouriers] = useState<any[]>([]);
  const [isLoadingCouriers, setIsLoadingCouriers] = useState(false);
  const [assigningCourierId, setAssigningCourierId] = useState<string | null>(null);

  // New restaurant registration form state
  const [name, setName] = useState('');
  const [cuisineType, setCuisineType] = useState('Jollof & Fried Rice');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Accra');
  const [isRegistering, setIsRegistering] = useState(false);

  const fetchRestaurantAndOrders = async () => {
    // SUPER_ADMIN has no restaurant of their own — skip the owner query so the
    // admin hand-off screen below is shown immediately instead of a register form.
    if (role === 'SUPER_ADMIN') {
      setIsLoading(false);
      return;
    }

    if (!user || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch restaurant owned by this user
      const { data: restData } = await supabase
        .from('restaurants')
        .select('*')
        .eq('owner_id', user.id)
        .limit(1)
        .maybeSingle(); // zero rows → null (an owner without a restaurant is normal)

      if (restData) {
        setRestaurant(restData as Restaurant);

        // 2. Fetch orders for this restaurant
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*, order_items(*), customer:profiles!orders_customer_id_fkey(*), courier:profiles!orders_courier_id_fkey(*)')
          .eq('restaurant_id', restData.id)
          .order('created_at', { ascending: false });

        if (ordersData) {
          setOrders(ordersData as Order[]);
        }

        // 3. Fetch live positions of couriers assigned to active orders
        const activeOrderRows = (ordersData as Order[]).filter((o) =>
          ['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(o.status)
        );
        const courierIds = Array.from(
          new Set(activeOrderRows.map((o) => o.courier_id).filter(Boolean) as string[])
        );

        if (courierIds.length > 0) {
          const { data: courierRows } = await supabase
            .from('couriers')
            .select('id, current_latitude, current_longitude, current_location_updated_at, profile:profiles(id, full_name, phone)')
            .in('id', courierIds);

          if (courierRows) {
            setCourierPositions(
              Object.fromEntries(
                courierRows
                  .filter((c) => c.current_latitude != null && c.current_longitude != null)
                  .map((c) => [
                    c.id,
                    {
                      lat: c.current_latitude as number,
                      lng: c.current_longitude as number,
                      updatedAt: c.current_location_updated_at as string | undefined,
                      name: (c.profile as { full_name?: string } | null)?.full_name,
                      phone: (c.profile as { phone?: string } | null)?.phone,
                    },
                  ])
              )
            );
          }
        } else {
          setCourierPositions({});
        }
      }
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRestaurantAndOrders();

    if (!user || !isSupabaseConfigured || role === 'SUPER_ADMIN') return;

    // Realtime subscription for incoming orders + live courier GPS
    const channel = supabase
      .channel(`restaurant-orders-live-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          fetchRestaurantAndOrders();
          if (payload.eventType === 'INSERT') {
            playRestaurantOrderAlert();
            setNewOrderAlert(`🔔 New Order #${(payload.new as Order)?.order_number || 'Incoming'} received in real-time!`);
            setTimeout(() => setNewOrderAlert(null), 8000);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'couriers' },
        (payload) => {
          // Live courier GPS ping — update the position map without a refetch
          const next = payload.new as {
            id: string;
            current_latitude?: number | null;
            current_longitude?: number | null;
            current_location_updated_at?: string;
          };
          if (next.current_latitude != null && next.current_longitude != null) {
            setCourierPositions((prev) => ({
              ...prev,
              [next.id]: {
                lat: next.current_latitude as number,
                lng: next.current_longitude as number,
                updatedAt: next.current_location_updated_at,
                name: prev[next.id]?.name,
                phone: prev[next.id]?.phone,
              },
            }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'delivery_locations' },
        (payload) => {
          const loc = payload.new as {
            courier_id: string;
            latitude: number;
            longitude: number;
            recorded_at: string;
          };
          if (loc?.courier_id && loc?.latitude != null && loc?.longitude != null) {
            setCourierPositions((prev) => ({
              ...prev,
              [loc.courier_id]: {
                lat: loc.latitude,
                lng: loc.longitude,
                updatedAt: loc.recorded_at,
                name: prev[loc.courier_id]?.name,
                phone: prev[loc.courier_id]?.phone,
              },
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, role]);

  // Background refresh — realtime is push-only, so if the websocket drops the
  // pipeline and live courier positions would freeze. Re-read every 45 s while
  // the dashboard tab is visible; silently skipped while hidden.
  const fetchRestaurantAndOrdersRef = useRef(fetchRestaurantAndOrders);
  useEffect(() => {
    fetchRestaurantAndOrdersRef.current = fetchRestaurantAndOrders;
  });

  useEffect(() => {
    if (!user || !isSupabaseConfigured || role === 'SUPER_ADMIN') return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      fetchRestaurantAndOrdersRef.current();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [user?.id, role]);

  // Open / Close Toggle (optimistic UI, shared via RestaurantShell sidebar)
  const toggleOpen = async () => {
    if (!restaurant || isUpdatingOpenStatus) return;
    const newStatus = !restaurant.is_open;
    setIsUpdatingOpenStatus(true);
    setRestaurant({ ...restaurant, is_open: newStatus });
    await supabase
      .from('restaurants')
      .update({ is_open: newStatus })
      .eq('id', restaurant.id);
    setIsUpdatingOpenStatus(false);
  };

  // Order Actions
  const handleUpdateOrderStatus = async (
    orderId: string,
    status: 'PREPARING' | 'READY_FOR_PICKUP' | 'REJECTED'
  ) => {
    if (!user) return;
    try {
      await supabase
        .from('orders')
        .update({ status })
        .eq('id', orderId);

      await supabase.from('order_status_history').insert({
        order_id: orderId,
        status,
        note:
          status === 'PREPARING'
            ? 'Kitchen accepted order and started preparing food.'
            : status === 'READY_FOR_PICKUP'
            ? 'Kitchen finished cooking. Food is packed and ready for courier pickup.'
            : 'Kitchen was unable to fulfill order at this time.',
        changed_by: user.id,
      });

      // If marked READY, notify online couriers
      if (status === 'READY_FOR_PICKUP') {
        const { data: onlineCouriers } = await supabase
          .from('couriers')
          .select('id')
          .eq('is_online', true)
          .eq('is_approved', true);

        if (onlineCouriers && onlineCouriers.length > 0) {
          const notifs = onlineCouriers.map((c) => ({
            user_id: c.id,
            title: '🛵 Food Ready for Pickup!',
            message: `Pickup order at ${restaurant?.name}. Delivery fee + tip waiting.`,
            type: 'DELIVERY_REQUEST',
            link: '/courier/dashboard',
          }));
          await supabase.from('notifications').insert(notifs);
        }
      }

      fetchRestaurantAndOrders();
    } catch {
      // Handled
    }
  };

  // Open driver assignment modal & load active couriers
  const handleOpenAssignDriverModal = async (order: Order) => {
    setAssignDriverOrder(order);
    setIsLoadingCouriers(true);
    try {
      const { data: couriersData } = await supabase
        .from('couriers')
        .select(
          'id, vehicle_type, vehicle_plate, is_approved, is_online, availability_status, total_deliveries, rating, profile:profiles(id, full_name, avatar_url, phone)'
        )
        .eq('is_online', true);

      if (couriersData && couriersData.length > 0) {
        setAvailableCouriers(couriersData);
      } else {
        // Fallback: load any registered couriers if none currently flagged online
        const { data: allCouriers } = await supabase
          .from('couriers')
          .select(
            'id, vehicle_type, vehicle_plate, is_approved, is_online, availability_status, total_deliveries, rating, profile:profiles(id, full_name, avatar_url, phone)'
          )
          .limit(10);
        setAvailableCouriers(allCouriers || []);
      }
    } catch {
      setAvailableCouriers([]);
    } finally {
      setIsLoadingCouriers(false);
    }
  };

  // Assign live courier to order
  const handleAssignCourier = async (courierId: string, courierName: string) => {
    if (!user || !assignDriverOrder) return;
    setAssigningCourierId(courierId);

    try {
      // Update order to COURIER_ASSIGNED
      await supabase
        .from('orders')
        .update({
          courier_id: courierId,
          status: 'COURIER_ASSIGNED',
        })
        .eq('id', assignDriverOrder.id);

      // Record status transition
      await supabase.from('order_status_history').insert({
        order_id: assignDriverOrder.id,
        status: 'COURIER_ASSIGNED',
        note: `Kitchen assigned live driver: ${courierName}.`,
        changed_by: user.id,
      });

      // Send immediate notification to courier
      await supabase.from('notifications').insert({
        user_id: courierId,
        title: '🛵 Order Assigned to You!',
        message: `Direct delivery assigned: Order #${assignDriverOrder.order_number} from ${restaurant?.name}.`,
        type: 'DELIVERY_REQUEST',
        link: '/courier/dashboard',
      });

      setAssignDriverOrder(null);
      fetchRestaurantAndOrders();
    } catch {
      // Handled
    } finally {
      setAssigningCourierId(null);
    }
  };

  // Create restaurant if owner has none yet
  const handleRegisterRestaurant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsRegistering(true);

    try {
      const { data, error } = await supabase
        .from('restaurants')
        .insert({
          owner_id: user.id,
          name: name.trim(),
          cuisine_type: cuisineType,
          phone: phone.trim(),
          address: address.trim(),
          city: city.trim(),
          is_approved: true, // auto approve
          is_open: true,
          rating: 5.0,
          total_reviews: 0,
        })
        .select()
        .maybeSingle();

      if (!error && data) {
        setRestaurant(data as Restaurant);
      }
    } catch {
      // Handled
    } finally {
      setIsRegistering(false);
    }
  };  if (isLoading || isAuthLoading) {
    return (
      <RestaurantShell restaurant={null}>
        <div className="p-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto space-y-5 sm:space-y-6">
          {/* Hero skeleton */}
          <div className="h-40 sm:h-44 rounded-3xl bg-gradient-to-br from-slate-200 to-slate-100 animate-pulse" />
          {/* Stat cards skeleton */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-200/70 animate-pulse" />
            ))}
          </div>
          {/* Orders panel skeleton */}
          <div className="rounded-3xl bg-white border border-slate-200 p-5 sm:p-6">
            <div className="h-10 w-64 max-w-full rounded-full bg-slate-200 animate-pulse" />
            <div className="mt-5 h-32 rounded-2xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      </RestaurantShell>
    );
  }

  // SUPER_ADMIN landed here (e.g. via a stale role or a shared link): offer the
  // correct console instead of the restaurant registration form.
  if (role === 'SUPER_ADMIN' && !restaurant) {
    return (
      <RestaurantShell restaurant={null}>
        <div className="flex items-center justify-center p-4 py-10">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200 shadow-sm space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Super Admin Console</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              You are signed in as a platform super admin, so there is no kitchen to
              register here. Manage restaurants, couriers and orders from the admin console.
            </p>
            <Link
              to="/admin/dashboard"
              className="inline-block px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition"
            >
              Go to Admin Dashboard
            </Link>
          </div>
        </div>
      </RestaurantShell>
    );
  }

  // Registration prompt if no restaurant registered
  if (!restaurant) {
    return (
      <RestaurantShell restaurant={null}>
        <div className="py-6 sm:py-10 px-4 pb-28">
          <div className="max-w-4xl mx-auto overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md md:grid md:grid-cols-[0.85fr_1.15fr]">

          {/* Brand Panel (side on desktop, top band on mobile) */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#02472d] via-emerald-800 to-emerald-900 p-6 sm:p-8 text-white">
            <div className="absolute -top-14 -right-14 w-48 h-48 rounded-full bg-[#fd6902]/25 blur-3xl" aria-hidden="true" />
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
                <Store className="w-6 h-6 text-emerald-300" />
              </div>
              <h1 className="mt-4 text-xl sm:text-2xl font-black leading-tight">
                Register Your Restaurant
              </h1>
              <p className="mt-2 text-xs sm:text-sm text-emerald-100/90 leading-relaxed">
                Set up your Ghanaian kitchen to receive orders from nearby customers and dispatch live couriers.
              </p>
              <div className="mt-6 space-y-2.5 hidden md:block">
                {[
                  'Live order alerts with sound',
                  'Direct courier assignment',
                  'Menu manager included',
                ].map(( perk ) => (
                  <div key={perk} className="flex items-center gap-2 text-xs font-semibold text-emerald-50">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />
                    <span>{perk}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Registration Form */}
          <div className="p-6 sm:p-8">
            <form onSubmit={handleRegisterRestaurant} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Restaurant Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Accra Buka Kitchen"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Primary Cuisine</label>
                <select
                  value={cuisineType}
                  onChange={(e) => setCuisineType(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                >
                  <option value="Jollof & Fried Rice">Jollof &amp; Fried Rice</option>
                  <option value="Waakye Special">Waakye Special</option>
                  <option value="Banku & Tilapia">Banku &amp; Tilapia</option>
                  <option value="Fufu & Light Soup">Fufu &amp; Light Soup</option>
                  <option value="Kelewele & Street Food">Kelewele &amp; Street Food</option>
                  <option value="Continental & Pastries">Continental &amp; Pastries</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Kitchen Phone</label>
                  <input
                    type="tel"
                    required
                    placeholder="024 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">City</label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Address / Landmark</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Osu Oxford Street, Accra"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                />
              </div>

              <button
                type="submit"
                disabled={isRegistering}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-extrabold text-xs shadow-md transition active:scale-[0.98] disabled:opacity-50"
              >
                {isRegistering ? 'Registering...' : 'Launch Kitchen on SamleyGo'}
              </button>
            </form>
          </div>
        </div>
        </div>
      </RestaurantShell>
    );
  }

  // Filter orders by active tab
  const pendingOrders = orders.filter((o) => o.status === 'RESTAURANT_PENDING');
  const preparingOrders = orders.filter((o) => o.status === 'PREPARING');
  const readyOrders = orders.filter((o) =>
    ['READY_FOR_PICKUP', 'COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(o.status)
  );
  const completedOrders = orders.filter((o) => ['DELIVERED', 'COMPLETED'].includes(o.status));
  const liveDispatches = orders.filter((o) =>
    ['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(o.status) ||
    Boolean(o.courier_id && !['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(o.status))
  );

  // Financial calculations
  const totalRevenue = completedOrders.reduce((sum, o) => sum + o.subtotal, 0);

  const tabs: { key: typeof activeTab; label: string; count: number; activeClass: string }[] = [
    { key: 'PENDING', label: 'New Incoming', count: pendingOrders.length, activeClass: 'bg-amber-500 text-white shadow-xs' },
    { key: 'PREPARING', label: 'In Cooking', count: preparingOrders.length, activeClass: 'bg-sky-600 text-white shadow-xs' },
    { key: 'READY', label: 'Ready / Dispatched', count: readyOrders.length, activeClass: 'bg-emerald-600 text-white shadow-xs' },
    { key: 'COMPLETED', label: 'Completed', count: completedOrders.length, activeClass: 'bg-slate-900 text-white shadow-xs' },
  ];

  return (
    <RestaurantShell
      restaurant={restaurant}
      onToggleOpen={toggleOpen}
      isUpdatingOpenStatus={isUpdatingOpenStatus}
    >

      {/* Realtime Alert Banner */}
      {newOrderAlert && (
        <div className="sticky top-14 lg:top-6 z-30 bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-600 text-white px-4 py-3 shadow-lg animate-in fade-in slide-in-from-top-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-black min-w-0">
              <Bell className="w-4 h-4 animate-bounce flex-shrink-0" />
              <span className="truncate">{newOrderAlert}</span>
            </div>
            <button
              onClick={() => setActiveTab('PENDING')}
              className="px-3 py-1.5 bg-white text-slate-900 rounded-lg text-xs font-black hover:bg-amber-100 transition flex-shrink-0"
            >
              View Incoming
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5 sm:space-y-6">

        {/* Hero Status Card — cover photo from Settings, logo chip, status pill */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#02472d] via-emerald-800 to-emerald-900 p-5 sm:p-7 text-white shadow-lg min-h-[168px] flex items-end">
          {restaurant.cover_url && (
            <img
              src={restaurant.cover_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-black/10" aria-hidden="true" />
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-[#fd6902]/20 blur-3xl" aria-hidden="true" />

          <div className="relative w-full flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-xs flex items-center justify-center overflow-hidden flex-shrink-0">
                {restaurant.logo_url ? (
                  <img src={restaurant.logo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ChefHat className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-300" />
                )}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-emerald-300/90 uppercase tracking-widest block">
                  Restaurant Partner Console
                </span>
                <h1 className="text-lg sm:text-2xl font-black leading-tight truncate">
                  {restaurant.name}
                </h1>
                <p className="text-[11px] sm:text-xs text-emerald-100/80 truncate">
                  {restaurant.cuisine_type} · {restaurant.address}, {restaurant.city}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex items-center gap-2 flex-wrap sm:justify-end">
                <button
                  type="button"
                  onClick={() => playRestaurantOrderAlert()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-white/15 hover:bg-white/25 active:scale-95 text-emerald-100 ring-1 ring-white/20 transition backdrop-blur-xs"
                  title="Test professional restaurant ringing bell alert"
                >
                  <Bell className="w-3.5 h-3.5 text-amber-300" />
                  <span>Test Ring Bell</span>
                </button>
                <span
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider ring-1 ${
                    restaurant.is_open
                      ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30'
                      : 'bg-rose-400/15 text-rose-200 ring-rose-300/30'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${restaurant.is_open ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                  {restaurant.is_open ? 'Kitchen Open' : 'Kitchen Closed'}
                </span>
              </div>
              <p className="hidden sm:block text-[10px] text-emerald-100/60">
                Open/Close, menu & photos live in the sidebar →
              </p>
            </div>
          </div>
        </div>

        {/* Real Metrics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <TrendingUp className="w-4.5 h-4.5" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Total Sales
            </span>
            <span className="text-xl sm:text-2xl font-black text-emerald-700 block mt-0.5">
              {formatGHS(totalRevenue)}
            </span>
            <span className="text-[10px] text-slate-400 mt-1.5 block">
              From {completedOrders.length} completed orders
            </span>
          </div>

          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition">
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center mb-3">
              <Clock className="w-4.5 h-4.5" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Kitchen Queue
            </span>
            <span className="text-xl sm:text-2xl font-black text-amber-500 block mt-0.5">
              {pendingOrders.length + preparingOrders.length}
            </span>
            <span className="text-[10px] text-slate-400 mt-1.5 block">
              {pendingOrders.length} new · {preparingOrders.length} cooking
            </span>
          </div>

          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <CheckCircle className="w-4.5 h-4.5" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Deliveries Done
            </span>
            <span className="text-xl sm:text-2xl font-black text-slate-900 block mt-0.5">
              {completedOrders.length}
            </span>
            <span className="text-[10px] text-slate-400 mt-1.5 block">
              All-time completed deliveries
            </span>
          </div>

          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition">
            <div className="w-9 h-9 rounded-xl bg-orange-50 text-[#fd6902] flex items-center justify-center mb-3">
              <Star className="w-4.5 h-4.5" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Customer Rating
            </span>
            <span className="text-xl sm:text-2xl font-black text-slate-900 block mt-0.5">
              {restaurant.rating ?? '—'}
              <span className="text-amber-500 text-sm"> ★</span>
            </span>
            <span className="text-[10px] text-slate-400 mt-1.5 block">
              {restaurant.total_reviews} customer reviews
            </span>
          </div>
        </div>

        {/* Live Dispatches & Moving Couriers Tracker Banner */}
        {liveDispatches.length > 0 && (
          <div className="bg-emerald-950 text-white rounded-3xl p-5 border border-emerald-800 shadow-md space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                  <Navigation className="w-4 h-4 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-black tracking-tight">
                      Live Dispatches &amp; Moving Couriers
                    </h2>
                    <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      {liveDispatches.length} Moving Live
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-300/80">
                    Realtime courier movements assigned to your kitchen orders
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {liveDispatches.map((dispatch) => {
                const pos = dispatch.courier_id ? courierPositions[dispatch.courier_id] : null;
                const isHeadingToKitchen =
                  dispatch.status === 'COURIER_ASSIGNED' ||
                  dispatch.status === 'COURIER_ACCEPTED' ||
                  dispatch.status === 'PREPARING' ||
                  dispatch.status === 'READY_FOR_PICKUP';
                const distToKitchen =
                  pos && restaurant?.latitude && restaurant?.longitude
                    ? haversineKm(pos, { lat: restaurant.latitude, lng: restaurant.longitude })
                    : null;
                const distToCustomer =
                  pos && dispatch.delivery_latitude && dispatch.delivery_longitude
                    ? haversineKm(pos, { lat: dispatch.delivery_latitude, lng: dispatch.delivery_longitude })
                    : null;

                return (
                  <div
                    key={dispatch.id}
                    className="p-3.5 rounded-2xl bg-emerald-900/60 border border-emerald-700/60 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-white">#{dispatch.order_number}</span>
                        <span className="text-[10px] font-bold text-emerald-200 uppercase bg-emerald-800/80 px-2 py-0.5 rounded">
                          {dispatch.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-emerald-100 font-semibold truncate text-[11px]">
                        🛵 {dispatch.courier?.full_name || 'Courier'} &rarr; {dispatch.customer?.full_name || 'Customer'}
                      </p>
                      <p className="text-[10px] text-emerald-300/90 font-medium">
                        {isHeadingToKitchen
                          ? `Moving to kitchen ${distToKitchen !== null ? `(${distToKitchen.toFixed(1)} km away)` : ''}`
                          : `Delivering to customer ${distToCustomer !== null ? `(${distToCustomer.toFixed(1)} km to drop-off)` : ''}`}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedMapOrder(dispatch)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-sm transition flex-shrink-0"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>Live Map</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Orders Pipeline Tabs */}
        <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-xs space-y-5">

          {/* Segmented Tab Control */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-full text-xs font-bold transition flex-shrink-0 whitespace-nowrap ${
                  activeTab === tab.key
                    ? tab.activeClass
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`min-w-[20px] px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                    activeTab === tab.key ? 'bg-white/25 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Tab Orders Content */}
          <div className="space-y-4">
            {activeTab === 'PENDING' && (
              pendingOrders.length === 0 ? (
                <TabEmptyState
                  icon={Inbox}
                  title="No new orders waiting"
                  hint="Incoming orders arrive automatically in real time — you'll hear a chime!"
                />
              ) : (
                pendingOrders.map((order) => (
                  <RestaurantOrderCard
                    key={order.id}
                    order={order}
                    onAccept={() => handleUpdateOrderStatus(order.id, 'PREPARING')}
                    onReject={() => handleUpdateOrderStatus(order.id, 'REJECTED')}
                    actionType="PENDING"
                  />
                ))
              )
            )}

            {activeTab === 'PREPARING' && (
              preparingOrders.length === 0 ? (
                <TabEmptyState
                  icon={ChefHat}
                  title="No dishes currently in preparation"
                  hint="Accept a new order to start cooking."
                />
              ) : (
                preparingOrders.map((order) => (
                  <RestaurantOrderCard
                    key={order.id}
                    order={order}
                    onMarkReady={() => handleUpdateOrderStatus(order.id, 'READY_FOR_PICKUP')}
                    onAssignDriver={() => handleOpenAssignDriverModal(order)}
                    actionType="PREPARING"
                    courierPosition={
                      order.courier_id ? courierPositions[order.courier_id] ?? null : null
                    }
                    courierName={order.courier?.full_name}
                    pickup={
                      restaurant?.latitude && restaurant?.longitude
                        ? { lat: restaurant.latitude, lng: restaurant.longitude }
                        : null
                    }
                    pickupAddress={
                      restaurant ? `${restaurant.address}, ${restaurant.city}` : undefined
                    }
                    onOpenLiveMap={() => setSelectedMapOrder(order)}
                  />
                ))
              )
            )}

            {activeTab === 'READY' && (
              readyOrders.length === 0 ? (
                <TabEmptyState
                  icon={Bike}
                  title="Nothing waiting for pickup"
                  hint="Orders you mark Ready will appear here while couriers are dispatched."
                />
              ) : (
                readyOrders.map((order) => (
                  <RestaurantOrderCard
                    key={order.id}
                    order={order}
                    onAssignDriver={() => handleOpenAssignDriverModal(order)}
                    actionType="READY"
                    courierPosition={
                      order.courier_id ? courierPositions[order.courier_id] ?? null : null
                    }
                    courierName={order.courier?.full_name}
                    pickup={
                      restaurant?.latitude && restaurant?.longitude
                        ? { lat: restaurant.latitude, lng: restaurant.longitude }
                        : null
                    }
                    pickupAddress={
                      restaurant ? `${restaurant.address}, ${restaurant.city}` : undefined
                    }
                    onOpenLiveMap={() => setSelectedMapOrder(order)}
                  />
                ))
              )
            )}

            {activeTab === 'COMPLETED' && (
              completedOrders.length === 0 ? (
                <TabEmptyState
                  icon={CheckCircle}
                  title="No completed deliveries yet"
                  hint="Successfully delivered orders will show up here."
                />
              ) : (
                completedOrders.map((order) => (
                  <RestaurantOrderCard
                    key={order.id}
                    order={order}
                    actionType="COMPLETED"
                    onOpenLiveMap={() => setSelectedMapOrder(order)}
                  />
                ))
              )
            )}
          </div>
        </div>

      </div>

      {/* Assign Live Driver Modal */}
      {assignDriverOrder && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-xs p-0 sm:p-4"
          onClick={() => setAssignDriverOrder(null)}
        >
          <div
            className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-2xl space-y-4 max-h-[85dvh] overflow-y-auto animate-in fade-in slide-in-from-bottom-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                  <Bike className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 text-sm sm:text-base">
                    Assign Live Courier
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">
                    Order #{assignDriverOrder.order_number} · {assignDriverOrder.delivery_address}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAssignDriverOrder(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 transition flex-shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isLoadingCouriers ? (
              <div className="py-12 text-center space-y-3">
                <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Scanning for live couriers online...</p>
              </div>
            ) : availableCouriers.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
                <h4 className="text-sm font-bold text-slate-800">No Online Couriers Detected</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  No drivers are currently online. Couriers will see this order in their available pool once marked Ready for Pickup.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Available Online Riders
                </span>
                {availableCouriers.map((c) => {
                  const driverName = c.profile?.full_name || 'Registered Courier';
                  const driverPhone = c.profile?.phone || 'Ghana Driver';
                  const isAssigning = assigningCourierId === c.id;

                  return (
                    <div
                      key={c.id}
                      className="p-3 sm:p-3.5 rounded-2xl border border-slate-200/90 hover:border-emerald-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 hover:bg-white transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-xs flex-shrink-0">
                          <Bike className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                              {driverName}
                            </span>
                            {c.is_online && (
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500 block truncate">
                            {c.vehicle_type || 'Motorcycle'} · {driverPhone} · {c.total_deliveries || 0} trips
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleAssignCourier(c.id, driverName)}
                        disabled={isAssigning}
                        className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-xs transition disabled:opacity-50 active:scale-95 flex-shrink-0 w-full sm:w-auto"
                      >
                        {isAssigning ? 'Assigning...' : 'Assign Driver'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Delivery Map Modal for Restaurant */}
      {selectedMapOrder && (
        <LiveDeliveryMapModal
          isOpen={Boolean(selectedMapOrder)}
          onClose={() => setSelectedMapOrder(null)}
          orderNumber={selectedMapOrder.order_number}
          status={selectedMapOrder.status}
          courierPosition={
            selectedMapOrder.courier_id
              ? courierPositions[selectedMapOrder.courier_id] ?? null
              : null
          }
          pickup={
            restaurant?.latitude && restaurant?.longitude
              ? { lat: restaurant.latitude, lng: restaurant.longitude }
              : null
          }
          pickupName={restaurant?.name || 'Your Kitchen'}
          pickupAddress={
            restaurant
              ? `${restaurant.address}, ${restaurant.city}`
              : undefined
          }
          destination={
            selectedMapOrder.delivery_latitude && selectedMapOrder.delivery_longitude
              ? { lat: selectedMapOrder.delivery_latitude, lng: selectedMapOrder.delivery_longitude }
              : null
          }
          destinationName={selectedMapOrder.customer?.full_name || 'Customer'}
          destinationAddress={selectedMapOrder.delivery_address}
          courierName={selectedMapOrder.courier?.full_name || 'Assigned Courier'}
          courierPhone={
            selectedMapOrder.courier_id
              ? courierPositions[selectedMapOrder.courier_id]?.phone
              : undefined
          }
          customerPhone={selectedMapOrder.customer_phone}
          role="RESTAURANT"
        />
      )}

    </RestaurantShell>
  );
};

// Empty state for pipeline tabs
const TabEmptyState: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}> = ({ icon: Icon, title, hint }) => (
  <div className="py-12 px-4 text-center flex flex-col items-center gap-2">
    <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
      <Icon className="w-6 h-6" />
    </div>
    <p className="text-sm font-bold text-slate-600">{title}</p>
    <p className="text-xs text-slate-400 max-w-xs">{hint}</p>
  </div>
);

// Reusable Kitchen Order Card Component
interface OrderCardProps {
  order: Order;
  actionType: 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED';
  onAccept?: () => void;
  onReject?: () => void;
  onMarkReady?: () => void;
  onAssignDriver?: () => void;
  onOpenLiveMap?: () => void;
  /** Live GPS fix of the assigned courier (null = no fix yet) */
  courierPosition?: LatLng | null;
  courierName?: string;
  /** Restaurant pickup coordinates for the map pin */
  pickup?: LatLng | null;
  /** Restaurant address — geocoded for the pin when coordinates are missing */
  pickupAddress?: string;
}

const ACCENT: Record<OrderCardProps['actionType'], string> = {
  PENDING: 'bg-amber-400',
  PREPARING: 'bg-sky-500',
  READY: 'bg-orange-500',
  COMPLETED: 'bg-emerald-500',
};

const RestaurantOrderCard: React.FC<OrderCardProps> = ({
  order,
  actionType,
  onAccept,
  onReject,
  onMarkReady,
  onAssignDriver,
  onOpenLiveMap,
  courierPosition,
  courierName,
  pickup,
  pickupAddress,
}) => {
  const [isCardMapHidden, setIsCardMapHidden] = useState(false);

  return (
    <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden hover:shadow-md transition">
      {/* Status accent stripe */}
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${ACCENT[actionType]}`} aria-hidden="true" />

      <div className="p-4 sm:p-5 pl-5 sm:pl-6 space-y-4">

        {/* Card Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-sm text-slate-900">#{order.order_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${statusChipClass(order.status)}`}>
                {order.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-600 mt-1">
              {order.customer?.full_name || 'Customer'}
              <span className="text-slate-300 mx-1.5">·</span>
              <span className="text-slate-400 font-medium">{timeAgo(order.created_at)}</span>
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5 truncate">
              Deliver to: {order.delivery_address}
            </p>
          </div>

          <div className="text-left sm:text-right flex-shrink-0">
            <span className="font-black text-base text-emerald-700 block">
              {formatGHS(order.subtotal)}
            </span>
            <span className="text-[10px] text-slate-400 font-medium">
              Paid via {order.payment_method}
            </span>
          </div>
        </div>

        {/* Items List */}
        <div className="space-y-2">
          {order.order_items?.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="mt-0.5 min-w-[22px] h-[22px] px-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-black flex items-center justify-center flex-shrink-0">
                  {item.quantity}x
                </span>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-slate-800 break-words">{item.item_name}</span>
                  {item.notes && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-1">
                      ✏️ {item.notes}
                    </p>
                  )}
                </div>
              </div>
              <span className="text-xs font-bold text-slate-600 flex-shrink-0">{formatGHS(item.subtotal)}</span>
            </div>
          ))}
        </div>

        {/* Courier Status indicator if assigned (+ live map on dispatched cards) */}
        {order.courier && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2 text-xs flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Bike className="w-4 h-4 text-emerald-700 flex-shrink-0" />
                <span className="font-bold text-emerald-900 truncate">
                  Courier: {order.courier.full_name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {onOpenLiveMap && (
                  <button
                    type="button"
                    onClick={onOpenLiveMap}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-[11px] flex items-center gap-1 shadow-xs transition"
                  >
                    <Navigation className="w-3 h-3" />
                    <span>Live Map</span>
                  </button>
                )}
                {Boolean(
                  ['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(order.status) ||
                  (order.courier_id && !['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(order.status))
                ) && (
                  <button
                    type="button"
                    onClick={() => setIsCardMapHidden(!isCardMapHidden)}
                    className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-emerald-300 text-slate-700 font-bold text-[11px] flex items-center gap-1 transition"
                    title={isCardMapHidden ? 'Show live map on card' : 'Hide map on card'}
                  >
                    {isCardMapHidden ? (
                      <>
                        <Eye className="w-3 h-3 text-slate-500" />
                        <span>Show Map</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3 h-3 text-slate-500" />
                        <span>Hide Map</span>
                      </>
                    )}
                  </button>
                )}
                <span className="text-[10px] font-bold text-emerald-700 uppercase flex-shrink-0">
                  {order.status.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            {/* Live courier moves for dispatched orders */}
            {Boolean(
              ['COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(order.status) ||
              (order.courier_id && !['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(order.status))
            ) && (
              <>
                {/* Movement direction readout */}
                {(() => {
                  const isHeadingToKitchen =
                    order.status === 'COURIER_ASSIGNED' ||
                    order.status === 'COURIER_ACCEPTED' ||
                    order.status === 'PREPARING' ||
                    order.status === 'READY_FOR_PICKUP';
                  const distToKitchen =
                    courierPosition && pickup ? haversineKm(courierPosition, pickup) : null;
                  const distToCustomer =
                    courierPosition && order.delivery_latitude && order.delivery_longitude
                      ? haversineKm(courierPosition, {
                          lat: order.delivery_latitude,
                          lng: order.delivery_longitude,
                        })
                      : null;

                  return (
                    <div
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-[11px] border ${
                        isHeadingToKitchen
                          ? 'bg-amber-50/80 border-amber-200 text-amber-900'
                          : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 font-bold">
                        <Navigation
                          className={`w-3.5 h-3.5 animate-pulse ${
                            isHeadingToKitchen ? 'text-amber-600' : 'text-emerald-600'
                          }`}
                        />
                        <span>
                          {isHeadingToKitchen
                            ? '🛵 Courier is moving to your kitchen for pickup'
                            : '🛵 Courier is delivering food to customer'}
                        </span>
                      </span>
                      {isHeadingToKitchen && distToKitchen !== null ? (
                        <span className="font-black text-amber-800">
                          {distToKitchen.toFixed(1)} km away
                        </span>
                      ) : !isHeadingToKitchen && distToCustomer !== null ? (
                        <span className="font-black text-emerald-800">
                          {distToCustomer.toFixed(1)} km to drop-off
                        </span>
                      ) : (
                        <span className="text-slate-400 font-medium">Tracking live</span>
                      )}
                    </div>
                  );
                })()}

                {!isCardMapHidden ? (
                  <CourierLiveMap
                    courierPosition={courierPosition ?? null}
                    status={order.status}
                    destination={
                      order.delivery_latitude && order.delivery_longitude
                        ? { lat: order.delivery_latitude, lng: order.delivery_longitude }
                        : null
                    }
                    destinationAddress={order.delivery_address}
                    pickup={pickup ?? null}
                    pickupAddress={pickupAddress}
                    courierName={courierName ?? order.courier.full_name}
                    className="h-56 sm:h-64"
                  />
                ) : (
                  <div className="py-2.5 px-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                      <span>Card map hidden. Courier moves are tracking in background.</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCardMapHidden(false)}
                      className="font-bold text-emerald-600 hover:text-emerald-700 underline text-[11px]"
                    >
                      Show Map
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          {actionType === 'PENDING' && (
            <>
              <button
                onClick={onAccept}
                className="w-full sm:w-auto sm:flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition active:scale-[0.98]"
              >
                Accept &amp; Start Preparing
              </button>
              <button
                onClick={onReject}
                className="w-full sm:w-auto py-2.5 px-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-xs transition active:scale-[0.98]"
              >
                Decline Order
              </button>
            </>
          )}

          {actionType === 'PREPARING' && (
            <>
              <button
                onClick={onMarkReady}
                className="w-full sm:w-auto sm:flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition active:scale-[0.98]"
              >
                Mark Food READY
              </button>
              <button
                onClick={onAssignDriver}
                className="w-full sm:w-auto py-2.5 px-4 rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-bold text-xs transition flex items-center justify-center gap-1.5 active:scale-[0.98]"
              >
                <Bike className="w-4 h-4" />
                <span>Assign Live Driver</span>
              </button>
            </>
          )}

          {actionType === 'READY' && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
              <span className="text-xs text-slate-500">
                {order.courier ? `Assigned to ${order.courier.full_name}` : 'Awaiting courier pickup...'}
              </span>
              {!order.courier && onAssignDriver && (
                <button
                  onClick={onAssignDriver}
                  className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5 active:scale-[0.98]"
                >
                  <Bike className="w-4 h-4" />
                  <span>Assign Live Driver</span>
                </button>
              )}
            </div>
          )}

          {actionType === 'COMPLETED' && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 font-bold">
              <CheckCircle className="w-4 h-4" />
              <span>Order delivered successfully</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
