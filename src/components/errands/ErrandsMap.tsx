import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, MapPin, LocateFixed, Loader2 } from 'lucide-react';

import {
  ACCRA,
  MAP_ID,
  fitPoints,
  isGoogleMapsConfigured,
  loadGoogleMaps,
  panToAnimated,
} from '../../lib/googleMaps';
import { makePinContent, pinAnchor } from '../../lib/mapMarkers';
import { LatLng, RoadRoute, fetchRoadRoute } from '../../lib/routing';
import type { ErrandsNearbyDriver, ErrandsServiceCategory } from '../../lib/errands/types';

/**
 * The Errands page map: pickup and destination pins, the eligible drivers the
 * database returned, and the REAL road route between the two endpoints.
 *
 * Every marker position is real data — the customer's picked points and the
 * GPS the drivers published. When a booking is live the selected driver's pin
 * follows `activeDriverPosition` (their actual courier-row GPS, forwarded by
 * realtime/poll on the page). Nothing is simulated: if no road route resolves,
 * no line is drawn at all — the fare badge already says which measurement
 * priced the trip.
 *
 * On top of that, the two endpoints carry callout pills (driver-to-pickup ETA
 * and estimated arrival) fed by the page, and a circular recenter control that
 * returns the camera to the customer's own position when they have shared it.
 */

export interface ErrandsMapProps {
  pickup: LatLng | null;
  destination: LatLng | null;
  /** Eligible drivers from `errands_nearby_drivers` (never fabricated). */
  drivers: ErrandsNearbyDriver[];
  selectedDriverId: string | null;
  /** Live GPS of the booked driver, while a booking is active. */
  activeDriverPosition: LatLng | null;
  serviceCategory: ErrandsServiceCategory;
  /**
   * Value shown in the green pickup callout (the real road ETA of the nearest
   * eligible driver to the pickup point). `null` renders the label alone —
   * a missing ETA is never replaced with an invented minute count.
   */
  pickupCallout?: string | null;
  /**
   * Value shown in the dark drop-off callout (arrival clock time built from
   * the server's trip duration). `null` renders the label alone.
   */
  destinationCallout?: string | null;
  /** The customer's own GPS fix, when they have granted location access. */
  userLocation?: LatLng | null;
  /** Asked for when the map should recenter but no fix exists yet. */
  onRecenter?: () => void;
  heightClassName?: string;
  /**
   * Reported when the map enters/leaves fullscreen. The page uses it to lift
   * its overlay above the navbar while fullscreen — otherwise the
   * stacking context would paint it underneath the navbar.
   */
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

interface DriverMarkerEntry {
  marker: google.maps.marker.AdvancedMarkerElement;
  selected: boolean;
}

const DRIVER_PIN_SIZE = 30;
const SELECTED_PIN_SIZE = 42;

const isPoint = (value: LatLng | null | undefined): value is LatLng =>
  !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng);

const samePoint = (a: LatLng | null, b: LatLng | null): boolean =>
  (!a && !b) ||
  (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

const driverPoint = (driver: ErrandsNearbyDriver): LatLng | null =>
  isPoint({ lat: driver.latitude ?? Number.NaN, lng: driver.longitude ?? Number.NaN })
    ? { lat: driver.latitude as number, lng: driver.longitude as number }
    : null;

const driverEmoji = (driver: ErrandsNearbyDriver): string =>
  driver.vehicleCategory === 'CAR' ? '🚗' : '🏍️';

const driverBg = (driver: ErrandsNearbyDriver): string =>
  driver.vehicleCategory === 'CAR' ? '#02472d' : '#059669';

const driverTitle = (driver: ErrandsNearbyDriver): string => {
  const name = driver.fullName ?? 'Available driver';
  const vehicle = driver.vehicleType ?? (driver.vehicleCategory === 'CAR' ? 'Car' : 'Motorcycle');
  return `${name} · ${vehicle}`;
};

const makeDriverPin = (driver: ErrandsNearbyDriver, selected: boolean) => {
  const size = selected ? SELECTED_PIN_SIZE : DRIVER_PIN_SIZE;
  const content = makePinContent(driverEmoji(driver), driverBg(driver), size, selected);
  if (!selected) content.style.opacity = '0.65'; // the selected driver stands out
  const anchor = pinAnchor(size);
  return { content, anchorLeft: anchor.anchorLeft, anchorTop: anchor.anchorTop };
};

const ENDPOINT_PIN_SIZE = 24;

/**
 * Circular endpoint markers: a white-faced green target for the pickup and a
 * solid deep-green disc for the drop-off — the reference's location markers,
 * with no emoji and nothing that depends on an image asset.
 */
const makeEndpointPin = (tone: 'pickup' | 'dropoff') => {
  const root = document.createElement('div');
  root.style.cssText = `position:relative;width:${ENDPOINT_PIN_SIZE}px;height:${ENDPOINT_PIN_SIZE}px;`;
  const shadow = 'box-shadow:0 2px 7px rgba(15,23,42,.4);box-sizing:border-box;';
  root.innerHTML =
    tone === 'pickup'
      ? `<span style="display:grid;place-items:center;width:${ENDPOINT_PIN_SIZE}px;height:${ENDPOINT_PIN_SIZE}px;border-radius:50%;background:#ffffff;border:4px solid #059669;${shadow}"><span style="width:8px;height:8px;border-radius:50%;background:#059669;"></span></span>`
      : `<span style="display:grid;place-items:center;width:${ENDPOINT_PIN_SIZE}px;height:${ENDPOINT_PIN_SIZE}px;border-radius:50%;background:#02472d;border:3px solid #ffffff;${shadow}"><span style="width:7px;height:7px;border-radius:50%;background:#ffffff;"></span></span>`;
  const half = ENDPOINT_PIN_SIZE / 2;
  return { content: root, anchorLeft: `-${half}px`, anchorTop: `-${half}px` };
};

/**
 * The pickup / drop-off callout pills. Built with `textContent` — never
 * `innerHTML` with a dynamic value — so whatever the page computed can never
 * be interpreted as markup.
 */
const makeCallout = (label: string, value: string | null, tone: 'pickup' | 'dropoff') => {
  const root = document.createElement('div');
  root.className = 'sg-callout-anchor';
  const pill = document.createElement('span');
  pill.className = `sg-callout sg-callout--${tone}`;
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  pill.appendChild(labelEl);
  if (value) {
    const valueEl = document.createElement('span');
    valueEl.className = 'sg-callout__value';
    valueEl.textContent = value;
    pill.appendChild(valueEl);
  }
  root.appendChild(pill);
  return { content: root, anchorLeft: '0px', anchorTop: '0px' };
};

/** The customer's own position: a small blue dot, only when GPS is shared. */
const makeUserDot = () => {
  const root = document.createElement('div');
  root.style.cssText =
    'width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #ffffff;box-shadow:0 0 0 6px rgba(59,130,246,.22),0 2px 6px rgba(15,23,42,.35);box-sizing:border-box;';
  return { content: root, anchorLeft: '-8px', anchorTop: '-8px' };
};

export const ErrandsMap: React.FC<ErrandsMapProps> = ({
  pickup,
  destination,
  drivers,
  selectedDriverId,
  activeDriverPosition,
  serviceCategory,
  pickupCallout = null,
  destinationCallout = null,
  userLocation = null,
  onRecenter,
  heightClassName = 'h-full',
  onFullscreenChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const destinationMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const pickupCalloutRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const destinationCalloutRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const driverMarkersRef = useRef<Map<string, DriverMarkerEntry>>(new Map());
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const initRef = useRef(false);
  const resizeTimerRef = useRef<number | null>(null);
  const pendingRecenterRef = useRef(false);
  const lastFitRef = useRef<{ pickup: LatLng | null; destination: LatLng | null }>({
    pickup: null,
    destination: null,
  });
  const driversRef = useRef(drivers);
  driversRef.current = drivers;

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [locating, setLocating] = useState(false);

  /** Nudge the map so it re-measures its container after a size/parent change. */
  const triggerResize = useCallback((delayMs = 140) => {
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      const map = mapRef.current;
      if (map) google.maps.event.trigger(map, 'resize');
    }, delayMs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      // The canvas swaps between the inline block and a fixed overlay, so the
      // map must re-measure once the new box has painted.
      triggerResize(next ? 260 : 180);
      return next;
    });
  }, [triggerResize]);

  // While fullscreen, Escape exits and the page behind must not scroll. The
  // scroll position is pinned and the scrollbar width compensated, so locking
  // the body neither jumps the page to the top nor shifts it sideways.
  useEffect(() => {
    onFullscreenChange?.(isFullscreen);
    if (!isFullscreen) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };

    const scrollY = window.scrollY;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      // Re-pin the scroll spot the overlay was opened from.
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' as ScrollBehavior });
      triggerResize(180);
    };
  }, [isFullscreen, triggerResize, onFullscreenChange]);

  // ── Map lifecycle ─────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    // Guards the async loader against React StrictMode's double effect.
    if (!container || mapRef.current || initRef.current) return;
    // Without a key the placeholder renders — never a broken canvas.
    if (!isGoogleMapsConfigured) return;
    initRef.current = true;

    let disposed = false;
    let observer: ResizeObserver | null = null;

    loadGoogleMaps()
      .then(() => {
        if (disposed || mapRef.current || !containerRef.current) return;
        const map = new google.maps.Map(containerRef.current, {
          center: pickup ?? ACCRA,
          zoom: pickup ? 14 : 11,
          mapId: MAP_ID,
          zoomControl: true,
          // Kept clear of the top-right stack (recenter + fullscreen) that the
          // ride-selection layout puts under the floating location bar.
          zoomControlOptions: {
            position: google.maps.ControlPosition.RIGHT_CENTER,
          },
          scrollwheel: false,
          gestureHandling: 'greedy',
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          maxZoom: 19,
        });
        mapRef.current = map;

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
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
      if (pickupMarkerRef.current) pickupMarkerRef.current.map = null;
      pickupMarkerRef.current = null;
      if (destinationMarkerRef.current) destinationMarkerRef.current.map = null;
      destinationMarkerRef.current = null;
      if (pickupCalloutRef.current) pickupCalloutRef.current.map = null;
      pickupCalloutRef.current = null;
      if (destinationCalloutRef.current) destinationCalloutRef.current.map = null;
      destinationCalloutRef.current = null;
      if (userMarkerRef.current) userMarkerRef.current.map = null;
      userMarkerRef.current = null;
      for (const entry of driverMarkersRef.current.values()) entry.marker.map = null;
      driverMarkersRef.current.clear();
      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
      mapRef.current = null;
      initRef.current = false; // StrictMode remounts this effect — start clean
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pickup & destination pins ─────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (pickup) {
      if (!pickupMarkerRef.current) {
        const pin = makeEndpointPin('pickup');
        pickupMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: pickup,
          title: 'Pickup',
          content: pin.content,
          anchorLeft: pin.anchorLeft,
          anchorTop: pin.anchorTop,
          zIndex: 400,
        });
      } else {
        pickupMarkerRef.current.position = pickup;
        pickupMarkerRef.current.map = map;
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.map = null;
    }

    if (destination) {
      if (!destinationMarkerRef.current) {
        const pin = makeEndpointPin('dropoff');
        destinationMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: destination,
          title: 'Destination',
          content: pin.content,
          anchorLeft: pin.anchorLeft,
          anchorTop: pin.anchorTop,
          zIndex: 500,
        });
      } else {
        destinationMarkerRef.current.position = destination;
        destinationMarkerRef.current.map = map;
      }
    } else if (destinationMarkerRef.current) {
      destinationMarkerRef.current.map = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup?.lat, pickup?.lng, destination?.lat, destination?.lng]);

  // ── Callout pills (driver→pickup ETA, estimated arrival) ─────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (pickup) {
      const pin = makeCallout('Pickup', pickupCallout, 'pickup');
      if (!pickupCalloutRef.current) {
        pickupCalloutRef.current = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: pickup,
          title: pickupCallout ? `Pickup in ${pickupCallout}` : 'Pickup',
          content: pin.content,
          anchorLeft: pin.anchorLeft,
          anchorTop: pin.anchorTop,
          zIndex: 820,
        });
      } else {
        pickupCalloutRef.current.position = pickup;
        pickupCalloutRef.current.map = map;
        pickupCalloutRef.current.content = pin.content;
        pickupCalloutRef.current.title = pickupCallout ? `Pickup in ${pickupCallout}` : 'Pickup';
      }
    } else if (pickupCalloutRef.current) {
      pickupCalloutRef.current.map = null;
    }

    if (destination) {
      const pin = makeCallout('Dropoff', destinationCallout, 'dropoff');
      if (!destinationCalloutRef.current) {
        destinationCalloutRef.current = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: destination,
          title: destinationCallout ? `Arriving around ${destinationCallout}` : 'Destination',
          content: pin.content,
          anchorLeft: pin.anchorLeft,
          anchorTop: pin.anchorTop,
          zIndex: 830,
        });
      } else {
        destinationCalloutRef.current.position = destination;
        destinationCalloutRef.current.map = map;
        destinationCalloutRef.current.content = pin.content;
        destinationCalloutRef.current.title = destinationCallout
          ? `Arriving around ${destinationCallout}`
          : 'Destination';
      }
    } else if (destinationCalloutRef.current) {
      destinationCalloutRef.current.map = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapReady,
    pickup?.lat,
    pickup?.lng,
    pickupCallout,
    destination?.lat,
    destination?.lng,
    destinationCallout,
  ]);

  // ── The customer's own position (only ever their real GPS fix) ───────────

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    setLocating(false);

    if (!userLocation) {
      if (userMarkerRef.current) userMarkerRef.current.map = null;
      return;
    }
    if (!userMarkerRef.current) {
      const dot = makeUserDot();
      userMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: userLocation,
        title: 'Your location',
        content: dot.content,
        anchorLeft: dot.anchorLeft,
        anchorTop: dot.anchorTop,
        zIndex: 300,
      });
    } else {
      userMarkerRef.current.position = userLocation;
      userMarkerRef.current.map = map;
    }

    if (pendingRecenterRef.current) {
      pendingRecenterRef.current = false;
      panToAnimated(map, userLocation, 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, userLocation?.lat, userLocation?.lng]);

  /**
   * Recenter: pan to the fix we already have (and ask for a fresher one), or
   * ask for one and pan the moment it arrives. Never invents a position.
   */
  const handleRecenter = useCallback(() => {
    const map = mapRef.current;
    if (userLocation && map) {
      panToAnimated(map, userLocation, 600);
      onRecenter?.();
      return;
    }
    if (!onRecenter) return;
    pendingRecenterRef.current = true;
    setLocating(true);
    onRecenter();
    window.setTimeout(() => setLocating(false), 6000);
  }, [userLocation, onRecenter]);

  // ── Driver pins (keyed by driverId, updated in place) ─────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const seen = new Set<string>();

    for (const driver of drivers) {
      const live =
        isPoint(activeDriverPosition) && driver.driverId === selectedDriverId
          ? (activeDriverPosition as LatLng)
          : null;
      const position = live ?? driverPoint(driver);
      if (!position) continue; // no real position — no marker, ever
      seen.add(driver.driverId);

      const selected = driver.driverId === selectedDriverId;
      const existing = driverMarkersRef.current.get(driver.driverId);

      if (existing) {
        existing.marker.position = position;
        existing.marker.map = map;
        if (existing.selected !== selected) {
          const pin = makeDriverPin(driver, selected);
          existing.marker.content = pin.content;
          existing.marker.anchorLeft = pin.anchorLeft;
          existing.marker.anchorTop = pin.anchorTop;
          existing.marker.zIndex = selected ? 700 : 600;
          existing.selected = selected;
        }
        continue;
      }

      const pin = makeDriverPin(driver, selected);
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position,
        title: driverTitle(driver),
        content: pin.content,
        anchorLeft: pin.anchorLeft,
        anchorTop: pin.anchorTop,
        zIndex: selected ? 700 : 600,
      });
      driverMarkersRef.current.set(driver.driverId, { marker, selected });
    }

    // A driver who left the eligible set loses their pin immediately.
    for (const [driverId, entry] of Array.from(driverMarkersRef.current.entries())) {
      if (!seen.has(driverId)) {
        entry.marker.map = null;
        driverMarkersRef.current.delete(driverId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapReady,
    drivers,
    selectedDriverId,
    activeDriverPosition?.lat,
    activeDriverPosition?.lng,
  ]);

  // ── Road route (real polyline only — never a fake straight line) ──────────

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !pickup || !destination) {
      routeLineRef.current?.setMap(null);
      return;
    }

    let cancelled = false;
    let route: RoadRoute | null = null;
    routeLineRef.current?.setMap(null); // never draw the previous route across new endpoints

    fetchRoadRoute(pickup, destination).then((resolved) => {
      if (cancelled) return;
      route = resolved;
      if (!route || route.coordinates.length < 2) return; // no honest line to draw
      routeLineRef.current = new google.maps.Polyline({
        map,
        path: route.coordinates,
        geodesic: true,
        // Dark route line — matches the reference and stays legible on the
        // muted street basemap.
        strokeColor: '#065f46',
        strokeOpacity: 1,
        strokeWeight: 5,
        zIndex: 100,
      });
    });

    return () => {
      cancelled = true;
      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup?.lat, pickup?.lng, destination?.lat, destination?.lng]);

  // ── Camera: frame the pair when it changes, never fight a manual pan ──────

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!pickup && !destination) return;

    const previous = lastFitRef.current;
    if (samePoint(previous.pickup, pickup) && samePoint(previous.destination, destination)) return;
    lastFitRef.current = {
      pickup: pickup ? { ...pickup } : null,
      destination: destination ? { ...destination } : null,
    };

    const points: google.maps.LatLngLiteral[] = [];
    if (pickup) points.push(pickup);
    if (destination) points.push(destination);
    for (const driver of driversRef.current) {
      const position = driverPoint(driver);
      if (position) points.push(position);
    }
    // The booking pins win the frame; drivers are included when already loaded.
    fitPoints(
      map,
      points.filter(
        (point, index) =>
          points.findIndex(
            (other) => Math.abs(other.lat - point.lat) < 1e-9 && Math.abs(other.lng - point.lng) < 1e-9
          ) === index
      ),
      { maxZoom: 16, padding: 56 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup?.lat, pickup?.lng, destination?.lat, destination?.lng]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isGoogleMapsConfigured) {
    return (
      <div className={`relative overflow-hidden bg-slate-100 ${heightClassName}`}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center">
          <MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />
          <p className="text-xs font-semibold text-slate-600">
            Map unavailable — no Google Maps key configured
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[60] h-dvh w-full bg-slate-100'
          : `relative overflow-hidden bg-slate-100 ${heightClassName}`
      }
    >
      <div ref={containerRef} className="absolute inset-0" />

      {mapReady && !mapError && (
        <>
          {/* Recenter — top-right, under the floating location bar. Returns the
              camera to the customer's own fix; asks for one when none exists. */}
          <button
            type="button"
            onClick={handleRecenter}
            aria-label="Recenter map on my location"
            className="absolute right-3 top-[4.75rem] z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-brand-dark shadow-card backdrop-blur transition hover:bg-white active:scale-95"
          >
            {locating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {/* Real fullscreen toggle: the box becomes a fixed overlay and the map
              is re-measured, so every marker/polyline keeps its place. */}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen map' : 'View map fullscreen'}
            aria-pressed={isFullscreen}
            className="absolute right-3 top-[7.5rem] z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-card backdrop-blur transition hover:bg-white active:scale-95"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </>
      )}

      {mapError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-slate-100 px-6 text-center">
          <MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />
          <p className="text-xs font-semibold text-slate-600">Map unavailable</p>
          <p className="text-[11px] leading-relaxed text-slate-400">
            The map could not load. Your picked addresses still price the trip exactly the same.
          </p>
        </div>
      )}
    </div>
  );
};

export default ErrandsMap;
