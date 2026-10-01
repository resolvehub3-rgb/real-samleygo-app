import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';
import {
  fetchRoadRoute,
  geocodeAddress,
  haversineKm,
  type LatLng,
  type RoadRoute,
} from '../../lib/routing';

// Re-exported as a type only: exporting runtime values alongside components
// would break React Fast Refresh (dev HMR falls back to full reloads).
export type { LatLng };

/** Which leg of the trip the live road route should follow. */
export type RouteLeg = 'TO_PICKUP' | 'TO_CUSTOMER';

/** Road-route summary handed to parents (used for ETA / distance readouts). */
export interface ActiveRouteInfo {
  leg: RouteLeg;
  distanceMeters: number;
  durationSeconds: number;
}

/** A secondary restaurant pin drawn alongside the active trip. */
export interface MapRestaurantPin {
  id: string;
  lat: number;
  lng: number;
  name?: string;
}

interface CourierLiveMapProps {
  /** Courier's live position (updates in realtime) */
  courierPosition: LatLng | null;
  /** Drop-off pin (customer delivery coordinates) */
  destination: LatLng | null;
  /** Pickup pin (restaurant coordinates) */
  pickup?: LatLng | null;
  courierName?: string;
  /** Tailwind classes for the map container, e.g. "h-64 rounded-2xl" */
  className?: string;
  /**
   * Order status. Decides which leg gets the highlighted road route: while the
   * courier drives to the kitchen the route runs courier → restaurant, and from
   * pickup onwards it runs courier → customer.
   */
  status?: string;
  /**
   * Addresses used to geocode a pin when its coordinates are missing (many
   * restaurants and customers never saved a GPS point). Failures are ignored.
   */
  pickupAddress?: string;
  destinationAddress?: string;
  /**
   * Every other restaurant on the platform, drawn as smaller secondary pins so
   * the courier always sees the full kitchen network around them. Filter out
   * the active pickup yourself if you don't want it drawn twice.
   */
  restaurants?: MapRestaurantPin[];
  /** Reports the active leg's road route whenever it changes (or clears). */
  onRouteUpdate?: (route: ActiveRouteInfo | null) => void;
}

// Small inline SVG pin icons so we don't depend on Leaflet's image assets
const makeIcon = (emoji: string, bg: string, size = 34, halo = false) =>
  L.divIcon({
    className: '',
    // The halo is a pulsing "live position" ring behind the courier pin (the
    // round part of the teardrop sits in the middle of the box, so a centred
    // circle lines up with it). It comes first so it paints underneath.
    html: `${halo ? '<div class="sg-courier-halo"></div>' : ''}<div class="sg-pin" style="
      display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      transition:transform .5s cubic-bezier(.22,1,.36,1);
      background:${bg};box-shadow:0 2px 8px rgba(0,0,0,.35);
      border:2px solid white;">
      <span class="sg-pin-emoji" style="transform:rotate(45deg);transition:transform .5s cubic-bezier(.22,1,.36,1);font-size:${Math.round(size * 0.44)}px;line-height:1;">${emoji}</span>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
  });

const courierIcon = makeIcon('🛵', '#059669', 34, true); // emerald-600
const destinationIcon = makeIcon('🏠', '#0f172a'); // slate-900
const pickupIcon = makeIcon('🍳', '#f59e0b'); // amber-500
const restaurantIcon = makeIcon('🏪', '#475569', 26); // slate-600, deliberately smaller

/**
 * The pin's tip points straight down at rotation -45°, i.e. due south (180°).
 * Rotating by `heading - 225` puts the tip on `heading` (degrees clockwise
 * from north) — so the marker aims the way the rider is actually driving,
 * like a navigation arrow. The emoji counter-rotates to stay upright.
 */
const applyHeading = (marker: L.Marker | null, headingDeg: number) => {
  const root = marker?.getElement() as HTMLElement | undefined;
  const pin = root?.querySelector('.sg-pin') as HTMLElement | null;
  if (!pin) return;
  pin.style.transform = `rotate(${headingDeg - 225}deg)`;
  const emoji = pin.querySelector('.sg-pin-emoji') as HTMLElement | null;
  if (emoji) emoji.style.transform = `rotate(${225 - headingDeg}deg)`;
};

/** Initial bearing (degrees clockwise from north) from one point to another. */
const bearingDeg = (from: LatLng, to: LatLng): number => {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};

/**
 * A coordinate is only drawn if it is finite, in range and not "null island"
 * (0,0) — the classic artifact of a column that was never really filled in.
 */
const isUsablePin = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);

/** Statuses where the rider is still driving toward the kitchen. */
const TO_PICKUP_STATUSES = new Set([
  'COURIER_ASSIGNED',
  'COURIER_ACCEPTED',
  'READY_FOR_PICKUP',
  'RESTAURANT_ACCEPTED',
  'PREPARING',
]);

const round5 = (value: number) => Number(value.toFixed(5));

/** Retry a failed geocode after the negative cache entry expires (60 s + slack). */
const GEOCODE_RETRY_MS = 65_000;

/** Jumps larger than this snap instantly instead of animating (fresh fix / courier reassignment). */
const SNAP_THRESHOLD_KM = 1.5;
/**
 * Expected time between two GPS fixes. The courier publishes roughly every
 * 10 s, so the marker rides the gap between fixes over this window instead of
 * gliding for a fixed duration and then freezing — the motion stays constant.
 */
const DEFAULT_TRAVEL_MS = 10_000;
const MIN_TRAVEL_MS = 1_200;
const MAX_TRAVEL_MS = 15_000;
/** Below this much movement the pin keeps its current heading (GPS jitter). */
const HEADING_MIN_KM = 0.02;
/** Two fixes closer than this are the same fix re-sent by a re-render. */
const SAME_FIX_EPS = 1e-7;
/**
 * The camera follows the rider until he drifts into the outer quarter of the
 * frame (then it re-centres over the next ping). Keeping a comfortable margin
 * means the trip pins stay on screen as long as possible — the same rule a
 * blue-dot navigator uses.
 */
const OUTSIDE_FOLLOW_ZONE = 0.25;

const outsideFollowZone = (map: L.Map, point: L.LatLng): boolean => {
  const size = map.getSize();
  const pt = map.latLngToContainerPoint(point);
  const marginX = size.x * OUTSIDE_FOLLOW_ZONE;
  const marginY = size.y * OUTSIDE_FOLLOW_ZONE;
  return (
    pt.x < marginX ||
    pt.x > size.x - marginX ||
    pt.y < marginY ||
    pt.y > size.y - marginY
  );
};
/** Re-route when the rider has drifted this far from the road route's origin. */
const REROUTE_DISTANCE_KM = 0.08;
/** …or when this much time passed since the last attempt (with exponential backoff on failure). */
const REROUTE_MIN_INTERVAL_MS = 20_000;
const REROUTE_MAX_BACKOFF_MS = 120_000;

/**
 * Live delivery map showing the courier's real-time position together with the
 * restaurant pickup pin and the customer drop-off pin.
 *
 * - the courier marker rides along at a constant speed derived from the GPS
 *   cadence (requestAnimationFrame), so it keeps moving between pings, points
 *   the way the rider is heading, and the camera follows until the user pans
 *   away (a "Follow" button brings the tracking back)
 * - the active leg is drawn as a road-snapped route (OSRM) that re-routes as
 *   the courier moves, falling back to a straight line whenever routing fails
 * - pins missing coordinates are geocoded from their address
 * - every network call is cached, throttled, self-healing and never throws
 *   (stale replies are dropped locally instead of cancelling requests, so a
 *   cancelled fetch can never poison the cache with a false "no result")
 */
export const CourierLiveMap: React.FC<CourierLiveMapProps> = ({
  courierPosition,
  destination,
  pickup,
  courierName,
  className = 'h-64',
  status,
  pickupAddress,
  destinationAddress,
  restaurants,
  onRouteUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const courierMarkerRef = useRef<L.Marker | null>(null);
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const corridorPolylineRef = useRef<L.Polyline | null>(null);
  const roadPolylineRef = useRef<L.Polyline | null>(null);
  /** Secondary restaurant pins, keyed by restaurant id so updates are cheap. */
  const restaurantMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  /** Fit-once guard: pin/courier presence signature the viewport was framed for. */
  const fitSigRef = useRef('');
  /** The marker's current *animated* position (may lag behind the latest ping). */
  const currentLatLngRef = useRef<L.LatLng | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // ── Continuous motion state (the "live navigation" feel) ──────────────
  /** Latest GPS fix — the animation loop always steers toward this. */
  const targetRef = useRef<L.LatLng | null>(null);
  /** Wall-clock time of the previous fix; the gap sets the travel speed. */
  const lastFixAtRef = useRef(0);
  /** Marker speed in km/ms, derived from (gap distance ÷ gap time). */
  const speedRef = useRef(0);
  /** Timestamp of the previous animation frame (for dt). */
  const lastFrameRef = useRef(0);
  /** Degrees clockwise from north the pin tip points (180 = due south). */
  const headingRef = useRef(180);
  /** Throttle for re-drawing the (much heavier) road polyline while riding. */
  const lastRouteDrawRef = useRef(0);
  /** Camera-follow: on until the user drags/zooms, then off until re-centred. */
  const followRef = useRef(true);
  /** Fresh drawing closures for the animation loop (set every render). */
  const drawRefs = useRef<{
    corridor: (position: L.LatLng | null) => void;
    route: (position: L.LatLng | null) => void;
  }>({ corridor: () => {}, route: () => {} });
  /** Handlers the (mount-once) map setup needs from the latest render. */
  const actionRefs = useRef<{ setFollow: (on: boolean) => void }>({
    setFollow: () => {},
  });

  const mountedRef = useRef(true);
  const attemptRef = useRef<{ courier: LatLng; target: LatLng; leg: RouteLeg; at: number } | null>(null);
  const failuresRef = useRef(0);
  const routeInFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const lastNotifiedRef = useRef('none');
  const onRouteUpdateRef = useRef(onRouteUpdate);

  const [resolvedPickup, setResolvedPickup] = useState<LatLng | null>(null);
  const [resolvedDestination, setResolvedDestination] = useState<LatLng | null>(null);
  const [roadRoute, setRoadRoute] = useState<(RoadRoute & { leg: RouteLeg }) | null>(null);
  /** Camera-follow UI: false once the user drags/zooms away from the rider. */
  const [following, setFollowing] = useState(true);

  // Always call the newest callback without re-running effects that depend on it.
  useEffect(() => {
    onRouteUpdateRef.current = onRouteUpdate;
  });

  // Invalidate every in-flight response when the map goes away.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      routeInFlightRef.current = false;
    };
  }, []);

  const pickupPt = pickup ?? resolvedPickup;
  const destinationPt = destination ?? resolvedDestination;

  // Primitive coord dependencies: consumers build `pickup`/`destination` as
  // fresh object literals each render, so depending on identity would re-run
  // this effect (and restart lookups) on every single render.
  const pickupLat = pickup?.lat ?? null;
  const pickupLng = pickup?.lng ?? null;
  const destinationLat = destination?.lat ?? null;
  const destinationLng = destination?.lng ?? null;

  // Content key for the restaurant list. Consumers routinely pass a freshly
  // filtered array (new identity every render), so this effect keys off the
  // contents instead of the reference — otherwise each render would cancel and
  // restart the marker's glide.
  const restaurantKey = restaurants?.length
    ? restaurants.map((r) => `${r.id}|${r.lat}|${r.lng}|${r.name ?? ''}`).join(';')
    : '';

  // ── Geocode pins whose coordinates are missing ────────────────────────
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    /**
     * Look an address up now and — if that fails (offline, rate limit) —
     * once more after the negative cache expires, so the pin self-heals
     * without hammering the geocoder.
     */
    const lookup = (address: string, apply: (point: LatLng) => void) => {
      const schedule = (delay: number) => {
        timers.push(
          window.setTimeout(async () => {
            if (cancelled) return;
            try {
              const point = await geocodeAddress(address);
              if (cancelled || !point) return;
              apply(point);
            } catch {
              // Geocoding is best-effort — a rejection just means no pin.
            }
          }, delay)
        );
      };
      schedule(0);
      schedule(GEOCODE_RETRY_MS);
    };

    if (pickupLat !== null && pickupLng !== null) {
      setResolvedPickup(null);
    } else if (pickupAddress) {
      lookup(pickupAddress, setResolvedPickup);
    } else {
      setResolvedPickup(null);
    }

    if (destinationLat !== null && destinationLng !== null) {
      setResolvedDestination(null);
    } else if (destinationAddress) {
      lookup(destinationAddress, setResolvedDestination);
    } else {
      setResolvedDestination(null);
    }

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pickupLat, pickupLng, destinationLat, destinationLng, pickupAddress, destinationAddress]);

  // ── Which leg the rider is currently driving ──────────────────────────
  const leg: { kind: RouteLeg; target: LatLng } | null = (() => {
    const headingToPickup = status ? TO_PICKUP_STATUSES.has(status) : Boolean(pickupPt);
    if (headingToPickup && pickupPt) return { kind: 'TO_PICKUP', target: pickupPt };
    if (destinationPt) return { kind: 'TO_CUSTOMER', target: destinationPt };
    if (pickupPt) return { kind: 'TO_PICKUP', target: pickupPt };
    return null;
  })();

  const legKind: RouteLeg | null = leg?.kind ?? null;
  const targetKey = leg ? `${round5(leg.target.lat)},${round5(leg.target.lng)}` : '';

  // ── Motion engine: constant-speed ride + camera follow ────────────────
  const stopLoop = () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  const setHeading = (degrees: number) => {
    const normalized = ((Math.round(degrees) % 360) + 360) % 360;
    if (normalized === headingRef.current) return;
    headingRef.current = normalized;
    applyHeading(courierMarkerRef.current, normalized);
  };

  /** While parked, point the pin at the stop the rider is driving to. */
  const aimAtLeg = (marker: L.Marker, from: LatLng, currentLeg: { target: LatLng } | null) => {
    setHeading(currentLeg ? bearingDeg(from, currentLeg.target) : 180);
  };

  /**
   * One frame of the ride: creep toward the latest fix at the speed implied by
   * the previous gap (distance ÷ time), so the marker keeps moving between pings
   * instead of gliding once and freezing until the next one lands.
   */
  const tick = (now: number) => {
    const marker = courierMarkerRef.current;
    const target = targetRef.current;
    if (!mapRef.current || !marker || !target) {
      animFrameRef.current = null;
      return;
    }

    const dt = lastFrameRef.current ? Math.min(80, now - lastFrameRef.current) : 16;
    lastFrameRef.current = now;

    const current = currentLatLngRef.current ?? target;
    const remainingKm = haversineKm(current, target);

    // Arrived, no speed, or the screen went off — park on the latest fix.
    if (document.hidden || speedRef.current <= 0 || speedRef.current * dt >= remainingKm) {
      currentLatLngRef.current = target;
      marker.setLatLng(target);
      drawRefs.current.corridor(target);
      drawRefs.current.route(target);
      animFrameRef.current = null;
      return;
    }

    const k = (speedRef.current * dt) / remainingKm;
    const next = L.latLng(
      current.lat + (target.lat - current.lat) * k,
      current.lng + (target.lng - current.lng) * k
    );

    currentLatLngRef.current = next;
    marker.setLatLng(next);
    drawRefs.current.corridor(next);
    // The road route can carry hundreds of points — repaint it on a slow tick.
    if (now - lastRouteDrawRef.current > 200) {
      lastRouteDrawRef.current = now;
      drawRefs.current.route(next);
    }
    if (remainingKm > HEADING_MIN_KM) setHeading(bearingDeg(current, next));

    animFrameRef.current = requestAnimationFrame(tick);
  };

  const ensureLoop = () => {
    if (animFrameRef.current !== null || document.hidden) return;
    lastFrameRef.current = 0;
    animFrameRef.current = requestAnimationFrame(tick);
  };

  /** Follow the rider until the user drags/zooms; the button brings it back. */
  const setFollow = (on: boolean) => {
    followRef.current = on;
    setFollowing(on);
    if (!on) return;
    const map = mapRef.current;
    const at = currentLatLngRef.current ?? targetRef.current;
    if (map && at) map.panTo(at, { animate: true, duration: 0.7, easeLinearity: 0.25 });
  };

  // The map is created once, so keep its handlers pointed at the newest closure.
  useEffect(() => {
    actionRefs.current.setFollow = setFollow;
  });

  // ── Live road route (throttled, failure-tolerant, never throws) ───────
  useEffect(() => {
    const notify = (info: ActiveRouteInfo | null) => {
      const key = info ? `${info.leg}:${info.distanceMeters}:${info.durationSeconds}` : 'none';
      if (key === lastNotifiedRef.current) return;
      lastNotifiedRef.current = key;
      onRouteUpdateRef.current?.(info);
    };

    if (!courierPosition || !leg) {
      attemptRef.current = null;
      failuresRef.current = 0;
      setRoadRoute(null);
      notify(null);
      return;
    }

    // The trip changed legs (food picked up) — drop the stale route at once.
    if (roadRoute && roadRoute.leg !== leg.kind) setRoadRoute(null);

    const now = Date.now();
    const attempt = attemptRef.current;
    const sameLeg =
      attempt?.leg === leg.kind && haversineKm(attempt.target, leg.target) < 0.01;
    const movedKm = attempt ? haversineKm(courierPosition, attempt.courier) : Number.POSITIVE_INFINITY;
    const backoffMs = Math.min(
      REROUTE_MIN_INTERVAL_MS * 2 ** Math.min(failuresRef.current, 4),
      REROUTE_MAX_BACKOFF_MS
    );

    // Fresh enough — avoid hammering the routing service on every GPS ping.
    if (sameLeg && attempt && movedKm < REROUTE_DISTANCE_KM && now - attempt.at < backoffMs) return;
    // One request at a time; the next ping retries if this one was skipped.
    if (routeInFlightRef.current) return;

    routeInFlightRef.current = true;
    const requestId = ++requestIdRef.current;
    attemptRef.current = { courier: courierPosition, target: leg.target, leg: leg.kind, at: now };

    // A stale road line is more misleading than none: after two failed
    // refreshes drop it and let the straight corridor carry the trip until
    // routing recovers (the next attempt retries with backoff).
    const handleFailure = () => {
      failuresRef.current = Math.min(failuresRef.current + 1, 4);
      if (failuresRef.current >= 2) {
        setRoadRoute(null);
        notify(null);
      }
    };

    fetchRoadRoute(courierPosition, leg.target)
      .then((route) => {
        routeInFlightRef.current = false;
        if (!mountedRef.current || requestId !== requestIdRef.current) return;

        if (!route) {
          handleFailure(); // straight-line corridor stays visible; retry with backoff
          return;
        }

        failuresRef.current = 0;
        setRoadRoute({ ...route, leg: leg.kind });
        notify({
          leg: leg.kind,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
        });
      })
      .catch(() => {
        // Defensive: routing is best-effort, and a rejected request must never
        // leave the "in flight" latch stuck (which would freeze re-routing).
        routeInFlightRef.current = false;
        if (mountedRef.current && requestId === requestIdRef.current) handleFailure();
      });
    // Requests are invalidated by requestIdRef on unmount / leg change, so the
    // in-flight fetch is intentionally allowed to finish and be discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courierPosition, legKind, targetKey]);

  // ── Initialize the map once ───────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [5.6037, -0.187], // Accra, Ghana — sensible default before any fix
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false, // prevent page-scroll hijack on mobile; enable on tap
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());

    // The camera follows the rider by default. The moment the user drags the
    // map or zooms with the wheel/pinch they take control — following pauses
    // and a "Follow" button appears. Programmatic pans/fits (and the zoom
    // buttons, which carry no original event) keep following.
    map.on('dragstart', () => actionRefs.current.setFollow(false));
    map.on('zoomstart', (event: L.LeafletEvent) => {
      // Only a user-driven zoom (wheel / pinch / keyboard) carries an event.
      const original = (event as L.LeafletEvent & { originalEvent?: Event }).originalEvent;
      if (original) actionRefs.current.setFollow(false);
    });

    const invalidateTimer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    mapRef.current = map;

    return () => {
      clearTimeout(invalidateTimer);
      resizeObserver.disconnect();
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      courierMarkerRef.current = null;
      destinationMarkerRef.current = null;
      pickupMarkerRef.current = null;
      corridorPolylineRef.current = null;
      roadPolylineRef.current = null;
      restaurantMarkersRef.current.clear(); // map.remove() already dropped the layers
      currentLatLngRef.current = null;
      fitSigRef.current = '';
      // Motion state belongs to the map that was just torn down (StrictMode
      // remounts reuse these refs): force a fresh target, cadence and heading.
      targetRef.current = null;
      lastFixAtRef.current = 0;
      speedRef.current = 0;
      headingRef.current = -1;
      lastRouteDrawRef.current = 0;
    };
  }, []);

  // ── Pins, route lines & animated courier marker ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Destination pin (created once, then kept in sync with its coordinates)
    if (destinationPt) {
      const position: L.LatLngExpression = [destinationPt.lat, destinationPt.lng];
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.setLatLng(position);
      } else {
        destinationMarkerRef.current = L.marker(position, { icon: destinationIcon })
          .addTo(map)
          .bindPopup('Customer drop-off');
      }
    } else if (destinationMarkerRef.current) {
      map.removeLayer(destinationMarkerRef.current);
      destinationMarkerRef.current = null;
    }

    // Restaurant pickup pin
    if (pickupPt) {
      const position: L.LatLngExpression = [pickupPt.lat, pickupPt.lng];
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.setLatLng(position);
      } else {
        pickupMarkerRef.current = L.marker(position, { icon: pickupIcon })
          .addTo(map)
          .bindPopup('Restaurant pickup');
      }
    } else if (pickupMarkerRef.current) {
      map.removeLayer(pickupMarkerRef.current);
      pickupMarkerRef.current = null;
    }

    // All other restaurants — created once, repositioned in place, and removed
    // again the moment they leave the list (bad rows are skipped, never thrown).
    const nextRestaurantIds = new Set<string>();
    if (restaurants) {
      for (const spot of restaurants) {
        if (!spot?.id || !isUsablePin(spot.lat, spot.lng)) continue;
        if (nextRestaurantIds.has(spot.id)) continue;
        nextRestaurantIds.add(spot.id);

        const position: L.LatLngExpression = [spot.lat, spot.lng];
        const existing = restaurantMarkersRef.current.get(spot.id);
        if (existing) {
          existing.setLatLng(position);
        } else {
          const marker = L.marker(position, { icon: restaurantIcon, keyboard: false })
            .addTo(map)
            .bindPopup(spot.name?.trim() || 'Restaurant');
          restaurantMarkersRef.current.set(spot.id, marker);
        }
      }
    }
    for (const [id, marker] of Array.from(restaurantMarkersRef.current.entries())) {
      if (!nextRestaurantIds.has(id)) {
        map.removeLayer(marker);
        restaurantMarkersRef.current.delete(id);
      }
    }

    /** Straight dashed corridor: pickup → courier → destination (always drawn). */
    const rebuildCorridor = (courierLL: L.LatLng | null) => {
      const points: L.LatLngExpression[] = [];
      if (pickupPt) points.push([pickupPt.lat, pickupPt.lng]);
      if (courierLL) points.push([courierLL.lat, courierLL.lng]);
      if (destinationPt) points.push([destinationPt.lat, destinationPt.lng]);

      if (points.length >= 2) {
        if (corridorPolylineRef.current) {
          corridorPolylineRef.current.setLatLngs(points);
        } else {
          corridorPolylineRef.current = L.polyline(points, {
            color: '#059669',
            weight: 3,
            opacity: 0.7,
            dashArray: '8 8',
            lineCap: 'round',
          }).addTo(map);
        }
      } else if (corridorPolylineRef.current) {
        map.removeLayer(corridorPolylineRef.current);
        corridorPolylineRef.current = null;
      }
    };

    /** Solid road-snapped route for the leg the rider is actually driving. */
    const drawRoadRoute = (courierLL: L.LatLng | null) => {
      if (!roadRoute || roadRoute.coordinates.length < 2) {
        if (roadPolylineRef.current) {
          map.removeLayer(roadPolylineRef.current);
          roadPolylineRef.current = null;
        }
        return;
      }

      const coords = roadRoute.coordinates.map(
        (point): L.LatLngExpression => [point.lat, point.lng]
      );

      // Keep the route glued to the live marker: the drawn line starts at the
      // rider's current spot, not where the route was requested from.
      if (courierLL) {
        const origin = roadRoute.coordinates[0];
        if (haversineKm({ lat: origin.lat, lng: origin.lng }, { lat: courierLL.lat, lng: courierLL.lng }) < 0.5) {
          coords[0] = [courierLL.lat, courierLL.lng];
        }
      }

      if (roadPolylineRef.current) {
        roadPolylineRef.current.setLatLngs(coords);
      } else {
        roadPolylineRef.current = L.polyline(coords, {
          color: '#059669',
          weight: 4,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        roadPolylineRef.current.bringToFront();
      }
    };

    // Hand the drawing helpers to the animation loop — they close over this
    // run's pins and route, and the effect re-runs whenever those change.
    drawRefs.current = { corridor: rebuildCorridor, route: drawRoadRoute };

    if (courierPosition) {
      const target = L.latLng(courierPosition.lat, courierPosition.lng);
      const popupText = courierName ? `${courierName} is here` : 'Your courier is here';

      if (!courierMarkerRef.current) {
        // First fix — place the marker directly (no glide from nowhere)
        courierMarkerRef.current = L.marker(target, { icon: courierIcon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup(popupText);
        currentLatLngRef.current = target;
        rebuildCorridor(target);
        drawRoadRoute(target);
      } else {
        courierMarkerRef.current.setPopupContent(popupText);
      }

      // Consumers rebuild `courierPosition` as a fresh literal on every
      // render, so only an actual coordinate change restarts the ride.
      const previous = targetRef.current;
      const isNewFix =
        !previous ||
        Math.abs(previous.lat - target.lat) > SAME_FIX_EPS ||
        Math.abs(previous.lng - target.lng) > SAME_FIX_EPS;

      if (isNewFix) {
        const now = Date.now();
        const gapMs = lastFixAtRef.current
          ? Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, now - lastFixAtRef.current))
          : DEFAULT_TRAVEL_MS;
        lastFixAtRef.current = now;
        targetRef.current = target;

        const animatedFrom = currentLatLngRef.current;
        const distKm = animatedFrom
          ? haversineKm(
              { lat: animatedFrom.lat, lng: animatedFrom.lng },
              { lat: target.lat, lng: target.lng }
            )
          : Number.POSITIVE_INFINITY;

        if (!animatedFrom || distKm > SNAP_THRESHOLD_KM || document.hidden) {
          // Huge jump (page refresh, courier reassignment, stale fix) — snap.
          // A hidden tab also snaps instead of riding: requestAnimationFrame
          // callbacks are paused while the screen is off / the app is
          // backgrounded, so a ride started here would leave the marker stuck
          // on an old coordinate until the customer came back.
          speedRef.current = 0;
          stopLoop();
          currentLatLngRef.current = target;
          courierMarkerRef.current.setLatLng(target);
          rebuildCorridor(target);
          drawRoadRoute(target);
        } else if (distKm > 0) {
          // Normal ping — cover the gap at the speed the rider is actually
          // moving (gap distance ÷ gap time), so the marker glides along
          // continuously and lands on the fix as the next one is due.
          speedRef.current = distKm / gapMs;
          ensureLoop();
        }

        // Camera: re-centre when the rider drifts into the outer band of the
        // frame (unless the user took over by dragging/zooming). The pan runs
        // over the same window as the marker, so camera and pin travel
        // together instead of snapping.
        if (followRef.current && outsideFollowZone(map, target)) {
          map.panTo(target, {
            animate: true,
            duration: Math.min(6, Math.max(0.6, gapMs / 1000)),
            easeLinearity: 0.25,
          });
        }
      }

      const at = currentLatLngRef.current ?? target;

      // Re-draw both lines on every run: the road route or the trip pins may
      // have changed even when the GPS fix didn't.
      rebuildCorridor(at);
      drawRoadRoute(at);
      lastRouteDrawRef.current = performance.now();

      // Stationary (or just snapped): aim the pin down the leg he's driving.
      if (speedRef.current === 0 && courierMarkerRef.current) {
        aimAtLeg(courierMarkerRef.current, target, leg);
      }
    } else {
      // No courier fix yet — still show pickup → destination corridor
      stopLoop();
      targetRef.current = null;
      lastFixAtRef.current = 0;
      speedRef.current = 0;
      rebuildCorridor(null);
      drawRoadRoute(null);
    }

    // Frame the viewport whenever the set of visible pins changes — courier
    // fix, trip pins and the restaurant network all count, but GPS pings never
    // do, so the courier's pan/zoom is respected afterwards.
    const restaurantPins = restaurants?.filter((r) => isUsablePin(r.lat, r.lng)) ?? [];
    const fitSig = `${courierPosition ? 1 : 0}${pickupPt ? 1 : 0}${destinationPt ? 1 : 0}${
      restaurantPins.length > 0 ? 1 : 0
    }`;
    if (fitSig !== fitSigRef.current && fitSig !== '0000') {
      const points: L.LatLngExpression[] = [];
      if (courierPosition) points.push([courierPosition.lat, courierPosition.lng]);
      if (pickupPt) points.push([pickupPt.lat, pickupPt.lng]);
      if (destinationPt) points.push([destinationPt.lat, destinationPt.lng]);
      // Every kitchen too, so the full network is on screen from the first frame
      for (const spot of restaurantPins) points.push([spot.lat, spot.lng]);

      if (points.length >= 2) {
        map.fitBounds(L.latLngBounds(points).pad(0.35));
      } else {
        const only = points[0] as [number, number];
        map.setView(only, 14);
      }
      fitSigRef.current = fitSig;
    }
  }, [courierPosition, destinationPt, pickupPt, courierName, roadRoute, restaurantKey]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${className} rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 z-0`}
    >
      {/* Camera-follow: shown only after the user drags/zooms away from the rider */}
      {courierPosition && !following && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="absolute right-2 bottom-6 z-[1000] flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/95 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-700 shadow-md transition active:scale-95 hover:bg-emerald-50"
        >
          <LocateFixed className="w-3.5 h-3.5" />
          Follow
        </button>
      )}
    </div>
  );
};
