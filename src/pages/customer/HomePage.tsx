import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  MapPin,
  ChevronDown,
  ChevronRight,
  Store,
  Navigation,
  X,
  Check,
  Bike,
  Utensils,
  RefreshCw,
  AlertCircle,
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
import { playCustomerStatusAlert } from '../../lib/soundAlerts';
import { PWAInstallButton } from '../../components/common/PWAInstallButton';
import {
  FOOD_CATEGORIES,
  ALL_CATEGORIES,
  findCategory,
  keywordOrFilter,
  sanitizeSearchTerm,
} from '../../lib/categories';
import { getPlatformPricing } from '../../lib/platformPricing';
import { FoodCard } from '../../components/customer/FoodCard';
import { RestaurantCard } from '../../components/customer/RestaurantCard';
import { CategoryScroller } from '../../components/customer/CategoryScroller';
import {
  SectionHeading,
  EmptyState,
  ErrorState,
  FoodGridSkeleton,
  RestaurantGridSkeleton,
} from '../../components/customer/States';

export interface SearchMenuItem extends MenuItem {
  restaurant?: Restaurant;
}

/** Copy shown with the customer milestone chimes (customer-sound.mp3). */
const HOME_STATUS_TOASTS: Record<string, string> = {
  RESTAURANT_PENDING: 'The kitchen just received your order.',
  PREPARING: 'Your kitchen is cooking your order now.',
  READY_FOR_PICKUP: 'Your order is packed and ready for pickup.',
  PICKED_UP: 'Your courier has started the trip to you.',
  ARRIVED: 'Your courier has arrived.',
  DELIVERED: 'Your order has been delivered. Enjoy!',
  COMPLETED: 'Your order is complete.',
};

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
];

/** `COURIER_ASSIGNED` → `Courier Assigned` for customer-facing copy. */
const humanizeStatus = (status: string): string =>
  status
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');


export const HomePage: React.FC = () => {
  const { user } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search query from URL or state
  const initialQuery = searchParams.get('q') || searchParams.get('search') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedCuisine, setSelectedCuisine] = useState(ALL_CATEGORIES);

  // Database records
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantsMap, setRestaurantsMap] = useState<Record<string, Restaurant>>({});
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);

  // Realtime fresh-dishes feed shown on the default homepage (no search needed)
  const [freshDishes, setFreshDishes] = useState<SearchMenuItem[]>([]);
  const [isLoadingDishes, setIsLoadingDishes] = useState(true);

  // Realtime search / category-filter results
  const [foodResults, setFoodResults] = useState<SearchMenuItem[]>([]);
  const [restaurantResults, setRestaurantResults] = useState<Restaurant[]>([]);
  const [isSearchingFood, setIsSearchingFood] = useState(false);
  const [searchTab, setSearchTab] = useState<'all' | 'dishes' | 'restaurants'>('all');

  // Honest failure states — a failed request shows a retry, never fake rows.
  const [restaurantsError, setRestaurantsError] = useState(false);
  const [dishesError, setDishesError] = useState(false);
  const [searchError, setSearchError] = useState(false);

  // Real delivery "from" fee, read from platform_settings (never invented).
  const [deliveryFrom, setDeliveryFrom] = useState<number | undefined>(undefined);

  // Realtime toast & indicator states
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);
  const [addedToast, setAddedToast] = useState<string | null>(null);

  /** Short, non-blocking customer notice (sold out, kitchen still loading…). */
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((message: string) => {
    setRealtimeNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setRealtimeNotice(null), 3500);
  }, []);

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
  /** Last order status we alerted about, so the arrival chime plays once. */
  const lastAlertedStatusRef = useRef<Record<string, string>>({});

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

    setRestaurantsError(false);
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .eq('is_approved', true)
        .order('is_open', { ascending: false })
        .order('rating', { ascending: false });

      if (error) throw error;
      if (data) {
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
          // Fill in alert-ledger entries we do not know yet. Never overwrite:
          // the realtime handler may have recorded a newer status already.
          ordersData.forEach((row: Order) => {
            if (!(row.id in lastAlertedStatusRef.current)) {
              lastAlertedStatusRef.current[row.id] = row.status;
            }
          });
        }
      }
    } catch {
      // The kitchens section renders an ErrorState with a retry instead of
      // pretending the marketplace is empty.
      setRestaurantsError(true);
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

    setDishesError(false);
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
      // Previous dishes stay on screen when we already have some; otherwise
      // the section shows a retry instead of an invented menu.
      setDishesError(true);
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
      const safeText = sanitizeSearchTerm(queryText);
      const category = findCategory(cuisineName);
      const keywords = category?.keywords ?? [];
      const hasText = safeText.length > 0;
      const hasCategory = keywords.length > 0;

      // If the customer cleared search and picked "All", reset live results.
      if (!hasText && !hasCategory) {
        setFoodResults([]);
        setRestaurantResults([]);
        setSearchError(false);
        setIsSearchingFood(false);
        return;
      }

      if (!isSupabaseConfigured) {
        setIsSearchingFood(false);
        return;
      }

      setIsSearchingFood(true);
      setSearchError(false);

      try {
        // Dishes: menu item name/description OR (when a category chip is on)
        // any of that category's real keywords. Each `.or()` is its own
        // PostgREST parameter, so text and category narrow each other down.
        let dishQuery = supabase
          .from('menu_items')
          .select('*, restaurant:restaurants(*)')
          .order('is_available', { ascending: false })
          .limit(40);

        if (hasText) {
          dishQuery = dishQuery.or(
            `name.ilike.%${safeText}%,description.ilike.%${safeText}%`
          );
        }
        if (hasCategory) {
          dishQuery = dishQuery.or(keywordOrFilter(['name', 'description'], keywords));
        }

        // Kitchens: name, cuisine and area, plus the same category keywords.
        let restQuery = supabase
          .from('restaurants')
          .select('*')
          .eq('is_approved', true)
          .order('is_open', { ascending: false })
          .order('rating', { ascending: false })
          .limit(20);

        if (hasText) {
          restQuery = restQuery.or(
            `name.ilike.%${safeText}%,cuisine_type.ilike.%${safeText}%,address.ilike.%${safeText}%`
          );
        }
        if (hasCategory) {
          restQuery = restQuery.or(
            keywordOrFilter(['name', 'cuisine_type', 'description'], keywords)
          );
        }

        const [dishesRes, restRes] = await Promise.all([dishQuery, restQuery]);

        if (dishesRes.error || restRes.error) throw dishesRes.error || restRes.error;

        // Only dishes that belong to an approved kitchen are orderable here,
        // so anything without its kitchen is left out instead of shown as a
        // card the cart would reject.
        const processedDishes: SearchMenuItem[] = [];
        for (const item of (dishesRes.data || []) as SearchMenuItem[]) {
          const rest = item.restaurant || restaurantsMap[item.restaurant_id];
          if (rest && rest.is_approved) {
            processedDishes.push({ ...item, restaurant: rest });
          }
        }
        setFoodResults(processedDishes);
        setRestaurantResults((restRes.data as Restaurant[]) || []);
      } catch {
        // A failed query shows a retry in the results view — never fake rows.
        setFoodResults([]);
        setRestaurantResults([]);
        setSearchError(true);
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
          if (payload.eventType === 'INSERT') {
            setRealtimeNotice('A partner kitchen just added a new dish.');
          } else if (payload.eventType === 'UPDATE') {
            setRealtimeNotice('A kitchen just updated its menu.');
          } else {
            setRealtimeNotice('A kitchen menu has just changed.');
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
          if (payload.eventType === 'UPDATE') {
            setRealtimeNotice('A kitchen just updated its opening status.');
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

  // 3b. Order-milestone alerts for signed-in customers: every kitchen and
  // courier status change rings customer-sound.mp3 (trip start and completion
  // three times, the rest once) with a matching toast — even if the customer
  // is still browsing the home screen instead of the tracking page.
  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    let cancelled = false;

    // Seed the ledger with the statuses we already know so an order that is
    // mid-flight — or already finished — when this page opens stays quiet.
    const seedAlertLedger = async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, status')
          .eq('customer_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (cancelled || error || !data) return;
        data.forEach((row: { id: string; status: string }) => {
          if (!(row.id in lastAlertedStatusRef.current)) {
            lastAlertedStatusRef.current[row.id] = row.status;
          }
        });
      } catch {
        // Ledger stays thin — worst case is a chime we cannot suppress.
      }
    };
    void seedAlertLedger();

    const channel = supabase
      .channel(`home-order-alerts-${user.id}`)
      .on(
        'postgres_changes',
        {
          // '*' so a brand-new order (checkout or a one-tap reorder, possibly
          // placed in another tab) lights up this page without a refresh.
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `customer_id=eq.${user.id}`,
        },
        (payload) => {
          const next = payload.new as Order | undefined;
          if (!next?.id || !next.status) return;

          if (payload.eventType === 'INSERT') {
            // Seed the ledger with the status we just learned about so the
            // first real transition still chimes exactly once.
            if (!(next.id in lastAlertedStatusRef.current)) {
              lastAlertedStatusRef.current[next.id] = next.status;
            }
            void loadApprovedRestaurants();
            return;
          }

          // One alert per transition, no matter how many fields update.
          const previous = lastAlertedStatusRef.current[next.id];
          if (previous === next.status) return;
          lastAlertedStatusRef.current[next.id] = next.status;

          // DELIVERED and COMPLETED celebrate the same moment — ring once.
          if (
            (next.status === 'DELIVERED' || next.status === 'COMPLETED') &&
            (previous === 'DELIVERED' || previous === 'COMPLETED')
          ) {
            return;
          }

          // Refresh the active-delivery card first: it must not depend on
          // whether this particular status has a chime attached to it.
          void loadApprovedRestaurants();

          if (!playCustomerStatusAlert(next.status)) return;

          setRealtimeNotice(
            HOME_STATUS_TOASTS[next.status] ?? 'Your order status just changed.'
          );
          setTimeout(() => setRealtimeNotice(null), 6000);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, loadApprovedRestaurants]);

  // 4. Quick Add Food Item to Cart
  const handleAddDishToCart = (e: React.MouseEvent, dish: SearchMenuItem) => {
    e.preventDefault();
    e.stopPropagation();

    const rest = dish.restaurant || restaurantsMap[dish.restaurant_id];
    if (!rest) {
      showNotice('This kitchen is still loading — try again in a moment.');
      return;
    }

    if (!dish.is_available) {
      showNotice(`${dish.name} is sold out at this kitchen right now.`);
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

  // Delivery "from" fee — the platform's real base fee from platform_settings,
  // fetched once per session and reused by every kitchen card.
  useEffect(() => {
    let cancelled = false;
    void getPlatformPricing().then((settings) => {
      if (!cancelled && typeof settings.base_fee === 'number') {
        setDeliveryFrom(settings.base_fee);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------------------------------------------
     Which data is on screen:
     · a typed query owns the results view (dishes + kitchens)
     · a category chip narrows the home feed itself
     · neither → the normal fresh-dishes / kitchens feed
     ------------------------------------------------------------------ */
  const hasTextQuery = Boolean(searchQuery.trim());
  const hasCategoryFilter = selectedCuisine !== ALL_CATEGORIES;
  const isSearchActive = hasTextQuery;
  const isCategoryFeed = !hasTextQuery && hasCategoryFilter;

  const feedDishes: SearchMenuItem[] = isCategoryFeed ? foodResults : freshDishes;
  const feedRestaurants: Restaurant[] = isCategoryFeed ? restaurantResults : restaurants;
  const feedDishesLoading = isCategoryFeed ? isSearchingFood : isLoadingDishes;
  const feedRestaurantsLoading = isCategoryFeed ? isSearchingFood : isLoading;
  const feedDishesError = isCategoryFeed ? searchError : dishesError;
  const feedRestaurantsError = isCategoryFeed ? searchError : restaurantsError;

  /** The saved place, without the live-tracking emoji prefix. */
  const displayLocation = locationName.replace(/^📍\s*/, '').trim();

  /** "12 dishes" / "1 dish" — never "1 Dishes". */
  const dishCountLabel =
    `${feedDishes.length} ${feedDishes.length === 1 ? 'dish' : 'dishes'}`;
  const restaurantCountLabel =
    `${feedRestaurants.length} ${feedRestaurants.length === 1 ? 'Restaurant' : 'Restaurants'}`;

  return (
    <div className="min-h-screen bg-canvas pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12">
      {/* Live sync notice (kitchen menu changed while browsing) */}
      {realtimeNotice && (
        <div
          role="status"
          className="fixed inset-x-3 top-3 z-50 animate-sg-in rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-2.5 text-xs font-semibold text-white shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-sm"
        >
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span>{realtimeNotice}</span>
          </span>
        </div>
      )}

      {/* Added-to-cart confirmation */}
      {addedToast && (
        <div
          role="status"
          className="fixed inset-x-3 top-3 z-50 animate-sg-in rounded-xl bg-brand-deep px-4 py-2.5 text-xs font-semibold text-white shadow-lg sm:inset-x-auto sm:left-1/2 sm:max-w-sm sm:-translate-x-1/2"
        >
          <span className="flex items-center justify-center gap-2">
            <Check className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{addedToast}</span>
          </span>
        </div>
      )}

      {/* ---------------------------- Delivery location ---------------------------- */}
      <div className="border-b border-slate-200/70 bg-white">
        <button
          type="button"
          onClick={() => setShowLocationModal(true)}
          aria-label="Change delivery location"
          className="mx-auto flex w-full max-w-7xl items-center gap-2.5 px-4 py-2.5 text-left transition active:bg-slate-50 sm:px-6 lg:px-8"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-brand-dark">
            <MapPin className="h-4 w-4" aria-hidden="true" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
              Deliver to
            </span>
            <span
              className={`block truncate text-[13px] font-semibold ${
                locationName ? 'text-slate-900' : 'text-slate-400'
              }`}
            >
              {displayLocation || 'Choose your location'}
            </span>
          </span>

          {isUsingDeviceLocation && liveLocation.isWatching && (
            <span className="hidden flex-shrink-0 items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-brand-dark sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
              Live location
            </span>
          )}

          <span className="flex flex-shrink-0 items-center gap-0.5 text-xs font-bold text-brand-dark">
            Change
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>
      </div>

            {/* --------------------------- Order in progress --------------------------- */}
      {activeOrders.length > 0 && (
        <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => navigate(`/orders/${activeOrders[0].id}`)}
            className="flex w-full items-center gap-3 rounded-2xl border border-emerald-200/80 bg-emerald-50 px-3.5 py-3 text-left transition hover:bg-emerald-100/70 active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              <Bike className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-dark">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                Order in progress
              </span>
              <span className="mt-0.5 block truncate text-[13px] font-semibold text-slate-900">
                #{activeOrders[0].order_number} · {humanizeStatus(activeOrders[0].status)} ·{' '}
                {formatGHS(activeOrders[0].total_amount)}
              </span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-1 text-xs font-bold text-brand-dark">
              Track
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      )}

      {/* ------------------------- Hero / food discovery ------------------------- */}
      <section className="bg-brand-deep px-4 pb-5 pt-5 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-bold leading-tight tracking-tight sm:text-2xl">
                Order Jollof, Waakye, Banku &amp; More
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-emerald-100/85">
                Find fresh Ghanaian dishes from partner kitchens near you.
              </p>
            </div>

            {/* Install affordance — renders only when the browser offers it */}
            <div className="flex-shrink-0 pt-1">
              <PWAInstallButton compact />
            </div>
          </div>

          <div className="relative mt-4">
            <span className="pointer-events-none absolute left-3.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center">
              {isSearchingFood ? (
                <RefreshCw className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
              )}
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search food, dishes or kitchens"
              aria-label="Search food, dishes or kitchens"
              className="h-12 w-full rounded-xl bg-white pl-10 pr-14 text-[13px] font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/50"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-600"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Popular searches — quiet text chips, never a wall of pills */}
          <div className="no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
            <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-200/70">
              Popular
            </span>
            {QUICK_SEARCH_SUGGESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSearchQuery(item)}
                className="h-11 flex-shrink-0 rounded-lg border border-white/10 bg-white/10 px-3 text-[11.5px] font-semibold text-emerald-50 transition hover:bg-white/15 active:scale-95"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------- Categories (filters) --------------------------- */}
      <CategoryScroller
        categories={FOOD_CATEGORIES}
        value={selectedCuisine}
        onChange={setSelectedCuisine}
      />

      {isSearchActive ? (
        /* ======================================================================
           SEARCH RESULTS — real dishes & kitchens matching the typed query
           ====================================================================== */
        <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-slate-900">
                {searchQuery.trim() ? `Results for "${searchQuery.trim()}"` : selectedCuisine}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {isSearchingFood
                  ? 'Searching kitchens and menus…'
                  : `${foodResults.length + restaurantResults.length} result${
                      foodResults.length + restaurantResults.length === 1 ? '' : 's'
                    } across dishes and kitchens`}
              </p>
            </div>

            <div className="flex w-full items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold sm:w-auto">
              {(
                [
                  ['all', `All (${foodResults.length + restaurantResults.length})`],
                  ['dishes', `Dishes (${foodResults.length})`],
                  ['restaurants', `Kitchens (${restaurantResults.length})`],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={searchTab === tab}
                  onClick={() => setSearchTab(tab)}
                  className={`h-11 flex-1 whitespace-nowrap rounded-lg px-2.5 transition sm:flex-none ${
                    searchTab === tab
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {searchError && !isSearchingFood && (
            <div className="mt-4">
              <ErrorState
                description="We could not reach SamleyGo just now. Check your connection and try again."
                onRetry={() => executeRealtimeSearch(searchQuery, selectedCuisine)}
              />
            </div>
          )}

          {(searchTab === 'all' || searchTab === 'dishes') && (
            <section className="mt-5">
              <SectionHeading
                title="Dishes"
                countLabel={
                  isSearchingFood
                    ? undefined
                    : `${foodResults.length} ${
                        foodResults.length === 1 ? 'dish' : 'dishes'
                      }`
                }
              />
              {isSearchingFood ? (
                <FoodGridSkeleton />
              ) : foodResults.length === 0 ? (
                !searchError && (
                  <EmptyState
                    icon={<Utensils className="h-6 w-6" aria-hidden="true" />}
                    title="No dishes found"
                    description="Try another search or explore a different category."
                  />
                )
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {foodResults.map((dish) => (
                    <FoodCard key={dish.id} dish={dish} onAdd={handleAddDishToCart} />
                  ))}
                </div>
              )}
            </section>
          )}

          {(searchTab === 'all' || searchTab === 'restaurants') && (
            <section className="mt-6">
              <SectionHeading
                title="Kitchens & Restaurants"
                countLabel={
                  isSearchingFood
                    ? undefined
                    : `${restaurantResults.length} ${
                        restaurantResults.length === 1 ? 'Restaurant' : 'Restaurants'
                      }`
                }
              />
              {isSearchingFood ? (
                <RestaurantGridSkeleton />
              ) : restaurantResults.length === 0 ? (
                !searchError && (
                  <EmptyState
                    icon={<Store className="h-6 w-6" aria-hidden="true" />}
                    title="No kitchens found"
                    description="No partner kitchen matches this search yet. Try another dish or area name."
                  />
                )
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {restaurantResults.map((rest) => (
                    <RestaurantCard
                      key={rest.id}
                      restaurant={rest}
                      deliveryFrom={deliveryFrom}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {!isSearchingFood && !searchError && foodResults.length === 0 && restaurantResults.length === 0 && (
            <div className="mt-4">
              <EmptyState
                title={`Nothing found for "${searchQuery.trim()}"`}
                description="Check the spelling, or clear your search to browse everything our partner kitchens are cooking today."
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCuisine(ALL_CATEGORIES);
                    }}
                    className="h-11 rounded-xl bg-brand px-4 text-xs font-bold text-white transition hover:bg-brand-dark active:scale-95"
                  >
                    Clear search
                  </button>
                }
              />
            </div>
          )}
        </main>
      ) : (
        /* ======================================================================
           DEFAULT HOME FEED — fresh dishes and popular kitchens near you
           ====================================================================== */
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <section className="pt-5">
            <SectionHeading
              title="Fresh Dishes Near You"
              subtitle={
                isCategoryFeed
                  ? `Filtered by ${selectedCuisine}`
                  : 'Recently added by partner kitchens'
              }
              countLabel={feedDishesLoading ? undefined : dishCountLabel}
            />

            {feedDishesLoading ? (
              <FoodGridSkeleton />
            ) : feedDishesError && feedDishes.length === 0 ? (
              <ErrorState
                description="We could not load the dish feed. Check your connection and try again."
                onRetry={() =>
                  isCategoryFeed
                    ? executeRealtimeSearch('', selectedCuisine)
                    : loadFreshDishes()
                }
              />
            ) : feedDishes.length === 0 ? (
              <EmptyState
                icon={<Utensils className="h-6 w-6" aria-hidden="true" />}
                title={isCategoryFeed ? 'No dishes found' : 'No dishes yet'}
                description={
                  isCategoryFeed
                    ? 'Try another search or explore a different category.'
                    : 'Partner kitchens publish their menus here the moment they add them. New dishes will appear as soon as they are ready.'
                }
                action={
                  isCategoryFeed ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCuisine(ALL_CATEGORIES)}
                      className="h-11 rounded-xl bg-brand px-4 text-xs font-bold text-white transition hover:bg-brand-dark active:scale-95"
                    >
                      Show all dishes
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {feedDishes.map((dish) => (
                  <FoodCard key={dish.id} dish={dish} onAdd={handleAddDishToCart} />
                ))}
              </div>
            )}
          </section>

          <section className="pb-6 pt-7">
            <SectionHeading
              title="Popular Kitchens Near You"
              subtitle={
                isCategoryFeed
                  ? `Kitchens matching ${selectedCuisine}`
                  : 'Partner kitchens ready to cook for you'
              }
              countLabel={feedRestaurantsLoading ? undefined : restaurantCountLabel}
            />

            {feedRestaurantsLoading ? (
              <RestaurantGridSkeleton />
            ) : feedRestaurantsError && feedRestaurants.length === 0 ? (
              <ErrorState
                description="We could not load kitchens near you. Check your connection and try again."
                onRetry={() =>
                  isCategoryFeed
                    ? executeRealtimeSearch('', selectedCuisine)
                    : loadApprovedRestaurants()
                }
              />
            ) : feedRestaurants.length === 0 ? (
              <EmptyState
                icon={<Store className="h-6 w-6" aria-hidden="true" />}
                title="No kitchens found"
                description={
                  isCategoryFeed
                    ? 'No partner kitchen matches this category yet. Clear the filter to see everything that is open now.'
                    : 'Partner restaurants approved on SamleyGo will appear here the moment they join.'
                }
                action={
                  isCategoryFeed ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCuisine(ALL_CATEGORIES)}
                      className="h-11 rounded-xl bg-brand px-4 text-xs font-bold text-white transition hover:bg-brand-dark active:scale-95"
                    >
                      Show all kitchens
                    </button>
                  ) : (
                    <Link
                      to="/restaurants"
                      className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      Explore kitchens
                    </Link>
                  )
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {feedRestaurants.map((rest) => (
                  <RestaurantCard key={rest.id} restaurant={rest} deliveryFrom={deliveryFrom} />
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {/* ------------------------- Delivery location sheet ------------------------- */}
      {showLocationModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Select delivery address"
        >
          <div className="max-h-[85dvh] w-full max-w-md animate-sg-pop space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4.5 w-4.5 text-brand-dark" aria-hidden="true" />
                <h3 className="text-[15px] font-bold text-slate-900">Delivery address</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLocationModal(false)}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>

            <p className="text-xs leading-relaxed text-slate-500">
              {displayLocation
                ? `Delivering to ${displayLocation}. Pick a different area or use your device location.`
                : 'Pick your area or use your current location so we only show kitchens that deliver to you.'}
            </p>

            <button
              type="button"
              onClick={handleDetectLocation}
              disabled={isDetectingLocation}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 text-xs font-bold text-brand-dark transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60"
            >
              <Navigation className="h-4 w-4" aria-hidden="true" />
              <span>
                {isDetectingLocation
                  ? 'Finding your location…'
                  : isUsingDeviceLocation
                  ? 'Following your location live'
                  : 'Use current device location'}
              </span>
            </button>

            {locationError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium leading-relaxed text-rose-600">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>{locationError}</span>
              </div>
            )}

            <div>
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                Popular areas
              </span>
              <div className="space-y-1">
                {POPULAR_LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => {
                      // A hand-picked area wins over the live device follow.
                      setIsUsingDeviceLocation(false);
                      persistLiveTracking(false);
                      setLocationName(loc);
                      persistDeliverTo(loc);
                      setLocationError(null);
                      setShowLocationModal(false);
                    }}
                    className={`flex h-11 w-full items-center justify-between rounded-xl px-3.5 text-left text-xs transition ${
                      locationName === loc
                        ? 'bg-brand text-white font-bold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">{loc}</span>
                    {locationName === loc && <Check className="h-4 w-4 flex-shrink-0" />}
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
