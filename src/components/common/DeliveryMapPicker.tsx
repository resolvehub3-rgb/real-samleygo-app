import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, MapPin, Search } from 'lucide-react';

import { ACCRA, MAP_ID, loadGoogleMaps } from '../../lib/googleMaps';
import { makePinContent, pinAnchor } from '../../lib/mapMarkers';
import { LatLng, geocodeAddress, reverseGeocodeAddress } from '../../lib/routing';

/**
 * The full-screen "pick it on the map" half of the delivery address sheet.
 *
 * Tap anywhere (or drag the pin) and the coordinate is reverse-geocoded into a
 * readable address in realtime — the header always shows what the pin currently
 * means, and nothing else in the app is touched until "Use this location" is
 * pressed. Cancel is a pure back button: it changes no address and no booking.
 *
 * Honesty rules kept here:
 *  · The label is cleared the moment the pin moves, so a name can never
 *    describe a spot it was not resolved for. If the reverse lookup finds
 *    nothing, the pin simply cannot be confirmed yet — no coordinates are
 *    shown, no placeholder name is invented.
 *  · The map failing (no key, blocked download) is a panel with a way back to
 *    the search box, never an exception or a blank rectangle.
 *  · Nothing is priced or routed here: this is a location, not a fare.
 */

export interface DeliveryMapPickerProps {
  /** The customer's current address text — seeds the header and the start pin. */
  address: string;
  /** Where to open the camera when the address cannot be located. */
  fallbackCenter?: LatLng | null;
  /** Confirm: a real point and the readable address resolved for it. */
  onConfirm: (picked: { point: LatLng; address: string }) => void;
  /** Back to the address sheet without changing anything. */
  onCancel: () => void;
}

/** Long enough that a fast pan only costs one lookup. */
const REVERSE_DEBOUNCE_MS = 500;
/** The pin's own size in px — shared with every other teardrop in the app. */
const PIN_SIZE = 32;

/** `LatLng`, `LatLngAltitude` and their literals all arrive here. */
const toLatLng = (value: unknown): LatLng | null => {
  if (!value) return null;
  const raw = value as { lat: number | (() => number); lng: number | (() => number) };
  const lat = typeof raw.lat === 'function' ? raw.lat() : raw.lat;
  const lng = typeof raw.lng === 'function' ? raw.lng() : raw.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

export const DeliveryMapPicker: React.FC<DeliveryMapPickerProps> = ({
  address,
  fallbackCenter = null,
  onConfirm,
  onCancel,
}) => {
  const [pin, setPin] = useState<LatLng | null>(null);
  /** The address of the CURRENT pin — null while it is still being resolved. */
  const [label, setLabel] = useState<string | null>(() => address.trim() || null);
  const [resolving, setResolving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const initRef = useRef(false);
  const reverseSeqRef = useRef(0);
  const reverseTimerRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  /** Set once the customer has tapped or dragged — a late seed must not undo it. */
  const touchedRef = useRef(false);
  /**
   * Read at init time only: the camera must not jump (and the map must not be
   * torn down and rebuilt) because a live GPS fix landed while it is open.
   */
  const centerRef = useRef<LatLng | null>(fallbackCenter);
  centerRef.current = fallbackCenter;

  // ── Pin → readable address (debounced, newest wins) ──────────────────────

  const movePin = useCallback((next: LatLng) => {
    touchedRef.current = true;
    setPin(next);
    setLabel(null); // the old name belonged to the old spot
    setResolving(true);

    const seq = ++reverseSeqRef.current;
    if (reverseTimerRef.current !== null) window.clearTimeout(reverseTimerRef.current);
    reverseTimerRef.current = window.setTimeout(() => {
      reverseTimerRef.current = null;
      void reverseGeocodeAddress(next)
        .catch(() => null) // offline / refused / timed out → honest "no name"
        .then((name) => {
          if (seq !== reverseSeqRef.current) return; // a newer pin already spoke
          setResolving(false);
          setLabel(name && name.trim() ? name.trim() : null);
        });
    }, REVERSE_DEBOUNCE_MS);
  }, []);

  // ── Map ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    // Guards the async loader against React StrictMode's double effect.
    if (!container || mapRef.current || initRef.current) return;
    initRef.current = true;

    let disposed = false;
    let observer: ResizeObserver | null = null;

    loadGoogleMaps()
      .then(() => {
        if (disposed || mapRef.current || !containerRef.current) return;
        const start = centerRef.current;
        const center = start ?? ACCRA;
        const map = new google.maps.Map(containerRef.current, {
          center,
          zoom: start ? 15 : 11,
          mapId: MAP_ID,
          zoomControl: true,
          scrollwheel: false,
          gestureHandling: 'greedy',
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          maxZoom: 19,
        });
        mapRef.current = map;

        // Tap anywhere to move the pin — the address follows in realtime.
        map.addListener('click', (event: google.maps.MapMouseEvent) => {
          const next = toLatLng(event.latLng);
          if (next) movePin(next);
        });

        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => {
            if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = window.setTimeout(() => {
              resizeTimerRef.current = null;
              google.maps.event.trigger(map, 'resize');
            }, 120);
          });
          observer.observe(containerRef.current);
        }

        setMapReady(true);
      })
      .catch(() => {
        // No key, a refused key or a blocked download: show the way back out.
        if (disposed) return;
        initRef.current = false; // a later mount may retry
        setMapError(true);
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (reverseTimerRef.current !== null) window.clearTimeout(reverseTimerRef.current);
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      reverseSeqRef.current++; // any in-flight reply is now stale
      if (markerRef.current) markerRef.current.map = null;
      markerRef.current = null;
      mapRef.current = null;
      initRef.current = false;
    };
    // Mount only — `centerRef` carries the camera's starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movePin]);

  // The draggable pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (pin) {
      if (!markerRef.current) {
        const anchor = pinAnchor(PIN_SIZE);
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: pin,
          title: 'Delivery location — drag to fine-tune',
          content: makePinContent('📍', '#059669', PIN_SIZE),
          anchorLeft: anchor.anchorLeft,
          anchorTop: anchor.anchorTop,
          gmpDraggable: true,
          gmpClickable: true,
          zIndex: 900,
        });
        marker.addEventListener('gmp-dragend', () => {
          const next = toLatLng(marker.position);
          if (next) movePin(next);
        });
        markerRef.current = marker;
      } else {
        markerRef.current.position = pin;
        markerRef.current.map = map;
      }
    } else if (markerRef.current) {
      markerRef.current.map = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pin?.lat, pin?.lng, movePin]);

  // Start the map on the address the customer already has: one geocode so the
  // pin lands where they live instead of on a blank country. A tap always wins.
  useEffect(() => {
    const target = address.trim();
    if (!target) return;
    let cancelled = false;
    void geocodeAddress(target)
      .catch(() => null)
      .then((point) => {
        if (cancelled || !point || touchedRef.current) return;
        setPin((current) => current ?? point);
      });
    return () => {
      cancelled = true;
    };
    // Mount only: this seeds the opening pin, it does not follow the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canConfirm = Boolean(pin && label && label.trim());

  const handleConfirm = () => {
    if (!pin || !label || !label.trim()) return;
    onConfirm({ point: pin, address: label.trim() });
  };

  const statusLine = resolving
    ? 'Finding the address for this pin…'
    : label
    ? label
    : pin
    ? 'No address name found for this spot yet'
    : 'Tap the map to drop the pin';

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a delivery location on the map"
    >
      {/* Header — the live name of whatever the pin currently means */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top,0px))]">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Back to address search"
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-slate-900">Choose on the map</p>
          <p className="truncate text-[11px] leading-snug text-slate-500">{statusLine}</p>
        </div>
        {resolving && (
          <Loader2
            className="h-4 w-4 flex-shrink-0 animate-spin text-brand"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Map */}
      <div className="relative min-h-0 flex-1 bg-slate-100">
        <div ref={containerRef} className="absolute inset-0" />

        {!mapError && !mapReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-100 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
            <p className="text-xs font-semibold text-slate-600">Loading the map…</p>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-100 px-8 text-center">
            <MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />
            <p className="text-xs font-semibold text-slate-600">The map could not load</p>
            <p className="text-[11px] leading-relaxed text-slate-400">
              You can still set your address — go back and search for it, or use your current
              device location.
            </p>
            <button
              type="button"
              onClick={onCancel}
              className="mt-1 flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search instead
            </button>
          </div>
        )}

        {!mapError && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/70 to-transparent px-3 pb-2.5 pt-6">
            <p className="text-[10px] font-semibold text-white/90">
              Tap the map to drop the pin, or drag it to fine-tune the exact spot.
            </p>
          </div>
        )}
      </div>

      {/* Footer — nothing is saved until this is pressed */}
      <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
        {pin && !label && !resolving && (
          <p className="text-[11px] font-medium leading-snug text-slate-500">
            No address name was found for this pin — move it slightly, or go back and search for
            the address.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="h-12 flex-[2] rounded-xl bg-brand px-4 text-[13px] font-bold text-white transition hover:bg-brand-dark active:scale-[0.98] disabled:opacity-50"
          >
            Use this location
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryMapPicker;
