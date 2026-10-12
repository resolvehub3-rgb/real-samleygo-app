/**
 * Errands configuration + pricing settings readers.
 *
 * Both live in `platform_settings` behind SECURITY DEFINER RPCs (customers
 * have no read access to that table). Everything here never throws: a failure
 * resolves to `null`, and every screen treats `null` as "not available" — it
 * never guesses a default price or pretends a service is on.
 */

import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../supabase';
import type { ErrandsConfig, ErrandsPricingSettings, ErrandsServiceCategory } from './types';

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
