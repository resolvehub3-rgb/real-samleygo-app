/**
 * Menu add-ons — the pure rules of the "Add extras" feature.
 *
 * Nothing in this file talks to Supabase, renders UI or formats money for
 * display: it is the single place that answers "which extras does this meal
 * offer?", "is this selection legal?" and "what does this cart line cost?".
 * The database still owns every real price — `enforce_order_item_extra_pricing()`
 * rewrites the name, unit price and subtotal of an add-on line on the way in,
 * and `recalc_single_order()` re-derives the order's food subtotal from the
 * stored lines. The numbers produced here exist to show the customer a total
 * that matches what the server will confirm, never to set it.
 */
import type { AddonGroup, MenuAddon, MenuItem, MenuItemAddonLink } from '../types/database';
import { round2 } from './commission';

/**
 * One selected extra on a cart line. `unitPrice` is a *display* copy of the
 * price that was on screen when the customer picked it — checkout re-reads the
 * add-on and refuses the order if it changed (see `validateCartExtrasForCheckout`).
 */
export interface CartExtra {
  addonId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

/**
 * A line in the cart. Two lines are distinct when their meal **or** their
 * extra combination differs, so "Fried rice + chicken" and "Fried rice + egg"
 * stay separate and can each be edited on their own.
 */
export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
  extras?: CartExtra[];
}

/** A group together with the options that are actually offered on this meal. */
export interface MealAddonGroup {
  group: AddonGroup;
  options: MenuAddon[];
}

/**
 * The four things the customer screen needs about a restaurant's add-ons.
 * `addonCatalog.ts` fills it from Supabase; `EMPTY` is what an unconfigured
 * kitchen (or a database that has not run migration 15 yet) shows.
 */
export interface AddonCatalogShape {
  addons: MenuAddon[];
  groups: AddonGroup[];
  optionsByGroup: Record<string, MenuAddon[]>;
  links: MenuItemAddonLink[];
}

export const EMPTY_ADDON_SHAPE: AddonCatalogShape = {
  addons: [],
  groups: [],
  optionsByGroup: {},
  links: [],
};

/** addonId → quantity. `0` means "not selected". */
export type AddonSelection = Record<string, number>;

/** Everything the picker needs for one meal: its extras, its groups, the rest. */
export const mealAddonView = (
  menuItem: MenuItem,
  catalog: AddonCatalogShape
): { mealAddons: MenuAddon[]; groups: MealAddonGroup[]; loose: MenuAddon[] } => {
  const mealAddons = addonsForMeal(menuItem, catalog.addons, catalog.links);
  const groups = groupsForMeal(catalog.groups, catalog.optionsByGroup, mealAddons);
  return { mealAddons, groups, loose: ungroupedAddons(mealAddons, groups) };
};


// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Stable identity of a combination of extras. Order-independent, so
 * re-picking the same things in a different order still lands on the same
 * cart line.
 */
export const extrasSignature = (extras?: CartExtra[] | null): string =>
  (extras ?? [])
    .filter((extra) => extra.quantity > 0)
    .map((extra) => `${extra.addonId}:${extra.quantity}`)
    .sort()
    .join(',');

/** Key that makes two cart lines the same line — and everything else distinct. */
export const cartLineKey = (item: CartItem): string =>
  `${item.menuItem.id}|${extrasSignature(item.extras)}`;

// ── Money (display only) ────────────────────────────────────────────────────

/** `Σ(each extra unit price × its own quantity)` — extras do not scale with the meal quantity. */
export const extrasSubtotal = (extras?: CartExtra[] | null): number =>
  round2((extras ?? []).reduce((sum, extra) => sum + extra.unitPrice * extra.quantity, 0));

/** Meal total + extras total for one line. */
export const lineTotal = (item: CartItem): number =>
  round2(item.menuItem.price * item.quantity + extrasSubtotal(item.extras));

/** The food subtotal the summary shows and the order is submitted with. */
export const cartFoodSubtotal = (items: CartItem[]): number =>
  round2(items.reduce((sum, item) => sum + item.menuItem.price * item.quantity + extrasSubtotal(item.extras), 0));

/** How many individual things are in the cart (meals + extras). */
export const cartItemCount = (items: CartItem[]): number =>
  items.reduce(
    (sum, item) =>
      sum + item.quantity + (item.extras ?? []).reduce((n, extra) => n + extra.quantity, 0),
    0
  );

/** Cart extras → the rows written to `order_item_extras`. */
export const orderItemExtraPayload = (
  orderItemId: string,
  extras?: CartExtra[] | null
): {
  order_item_id: string;
  menu_addon_id: string;
  addon_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}[] =>
  (extras ?? [])
    .filter((extra) => extra.quantity > 0)
    .map((extra) => ({
      order_item_id: orderItemId,
      menu_addon_id: extra.addonId,
      addon_name: extra.name,
      unit_price: extra.unitPrice,
      quantity: extra.quantity,
      subtotal: round2(extra.unitPrice * extra.quantity),
    }));

// ── Loading a persisted cart ────────────────────────────────────────────────

/**
 * Reads whatever localStorage holds into a well-formed line. A cart written
 * before add-ons existed has no `extras` key and stays valid; anything else
 * malformed is dropped rather than rendered with a fake price.
 */
export const normalizeCartItem = (raw: unknown): CartItem | null => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<CartItem>;
  const menuItem = candidate.menuItem as MenuItem | undefined;
  if (!menuItem || typeof menuItem.id !== 'string' || typeof menuItem.price !== 'number') return null;

  const quantity = Number(candidate.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) return null;

  const extras: CartExtra[] = [];
  if (Array.isArray(candidate.extras)) {
    for (const extra of candidate.extras) {
      if (!extra || typeof extra !== 'object') continue;
      const e = extra as Partial<CartExtra>;
      if (typeof e.addonId !== 'string' || !e.addonId) continue;
      const qty = Number(e.quantity);
      const price = Number(e.unitPrice);
      if (!Number.isFinite(qty) || qty < 1) continue;
      if (!Number.isFinite(price) || price < 0) continue;
      extras.push({
        addonId: e.addonId,
        name: typeof e.name === 'string' && e.name.trim() ? e.name : 'Extra',
        unitPrice: price,
        quantity: Math.floor(qty),
      });
    }
  }

  return {
    menuItem,
    quantity: Math.floor(quantity),
    notes: typeof candidate.notes === 'string' && candidate.notes ? candidate.notes : undefined,
    extras: extras.length ? extras : undefined,
  };
};

// ── Which extras a meal offers ──────────────────────────────────────────────

/**
 * The extras offered on one meal.
 *
 * `offering = 'ALL'` (the default) means the extra belongs on every dish of
 * the restaurant the moment it is created. `offering = 'SELECT'` means the
 * restaurant listed the eligible meals in `menu_item_addons` — only those.
 *
 * Archived extras are never offered. Sold-out ones ARE returned so the screen
 * can show them with an honest "Unavailable" status instead of hiding them.
 */
export const addonsForMeal = (
  menuItem: MenuItem,
  addons: MenuAddon[],
  links: MenuItemAddonLink[]
): MenuAddon[] => {
  const linked = new Set(
    links.filter((link) => link.menu_item_id === menuItem.id).map((link) => link.menu_addon_id)
  );

  return addons
    .filter((addon) => !addon.is_archived && addon.restaurant_id === menuItem.restaurant_id)
    .filter((addon) => (addon.offering === 'SELECT' ? linked.has(addon.id) : true))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
};

/**
 * The groups that apply to a meal: a group is offered when at least one of
 * its options is offered on that meal, and only those options are shown.
 * Ordering follows `addon_groups.sort_order`.
 */
export const groupsForMeal = (
  groups: AddonGroup[],
  optionsByGroup: Record<string, MenuAddon[]>,
  mealAddons: MenuAddon[]
): MealAddonGroup[] => {
  const offered = new Set(mealAddons.map((addon) => addon.id));

  return groups
    .map((group) => ({
      group,
      options: (optionsByGroup[group.id] ?? []).filter((addon) => offered.has(addon.id)),
    }))
    .filter((entry) => entry.options.length > 0)
    .sort((a, b) => a.group.sort_order - b.group.sort_order || a.group.name.localeCompare(b.group.name));
};

/** Extras that belong to no applicable group — the plain "Add extras" list. */
export const ungroupedAddons = (mealAddons: MenuAddon[], groups: MealAddonGroup[]): MenuAddon[] => {
  const grouped = new Set(groups.flatMap((entry) => entry.options.map((addon) => addon.id)));
  return mealAddons.filter((addon) => !grouped.has(addon.id));
};

// ── Selection rules ─────────────────────────────────────────────────────────

/** Minimum picks. A required group always means at least one, whatever `min_select` says. */
export const effectiveGroupMin = (group: AddonGroup): number =>
  group.is_required ? Math.max(1, group.min_select) : group.min_select;

/** `max_select = 0` is the "no maximum" convention. */
export const effectiveGroupMax = (group: AddonGroup): number => group.max_select;

/** "Choose 1–3" / "Choose at least 2" / "Optional" — the hint under a group title. */
export const describeGroupHint = (group: AddonGroup): string => {
  const min = effectiveGroupMin(group);
  const max = effectiveGroupMax(group);
  if (max > 0 && min > 0) return min === max ? `Choose ${min}` : `Choose ${min}–${max}`;
  if (max > 0) return `Choose up to ${max}`;
  if (min > 0) return `Choose at least ${min}`;
  return group.is_required ? 'Choose 1' : 'Optional';
};

/**
 * The one rule check for a meal's extras. Returns an honest, customer-readable
 * reason the selection cannot be added yet, or `null` when it is legal.
 *
 * Enforced here AND by `enforce_order_item_extra_pricing()` in the database —
 * the client check exists so the customer is told before they press anything,
 * never because the client is trusted.
 */
export const validateAddonSelection = (
  selection: AddonSelection,
  groups: MealAddonGroup[],
  mealAddons: MenuAddon[]
): string | null => {
  const byId = new Map(mealAddons.map((addon) => [addon.id, addon]));
  const picked = (addonId: string): number => {
    const qty = selection[addonId];
    return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;
  };

  // 1. Per-option rules: availability and the restaurant's quantity cap.
  for (const addon of mealAddons) {
    const qty = picked(addon.id);
    if (qty === 0) continue;
    if (!addon.is_available) return `${addon.name} is currently unavailable.`;
    if (qty > addon.max_quantity) {
      return `You can add up to ${addon.max_quantity} × ${addon.name}.`;
    }
  }

  // 2. A pick that is not a known extra can never be submitted.
  for (const addonId of Object.keys(selection)) {
    if (picked(addonId) > 0 && !byId.has(addonId)) {
      return 'That extra is not offered on this meal. Refresh the page and try again.';
    }
  }

  // 3. Group rules: required / minimum / maximum.
  for (const { group, options } of groups) {
    const chosen = options.filter((option) => picked(option.id) > 0).length;
    const min = effectiveGroupMin(group);
    const max = effectiveGroupMax(group);

    if (chosen < min) {
      return min === 1
        ? `Choose at least 1 option for ${group.name}.`
        : `Choose at least ${min} options for ${group.name}.`;
    }
    if (max > 0 && chosen > max) {
      return max === 1
        ? `You can choose only 1 option for ${group.name}.`
        : `You can choose up to ${max} options for ${group.name}.`;
    }
  }

  return null;
};

/** The extras a customer has actually picked, ready to store on the cart line. */
export const selectionToExtras = (selection: AddonSelection, mealAddons: MenuAddon[]): CartExtra[] =>
  mealAddons
    .filter((addon) => (selection[addon.id] ?? 0) > 0)
    .map((addon) => ({
      addonId: addon.id,
      name: addon.name,
      unitPrice: addon.price,
      quantity: Math.min(Math.floor(selection[addon.id]), addon.max_quantity),
    }))
    .sort((a, b) => a.addonId.localeCompare(b.addonId));

/** Seeds the picker when the customer returns to edit an existing line. */
export const extrasToSelection = (extras?: CartExtra[] | null): AddonSelection => {
  const selection: AddonSelection = {};
  for (const extra of extras ?? []) selection[extra.addonId] = extra.quantity;
  return selection;
};
