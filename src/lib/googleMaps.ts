/**
 * The one place the Google Maps JavaScript API is loaded for the whole app.
 *
 * Every map (courier live map, admin dispatch map, the customer/restaurant
 * views that wrap them) goes through here, so the API script is injected
 * exactly once no matter how many maps mount, remount or navigate around.
 *
 * Configuration (see `.env.example`):
 *   - `VITE_GOOGLE_MAPS_API_KEY` — a browser key. It is public by design (it
 *     ships in the bundle), so lock it down in Google Cloud with HTTP-referrer
 *     restrictions and enable only the "Maps JavaScript API".
 *   - `VITE_GOOGLE_MAPS_MAP_ID`  — required by Advanced Markers. Falls back to
 *     Google's shared `DEMO_MAP_ID`, which is fine for development.
 *
 * Nothing here throws: a failure rejects the load promise, which each map
 * component turns into an on-screen "Map unavailable" notice instead of a
 * silent blank box.
 */

const MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();

/** A key is only accepted if it looks real (`.env.example` has a dummy value). */
export const isGoogleMapsConfigured =
  MAPS_API_KEY.length > 0 && !/your[_-]?key/i.test(MAPS_API_KEY);

/** Map ID handed to every `google.maps.Map` — Advanced Markers refuse to draw without one. */
export const MAP_ID =
  (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? '').trim() || 'DEMO_MAP_ID';

/** Base coordinates used before any GPS fix or pin has loaded — Accra, Ghana. */
export const ACCRA: google.maps.LatLngLiteral = { lat: 5.6037, lng: -0.187 };

let pending: Promise<void> | null = null;
let ready = false;

const toError = (value: unknown): Error =>
  value instanceof Error
    ? value
    : new Error(typeof value === 'string' ? value : 'Google Maps failed to load');

/** True once the API + its `maps` and `marker` libraries are usable. */
export const isGoogleMapsReady = (): boolean => ready;

/**
 * Loads the Maps JavaScript API (once) and resolves when `google.maps.Map`
 * and `google.maps.marker.AdvancedMarkerElement` are both constructible.
 * Rejects with a human-readable reason on a missing key, a blocked download
 * or a refused key — never with an opaque script error.
 */
export function loadGoogleMaps(): Promise<void> {
  if (ready) return Promise.resolve();
  if (pending) return pending;
  if (!isGoogleMapsConfigured) {
    return Promise.reject(
      new Error('VITE_GOOGLE_MAPS_API_KEY is missing — copy .env.example to .env and add your key.')
    );
  }

  pending = new Promise<void>((resolve, reject) => {
    const settledWindow = window as Window & { gm_authFailure?: () => void };
    let settled = false;

    const fail = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      pending = null; // let the next mount retry (a transient block, say)
      reject(toError(reason));
    };

    const succeed = (): void => {
      if (settled) return;
      settled = true;
      ready = true;
      resolve();
    };

    // Google invokes this global hook when the key is refused: wrong key,
    // billing off, or this origin not on the key's allow-list.
    settledWindow.gm_authFailure = () => {
      if (settled) {
        console.error('[SamleyGo] Google Maps rejected the API key (gm_authFailure).');
        return;
      }
      fail(
        new Error(
          'Google Maps rejected the API key — check that the Maps JavaScript API is enabled, billing is active, and this site is an allowed referrer.'
        )
      );
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      MAPS_API_KEY
    )}&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () =>
      fail(new Error('Could not download the Google Maps script (network or content blocker?).'));

    // With `loading=async` Google injects its main bundle *after* this tag
    // executes, so `importLibrary` is not guaranteed to exist yet when onload
    // fires — wait for it, then pull in the two libraries the maps construct.
    const importWhenReady = (attempt: number): void => {
      if (settled) return;
      const importLibrary =
        typeof google !== 'undefined' ? google.maps?.importLibrary : undefined;
      if (typeof importLibrary === 'function') {
        Promise.all([importLibrary('maps'), importLibrary('marker')]).then(succeed).catch(fail);
        return;
      }
      if (attempt >= 200) {
        // 200 × 50 ms: the API never showed up at all.
        fail(new Error('Google Maps did not initialise.'));
        return;
      }
      window.setTimeout(() => importWhenReady(attempt + 1), 50);
    };

    script.onload = () => importWhenReady(0);
    document.head.appendChild(script);
  });

  return pending;
}

// ── Places (address search) ─────────────────────────────────────────────────

let placesLibrary: Promise<google.maps.PlacesLibrary | null> | null = null;

/**
 * Loads the Places library on demand — only the address search box needs it,
 * so no other map pays for it.
 *
 * Resolves `null` (never rejects) when the key or project cannot use Places:
 * the caller then falls back to the keyless OpenStreetMap search instead of
 * showing an empty suggestion box.
 */
export function loadGooglePlaces(): Promise<google.maps.PlacesLibrary | null> {
  if (!placesLibrary) {
    placesLibrary = (async () => {
      await loadGoogleMaps();
      return (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary;
    })().catch(() => {
      placesLibrary = null; // a transient failure must not poison the session
      return null;
    });
  }
  return placesLibrary;
}

// ── Camera helpers ──────────────────────────────────────────────────────────
// Google's own `panTo` only animates short jumps (anything further snaps), so
// the "camera follows the rider" pan is tweened here to keep the motion as
// smooth as the Leaflet pan it replaced.

const panFrames = new WeakMap<google.maps.Map, number>();

/** Stops an in-flight `panToAnimated` — call when the user takes the camera. */
export function cancelCameraPan(map: google.maps.Map): void {
  const frame = panFrames.get(map);
  if (frame !== undefined) {
    cancelAnimationFrame(frame);
    panFrames.delete(map);
  }
}

/** Eases `map` onto `target` over `durationMs` (ease-out cubic). */
export function panToAnimated(
  map: google.maps.Map,
  target: google.maps.LatLngLiteral,
  durationMs = 700
): void {
  cancelCameraPan(map);

  const from = map.getCenter();
  if (!from || durationMs <= 0) {
    map.setCenter(target);
    return;
  }

  const startLat = from.lat();
  const startLng = from.lng();
  const dLat = target.lat - startLat;
  const dLng = target.lng - startLng;
  if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return;

  const startedAt = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - startedAt) / durationMs);
    const k = 1 - (1 - t) ** 3;
    map.setCenter({ lat: startLat + dLat * k, lng: startLng + dLng * k });
    if (t < 1) panFrames.set(map, requestAnimationFrame(step));
    else panFrames.delete(map);
  };
  panFrames.set(map, requestAnimationFrame(step));
}

/**
 * Frames `points` in the viewport, clamped to `maxZoom` (the dispatch map must
 * never zoom past street level just because two riders happen to stand
 * together). A single point is simply centred.
 */
export function fitPoints(
  map: google.maps.Map,
  points: google.maps.LatLngLiteral[],
  options: { padding?: number; maxZoom?: number } = {}
): void {
  if (points.length === 0) return;

  const bounds = new google.maps.LatLngBounds();
  for (const point of points) bounds.extend(point);

  if (points.length === 1) {
    map.setCenter(points[0]);
    map.setZoom(options.maxZoom ?? 14);
    return;
  }

  map.fitBounds(bounds, options.padding ?? 40);
  const zoom = map.getZoom();
  if (options.maxZoom !== undefined && zoom !== undefined && zoom > options.maxZoom) {
    map.setZoom(options.maxZoom);
  }
}

/**
 * True when `point` has drifted into the outer `ratio` band of the viewport —
 * the rule the live map uses to re-centre on the rider after they drive off
 * frame. Works off the current bounds, so it needs no projection (and returns
 * `false` before the first frame is drawn, i.e. never interrupts the camera).
 */
export function outsideCenterZone(
  map: google.maps.Map,
  point: google.maps.LatLngLiteral,
  ratio = 0.25
): boolean {
  const bounds = map.getBounds();
  if (!bounds) return false;

  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  const width = northEast.lng() - southWest.lng();
  const height = northEast.lat() - southWest.lat();
  if (!(width > 0) || !(height > 0)) return false;

  const fx = (point.lng - southWest.lng()) / width;
  const fy = (northEast.lat() - point.lat) / height;
  return fx < ratio || fx > 1 - ratio || fy < ratio || fy > 1 - ratio;
}
