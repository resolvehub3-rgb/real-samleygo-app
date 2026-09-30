import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  MapPin,
  Clock,
  Star,
  ChevronRight,
  Sparkles,
  ShoppingBag,
  Store,
  Navigation,
  X,
  Check,
  Zap,
  Bike,
  Plus,
  Utensils,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  Flame,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Restaurant, Order, MenuItem } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { formatGHS } from '../../lib/pricing';
import { isGeolocationAvailable } from '../../lib/geolocation';
import {
  persistDeliverTo,
  persistLiveTracking,
  readDeliverTo,
  readLiveTracking,
} from '../../lib/deliverTo';
import { useLiveLocationLabel } from '../../hooks/useLiveLocationLabel';
import { PWAInstallButton } from '../../components/common/PWAInstallButton';

export interface SearchMenuItem extends MenuItem {
  restaurant?: Restaurant;
}

const GHANA_CUISINES = [
  { name: 'All', icon: '🍽️', keyword: '' },
  { name: 'Jollof & Fried Rice', icon: '🍛', keyword: 'jollof' },
  { name: 'Waakye Special', icon: '🍱', keyword: 'waakye' },
  { name: 'Banku & Tilapia', icon: '🐟', keyword: 'banku' },
  { name: 'Fufu & Light Soup', icon: '🍲', keyword: 'fufu' },
  { name: 'Kelewele & Plantain', icon: '🍌', keyword: 'kelewele' },
  { name: 'Kenkey & Fried Fish', icon: '🌽', keyword: 'kenkey' },
  { name: 'Grills & Shawarma', icon: '🌯', keyword: 'shawarma' },
  { name: 'Continental & Pastries', icon: '🥐', keyword: 'pastry' },
  { name: 'Fresh Juices & Drinks', icon: '🥤', keyword: 'sobolo' },
];

const POPULAR_LOCATIONS = [
  'East Legon, Accra',
  'Osu Oxford Street, Accra',
  'Airport Residential Area, Accra',
  'Cantonments, Accra',
  'Spintex Road, Accra',
  'Labone, Accra',
  'Tema Community 1, Greater Accra',
  'Adum, Kumasi',
  'Ahodwo, Kumasi',
];

const QUICK_SEARCH_SUGGESTIONS = [
  'Jollof Rice',
  'Waakye',
  'Banku & Tilapia',
  'Grilled Chicken',
  'Kelewele',
  'Shawarma',
  'Fufu',
  'Fried Plantain',
  'Sobolo',
];

function getCuisineEmoji(name: string, description?: string): string {
  const text = `${name} ${description || ''}`.toLowerCase();
  if (text.includes('jollof') || text.includes('fried rice') || text.includes('rice')) return '🍛';
  if (text.includes('waakye')) return '🍱';
  if (text.includes('banku') || text.includes('tilapia') || text.includes('fish') || text.includes('salmon')) return '🐟';
  if (text.includes('fufu') || text.includes('soup') || text.includes('goat') || text.includes('groundnut')) return '🍲';
  if (text.includes('kelewele') || text.includes('plantain') || text.includes('red red')) return '🍌';
  if (text.includes('kenkey') || text.includes('shito')) return '🌽';
  if (text.includes('shawarma') || text.includes('grill') || text.includes('khebab') || text.includes('suya')) return '🌯';
  if (text.includes('chicken') || text.includes('wings') || text.includes('turkey')) return '🍗';
  if (text.includes('juice') || text.includes('sobolo') || text.includes('drink') || text.includes('smoothie')) return '🥤';
  if (text.includes('pastry') || text.includes('pie') || text.includes('cake') || text.includes('bread')) return '🥐';
  if (text.includes('burger')) return '🍔';
  if (text.includes('pizza')) return '🍕';
  return '🍽️';
}

export const HomePage: React.FC = () => {
  const { user } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search query from URL or state
  const initialQuery = searchParams.get('q') || searchParams.get('search') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedCuisine, setSelectedCuisine] = useState('All');

  // Database records
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantsMap, setRestaurantsMap] = useState<Record<string, Restaurant>>({});
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);

  // Realtime fresh-dishes feed shown on the default homepage (no search needed)
  const [freshDishes, setFreshDishes] = useState<SearchMenuItem[]>([]);
  const [isLoadingDishes, setIsLoadingDishes] = useState(true);

  // Realtime search results
  const [foodResults, setFoodResults] = useState<SearchMenuItem[]>([]);
  const [restaurantResults, setRestaurantResults] = useState<Restaurant[]>([]);
  const [isSearchingFood, setIsSearchingFood] = useState(false);
  const [searchTab, setSearchTab] = useState<'all' | 'dishes' | 'restaurants'>('all');

  // Realtime toast & indicator states
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);
  const [realtimePulse, setRealtimePulse] = useState(false);
  const [addedToast, setAddedToast] = useState<string | null>(null);

  // Location selector state — seeded from the customer's own last choice (or
  // from nothing at all): a refresh must never fall back to a fabricated
  // default address such as "East Legon, Accra".
  const [locationName, setLocationName] = useState<string>(readDeliverTo);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  /** Friendly, inline copy for a failed fix — never an alert, never coords. */
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Live device position: resolves to a place NAME (never "GPS: 5.5, -0.2")
  // and keeps refreshing it in realtime while the customer moves.
  const liveLocation = useLiveLocationLabel();
  const [isUsingDeviceLocation, setIsUsingDeviceLocation] = useState(false);
  /** True only between pressing "Use Current Device Location" and the first fix. */
  const awaitingFixRef = useRef(false);
  /** Dedupes the inline location error (the same message never repeats). */
  const geoErrorSeenRef = useRef<string | null>(null);
  /** Did this device already have a saved delivery place on first paint? */
  const hadSavedPlaceRef = useRef(readDeliverTo() !== '');
  /** The "use your current location" prompt fires at most once per visit. */
  const autoPromptedRef = useRef(false);

  // Ref to trigger latest search without stale closures in realtime listener
  const latestSearchTermRef = useRef(searchQuery);
  const latestCuisineRef = useRef(selectedCuisine);
  latestSearchTermRef.current = searchQuery;
  latestCuisineRef.current = selectedCuisine;

  // 1. Fetch approved restaurants and active orders from Supabase
  const loadApprovedRestaurants = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .eq('is_approved', true)
        .order('is_open', { ascending: false })
        .order('rating', { ascending: false });

      if (!error && data) {
        setRestaurants(data as Restaurant[]);
        const map: Record<string, Restaurant> = {};
        (data as Restaurant[]).forEach((r) => {
          map[r.id] = r;
        });
        setRestaurantsMap(map);
      }

      // Check active orders for authenticated customer
      if (user) {
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*, restaurant:restaurants(*)')
          .eq('customer_id', user.id)
          .in('status', [
            'RESTAURANT_ACCEPTED',
            'PREPARING',
            'READY_FOR_PICKUP',
            'COURIER_ASSIGNED',
            'COURIER_ACCEPTED',
            'PICKED_UP',
            'ON_THE_WAY',
            'ARRIVED',
          ])
          .order('created_at', { ascending: false })
          .limit(1);

        if (ordersData && ordersData.length > 0) {
          setActiveOrders(ordersData as Order[]);
        }
      }
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // 1b. Load the latest dishes from approved restaurants for the default homepage feed
  const loadFreshDishes = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoadingDishes(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*, restaurant:restaurants(*)')
        .order('is_available', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(12);

      if (error) throw error;

      const processed: SearchMenuItem[] = [];
      for (const item of (data || []) as SearchMenuItem[]) {
        const rest = item.restaurant || restaurantsMap[item.restaurant_id];
        // Only surface dishes that belong to an approved kitchen
        if (rest && rest.is_approved) {
          processed.push({ ...item, restaurant: rest });
        }
      }
      setFreshDishes(processed);
    } catch {
      // Keep previous dishes on transient errors
    } finally {
      setIsLoadingDishes(false);
    }
  }, [restaurantsMap]);

  // Initial load
  useEffect(() => {
    loadApprovedRestaurants();
  }, [loadApprovedRestaurants]);

  // Initial dish feed load (re-runs when the approved-restaurants map is ready)
  useEffect(() => {
    loadFreshDishes();
  }, [loadFreshDishes]);

  // 2. Realtime Food & Restaurant Search Core Function
  const executeRealtimeSearch = useCallback(
    async (queryText: string, cuisineName: string) => {
      const trimmed = queryText.trim();
      const hasCuisineFilter = cuisineName !== 'All';

      // If user cleared search and no cuisine filter, reset live search results
      if (!trimmed && !hasCuisineFilter) {
        setFoodResults([]);
        setRestaurantResults([]);
        setIsSearchingFood(false);
        return;
      }

      if (!isSupabaseConfigured) {
        setIsSearchingFood(false);
        return;
      }

      setIsSearchingFood(true);

      try {
        // Query dishes from menu_items table in Supabase
        let dishQuery = supabase
          .from('menu_items')
          .select('*, restaurant:restaurants(*)')
          .order('is_available', { ascending: false })
          .limit(40);

        if (trimmed) {
          // Search dish name or description in realtime
          dishQuery = dishQuery.or(
            `name.ilike.%${trimmed}%,description.ilike.%${trimmed}%`
          );
        }

        // Query restaurants from restaurants table in Supabase
        let restQuery = supabase
          .from('restaurants')
          .select('*')
          .eq('is_approved', true)
          .order('is_open', { ascending: false })
          .limit(20);

        if (trimmed) {
          restQuery = restQuery.or(
            `name.ilike.%${trimmed}%,cuisine_type.ilike.%${trimmed}%,address.ilike.%${trimmed}%`
          );
        }

        if (hasCuisineFilter) {
          const selectedObj = GHANA_CUISINES.find((c) => c.name === cuisineName);
          const keyword = selectedObj?.keyword || cuisineName.split(' ')[0];
          restQuery = restQuery.ilike('cuisine_type', `%${keyword}%`);

          // If no text query, filter dishes matching this cuisine category
          if (!trimmed && keyword) {
            dishQuery = dishQuery.or(`name.ilike.%${keyword}%,description.ilike.%${keyword}%`);
          }
        }

        const [dishesRes, restRes] = await Promise.all([dishQuery, restQuery]);

        if (dishesRes.data) {
          // Filter to dishes from approved restaurants and assign restaurant fallback if needed
          const processedDishes: SearchMenuItem[] = [];
          for (const item of dishesRes.data as SearchMenuItem[]) {
            const rest = item.restaurant || restaurantsMap[item.restaurant_id];
            if (!rest || rest.is_approved) {
              processedDishes.push({
                ...item,
                restaurant: rest,
              });
            }
          }
          setFoodResults(processedDishes);
        } else {
          setFoodResults([]);
        }

        if (restRes.data) {
          setRestaurantResults(restRes.data as Restaurant[]);
        } else {
          setRestaurantResults([]);
        }
      } catch {
        // Handled gracefully
      } finally {
        setIsSearchingFood(false);
      }
    },
    [restaurantsMap]
  );

  // Debounced search trigger as user types in realtime
  useEffect(() => {
    const timer = setTimeout(() => {
      executeRealtimeSearch(searchQuery, selectedCuisine);
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedCuisine, executeRealtimeSearch]);

  // Keep searchParams in URL in sync
  useEffect(() => {
    if (searchQuery.trim()) {
      setSearchParams({ q: searchQuery.trim() }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [searchQuery, setSearchParams]);

  // 3. Supabase Realtime Channels: Listen to live changes to menu_items and restaurants
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel('samleygo-realtime-food-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'menu_items' },
        (payload) => {
          setRealtimePulse(true);
          setTimeout(() => setRealtimePulse(false), 2000);

          if (payload.eventType === 'INSERT') {
            setRealtimeNotice('⚡ Realtime: New dish added by partner kitchen!');
          } else if (payload.eventType === 'UPDATE') {
            setRealtimeNotice('⚡ Realtime: Dish details/availability updated!');
          } else {
            setRealtimeNotice('⚡ Realtime: Kitchen menu updated!');
          }
          setTimeout(() => setRealtimeNotice(null), 3500);

          // Re-execute current search AND refresh the homepage dish feed in realtime
          executeRealtimeSearch(latestSearchTermRef.current, latestCuisineRef.current);
          loadFreshDishes();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurants' },
        (payload) => {
          setRealtimePulse(true);
          setTimeout(() => setRealtimePulse(false), 2000);

          if (payload.eventType === 'UPDATE') {
            setRealtimeNotice('⚡ Realtime: Restaurant status updated live!');
            setTimeout(() => setRealtimeNotice(null), 3500);
          }

          loadApprovedRestaurants();
          executeRealtimeSearch(latestSearchTermRef.current, latestCuisineRef.current);
          loadFreshDishes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [executeRealtimeSearch, loadApprovedRestaurants, loadFreshDishes]);

  // 4. Quick Add Food Item to Cart
  const handleAddDishToCart = (e: React.MouseEvent, dish: SearchMenuItem) => {
    e.preventDefault();
    e.stopPropagation();

    const rest = dish.restaurant || restaurantsMap[dish.restaurant_id];
    if (!rest) {
      alert('Restaurant details are loading. Please try again.');
      return;
    }

    if (!dish.is_available) {
      alert(`"${dish.name}" is currently sold out at this kitchen.`);
      return;
    }

    const success = addItem(dish, rest);
    if (success) {
      setAddedToast(`Added "${dish.name}" from ${rest.name} to cart!`);
      setTimeout(() => setAddedToast(null), 3000);
    }
  };

  // Real browser geolocation detection (robust helper with clear errors).
  // Starts a LIVE watch: the "Deliver To" pill then keeps following the
  // device and shows a place name, never raw coordinates. Failures are shown
  // inline inside the picker — never a blocking alert, never coordinates.
  const startLiveLocation = useCallback(async () => {
    if (!isGeolocationAvailable()) {
      setLocationError(
        'Location is unavailable on this page. If you opened the app via a LAN/cable address (http://), open it via https:// or localhost instead.'
      );
      setShowLocationModal(true);
      return;
    }

    setLocationError(null);
    geoErrorSeenRef.current = null;
    awaitingFixRef.current = true;
    setIsDetectingLocation(true);
    setIsUsingDeviceLocation(true);
    persistLiveTracking(true);

    await liveLocation.start();

    setIsDetectingLocation(false);
  }, [liveLocation.start]);

  const handleDetectLocation = () => {
    void startLiveLocation();
  };

  // Follow the live fix in realtime while device location is enabled.
  useEffect(() => {
    if (!isUsingDeviceLocation || !liveLocation.point) return;

    if (liveLocation.label) {
      // Remembered across refreshes, so the pill never falls back to a
      // fabricated default address.
      setLocationName(`📍 ${liveLocation.label}`);
      persistDeliverTo(liveLocation.label);
      setLocationError(null);
    } else {
      setLocationName('📍 Your current location');
    }

    // Dismiss the picker for the press that asked for it — later fixes keep
    // updating the pill without yanking a picker the customer reopened.
    if (awaitingFixRef.current) {
      awaitingFixRef.current = false;
      setShowLocationModal(false);
    }
  }, [isUsingDeviceLocation, liveLocation.point, liveLocation.label]);

  // Surface a location failure as friendly inline copy inside the picker
  // (deduped, never coordinates, never a blocking alert) and keep whatever
  // address the customer already had.
  useEffect(() => {
    const err = liveLocation.error;
    if (!err || geoErrorSeenRef.current === err) return;
    geoErrorSeenRef.current = err;
    awaitingFixRef.current = false;
    setIsDetectingLocation(false);
    setIsUsingDeviceLocation(false);
    persistLiveTracking(false);
    setLocationError(err);
    setShowLocationModal(true);
  }, [liveLocation.error]);

  // First visit (nothing saved yet): offer the device location right away —
  // registered or not, the picker opens and the fix starts on its own. A
  // returning customer keeps their own place; if they had live tracking on,
  // it resumes silently without re-nagging them.
  useEffect(() => {
    if (autoPromptedRef.current || isLoading) return;
    autoPromptedRef.current = true;

    if (hadSavedPlaceRef.current) {
      if (readLiveTracking() && isGeolocationAvailable()) void startLiveLocation();
      return;
    }

    setShowLocationModal(true);
    if (isGeolocationAvailable()) {
      void startLiveLocation();
    } else {
      setLocationError(
        'Location is unavailable on this page. If you opened the app via a LAN/cable address (http://), open it via https:// or localhost instead.'
      );
    }
  }, [isLoading, startLiveLocation]);

  // Determine active search state
  const isSearchActive = Boolean(searchQuery.trim() || selectedCuisine !== 'All');

  // Filter regular restaurants when no search is active
  const filteredHomeRestaurants = restaurants.filter((r) => {
    if (selectedCuisine === 'All') return true;
    return r.cuisine_type.toLowerCase().includes(selectedCuisine.toLowerCase());
  });

  const openCount = restaurants.filter((r) => r.is_open).length;

  return (
    <div className="min-h-screen pb-24 md:pb-12 bg-slate-50">
      
      {/* Realtime Sync Flash Toast */}
      {realtimeNotice && (
        <div className="fixed top-18 right-4 z-50 bg-slate-900/95 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5 border border-emerald-500/40 backdrop-blur-md animate-in fade-in slide-in-from-top-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
          <span>{realtimeNotice}</span>
        </div>
      )}

      {/* Added to Cart Feedback Toast */}
      {addedToast && (
        <div className="fixed top-18 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white text-xs sm:text-sm font-black px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 border border-emerald-400 shadow-emerald-600/30 animate-in fade-in slide-in-from-top-4">
          <Check className="w-4 h-4 stroke-[3]" />
          <span>{addedToast}</span>
        </div>
      )}

      {/* Top Mobile Location Header with Native App Feel */}
      <div className="bg-white border-b border-slate-200/80 px-4 py-2.5 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Location Selector Pill */}
          <button
            onClick={() => setShowLocationModal(true)}
            className="flex items-center gap-2 text-left min-w-0 flex-1 hover:opacity-80 active:scale-[0.99] transition"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                  Deliver To
                </span>
                <span className="text-[9px] text-slate-400">▼</span>
              </div>
              <span
                className={`text-xs font-extrabold truncate block ${
                  locationName ? 'text-slate-800' : 'text-slate-400'
                }`}
              >
                {locationName || 'Choose your location'}
              </span>
              {isUsingDeviceLocation && liveLocation.isWatching && (
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live location
                </span>
              )}
            </div>
          </button>

          {/* Realtime Live Pulse & Install Indicator */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                realtimePulse
                  ? 'bg-emerald-500 text-white border-emerald-400'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
              }`}
              title="Realtime Supabase sync connected"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="hidden sm:inline">
                {isSupabaseConfigured ? 'Realtime Connected' : 'Ready'}
              </span>
              <span className="sm:hidden">{openCount} Live</span>
            </div>
            <PWAInstallButton />
          </div>
        </div>
      </div>

      {/* Ongoing Active Order Alert (if any) */}
      {activeOrders.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-3">
          <div
            onClick={() => navigate(`/orders/${activeOrders[0].id}`)}
            className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-600/20 flex items-center justify-between cursor-pointer hover:opacity-95 active:scale-[0.99] transition"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center animate-pulse">
                <Bike className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-black tracking-wider text-amber-300">
                  Live Active Order · Track Now
                </span>
                <h4 className="text-xs sm:text-sm font-bold">
                  Order #{activeOrders[0].order_number}: {activeOrders[0].status.replace(/_/g, ' ')}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-extrabold bg-white text-emerald-800 px-3 py-1.5 rounded-xl shadow-xs">
              <span>View Map</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* Mobile-First Hero Banner with Realtime Food Search */}
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-800 via-emerald-900 to-slate-950 text-white pt-6 pb-10 px-4 sm:px-6 lg:px-8 shadow-inner">
        <div className="max-w-4xl mx-auto text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-400/30 backdrop-blur-xs">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Fast, Fresh Ghanaian Dishes to Your Door 🇬🇭</span>
          </div>

          <h1 className="text-xl sm:text-3xl md:text-4xl font-black tracking-tight leading-tight">
            Order Jollof, Waakye, Banku &amp; More
          </h1>
          <p className="text-xs sm:text-sm text-emerald-200/80 max-w-lg mx-auto">
            Realtime food search directly across partner Ghanaian kitchen menus and restaurants.
          </p>

          {/* Realtime Food Search Input Box with Live Clear */}
          <div className="max-w-xl mx-auto pt-2 relative">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-4 pointer-events-none" />
              <input
                type="text"
                placeholder="Search food (e.g. Jollof, Waakye, Tilapia, Shawarma, Chicken)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-24 py-3.5 rounded-2xl bg-white text-slate-900 placeholder-slate-400 text-xs sm:text-sm font-medium shadow-xl focus:outline-none focus:ring-4 focus:ring-emerald-400/40"
              />

              <div className="absolute right-3 flex items-center gap-1.5">
                {isSearchingFood && (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                )}
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCuisine('All');
                    }}
                    className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                    title="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Live Backend Realtime Status Badge under search */}
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-emerald-200/80 px-1">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Realtime data from SamleyGo Search</span>
              </span>
              {isSearchActive && (
                <span className="font-semibold text-amber-300">
                  {foodResults.length} dishes · {restaurantResults.length} kitchens found
                </span>
              )}
            </div>
          </div>

          {/* Quick Search Chips */}
          <div className="flex items-center justify-center flex-wrap gap-1.5 pt-1">
            <span className="text-[11px] text-emerald-200/60 font-semibold mr-1 flex items-center gap-1">
              <Flame className="w-3 h-3 text-amber-400" /> Popular:
            </span>
            {QUICK_SEARCH_SUGGESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSearchQuery(item)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-emerald-100 hover:text-white transition active:scale-95 border border-white/10"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Cuisines Horizontal Snap-Scroll Filter */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-5 relative z-10">
        <div className="bg-white rounded-2xl shadow-md border border-slate-200/80 p-2 sm:p-2.5 overflow-x-auto no-scrollbar flex items-center gap-2">
          {GHANA_CUISINES.map((cuisine) => {
            const isSelected = selectedCuisine === cuisine.name;
            return (
              <button
                key={cuisine.name}
                onClick={() => {
                  setSelectedCuisine(cuisine.name);
                }}
                className={`whitespace-nowrap px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0 active:scale-95 ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/30'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span>{cuisine.icon}</span>
                <span>{cuisine.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* =========================================================================
          SEARCH ACTIVE VIEW (Realtime Food Dishes + Restaurants from Supabase)
         ========================================================================= */}
      {isSearchActive ? (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
          
          {/* Search Header Bar with Tab Switches */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                <Search className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-black text-slate-900">
                  {searchQuery ? `Search results for "${searchQuery}"` : `Category: ${selectedCuisine}`}
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Live query across data menu items &amp; kitchens</span>
                </div>
              </div>
            </div>

            {/* Filter Segment Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full sm:w-auto text-xs font-bold">
              <button
                onClick={() => setSearchTab('all')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg transition ${
                  searchTab === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({foodResults.length + restaurantResults.length})
              </button>
              <button
                onClick={() => setSearchTab('dishes')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg transition ${
                  searchTab === 'dishes'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Dishes ({foodResults.length})
              </button>
              <button
                onClick={() => setSearchTab('restaurants')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg transition ${
                  searchTab === 'restaurants'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kitchens ({restaurantResults.length})
              </button>
            </div>
          </div>

          {/* Loading Indicator */}
          {isSearchingFood && (
            <div className="bg-emerald-50/70 border border-emerald-200/60 rounded-2xl p-4 flex items-center justify-center gap-2 text-xs font-bold text-emerald-800 animate-pulse">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Querying live food database in realtime...</span>
            </div>
          )}

          {/* SECTION 1: MATCHING FOOD DISHES */}
          {(searchTab === 'all' || searchTab === 'dishes') && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-emerald-600" />
                  <span>Matching Dishes ({foodResults.length})</span>
                </h3>
                {foodResults.length > 0 && (
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-100">
                    Live Kitchen Items
                  </span>
                )}
              </div>

              {foodResults.length === 0 ? (
                <div className="bg-white rounded-2xl p-6 text-center border border-slate-200 text-slate-500 text-xs">
                  No individual dishes matched your search. Check matching kitchens below or try another food name.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {foodResults.map((dish) => {
                    const rest = dish.restaurant || restaurantsMap[dish.restaurant_id];
                    return (
                      <div
                        key={dish.id}
                        className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition overflow-hidden flex flex-col justify-between group"
                      >
                        <div className="p-3 sm:p-4 flex gap-3.5">
                          {/* Dish Image / Fallback Avatar */}
                          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0 relative border border-slate-100">
                            {dish.image_url ? (
                              <img
                                src={dish.image_url}
                                alt={dish.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-amber-500/10 via-emerald-500/10 to-teal-500/20 flex flex-col items-center justify-center text-center p-1">
                                <span className="text-3xl select-none">
                                  {getCuisineEmoji(dish.name, dish.description)}
                                </span>
                              </div>
                            )}

                            {/* Sold out tag */}
                            {!dish.is_available && (
                              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center">
                                <span className="text-[9px] font-black text-white px-1.5 py-0.5 rounded bg-rose-600">
                                  SOLD OUT
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Dish Details */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div>
                              <div className="flex items-start justify-between gap-1">
                                <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm line-clamp-1 group-hover:text-emerald-700 transition">
                                  {dish.name}
                                </h4>
                              </div>

                              {rest && (
                                <Link
                                  to={`/restaurant/${rest.id}`}
                                  className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center gap-1 mt-0.5"
                                >
                                  <Store className="w-3 h-3 flex-shrink-0" />
                                  <span className="truncate">{rest.name}</span>
                                </Link>
                              )}

                              {dish.description && (
                                <p className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                                  {dish.description}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                              <span className="text-xs sm:text-sm font-black text-emerald-700">
                                {formatGHS(dish.price)}
                              </span>

                              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>{dish.preparation_time_minutes || 20}m</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="bg-slate-50 px-3 py-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          {rest ? (
                            <Link
                              to={`/restaurant/${rest.id}`}
                              className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition"
                            >
                              <span>View Menu</span>
                              <ChevronRight className="w-3 h-3" />
                            </Link>
                          ) : (
                            <span className="text-[11px] text-slate-400">Ghana Kitchen</span>
                          )}

                          <button
                            onClick={(e) => handleAddDishToCart(e, dish)}
                            disabled={!dish.is_available}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 transition shadow-xs active:scale-95 ${
                              dish.is_available
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Add</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* SECTION 2: MATCHING RESTAURANTS */}
          {(searchTab === 'all' || searchTab === 'restaurants') && (
            <section className="space-y-3 pt-4 border-t border-slate-200/80">
              <div className="flex items-center justify-between">
                <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                  <Store className="w-4 h-4 text-emerald-600" />
                  <span>Matching Kitchens &amp; Restaurants ({restaurantResults.length})</span>
                </h3>
              </div>

              {restaurantResults.length === 0 ? (
                <div className="bg-white rounded-2xl p-6 text-center border border-slate-200 text-slate-500 text-xs">
                  No kitchen profiles match &quot;{searchQuery}&quot;.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {restaurantResults.map((rest) => (
                    <Link
                      key={rest.id}
                      to={`/restaurant/${rest.id}`}
                      className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col group active:scale-[0.99]"
                    >
                      <div className="relative h-36 sm:h-44 bg-gradient-to-br from-emerald-700 via-emerald-800 to-slate-900 overflow-hidden">
                        {rest.cover_url ? (
                          <img
                            src={rest.cover_url}
                            alt={rest.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-white/90 p-4 text-center">
                            <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center mb-1">
                              <Store className="w-6 h-6 text-white" />
                            </div>
                            <span className="font-black text-sm tracking-tight">{rest.name}</span>
                            <span className="text-[10px] text-emerald-200">{rest.cuisine_type}</span>
                          </div>
                        )}

                        <div className="absolute top-3 left-3">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-wide flex items-center gap-1 shadow-md ${
                              rest.is_open
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-900/90 text-slate-300 backdrop-blur-xs'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                rest.is_open ? 'bg-white animate-pulse' : 'bg-rose-500'
                              }`}
                            />
                            {rest.is_open ? 'OPEN NOW' : 'CLOSED'}
                          </span>
                        </div>

                        <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-md px-2.5 py-1 rounded-full text-slate-900 text-xs font-black flex items-center gap-1 shadow-md">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          <span>{rest.rating > 0 ? rest.rating.toFixed(1) : '5.0'}</span>
                          <span className="text-[10px] text-slate-400">({rest.total_reviews})</span>
                        </div>
                      </div>

                      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
                        <div>
                          <h4 className="font-black text-slate-900 text-base group-hover:text-emerald-700 transition">
                            {rest.name}
                          </h4>
                          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                            {rest.cuisine_type} · {rest.address}
                          </p>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>20–35 min</span>
                          </div>
                          <div className="font-bold text-emerald-700">
                            <span>Delivery from {formatGHS(12.0)}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* EMPTY SEARCH STATE (ZERO MOCK DATA) */}
          {foodResults.length === 0 && restaurantResults.length === 0 && !isSearchingFood && (
            <div className="bg-white rounded-3xl p-8 sm:p-12 text-center border border-slate-200 shadow-xs space-y-4 max-w-lg mx-auto my-6">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                <Search className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-black text-slate-900">
                No food or kitchens found matching &quot;{searchQuery}&quot;
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try searching for Ghanaian specialties like Jollof, Waakye, Banku, Tilapia, Kelewele, or Shawarma.
              </p>

              <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                {QUICK_SEARCH_SUGGESTIONS.slice(0, 5).map((dishName) => (
                  <button
                    key={dishName}
                    onClick={() => setSearchQuery(dishName)}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
                  >
                    {dishName}
                  </button>
                ))}
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCuisine('All');
                  }}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition"
                >
                  Clear Search Filters
                </button>
              </div>
            </div>
          )}
        </main>
      ) : (
        /* =========================================================================
            NORMAL DEFAULT HOME VIEW (Browsing Approved Kitchens)
           ========================================================================= */
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
          {/* =======================================================================
              FRESH DISHES FEED (Realtime products from partner kitchens)
             ======================================================================= */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base sm:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  <Utensils className="w-5 h-5 text-emerald-600" />
                  <span>Fresh Dishes Near You</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live menu items added by partner kitchens — updated in realtime
                </p>
              </div>
              <span className="hidden sm:inline text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-100">
                {freshDishes.length} Dishes
              </span>
            </div>

            {isLoadingDishes ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-xs space-y-2 animate-pulse"
                  >
                    <div className="h-24 sm:h-28 bg-slate-200 rounded-xl" />
                    <div className="h-3.5 bg-slate-200 rounded w-3/4" />
                    <div className="h-3 bg-slate-100 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : freshDishes.length === 0 ? (
              <div className="bg-white rounded-2xl p-6 text-center border border-slate-200 text-slate-500 text-xs">
                No dishes published by partner kitchens yet. New menu items will appear here the moment restaurants add them.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {freshDishes.map((dish) => {
                  const rest = dish.restaurant || restaurantsMap[dish.restaurant_id];
                  return (
                    <div
                      key={dish.id}
                      className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition overflow-hidden flex flex-col group"
                    >
                      {/* Dish image / emoji fallback — links to the restaurant */}
                      <Link
                        to={`/restaurant/${dish.restaurant_id}`}
                        className="relative block h-24 sm:h-28 bg-slate-100 overflow-hidden"
                      >
                        {dish.image_url ? (
                          <img
                            src={dish.image_url}
                            alt={dish.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-500/10 via-emerald-500/10 to-teal-500/20 flex items-center justify-center">
                            <span className="text-4xl select-none">
                              {getCuisineEmoji(dish.name, dish.description)}
                            </span>
                          </div>
                        )}

                        {!dish.is_available && (
                          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center">
                            <span className="text-[9px] font-black text-white px-1.5 py-0.5 rounded bg-rose-600">
                              SOLD OUT
                            </span>
                          </div>
                        )}
                      </Link>

                      {/* Dish info */}
                      <div className="p-2.5 sm:p-3 flex-1 flex flex-col">
                        <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm line-clamp-1">
                          {dish.name}
                        </h4>
                        {rest && (
                          <Link
                            to={`/restaurant/${rest.id}`}
                            className="text-[10px] font-bold text-emerald-700 hover:underline flex items-center gap-1 mt-0.5"
                          >
                            <Store className="w-2.5 h-2.5 flex-shrink-0" />
                            <span className="truncate">{rest.name}</span>
                          </Link>
                        )}

                        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100">
                          <span className="text-xs sm:text-sm font-black text-emerald-700">
                            {formatGHS(dish.price)}
                          </span>
                          <button
                            onClick={(e) => handleAddDishToCart(e, dish)}
                            disabled={!dish.is_available}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black flex items-center gap-0.5 transition shadow-xs active:scale-95 ${
                              dish.is_available
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                          >
                            <Plus className="w-3 h-3 stroke-[3]" />
                            <span>Add</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base sm:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Popular Ghanaian Kitchens</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Available near {locationName || 'your area'}
              </p>
            </div>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-100">
              {filteredHomeRestaurants.length} Restaurants
            </span>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div
                  key={n}
                  className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3 animate-pulse"
                >
                  <div className="h-36 sm:h-44 bg-slate-200 rounded-xl" />
                  <div className="h-4 bg-slate-200 rounded w-2/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : filteredHomeRestaurants.length === 0 ? (
            /* Proper Empty State with ZERO Mock Data */
            <div className="bg-white rounded-3xl p-8 sm:p-12 text-center border border-slate-200 shadow-xs space-y-4 max-w-lg mx-auto my-6">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <Store className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-black text-slate-900">
                No restaurants available yet.
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {selectedCuisine !== 'All'
                  ? `No restaurants match "${selectedCuisine}". Try clearing your category filter.`
                  : 'Partner restaurants registered on SamleyGo will appear here in real time.'}
              </p>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                {selectedCuisine !== 'All' ? (
                  <button
                    onClick={() => setSelectedCuisine('All')}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
                  >
                    Clear Filter
                  </button>
                ) : (
                  <Link
                    to="/restaurant/dashboard"
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition"
                  >
                    Register a Kitchen
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {filteredHomeRestaurants.map((rest) => (
                <Link
                  key={rest.id}
                  to={`/restaurant/${rest.id}`}
                  className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col group active:scale-[0.99]"
                >
                  {/* Restaurant Cover / Image Area */}
                  <div className="relative h-36 sm:h-44 bg-gradient-to-br from-emerald-700 via-emerald-800 to-slate-900 overflow-hidden">
                    {rest.cover_url ? (
                      <img
                        src={rest.cover_url}
                        alt={rest.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-white/90 p-4 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center mb-1">
                          <Store className="w-6 h-6 text-white" />
                        </div>
                        <span className="font-black text-sm tracking-tight">{rest.name}</span>
                        <span className="text-[10px] text-emerald-200">{rest.cuisine_type}</span>
                      </div>
                    )}

                    {/* Open / Closed Status Badge */}
                    <div className="absolute top-3 left-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-wide flex items-center gap-1 shadow-md ${
                          rest.is_open
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-900/90 text-slate-300 backdrop-blur-xs'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            rest.is_open ? 'bg-white animate-pulse' : 'bg-rose-500'
                          }`}
                        />
                        {rest.is_open ? 'OPEN NOW' : 'CLOSED'}
                      </span>
                    </div>

                    {/* Rating Badge */}
                    <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-md px-2.5 py-1 rounded-full text-slate-900 text-xs font-black flex items-center gap-1 shadow-md">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span>{rest.rating > 0 ? rest.rating.toFixed(1) : '5.0'}</span>
                      <span className="text-[10px] text-slate-400">({rest.total_reviews})</span>
                    </div>
                  </div>

                  {/* Details Section */}
                  <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <h3 className="font-black text-slate-900 text-base group-hover:text-emerald-700 transition">
                        {rest.name}
                      </h3>
                      <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                        {rest.cuisine_type} · {rest.address}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>20–35 min</span>
                      </div>

                      <div className="flex items-center gap-1 font-bold text-emerald-700">
                        <span>Delivery from {formatGHS(12.0)}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>
      )}

      {/* Location Picker Modal / Bottom Sheet */}
      {showLocationModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-slate-900 text-base">Select Delivery Address</h3>
              </div>
              <button
                onClick={() => setShowLocationModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Why we are asking (shown once, no nagging afterwards) */}
            <p className="text-[11px] text-slate-500 leading-snug">
              {locationName
                ? `Delivering to ${locationName}.`
                : 'Pick your area or use your current location so we only show kitchens that deliver to you.'}
            </p>

            {/* GPS Auto Detect */}
            <button
              onClick={handleDetectLocation}
              disabled={isDetectingLocation}
              className="w-full py-3 px-4 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold text-xs flex items-center justify-center gap-2 transition"
            >
              <Navigation className="w-4 h-4" />
              <span>
                {isDetectingLocation
                  ? 'Acquiring GPS...'
                  : isUsingDeviceLocation
                  ? 'Tracking your location live…'
                  : 'Use Current Device Location'}
              </span>
            </button>

            {/* Inline failure copy — friendly words, never coordinates and
                never a blocking browser alert */}
            {locationError && (
              <div className="flex items-start gap-2 text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="leading-snug">{locationError}</span>
              </div>
            )}

            {/* Popular Ghana Locations */}
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Popular Ghana Locations
              </span>
              <div className="space-y-1">
                {POPULAR_LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => {
                      // A hand-picked area wins over the live device follow
                      setIsUsingDeviceLocation(false);
                      persistLiveTracking(false);
                      setLocationName(loc);
                      persistDeliverTo(loc);
                      setLocationError(null);
                      setShowLocationModal(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center justify-between transition ${
                      locationName === loc
                        ? 'bg-emerald-600 text-white font-bold'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span>{loc}</span>
                    {locationName === loc && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
