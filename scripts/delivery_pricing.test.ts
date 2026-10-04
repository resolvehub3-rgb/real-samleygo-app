/**
 * SamleyGo distance-based delivery pricing — test suite.
 *
 *   pnpm test:delivery   (tsx scripts/delivery_pricing.test.ts)
 *
 * What is covered:
 *   1. The acceptance example: 8 km × (GH₵5 + GH₵2/km) ⇒ GH₵21 delivery,
 *      GH₵100 food ⇒ GH₵121 total, courier earns GH₵21 with 0% commission,
 *      restaurant commission 15% of GH₵100 = GH₵15 ⇒ GH₵85 net.
 *   2. The formula itself — base + (km × rate), floor, OPTIONAL ceiling,
 *      2-decimal rounding (17.806 ⇒ 17.81) and the currency display.
 *   3. Distance helpers — real coordinates, never a fabricated default.
 *   4. Quote lifecycle — the exact "select a valid delivery location"
 *      message, the 5-minute TTL and expiry handling.
 *   5. Delivery reporting — fees, courier earnings, distance totals and
 *      averages summed from real order rows only.
 *   6. Source scans — checkout posts a quote id (never money), admin saves
 *      pricing through the database RPC, the UI shows the required rows,
 *      and the migration carries the server contract.
 *
 * IMPORTANT: the database is still the authority. These tests lock down the
 * client helpers that render those numbers, the reporting aggregation, and
 * the fact that no client code path can set a price.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateDistanceKm,
  calculateDeliveryFee,
  isValidDeliveryPoint,
  formatDistanceKm,
  formatGHS,
  aggregateDeliveryStats,
  DEFAULT_PRICING,
} from '../src/lib/pricing';
import {
  calculateCourierDeliveryShare,
  calculateRestaurantCommission,
  computeCustomerTotals,
  getOrderFinancials,
  isCommissionRecognized,
  round2,
} from '../src/lib/commission';
import {
  DELIVERY_LOCATION_ERROR,
  DELIVERY_QUOTE_TTL_MS,
  isQuoteUsable,
  DeliveryQuote,
} from '../src/lib/deliveryQuote';
import { Order, OrderSettlementAdjustment, PlatformPricingSettings } from '../src/types/database';

// ---------------------------------------------------------------------------
// Tiny test runner (no extra dependencies)
// ---------------------------------------------------------------------------

let passed = 0;
const failures: { name: string; error: Error }[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error: error as Error });
    console.error(`  \u2717 ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segments: string[]) => readFileSync(path.join(ROOT, ...segments), 'utf8');

// ---------------------------------------------------------------------------
// Pricing fixture — the acceptance example's rules (base GH₵5, GH₵2/km)
// ---------------------------------------------------------------------------

const EXAMPLE_PRICING: PlatformPricingSettings = {
  ...DEFAULT_PRICING,
  base_fee: 5,
  per_km_rate: 2,
  min_fee: 1,
  max_fee: null, // no ceiling: the fee is whatever the route costs
  surge_multiplier: 1,
  courier_earning_percentage: 100,
};

/** Row shaped exactly like what apply_order_financials() writes. */
function placeOrder(overrides: Partial<Order>): Order {
  const subtotal = overrides.subtotal ?? 100;
  const deliveryFee = overrides.delivery_fee ?? 21;
  const distanceKm = overrides.delivery_distance_km ?? 8;
  const commissionRate = overrides.commission_rate ?? 15;
  const commission = calculateRestaurantCommission(subtotal, commissionRate);
  const courierEarning =
    overrides.courier_earning ?? calculateCourierDeliveryShare(deliveryFee, 0); // Phase 1: 0%

  return {
    id: 'ord-delivery',
    order_number: 'SG-200001',
    customer_id: 'cust-0001',
    restaurant_id: 'rest-0001',
    status: 'DELIVERED',
    subtotal,
    delivery_fee: deliveryFee,
    delivery_distance_km: distanceKm,
    delivery_pricing_version: 1,
    tip: 0,
    total_amount: round2(subtotal + deliveryFee),
    commission_rate: commissionRate,
    commission_amount: commission.commissionAmount,
    restaurant_gross_amount: commission.gross,
    restaurant_net_amount: commission.restaurantNet,
    courier_earning: courierEarning,
    platform_revenue: commission.commissionAmount,
    currency: 'GHS',
    settlement_status: 'ELIGIBLE',
    delivery_address: 'Osu, Accra',
    customer_phone: '0240000000',
    payment_method: 'MTN_MOMO',
    payment_status: 'COMPLETED',
    created_at: '2026-10-06T10:00:00.000Z',
    updated_at: '2026-10-06T10:30:00.000Z',
    ...overrides,
  };
}

function refundAdjustment(
  overrides: Partial<OrderSettlementAdjustment> = {}
): OrderSettlementAdjustment {
  return {
    id: 'adj-delivery',
    order_id: 'ord-delivery',
    adjustment_type: 'PARTIAL_REFUND',
    refund_amount: 0,
    food_amount_refunded: 0,
    delivery_amount_refunded: 0,
    commission_adjustment: 0,
    restaurant_net_adjustment: 0,
    courier_earning_adjustment: 0,
    platform_revenue_adjustment: 0,
    reason: null,
    created_by: 'admin-0001',
    created_at: '2026-10-07T09:00:00.000Z',
    ...overrides,
  };
}

const quoteOver = (overrides: Partial<DeliveryQuote>): DeliveryQuote => ({
  quoteId: 'quote-1',
  restaurantId: 'rest-0001',
  distanceKm: 8,
  distanceSource: 'STRAIGHT_LINE',
  deliveryFee: 21,
  courierEarning: 21,
  courierEarningPercentage: 100,
  currency: 'GHS',
  pricingVersion: 1,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + DELIVERY_QUOTE_TTL_MS).toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. The acceptance example, end to end
// ---------------------------------------------------------------------------

console.log('\n1. Acceptance example — 8 km delivery of a GH₵100 order');

test('8 km at base GH₵5 + GH₵2/km = GH₵21 delivery fee', () => {
  assert.equal(calculateDeliveryFee(8, EXAMPLE_PRICING), 21);
});

test('GH₵100 food + GH₵21 delivery = GH₵121 total', () => {
  const fee = calculateDeliveryFee(8, EXAMPLE_PRICING);
  const totals = computeCustomerTotals(100, fee, 0);
  assert.equal(totals.foodSubtotal, 100);
  assert.equal(totals.deliveryFee, 21);
  assert.equal(totals.total, 121);
  assert.deepEqual(Object.keys(totals).sort(), ['deliveryFee', 'foodSubtotal', 'tip', 'total']);
});

test('the courier earns the whole fee — GH₵21 with 0% commission', () => {
  const fee = calculateDeliveryFee(8, EXAMPLE_PRICING);
  const order = placeOrder({ subtotal: 100, delivery_fee: fee, delivery_distance_km: 8 });
  const fin = getOrderFinancials(order);

  assert.equal(fin.deliveryFee, 21);
  assert.equal(fin.courierEarning, 21);
  assert.equal(calculateCourierDeliveryShare(21, 0), 21);
  assert.equal(fin.platformRevenue, 15, 'the platform earns the restaurant side only');
});

test('restaurant commission = 15% of the FOOD subtotal (GH₵100 ⇒ GH₵15, net GH₵85)', () => {
  const { gross, commissionAmount, restaurantNet } = calculateRestaurantCommission(100, 15);
  assert.equal(gross, 100);
  assert.equal(commissionAmount, 15);
  assert.equal(restaurantNet, 85);

  const order = placeOrder({ subtotal: 100, delivery_fee: 21 });
  const fin = getOrderFinancials(order);
  assert.equal(fin.commissionAmount, 15);
  assert.equal(fin.restaurantNet, 85);
  // Never 15% of GH₵121 (the customer total) and never of the GH₵21 fee.
  assert.notEqual(fin.commissionAmount, 18.15);
  assert.notEqual(fin.commissionAmount, 3.15);
});

test('the delivery pricing never touches the restaurant commission', () => {
  // Same food, wildly different distance: commission must not move.
  const shortTrip = getOrderFinancials(
    placeOrder({ subtotal: 100, delivery_fee: calculateDeliveryFee(1, EXAMPLE_PRICING) })
  );
  const longTrip = getOrderFinancials(
    placeOrder({ id: 'ord-long', subtotal: 100, delivery_fee: calculateDeliveryFee(50, EXAMPLE_PRICING) })
  );

  assert.equal(shortTrip.commissionAmount, 15);
  assert.equal(longTrip.commissionAmount, 15);
  assert.equal(shortTrip.restaurantNet, 85);
  assert.equal(longTrip.restaurantNet, 85);
  assert.notEqual(shortTrip.deliveryFee, longTrip.deliveryFee, 'but the fee does move');
});

test('the customer total never includes a commission or platform line', () => {
  const totals = computeCustomerTotals(100, 21, 5);
  assert.equal(totals.total, 126);
  const banned = /commission|platform|service fee|our cut|booking fee/i;
  for (const key of Object.keys(totals)) {
    assert.equal(banned.test(key), false, `unexpected customer-visible key "${key}"`);
  }
});

// ---------------------------------------------------------------------------
// 2. The formula — clamping, optional ceiling, rounding
// ---------------------------------------------------------------------------

console.log('\n2. Fee formula');

test('base 5 + 6.4 km \u00d7 2 = GH\u20b517.80', () => {
  assert.equal(calculateDeliveryFee(6.4, EXAMPLE_PRICING), 17.8);
  assert.equal(formatGHS(calculateDeliveryFee(6.4, EXAMPLE_PRICING)), 'GH\u20b5 17.80');
});

test('money stays on 2 decimals (17.806 \u21d2 17.81)', () => {
  assert.equal(round2(17.806), 17.81);
  assert.equal(round2(17.804), 17.8);
  assert.equal(String(round2(0.1 + 0.2)), '0.3');
  // A fractional per-km rate still lands on whole cents.
  const fee = calculateDeliveryFee(3.7, {
    ...EXAMPLE_PRICING,
    base_fee: 5.555,
    per_km_rate: 1.111,
  });
  assert.equal(fee, round2(fee), 'the fee must already be rounded to cents');
});

test('the minimum floor lifts a very short trip', () => {
  const withFloor: PlatformPricingSettings = { ...EXAMPLE_PRICING, min_fee: 10 };
  assert.equal(calculateDeliveryFee(0.2, withFloor), 10); // 5 + 0.4 = 5.40 \u2192 10
  assert.equal(calculateDeliveryFee(20, withFloor), 45); // well above the floor
});

test('the maximum cap is OPTIONAL — absent means no ceiling', () => {
  const capped: PlatformPricingSettings = { ...EXAMPLE_PRICING, max_fee: 60 };
  const uncapped: PlatformPricingSettings = { ...EXAMPLE_PRICING, max_fee: null };

  assert.equal(calculateDeliveryFee(100, capped), 60); // 5 + 200 = 205 \u2192 60
  assert.equal(calculateDeliveryFee(100, uncapped), 205); // no ceiling
  assert.equal(calculateDeliveryFee(8, capped), 21); // the cap never bites short trips
  assert.equal(calculateDeliveryFee(8, { ...EXAMPLE_PRICING, max_fee: undefined }), 21);
});

test('surge multiplier applies before the clamps', () => {
  const surged: PlatformPricingSettings = { ...EXAMPLE_PRICING, surge_multiplier: 1.5 };
  assert.equal(calculateDeliveryFee(8, surged), 31.5); // 21 \u00d7 1.5
});

test('a missing distance can never invent a price', () => {
  assert.equal(isValidDeliveryPoint(null, null), false);
  assert.equal(isValidDeliveryPoint(0, 0), false, 'the (0,0) sentinel is not a place');
  assert.equal(isValidDeliveryPoint(5.6037, -0.187), true);
  assert.equal(isValidDeliveryPoint(91, -0.187), false);
  // A broken distance is treated as zero: base fee only, then floored.
  assert.equal(calculateDeliveryFee(Number.NaN, EXAMPLE_PRICING), 5);
});

// ---------------------------------------------------------------------------
// 3. Distance — measured, displayed, never fabricated
// ---------------------------------------------------------------------------

console.log('\n3. Distance');

test('haversine distance is symmetric and roughly right in Accra', () => {
  const from = { lat: 5.6037, lng: -0.187 };
  const to = { lat: 5.6719, lng: -0.1739 }; // roughly Osu \u2192 Accra central

  const forward = calculateDistanceKm(from.lat, from.lng, to.lat, to.lng);
  const backward = calculateDistanceKm(to.lat, to.lng, from.lat, from.lng);

  assert.equal(forward, backward, 'direction must not change the distance');
  assert.ok(forward > 1 && forward < 15, `expected a few kilometres, got ${forward}`);
});

test('distance display: 6.4 km, 850 m, or an em dash when unmeasured', () => {
  assert.equal(formatDistanceKm(6.4), '6.4 km');
  assert.equal(formatDistanceKm(0.85), '850 m');
  assert.equal(formatDistanceKm(null), '\u2014');
  assert.equal(formatDistanceKm(undefined), '\u2014');
  assert.equal(formatDistanceKm(Number.NaN), '\u2014');
});

test('two coordinates 8 km apart price at GH\u20b521', () => {
  // Pick a second point ~8 km north of the kitchen and let the formula
  // price the measured route rather than a hand-written number.
  const kitchen = { lat: 5.6037, lng: -0.187 };
  const dropOff = { lat: 5.67565, lng: -0.187 }; // ~8 km due north
  const distanceKm = calculateDistanceKm(kitchen.lat, kitchen.lng, dropOff.lat, dropOff.lng);

  assert.equal(distanceKm, 8, 'the route measures 8.00 km');
  assert.equal(calculateDeliveryFee(distanceKm, EXAMPLE_PRICING), 21);
});

// ---------------------------------------------------------------------------
// 4. Quote lifecycle
// ---------------------------------------------------------------------------

console.log('\n4. Delivery quotes');

test('the required "select a valid delivery location" message is exact', () => {
  assert.equal(
    DELIVERY_LOCATION_ERROR,
    'Please select a valid delivery location to calculate your delivery fee.'
  );
  // The same sentence must exist server-side, where it really blocks an order.
  const migration = read('supabase', 'migrations', '20261005_distance_delivery_pricing.sql');
  assert.ok(
    migration.includes(DELIVERY_LOCATION_ERROR),
    'the database must raise the identical message'
  );
});

test('quotes live for 5 minutes', () => {
  assert.equal(DELIVERY_QUOTE_TTL_MS, 5 * 60_000);
  const migration = read('supabase', 'migrations', '20261005_distance_delivery_pricing.sql');
  assert.ok(/interval '5 minutes'/.test(migration), 'server TTL must match the client');
});

test('an expired quote is never usable (45s safety margin)', () => {
  const now = Date.now();
  const fresh = quoteOver({ expiresAt: new Date(now + 5 * 60_000).toISOString() });
  const aboutToExpire = quoteOver({ expiresAt: new Date(now + 30_000).toISOString() });
  const expired = quoteOver({ expiresAt: new Date(now - 1000).toISOString() });

  assert.equal(isQuoteUsable(fresh, now), true);
  assert.equal(isQuoteUsable(aboutToExpire, now), false, 'refresh before it lapses');
  assert.equal(isQuoteUsable(expired, now), false);
  assert.equal(isQuoteUsable(null, now), false);
  assert.equal(isQuoteUsable(quoteOver({ quoteId: '', expiresAt: fresh.expiresAt }), now), false);
  assert.equal(
    isQuoteUsable(quoteOver({ expiresAt: 'not-a-date' }), now),
    false,
    'a garbled expiry is not a valid quote'
  );
});

// ---------------------------------------------------------------------------
// 5. Reporting — real rows only
// ---------------------------------------------------------------------------

console.log('\n5. Delivery reporting');

test('fees, earnings, distance and averages come from the stored orders', () => {
  const orders = [
    placeOrder({ id: 'o1', order_number: 'SG-1', delivery_fee: 21, delivery_distance_km: 8 }),
    placeOrder({ id: 'o2', order_number: 'SG-2', delivery_fee: 12, delivery_distance_km: 4 }),
    placeOrder({ id: 'o3', order_number: 'SG-3', delivery_fee: 17.8, delivery_distance_km: 6.4 }),
  ];

  const stats = aggregateDeliveryStats(orders);
  assert.equal(stats.orders, 3);
  assert.equal(stats.totalDeliveryFees, 50.8);
  assert.equal(stats.totalCourierEarnings, 50.8, 'Phase 1: couriers keep every pesewa');
  assert.equal(stats.totalDistanceKm, 18.4);
  assert.equal(stats.averageDistanceKm, round2(18.4 / 3));
  assert.equal(stats.averageDeliveryFee, round2(50.8 / 3));
  assert.equal(stats.measuredOrders, 3);
});

test('cancelled or unpaid orders are excluded — no invented money', () => {
  const orders = [
    placeOrder({ id: 'o1', order_number: 'SG-1', delivery_fee: 21, delivery_distance_km: 8 }),
    placeOrder({
      id: 'o2',
      order_number: 'SG-2',
      status: 'CANCELLED',
      settlement_status: 'CANCELLED',
      payment_status: 'FAILED',
      delivery_fee: 999,
      delivery_distance_km: 100,
    }),
  ];

  const stats = aggregateDeliveryStats(orders);
  assert.equal(stats.orders, 1);
  assert.equal(stats.totalDeliveryFees, 21);
  assert.equal(stats.totalDistanceKm, 8);
  assert.equal(stats.averageDistanceKm, 8);
});

test('an empty book reports zeros instead of mock data', () => {
  const stats = aggregateDeliveryStats([]);
  assert.deepEqual(stats, {
    orders: 0,
    totalDeliveryFees: 0,
    totalCourierEarnings: 0,
    totalDistanceKm: 0,
    averageDistanceKm: 0,
    averageDeliveryFee: 0,
    measuredOrders: 0,
  });
});

test('orders without a stored distance still count their fees', () => {
  const legacy = placeOrder({
    id: 'legacy',
    order_number: 'SG-9',
    delivery_distance_km: null,
    delivery_fee: 12,
  });
  assert.equal(isCommissionRecognized(legacy), true);

  const stats = aggregateDeliveryStats([legacy]);
  assert.equal(stats.orders, 1);
  assert.equal(stats.measuredOrders, 0, 'a missing distance is never guessed');
  assert.equal(stats.totalDistanceKm, 0);
  assert.equal(stats.averageDistanceKm, 0);
  assert.equal(stats.totalDeliveryFees, 12);
  assert.equal(stats.averageDeliveryFee, 12);
});

test('a refunded delivery is not reported as collected', () => {
  const orders = [
    placeOrder({ id: 'o1', order_number: 'SG-1', delivery_fee: 21, delivery_distance_km: 8 }),
    placeOrder({ id: 'o2', order_number: 'SG-2', delivery_fee: 12, delivery_distance_km: 4 }),
  ];
  const adjustments = [
    refundAdjustment({
      order_id: 'o1',
      refund_amount: 5,
      delivery_amount_refunded: 5,
      courier_earning_adjustment: -5,
    }),
  ];

  const stats = aggregateDeliveryStats(orders, adjustments);
  assert.equal(stats.totalDeliveryFees, 28, '33 collected \u2212 5 refunded');
  assert.equal(stats.totalCourierEarnings, 28, 'the courier keeps only what was charged');
  assert.equal(stats.totalDistanceKm, 12, 'distance is unchanged by a refund');
});

// ---------------------------------------------------------------------------
// 6. Source scans — the UI cannot set a price
// ---------------------------------------------------------------------------

console.log('\n6. Source scans');

test('checkout posts a quote id, never a delivery fee', () => {
  const cart = read('src', 'pages', 'customer', 'CartPage.tsx');
  const anchor = cart.indexOf(".from('orders')");
  assert.ok(anchor > 0, 'CartPage creates the order');

  const block = cart.slice(anchor, anchor + 900);
  assert.equal(/delivery_fee\s*:/.test(block), false, 'the browser must not price the order');
  assert.equal(/delivery_quote_id\s*:/.test(block), true, 'the validated quote is posted');
  assert.equal(/delivery_latitude\s*:/.test(block), true, 'coordinates are always submitted');
  assert.equal(/total_amount\s*:/.test(block), true);
  assert.equal(
    /(commission|courier_earning|platform_revenue|restaurant_net_amount)\s*:/.test(block),
    false
  );
});

test('reorder posts a quote id as well (no stale fee reuse)', () => {
  const reorder = read('src', 'lib', 'reorder.ts');
  assert.equal(/delivery_quote_id\s*:/.test(reorder), true);
  assert.equal(/delivery_fee\s*:/.test(reorder), false, 'a historical fee is never re-submitted');
  assert.equal(/requestDeliveryQuote/.test(reorder), true, 'reorders quote the route afresh');
});

test('the checkout never falls back to fabricated coordinates', () => {
  const cart = read('src', 'pages', 'customer', 'CartPage.tsx');
  assert.equal(/5\.6037/.test(cart), false, 'no hard-coded Accra kitchen default');
  assert.equal(/\|\|\s*5\.6\d/.test(cart), false, 'no hard-coded customer default');
  assert.ok(/isValidDeliveryPoint/.test(cart), 'the delivery point must be validated');
  assert.ok(/DELIVERY_LOCATION_ERROR/.test(cart), 'the required message is surfaced');
});

test('customer pages show distance + fee and never a commission label', () => {
  const visible = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*import\s/.test(line) && !/^\s*\/\//.test(line))
      .join('\n')
      .replace(/\/\/.*$/g, '');

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        const source = visible(readFileSync(full, 'utf8'));
        if (/commission|platform fee|service fee/i.test(source)) offenders.push(entry);
      }
    }
  };
  walk(path.join(ROOT, 'src', 'pages', 'customer'));
  assert.deepEqual(offenders, [], `commission wording leaked into: ${offenders.join(', ')}`);

  const cart = visible(read('src', 'pages', 'customer', 'CartPage.tsx'));
  for (const label of ['Food subtotal', 'Delivery distance', 'Delivery fee', 'Total']) {
    assert.ok(cart.includes(label), `checkout must show "${label}"`);
  }

  const detail = visible(read('src', 'pages', 'customer', 'OrderDetailPage.tsx'));
  assert.ok(detail.includes('Delivery distance'), 'the receipt shows the measured distance');
});

test('the courier sees distance, delivery fee and earning', () => {
  const courier = read('src', 'pages', 'courier', 'CourierDashboard.tsx');
  assert.ok(courier.includes('Delivery fee'), 'request cards show the fee');
  assert.ok(courier.includes('Courier earning'), 'request cards show the earning');
  assert.ok(courier.includes('Distance'), 'request cards show the distance');
  assert.ok(
    courier.includes('formatDistanceKm'),
    'the distance is formatted from the stored value'
  );
});

test('admin saves pricing through the database RPC, not a raw row write', () => {
  const admin = read('src', 'pages', 'admin', 'AdminDashboard.tsx');
  assert.ok(
    /supabase\.rpc\('set_delivery_pricing'/.test(admin),
    'pricing is validated and versioned server-side'
  );
  assert.equal(
    /\.from\('platform_settings'\)\s*\n?\s*\.upsert\(/.test(admin),
    false,
    'settings must not be upserted straight from the browser'
  );
  for (const label of [
    'Total delivery fees collected',
    'Total courier earnings',
    'Total delivery distance',
    'Average delivery distance',
    'Average delivery fee',
  ]) {
    assert.ok(admin.includes(label), `admin reporting must show "${label}"`);
  }
  assert.ok(
    /aggregateDeliveryStats/.test(admin),
    'delivery stats are aggregated from real order rows'
  );
});

test('the migration carries the whole server contract', () => {
  const sql = read('supabase', 'migrations', '20261005_distance_delivery_pricing.sql');

  // Server-calculated, 2-decimal money.
  assert.ok(/create or replace function public\.delivery_pricing_amounts/.test(sql));
  assert.ok(/round\(\(v_base \+ v_dist \* v_rate\)/.test(sql), 'the formula lives in SQL');
  assert.ok(/round\(v_fee \* v_earning \/ 100, 2\)/.test(sql), 'courier earning is 2dp');

  // Road distance is only accepted when it is plausible.
  assert.ok(/p_road_distance_km >= greatest\(0\.01, v_straight \* 0\.90\)/.test(sql));
  assert.ok(/p_road_distance_km <= greatest\(1\.0, v_straight \* 3\.0\)/.test(sql));
  assert.ok(/public\.haversine_km/.test(sql), 'the server measures its own distance');

  // Quotes + ordering rules.
  assert.ok(/interval '5 minutes'/.test(sql), 'quotes expire after 5 minutes');
  assert.ok(/create table if not exists public\.delivery_quotes/.test(sql));
  assert.ok(/delivery_quote_id/.test(sql), 'orders remember which quote they consumed');
  assert.ok(/delivery_pricing_version/.test(sql), 'pricing changes never rewrite history');
  assert.ok(/delivery_distance_km/.test(sql));

  // No client can read the pricing function directly or write quote rows.
  assert.ok(
    /revoke execute on function public\.delivery_pricing_amounts/.test(sql),
    'the fee function is not callable by clients'
  );
  assert.ok(
    /alter table public\.delivery_quotes enable row level security/.test(sql),
    'quote rows are policy protected'
  );
  assert.ok(
    /grant select on public\.delivery_quotes to authenticated/.test(sql),
    'authenticated users may only read quotes'
  );
  assert.ok(/revoke all on public\.delivery_quotes from anon/.test(sql));
  assert.equal(
    /grant\s+(insert|update|delete|all)[^\n]*delivery_quotes\s+to\s+(authenticated|anon)/.test(sql),
    false,
    'clients must never be able to insert, update or delete a quote'
  );
  assert.ok(/for select using \(/.test(sql), 'quotes are only readable by their owner');
});

test('no client code writes money fields for an order', () => {
  const writePattern =
    /(commission_rate|commission_amount|restaurant_gross_amount|restaurant_net_amount|courier_earning|platform_revenue)\s*:/;
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        const source = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        if (writePattern.test(source)) offenders.push(path.relative(ROOT, full));
      }
    }
  };

  const srcDir = path.join(ROOT, 'src');
  for (const entry of readdirSync(srcDir)) {
    if (entry === 'types') continue;
    const full = path.join(srcDir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry)) {
      const source = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (writePattern.test(source)) offenders.push(path.relative(ROOT, full));
    }
  }

  assert.deepEqual(offenders, [], `client code must not write money: ${offenders.join(', ')}`);
});

test('delivery quote rows are never written from the browser', () => {
  const offenders: string[] = [];
  const srcDir = path.join(ROOT, 'src');

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        const source = readFileSync(full, 'utf8');
        if (/from\(['"]delivery_quotes['"]\)/.test(source)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [], `quotes must only be created by the server: ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
