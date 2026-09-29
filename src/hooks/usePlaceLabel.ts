import { useEffect, useRef, useState } from 'react';
import { resolvePlaceLabel } from '../lib/reverseGeocode';

/**
 * Resolves a raw GPS point into a displayable place name.
 *
 * Used where a component already owns its own position watcher (the courier
 * dashboard's telemetry bar) and only needs the "5.5299, -0.2255" readout
 * replaced with something human — e.g. "East Legon, Accra".
 *
 * Re-resolves only when the device crosses the ~110 m cache grid and at most
 * every 20 s, so a high-frequency watcher costs almost no network calls.
 */

const MIN_GAP_MS = 20_000;

export function usePlaceLabel(
  point: { lat: number; lng: number } | null | undefined
): string | null {
  const [label, setLabel] = useState<string | null>(null);
  const labelRef = useRef<string | null>(null);
  const lastKeyRef = useRef('');
  const lastAtRef = useRef(0);

  const lat = point && Number.isFinite(point.lat) ? point.lat : null;
  const lng = point && Number.isFinite(point.lng) ? point.lng : null;

  useEffect(() => {
    if (lat === null || lng === null) return;

    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const now = Date.now();
    if (key === lastKeyRef.current && labelRef.current) return;
    if (labelRef.current && now - lastAtRef.current < MIN_GAP_MS) return;

    lastKeyRef.current = key;
    lastAtRef.current = now;

    let cancelled = false;
    resolvePlaceLabel(lat, lng).then((place) => {
      if (cancelled || !place?.label) return;
      labelRef.current = place.label;
      setLabel(place.label);
    });

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return label;
}
