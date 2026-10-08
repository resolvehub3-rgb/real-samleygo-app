import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';

import {
  ACCRA,
  MAP_ID,
  fitPoints,
  isGoogleMapsConfigured,
  loadGoogleMaps,
  loadGooglePlaces,
} from '../../lib/googleMaps';
import { makePinContent, pinAnchor } from '../../lib/mapMarkers';
import { formatDistanceKm } from '../../lib/pricing';
import {
  LatLng,
  RoadRoute,
  fetchRoadRoute,
  formatRouteDuration,
  geocodeAddress,
  haversineKm,
  reverseGeocodeAddress,
  searchAddresses,
} from '../../lib/routing';

/**
 * Where the customer's drop-off lives: type it, pick it off the map, or drag
 * the pin — and the map redraws the REAL road route to the kitchen every time.
 *
 * The route line is measured by the same router the quote uses, so the line on
 * screen and the fee the database charges are two views of one measurement.
 * Nothing about money is decided here: this component only supplies an address
 * and a pair of coordinates, and the page asks the server what those cost.
 */

/** One row of the search drop-down. */
type PickerSuggestion =
  | { id: string; mainText: string; secondaryText: string; source: 'OSM'; point: LatLng }
  | {
      id: string;
      mainText: string;
      secondaryText: string;
      source: 'GOOGLE';
      place: google.maps.places.Place;
    };

export interface DeliveryLocationPickerProps {
  /** The order's `delivery_address` — owned by the page. */
  address: string;
  /** Chosen drop-off, or `null` while the customer has not fixed one. */
  point: LatLng | null;
  /** Kitchen coordinates — every route (and every fee) starts here. */
  pickup: LatLng | null;
  /** Every keystroke in the box. */
  onAddressChange: (address: string) => void;
  /** The pin moved — coordinates arrive before the reverse-geocoded label. */
  onPointChange: (point: LatLng | null) => void;
  /**
   * A place the picker resolved itself: label and point travel together, so
   * the page never re-geocodes text whose coordinates it already has.
   */
  onResolved: (address: string, point: LatLng | null) => void;
  /** Rendered directly under the input (the page explains its live GPS label). */
  hint?: React.ReactNode;
  required?: boolean;
}

/** Prefer Ghana, but never hide a place Nominatim only knows by its wider name. */
const GHANA_BOUNDS: google.maps.LatLngBoundsLiteral = {
  north: 11.5,
  east: 1.4,
  south: 4.8,
  west: -3.4,
};
const MIN_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 250;
const REVERSE_DEBOUNCE_MS = 550;
/** A nudge smaller than this lets the customer pan instead of yanking the camera. */
const FIT_IGNORE_KM = 0.2;

/** `LatLng`, `LatLngAltitude` and their literals all arrive here. */
const toLatLng = (value: unknown): LatLng | null => {
  if (!value) return null;
  const raw = value as { lat: number | (() => number); lng: number | (() => number) };
  const lat = typeof raw.lat === 'function' ? raw.lat() : raw.lat;
  const lng = typeof raw.lng === 'function' ? raw.lng() : raw.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const samePoint = (a: LatLng | null, b: LatLng | null): boolean =>
  (!a && !b) || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

export const DeliveryLocationPicker: React.FC<DeliveryLocationPickerProps> = ({
  address,
  point,
  pickup,
  onAddressChange,
  onPointChange,
  onResolved,
  hint,
  required = true,
}) => {
  const [suggestions, setSuggestions] = useState<PickerSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [routePhase, setRoutePhase] = useState<'idle' | 'loading' | 'road' | 'straight'>('idle');
  const [resolvingPin, setResolvingPin] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const dropMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const initRef = useRef(false);
  const searchSeqRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const reverseSeqRef = useRef(0);
  const reverseTimerRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const lastFitRef = useRef<{ point: LatLng | null; pickup: LatLng | null }>({
    point: null,
    pickup: null,
  });

  // The map listeners outlive a render, so they read the newest callbacks.
  const handlersRef = useRef({ onAddressChange, onPointChange, onResolved, pickup });
  handlersRef.current = { onAddressChange, onPointChange, onResolved, pickup };

  // ── Pin → readable address ────────────────────────────────────────────────

  const resolvePinAddress = useCallback((next: LatLng) => {
    const seq = ++reverseSeqRef.current;
    if (reverseTimerRef.current !== null) window.clearTimeout(reverseTimerRef.current);
    setResolvingPin(true);
    reverseTimerRef.current = window.setTimeout(() => {
      reverseTimerRef.current = null;
      void (async () => {
        const name = await reverseGeocodeAddress(next);
        if (seq !== reverseSeqRef.current) return; // a newer pin already spoke
        setResolvingPin(false);
        if (name) handlersRef.current.onResolved(name, next);
      })();
    }, REVERSE_DEBOUNCE_MS);
  }, []);

  const dropPin = useCallback(
    (next: LatLng) => {
      handlersRef.current.onPointChange(next);
      resolvePinAddress(next);
    },
    [resolvePinAddress]
  );

  // ── Address search (Google Places, OpenStreetMap as the keyless fallback) ─

  const searchNow = useCallback(async (text: string): Promise<PickerSuggestion[]> => {
    const places = await loadGooglePlaces();
    if (places?.AutocompleteSuggestion) {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new places.AutocompleteSessionToken();
        }
        const { suggestions: rows } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: text,
            sessionToken: sessionTokenRef.current,
            locationBias: GHANA_BOUNDS,
          });

        const mapped: PickerSuggestion[] = [];
        for (const row of rows.slice(0, 6)) {
          const prediction = row.placePrediction;
          if (!prediction) continue;
          const place = prediction.toPlace();
          mapped.push({
            id: place.id || `${text}:${mapped.length}`,
            mainText: prediction.mainText?.toString() ?? text,
            secondaryText: prediction.secondaryText?.toString() ?? '',
            source: 'GOOGLE',
            place,
          });
        }
        if (mapped.length > 0) return mapped;
      } catch {
        // Places is not enabled for this key — the keyless lookup takes over.
      }
    }

    const results = await searchAddresses(text);
    return results.map((row) => ({ ...row, source: 'OSM' as const }));
  }, []);

  const handleChange = (text: string) => {
    onAddressChange(text);
    setHighlight(-1);

    const seq = ++searchSeqRef.current;
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);

    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearching(false);
      setListOpen(false);
      return;
    }

    setListOpen(true);
    setSearching(true);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      void (async () => {
        const rows = await searchNow(trimmed);
        if (seq !== searchSeqRef.current) return; // a newer keystroke won
        setSuggestions(rows);
        setSearching(false);
      })();
    }, SEARCH_DEBOUNCE_MS);
  };

  const selectSuggestion = useCallback(async (row: PickerSuggestion) => {
    searchSeqRef.current++; // an in-flight list must not overwrite this choice
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    setListOpen(false);
    setSuggestions([]);
    setHighlight(-1);

    if (row.source === 'OSM') {
      handlersRef.current.onResolved(
        [row.mainText, row.secondaryText].filter(Boolean).join(', '),
        row.point
      );
      return;
    }

    // One details call per selection, inside the autocomplete session.
    try {
      const { place } = await row.place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const label = place.formattedAddress || place.displayName || row.mainText;
      const geometry = toLatLng(place.location);
      if (geometry) {
        handlersRef.current.onResolved(label, geometry);
        sessionTokenRef.current = null; // the session ends with the details call
        return;
      }
      const resolved = await geocodeAddress(label); // no geometry back: ask the text
      handlersRef.current.onResolved(label, resolved);
    } catch {
      const label = [row.mainText, row.secondaryText].filter(Boolean).join(', ');
      handlersRef.current.onResolved(label, await geocodeAddress(label));
    }
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!listOpen || suggestions.length === 0) return; // Enter submits the form
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void selectSuggestion(suggestions[highlight >= 0 ? highlight : 0]);
    } else if (event.key === 'Escape') {
      setListOpen(false);
    }
  };

  // ── Map ───────────────────────────────────────────────────────────────────

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
        const map = new google.maps.Map(containerRef.current, {
          center: handlersRef.current.pickup ?? ACCRA,
          zoom: handlersRef.current.pickup ? 14 : 11,
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

        // Tap anywhere to move the drop-off — the line redraws immediately.
        map.addListener('click', (event: google.maps.MapMouseEvent) => {
          const next = toLatLng(event.latLng);
          if (!next) return;
          dropPin(next);
        });

        observer = new ResizeObserver(() => {
          if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
          resizeTimerRef.current = window.setTimeout(() => {
            resizeTimerRef.current = null;
            google.maps.event.trigger(map, 'resize');
          }, 120);
        });
        observer.observe(containerRef.current);

        setMapReady(true);
      })
      .catch(() => {
        if (disposed) return;
        initRef.current = false; // let the next mount retry
        setMapError(true);
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
      if (reverseTimerRef.current !== null) window.clearTimeout(reverseTimerRef.current);
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      searchSeqRef.current++;
      reverseSeqRef.current++;
      if (pickupMarkerRef.current) pickupMarkerRef.current.map = null;
      if (dropMarkerRef.current) dropMarkerRef.current.map = null;
      routeLineRef.current?.setMap(null);
      pickupMarkerRef.current = null;
      dropMarkerRef.current = null;
      routeLineRef.current = null;
      mapRef.current = null;
      initRef.current = false; // StrictMode remounts this effect — start clean
    };
  }, [dropPin]);

  // Pickup + draggable drop-off pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (pickup) {
      if (!pickupMarkerRef.current) {
        const anchor = pinAnchor(30);
        pickupMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: pickup,
          title: 'Kitchen — pickup',
          content: makePinContent('🍳', '#f59e0b', 30),
          anchorLeft: anchor.anchorLeft,
          anchorTop: anchor.anchorTop,
          zIndex: 500,
        });
      } else {
        pickupMarkerRef.current.position = pickup;
        pickupMarkerRef.current.map = map;
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.map = null;
    }

    if (point) {
      if (!dropMarkerRef.current) {
        const anchor = pinAnchor(32);
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: point,
          title: 'Your drop-off — drag to fine-tune',
          content: makePinContent('📍', '#059669', 32),
          anchorLeft: anchor.anchorLeft,
          anchorTop: anchor.anchorTop,
          gmpDraggable: true,
          gmpClickable: true,
          zIndex: 900,
        });
        marker.addEventListener('gmp-dragend', () => {
          const next = toLatLng(marker.position);
          if (next) dropPin(next);
        });
        dropMarkerRef.current = marker;
      } else {
        dropMarkerRef.current.position = point;
        dropMarkerRef.current.map = map;
      }
    } else if (dropMarkerRef.current) {
      dropMarkerRef.current.map = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup?.lat, pickup?.lng, point?.lat, point?.lng, dropPin]);

  // Measure the road route — the same measurement the quote is priced from.
  useEffect(() => {
    if (!mapReady || !pickup || !point) {
      setRoadRoute(null);
      setRoutePhase('idle');
      return;
    }

    let cancelled = false;
    setRoadRoute(null); // never draw the previous route across new endpoints
    setRoutePhase('loading');
    fetchRoadRoute(pickup, point).then((route) => {
      if (cancelled) return;
      setRoadRoute(route);
      setRoutePhase(route ? 'road' : 'straight');
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup?.lat, pickup?.lng, point?.lat, point?.lng]);

  // Draw the direction line: solid green on the real roads, dashed grey only
  // when no road route exists — never a straight line dressed up as one.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !pickup || !point) {
      routeLineRef.current?.setMap(null);
      return;
    }

    const isRoad = !!roadRoute && roadRoute.coordinates.length >= 1;
    const path = isRoad && roadRoute ? roadRoute.coordinates : [pickup, point];

    if (!routeLineRef.current) {
      routeLineRef.current = new google.maps.Polyline({ map });
    }
    routeLineRef.current.setMap(map);
    routeLineRef.current.setOptions({
      path,
      geodesic: true,
      zIndex: 100,
      strokeColor: isRoad ? '#059669' : '#94a3b8',
      strokeOpacity: isRoad ? 0.95 : 0,
      strokeWeight: isRoad ? 5 : 0,
      icons: isRoad
        ? undefined
        : [
            {
              icon: { path: 'M 0,-1 L 0,1', strokeOpacity: 0.9, scale: 3 },
              offset: '0',
              repeat: '14px',
            },
          ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, roadRoute, pickup?.lat, pickup?.lng, point?.lat, point?.lng]);

  // Frame both ends when the location genuinely changes — but never while the
  // customer is nudging the pin around their gate.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !point) return;

    const previous = lastFitRef.current;
    if (samePoint(previous.point, point) && samePoint(previous.pickup, pickup)) return;

    const movedKm = previous.point ? haversineKm(previous.point, point) : Number.POSITIVE_INFINITY;
    const pickupChanged = !samePoint(previous.pickup, pickup);
    lastFitRef.current = { point: { ...point }, pickup: pickup ? { ...pickup } : null };

    if (!pickupChanged && movedKm < FIT_IGNORE_KM) return;
    fitPoints(map, pickup ? [pickup, point] : [point], { maxZoom: 16, padding: 56 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup?.lat, pickup?.lng, point?.lat, point?.lng]);

  const chipText =
    routePhase === 'loading'
      ? 'Measuring the road route…'
      : roadRoute && routePhase === 'road'
      ? `${formatDistanceKm(roadRoute.distanceMeters / 1000)} · ${formatRouteDuration(
          roadRoute.durationSeconds
        )} · road route`
      : point && pickup && routePhase === 'straight'
      ? `${formatDistanceKm(haversineKm(pickup, point))} · straight line`
      : point
      ? pickup
        ? 'Route unavailable — the fee falls back to a straight line'
        : "Waiting for the kitchen's location"
      : '';

  const showList = listOpen && suggestions.length > 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            required={required}
            role="combobox"
            aria-expanded={showList}
            aria-controls="delivery-location-suggestions"
            aria-label="Delivery location"
            autoComplete="off"
            placeholder="Search your area, street or landmark — e.g. East Legon, Accra"
            value={address}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setListOpen(true);
            }}
            onBlur={() => setListOpen(false)}
            onKeyDown={handleKeyDown}
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 py-0 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white sm:text-sm"
          />
          {(searching || resolvingPin) && (
            <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
          )}
        </div>

        {showList && (
          <ul
            id="delivery-location-suggestions"
            role="listbox"
            className="absolute z-40 left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg"
          >
            {suggestions.map((row, index) => (
              <li key={row.id}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()} // keep focus in the box
                  onClick={() => void selectSuggestion(row)}
                  onMouseEnter={() => setHighlight(index)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-slate-100 last:border-b-0 transition ${
                    index === highlight ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 truncate">
                      {row.mainText}
                    </span>
                    {row.secondaryText && (
                      <span className="block text-[10px] text-slate-400 truncate">
                        {row.secondaryText}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {listOpen && searching && suggestions.length === 0 && (
          <div className="absolute z-40 left-0 right-0 top-full mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] text-slate-400 shadow-lg">
            Searching places…
          </div>
        )}
      </div>

      {hint}

      <div className="relative h-60 sm:h-72 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
        <div ref={containerRef} className="absolute inset-0" />

        {mapError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-slate-100 text-center px-6">
            <MapPin className="w-5 h-5 text-slate-400" />
            <p className="text-xs font-semibold text-slate-600">Map preview unavailable</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {isGoogleMapsConfigured
                ? 'The map could not load. Search your address above or use your current location — your delivery route is still measured.'
                : 'Add the Google Maps key to .env to see the map. Search your address above or use your current location — your delivery route is still measured.'}
            </p>
          </div>
        )}

        {chipText && (
          <div className="absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-lg bg-white/95 border border-slate-200 px-2.5 py-1.5 shadow-xs">
            <span className="text-[11px] font-bold text-slate-700">{chipText}</span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/70 to-transparent px-3 pt-6 pb-2 pointer-events-none">
          <p className="text-[10px] font-semibold text-white/90">
            {point
              ? 'Drag the 📍 pin or tap the map to fine-tune the exact drop-off.'
              : 'Tap the map or search above to set your drop-off.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default DeliveryLocationPicker;
