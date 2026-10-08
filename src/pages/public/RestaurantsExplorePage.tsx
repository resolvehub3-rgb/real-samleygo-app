import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Store, Filter, Utensils, Plus, Check, RefreshCw, X } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Restaurant, MenuItem } from '../../types/database';
import { formatGHS } from '../../lib/pricing';
import { getPlatformPricing } from '../../lib/platformPricing';
import { sanitizeSearchTerm } from '../../lib/categories';
import { useCart } from '../../context/CartContext';
import { RestaurantCard } from '../../components/customer/RestaurantCard';
import {
  SectionHeading,
  EmptyState,
  ErrorState,
  RestaurantGridSkeleton,
} from '../../components/customer/States';

interface SearchMenuItem extends MenuItem {
  restaurant?: Restaurant;
}

/** Real dish names customers search for most — no invented suggestions. */
const POPULAR_TAGS = [
  'Jollof',
  'Waakye',
  'Banku & Tilapia',
  'Kelewele',
  'Shawarma',
  'Grilled Chicken',
];

export const RestaurantsExplorePage: React.FC = () => {
  const { addItem } = useCart();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || searchParams.get('search') || '';

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantsMap, setRestaurantsMap] = useState<Record<string, Restaurant>>({});
  const [search, setSearch] = useState(initialQuery);
  const [cityFilter, setCityFilter] = useState('All');
  const [searchTab, setSearchTab] = useState<'all' | 'food' | 'kitchens'>('all');

  // Realtime search results
  const [foodResults, setFoodResults] = useState<SearchMenuItem[]>([]);
  const [restaurantResults, setRestaurantResults] = useState<Restaurant[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchError, setSearchError] = useState(false);
  const [listError, setListError] = useState(false);

  // The platform's real starting delivery fee, shown on every kitchen card
  const [deliveryFrom, setDeliveryFrom] = useState<number | undefined>(undefined);

  // Feedback
  const [addedToast, setAddedToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const latestSearchRef = useRef(search);
  latestSearchRef.current = search;

  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  // 1. Fetch base approved restaurants
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

      if (error) {
        setListError(true);
      } else if (data) {
        setRestaurants(data as Restaurant[]);
        const map: Record<string, Restaurant> = {};
        (data as Restaurant[]).forEach((r) => {
          map[r.id] = r;
        });
        setRestaurantsMap(map);
        setListError(false);
      }
    } catch {
      setListError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApprovedRestaurants();
  }, [loadApprovedRestaurants]);

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

  // 2. Realtime Food & Kitchen Search Function
  const executeSearch = useCallback(
    async (searchTerm: string, city: string) => {
      const term = searchTerm.trim();

      if (!term) {
        setFoodResults([]);
        setRestaurantResults([]);
        setIsSearching(false);
        setSearchError(false);
        return;
      }

      if (!isSupabaseConfigured) {
        setIsSearching(false);
        return;
      }

      // Customer input can never rewrite the PostgREST `.or()` grammar
      const safeTerm = sanitizeSearchTerm(term);
      if (!safeTerm) {
        setFoodResults([]);
        setRestaurantResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setSearchError(false);
      try {
        // Query dishes in realtime
        const dishQuery = supabase
          .from('menu_items')
          .select('*, restaurant:restaurants(*)')
          .or(`name.ilike.%${safeTerm}%,description.ilike.%${safeTerm}%`)
          .order('is_available', { ascending: false })
          .limit(30);

        // Query kitchens in realtime
        let restQuery = supabase
          .from('restaurants')
          .select('*')
          .eq('is_approved', true)
          .or(`name.ilike.%${safeTerm}%,cuisine_type.ilike.%${safeTerm}%,address.ilike.%${safeTerm}%`)
          .order('is_open', { ascending: false })
          .limit(20);

        if (city !== 'All') {
          restQuery = restQuery.eq('city', city);
        }

        const [dishesRes, restRes] = await Promise.all([dishQuery, restQuery]);

        if (dishesRes.error || restRes.error) {
          setSearchError(true);
        }

        if (dishesRes.data) {
          const items = (dishesRes.data as SearchMenuItem[]).map((d) => ({
            ...d,
            restaurant: d.restaurant || restaurantsMap[d.restaurant_id],
          }));

          // Filter by city if selected
          const filteredDishes = items.filter((d) => {
            if (city === 'All') return true;
            return d.restaurant?.city === city;
          });

          setFoodResults(filteredDishes);
        } else {
          setFoodResults([]);
        }

        if (restRes.data) {
          setRestaurantResults(restRes.data as Restaurant[]);
        } else {
          setRestaurantResults([]);
        }
      } catch {
        setSearchError(true);
        setFoodResults([]);
        setRestaurantResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [restaurantsMap]
  );

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      executeSearch(search, cityFilter);
    }, 180);

    return () => clearTimeout(timer);
  }, [search, cityFilter, executeSearch]);

  // Sync URL search params
  useEffect(() => {
    if (search.trim()) {
      setSearchParams({ q: search.trim() }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [search, setSearchParams]);

  // 3. Supabase Realtime Subscription for Live Updates
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel('explore-realtime-food')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'menu_items' },
        () => {
          setNotice('A kitchen menu changed while you were browsing.');
          if (latestSearchRef.current.trim()) {
            executeSearch(latestSearchRef.current, cityFilter);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurants' },
        () => {
          loadApprovedRestaurants();
          if (latestSearchRef.current.trim()) {
            executeSearch(latestSearchRef.current, cityFilter);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cityFilter, executeSearch, loadApprovedRestaurants]);

  // Handle Add Dish to Cart
  const handleAddDish = (e: React.MouseEvent, dish: SearchMenuItem) => {
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

    const added = addItem(dish, rest);
    if (added) {
      setAddedToast(`${dish.name} added to your cart`);
      setTimeout(() => setAddedToast(null), 3000);
    }
  };

  const isSearchActive = Boolean(search.trim());

  // Filter default restaurants when not searching
  const defaultFilteredRestaurants = restaurants.filter((r) => {
    const matchCity = cityFilter === 'All' || r.city === cityFilter;
    return matchCity;
  });

  const totalMatches = foodResults.length + restaurantResults.length;

  // One honest "nothing found" instead of two empty cards side by side
  const showCombinedEmpty =
    !searchError && !isSearching && totalMatches === 0 && searchTab === 'all';

  return (
    <div className="min-h-screen bg-canvas pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12">
      {/* Live sync notice */}
      {notice && (
        <div
          role="status"
          className="fixed inset-x-3 top-3 z-50 animate-sg-in rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-2.5 text-xs font-semibold text-white shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-sm"
        >
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span>{notice}</span>
          </span>
        </div>
      )}

      {/* Added to cart confirmation */}
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

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Search Food &amp; Kitchens
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            Find dishes and certified partner kitchens across Ghana.
          </p>
        </div>

        {/* Search + city filter */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search a dish, cuisine or kitchen name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search dishes, cuisines or kitchens"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-16 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 sm:text-sm"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {isSearching && (
                <RefreshCw
                  className="h-4 w-4 animate-spin text-brand"
                  aria-label="Searching"
                />
              )}
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
            <Filter className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden="true" />
            <label htmlFor="explore-city" className="sr-only">
              Filter kitchens by city
            </label>
            <select
              id="explore-city"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="h-11 flex-1 bg-transparent text-xs font-semibold text-slate-700 focus:outline-none sm:flex-none"
            >
              <option value="All">All Ghana cities</option>
              <option value="Accra">Accra</option>
              <option value="Kumasi">Kumasi</option>
              <option value="Tema">Tema</option>
              <option value="Takoradi">Takoradi</option>
            </select>
          </div>
        </div>

        {/* Popular search suggestions */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Popular
          </span>
          {POPULAR_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSearch(tag)}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[11.5px] font-semibold text-slate-700 transition hover:border-brand hover:text-brand-dark active:scale-95"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Segmented tab filter when searching */}
        {isSearchActive && (
          <div
            className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold"
            role="group"
            aria-label="Filter search results"
          >
            {(
              [
                ['all', `All (${totalMatches})`],
                ['food', `Dishes (${foodResults.length})`],
                ['kitchens', `Kitchens (${restaurantResults.length})`],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                aria-pressed={searchTab === tab}
                onClick={() => setSearchTab(tab)}
                className={`h-11 flex-1 whitespace-nowrap rounded-lg px-2.5 transition ${
                  searchTab === tab
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* =====================================================================
            SEARCH RESULTS VIEW
           ===================================================================== */}
        {isSearchActive ? (
          <div>
            {searchError && !isSearching && (
              <ErrorState
                description="We could not reach SamleyGo just now. Check your connection and try again."
                onRetry={() => executeSearch(search, cityFilter)}
              />
            )}

            {/* MATCHING DISHES */}
            {!showCombinedEmpty && !searchError && (searchTab === 'all' || searchTab === 'food') && (
              <section className="mt-4">
                <SectionHeading
                  title="Dishes"
                  countLabel={
                    isSearching
                      ? undefined
                      : `${foodResults.length} ${foodResults.length === 1 ? 'dish' : 'dishes'}`
                  }
                />

                {isSearching ? (
                  <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
                    <p className="text-xs text-slate-500">Searching kitchens and menus…</p>
                  </div>
                ) : foodResults.length === 0 ? (
                  <EmptyState
                    icon={<Utensils className="h-6 w-6" aria-hidden="true" />}
                    title="No dishes found"
                    description={`No dish on a partner menu matches "${search.trim()}". Try a different dish name or kitchen.`}
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {foodResults.map((dish) => {
                      const rest = dish.restaurant || restaurantsMap[dish.restaurant_id];
                      return (
                        <div
                          key={dish.id}
                          className="flex gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card"
                        >
                          <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-brand-deep">
                            {dish.image_url ? (
                              <img
                                src={dish.image_url}
                                alt={dish.name}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center text-white/70">
                                <Utensils className="h-6 w-6" aria-hidden="true" />
                              </span>
                            )}
                            {!dish.is_available && (
                              <span className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-[9px] font-bold uppercase tracking-wide text-white">
                                Sold out
                              </span>
                            )}
                          </div>

                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">
                                {dish.name}
                              </h3>
                              <span className="shrink-0 text-[13px] font-bold tabular-nums text-slate-900">
                                {formatGHS(dish.price)}
                              </span>
                            </div>

                            {rest && (
                              <Link
                                to={`/restaurant/${rest.id}`}
                                className="mt-0.5 truncate text-[11px] font-semibold text-brand-dark hover:underline"
                              >
                                {rest.name}
                              </Link>
                            )}

                            {dish.description && (
                              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                                {dish.description}
                              </p>
                            )}

                            <div className="mt-auto flex justify-end pt-2">
                              <button
                                type="button"
                                onClick={(e) => handleAddDish(e, dish)}
                                disabled={!dish.is_available}
                                aria-label={`Add ${dish.name} to cart`}
                                className={`flex h-11 min-w-[68px] items-center justify-center gap-1 rounded-xl px-3 text-xs font-bold transition active:scale-95 ${
                                  dish.is_available
                                    ? 'bg-brand text-white hover:bg-brand-dark'
                                    : 'cursor-not-allowed bg-slate-100 text-slate-400'
                                }`}
                              >
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{dish.is_available ? 'Add' : 'Sold out'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* MATCHING KITCHENS */}
            {!showCombinedEmpty && !searchError && (searchTab === 'all' || searchTab === 'kitchens') && (
              <section className="mt-6">
                <SectionHeading
                  title="Kitchens & Restaurants"
                  countLabel={
                    isSearching
                      ? undefined
                      : `${restaurantResults.length} ${
                          restaurantResults.length === 1 ? 'Restaurant' : 'Restaurants'
                        }`
                  }
                />

                {isSearching ? (
                  <RestaurantGridSkeleton />
                ) : restaurantResults.length === 0 ? (
                  <EmptyState
                    icon={<Store className="h-6 w-6" aria-hidden="true" />}
                    title="No kitchens found"
                    description={`No certified kitchen matches "${search.trim()}"${
                      cityFilter !== 'All' ? ` in ${cityFilter}` : ''
                    } yet. Try another dish or area name.`}
                  />
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

            {/* Empty state when nothing matched across both tabs */}
            {showCombinedEmpty && (
                <div className="mt-4">
                  <EmptyState
                    icon={<Search className="h-6 w-6" aria-hidden="true" />}
                    title="No results found"
                    description={`Nothing on SamleyGo matches "${search.trim()}". Try another dish, cuisine or kitchen name.`}
                    action={
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        className="h-11 rounded-xl bg-brand px-4 text-xs font-bold text-white transition hover:bg-brand-dark active:scale-95"
                      >
                        Clear search
                      </button>
                    }
                  />
                </div>
              )}
          </div>
        ) : (
          /* =====================================================================
              DEFAULT ALL RESTAURANTS VIEW
             ===================================================================== */
          <section>
            <SectionHeading
              title="All Partner Kitchens"
              subtitle={
                cityFilter === 'All'
                  ? 'Approved kitchens across Ghana, open ones first'
                  : `Approved kitchens in ${cityFilter}`
              }
              countLabel={
                isLoading
                  ? undefined
                  : `${defaultFilteredRestaurants.length} ${
                      defaultFilteredRestaurants.length === 1 ? 'Restaurant' : 'Restaurants'
                    }`
              }
            />

            {isLoading ? (
              <RestaurantGridSkeleton count={6} />
            ) : listError ? (
              <ErrorState
                description="We could not load the kitchen list. Check your connection and try again."
                onRetry={() => {
                  setIsLoading(true);
                  loadApprovedRestaurants();
                }}
              />
            ) : defaultFilteredRestaurants.length === 0 ? (
              <EmptyState
                icon={<Store className="h-6 w-6" aria-hidden="true" />}
                title="No kitchens found"
                description={
                  cityFilter !== 'All'
                    ? `No partner kitchen is listed in ${cityFilter} yet. Try another city.`
                    : 'Partner kitchens approved on SamleyGo will appear here the moment they join.'
                }
                action={
                  cityFilter !== 'All' ? (
                    <button
                      type="button"
                      onClick={() => setCityFilter('All')}
                      className="h-11 rounded-xl bg-brand px-4 text-xs font-bold text-white transition hover:bg-brand-dark active:scale-95"
                    >
                      Show all cities
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {defaultFilteredRestaurants.map((rest) => (
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
      </div>
    </div>
  );
};
