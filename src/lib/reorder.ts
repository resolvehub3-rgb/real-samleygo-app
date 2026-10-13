import { supabase } from './supabase';
import { DELIVERY_LOCATION_ERROR, requestDeliveryQuote } from './deliveryQuote';
import { Order, OrderStatus } from '../types/database';

/** One tap on "Reorder" rebuilds a finished order from today's menu. */
export type ReorderOutcome =
  | { ok: true; order: Order; skipped: string[] }
  | { ok: false; error: string };

const round2 = (value: number) => Math.round(value * 100) / 100;

const randomOrderNumber = () => `SG-${Math.floor(100000 + Math.random() * 900000)}`;
const randomPaymentRef = () => `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** An add-on line on the rebuilt order, priced at today's rate. */
interface ReorderExtra {
  menu_addon_id: string;
  addon_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

/**
 * Re-place a previous order as the signed-in customer.
 *
 * The stored `order_items` rows are only a snapshot of what was bought, so the
 * menu is re-read first: current prices are charged, items the kitchen no
 * longer sells (or deleted rows) are dropped and reported, and a kitchen that
 * closed its doors refuses the order instead of accepting a ghost.
 *
 * The extras a customer chose last time travel with the meal, at today's
 * price. An extra that was archived, repriced-as-unavailable or sold out is
 * dropped and reported in `skipped` — the order is never placed with extras the
 * kitchen cannot make, and the database re-prices every add-on row on the way
 * in regardless of what this function believed.
 *
 * Everything runs through the same `orders` INSERT the checkout form writes,
 * so the kitchen's live bell, the customer's list and the detail-page stream
 * all pick the new order up exactly as they do a first-time order.
 *
 * @param source  the finished order being repeated (must be the caller's own)
 */
export const placeReorder = async (source: Order): Promise<ReorderOutcome> => {
  // ── 1. What did the customer buy last time? ───────────────────────────
  const { data: sourceItems, error: sourceItemsError } = await supabase
    .from('order_items')
    .select('id, menu_item_id, item_name, quantity, notes')
    .eq('order_id', source.id);

  if (sourceItemsError) return { ok: false, error: sourceItemsError.message };

  const wanted = (sourceItems ?? []).filter((line) => line.menu_item_id);
  if (wanted.length === 0) {
    return { ok: false, error: 'This order has no items left to reorder.' };
  }

  // ── 2. What can the kitchen still sell today? ─────────────────────────
  const menuIds = [...new Set(wanted.map((line) => line.menu_item_id as string))];
  const { data: menuRows, error: menuError } = await supabase
    .from('menu_items')
    .select('id, restaurant_id, name, price, is_available')
    .in('id', menuIds);

  if (menuError) return { ok: false, error: menuError.message };

  // Add-ons from the original order. Missing on a pre-migration database?
  // Then the order never had any, and there is nothing to carry over.
  const sourceLineIds = (sourceItems ?? []).map((line) => line.id as string);
  const extrasBySourceLine: Record<
    string,
    { addonId: string; quantity: number }[]
  > = {};
  const { data: sourceExtras } = await supabase
    .from('order_item_extras')
    .select('order_item_id, menu_addon_id, quantity')
    .in('order_item_id', sourceLineIds.length > 0 ? sourceLineIds : ['']);
  for (const extra of sourceExtras ?? []) {
    (extrasBySourceLine[extra.order_item_id as string] ??= []).push({
      addonId: extra.menu_addon_id as string,
      quantity: Number(extra.quantity) || 1,
    });
  }

  const wantedAddonIds = [
    ...new Set(Object.values(extrasBySourceLine).flat().map((extra) => extra.addonId)),
  ];
  const addonsById = new Map<
    string,
    {
      id: string;
      name: string;
      price: number;
      is_available: boolean;
      is_archived: boolean;
      max_quantity: number;
      restaurant_id: string;
    }
  >();
  if (wantedAddonIds.length > 0) {
    const { data: addonRows } = await supabase
      .from('menu_addons')
      .select('id, name, price, is_available, is_archived, max_quantity, restaurant_id')
      .in('id', wantedAddonIds);
    for (const row of addonRows ?? []) addonsById.set(row.id, row);
  }

  const menuById = new Map((menuRows ?? []).map((row) => [row.id, row]));
  const skipped: string[] = [];
  const lines: {
    menu_item_id: string;
    item_name: string;
    item_price: number;
    quantity: number;
    notes: string | null;
    subtotal: number;
    extras: ReorderExtra[];
  }[] = [];

  for (const line of wanted) {
    const menu = menuById.get(line.menu_item_id as string);
    if (!menu || !menu.is_available) {
      // Gone from the menu or sold out — never silently charge for it.
      skipped.push(line.item_name);
      continue;
    }
    const price = Number(menu.price);

    const extras: ReorderExtra[] = [];
    for (const chosen of extrasBySourceLine[line.id as string] ?? []) {
      const addon = addonsById.get(chosen.addonId);
      if (
        !addon ||
        addon.restaurant_id !== menu.restaurant_id ||
        addon.is_archived ||
        !addon.is_available
      ) {
        // The kitchen stopped selling this extra — report it, never fake it.
        skipped.push(chosen.addonId);
        continue;
      }
      const qty = Math.min(Math.max(1, chosen.quantity), addon.max_quantity);
      extras.push({
        menu_addon_id: addon.id,
        addon_name: addon.name,
        unit_price: Number(addon.price),
        quantity: qty,
        subtotal: round2(Number(addon.price) * qty),
      });
    }

    lines.push({
      menu_item_id: menu.id,
      item_name: menu.name,
      item_price: price,
      quantity: line.quantity,
      notes: line.notes?.trim() || null,
      subtotal: round2(price * line.quantity),
      extras,
    });
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: 'Everything from this order is unavailable right now — check the menu and try again.',
    };
  }

  // ── 3. Kitchen still trading? ─────────────────────────────────────────
  const restaurant = source.restaurant;
  if (!restaurant) return { ok: false, error: 'That kitchen is no longer listed on SamleyGo.' };
  if (restaurant.is_open === false) {
    return { ok: false, error: `${restaurant.name} is closed right now — try again later.` };
  }

  // ── 4. Money at today's rates (the old fee was a snapshot too) ────────
  const subtotal = round2(
    lines.reduce(
      (sum, line) =>
        sum +
        line.subtotal +
        line.extras.reduce((extraSum, extra) => extraSum + extra.subtotal, 0),
      0
    )
  );

  // The drop-off point of the original order is reused, but the PRICE is
  // never reused: the backend measures the route again against the current
  // delivery pricing rules and hands back a fresh quote. Without real
  // coordinates there is no route, so there is no reorder.
  const deliveryPoint =
    source.delivery_latitude != null && source.delivery_longitude != null
      ? { lat: source.delivery_latitude, lng: source.delivery_longitude }
      : null;
  const restaurantPoint =
    restaurant.latitude != null && restaurant.longitude != null
      ? { lat: restaurant.latitude, lng: restaurant.longitude }
      : null;

  if (!deliveryPoint) return { ok: false, error: DELIVERY_LOCATION_ERROR };

  const quoteResult = await requestDeliveryQuote({
    restaurantId: restaurant.id,
    restaurantPoint,
    deliveryPoint,
  });
  if (!quoteResult.ok) return { ok: false, error: quoteResult.error };

  const deliveryFee = quoteResult.quote.deliveryFee;
  const tip = round2(Number(source.tip ?? 0));
  const totalAmount = round2(subtotal + deliveryFee + tip);

  const orderNumber = randomOrderNumber();
  const paymentMethod = source.payment_method || 'CASH';

  // ── 5. Place it — same shape and pipeline as the checkout form ────────
  // `delivery_fee` is deliberately absent: the database prices the order
  // from the quote and re-derives the customer total itself.
  const { data: created, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_number: orderNumber,
      customer_id: source.customer_id,
      restaurant_id: source.restaurant_id,
      status: 'RESTAURANT_PENDING' satisfies OrderStatus,
      subtotal,
      delivery_quote_id: quoteResult.quote.quoteId,
      tip,
      total_amount: totalAmount,
      delivery_address: source.delivery_address,
      delivery_latitude: deliveryPoint.lat,
      delivery_longitude: deliveryPoint.lng,
      customer_phone: source.customer_phone,
      delivery_notes: source.delivery_notes || null,
      payment_method: paymentMethod,
      payment_status: 'COMPLETED',
      payment_reference: randomPaymentRef(),
    })
    .select()
    // maybeSingle: an empty returning set must not surface as HTTP 406
    .maybeSingle();

  if (orderError || !created) {
    return { ok: false, error: orderError?.message || 'Could not place the reorder.' };
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from('order_items')
    .insert(
      lines.map((line) => ({
        order_id: created.id,
        menu_item_id: line.menu_item_id,
        item_name: line.item_name,
        item_price: line.item_price,
        quantity: line.quantity,
        notes: line.notes,
        subtotal: line.subtotal,
      }))
    )
    .select('id');

  if (itemsError || !insertedItems || insertedItems.length !== lines.length) {
    // Never leave an empty order shell in the customer's list.
    await supabase.from('orders').delete().eq('id', created.id);
    return { ok: false, error: itemsError?.message || 'Could not save the reordered items.' };
  }

  // Carry the extras onto the matching line. The database re-prices every row
  // from `menu_addons`, so a price that moved since the original order is
  // charged at today's rate — never silently copied from history.
  const extraRows = lines.flatMap((line, index) =>
    line.extras.map((extra) => ({ order_item_id: insertedItems[index].id, ...extra }))
  );
  if (extraRows.length > 0) {
    const { error: extrasError } = await supabase.from('order_item_extras').insert(extraRows);
    if (extrasError) {
      await supabase.from('orders').delete().eq('id', created.id);
      return { ok: false, error: extrasError.message };
    }
  }

  // Best effort: the timeline is a nicety, the order itself is already live.
  await supabase.from('order_status_history').insert({
    order_id: created.id,
    status: 'RESTAURANT_PENDING' satisfies OrderStatus,
    note: `Reordered from #${source.order_number} (${paymentMethod}). Awaiting restaurant acceptance.`,
    changed_by: source.customer_id,
  });

  // `payments` (no RLS policy) and owner `notifications` (cross-user insert is
  // rejected by RLS) are dropped by the API today — checkout writes them and
  // gets nothing back — so the reorder skips them. The kitchen's realtime bell
  // fires off the `orders` INSERT event, not a notification row.
  return { ok: true, order: created as Order, skipped };
};
