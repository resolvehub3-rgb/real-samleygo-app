// =====================================================================
// SamleyGo — `errand-quote` Edge Function
//
// The one place a customer's fare is produced.
//
//   1. verify the caller's JWT (anon key + their Authorization header);
//   2. validate the payload — coordinates, addresses, service category;
//   3. route pickup -> destination with the PRIVILEGED key:
//        • Google Routes API (`GOOGLE_MAPS_SERVER_API_KEY`) when it is
//          configured — `travelMode: DRIVING`, which is the supported
//          mode for both cars and motorcycles: Google does not offer a
//          dedicated motorcycle mode everywhere, so a motorcycle quote
//          is a driving-route distance and says so in `route_note`;
//        • otherwise the platform's existing OSRM provider (the same one
//          the web app has always used) — no key, real road network.
//   4. hand the measured route to `create_errands_quote()` (service role)
//      which loads the active pricing rules, prices it in integer pesewas
//      and stores the single-use, expiring snapshot;
//   5. return the quote with its breakdown.
//
// Nothing here decides a price, and the browser never supplies a
// distance: if routing fails, the function fails with an honest message
// rather than inventing a route. The Supabase service-role key never
// leaves this runtime — only the routing credential is used outbound,
// and only over HTTPS to the configured providers.
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SERVICE_CATEGORIES = ['ERRAND_MOTORCYCLE', 'CAR_ERRAND', 'RIDE_CAR'];

/** Routing must never hold the customer's request open indefinitely. */
const ROUTE_TIMEOUT_MS = 7_000;

interface RouteResult {
  distanceMetres: number;
  durationSeconds: number | null;
  provider: 'GOOGLE_ROUTES' | 'OSRM';
}

interface QuotePayload {
  pickup: { lat: number; lng: number; address: string };
  destination: { lat: number; lng: number; address: string };
  serviceCategory: string;
}

class HttpProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function fail(error: unknown): Response {
  if (error instanceof HttpProblem) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  // PostgREST/pg error from the quote RPC: surface the honest message it
  // raised ("pricing not configured", "not in the service area", ...).
  const message = (error as { message?: string })?.message;
  if (message) {
    return json({ error: message, code: 'QUOTE_FAILED' }, 422);
  }
  console.error('errand-quote: unexpected failure', error);
  return json(
    { error: 'We could not price that trip just now. Please try again.', code: 'INTERNAL' },
    500,
  );
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new HttpProblem(400, `Invalid ${field}.`, 'INVALID_INPUT');
  }
  return n;
}

/** `"825s"`, `"1.5s"`, `825` and ISO-8601 `PT13M45S` all become seconds. */
function parseSeconds(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw !== 'string') return null;

  const simple = raw.trim().match(/^(-?\d+(?:\.\d+)?)s?$/);
  if (simple) return Math.round(Number(simple[1]));

  const iso = raw.trim().match(
    /^-?P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i,
  );
  if (iso) {
    const [, d, h, m, s] = iso;
    const total =
      Number(d ?? 0) * 86400 +
      Number(h ?? 0) * 3600 +
      Number(m ?? 0) * 60 +
      Number(s ?? 0);
    return Number.isFinite(total) ? Math.round(total) : null;
  }
  return null;
}

async function withTimeout<T>(request: Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  try {
    // The Google/OSRM helpers read the signal themselves when they can;
    // this guard still fires for a DNS/TLS stall.
    return await Promise.race([
      request,
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new Error('routing timeout')),
        ),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function routeWithGoogle(
  key: string,
  payload: QuotePayload,
): Promise<RouteResult> {
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration',
    },
    body: JSON.stringify({
      origin: {
        location: { latLng: { latitude: payload.pickup.lat, longitude: payload.pickup.lng } },
      },
      destination: {
        location: {
          latLng: { latitude: payload.destination.lat, longitude: payload.destination.lng },
        },
      },
      // DRIVING is the supported mode for both of our vehicle classes.
      travelMode: 'DRIVING',
      // Traffic-unaware needs no departure time and prices the base road
      // network, which keeps a quote reproducible for its whole TTL.
      routingPreference: 'TRAFFIC_UNAWARE',
    }),
    signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Routes ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    routes?: Array<{ distanceMeters?: number; duration?: string; staticDuration?: string }>;
  };
  const route = data.routes?.[0];
  const metres = Number(route?.distanceMeters);
  if (!route || !Number.isFinite(metres) || metres <= 0) {
    throw new Error('Google Routes returned no route');
  }

  return {
    distanceMetres: metres,
    durationSeconds: parseSeconds(route.duration ?? route.staticDuration),
    provider: 'GOOGLE_ROUTES',
  };
}

async function routeWithOSRM(payload: QuotePayload): Promise<RouteResult> {
  const base = (Deno.env.get('ROUTING_API_URL') ?? 'https://router.project-osrm.org')
    .replace(/\/+$/, '')
    .replace(/\/route\/v1$/, '');
  const url =
    `${base}/route/v1/driving/` +
    `${payload.pickup.lng},${payload.pickup.lat};` +
    `${payload.destination.lng},${payload.destination.lat}` +
    `?overview=false&alternatives=false&steps=false`;

  const response = await fetch(url, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`OSRM ${response.status}`);

  const data = (await response.json()) as {
    routes?: Array<{ distance?: number; duration?: number }>;
  };
  const route = data.routes?.[0];
  if (!route || !Number.isFinite(Number(route.distance)) || Number(route.distance) <= 0) {
    throw new Error('OSRM returned no route');
  }

  return {
    distanceMetres: Math.round(Number(route.distance)),
    durationSeconds:
      typeof route.duration === 'number' && Number.isFinite(route.duration)
        ? Math.round(route.duration)
        : null,
    provider: 'OSRM',
  };
}

async function route(payload: QuotePayload): Promise<RouteResult> {
  const googleKey = (Deno.env.get('GOOGLE_MAPS_SERVER_API_KEY') ?? '').trim();
  const failures: string[] = [];

  if (googleKey) {
    try {
      return await withTimeout(routeWithGoogle(googleKey, payload));
    } catch (error) {
      failures.push(`google: ${(error as Error).message}`);
    }
  }

  try {
    return await withTimeout(routeWithOSRM(payload));
  } catch (error) {
    failures.push(`osrm: ${(error as Error).message}`);
  }

  console.error('errand-quote: routing failed', failures.join(' | '));
  throw new HttpProblem(
    502,
    'We could not find a road route between those addresses. Please try again in a moment.',
    'ROUTE_UNAVAILABLE',
  );
}

async function readPayload(request: Request): Promise<QuotePayload> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw new HttpProblem(400, 'Invalid request body.', 'INVALID_INPUT');
  }

  const pickup = (body.pickup ?? {}) as Record<string, unknown>;
  const destination = (body.destination ?? {}) as Record<string, unknown>;
  const serviceCategory = typeof body.serviceCategory === 'string' ? body.serviceCategory : '';

  if (!SERVICE_CATEGORIES.includes(serviceCategory)) {
    throw new HttpProblem(400, 'That Errands service is not supported.', 'INVALID_SERVICE');
  }

  const clean = (value: unknown, fallback: string): string =>
    String(value ?? fallback).trim().slice(0, 300);

  return {
    pickup: {
      lat: requireNumber(pickup.lat, 'pickup latitude', -90, 90),
      lng: requireNumber(pickup.lng, 'pickup longitude', -180, 180),
      address: clean(pickup.address, ''),
    },
    destination: {
      lat: requireNumber(destination.lat, 'destination latitude', -90, 90),
      lng: requireNumber(destination.lng, 'destination longitude', -180, 180),
      address: clean(destination.address, ''),
    },
    serviceCategory,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.', code: 'METHOD' }, 405);
  }

  try {
    const payload = await readPayload(request);

    // --- 1. who is asking -------------------------------------------
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      throw new HttpProblem(500, 'Quote service is not configured.', 'NOT_CONFIGURED');
    }

    const auth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    });
    const { data: userData, error: userError } = await auth.auth.getUser();
    if (userError || !userData.user) {
      throw new HttpProblem(401, 'Sign in to see your Errands fare.', 'UNAUTHENTICATED');
    }

    // --- 2. real road route -----------------------------------------
    const measured = await route(payload);

    // --- 3. price it (authoritative, in the database) ----------------
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await admin.rpc('create_errands_quote', {
      p_customer_id: userData.user.id,
      p_pickup_lat: payload.pickup.lat,
      p_pickup_lng: payload.pickup.lng,
      p_pickup_address: payload.pickup.address,
      p_dest_lat: payload.destination.lat,
      p_dest_lng: payload.destination.lng,
      p_dest_address: payload.destination.address,
      p_service_category: payload.serviceCategory,
      p_route_distance_km: Number((measured.distanceMetres / 1000).toFixed(3)),
      p_route_duration_seconds: measured.durationSeconds,
      p_route_provider: measured.provider,
    });

    if (error) {
      // PostgREST puts the raised message in `message`.
      const message = error.message ?? 'We could not price that trip just now.';
      const status = /pricing has not been configured/i.test(message) ? 409 : 422;
      return json({ error: message, code: 'QUOTE_REJECTED' }, status);
    }

    const quote = (data ?? {}) as Record<string, unknown>;

    return json({
      ok: true,
      quote,
      route: {
        provider: measured.provider,
        distanceMetres: measured.distanceMetres,
        durationSeconds: measured.durationSeconds,
        // Honest disclosure: motorcycles are priced on a driving route
        // because no dedicated motorcycle routing mode is available
        // everywhere. The distance is a real road distance, not a
        // guaranteed motorcycle path.
        note:
          payload.serviceCategory === 'ERRAND_MOTORCYCLE'
            ? 'Distance measured on the road network with driving routing — a motorcycle may cover it slightly faster than the time shown.'
            : null,
      },
    });
  } catch (error) {
    return fail(error);
  }
});
