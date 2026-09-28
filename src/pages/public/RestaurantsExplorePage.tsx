import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search,
  Star,
  Clock,
  Store,
  Filter,
  Utensils,
  Plus,
  Check,
  RefreshCw,
  X,
  ChevronRight,
  Flame,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Restaurant, MenuItem } from '../../types/database';
import { formatGHS } from '../../lib/pricing';
import { useCart } from '../../context/CartContext';

interface SearchMenuItem extends MenuItem {
  restaurant?: Restaurant;
}

function getCuisineEmoji(name: string, description?: string): string {
  const text = `${name} ${description || ''}`.toLowerCase();
  if (text.includes('jollof') || text.includes('fried rice') || text.includes('rice')) return '🍛';
  if (text.includes('waakye')) return '🍱';
  if (text.includes('banku') || text.includes('tilapia') || text.includes('fish')) return '🐟';
  if (text.includes('fufu') || text.includes('soup') || text.includes('goat')) return '🍲';
  if (text.includes('kelewele') || text.includes('plantain')) return '🍌';
  if (text.includes('kenkey') || text.includes('shito')) return '🌽';
  if (text.includes('shawarma') || text.includes('grill') || text.includes('khebab')) return '🌯';
  if (text.includes('chicken') || text.includes('wings') || text.includes('turkey')) return '🍗';
  if (text.includes('juice') || text.includes('sobolo') || text.includes('drink')) return '🥤';
  if (text.includes('pastry') || text.includes('pie') || text.includes('cake')) return '🥐';
  if (text.includes('burger')) return '🍔';
  if (text.includes('pizza')) return '🍕';
  return '🍽️';
}

const POPULAR_TAGS = ['Jollof', 'Waakye', 'Banku & Tilapia', 'Kelewele', 'Shawarma', 'Grilled Chicken'];

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

  // Toast notifications
  const [addedToast, setAddedToast] = useState<string | null>(null);
  const [realtimeToast, setRealtimeToast] = useState<string | null>(null);

  const latestSearchRef = useRef(search);
  latestSearchRef.current = search;

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

      if (!error && data) {
        setRestaurants(data as Restaurant[]);
        const map: Record<string, Restaurant> = {};
        (data as Restaurant[]).forEach((r) => {
          map[r.id] = r;
        });
        setRestaurantsMap(map);
      }
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApprovedRestaurants();
  }, [loadApprovedRestaurants]);

  // 2. Realtime Food & Kitchen Search Function
  const executeSearch = useCallback(
    async (searchTerm: string, city: string) => {
      const term = searchTerm.trim();

      if (!term) {
        setFoodResults([]);
        setRestaurantResults([]);
        setIsSearching(false);
        return;
      }

      if (!isSupabaseConfigured) {
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        // Query dishes in realtime
        const dishQuery = supabase
          .from('menu_items')
          .select('*, restaurant:restaurants(*)')
          .or(`name.ilike.%${term}%,description.ilike.%${term}%`)
          .order('is_available', { ascending: false })
          .limit(30);

        // Query kitchens in realtime
        let restQuery = supabase
          .from('restaurants')
          .select('*')
          .eq('is_approved', true)
          .or(`name.ilike.%${term}%,cuisine_type.ilike.%${term}%,address.ilike.%${term}%`)
          .order('is_open', { ascending: false })
          .limit(20);

        if (city !== 'All') {
          restQuery = restQuery.eq('city', city);
        }

        const [dishesRes, restRes] = await Promise.all([dishQuery, restQuery]);

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
        // Handled
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
          setRealtimeToast('⚡ Live kitchen menu update synced!');
          setTimeout(() => setRealtimeToast(null), 3000);
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
    if (!rest) return;

    if (!dish.is_available) {
      alert(`"${dish.name}" is currently sold out.`);
      return;
    }

    const added = addItem(dish, rest);
    if (added) {
      setAddedToast(`Added "${dish.name}" to cart!`);
      setTimeout(() => setAddedToast(null), 3000);
    }
  };

  const isSearchActive = Boolean(search.trim());

  // Filter default restaurants when not searching
  const defaultFilteredRestaurants = restaurants.filter((r) => {
    const matchCity = cityFilter === 'All' || r.city === cityFilter;
    return matchCity;
  });

  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      
      {/* Realtime Sync Toast */}
      {realtimeToast && (
        <div className="fixed top-18 right-4 z-50 bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-2xl shadow-xl flex items-center gap-2 border border-emerald-500 animate-in fade-in">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span>{realtimeToast}</span>
        </div>
      )}

      {/* Added to Cart Toast */}
      {addedToast && (
        <div className="fixed top-18 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white text-xs sm:text-sm font-black px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 border border-emerald-400 animate-in fade-in">
          <Check className="w-4 h-4 stroke-[3]" />
          <span>{addedToast}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Search Food &amp; Kitchens
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Live realtime search across Ghanaian dishes, menus, and certified kitchens.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200/60 self-start sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Realtime Supabase Search</span>
          </div>
        </div>

        {/* Realtime Search & City Filter Bar */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search food dish (Jollof, Tilapia, Waakye...) or kitchen name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-20 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
              {isSearching && <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />}
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
                  title="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="All">All Ghana Cities</option>
              <option value="Accra">Accra</option>
              <option value="Kumasi">Kumasi</option>
              <option value="Tema">Tema</option>
              <option value="Takoradi">Takoradi</option>
            </select>
          </div>
        </div>

        {/* Popular Search Suggestions */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-slate-400 font-semibold flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-amber-500" /> Popular:
          </span>
          {POPULAR_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setSearch(tag)}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-700 font-medium transition active:scale-95"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Segmented Tab Filter when searching */}
        {isSearchActive && (
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl w-full sm:w-auto self-start text-xs font-bold">
            <button
              onClick={() => setSearchTab('all')}
              className={`px-3.5 py-1.5 rounded-lg transition ${
                searchTab === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Matches ({foodResults.length + restaurantResults.length})
            </button>
            <button
              onClick={() => setSearchTab('food')}
              className={`px-3.5 py-1.5 rounded-lg transition ${
                searchTab === 'food'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Dishes &amp; Food ({foodResults.length})
            </button>
            <button
              onClick={() => setSearchTab('kitchens')}
              className={`px-3.5 py-1.5 rounded-lg transition ${
                searchTab === 'kitchens'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kitchens ({restaurantResults.length})
            </button>
          </div>
        )}

        {/* =====================================================================
            SEARCH RESULTS VIEW
           ===================================================================== */}
        {isSearchActive ? (
          <div className="space-y-8">
            
            {/* MATCHING DISHES */}
            {(searchTab === 'all' || searchTab === 'food') && (
              <section className="space-y-3">
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-emerald-600" />
                  <span>Dishes &amp; Meals ({foodResults.length})</span>
                </h3>

                {foodResults.length === 0 ? (
                  <div className="bg-white rounded-2xl p-6 text-center border border-slate-200 text-slate-500 text-xs">
                    No dishes matched &quot;{search}&quot;.
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
                          <div className="p-4 flex gap-3.5">
                            <div className="w-20 h-20 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0 relative border border-slate-100">
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
                              {!dish.is_available && (
                                <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center">
                                  <span className="text-[9px] font-black text-white px-1.5 py-0.5 rounded bg-rose-600">
                                    SOLD OUT
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0 flex flex-col justify-between">
                              <div>
                                <h4 className="font-extrabold text-slate-900 text-sm line-clamp-1 group-hover:text-emerald-700 transition">
                                  {dish.name}
                                </h4>
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
                                <span className="text-sm font-black text-emerald-700">
                                  {formatGHS(dish.price)}
                                </span>
                                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-semibold">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  <span>{dish.preparation_time_minutes || 20}m</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="bg-slate-50 px-3 py-2 border-t border-slate-100 flex items-center justify-between gap-2">
                            {rest ? (
                              <Link
                                to={`/restaurant/${rest.id}`}
                                className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                              >
                                <span>Menu</span>
                                <ChevronRight className="w-3 h-3" />
                              </Link>
                            ) : (
                              <span className="text-[11px] text-slate-400">Kitchen Dish</span>
                            )}

                            <button
                              onClick={(e) => handleAddDish(e, dish)}
                              disabled={!dish.is_available}
                              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 transition shadow-xs active:scale-95 ${
                                dish.is_available
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              }`}
                            >
                              <Plus className="w-3.5 h-3.5 stroke-[3]" />
                              <span>Add to Order</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* MATCHING KITCHENS */}
            {(searchTab === 'all' || searchTab === 'kitchens') && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Store className="w-4 h-4 text-emerald-600" />
                  <span>Matching Kitchens ({restaurantResults.length})</span>
                </h3>

                {restaurantResults.length === 0 ? (
                  <div className="bg-white rounded-2xl p-6 text-center border border-slate-200 text-slate-500 text-xs">
                    No kitchens matched &quot;{search}&quot;.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {restaurantResults.map((r) => (
                      <Link
                        key={r.id}
                        to={`/restaurant/${r.id}`}
                        className="group bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-xs hover:shadow-md transition flex flex-col"
                      >
                        <div className="relative h-44 w-full bg-slate-100 overflow-hidden">
                          {r.cover_url ? (
                            <img
                              src={r.cover_url}
                              alt={r.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-emerald-600/10 to-amber-500/20 flex items-center justify-center text-slate-400">
                              <Store className="w-12 h-12 text-emerald-600/40" />
                            </div>
                          )}
                          <div className="absolute top-3 left-3">
                            <span
                              className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${
                                r.is_open ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
                              }`}
                            >
                              {r.is_open ? 'Open Now' : 'Closed'}
                            </span>
                          </div>
                          <div className="absolute bottom-3 right-3 bg-white/95 px-2 py-1 rounded-lg shadow-sm flex items-center gap-1 text-xs font-bold text-slate-800">
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                            <span>{Number(r.rating || 0).toFixed(1)}</span>
                          </div>
                        </div>

                        <div className="p-4 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="font-bold text-base text-slate-900 group-hover:text-emerald-600 transition">
                              {r.name}
                            </h3>
                            <p className="text-xs text-slate-500 font-medium mt-1">{r.cuisine_type}</p>
                            <p className="text-xs text-slate-400 mt-1 truncate">{r.address}, {r.city}</p>
                          </div>

                          <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              <span>{r.opening_time || '08:00'} - {r.closing_time || '22:00'}</span>
                            </div>
                            <span className="font-bold text-slate-800">Min {formatGHS(r.min_order_amount)}</span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Empty state when zero results */}
            {foodResults.length === 0 && restaurantResults.length === 0 && !isSearching && (
              <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-md mx-auto my-8 space-y-3">
                <Store className="w-12 h-12 text-slate-300 mx-auto" />
                <h3 className="text-base font-bold text-slate-900">No results found</h3>
                <p className="text-xs text-slate-500">
                  No food dishes or kitchens matched &quot;{search}&quot;. Try another search term.
                </p>
                <button
                  onClick={() => setSearch('')}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition"
                >
                  Clear Search
                </button>
              </div>
            )}
          </div>
        ) : (
          /* =====================================================================
              DEFAULT ALL RESTAURANTS VIEW
             ===================================================================== */
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3 animate-pulse"
                  >
                    <div className="h-40 bg-slate-200 rounded-xl" />
                    <div className="h-4 bg-slate-200 rounded w-2/3" />
                  </div>
                ))}
              </div>
            ) : defaultFilteredRestaurants.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-md mx-auto my-8">
                <Store className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-base font-bold text-slate-900">No restaurants found</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {cityFilter !== 'All'
                    ? `No partner restaurants found in ${cityFilter}.`
                    : 'No approved restaurants currently in the database.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {defaultFilteredRestaurants.map((r) => (
                  <Link
                    key={r.id}
                    to={`/restaurant/${r.id}`}
                    className="group bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-xs hover:shadow-md transition flex flex-col"
                  >
                    <div className="relative h-44 w-full bg-slate-100 overflow-hidden">
                      {r.cover_url ? (
                        <img
                          src={r.cover_url}
                          alt={r.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-emerald-600/10 to-amber-500/20 flex items-center justify-center text-slate-400">
                          <Store className="w-12 h-12 text-emerald-600/40" />
                        </div>
                      )}
                      <div className="absolute top-3 left-3">
                        <span
                          className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${
                            r.is_open ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
                          }`}
                        >
                          {r.is_open ? 'Open Now' : 'Closed'}
                        </span>
                      </div>
                      <div className="absolute bottom-3 right-3 bg-white/95 px-2 py-1 rounded-lg shadow-sm flex items-center gap-1 text-xs font-bold text-slate-800">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span>{Number(r.rating || 0).toFixed(1)}</span>
                      </div>
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-base text-slate-900 group-hover:text-emerald-600 transition">
                          {r.name}
                        </h3>
                        <p className="text-xs text-slate-500 font-medium mt-1">{r.cuisine_type}</p>
                        <p className="text-xs text-slate-400 mt-1 truncate">{r.address}, {r.city}</p>
                      </div>

                      <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{r.opening_time || '08:00'} - {r.closing_time || '22:00'}</span>
                        </div>
                        <span className="font-bold text-slate-800">Min {formatGHS(r.min_order_amount)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
