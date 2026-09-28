/**
 * Robust wrappers around the browser Geolocation API.
 *
 * Handles the three classic "location doesn't work" failures:
 *  1. Insecure origin — geolocation is blocked on http:// (except localhost).
 *     Very common when testing a dev build on a phone via a LAN IP, or inside
 *     some Android WebViews. Detected up-front with an actionable message.
 *  2. Permission denied / unavailable — mapped to clear, friendly text.
 *  3. High-accuracy timeout — automatically retries with balanced accuracy
 *     before giving up (GPS cold-starts can exceed short timeouts indoors).
 */

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

export class GeoError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
  }
}

/** Human-readable message for any geolocation failure. */
export function describeGeoError(err: unknown): string {
  if (err instanceof GeoError) return err.message;

  if (typeof navigator !== 'undefined' && !('geolocation' in navigator)) {
    return 'This device does not support GPS location.';
  }

  const code = (err as { code?: number })?.code;
  switch (code) {
    case 1:
      return 'Location permission was denied. Allow location access for this site/app in your browser or device settings, then try again.';
    case 2:
      return 'Your position could not be determined. Move to an open area or toggle device location services on.';
    case 3:
      return 'Getting your location timed out. Try again, preferably outdoors or near a window.';
    default:
      return 'Location could not be determined on this device.';
  }
}

/** True when the page origin allows geolocation at all. */
export function isGeolocationAvailable(): boolean {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) return false;
  // Insecure origins (LAN IP over http) silently break geolocation in Chrome/WebView
  return window.isSecureContext;
}

interface GetOptions {
  /** Try GPS first; automatically falls back to a lower-accuracy attempt. */
  highAccuracyFirst?: boolean;
  timeoutMs?: number;
}

/** Promise-based one-shot position with secure-context check + accuracy fallback. */
export function getCurrentPositionSafe(opts?: GetOptions): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new GeoError('Geolocation is only available in the app/browser.'));
      return;
    }
    if (!('geolocation' in navigator)) {
      reject(new GeoError('This device does not support GPS location.'));
      return;
    }
    if (!window.isSecureContext) {
      reject(
        new GeoError(
          'Location is blocked because this page is not served over a secure connection. ' +
            'Open the app via https:// (or localhost) and try again.'
        )
      );
      return;
    }

    const attempts = opts?.highAccuracyFirst === false
      ? [{ enableHighAccuracy: false, timeout: opts?.timeoutMs ?? 12000, maximumAge: 15000 }]
      : [
          { enableHighAccuracy: true, timeout: opts?.timeoutMs ?? 12000, maximumAge: 5000 },
          // Fallback: network/Wi-Fi position — less precise but almost always succeeds
          { enableHighAccuracy: false, timeout: opts?.timeoutMs ?? 12000, maximumAge: 30000 },
        ];

    const tryAttempt = (index: number) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        (err) => {
          // Permission/availability errors are final — no point retrying with
          // different accuracy. Only timeouts fall through to the next attempt.
          if (err.code === 1 || err.code === 2 || index >= attempts.length - 1) {
            reject(new GeoError(describeGeoError(err), err.code));
          } else {
            tryAttempt(index + 1);
          }
        },
        attempts[index]
      );
    };

    tryAttempt(0);
  });
}

/**
 * Long-lived position watcher for courier tracking. Mirrors getCurrentPositionSafe's
 * robustness (secure-context check, accuracy fallback) with watchPosition.
 *
 * @returns a cleanup function that stops the watch, or null when tracking
 *          could not be started (the error is passed to onError first).
 */
export function watchPositionSafe(
  onSuccess: (point: GeoPoint) => void,
  onError: (err: GeoError) => void
): (() => void) | null {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    onError(new GeoError('This device does not support GPS location.'));
    return null;
  }
  if (!window.isSecureContext) {
    onError(
      new GeoError(
        'GPS tracking is blocked because this page is not served over a secure connection. ' +
          'Open the app via https:// (or localhost) to enable live tracking.'
      )
    );
    return null;
  }

  let started = false;
  let watchId: number | null = null;

  // Primary high-accuracy watch
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      started = true;
      onSuccess({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    },
    (err) => {
      if (err.code === 1 || err.code === 2) {
        onError(new GeoError(describeGeoError(err), err.code));
        return;
      }
      // Timeout-style failure before any fix: switch to a balanced-accuracy watch
      if (!started && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (!started) {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            started = true;
            onSuccess({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
          },
          (err2) => onError(new GeoError(describeGeoError(err2), err2.code)),
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 20000 }
        );
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );

  return () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };
}
