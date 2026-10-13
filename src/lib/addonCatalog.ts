/**
 * Everything that reads or checks add-ons against Supabase.
 *
 * Two contracts matter here:
 *
 *  1. **The feature is optional until migration 20261015 is applied.** Every
 *     read degrades to an empty catalogue when the table is missing, so a
 *     project that has not run the migration still shows its menu, its cart
 *     and its checkout exactly as before — no console errors, no broken page.
 *
 *  2. **The browser never decides a price.** `validateCartExtrasForCheckout`
 *     re-reads the add-ons a moment before the order is created so the
 *     customer is told plainly when something sold out or changed price; the
 *     database still rewrites every number on the way in, so a stale or
 *     doctored payload can never reach the order.
 */
import { supabase, isSupabaseConfigured } from './supabase';
import type { AddonGroup, MenuAddon, MenuItemAddonLink } from '../types/database';
import { AddonCatalogShape, CartItem, EMPTY_ADDON_SHAPE, extrasSubtotal } from './addons';

export interface RestaurantAddonCatalog extends AddonCatalogShape {
  /**
   * `true` once the database has answered about `menu_addons` — i.e. migration
   * 20261015 has been applied. Used to decide whether to listen for realtime
   * add-on changes, so an unconfigured project subscribes to nothing.
   */
  supported: boolean;
}

export const EMPTY_ADDON_CATALOG: RestaurantAddonCatalog = {
  ...EMPTY_ADDON_SHAPE,
  supported: false,
};

const isMissingTable = (message?: string): boolean =>
  !!message && /does not exist|could not find table|schema cache/i.test(message);

/**
 * Loads a restaurant's add-on catalogue in one go. Never throws: a missing
 * migration, a dropped connection or an RLS refusal all come back as "this
 * restaurant offers no extras", which is exactly what an unconfigured kitchen
 * should show.
 */
export const loadRestaurantAddonCatalog = async (
  restaurantId: string,
  menuIds: string[]
): Promise<RestaurantAddonCatalog> => {
  if (!isSupabaseConfigured || !restaurantId) return EMPTY_ADDON_CATALOG;

  try {
    const { data: addons, error: addonsError } = await supabase
      .from('menu_addons')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (addonsError) {
      // Migration not applied yet — the menu keeps working without extras.
      return { ...EMPTY_ADDON_CATALOG, supported: !isMissingTable(addonsError.message) };
    }
    if (!addons) return { ...EMPTY_ADDON_CATALOG, supported: true };

    const catalogAddons = addons as MenuAddon[];

    const { data: groups } = await supabase
      .from('addon_groups')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    const catalogGroups = (groups ?? []) as AddonGroup[];
    const optionsByGroup: Record<string, MenuAddon[]> = {};

    if (catalogGroups.length > 0) {
      const { data: groupItems } = await supabase
        .from('addon_group_items')
        .select('addon_group_id, menu_addon_id, sort_order, addon:menu_addons(*)')
        .in(
          'addon_group_id',
          catalogGroups.map((group) => group.id)
        );

      const live = new Map<string, MenuAddon>(
        catalogAddons.map((addon): [string, MenuAddon] => [addon.id, addon])
      );
      for (const row of groupItems ?? []) {
        const groupId = row.addon_group_id as string;
        // PostgREST returns a many-to-one embed as an object; be defensive
        // anyway so a shape change degrades to "no option" instead of a crash.
        const embedded = Array.isArray(row.addon) ? row.addon[0] : row.addon;
        const addon = (embedded as MenuAddon | null) ?? null;
        const resolved = addon && live.has(addon.id) ? live.get(addon.id)! : null;
        if (!resolved) continue; // archived or deleted extras are never offered
        (optionsByGroup[groupId] ??= []).push(resolved);
      }
      for (const options of Object.values(optionsByGroup)) {
        options.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      }
    }

    // Meal links are only needed when a restaurant actually scopes an extra.
    let links: MenuItemAddonLink[] = [];
    if (menuIds.length > 0 && catalogAddons.some((addon) => addon.offering === 'SELECT')) {
      const { data: linkRows } = await supabase
        .from('menu_item_addons')
        .select('*')
        .in('menu_item_id', menuIds);
      links = (linkRows ?? []) as MenuItemAddonLink[];
    }

    return {
      addons: catalogAddons,
      groups: catalogGroups,
      optionsByGroup,
      links,
      supported: true,
    };
  } catch {
    return EMPTY_ADDON_CATALOG;
  }
};

export type CheckoutValidation = { ok: true } | { ok: false; message: string };

/**
 * Re-reads every extra in the cart just before the order is created.
 *
 * Catches the three things that can happen while the customer fills in their
 * address: the extra was archived or deleted, it was marked sold out, or its
 * price changed. Each one produces a plain sentence naming the item rather
 * than letting the database abort halfway through the checkout.
 */
export const validateCartExtrasForCheckout = async (
  items: CartItem[],
  restaurantId: string
): Promise<CheckoutValidation> => {
  const wanted = new Map<string, { name: string; unitPrice: number; quantity: number }>();
  for (const item of items) {
    for (const extra of item.extras ?? []) {
      if (extra.quantity <= 0) continue;
      wanted.set(extra.addonId, {
        name: extra.name,
        unitPrice: extra.unitPrice,
        quantity: extra.quantity,
      });
    }
  }

  if (wanted.size === 0) return { ok: true };
  if (!isSupabaseConfigured) return { ok: true };

  try {
    const { data, error } = await supabase
      .from('menu_addons')
      .select('*')
      .in('id', [...wanted.keys()]);

    if (error) {
      if (isMissingTable(error.message)) {
        // The migration is not applied — the cart could not contain extras
        // it never loaded, so there is nothing to validate.
        return { ok: true };
      }
      return {
        ok: false,
        message: 'We could not confirm your extras just now. Please try again.',
      };
    }

    const current = new Map((data ?? []).map((row) => [row.id as string, row as MenuAddon]));

    for (const [addonId, chosen] of wanted) {
      const addon = current.get(addonId);

      if (!addon) {
        return {
          ok: false,
          message: `${chosen.name} is no longer offered by this restaurant. Remove it to continue.`,
        };
      }
      if (addon.restaurant_id !== restaurantId) {
        return {
          ok: false,
          message: `${addon.name} does not belong to this restaurant. Remove it to continue.`,
        };
      }
      if (addon.is_archived) {
        return {
          ok: false,
          message: `${addon.name} is no longer offered. Remove it to continue.`,
        };
      }
      if (!addon.is_available) {
        return {
          ok: false,
          message: `${addon.name} is currently unavailable. Remove it to continue.`,
        };
      }
      if (chosen.quantity > addon.max_quantity) {
        return {
          ok: false,
          message: `You can add up to ${addon.max_quantity} × ${addon.name}.`,
        };
      }
      if (Math.abs(addon.price - chosen.unitPrice) > 0.001) {
        return {
          ok: false,
          message:
            `The price of ${addon.name} changed from GH₵ ${chosen.unitPrice.toFixed(2)} ` +
            `to GH₵ ${addon.price.toFixed(2)}. Review your cart to continue.`,
        };
      }
    }

    return { ok: true };
  } catch {
    return { ok: false, message: 'We could not confirm your extras just now. Please try again.' };
  }
};

/** Extras subtotal of a whole cart — kept here so checkout can echo it back. */
export const cartExtrasTotal = (items: CartItem[]): number =>
  items.reduce((sum, item) => sum + extrasSubtotal(item.extras), 0);
