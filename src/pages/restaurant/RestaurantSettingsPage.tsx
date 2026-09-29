import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ImagePlus,
  Store,
  Star,
  MapPin,
  Check,
  AlertCircle,
  Sparkles,
  Eye,
  RefreshCw,
  TriangleAlert,
  LocateFixed,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Restaurant } from '../../types/database';
import { RestaurantShell } from '../../components/restaurant/RestaurantShell';
import { uploadRestaurantImage, describeUploadError } from '../../lib/restaurantMedia';
import { getCurrentPositionSafe, describeGeoError } from '../../lib/geolocation';
import { usePlaceLabel } from '../../hooks/usePlaceLabel';

type PhotoKind = 'logo' | 'cover';

export const RestaurantSettingsPage: React.FC = () => {
  const { user } = useAuth();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Profile form state
  const [name, setName] = useState('');
  const [cuisineType, setCuisineType] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [openingTime, setOpeningTime] = useState('');
  const [closingTime, setClosingTime] = useState('');
  /**
   * Kitchen GPS pin. Every live map in the platform (courier, customer,
   * restaurant) needs a restaurant coordinate — without it the pickup marker
   * has to be guessed from the address text.
   */
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  // Readable area for the saved pin ("East Legon, Accra" instead of raw
  // coordinates) — the coordinate pair stays the saved value, only the text
  // shown to the owner changes.
  const pinPlaceLabel = usePlaceLabel(pin);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Photo upload state
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [photoSuccess, setPhotoSuccess] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  // Keeps the last chosen file so the user can retry after a transient failure
  const lastFileRef = useRef<{ file: File; kind: PhotoKind } | null>(null);

  // ── Realtime: fetch the restaurant, then subscribe to live changes ──
  useEffect(() => {
    if (!user || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const load = async () => {
      const { data } = await supabase
        .from('restaurants')
        .select('*')
        .eq('owner_id', user.id)
        .limit(1)
        .maybeSingle();

      if (data) setRestaurant(data as Restaurant);
      setIsLoading(false);
    };

    load();

    // Live updates: if anything changes this restaurant row (including from
    // another device/admin), the settings view refreshes itself instantly.
    channel = supabase
      .channel(`restaurant-settings-live-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `owner_id=eq.${user.id}` },
        (payload) => {
          if (payload.new) {
            setRestaurant(payload.new as Restaurant);
          }
        }
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [user]);

  // Populate form fields whenever the restaurant record changes
  useEffect(() => {
    if (!restaurant) return;
    setName(restaurant.name || '');
    setCuisineType(restaurant.cuisine_type || '');
    setDescription(restaurant.description || '');
    setPhone(restaurant.phone || '');
    setAddress(restaurant.address || '');
    setCity(restaurant.city || '');
    setOpeningTime(restaurant.opening_time || '');
    setClosingTime(restaurant.closing_time || '');
    setPin(
      restaurant.latitude != null && restaurant.longitude != null
        ? { lat: restaurant.latitude, lng: restaurant.longitude }
        : null
    );
  }, [restaurant]);

  const refresh = async () => {
    if (!user || !isSupabaseConfigured) return;
    const { data } = await supabase
      .from('restaurants')
      .select('*')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();
    if (data) setRestaurant(data as Restaurant);
  };

  // Capture the kitchen's exact GPS point so pickup pins on every live map
  // land on the real door instead of an address-text approximation.
  const handleUseMyLocation = async () => {
    setIsLocating(true);
    setLocationNote(null);
    try {
      const point = await getCurrentPositionSafe({ highAccuracyFirst: true, timeoutMs: 12000 });
      setPin({ lat: point.lat, lng: point.lng });
    } catch (err) {
      setLocationNote(describeGeoError(err));
    } finally {
      setIsLocating(false);
    }
  };

  const toggleOpen = async () => {
    if (!restaurant) return;
    const next = !restaurant.is_open;
    setRestaurant({ ...restaurant, is_open: next }); // optimistic
    await supabase.from('restaurants').update({ is_open: next }).eq('id', restaurant.id);
    refresh();
  };

  // ── Photo upload (logo / cover) ─────────────────────────────────────
  const handlePhotoSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: PhotoKind
  ) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again still fires change
    e.target.value = '';
    if (!file || !user || !restaurant) return;

    lastFileRef.current = { file, kind };
    setPhotoError(null);
    setPhotoNotice(null);
    setPhotoSuccess(null);

    const setUploading = kind === 'logo' ? setIsUploadingLogo : setIsUploadingCover;
    setUploading(true);

    const column = kind === 'logo' ? 'logo_url' : 'cover_url';

    try {
      const result = await uploadRestaurantImage(user.id, kind, file, {
        maxDimension: kind === 'logo' ? 512 : 1200,
        quality: 0.82,
      });

      const { error: updateError } = await supabase
        .from('restaurants')
        .update({ [column]: result.url })
        .eq('id', restaurant.id);
      if (updateError) throw updateError;

      setRestaurant((prev) => (prev ? ({ ...prev, [column]: result.url } as Restaurant) : prev));

      if (result.usedFallback) {
        setPhotoNotice(
          'Photo saved and visible to customers, but Supabase Storage was temporarily unreachable ' +
            "(HTTP 520 — a transient Cloudflare error on Supabase's side), so a reduced-size copy " +
            'is being served. Try uploading again in a minute for full quality.'
        );
      } else {
        setPhotoSuccess(
          kind === 'logo' ? 'Logo uploaded — live for customers!' : 'Cover photo uploaded — live for customers!'
        );
        setTimeout(() => setPhotoSuccess(null), 4000);
      }
    } catch (err) {
      setPhotoError(describeUploadError(err));
    } finally {
      setUploading(false);
    }
  };

  // ── Save profile details ────────────────────────────────────────────
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant) return;
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      const { error } = await supabase
        .from('restaurants')
        .update({
          name: name.trim(),
          cuisine_type: cuisineType.trim(),
          description: description.trim() || null,
          phone: phone.trim(),
          address: address.trim(),
          city: city.trim(),
          opening_time: openingTime || null,
          closing_time: closingTime || null,
          // Keep any previously saved pin unless the owner re-captures it.
          latitude: pin?.lat ?? restaurant.latitude ?? null,
          longitude: pin?.lng ?? restaurant.longitude ?? null,
        })
        .eq('id', restaurant.id);

      if (error) throw error;

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <RestaurantShell restaurant={null}>
        <div className="p-6 max-w-5xl mx-auto space-y-5 animate-pulse">
          <div className="h-44 rounded-3xl bg-slate-200" />
          <div className="h-72 rounded-3xl bg-slate-200/70" />
        </div>
      </RestaurantShell>
    );
  }

  if (!restaurant) {
    return (
      <RestaurantShell restaurant={null}>
        <div className="p-6 max-w-xl mx-auto mt-10 bg-white rounded-3xl border border-slate-200 p-8 text-center shadow-sm">
          <Store className="w-10 h-10 text-emerald-600 mx-auto" />
          <h1 className="mt-3 text-lg font-black text-slate-900">No restaurant registered</h1>
          <p className="mt-1 text-xs text-slate-500">
            Register your kitchen on the dashboard first to manage settings and photos.
          </p>
        </div>
      </RestaurantShell>
    );
  }

  const isUploading = isUploadingLogo || isUploadingCover;

  return (
    <RestaurantShell restaurant={restaurant} onToggleOpen={toggleOpen}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5 pb-28 lg:pb-12">

        {/* ── Cover Photo Card ─────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="relative h-44 sm:h-56 bg-gradient-to-br from-[#02472d] via-emerald-800 to-emerald-900">
            {restaurant.cover_url && (
              <img
                src={restaurant.cover_url}
                alt={`${restaurant.name} cover`}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-black/10" />

            {/* Upload cover button */}
            <button
              onClick={() => coverInputRef.current?.click()}
              disabled={isUploading}
              className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/90 hover:bg-white text-slate-900 text-[11px] font-black shadow-md transition active:scale-95 disabled:opacity-60"
            >
              {isUploadingCover ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImagePlus className="w-3.5 h-3.5 text-emerald-700" />
              )}
              <span>{isUploadingCover ? 'Uploading…' : restaurant.cover_url ? 'Change Cover' : 'Upload Cover Photo'}</span>
            </button>

            {/* Logo thumbnail + its upload control */}
            <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3">
              <div className="flex items-end gap-3 min-w-0">
                <div className="relative group">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-white ring-2 ring-white shadow-lg flex items-center justify-center">
                    {restaurant.logo_url ? (
                      <img
                        src={restaurant.logo_url}
                        alt={`${restaurant.name} logo`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Store className="w-8 h-8 text-emerald-700" />
                    )}
                  </div>
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={isUploading}
                    className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-md transition active:scale-90 disabled:opacity-60"
                    aria-label={isUploadingLogo ? 'Uploading logo' : 'Upload logo'}
                  >
                    {isUploadingLogo ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="min-w-0 pb-1 text-white">
                  <p className="text-base sm:text-lg font-black truncate">{restaurant.name}</p>
                  <p className="text-[11px] text-emerald-100/90 truncate">
                    {restaurant.cuisine_type} · {restaurant.city}
                  </p>
                </div>
              </div>

              <span
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ring-1 flex-shrink-0 ${
                  restaurant.is_open
                    ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30'
                    : 'bg-rose-400/15 text-rose-200 ring-rose-300/30'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${restaurant.is_open ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                {restaurant.is_open ? 'Open' : 'Closed'}
              </span>
            </div>
          </div>

          {/* Customer-view note */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500">
            <Eye className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
            <span>
              Photos saved here appear instantly on the customer homepage, explore page and restaurant detail page.
            </span>
          </div>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handlePhotoSelected(e, 'logo')}
        />
        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handlePhotoSelected(e, 'cover')}
        />

        {/* Photo feedback banners */}
        {photoSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{photoSuccess}</span>
          </div>
        )}
        {photoNotice && (
          <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
            <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{photoNotice}</span>
            {lastFileRef.current && (
              <button
                onClick={() => {
                  const { file, kind } = lastFileRef.current!;
                  handlePhotoSelected(
                    { target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>,
                    kind
                  );
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-black hover:bg-amber-700 transition flex-shrink-0"
              >
                Retry full quality
              </button>
            )}
          </div>
        )}
        {photoError && (
          <div className="flex items-start gap-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p>{photoError}</p>
              <p className="mt-1 font-normal text-rose-600/90">
                Your database connection itself is healthy — this only affects photo storage.
              </p>
            </div>
          </div>
        )}

        {/* ── Profile Form ─────────────────────────────────────── */}
        <form onSubmit={handleSaveProfile} className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5">

          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-black text-slate-900">Restaurant Profile</h2>
            <span className="ml-auto text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Updates go live instantly
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Restaurant Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Primary Cuisine</label>
              <input
                type="text"
                value={cuisineType}
                onChange={(e) => setCuisineType(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Kitchen Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell customers what makes your kitchen special…"
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Address / Landmark</label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={isLocating}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-100 active:scale-95 disabled:opacity-60"
                  title="Use this device's GPS to pin your kitchen"
                >
                  <LocateFixed className={`w-3.5 h-3.5 ${isLocating ? 'animate-pulse' : ''}`} />
                  <span>{isLocating ? 'Locating…' : 'Set exact map location'}</span>
                </button>
                <span className="text-[11px] text-slate-500">
                  {pin
                    ? `Pin saved · ${
                        pinPlaceLabel ||
                        `${pin.lat.toFixed(4)}°, ${pin.lng.toFixed(4)}°`
                      }`
                    : 'No pin yet — the live map will match your address text.'}
                </span>
              </div>
              {locationNote && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-rose-600">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{locationNote}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Opens</label>
                <input
                  type="time"
                  value={openingTime}
                  onChange={(e) => setOpeningTime(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Closes</label>
                <input
                  type="time"
                  value={closingTime}
                  onChange={(e) => setClosingTime(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                />
              </div>
            </div>
          </div>

          {/* Save feedback */}
          {saveSuccess && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
              <Check className="w-4 h-4 text-emerald-600" />
              Saved! Customers now see your updated details.
            </div>
          )}
          {saveError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-sm transition active:scale-[0.98] disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>

        {/* ── Rating summary ───────────────────────────────────── */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5 sm:p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Star className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Customer Rating</p>
              <p className="text-[11px] text-slate-400">
                {Number(restaurant.rating || 0).toFixed(1)} ★ from {restaurant.total_reviews} reviews
              </p>
            </div>
          </div>
          <span className="text-2xl font-black text-slate-900">
            {Number(restaurant.rating || 0).toFixed(1)}
            <span className="text-amber-500 text-base"> ★</span>
          </span>
        </div>

      </div>
    </RestaurantShell>
  );
};
