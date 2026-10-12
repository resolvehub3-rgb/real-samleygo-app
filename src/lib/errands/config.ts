/**
 * Errands configuration + pricing readers.
 *
 * The service switches and the legacy TTL settings live in
 * `platform_settings` behind SECURITY DEFINER RPCs (customers have no read
 * access to that table); the fare rules themselves live in the versioned
 * `errands_pricing_rules` table and are read through
 * `get_errands_pricing_rules()` (super admin only). Everything here never
 * throws: a failure resolves to `null`, and every screen treats `null` as
 * "not available" — it never guesses a default price or pretends a service
 * is on.
 */

import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../supabase';
import type {
  ErrandsConfig,
  ErrandsPricingRule,
  ErrandsPricingSettings,
  ErrandsServiceCategory,
} from './types';

const asNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

/** Parse the JSON returned by `get_errands_pricing_settings()`. */
export function parsePricingSettings(raw: unknown): ErrandsPricingSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    configured: asBoolean(row.configured, false),
    currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GHS',
    pricingVersion: Math.round(asNumber(row.pricing_version, 1)),
    perKmRate: asNumber(row.per_km_rate, 0),
    taxRatePercent: asNumber(row.tax_rate_percent, 0),
    surgeMultiplier: asNumber(row.surge_multiplier, 1),
    driverEarningPercentage: asNumber(row.driver_earning_percentage, 100),
    quoteTtlMinutes: Math.round(asNumber(row.quote_ttl_minutes, 5)),
    requestTtlSeconds: Math.round(asNumber(row.request_ttl_seconds, 90)),
  };
}

/** Parse the JSON returned by `get_errands_config()`. */
export function parseConfig(raw: unknown): ErrandsConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const services = (row.services ?? {}) as Record<string, unknown>;
  return {
    enabled: asBoolean(row.enabled, false),
    services: {
      ERRAND_MOTORCYCLE: asBoolean(services.ERRAND_MOTORCYCLE, false),
      CAR_ERRAND: asBoolean(services.CAR_ERRAND, false),
      RIDE_CAR: asBoolean(services.RIDE_CAR, false),
    },
    currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GHS',
  };
}

/** Fetch the operator's service switches. `null` = unavailable (never guessed). */
export async function fetchErrandsConfig(): Promise<ErrandsConfig | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_errands_config');
  if (error) return null;
  return parseConfig(data);
}

/** Fetch the pricing rules. `null` = unavailable (never guessed). */
export async function fetchErrandsPricingSettings(): Promise<ErrandsPricingSettings | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_errands_pricing_settings');
  if (error) return null;
  return parsePricingSettings(data);
}

const isCategory = (value: string): value is ErrandsServiceCategory =>
  value === 'ERRAND_MOTORCYCLE' || value === 'CAR_ERRAND' || value === 'RIDE_CAR';

/** Parse one `errands_pricing_rules` row returned to the super admin. */
export function parsePricingRule(raw: unknown): ErrandsPricingRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const category = String(row.service_category ?? '');
  if (!isCategory(category)) return null;

  const maxFare =
    row.max_fare === null || row.max_fare === undefined || row.max_fare === ''
      ? null
      : asNumber(row.max_fare, 0);

  return {
    id: String(row.id ?? ''),
    serviceCategory: category,
    vehicleCategory: String(row.vehicle_category ?? '') === 'MOTORCYCLE' ? 'MOTORCYCLE' : 'CAR',
    baseFare: asNumber(row.base_fare, 0),
    pricePerKm: asNumber(row.price_per_km, 0),
    minFare: asNumber(row.min_fare, 0),
    maxFare,
    bookingFee: asNumber(row.booking_fee, 0),
    waitingCharge: asNumber(row.waiting_charge, 0),
    waitingChargeEnabled: row.waiting_charge_enabled === true,
    timeChargePerMinute: asNumber(row.time_charge_per_minute, 0),
    timeChargeEnabled: row.time_charge_enabled === true,
    surgeEnabled: row.surge_enabled === true,
    surgeMultiplier: asNumber(row.surge_multiplier, 1),
    taxRatePercent: asNumber(row.tax_rate_percent, 0),
    discountAmount: asNumber(row.discount_amount, 0),
    driverEarningPercent: asNumber(row.driver_earning_percent, 100),
    platformCommissionPercent: asNumber(row.platform_commission_percent, 0),
    currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GHS',
    pricingVersion: Math.round(asNumber(row.pricing_version, 1)),
    effectiveFrom: String(row.effective_from ?? ''),
    isActive: row.is_active === true,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/** The editable part of a rule — what the admin form submits. */
export interface ErrandsPricingRuleInput {
  serviceCategory: ErrandsServiceCategory;
  vehicleCategory: 'MOTORCYCLE' | 'CAR';
  baseFare: number;
  pricePerKm: number;
  minFare: number;
  maxFare: number | null;
  bookingFee: number;
  waitingCharge: number;
  waitingChargeEnabled: boolean;
  timeChargePerMinute: number;
  timeChargeEnabled: boolean;
  surgeEnabled: boolean;
  surgeMultiplier: number;
  taxRatePercent: number;
  discountAmount: number;
  driverEarningPercent: number;
  platformCommissionPercent: number;
}

export type ErrandsPricingSaveResult =
  | { ok: true; rule: ErrandsPricingRule }
  | { ok: false; error: string };

/**
 * Save one category's fare rules as a NEW version (super admin only — the
 * database enforces that, the ranges and the 100% earnings split too).
 * Never throws.
 */
export async function saveErrandsPricingRule(
  input: ErrandsPricingRuleInput
): Promise<ErrandsPricingSaveResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Connect Supabase to save Errands pricing.' };
  }

  const { data, error } = await supabase.rpc('set_errands_pricing_rules', {
    p_service_category: input.serviceCategory,
    p_vehicle_category: input.vehicleCategory,
    p_base_fare: input.baseFare,
    p_price_per_km: input.pricePerKm,
    p_min_fare: input.minFare,
    p_max_fare: input.maxFare ?? 0,
    p_booking_fee: input.bookingFee,
    p_waiting_charge: input.waitingCharge,
    p_waiting_charge_enabled: input.waitingChargeEnabled,
    p_time_charge_per_minute: input.timeChargePerMinute,
    p_time_charge_enabled: input.timeChargeEnabled,
    p_surge_enabled: input.surgeEnabled,
    p_surge_multiplier: input.surgeMultiplier,
    p_tax_rate_percent: input.taxRatePercent,
    p_discount_amount: input.discountAmount,
    p_driver_earning_percent: input.driverEarningPercent,
    p_platform_commission_percent: input.platformCommissionPercent,
    p_currency: 'GHS',
    p_is_active: true,
  });

  if (error) {
    const message = cleanRpcErrorMessage(error.message, 'Could not save the fare rules.');
    if (/only a super admin/i.test(message)) {
      return { ok: false, error: 'Only a super admin can change Errands pricing.' };
    }
    return { ok: false, error: message };
  }

  const rule = parsePricingRule(data);
  if (!rule) return { ok: false, error: 'The saved fare rules could not be read back.' };
  return { ok: true, rule };
}

/** Fetch every pricing-rule version (super admin only). `null` = unavailable. */
export async function fetchErrandsPricingRules(): Promise<ErrandsPricingRule[] | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_errands_pricing_rules');
  if (error || !Array.isArray(data)) return null;
  return data
    .map(parsePricingRule)
    .filter((rule): rule is ErrandsPricingRule => rule !== null);
}

/** Is this specific service category switchable/on right now? */
export function isServiceEnabled(
  config: ErrandsConfig | null,
  service: ErrandsServiceCategory
): boolean {
  return Boolean(config?.enabled && config.services[service]);
}

/** Customer-facing copy for a quote that failed because pricing is unset. */
export function isPricingUnavailableMessage(message: string): boolean {
  return /pricing has not been configured/i.test(message);
}

/** Unwraps the PostgREST envelope from an RPC failure. */
export function errandsRpcMessage(
  error: { message?: string | null } | null,
  fallback: string
): string {
  return cleanRpcErrorMessage(error?.message, fallback);
}
