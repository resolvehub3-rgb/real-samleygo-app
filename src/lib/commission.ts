import {
  Order,
  OrderSettlementAdjustment,
  SettlementStatus,
  CommissionSettings,
} from '../types/database';

/**
 * SamleyGo Phase 1 commission model — the ONE client-side source of truth
 * for displaying and aggregating money.
 *
 * IMPORTANT: these helpers exist for DISPLAY and reporting only. Every
 * value stored on an order is computed by the database (see
 * supabase/migrations/20261004_payment_commission_model.sql) — the client
 * never submits commission, payout or platform-revenue numbers.
 *
 *   Customer pays  : food subtotal + delivery fee (+ optional tip)
 *   Restaurant     : commission on FOOD SUBTOTAL only (default 15%)
 *   Courier        : receives the delivery earning, 0% commission (Phase 1)
 *   SamleyGo       : earns the restaurant commission
 */

/** Permitted business maximum for either commission rate (validated by
 * the database too — see set_commission_settings()). */
export const MAX_RESTAURANT_COMMISSION_PERCENTAGE = 50;
export const MAX_COURIER_COMMISSION_PERCENTAGE = 50;
export const DEFAULT_RESTAURANT_COMMISSION_PERCENTAGE = 15;
export const DEFAULT_COURIER_COMMISSION_PERCENTAGE = 0;

export const DEFAULT_COMMISSION_SETTINGS: CommissionSettings = {
  restaurant_commission_percentage: DEFAULT_RESTAURANT_COMMISSION_PERCENTAGE,
  courier_commission_percentage: DEFAULT_COURIER_COMMISSION_PERCENTAGE,
  max_restaurant_commission_percentage: MAX_RESTAURANT_COMMISSION_PERCENTAGE,
  max_courier_commission_percentage: MAX_COURIER_COMMISSION_PERCENTAGE,
  currency: 'GHS',
};

/** Settlement states in which earned money is actually recognized. */
const RECOGNIZED_SETTLEMENT_STATUSES: SettlementStatus[] = [
  'ELIGIBLE',
  'PROCESSING',
  'PAID',
];

const CANCELLED_STATUSES = ['CANCELLED', 'REJECTED', 'FAILED'];
const DELIVERED_STATUSES = ['DELIVERED', 'COMPLETED'];

/** Round to 2 decimals, absorbing float noise (100 * 0.15 = 15.000000000000002). */
export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export type CommissionValidation =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Validates a commission percentage coming from an input field.
 * Rejects empty values, non-numbers, NaN, Infinity, negatives and values
 * above the permitted business maximum. Mirrors the database-side checks.
 */
export function validateCommissionPercentage(
  raw: string | number,
  max: number = MAX_RESTAURANT_COMMISSION_PERCENTAGE
): CommissionValidation {
  if (raw === '' || raw === null || raw === undefined) {
    return { ok: false, error: 'Enter a percentage.' };
  }
  // Number('   ') is 0 — a blank (or whitespace-only) box must never read
  // as a valid 0% commission.
  const normalized =
    typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw.trim())) : raw;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized)) {
    return { ok: false, error: 'Enter a valid number.' };
  }
  if (normalized < 0) {
    return { ok: false, error: 'The percentage cannot be negative.' };
  }
  if (normalized > max) {
    return { ok: false, error: `The percentage cannot exceed ${max}%.` };
  }
  return { ok: true, value: round2(normalized) };
}

/**
 * Restaurant commission on the FOOD SUBTOTAL (never the delivery fee).
 * GH₵200 × 15% = GH₵30 commission, GH₵170 restaurant net.
 */
export function calculateRestaurantCommission(
  foodSubtotal: number,
  commissionPercentage: number
): { gross: number; commissionAmount: number; restaurantNet: number } {
  const gross = round2(foodSubtotal || 0);
  const commissionAmount = round2((gross * commissionPercentage) / 100);
  return {
    gross,
    commissionAmount,
    restaurantNet: round2(gross - commissionAmount),
  };
}

/**
 * Courier's share of the delivery fee. Phase 1 courier commission is 0%,
 * so the courier receives the full delivery fee.
 */
export function calculateCourierDeliveryShare(
  deliveryFee: number,
  courierCommissionPercentage: number = DEFAULT_COURIER_COMMISSION_PERCENTAGE
): number {
  const fee = round2(deliveryFee || 0);
  return round2((fee * (100 - (courierCommissionPercentage || 0))) / 100);
}

/**
 * What the customer pays: food subtotal + delivery fee (+ optional tip).
 * There is NO platform/service/app/commission line — those are internal
 * marketplace settlement calculations, never customer charges.
 */
export function computeCustomerTotals(
  foodSubtotal: number,
  deliveryFee: number,
  tip: number = 0
): { foodSubtotal: number; deliveryFee: number; tip: number; total: number } {
  const subtotal = round2(foodSubtotal || 0);
  const fee = round2(deliveryFee || 0);
  const tipAmount = round2(tip || 0);
  return {
    foodSubtotal: subtotal,
    deliveryFee: fee,
    tip: tipAmount,
    total: round2(subtotal + fee + tipAmount),
  };
}

/** Resolved, display-ready financial breakdown of a single order. */
export interface OrderFinancials {
  foodSubtotal: number;
  deliveryFee: number;
  tip: number;
  customerTotal: number;
  commissionRate: number;
  commissionAmount: number;
  restaurantGross: number;
  restaurantNet: number;
  courierDeliveryShare: number;
  courierEarning: number;
  platformRevenue: number;
  settlementStatus: SettlementStatus;
  recognized: boolean;
}

/**
 * Is this order's commission actually recognized? Mirrors the database
 * settlement lifecycle: only delivered & paid orders count; cancelled,
 * refunded-back and unsettled orders never do.
 */
export function isCommissionRecognized(order: Order): boolean {
  if (order.settlement_status) {
    return RECOGNIZED_SETTLEMENT_STATUSES.includes(order.settlement_status);
  }
  // Defensive fallback for rows written before the settlement migration.
  if (CANCELLED_STATUSES.includes(order.status)) return false;
  return (
    DELIVERED_STATUSES.includes(order.status) &&
    order.payment_status === 'COMPLETED'
  );
}

/**
 * Full breakdown of one order with the stored (versioned) values.
 * Falls back to the Phase 1 defaults only for rows written before the
 * settlement migration — after that migration every row carries its own
 * snapshot, and a later platform rate change never reaches it.
 */
export function getOrderFinancials(
  order: Order,
  courierCommissionPercentage: number = DEFAULT_COURIER_COMMISSION_PERCENTAGE
): OrderFinancials {
  const foodSubtotal = round2(order.subtotal || 0);
  const deliveryFee = round2(order.delivery_fee || 0);
  const tip = round2(order.tip || 0);
  const commissionRate =
    order.commission_rate ?? DEFAULT_RESTAURANT_COMMISSION_PERCENTAGE;

  const commissionAmount =
    order.commission_amount ??
    calculateRestaurantCommission(foodSubtotal, commissionRate).commissionAmount;
  const restaurantGross = order.restaurant_gross_amount ?? foodSubtotal;
  const restaurantNet =
    order.restaurant_net_amount ?? round2(foodSubtotal - commissionAmount);
  const courierEarning =
    order.courier_earning ??
    calculateCourierDeliveryShare(deliveryFee, courierCommissionPercentage);
  const platformRevenue =
    order.platform_revenue ??
    round2(commissionAmount + (deliveryFee - courierEarning));

  return {
    foodSubtotal,
    deliveryFee,
    tip,
    customerTotal: round2(foodSubtotal + deliveryFee + tip),
    commissionRate,
    commissionAmount: round2(commissionAmount),
    restaurantGross: round2(restaurantGross),
    restaurantNet: round2(restaurantNet),
    courierDeliveryShare: calculateCourierDeliveryShare(
      deliveryFee,
      courierCommissionPercentage
    ),
    courierEarning: round2(courierEarning),
    platformRevenue: round2(platformRevenue),
    settlementStatus: order.settlement_status ?? 'PENDING',
    recognized: isCommissionRecognized(order),
  };
}

/** Aggregated financial truth, straight from real order rows. */
export interface PlatformFinancialSummary {
  recognizedOrders: number;
  /** Recognized food sales (restaurant gross). */
  totalFoodSales: number;
  /** Restaurant commission earned (net of refund reversals). */
  restaurantCommission: number;
  /** Delivery fees collected on recognized orders. */
  deliveryFees: number;
  /** What couriers earn from delivery fees (0% courier commission). */
  courierEarnings: number;
  /** What restaurants are owed: food minus commission (net of refunds). */
  restaurantPayouts: number;
  /** SamleyGo revenue: restaurant commission (+ delivery share, if any). */
  platformRevenue: number;
}

export const EMPTY_FINANCIAL_SUMMARY: PlatformFinancialSummary = {
  recognizedOrders: 0,
  totalFoodSales: 0,
  restaurantCommission: 0,
  deliveryFees: 0,
  courierEarnings: 0,
  restaurantPayouts: 0,
  platformRevenue: 0,
};

/**
 * Sums the recognized money in a set of orders.
 *
 * Refund/cancellation adjustments are netted against orders that are
 * STILL recognized; an order whose settlement was reversed drops out of
 * the base totals entirely, so money never counts twice.
 */
export function aggregateFinancials(
  orders: Order[],
  adjustments: OrderSettlementAdjustment[] = []
): PlatformFinancialSummary {
  const recognized = orders.filter(isCommissionRecognized);
  if (recognized.length === 0) {
    return { ...EMPTY_FINANCIAL_SUMMARY };
  }

  const recognizedIds = new Set(recognized.map((o) => o.id));
  const adjustmentTotals = adjustments.reduce(
    (acc, adj) => {
      if (!recognizedIds.has(adj.order_id)) return acc;
      acc.commission += adj.commission_adjustment || 0;
      acc.restaurantNet += adj.restaurant_net_adjustment || 0;
      acc.courier += adj.courier_earning_adjustment || 0;
      acc.platform += adj.platform_revenue_adjustment || 0;
      return acc;
    },
    { commission: 0, restaurantNet: 0, courier: 0, platform: 0 }
  );

  const base = recognized.reduce(
    (sum, o) => {
      const f = getOrderFinancials(o);
      sum.food += f.restaurantGross;
      sum.commission += f.commissionAmount;
      sum.delivery += f.deliveryFee;
      sum.courier += f.courierEarning;
      sum.restaurantNet += f.restaurantNet;
      sum.platform += f.platformRevenue;
      return sum;
    },
    { food: 0, commission: 0, delivery: 0, courier: 0, restaurantNet: 0, platform: 0 }
  );

  return {
    recognizedOrders: recognized.length,
    totalFoodSales: round2(base.food),
    restaurantCommission: round2(base.commission + adjustmentTotals.commission),
    deliveryFees: round2(base.delivery),
    courierEarnings: round2(base.courier + adjustmentTotals.courier),
    restaurantPayouts: round2(base.restaurantNet + adjustmentTotals.restaurantNet),
    platformRevenue: round2(base.platform + adjustmentTotals.platform),
  };
}
