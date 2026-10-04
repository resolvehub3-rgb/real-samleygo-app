/**
 * SamleyGo Phase 1 payment & commission model — test suite.
 *
 *   pnpm test        (tsx scripts/commission.test.ts)
 *
 * What is covered (7 required scenarios + the canonical worked example):
 *   1. Checkout totals — the customer pays food + delivery (+ tip), nothing else
 *   2. Commission math — 15% of the FOOD subtotal, never of the delivery fee
 *   3. Courier payout — 0% commission, the courier keeps the whole delivery fee
 *   4. Rate versioning — a later rate change never rewrites old orders
 *   5. Cancellation — a cancelled order recognizes no commission
 *   6. Refund — reversals are append-only adjustments netted out of totals
 *   7. Security — bad rates are rejected and the client never writes money
 *   8. Settlement — payment success alone never marks a payout as earned
 *
 * IMPORTANT: the database is the authority for every number
 * (supabase/migrations/20261004_payment_commission_model.sql computes them in
 * a trigger and rejects client tampering). These tests lock down the client
 * helpers that DISPLAY those numbers, the aggregation rules dashboards use,
 * and the fact that no client code path submits financial fields at all.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregateFinancials,
  calculateCourierDeliveryShare,
  calculateRestaurantCommission,
  computeCustomerTotals,
  getOrderFinancials,
  isCommissionRecognized,
  round2,
  validateCommissionPercentage,
  DEFAULT_COMMISSION_SETTINGS,
  MAX_RESTAURANT_COMMISSION_PERCENTAGE,
} from '../src/lib/commission';
import { CommissionSettings, Order, OrderSettlementAdjustment } from '../src/types/database';

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

// ---------------------------------------------------------------------------
// Fixtures — shaped exactly like rows the database writes
// ---------------------------------------------------------------------------

/** Mirrors compute_order_financials(): commission on food, courier keeps the fee. */
function placeOrder(
  overrides: Partial<Order>,
  settings: CommissionSettings = DEFAULT_COMMISSION_SETTINGS
): Order {
  const subtotal = overrides.subtotal ?? 200;
  const deliveryFee = overrides.delivery_fee ?? 25;
  const tip = overrides.tip ?? 0;
  const commission = calculateRestaurantCommission(
    subtotal,
    settings.restaurant_commission_percentage
  );
  const courierShare = calculateCourierDeliveryShare(
    deliveryFee,
    settings.courier_commission_percentage
  );

  return {
    id: 'ord-0001',
    order_number: 'SG-100001',
    customer_id: 'cust-0001',
    restaurant_id: 'rest-0001',
    status: 'DELIVERED',
    subtotal,
    delivery_fee: deliveryFee,
    tip,
    total_amount: round2(subtotal + deliveryFee + tip),
    commission_rate: settings.restaurant_commission_percentage,
    commission_amount: commission.commissionAmount,
    restaurant_gross_amount: commission.gross,
    restaurant_net_amount: commission.restaurantNet,
    courier_earning: courierShare,
    platform_revenue: round2(commission.commissionAmount + (deliveryFee - courierShare)),
    currency: 'GHS',
    settlement_status: 'ELIGIBLE',
    delivery_address: 'Osu, Accra',
    customer_phone: '0240000000',
    payment_method: 'MTN_MOMO',
    payment_status: 'COMPLETED',
    created_at: '2026-10-04T10:00:00.000Z',
    updated_at: '2026-10-04T10:30:00.000Z',
    ...overrides,
  };
}

/** Row shape written by record_order_refund() — signed, append-only. */
function refundAdjustment(
  overrides: Partial<OrderSettlementAdjustment>
): OrderSettlementAdjustment {
  return {
    id: 'adj-0001',
    order_id: 'ord-0001',
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
    created_at: '2026-10-05T09:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Checkout totals — customer sees food + delivery (+ tip) and nothing else
// ---------------------------------------------------------------------------

console.log('\n1. Checkout totals');

test('customer total = food subtotal + delivery fee + tip', () => {
  const totals = computeCustomerTotals(200, 25, 5);
  assert.equal(totals.foodSubtotal, 200);
  assert.equal(totals.deliveryFee, 25);
  assert.equal(totals.tip, 5);
  assert.equal(totals.total, 230);
});

test('checkout summary has no commission / platform / service fee line', () => {
  const totals = computeCustomerTotals(200, 25, 5);
  assert.deepEqual(Object.keys(totals).sort(), [
    'deliveryFee',
    'foodSubtotal',
    'tip',
    'total',
  ]);
  const banned = /commission|platform|service fee|our cut|booking fee/i;
  for (const key of Object.keys(totals)) {
    assert.equal(banned.test(key), false, `unexpected customer-visible key "${key}"`);
  }
});

test('customer-facing pages never render a commission label', () => {
  // Strip imports and comments — only user-visible code counts.
  const visible = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*import\s/.test(line) && !/^\s*\/\//.test(line))
      .join('\n')
      .replace(/\/\/.*$/g, '');

  const customerDir = path.join(ROOT, 'src', 'pages', 'customer');
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
  walk(customerDir);
  assert.deepEqual(offenders, [], `commission wording leaked into: ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 2. Commission math — 15% of the FOOD subtotal
// ---------------------------------------------------------------------------

console.log('\n2. Commission math');

test('GH\u20b5200 food order at 15% \u21d2 GH\u20b530 commission, GH\u20b5170 net', () => {
  const order = placeOrder({ subtotal: 200, delivery_fee: 25 });
  const fin = getOrderFinancials(order);

  assert.equal(fin.foodSubtotal, 200);
  assert.equal(fin.commissionRate, 15);
  assert.equal(fin.commissionAmount, 30);
  assert.equal(fin.restaurantGross, 200);
  assert.equal(fin.restaurantNet, 170);
  // The customer still pays food + delivery only.
  assert.equal(fin.customerTotal, 225);
  // Platform revenue is the commission — the delivery fee is the courier's.
  assert.equal(fin.platformRevenue, 30);
});

test('commission is never charged on the delivery fee', () => {
  const commission = calculateRestaurantCommission(200, 15);
  assert.equal(commission.commissionAmount, 30);
  // A GH₵100 fee would add GH₵15 of wrongly-computed commission — assert the
  // helper is only ever fed the food subtotal by checking the order row.
  const order = placeOrder({ subtotal: 200, delivery_fee: 100 });
  const fin = getOrderFinancials(order);
  assert.equal(fin.commissionAmount, 30, 'delivery fee must not affect commission');
  assert.equal(fin.courierEarning, 100, 'the whole fee goes to the courier');
  assert.equal(fin.platformRevenue, 30);
});

test('rounding stays on 2 decimals (no float dust)', () => {
  const commission = calculateRestaurantCommission(19.99, 15);
  assert.equal(commission.commissionAmount, 3);
  assert.equal(commission.restaurantNet, 16.99);
  assert.equal(round2(100 * 0.15), 15);
  assert.equal(String(round2(0.1 + 0.2)), '0.3');
});

test('the canonical example: GH₵100 food order', () => {
  const { gross, commissionAmount, restaurantNet } = calculateRestaurantCommission(100, 15);
  assert.equal(gross, 100);
  assert.equal(commissionAmount, 15);
  assert.equal(restaurantNet, 85);
});

// ---------------------------------------------------------------------------
// 3. Courier — 0% commission, full delivery fee
// ---------------------------------------------------------------------------

console.log('\n3. Courier keeps the whole delivery fee');

test('courier earns 100% of the delivery fee (0% courier commission)', () => {
  assert.equal(calculateCourierDeliveryShare(25, 0), 25);
  assert.equal(calculateCourierDeliveryShare(60, 0), 60);

  const order = placeOrder({ subtotal: 200, delivery_fee: 25, tip: 5 });
  const fin = getOrderFinancials(order);
  assert.equal(fin.courierEarning, 25, 'tip is never part of courier_earning');
  assert.equal(fin.courierDeliveryShare, 25);
  assert.equal(fin.tip, 5, 'the tip stays separate and belongs to the courier');
});

test('platform revenue = restaurant commission only (no delivery cut)', () => {
  const order = placeOrder({ subtotal: 200, delivery_fee: 25 });
  const summary = aggregateFinancials([order]);
  assert.equal(summary.deliveryFees, 25);
  assert.equal(summary.courierEarnings, 25);
  assert.equal(summary.restaurantCommission, 30);
  assert.equal(summary.platformRevenue, 30);
  assert.equal(summary.restaurantPayouts, 170);
  // 30 + 170 = 200 food · 25 + 0 = 25 delivery — everything reconciles.
  assert.equal(round2(summary.restaurantPayouts + summary.restaurantCommission), 200);
  assert.equal(round2(summary.courierEarnings), summary.deliveryFees);
});

// ---------------------------------------------------------------------------
// 4. Rate versioning — old orders never change
// ---------------------------------------------------------------------------

console.log('\n4. Commission rate change versioning');

test('raising the rate to 25% leaves historical orders at 15%', () => {
  const placedYesterday = placeOrder(
    { subtotal: 200, delivery_fee: 25 },
    DEFAULT_COMMISSION_SETTINGS
  );

  // Platform admin raises the rate.
  const newSettings: CommissionSettings = {
    ...DEFAULT_COMMISSION_SETTINGS,
    restaurant_commission_percentage: 25,
  };
  const placedToday = placeOrder({ subtotal: 200, delivery_fee: 25 }, newSettings);

  // The historical row keeps its snapshot…
  assert.equal(placedYesterday.commission_rate, 15);
  assert.equal(getOrderFinancials(placedYesterday).commissionAmount, 30);
  assert.equal(getOrderFinancials(placedYesterday).restaurantNet, 170);

  // …while the new order carries the new rate.
  assert.equal(placedToday.commission_rate, 25);
  assert.equal(getOrderFinancials(placedToday).commissionAmount, 50);
  assert.equal(getOrderFinancials(placedToday).restaurantNet, 150);

  // Aggregating both never rewrites history: 30 + 50 = 80.
  const summary = aggregateFinancials([placedYesterday, placedToday]);
  assert.equal(summary.restaurantCommission, 80);
  assert.equal(summary.restaurantPayouts, 320);
});

// ---------------------------------------------------------------------------
// 5. Cancellation — commission is never recognized
// ---------------------------------------------------------------------------

console.log('\n5. Cancellation');

test('a cancelled order recognizes no commission', () => {
  const cancelled = placeOrder({
    status: 'CANCELLED',
    settlement_status: 'CANCELLED',
    payment_status: 'FAILED',
  });
  assert.equal(isCommissionRecognized(cancelled), false);
  assert.equal(getOrderFinancials(cancelled).recognized, false);

  const delivered = placeOrder({ id: 'ord-0002', order_number: 'SG-100002' });
  const summary = aggregateFinancials([cancelled, delivered]);
  assert.equal(summary.recognizedOrders, 1, 'only the delivered order counts');
  assert.equal(summary.restaurantCommission, 30);
  assert.equal(summary.totalFoodSales, 200);
});

test('a fully cancelled book produces an empty (zero) summary, not fake money', () => {
  const summary = aggregateFinancials([
    placeOrder({ settlement_status: 'CANCELLED', status: 'REJECTED' }),
  ]);
  assert.equal(summary.recognizedOrders, 0);
  assert.equal(summary.restaurantCommission, 0);
  assert.equal(summary.platformRevenue, 0);
  assert.equal(summary.restaurantPayouts, 0);
});

// ---------------------------------------------------------------------------
// 6. Refunds — append-only adjustments, never rewritten history
// ---------------------------------------------------------------------------

console.log('\n6. Refunds');

test('a GH₵100 partial refund reverses GH₵15 of commission', () => {
  const order = placeOrder({ subtotal: 200, delivery_fee: 25 });
  // record_order_refund() maths: GH₵100 comes off the food first, so the
  // commission reverses proportionally (15% of 100 = 15) and the restaurant's
  // share of that food reverses by 100 - 15 = 85.
  const adjustment = refundAdjustment({
    refund_amount: 100,
    food_amount_refunded: 100,
    commission_adjustment: -15,
    restaurant_net_adjustment: -85,
    platform_revenue_adjustment: -15,
  });

  const summary = aggregateFinancials([order], [adjustment]);
  assert.equal(summary.restaurantCommission, 15, '30 − 15 refunded commission');
  assert.equal(summary.restaurantPayouts, 85, '170 − 85 refunded payout');
  assert.equal(summary.platformRevenue, 15);

  // The original order row is untouched — refunds are additive.
  assert.equal(order.commission_amount, 30);
  assert.equal(order.restaurant_net_amount, 170);
});

test('a full refund drops the order out of the recognized totals entirely', () => {
  const order = placeOrder({
    settlement_status: 'REVERSED',
    payment_status: 'REFUNDED',
  });
  const adjustment = refundAdjustment({
    adjustment_type: 'REFUND',
    refund_amount: 225,
    food_amount_refunded: 200,
    delivery_amount_refunded: 25,
    commission_adjustment: -30,
    restaurant_net_adjustment: -170,
    courier_earning_adjustment: -25,
    platform_revenue_adjustment: -30,
  });

  assert.equal(isCommissionRecognized(order), false);
  const summary = aggregateFinancials([order], [adjustment]);
  assert.equal(summary.recognizedOrders, 0);
  assert.equal(summary.restaurantCommission, 0, 'money is never counted twice');
  assert.equal(summary.courierEarnings, 0);
});

// ---------------------------------------------------------------------------
// 7. Security — reject bad input, never let the client write money
// ---------------------------------------------------------------------------

console.log('\n7. Security');

test('validateCommissionPercentage rejects every hostile value', () => {
  const rejected: Array<string | number> = [
    '',
    '   ',
    'abc',
    '15abc',
    NaN,
    Infinity,
    -Infinity,
    -1,
    -0.01,
    MAX_RESTAURANT_COMMISSION_PERCENTAGE + 0.01,
    100,
    null as unknown as number,
    undefined as unknown as number,
  ];
  for (const value of rejected) {
    const result = validateCommissionPercentage(value);
    assert.equal(result.ok, false, `should reject ${JSON.stringify(value)}`);
    if (!result.ok) assert.ok(result.error.length > 0, 'an error message is required');
  }
});

test('validateCommissionPercentage accepts valid rates in 0–50', () => {
  for (const value of ['0', '15', '12.5', '50', 0, 15, 25.5]) {
    const result = validateCommissionPercentage(value);
    assert.equal(result.ok, true, `should accept ${JSON.stringify(value)}`);
  }
  assert.deepEqual(validateCommissionPercentage('12.5'), { ok: true, value: 12.5 });
  assert.deepEqual(validateCommissionPercentage('15'), { ok: true, value: 15 });
});

test('no client code submits commission or payout fields', () => {
  // The database overwrites them anyway (apply_order_financials), but the app
  // must not even try: money is computed server-side only.
  const writePattern =
    /(commission_rate|commission_amount|restaurant_gross_amount|restaurant_net_amount|courier_earning|platform_revenue)\s*:/;
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const source = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (writePattern.test(source)) offenders.push(path.relative(ROOT, full));
    }
  };
  // src/types is interface declarations (shapes, not writes).
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

  assert.deepEqual(
    offenders,
    [],
    `client code must not write financial fields: ${offenders.join(', ')}`
  );
});

test('order creation only submits what the customer controls', () => {
  const cartSource = readFileSync(path.join(ROOT, 'src', 'pages', 'customer', 'CartPage.tsx'), 'utf8');
  const anchor = cartSource.indexOf(".from('orders')");
  assert.ok(anchor > 0, 'CartPage should create an order');
  // The payload the browser actually posts for the order row.
  const block = cartSource.slice(anchor, anchor + 900);
  assert.equal(
    /(commission|courier_earning|platform_revenue|restaurant_net_amount)\s*:/.test(block),
    false,
    'checkout must not submit commission or payout values'
  );
  // The delivery fee the customer sees is only ever a preview: the database
  // re-derives it from coordinates + pricing rules on insert.
  assert.equal(/total_amount\s*:/.test(block), true, 'the customer total is posted');
});

// ---------------------------------------------------------------------------
// 8. Settlement lifecycle — payment is not a payout
// ---------------------------------------------------------------------------

console.log('\n8. Settlement lifecycle');

test('only ELIGIBLE / PROCESSING / PAID recognize commission', () => {
  const statuses = {
    PENDING: false,
    ELIGIBLE: true,
    PROCESSING: true,
    PAID: true,
    REVERSED: false,
    CANCELLED: false,
  } as const;

  for (const [settlement, expected] of Object.entries(statuses)) {
    const order = placeOrder({
      settlement_status: settlement as Order['settlement_status'],
    });
    assert.equal(
      isCommissionRecognized(order),
      expected,
      `${settlement} should${expected ? '' : ' not'} be recognized`
    );
  }
});

test('settlement progression: payment success alone never earns a payout', () => {
  const paidButNotDelivered = placeOrder({
    status: 'PREPARING',
    settlement_status: 'PENDING',
    payment_status: 'COMPLETED',
  });
  assert.equal(isCommissionRecognized(paidButNotDelivered), false);

  const deliveredAndSettled = placeOrder({ settlement_status: 'ELIGIBLE' });
  const summary = aggregateFinancials([paidButNotDelivered, deliveredAndSettled]);
  assert.equal(summary.recognizedOrders, 1);
  assert.equal(summary.restaurantCommission, 30);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
