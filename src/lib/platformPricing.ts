import { supabase, isSupabaseConfigured } from './supabase';
import { DEFAULT_PRICING } from './pricing';
import { PlatformPricingSettings } from '../types/database';

/**
 * The platform's own delivery pricing rules (table `platform_settings`,
 * key `delivery_pricing`), read once per session and reused by every screen
 * that has to show a "delivery from" figure.
 *
 * The value shown to customers is always the stored production setting and
 * falls back to the platform default only when the row cannot be read —
 * nothing here is invented per restaurant, because fees are priced by
 * distance at checkout (see src/lib/deliveryQuote.ts).
 */
let cached: Promise<PlatformPricingSettings> | null = null;

export function getPlatformPricing(): Promise<PlatformPricingSettings> {
  if (!cached) {
    cached = (async () => {
      if (!isSupabaseConfigured) return DEFAULT_PRICING;
      try {
        const { data, error } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'delivery_pricing')
          .maybeSingle();

        if (error || !data?.value) return DEFAULT_PRICING;
        return { ...DEFAULT_PRICING, ...(data.value as Partial<PlatformPricingSettings>) };
      } catch {
        return DEFAULT_PRICING;
      }
    })();
  }
  return cached;
}
