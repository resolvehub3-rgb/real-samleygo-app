import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Star,
  MapPin,
  Clock,
  Phone,
  Plus,
  Minus,
  ShoppingBag,
  ArrowLeft,
  ArrowRight,
  Utensils,
  X,
  Check,
  Sparkles,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Restaurant, MenuItem, RestaurantCategory } from '../../types/database';
import { useCart } from '../../context/CartContext';
import { formatGHS } from '../../lib/pricing';

export const RestaurantDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { addItem, totalCount, subtotal } = useCart();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Selected item modal state
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemNotes, setItemNotes] = useState('');
  const [addedToast, setAddedToast] = useState(false);
  const [menuLiveToast, setMenuLiveToast] = useState<string | null>(null);

  useEffect(() => {
    async function loadRestaurant() {
      if (!id || !isSupabaseConfigured) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        // Fetch restaurant
        const { data: restData, error: restError } = await supabase
          .from('restaurants')
          .select('*')
          .eq('id', id)
          // maybeSingle: a missing/unauthorised id returns null, not HTTP 406
          .maybeSingle();

        if (restError || !restData) {
          setIsLoading(false);
          return;
        }

        setRestaurant(restData as Restaurant);

        // Fetch categories
        const { data: catData } = await supabase
          .from('restaurant_categories')
          .select('*')
          .eq('restaurant_id', id)
          .order('sort_order', { ascending: true });

        if (catData) setCategories(catData as RestaurantCategory[]);

        // Fetch menu items
        const { data: itemsData } = await supabase
          .from('menu_items')
          .select('*')
          .eq('restaurant_id', id)
          .order('name', { ascending: true });

        if (itemsData) setMenuItems(itemsData as MenuItem[]);
      } catch {
        // Handled
      } finally {
        setIsLoading(false);
      }
    }

    loadRestaurant();

    // Subscribe to menu changes in real-time
    if (isSupabaseConfigured && id) {
      const channel = supabase
        .channel(`restaurant-menu-${id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'menu_items',
            filter: `restaurant_id=eq.${id}`,
          },
          (payload) => {
            loadRestaurant();
            if (payload.eventType === 'INSERT') {
              setMenuLiveToast('✨ A new dish was just added to the menu in realtime!');
              setTimeout(() => setMenuLiveToast(null), 4000);
            } else if (payload.eventType === 'UPDATE') {
              setMenuLiveToast('🔄 Menu item price/availability updated live!');
              setTimeout(() => setMenuLiveToast(null), 3000);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [id]);

  const handleAddToCart = () => {
    if (!selectedItem || !restaurant) return;
    for (let i = 0; i < itemQuantity; i++) {
      addItem(selectedItem, restaurant, itemNotes);
    }
    setSelectedItem(null);
    setItemQuantity(1);
    setItemNotes('');
    setAddedToast(true);
    setTimeout(() => setAddedToast(false), 2500);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 max-w-5xl mx-auto space-y-6">
        <div className="h-64 bg-slate-200 rounded-3xl animate-pulse" />
        <div className="h-8 bg-slate-200 rounded w-1/3 animate-pulse" />
        <div className="h-4 bg-slate-200 rounded w-1/4 animate-pulse" />
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200 shadow-xs">
          <Utensils className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Restaurant Not Found</h2>
          <p className="text-xs text-slate-500 mt-1">
            This restaurant may have been unlisted or does not exist in the database.
          </p>
          <Link
            to="/restaurants"
            className="mt-6 inline-block px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition"
          >
            Explore Other Kitchens
          </Link>
        </div>
      </div>
    );
  }

  // Group items by category
  const uncategorizedItems = menuItems.filter((i) => !i.category_id);

  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      
      {/* Added Toast Notification */}
      {addedToast && (
        <div className="fixed top-20 right-4 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-4">
          <Check className="w-4 h-4" />
          <span>Added to your SamleyGo order!</span>
        </div>
      )}

      {/* Realtime Menu Update Toast */}
      {menuLiveToast && (
        <div className="fixed top-20 left-4 right-4 sm:left-auto sm:right-4 z-50 bg-gradient-to-r from-emerald-700 to-teal-700 text-white px-4 py-2.5 rounded-2xl shadow-2xl border border-emerald-400/40 flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-4">
          <Sparkles className="w-4 h-4 text-amber-300 animate-spin" />
          <span>{menuLiveToast}</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="relative h-60 sm:h-80 w-full bg-slate-900">
        {restaurant.cover_url ? (
          <img
            src={restaurant.cover_url}
            alt={restaurant.name}
            className="w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-emerald-800 to-teal-900 opacity-90" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/30" />

        <div className="absolute top-4 left-4 z-10">
          <Link
            to="/restaurants"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/90 text-slate-900 text-xs font-bold shadow-md hover:bg-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Link>
        </div>

        {/* Restaurant Badge & Info at Bottom of Banner */}
        <div className="absolute bottom-4 left-4 right-4 max-w-7xl mx-auto flex items-end justify-between gap-4 text-white">
          <div className="flex items-center gap-3">
            {restaurant.logo_url && (
              <img
                src={restaurant.logo_url}
                alt={restaurant.name}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-white shadow-lg bg-white"
              />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-3xl font-black tracking-tight">{restaurant.name}</h1>
                <span
                  className={`text-[9px] uppercase font-black px-2 py-0.5 rounded ${
                    restaurant.is_open ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                >
                  {restaurant.is_open ? 'Open' : 'Closed'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-emerald-200 font-semibold">{restaurant.cuisine_type}</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1 bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-xl text-xs font-bold">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span>{Number(restaurant.rating || 0).toFixed(1)}</span>
            <span className="text-emerald-100 font-normal">({restaurant.total_reviews} reviews)</span>
          </div>
        </div>
      </div>

      {/* Meta Bar */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 font-medium">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span>{restaurant.address}, {restaurant.city}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-emerald-600" />
              <span>Hours: {restaurant.opening_time || '08:00'} - {restaurant.closing_time || '22:00'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Phone className="w-4 h-4 text-emerald-600" />
              <span>{restaurant.phone}</span>
            </div>
          </div>
          <div>
            <span className="text-slate-400">Min. Order: </span>
            <span className="font-bold text-slate-900">{formatGHS(restaurant.min_order_amount)}</span>
          </div>
        </div>
      </div>

      {/* Menu Sections */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {menuItems.length === 0 ? (
          /* Empty Menu State */
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-md mx-auto my-8">
            <Utensils className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-900">No dishes on the menu yet</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              This kitchen is currently updating their fresh Ghanaian menu items. Check back shortly!
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Categorized Items */}
            {categories.map((category) => {
              const items = menuItems.filter((i) => i.category_id === category.id);
              if (items.length === 0) return null;

              return (
                <section key={category.id} className="space-y-4">
                  <h2 className="text-lg font-black text-slate-900 tracking-tight border-b border-slate-200 pb-2">
                    {category.name}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {items.map((item) => (
                      <MenuItemCard
                        key={item.id}
                        item={item}
                        onSelect={() => {
                          setSelectedItem(item);
                          setItemQuantity(1);
                        }}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {/* Uncategorized Items */}
            {uncategorizedItems.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-lg font-black text-slate-900 tracking-tight border-b border-slate-200 pb-2">
                  Chef&apos;s Specials &amp; Dishes
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {uncategorizedItems.map((item) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      onSelect={() => {
                        setSelectedItem(item);
                        setItemQuantity(1);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Floating Bottom Cart Bar for Customers */}
      {totalCount > 0 && (
        <div className="fixed bottom-16 md:bottom-6 left-4 right-4 md:left-auto md:right-8 md:w-96 z-40">
          <Link
            to="/cart"
            className="flex items-center justify-between p-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-2xl shadow-emerald-600/30 transition transform active:scale-95"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-extrabold text-xs">
                {totalCount}
              </div>
              <span>View Cart &amp; Checkout</span>
            </div>
            <span>{formatGHS(subtotal)}</span>
          </Link>
        </div>
      )}

      {/* Item Details & Add to Cart Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white overflow-hidden shadow-2xl animate-in zoom-in-95">
            {selectedItem.image_url && (
              <div className="h-48 w-full bg-slate-100 relative">
                <img
                  src={selectedItem.image_url}
                  alt={selectedItem.name}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => setSelectedItem(null)}
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}

            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedItem.name}</h3>
                  <p className="text-base font-extrabold text-emerald-700 mt-1">
                    {formatGHS(selectedItem.price)}
                  </p>
                </div>
                {!selectedItem.image_url && (
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="p-1 rounded-full text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {selectedItem.description && (
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  {selectedItem.description}
                </p>
              )}

              {/* Special Instructions */}
              <div className="mt-5">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Special Kitchen Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="e.g. Extra shito, separate gravy, mild pepper..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Quantity Controls & Action */}
              <div className="mt-6 flex items-center justify-between gap-4 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-3 border border-slate-200 rounded-xl p-1 bg-slate-50">
                  <button
                    onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                    className="w-8 h-8 rounded-lg bg-white shadow-xs flex items-center justify-center text-slate-700 hover:bg-slate-100"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="font-bold text-sm w-6 text-center">{itemQuantity}</span>
                  <button
                    onClick={() => setItemQuantity(itemQuantity + 1)}
                    className="w-8 h-8 rounded-lg bg-white shadow-xs flex items-center justify-center text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={handleAddToCart}
                  disabled={!selectedItem.is_available}
                  className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>
                    Add to Cart · {formatGHS(selectedItem.price * itemQuantity)}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Floating Cart Checkout Bar */}
      {totalCount > 0 && (
        <div className="fixed bottom-16 md:bottom-6 left-0 right-0 z-40 px-4 pointer-events-none pb-safe">
          <div className="max-w-md mx-auto pointer-events-auto">
            <Link
              to="/cart"
              className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-sm shadow-2xl shadow-emerald-700/50 flex items-center justify-between transition active:scale-[0.98] border border-emerald-400/30"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-xs font-black">
                  {totalCount}
                </span>
                <span>View Cart &amp; Checkout</span>
              </div>
              <div className="flex items-center gap-1.5 font-black">
                <span>{formatGHS(subtotal)}</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

// Reusable Menu Item Card
const MenuItemCard: React.FC<{ item: MenuItem; onSelect: () => void }> = ({
  item,
  onSelect,
}) => {
  return (
    <div
      onClick={() => item.is_available && onSelect()}
      className={`bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-between gap-4 transition ${
        item.is_available
          ? 'cursor-pointer hover:border-emerald-500/50 hover:shadow-md'
          : 'opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-sm text-slate-900 truncate">{item.name}</h4>
        {item.description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span className="font-extrabold text-sm text-emerald-700">
            {formatGHS(item.price)}
          </span>
          {!item.is_available && (
            <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
              Sold Out
            </span>
          )}
        </div>
      </div>

      {item.image_url ? (
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0 relative">
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-full object-cover"
          />
          {item.is_available && (
            <div className="absolute bottom-1 right-1 w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-md">
              <Plus className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      ) : (
        item.is_available && (
          <button className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition flex-shrink-0">
            <Plus className="w-4 h-4" />
          </button>
        )
      )}
    </div>
  );
};
