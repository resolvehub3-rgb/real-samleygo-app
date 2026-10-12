/**
 * Driver-side Errands availability + service capabilities.
 *
 * Opting IN to Errands discovery is the driver's decision (through
 * `set_errands_availability`); the per-service categories (motorcycle
 * errands, car errands, passenger rides) are granted by a super admin — a
 * driver can never grant themselves a regulated service.
 */

import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../supabase';
import type { ErrandsDriverCapability } from './types';

export type ErrandsAvailabilityResult =
  | { ok: true; capability: ErrandsDriverCapability }
  | { ok: false; error: string };

interface CapabilityRow {
  courier_id?: string;
  errands_enabled?: boolean;
  motorcycle_errands?: boolean;
  car_errands?: boolean;
  car_rides?: boolean;
}

const parseCapability = (raw: unknown): ErrandsDriverCapability | null => {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as CapabilityRow;
  return {
    courierId: String(row.courier_id ?? ''),
    errandsEnabled: row.errands_enabled === true,
    motorcycleErrands: row.motorcycle_errands === true,
    carErrands: row.car_errands === true,
    carRides: row.car_rides === true,
  };
};

/** Turn Errands discovery on/off for this driver. Never throws. */
export async function setErrandsAvailability(
  enabled: boolean
): Promise<ErrandsAvailabilityResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Connect Supabase to change your Errands availability.' };
  }

  const { data, error } = await supabase.rpc('set_errands_availability', {
    p_enabled: enabled,
  });

  if (error) {
    const message = cleanRpcErrorMessage(
      error.message,
      'Could not update your Errands availability.'
    );
    if (/does not exist|schema cache/i.test(message)) {
      return {
        ok: false,
        error: 'Errands is not switched on for this project yet — please try again shortly.',
      };
    }
    return { ok: false, error: message };
  }

  const capability = parseCapability(data);
  if (!capability) {
    return { ok: false, error: 'Your availability could not be confirmed. Please try again.' };
  }
  return { ok: true, capability };
}

/** Read this driver's own service capabilities (RLS scopes it server-side). */
export async function fetchMyErrandsCapability(): Promise<ErrandsDriverCapability | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('driver_service_capabilities')
    .select('courier_id, errands_enabled, motorcycle_errands, car_errands, car_rides')
    .maybeSingle();
  if (error || !data) return null;
  return parseCapability(data);
}
