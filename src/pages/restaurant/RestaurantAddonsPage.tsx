import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ImageUp,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';

import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { RestaurantShell } from '../../components/restaurant/RestaurantShell';
import { describeUploadError, uploadRestaurantImage } from '../../lib/restaurantMedia';
import { describeGroupHint, effectiveGroupMin } from '../../lib/addons';
import type {
  AddonGroup,
  AddonOffering,
  MenuAddon,
  MenuItem,
  Restaurant,
  RestaurantCategory,
} from '../../types/database';

type Tab = 'extras' | 'groups';

interface ExtraDraft {
  id: string | null;
  name: string;
  description: string;
  price: string;
  categoryId: string;
  maxQuantity: string;
  isAvailable: boolean;
  offering: AddonOffering;
  imageUrl: string | null;
  /** Only consulted when `offering === 'SELECT'`. */
  mealIds: string[];
}

interface GroupDraft {
  id: string | null;
  name: string;
  description: string;
  isRequired: boolean;
  minSelect: string;
  maxSelect: string;
  /** `menu_addon_id` values offered by this group. */
  addonIds: string[];
}

const EMPTY_EXTRA_DRAFT: ExtraDraft = {
  id: null,
  name: '',
  description: '',
  price: '',
  categoryId: '',
  maxQuantity: '10',
  isAvailable: true,
  offering: 'ALL',
  imageUrl: null,
  mealIds: [],
};

const EMPTY_GROUP_DRAFT: GroupDraft = {
  id: null,
  name: '',
  description: '',
  isRequired: false,
  minSelect: '0',
  maxSelect: '0',
  addonIds: [],
};

const describeError = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (!raw) return 'Something went wrong. Please try again.';
  if (/row-level security|policy/i.test(raw)) {
    return `${raw}. Only the restaurant's own owner can change its add-ons — reload the page and try again.`;
  }
  return raw;
};

const isMissingTable = (message?: string): boolean =>
  !!message && /does not exist|could not find table|schema cache/i.test(message);

/**
 * Restaurant-owner manager for "Add extras".
 *
 * Two tabs: the extras themselves (name, price, photo, category, availability,
 * quantity cap and which meals they belong on) and the selection groups that
 * turn a plain extra into a required choice ("Choose a drink", min/max).
 *
 * Nothing here is trusted: every write goes through `menu_addons`,
 * `addon_groups`, `addon_group_items` and `menu_item_addons`, whose row-level
 * security only lets the restaurant's own owner (or a super admin) write, and
 * the customer side still re-reads the price at checkout and lets the
 * database have the final word.
 *
 * If migration 20261015 has not been applied yet the page says so plainly
 * instead of pretending the feature exists.
 */
export const RestaurantAddonsPage: React.FC = () => {
  const { user } = useAuth();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [addons, setAddons] = useState<MenuAddon[]>([]);
  const [groups, setGroups] = useState<AddonGroup[]>([]);
  /** groupId → the `menu_addon_id` values it offers. */
  const [groupOptions, setGroupOptions] = useState<Record<string, string[]>>({});
  /** menu_addon_id → the meal ids it is offered on (only for `offering='SELECT'`). */
  const [addonMeals, setAddonMeals] = useState<Record<string, string[]>>({});

  const [tab, setTab] = useState<Tab>('extras');
  const [isLoading, setIsLoading] = useState(true);
  const [dbSupported, setDbSupported] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [extraDraft, setExtraDraft] = useState<ExtraDraft | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);

  // Photo chosen from the device for the extra being edited.
  const [extraFile, setExtraFile] = useState<File | null>(null);
  const [extraPreview, setExtraPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const extraInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAll = async () => {
    if (!user || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data: rData } = await supabase
        .from('restaurants')
        .select('*')
        .eq('owner_id', user.id)
        // maybeSingle: an owner without a restaurant is normal, not an HTTP 406
        .maybeSingle();

      if (!rData) {
        setIsLoading(false);
        return;
      }
      setRestaurant(rData as Restaurant);

      const [{ data: cData }, { data: mData }] = await Promise.all([
        supabase
          .from('restaurant_categories')
          .select('*')
          .eq('restaurant_id', rData.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('menu_items')
          .select('*')
          .eq('restaurant_id', rData.id)
          .order('name', { ascending: true }),
      ]);
      setCategories((cData ?? []) as RestaurantCategory[]);
      setMenuItems((mData ?? []) as MenuItem[]);

      // ── Add-ons ────────────────────────────────────────────────────────
      const { data: aData, error: aError } = await supabase
        .from('menu_addons')
        .select('*')
        .eq('restaurant_id', rData.id)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (aError) {
        setDbSupported(!isMissingTable(aError.message));
        return;
      }
      setDbSupported(true);
      setAddons((aData ?? []) as MenuAddon[]);

      // ── Groups ─────────────────────────────────────────────────────────
      const { data: gData } = await supabase
        .from('addon_groups')
        .select('*')
        .eq('restaurant_id', rData.id)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      const catalogGroups = (gData ?? []) as AddonGroup[];
      setGroups(catalogGroups);

      const groupIds = catalogGroups.map((group) => group.id);
      const { data: giData } = await supabase
        .from('addon_group_items')
        .select('addon_group_id, menu_addon_id')
        .in('addon_group_id', groupIds.length > 0 ? groupIds : ['']);

      const optionsByGroup: Record<string, string[]> = {};
      for (const row of giData ?? []) {
        (optionsByGroup[row.addon_group_id as string] ??= []).push(
          row.menu_addon_id as string
        );
      }
      setGroupOptions(optionsByGroup);

      // ── Meal association (only meaningful for `offering = 'SELECT'`) ───
      const addonIds = (aData ?? []).map((row) => row.id as string);
      const { data: lData } = await supabase
        .from('menu_item_addons')
        .select('menu_addon_id, menu_item_id')
        .in('menu_addon_id', addonIds.length > 0 ? addonIds : ['']);

      const mealsByAddon: Record<string, string[]> = {};
      for (const row of lData ?? []) {
        (mealsByAddon[row.menu_addon_id as string] ??= []).push(row.menu_item_id as string);
      }
      setAddonMeals(mealsByAddon);
    } catch (err) {
      setErrorMsg(describeError(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Device photo for an extra ────────────────────────────────────────
  const handleExtraFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file (JPG, PNG or WebP).');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setPhotoError('That photo is too large. Please choose one under 15 MB.');
      return;
    }

    setPhotoError(null);
    setExtraFile(file);
    setExtraPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const clearExtraPhoto = () => {
    setExtraFile(null);
    setExtraPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPhotoError(null);
  };

  const closeExtraDraft = () => {
    setExtraDraft(null);
    clearExtraPhoto();
    setErrorMsg('');
  };

  const openNewExtra = () => {
    setExtraDraft({ ...EMPTY_EXTRA_DRAFT });
    clearExtraPhoto();
    setErrorMsg('');
  };

  const openEditExtra = (addon: MenuAddon) => {
    setExtraDraft({
      id: addon.id,
      name: addon.name,
      description: addon.description ?? '',
      price: String(addon.price),
      categoryId: addon.category_id ?? '',
      maxQuantity: String(addon.max_quantity),
      isAvailable: addon.is_available,
      offering: addon.offering,
      imageUrl: addon.image_url ?? null,
      mealIds: addonMeals[addon.id] ?? [],
    });
    clearExtraPhoto();
    setErrorMsg('');
  };

  // ── Create / update an extra ─────────────────────────────────────────
  const handleSaveExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    const draft = extraDraft;
    if (!draft || !restaurant || !user) return;

    const numericPrice = parseFloat(draft.price);
    if (!draft.name.trim()) {
      setErrorMsg('Give the extra a name customers will recognise.');
      return;
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      setErrorMsg('Enter a price of GH₵ 0.00 or more.');
      return;
    }
    if (draft.offering === 'SELECT' && draft.mealIds.length === 0) {
      setErrorMsg('Pick at least one meal this extra belongs on, or offer it on every meal.');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    setNotice('');

    try {
      let imageUrl = draft.imageUrl;
      if (extraFile) {
        const result = await uploadRestaurantImage(user.id, 'addon', extraFile, {
          maxDimension: 600,
          quality: 0.8,
        });
        imageUrl = result.url;
        if (result.usedFallback) {
          setPhotoError('Photo saved at reduced quality — Storage was unreachable.');
        }
      }

      const payload = {
        restaurant_id: restaurant.id,
        category_id: draft.categoryId || null,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        price: numericPrice,
        image_url: imageUrl,
        is_available: draft.isAvailable,
        max_quantity: Math.max(1, Math.min(100, parseInt(draft.maxQuantity, 10) || 10)),
        offering: draft.offering,
      };

      let addonId = draft.id;
      if (addonId) {
        const { error } = await supabase.from('menu_addons').update(payload).eq('id', addonId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('menu_addons')
          .insert(payload)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        addonId = data?.id as string;
      }

      // Replace this extra's eligible-meal list. Offered-on-every-meal extras
      // keep no list at all, so nothing can quietly outlive the setting.
      await supabase.from('menu_item_addons').delete().eq('menu_addon_id', addonId);
      if (draft.offering === 'SELECT' && draft.mealIds.length > 0) {
        const { error: linkError } = await supabase.from('menu_item_addons').insert(
          draft.mealIds.map((mealId, index) => ({
            menu_item_id: mealId,
            menu_addon_id: addonId,
            sort_order: index,
          }))
        );
        if (linkError) throw linkError;
      }

      closeExtraDraft();
      fetchAll();
    } catch (err) {
      setErrorMsg(describeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleAvailable = async (addon: MenuAddon) => {
    const { error } = await supabase
      .from('menu_addons')
      .update({ is_available: !addon.is_available })
      .eq('id', addon.id);
    if (error) setErrorMsg(describeError(error));
    else fetchAll();
  };

  const handleToggleArchived = async (addon: MenuAddon) => {
    const { error } = await supabase
      .from('menu_addons')
      .update({ is_archived: !addon.is_archived })
      .eq('id', addon.id);
    if (error) setErrorMsg(describeError(error));
    else fetchAll();
  };

  const handleDeleteExtra = async (addon: MenuAddon) => {
    const confirmed = window.confirm(
      `Delete "${addon.name}" permanently?\n\n` +
        'Archiving is usually better: an archived extra disappears from the menu but stays on orders already placed.'
    );
    if (!confirmed) return;

    const { error } = await supabase.from('menu_addons').delete().eq('id', addon.id);
    if (error) {
      // ON DELETE RESTRICT: the extra is on a customer's receipt and removing
      // it would break that history. Say so instead of failing silently.
      if (/foreign key|restrict|order_item_extras/i.test(error.message)) {
        setErrorMsg(
          `"${addon.name}" is already on a customer's order, so deleting it would break that receipt. Archive it instead — it leaves the menu but stays on past orders.`
        );
      } else {
        setErrorMsg(describeError(error));
      }
      return;
    }
    fetchAll();
  };

  // ── Groups ───────────────────────────────────────────────────────────
  const openNewGroup = () => {
    setGroupDraft({ ...EMPTY_GROUP_DRAFT });
    setErrorMsg('');
  };

  const openEditGroup = (group: AddonGroup) => {
    setGroupDraft({
      id: group.id,
      name: group.name,
      description: group.description ?? '',
      isRequired: group.is_required,
      minSelect: String(group.min_select),
      maxSelect: String(group.max_select),
      addonIds: groupOptions[group.id] ?? [],
    });
    setErrorMsg('');
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const draft = groupDraft;
    if (!draft || !restaurant) return;

    const minSelect = Math.max(0, Math.min(50, parseInt(draft.minSelect, 10) || 0));
    const maxSelect = Math.max(0, Math.min(50, parseInt(draft.maxSelect, 10) || 0));

    if (!draft.name.trim()) {
      setErrorMsg('Give the group a name, e.g. "Choose a drink".');
      return;
    }
    if (maxSelect > 0 && maxSelect < minSelect) {
      setErrorMsg('The maximum cannot be smaller than the minimum. Use 0 for "no maximum".');
      return;
    }
    if (draft.isRequired && maxSelect === 1 && draft.addonIds.length < 1) {
      setErrorMsg('A required single-choice group needs at least one option.');
      return;
    }
    if (draft.addonIds.length === 0) {
      setNotice(
        'Saved — but a group with no options is never shown to customers. Add options to make it appear.'
      );
    } else {
      setNotice('');
    }

    setIsSaving(true);
    setErrorMsg('');

    try {
      const payload = {
        restaurant_id: restaurant.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        is_required: draft.isRequired,
        min_select: minSelect,
        max_select: maxSelect,
      };

      let groupId = draft.id;
      if (groupId) {
        const { error } = await supabase.from('addon_groups').update(payload).eq('id', groupId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('addon_groups')
          .insert(payload)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        groupId = data?.id as string;
      }

      await supabase.from('addon_group_items').delete().eq('addon_group_id', groupId);
      if (draft.addonIds.length > 0) {
        const { error: optionError } = await supabase.from('addon_group_items').insert(
          draft.addonIds.map((addonId, index) => ({
            addon_group_id: groupId,
            menu_addon_id: addonId,
            sort_order: index,
          }))
        );
        if (optionError) throw optionError;
      }

      setGroupDraft(null);
      fetchAll();
    } catch (err) {
      setErrorMsg(describeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGroup = async (group: AddonGroup) => {
    if (!window.confirm(`Delete the group "${group.name}"? Its options stay on your menu.`)) return;
    const { error } = await supabase.from('addon_groups').delete().eq('id', group.id);
    if (error) setErrorMsg(describeError(error));
    else fetchAll();
  };

  // ── Derived lists ────────────────────────────────────────────────────
  const visibleAddons = includeArchived ? addons : addons.filter((a) => !a.is_archived);
  const archivedCount = addons.filter((a) => a.is_archived).length;
  const addonById = new Map(addons.map((addon) => [addon.id, addon]));

  if (isLoading) {
    return (
      <RestaurantShell restaurant={restaurant}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center text-xs text-slate-500">
          Loading your add-ons…
        </div>
      </RestaurantShell>
    );
  }

  if (!restaurant) {
    return (
      <RestaurantShell restaurant={null}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xs text-center max-w-md mx-auto">
            <h2 className="text-lg font-bold text-slate-900">No Restaurant Found</h2>
            <p className="text-xs text-slate-500 mt-1">
              Add-ons belong to a restaurant. Create one first.
            </p>
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
                Add Extras
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {restaurant.name} · extras, combos and selection limits
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchAll}
              aria-label="Refresh add-ons"
              className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={tab === 'extras' ? openNewExtra : openNewGroup}
              disabled={!dbSupported}
              className="flex items-center gap-1.5 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{tab === 'extras' ? 'Add Extra' : 'Add Group'}</span>
            </button>
          </div>
        </div>

        {!dbSupported && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 leading-relaxed">
            <strong className="font-black">Add-ons are not enabled on this database yet.</strong>
            <p className="mt-1">
              Run <code className="font-bold">supabase/migrations/20261015_menu_addons.sql</code> in
              the Supabase SQL editor, then reload this page. Your menu, cart and checkout keep
              working exactly as before until you do.
            </p>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-start gap-2">
            <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>{errorMsg}</span>
          </div>
        )}

        {notice && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800">
            {notice}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200">
          {(
            [
              { id: 'extras' as Tab, label: 'Extras', icon: Tag, count: visibleAddons.length },
              { id: 'groups' as Tab, label: 'Selection groups', icon: Layers, count: groups.length },
            ]
          ).map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-bold transition ${
                tab === entry.id
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <entry.icon className="w-3.5 h-3.5" />
              <span>{entry.label}</span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums">
                {entry.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── Extras tab ─────────────────────────────────────────────── */}
        {tab === 'extras' && (
          <div className="space-y-3">
            {archivedCount > 0 && (
              <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Show {archivedCount} archived extra{archivedCount === 1 ? '' : 's'}</span>
              </label>
            )}

            {visibleAddons.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xs text-center">
                <Tag className="w-8 h-8 text-slate-300 mx-auto" />
                <h3 className="mt-3 text-sm font-bold text-slate-900">No extras yet</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Add extra chicken, bottled water, a fried egg or a drink — customers will see
                  them on every dish, or only on the meals you choose.
                </p>
                <button
                  onClick={openNewExtra}
                  className="mt-4 inline-flex items-center gap-1.5 py-2.5 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold"
                >
                  <Plus className="w-4 h-4" /> Add your first extra
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden">
                {visibleAddons.map((addon) => {
                  const mealCount = addonMeals[addon.id]?.length ?? 0;
                  return (
                    <div key={addon.id} className="p-4 flex items-start gap-3">
                      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-slate-100 flex items-center justify-center">
                        {addon.image_url ? (
                          <img
                            src={addon.image_url}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Tag className="w-4 h-4 text-slate-300" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900">{addon.name}</span>
                          {addon.is_archived && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                              Archived
                            </span>
                          )}
                          {!addon.is_available && !addon.is_archived && (
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-600">
                              Sold out
                            </span>
                          )}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                            {addon.offering === 'ALL'
                              ? 'Every meal'
                              : mealCount > 0
                              ? `${mealCount} meal${mealCount === 1 ? '' : 's'}`
                              : 'No meals chosen'}
                          </span>
                        </div>
                        {addon.description && (
                          <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">
                            {addon.description}
                          </p>
                        )}
                        <p className="mt-1 text-xs font-extrabold text-emerald-700 tabular-nums">
                          GH₵ {addon.price.toFixed(2)}
                          <span className="ml-2 font-semibold text-slate-400">
                            up to {addon.max_quantity} per line
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleAvailable(addon)}
                            className="py-1.5 px-2.5 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                          >
                            {addon.is_available ? 'Mark sold out' : 'Mark available'}
                          </button>
                          <button
                            onClick={() => handleToggleArchived(addon)}
                            aria-label={addon.is_archived ? `Restore ${addon.name}` : `Archive ${addon.name}`}
                            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                          >
                            {addon.is_archived ? (
                              <ArchiveRestore className="w-3.5 h-3.5" />
                            ) : (
                              <Archive className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => openEditExtra(addon)}
                            aria-label={`Edit ${addon.name}`}
                            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteExtra(addon)}
                            aria-label={`Delete ${addon.name}`}
                            className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Groups tab ─────────────────────────────────────────────── */}
        {tab === 'groups' && (
          <div className="space-y-3">
            {groups.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xs text-center">
                <Layers className="w-8 h-8 text-slate-300 mx-auto" />
                <h3 className="mt-3 text-sm font-bold text-slate-900">No selection groups yet</h3>
                <p className="mt-1 text-xs text-slate-500">
                  A group such as &quot;Choose a drink&quot; turns loose extras into a required
                  choice, with its own minimum and maximum.
                </p>
                <button
                  onClick={openNewGroup}
                  className="mt-4 inline-flex items-center gap-1.5 py-2.5 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold"
                >
                  <Plus className="w-4 h-4" /> Add your first group
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden">
                {groups.map((group) => {
                  const optionIds = groupOptions[group.id] ?? [];
                  return (
                    <div key={group.id} className="p-4 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900">{group.name}</span>
                          {group.is_required && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-200">
                              Required
                            </span>
                          )}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                            {describeGroupHint(group)}
                          </span>
                        </div>
                        {group.description && (
                          <p className="mt-0.5 text-[11px] text-slate-500">{group.description}</p>
                        )}
                        <p className="mt-1 text-[11px] text-slate-400">
                          {optionIds.length === 0
                            ? 'No options yet — customers never see an empty group.'
                            : optionIds
                                .map((id) => addonById.get(id)?.name)
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                        {group.is_required && effectiveGroupMin(group) === 0 && (
                          <p className="mt-0.5 text-[10px] text-amber-700">
                            A required group always needs at least one pick.
                          </p>
                        )}
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          onClick={() => openEditGroup(group)}
                          aria-label={`Edit ${group.name}`}
                          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteGroup(group)}
                          aria-label={`Delete ${group.name}`}
                          className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Extra editor ───────────────────────────────────────────────── */}
      {extraDraft && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveExtra}
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl max-h-[92vh] overflow-y-auto"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h3 className="text-sm font-black text-slate-900">
                {extraDraft.id ? 'Edit extra' : 'New extra'}
              </h3>
              <button
                type="button"
                onClick={closeExtraDraft}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label htmlFor="addon-name" className="block text-xs font-bold text-slate-700 mb-1">
                  Name
                </label>
                <input
                  id="addon-name"
                  type="text"
                  required
                  value={extraDraft.name}
                  onChange={(e) => setExtraDraft({ ...extraDraft, name: e.target.value })}
                  placeholder="e.g. Extra grilled chicken"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="addon-desc" className="block text-xs font-bold text-slate-700 mb-1">
                  Description <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="addon-desc"
                  rows={2}
                  value={extraDraft.description}
                  onChange={(e) => setExtraDraft({ ...extraDraft, description: e.target.value })}
                  placeholder="e.g. Grilled chicken breast, lightly seasoned"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="addon-price" className="block text-xs font-bold text-slate-700 mb-1">
                    Price (GH₵)
                  </label>
                  <input
                    id="addon-price"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={extraDraft.price}
                    onChange={(e) => setExtraDraft({ ...extraDraft, price: e.target.value })}
                    placeholder="15.00"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="addon-max" className="block text-xs font-bold text-slate-700 mb-1">
                    Max per order
                  </label>
                  <input
                    id="addon-max"
                    type="number"
                    min="1"
                    max="100"
                    value={extraDraft.maxQuantity}
                    onChange={(e) => setExtraDraft({ ...extraDraft, maxQuantity: e.target.value })}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="addon-category" className="block text-xs font-bold text-slate-700 mb-1">
                  Category <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <select
                  id="addon-category"
                  value={extraDraft.categoryId}
                  onChange={(e) => setExtraDraft({ ...extraDraft, categoryId: e.target.value })}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Photo */}
              <div>
                <span className="block text-xs font-bold text-slate-700 mb-1">Photo</span>
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-slate-100 flex items-center justify-center">
                    {extraPreview || extraDraft.imageUrl ? (
                      <img
                        src={(extraPreview ?? extraDraft.imageUrl) as string}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageUp className="w-4 h-4 text-slate-300" />
                    )}
                  </div>
                  <input
                    ref={extraInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleExtraFileChange}
                    className="hidden"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => extraInputRef.current?.click()}
                      className="py-2 px-3 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                    >
                      Choose photo
                    </button>
                    {(extraPreview || extraDraft.imageUrl) && (
                      <button
                        type="button"
                        onClick={() => {
                          clearExtraPhoto();
                          setExtraDraft({ ...extraDraft, imageUrl: null });
                        }}
                        className="py-2 px-3 rounded-lg border border-slate-200 text-[11px] font-bold text-rose-500 hover:bg-rose-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                {photoError && (
                  <p className="mt-1 text-[10px] font-semibold text-rose-600">{photoError}</p>
                )}
              </div>

              {/* Which meals */}
              <div>
                <span className="block text-xs font-bold text-slate-700 mb-1.5">
                  Offer it on…
                </span>
                <div className="space-y-2">
                  {(
                    [
                      {
                        value: 'ALL' as AddonOffering,
                        label: 'Every meal in your menu',
                        hint: 'Appears on all dishes, including new ones.',
                      },
                      {
                        value: 'SELECT' as AddonOffering,
                        label: 'Only the meals I pick',
                        hint: 'Appears on exactly the dishes you tick below.',
                      },
                    ]
                  ).map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition ${
                        extraDraft.offering === option.value
                          ? 'border-emerald-500 bg-emerald-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="addon-offering"
                        checked={extraDraft.offering === option.value}
                        onChange={() =>
                          setExtraDraft({ ...extraDraft, offering: option.value })
                        }
                        className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>
                        <span className="block text-xs font-bold text-slate-800">{option.label}</span>
                        <span className="block text-[10px] text-slate-400">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>

                {extraDraft.offering === 'SELECT' && (
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {menuItems.length === 0 ? (
                      <p className="p-3 text-[11px] text-slate-400">
                        Add dishes in Menu Management first.
                      </p>
                    ) : (
                      menuItems.map((item) => {
                        const checked = extraDraft.mealIds.includes(item.id);
                        return (
                          <label
                            key={item.id}
                            className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setExtraDraft({
                                  ...extraDraft,
                                  mealIds: e.target.checked
                                    ? [...extraDraft.mealIds, item.id]
                                    : extraDraft.mealIds.filter((id) => id !== item.id),
                                })
                              }
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                              {item.name}
                            </span>
                            <span className="flex-shrink-0 text-[10px] tabular-nums text-slate-400">
                              GH₵ {item.price.toFixed(2)}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <span>
                  <span className="block text-xs font-bold text-slate-800">Available right now</span>
                  <span className="block text-[10px] text-slate-400">
                    Turn off to sell out this extra without archiving it.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={extraDraft.isAvailable}
                  onChange={(e) =>
                    setExtraDraft({ ...extraDraft, isAvailable: e.target.checked })
                  }
                  className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
              </label>
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                onClick={closeExtraDraft}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-[2] py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : extraDraft.id ? 'Save changes' : 'Create extra'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Group editor ───────────────────────────────────────────────── */}
      {groupDraft && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveGroup}
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl max-h-[92vh] overflow-y-auto"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h3 className="text-sm font-black text-slate-900">
                {groupDraft.id ? 'Edit group' : 'New selection group'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setGroupDraft(null);
                  setErrorMsg('');
                }}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label htmlFor="group-name" className="block text-xs font-bold text-slate-700 mb-1">
                  Group name
                </label>
                <input
                  id="group-name"
                  type="text"
                  required
                  value={groupDraft.name}
                  onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                  placeholder="e.g. Choose a drink"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="group-desc" className="block text-xs font-bold text-slate-700 mb-1">
                  Description <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="group-desc"
                  type="text"
                  value={groupDraft.description}
                  onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })}
                  placeholder="e.g. One bottle per order"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="group-min" className="block text-xs font-bold text-slate-700 mb-1">
                    Minimum picks
                  </label>
                  <input
                    id="group-min"
                    type="number"
                    min="0"
                    max="50"
                    value={groupDraft.minSelect}
                    onChange={(e) => setGroupDraft({ ...groupDraft, minSelect: e.target.value })}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="group-max" className="block text-xs font-bold text-slate-700 mb-1">
                    Maximum picks
                  </label>
                  <input
                    id="group-max"
                    type="number"
                    min="0"
                    max="50"
                    value={groupDraft.maxSelect}
                    onChange={(e) => setGroupDraft({ ...groupDraft, maxSelect: e.target.value })}
                    placeholder="0 = no maximum"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <p className="-mt-2 text-[10px] text-slate-400">
                Use 0 for &quot;no maximum&quot;. A required group always needs at least one pick.
              </p>

              <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <span>
                  <span className="block text-xs font-bold text-slate-800">Required</span>
                  <span className="block text-[10px] text-slate-400">
                    The customer cannot check out without choosing.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={groupDraft.isRequired}
                  onChange={(e) =>
                    setGroupDraft({ ...groupDraft, isRequired: e.target.checked })
                  }
                  className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
              </label>

              <div>
                <span className="block text-xs font-bold text-slate-700 mb-1.5">Options</span>
                {addons.filter((a) => !a.is_archived).length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    Create an extra first — a group is made of your extras.
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {addons
                      .filter((a) => !a.is_archived)
                      .map((addon) => {
                        const checked = groupDraft.addonIds.includes(addon.id);
                        return (
                          <label
                            key={addon.id}
                            className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setGroupDraft({
                                  ...groupDraft,
                                  addonIds: e.target.checked
                                    ? [...groupDraft.addonIds, addon.id]
                                    : groupDraft.addonIds.filter((id) => id !== addon.id),
                                })
                              }
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                              {addon.name}
                            </span>
                            <span className="flex-shrink-0 text-[10px] tabular-nums text-slate-400">
                              GH₵ {addon.price.toFixed(2)}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setGroupDraft(null);
                  setErrorMsg('');
                }}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-[2] py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : groupDraft.id ? 'Save changes' : 'Create group'}
              </button>
            </div>
          </form>
        </div>
      )}
    </RestaurantShell>
  );
};

export default RestaurantAddonsPage;
