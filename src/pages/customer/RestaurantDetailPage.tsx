import React, { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
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
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Restaurant, MenuItem, RestaurantCategory } from '../../types/database';
import { useCart } from '../../context/CartContext';
import { formatGHS } from '../../lib/pricing';
import { MealExtrasPicker } from '../../components/customer/MealExtrasPicker';
import {
  AddonSelection,
  cartLineKey,
  extrasToSelection,
  lineTotal,
  mealAddonView,
  selectionToExtras,
  validateAddonSelection,
} from '../../lib/addons';
import {
  EMPTY_ADDON_CATALOG,
  RestaurantAddonCatalog,
  loadRestaurantAddonCatalog,
} from '../../lib/addonCatalog';

export const RestaurantDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { addItem, updateLine, totalCount, subtotal, items: cartItems } = useCart();
  // "/restaurant/x?item=<dish>&line=<key>" is how the cart says
  // "open this dish with the extras it already has".
  const [searchParams, setSearchParams] = useSearchParams();

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

  // ── Add extras ────────────────────────────────────────────────────────
  const [catalog, setCatalog] = useState<RestaurantAddonCatalog>(EMPTY_ADDON_CATALOG);
  const [selection, setSelection] = useState<AddonSelection>({});
  const [selectionError, setSelectionError] = useState('');
  /** The cart line being edited, when the customer came here from the cart. */
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let menuChannel: ReturnType<typeof supabase.channel> | null = null;
    let addonChannel: ReturnType<typeof supabase.channel> | null = null;

    /**
     * Loads the dishes, the categories and the add-on catalogue.
     * Returns whether the database can serve add-ons at all (i.e. migration
     * 20261015 has been applied) so the add-on realtime listener is only
     * created when there is a table to listen to.
     */
    const loadRestaurant = async (): Promise<boolean> => {
      if (!id || !isSupabaseConfigured) {
        setIsLoading(false);
        return false;
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
          return false;
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

        const items = (itemsData ?? []) as MenuItem[];
        setMenuItems(items);

        // Add-ons are optional. A kitchen that configured none — or a database
        // that has not run migration 20261015 — shows a plain menu, and this
        // never throws and never delays the dishes it already has.
        const addonCatalog = await loadRestaurantAddonCatalog(
          id,
          items.map((item) => item.id)
        );
        setCatalog(addonCatalog);
        return addonCatalog.supported;
      } catch {
        return false;
      } finally {
        setIsLoading(false);
      }
    };

    (async () => {
      const addonsSupported = await loadRestaurant();
      if (disposed) return;

      // Subscribe to menu changes in real-time
      if (isSupabaseConfigured && id) {
        menuChannel = supabase
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
                setMenuLiveToast('A new dish was just added to this menu.');
                setTimeout(() => setMenuLiveToast(null), 4000);
              } else if (payload.eventType === 'UPDATE') {
                setMenuLiveToast('A dish price or availability just changed.');
                setTimeout(() => setMenuLiveToast(null), 3000);
              }
            }
          )
          .subscribe();

        // An extra that sells out or changes price must reach an open menu too.
        if (addonsSupported) {
          addonChannel = supabase
            .channel(`restaurant-addons-${id}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'menu_addons',
                filter: `restaurant_id=eq.${id}`,
              },
              () => {
                loadRestaurant();
              }
            )
            .subscribe();
        }
      }
    })();

    return () => {
      disposed = true;
      if (menuChannel) supabase.removeChannel(menuChannel);
      if (addonChannel) supabase.removeChannel(addonChannel);
    };
  }, [id]);

  // ── Opening / closing the dish sheet ──────────────────────────────────
  const resetExtras = () => {
    setSelection({});
    setSelectionError('');
    setEditingLineKey(null);
  };

  /** A plain tap on a dish: nothing selected yet, nothing carried over. */
  const openItem = (item: MenuItem) => {
    setSelectedItem(item);
    setItemQuantity(1);
    setItemNotes('');
    resetExtras();
  };

  /**
   * Every close path goes through here so the cart's deep link
   * (`?item=…&line=…`) is cleared too — otherwise the sheet would pop straight
   * back open the next time the menu refetched.
   */
  const closeItemModal = () => {
    setSelectedItem(null);
    resetExtras();
    if (searchParams.has('item') || searchParams.has('line')) {
      const next = new URLSearchParams(searchParams);
      next.delete('item');
      next.delete('line');
      setSearchParams(next, { replace: true });
    }
  };

  // The cart's "Edit extras" link: reopen this dish carrying the quantities
  // and notes the line already has, so the customer edits instead of guessing.
  useEffect(() => {
    const itemId = searchParams.get('item');
    if (!itemId || menuItems.length === 0 || selectedItem) return;
    const target = menuItems.find((item) => item.id === itemId);
    if (!target || !target.is_available) return;

    const lineKey = searchParams.get('line');
    const line = lineKey
      ? cartItems.find(
          (item) => cartLineKey(item) === lineKey && item.menuItem.id === itemId
        )
      : undefined;

    setSelectedItem(target);
    setItemQuantity(line?.quantity ?? 1);
    setItemNotes(line?.notes ?? '');
    setSelection(line ? extrasToSelection(line.extras) : {});
    setSelectionError('');
    setEditingLineKey(line && lineKey ? lineKey : null);
    // Deliberately keyed on the link and the menu: the cart is only read once,
    // when the link is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, menuItems]);

  // While the sheet is open the page behind it must not scroll, and the
  // Escape key closes it — the same thing the X and the backdrop do.
  useEffect(() => {
    if (!selectedItem) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeItemModal();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem]);

  const handleAddToCart = () => {
    if (!selectedItem || !restaurant) return;

    const view = mealAddonView(selectedItem, catalog);

    // The restaurant's rules first: required groups, minimums, maximums,
    // sold-out extras and per-extra quantity caps.
    const problem = validateAddonSelection(selection, view.groups, view.mealAddons);
    if (problem) {
      setSelectionError(problem);
      return;
    }
    setSelectionError('');

    const extras = selectionToExtras(selection, view.mealAddons);

    if (editingLineKey) {
      // Came here from the cart → replace that line, keep it as one line.
      updateLine(editingLineKey, { quantity: itemQuantity, notes: itemNotes, extras });
    } else {
      // The same dish with a different combination becomes its own line.
      for (let i = 0; i < itemQuantity; i++) {
        addItem(selectedItem, restaurant, itemNotes, extras);
      }
    }

    closeItemModal();
    setItemQuantity(1);
    setItemNotes('');
    setAddedToast(true);
    setTimeout(() => setAddedToast(false), 2500);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas py-12 px-4 max-w-5xl mx-auto space-y-6">
        <div className="h-64 bg-slate-200 rounded-3xl animate-pulse" />
        <div className="h-8 bg-slate-200 rounded w-1/3 animate-pulse" />
        <div className="h-4 bg-slate-200 rounded w-1/4 animate-pulse" />
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
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

  // Everything the open sheet needs to show, price and validate the extras.
  const activeView = selectedItem ? mealAddonView(selectedItem, catalog) : null;
  const activeExtras = activeView ? selectionToExtras(selection, activeView.mealAddons) : [];
  const activeTotal = selectedItem
    ? lineTotal({ menuItem: selectedItem, quantity: itemQuantity, extras: activeExtras })
    : 0;

  return (
    <div className="min-h-screen pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-14 bg-canvas">
      
      {/* Added Toast Notification */}
      {addedToast && (
        <div className="fixed top-20 right-4 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-4">
          <Check className="w-4 h-4" />
          <span>Added to your SamleyGo order!</span>
        </div>
      )}

      {/* Realtime Menu Update Toast */}
      {menuLiveToast && (
        <div className="fixed inset-x-3 top-20 z-50 animate-sg-in rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-2.5 text-xs font-semibold text-white shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-sm">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span>{menuLiveToast}</span>
          </span>
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
          <div className="w-full h-full bg-brand-deep" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/30" />

        <div className="absolute top-4 left-4 z-10">
          <Link
            to="/restaurants"
            className="flex h-11 items-center gap-1.5 rounded-xl bg-white/90 px-3.5 text-xs font-bold text-slate-900 shadow-md transition hover:bg-white"
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
                <h1 className="text-xl sm:text-3xl font-bold tracking-tight">{restaurant.name}</h1>
                <span
                  className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded ${
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
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight border-b border-slate-200 pb-2">
                    {category.name}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {items.map((item) => (
                      <MenuItemCard
                        key={item.id}
                        item={item}
                        onSelect={() => openItem(item)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {/* Uncategorized Items */}
            {uncategorizedItems.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight border-b border-slate-200 pb-2">
                  Chef&apos;s Specials &amp; Dishes
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {uncategorizedItems.map((item) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      onSelect={() => openItem(item)}
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
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden sm:items-center sm:p-4">
          {/* Tapping the dimmed backdrop closes the sheet, exactly like the X. */}
          <button
            type="button"
            aria-label="Close dish details"
            onClick={() => closeItemModal()}
            className="absolute inset-0 cursor-default bg-nav-ink/60 backdrop-blur-[3px] animate-in fade-in"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedItem.name}
            className="relative flex max-h-[94vh] w-full flex-col overflow-hidden bg-white shadow-[0_-12px_50px_rgba(2,71,45,0.35)] animate-in slide-in-from-bottom-10 duration-300 sm:max-h-[88vh] sm:max-w-lg sm:rounded-[28px] sm:shadow-2xl sm:animate-in sm:zoom-in-95"
          >
            {/* Mobile grab handle — visual only; the sheet itself is not draggable. */}
            <div className="absolute left-1/2 top-2 z-20 h-1 w-10 -translate-x-1/2 rounded-full bg-white/60 sm:hidden" />

            {/* Hero */}
            <div className="relative h-56 shrink-0 overflow-hidden bg-brand-deep sm:h-60">
              {selectedItem.image_url ? (
                <>
                  <img
                    src={selectedItem.image_url}
                    alt={selectedItem.name}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-nav-ink/80 via-nav-ink/10 to-nav-ink/35" />
                </>
              ) : (
                /* A kitchen that uploaded no photo gets brand art, not a grey box. */
                <div className="h-full w-full bg-[radial-gradient(circle_at_22%_18%,#059669_0%,transparent_55%),radial-gradient(circle_at_82%_78%,#22d3ee_0%,transparent_48%),linear-gradient(140deg,#02472d_0%,#0f6b62_55%,#059669_100%)]">
                  <Utensils
                    className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 text-white/25"
                    aria-hidden="true"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => closeItemModal()}
                aria-label="Close dish details"
                className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-nav-ink/45 text-white backdrop-blur-sm transition hover:bg-nav-ink/70 active:scale-95"
              >
                <X className="w-5 h-5" />
              </button>

              {!selectedItem.is_available && (
                <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow">
                  Sold out
                </span>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-black leading-tight tracking-tight text-slate-900 sm:text-xl">
                  {selectedItem.name}
                </h3>
                <div className="shrink-0 rounded-2xl bg-emerald-50 px-3 py-1.5 text-right ring-1 ring-emerald-100">
                  <span className="block text-[9px] font-bold uppercase tracking-widest text-emerald-600">
                    Price
                  </span>
                  <span className="block text-base font-black tabular-nums text-brand-dark">
                    {formatGHS(selectedItem.price)}
                  </span>
                </div>
              </div>

              {/* Only facts the kitchen actually configured — never an invented rating. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Utensils className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                  <span className="font-semibold text-slate-600">{restaurant.name}</span>
                </span>
                {selectedItem.preparation_time_minutes > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                    <span>{selectedItem.preparation_time_minutes} min prep</span>
                  </span>
                )}
                {Number(restaurant.rating) > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                    <span className="tabular-nums">{Number(restaurant.rating).toFixed(1)}</span>
                  </span>
                )}
              </div>

              {selectedItem.description && (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  {selectedItem.description}
                </p>
              )}

              {/* Add extras / Make it a combo — only rendered when the
                  restaurant actually configured extras for this dish. */}
              <MealExtrasPicker
                menuItem={selectedItem}
                catalog={catalog}
                selection={selection}
                onChange={(next) => {
                  setSelection(next);
                  setSelectionError('');
                }}
                error={selectionError}
              />

              {/* Special Instructions */}
              <div className="mt-5">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <label htmlFor="dish-notes" className="text-xs font-bold text-slate-700">
                    Special Kitchen Notes
                  </label>
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {itemNotes.length}/140 · optional
                  </span>
                </div>
                <textarea
                  id="dish-notes"
                  rows={2}
                  maxLength={140}
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="e.g. Extra shito, separate gravy, mild pepper..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed placeholder:text-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Sticky action bar — the total here is meal + extras + quantity,
                recalculated on every change above. */}
            <div className="shrink-0 border-t border-slate-100 bg-white/95 px-5 py-3.5 backdrop-blur-sm sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                    disabled={itemQuantity <= 1 || !selectedItem.is_available}
                    aria-label={`Decrease ${selectedItem.name} quantity`}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 active:scale-95 disabled:cursor-not-allowed disabled:text-slate-300 disabled:shadow-none"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-6 text-center text-sm font-black tabular-nums text-slate-900">
                    {itemQuantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setItemQuantity(itemQuantity + 1)}
                    disabled={!selectedItem.is_available}
                    aria-label={`Increase ${selectedItem.name} quantity`}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 active:scale-95 disabled:cursor-not-allowed disabled:text-slate-300 disabled:shadow-none"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={!selectedItem.is_available}
                  className="group relative flex h-14 flex-1 items-center justify-between gap-2 overflow-hidden rounded-2xl bg-brand pl-2.5 pr-3 text-white shadow-lg shadow-brand/25 transition hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                >
                  {/* One soft sheen sweep on hover — pure decoration. */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
                  />

                  <span className="relative flex items-center gap-2">
                    {editingLineKey ? (
                      <Check className="h-4.5 w-4.5" />
                    ) : (
                      <ShoppingBag className="h-4.5 w-4.5" />
                    )}
                    <span className="text-[13px] font-extrabold tracking-tight">
                      {selectedItem.is_available
                        ? editingLineKey
                          ? 'Update Cart'
                          : 'Add to Cart'
                        : 'Sold out today'}
                    </span>
                  </span>

                  <span className="relative rounded-xl bg-white/20 px-3 py-1.5 text-[13px] font-black tabular-nums">
                    {formatGHS(activeTotal)}
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
              className="w-full py-3.5 px-5 rounded-2xl bg-brand hover:bg-brand-dark text-white font-bold text-sm shadow-xl shadow-brand/30 flex items-center justify-between transition active:scale-[0.98]"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-xs font-bold">
                  {totalCount}
                </span>
                <span>View Cart &amp; Checkout</span>
              </div>
              <div className="flex items-center gap-1.5 font-bold">
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
      role="button"
      tabIndex={item.is_available ? 0 : -1}
      aria-label={item.is_available ? `View ${item.name} options` : `${item.name} is sold out`}
      onClick={() => item.is_available && onSelect()}
      onKeyDown={(event) => {
        if (!item.is_available) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition focus-visible:outline-2 focus-visible:outline-brand ${
        item.is_available ? 'hover:border-emerald-500/50 hover:shadow-md' : 'cursor-not-allowed opacity-50'
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
            <div aria-hidden="true" className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-md">
              <Plus className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      ) : (
        item.is_available && (
          <button className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 transition hover:bg-emerald-600 hover:text-white">
            <Plus className="w-4 h-4" />
          </button>
        )
      )}
    </div>
  );
};
