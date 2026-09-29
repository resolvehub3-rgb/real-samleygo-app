import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GeoError,
  GeoPoint,
  describeGeoError,
  getCurrentPositionSafe,
  watchPositionSafe,
} from '../lib/geolocation';
import { resolvePlaceLabel } from '../lib/reverseGeocode';

/**
 * Live, human-readable device location.
 *
 * Keeps a `watchPosition` fix running in the background and continuously
 * resolves it to a place name ("East Legon, Accra") — never to raw
 * "GPS: 5.5299, -0.2255" text. The label is refreshed only when the device
 * has actually moved (~110 m) and at most every 20 s, so a live watch costs
 * no more reverse-geocode requests than a handful per minute.
 *
 * Every failure is surfaced as friendly copy through `error`; nothing throws
 * and nothing renders as coordinates.
 */

const MIN_LABEL_GAP_MS = 20_000;
/** ~110 m — the coarse grid on which place-name lookups are de-duplicated. */
const coordKey = (point: GeoPoint): string => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;

export interface LiveLocationLabel {
  /** e.g. "East Legon, Accra" — null until the first fix resolves */
  label: string | null;
  /** Latest raw fix (kept for distance maths / saving on an order) */
  point: GeoPoint | null;
  accuracyMeters: number | null;
  isLocating: boolean;
  isWatching: boolean;
  /** Friendly error text, or null */
  error: string | null;
  /** Idempotent: starts a fix + the live watch */
  start: () => Promise<void>;
  stop: () => void;
}

export function useLiveLocationLabel(): LiveLocationLabel {
  const [label, setLabel] = useState<string | null>(null);
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchStopRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const lastLabelKeyRef = useRef('');
  const lastLabelAtRef = useRef(0);
  const labelRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      watchStopRef.current?.();
      watchStopRef.current = null;
    };
  }, []);

  const applyPoint = useCallback(async (next: GeoPoint) => {
    if (!mountedRef.current) return;

    setPoint(next);
    if (typeof next.accuracy === 'number') setAccuracyMeters(next.accuracy);

    const key = coordKey(next);
    const now = Date.now();
    // Skip while the device sits still (same key) or while a lookup is fresh.
    if (key === lastLabelKeyRef.current && labelRef.current) return;
    if (labelRef.current && now - lastLabelAtRef.current < MIN_LABEL_GAP_MS) return;

    lastLabelKeyRef.current = key;
    lastLabelAtRef.current = now;

    const place = await resolvePlaceLabel(next.lat, next.lng);
    if (!mountedRef.current || !place?.label) return;

    labelRef.current = place.label;
    setLabel(place.label);
  }, []);

  const stop = useCallback(() => {
    watchStopRef.current?.();
    watchStopRef.current = null;
    startedRef.current = false;
    if (mountedRef.current) {
      setIsWatching(false);
      setIsLocating(false);
    }
  }, []);

  const start = useCallback(async () => {
    // React StrictMode + rapid re-clicks must never stack duplicate watchers.
    if (startedRef.current) return;
    startedRef.current = true;
    setIsLocating(true);
    setError(null);

    try {
      const first = await getCurrentPositionSafe({ highAccuracyFirst: true, timeoutMs: 12000 });
      await applyPoint(first);
    } catch (err) {
      startedRef.current = false;
      if (mountedRef.current) {
        setIsLocating(false);
        setError(err instanceof GeoError ? err.message : describeGeoError(err));
      }
      return;
    }

    if (!mountedRef.current) return;
    setIsLocating(false);

    const stopWatch = watchPositionSafe(
      (next) => {
        void applyPoint(next);
        if (mountedRef.current) setIsWatching(true);
      },
      (err) => {
        // A mid-session timeout is not fatal: the last good fix stays on
        // screen. Only permission loss actually stops tracking.
        if (err.code === 1 || err.code === 2) {
          if (mountedRef.current) {
            setError(err.message);
            setIsWatching(false);
          }
          startedRef.current = false;
        }
      }
    );

    if (stopWatch) {
      watchStopRef.current = stopWatch;
      if (mountedRef.current) setIsWatching(true);
    } else {
      startedRef.current = false;
    }
  }, [applyPoint]);

  // Never leak a watch when the screen unmounts.
  useEffect(() => stop, [stop]);

  return {
    label,
    point,
    accuracyMeters,
    isLocating,
    isWatching,
    error,
    start,
    stop,
  };
}
