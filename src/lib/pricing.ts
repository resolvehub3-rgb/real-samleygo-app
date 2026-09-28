import { PlatformPricingSettings } from '../types/database';

export const DEFAULT_PRICING: PlatformPricingSettings = {
  base_fee: 12.0,
  per_km_rate: 2.5,
  min_fee: 10.0,
  max_fee: 60.0,
  currency: 'GHS',
  surge_multiplier: 1.0,
  courier_payout_percentage: 80.0,
  platform_commission_percentage: 20.0,
};

/**
 * Calculates the great-circle distance between two GPS coordinates using the Haversine formula
 * Returns distance in kilometers (km)
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return Number(d.toFixed(2));
}

/**
 * Calculates delivery fee based on actual distance and platform pricing rules
 */
export function calculateDeliveryFee(
  distanceKm: number,
  settings: PlatformPricingSettings = DEFAULT_PRICING
): number {
  if (distanceKm <= 0) {
    return settings.base_fee;
  }
  const calculated =
    (settings.base_fee + distanceKm * settings.per_km_rate) *
    settings.surge_multiplier;
  const bounded = Math.max(
    settings.min_fee,
    Math.min(settings.max_fee, calculated)
  );
  return Number(bounded.toFixed(2));
}

/**
 * Formats Ghanaian Cedis cleanly
 */
export function formatGHS(amount: number): string {
  return `GH₵ ${Number(amount || 0).toFixed(2)}`;
}
