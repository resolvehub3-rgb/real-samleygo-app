import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Retrieve credentials from environment or browser configuration storage
export function getSupabaseCredentials() {
  // Vite injects `import.meta.env` at build time. In non-Vite runtimes
  // (node test runners, plain tsx) it does not exist, so fall back to an
  // empty object instead of throwing — the same "not configured" result.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const envUrl = env?.VITE_SUPABASE_URL;
  const envKey = env?.VITE_SUPABASE_ANON_KEY;

  if (envUrl && envKey && envUrl.trim() !== '' && envKey.trim() !== '') {
    return { url: envUrl.trim(), key: envKey.trim(), fromEnv: true };
  }

  const storedUrl = typeof window !== 'undefined' ? localStorage.getItem('samleygo_supabase_url') : null;
  const storedKey = typeof window !== 'undefined' ? localStorage.getItem('samleygo_supabase_key') : null;

  if (storedUrl && storedKey) {
    return { url: storedUrl.trim(), key: storedKey.trim(), fromEnv: false };
  }

  return { url: '', key: '', fromEnv: false };
}

export function saveSupabaseCredentials(url: string, key: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('samleygo_supabase_url', url.trim());
    localStorage.setItem('samleygo_supabase_key', key.trim());
    window.location.reload();
  }
}

export function clearSupabaseCredentials() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('samleygo_supabase_url');
    localStorage.removeItem('samleygo_supabase_key');
    window.location.reload();
  }
}

const { url, key } = getSupabaseCredentials();

// Valid dummy placeholder for instantiation when not yet configured to prevent runtime crash
const fallbackUrl = 'https://placeholder-project.supabase.co';
const fallbackKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

export const isSupabaseConfigured = Boolean(url && key);

export const supabase: SupabaseClient = createClient(
  url || fallbackUrl,
  key || fallbackKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

/**
 * PostgREST wraps a raised exception as `Failed to call RPC 'name': {...json...}`.
 * Surfaces should show the database's own message (e.g. the delivery-location
 * copy) instead of that wrapper and its JSON envelope.
 */
export function cleanRpcErrorMessage(
  message: string | null | undefined,
  fallback: string
): string {
  const text = message ?? '';
  const fromEnvelope = /"message"\s*:\s*"([^"]*)"/.exec(text);
  if (fromEnvelope?.[1]) return fromEnvelope[1];
  const stripped = text.replace(/^Failed to call RPC '.*': /, '').trim();
  return stripped || fallback;
}
