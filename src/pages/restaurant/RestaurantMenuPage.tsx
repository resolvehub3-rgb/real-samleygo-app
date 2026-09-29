import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ImageUp,
  X,
  Utensils,
  FolderPlus,
  RefreshCw,
  TriangleAlert,
  AlertCircle,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Restaurant, MenuItem, RestaurantCategory } from '../../types/database';
import { formatGHS } from '../../lib/pricing';
import { RestaurantShell } from '../../components/restaurant/RestaurantShell';
import { uploadRestaurantImage, describeUploadError } from '../../lib/restaurantMedia';

export const RestaurantMenuPage: React.FC = () => {
  const { user } = useAuth();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add Item Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [prepTime, setPrepTime] = useState('20');
  const [isSaving, setIsSaving] = useState(false);

  // Dish photo (device file) state
  const [dishFile, setDishFile] = useState<File | null>(null);
  const [dishPreview, setDishPreview] = useState<string | null>(null);
  const [dishUploadError, setDishUploadError] = useState<string | null>(null);
  const [usedFallbackPhoto, setUsedFallbackPhoto] = useState(false);
  const dishInputRef = useRef<HTMLInputElement | null>(null);

  // Add Category State
  const [newCatName, setNewCatName] = useState('');
  const [isAddingCat, setIsAddingCat] = useState(false);

  const fetchMenu = async () => {
    if (!user || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data: rData } = await supabase
        .from('restaurants')
        .select('*')
        .eq('owner_id', user.id)
        // maybeSingle: zero rows must not become a console-visible 406
        .maybeSingle();

      if (!rData) {
        setIsLoading(false);
        return;
      }

      setRestaurant(rData as Restaurant);

      // Fetch Categories
      const { data: cData } = await supabase
        .from('restaurant_categories')
        .select('*')
        .eq('restaurant_id', rData.id)
        .order('sort_order', { ascending: true });

      if (cData) setCategories(cData as RestaurantCategory[]);

      // Fetch Menu Items
      const { data: mData } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_id', rData.id)
        .order('name', { ascending: true });

      if (mData) setMenuItems(mData as MenuItem[]);
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Dish photo selection (from device) ──────────────────────────────
  const handleDishFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setDishUploadError('Please choose an image file (JPG, PNG or WebP).');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setDishUploadError('That photo is too large. Please choose one under 15 MB.');
      return;
    }

    setDishUploadError(null);
    setDishFile(file);
    // Instant local preview
    setDishPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const clearDishPhoto = () => {
    setDishFile(null);
    setDishPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDishUploadError(null);
    setUsedFallbackPhoto(false);
  };

  // Create Category
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant || !newCatName.trim()) return;

    setIsAddingCat(true);
    try {
      await supabase.from('restaurant_categories').insert({
        restaurant_id: restaurant.id,
        name: newCatName.trim(),
        sort_order: categories.length + 1,
      });

      setNewCatName('');
      fetchMenu();
    } catch {
      // Handled
    } finally {
      setIsAddingCat(false);
    }
  };

  // Create Menu Item — uploads the chosen device photo to Supabase Storage
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant || !user || !name.trim() || !price) return;

    setIsSaving(true);
    setDishUploadError(null);
    setUsedFallbackPhoto(false);

    try {
      let dishImageUrl: string | null = null;

      // 1. Upload the device photo (if one was chosen)
      if (dishFile) {
        const result = await uploadRestaurantImage(user.id, 'dish', dishFile, {
          maxDimension: 900,
          quality: 0.8,
        });
        dishImageUrl = result.url;
        setUsedFallbackPhoto(result.usedFallback);
      }

      // 2. Create the menu item
      const { error: insertError } = await supabase.from('menu_items').insert({
        restaurant_id: restaurant.id,
        category_id: categoryId || null,
        name: name.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
        preparation_time_minutes: parseInt(prepTime) || 20,
        image_url: dishImageUrl,
        is_available: true,
      });

      if (insertError) throw insertError;

      // 3. Close modal & reset
      setShowAddModal(false);
      setName('');
      setDescription('');
      setPrice('');
      setCategoryId('');
      clearDishPhoto();
      fetchMenu();
    } catch (err) {
      setDishUploadError(describeUploadError(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle Availability
  const handleToggleAvailability = async (item: MenuItem) => {
    await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id);

    setMenuItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_available: !i.is_available } : i))
    );
  };

  // Delete Item
  const handleDeleteItem = async (id: string) => {
    if (!window.confirm('Delete this dish from your restaurant menu?')) return;
    await supabase.from('menu_items').delete().eq('id', id);
    setMenuItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (!restaurant && !isLoading) {
    return (
      <RestaurantShell restaurant={null}>
        <div className="flex items-center justify-center p-4 py-10">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">Please register a restaurant first</h2>
            <Link
              to="/restaurant/dashboard"
              className="mt-4 inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
            >
              Go to Restaurant Dashboard
            </Link>
          </div>
        </div>
      </RestaurantShell>
    );
  }

  return (
    <RestaurantShell restaurant={restaurant}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 pb-28 lg:pb-12">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/restaurant/dashboard"
              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Menu Management
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {restaurant?.name} · Add &amp; update fresh Ghanaian dishes
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Dish</span>
          </button>
        </div>

        {/* Add Category Section */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="font-bold text-xs text-slate-900">Menu Categories</h3>
              <p className="text-[11px] text-slate-500">
                Current: {categories.map((c) => c.name).join(', ') || 'No categories created yet'}
              </p>
            </div>
          </div>

          <form onSubmit={handleAddCategory} className="flex items-center gap-2">
            <input
              type="text"
              required
              placeholder="e.g. Soups & Swallows"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              disabled={isAddingCat}
              className="py-1.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition disabled:opacity-50"
            >
              {isAddingCat ? 'Adding...' : 'Add Category'}
            </button>
          </form>
        </div>

        {/* Menu Items List */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-bold text-sm text-slate-900">
              Active Menu Dishes ({menuItems.length})
            </h2>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : menuItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No dishes added yet. Click &quot;Add New Dish&quot; above to build your menu!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {menuItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 flex items-start gap-3"
                >
                  {/* Dish photo thumbnail */}
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 flex items-center justify-center flex-shrink-0">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Utensils className="w-6 h-6 text-slate-300" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-slate-900 truncate">{item.name}</h4>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                          item.is_available ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {item.is_available ? 'Available' : 'Unavailable'}
                      </span>
                    </div>

                    {item.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.description}</p>
                    )}

                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <span className="font-extrabold text-emerald-700">{formatGHS(item.price)}</span>
                      <span className="text-slate-400">· {item.preparation_time_minutes} min prep</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0 self-center flex-col">
                    <button
                      onClick={() => handleToggleAvailability(item)}
                      title={item.is_available ? 'Mark Sold Out' : 'Mark Available'}
                      className={`p-2 rounded-xl border text-xs font-semibold transition ${
                        item.is_available
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {item.is_available ? 'In Stock' : 'Out'}
                    </button>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 transition"
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Add Dish Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white p-5 sm:p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add New Dish</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dish Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Special Smoked Tilapia & Banku"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Price (GH₵)</label>
                  <input
                    type="number"
                    step="0.50"
                    required
                    placeholder="45.00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Fresh ingredients, spices, accompaniments..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* ── Dish Photo — choose from device ─────────────── */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Dish Photo (from your device)
                </label>

                <input
                  ref={dishInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleDishFileChange}
                />

                {dishPreview ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200">
                    <img
                      src={dishPreview}
                      alt="Selected dish preview"
                      className="w-full h-40 object-cover"
                    />
                    <div className="absolute top-2 right-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => dishInputRef.current?.click()}
                        className="p-2 rounded-full bg-white/90 hover:bg-white text-slate-700 shadow-md transition active:scale-90"
                        aria-label="Change photo"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={clearDishPhoto}
                        className="p-2 rounded-full bg-white/90 hover:bg-white text-rose-600 shadow-md transition active:scale-90"
                        aria-label="Remove photo"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => dishInputRef.current?.click()}
                    className="w-full py-8 rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/50 flex flex-col items-center justify-center gap-2 transition"
                  >
                    <span className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                      <ImageUp className="w-5 h-5" />
                    </span>
                    <span className="text-xs font-bold text-slate-700">Choose photo from device</span>
                    <span className="text-[10px] text-slate-400">JPG, PNG or WebP · up to 15 MB</span>
                  </button>
                )}

                {dishUploadError && (
                  <div className="mt-2 flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-semibold">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{dishUploadError}</span>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    clearDishPhoto();
                  }}
                  className="py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-semibold text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {isSaving ? (dishFile ? 'Uploading & Saving…' : 'Saving…') : 'Add to Menu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fallback notice shown after the modal closes when storage was down */}
      {usedFallbackPhoto && !showAddModal && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 shadow-lg text-amber-800 text-[11px] font-semibold max-w-sm">
          <TriangleAlert className="w-4 h-4 flex-shrink-0" />
          <span>Dish saved with a reduced-size photo (storage was briefly unreachable). Retry the upload later for full quality.</span>
          <button
            onClick={() => setUsedFallbackPhoto(false)}
            className="p-0.5 text-amber-600 hover:text-amber-800 flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </RestaurantShell>
  );
};
