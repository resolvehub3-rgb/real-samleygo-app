import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, CornerUpLeft, CornerUpRight, LocateFixed, MapPin } from 'lucide-react';
import {
  ACCRA,
  MAP_ID,
  cancelCameraPan,
  fitPoints,
  loadGoogleMaps,
  outsideCenterZone,
  panToAnimated,
} from '../../lib/googleMaps';
import { escapeHtml, makePinContent, pinAnchor } from '../../lib/mapMarkers';
import type { RestaurantMapPin } from '../../lib/restaurantPins';
import {
  calculateRoute,
  formatRouteDistance,
  formatRouteDuration,
  geocodeAddress,
  haversineKm,
  type LatLng,
} from '../../lib/routing';
import {
  destinationForPhase,
  evaluateReroute,
  isOffRoute,
  navLog,
  nextManeuver,
  currentRoadName,
  projectOnRoute,
  resolveNavigationPhase,
  recordSessionRoute,
  type NavigationPhase,
  type NavigationRoute,
  type NavigationStep,
  type UpcomingManeuver,
} from '../../lib/navigation';

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
  /** Metres still to drive — refreshed as the courier moves along the route. */
  remainingMeters?: number;
  /** Seconds still to drive (scaled from the routing engine's duration). */
  remainingSeconds?: number;
  /** Navigation phase this route belongs to. */
  phase?: NavigationPhase;
}

/** A secondary restaurant pin drawn alongside the active trip.
 * One shared shape, owned by the map-pin helpers in `src/lib/restaurantPins`.
 */
export type MapRestaurantPin = RestaurantMapPin;

/** Everything the navigation HUD needs, recomputed on every GPS fix. */
interface NavProgress {
  remainingMeters: number;
  remainingSeconds: number;
  offRouteMeters: number;
  maneuver: UpcomingManeuver | null;
  currentRoad: string | null;
  /** Courier is inside the destination radius ("You have arrived"). */
  arrived: boolean;
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
  /**
   * Latest GPS telemetry for the courier fix (accuracy/heading/speed/timestamp).
   * Drives deviation thresholds, marker rotation and the diagnostics HUD.
   */
  courierFix?: {
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
    timestamp?: number | null;
  } | null;
  /**
   * Draw the courier navigation HUD (next maneuver, ETA, distance remaining,
   * arrival notice). Only the courier's own screen sets this — customers get
   * position + route overview + ETA, never turn-by-turn instructions.
   */
  showNavigationHud?: boolean;
}

/** An Advanced Marker: an HTMLElement the Maps API positions on the map. */
type PinMarker = google.maps.marker.AdvancedMarkerElement;

/**
 * Rotates the pin so its tip points at `headingDeg` (degrees clockwise from
 * north), like a navigation arrow — the emoji counter-rotates to stay upright.
 * The pin's tip starts at due south (180°), so the body turns by
 * `heading - 225`.
 */
const applyHeading = (content: HTMLDivElement | null, headingDeg: number) => {
  const pin = content?.querySelector('.sg-pin') as HTMLElement | null;
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

/** Only ride the drawn road when the marker is this close to it (≤ ~30 m). */
const ROUTE_SNAP_KM = 0.03;
/** …and the road detour this far from the straight chord before we give up on it. */
const ROUTE_DETOUR_RATIO = 4;

/**
 * The road-snapped route, flattened into an arc-length track so the marker can
 * slide *along the street* between GPS fixes instead of cutting a straight
 * line through the blocks. `cumulative[i]` is the distance from the start of
 * the route to vertex `i`, in kilometres.
 */
interface RouteTrack {
  lat: number[];
  lng: number[];
  cumulative: number[];
  totalKm: number;
}

const buildTrack = (coordinates: { lat: number; lng: number }[]): RouteTrack | null => {
  if (coordinates.length < 2) return null;
  const lat: number[] = [];
  const lng: number[] = [];
  const cumulative: number[] = [0];
  let totalKm = 0;
  for (const point of coordinates) {
    lat.push(point.lat);
    lng.push(point.lng);
    if (lat.length > 1) {
      const previous = { lat: lat[lat.length - 2], lng: lng[lng.length - 2] };
      totalKm += haversineKm(previous, { lat: point.lat, lng: point.lng });
      cumulative.push(totalKm);
    }
  }
  return { lat, lng, cumulative, totalKm };
};

/** The point `sKm` along the track (clamped to its ends). */
const trackPointAt = (track: RouteTrack, sKm: number): LatLng => {
  const clamped = Math.max(0, Math.min(track.totalKm, sKm));
  let lo = 0;
  let hi = track.cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (track.cumulative[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const span = track.cumulative[hi] - track.cumulative[lo];
  const k = span > 0 ? (clamped - track.cumulative[lo]) / span : 0;
  return {
    lat: track.lat[lo] + (track.lat[hi] - track.lat[lo]) * k,
    lng: track.lng[lo] + (track.lng[hi] - track.lng[lo]) * k,
  };
};

/**
 * Where a point falls on the track: how far along it is (`sKm`) and how far it
 * sits from the road (`perpKm`). Flat-earth metres are fine at this scale.
 */
const projectOnTrack = (
  track: RouteTrack,
  point: LatLng
): { sKm: number; perpKm: number } => {
  const midLat = ((track.lat[0] + point.lat) / 2) * (Math.PI / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(midLat);
  const px = point.lng * mPerDegLng;
  const py = point.lat * mPerDegLat;

  let bestSkm = 0;
  let bestPerpKm = Number.POSITIVE_INFINITY;
  for (let i = 1; i < track.lat.length; i += 1) {
    const ax = track.lng[i - 1] * mPerDegLng;
    const ay = track.lat[i - 1] * mPerDegLat;
    const dx = track.lng[i] * mPerDegLng - ax;
    const dy = track.lat[i] * mPerDegLat - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const perpKm = Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) / 1000;
    if (perpKm < bestPerpKm) {
      const segKm = Math.hypot(dx, dy) / 1000;
      bestPerpKm = perpKm;
      bestSkm = track.cumulative[i - 1] + segKm * t;
    }
  }
  return { sKm: bestSkm, perpKm: bestPerpKm };
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

/** How close (metres) the courier must be to a pin before "You have arrived". */
const ARRIVAL_RADIUS_M = 150;
/** GPS heading is only trusted above this speed — below it, noise dominates. */
const GPS_HEADING_MIN_SPEED_MPS = 3;
/** Re-notify parents about remaining distance every ~100 m of progress. */
const PROGRESS_NOTIFY_M = 100;
/** HUD refresh granularity: only re-render when progress actually moved. */
const PROGRESS_STATE_M = 25;

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
/**
 * Re-route policy (off-route threshold, cooldown, backoff, route staleness)
 * lives in `src/lib/navigation.ts` (`evaluateReroute`) so it is unit-tested
 * and shared with every consumer — it used to be keyed on distance from the
 * route origin here, which fired every ~20 s and cut across city blocks.
 */

/**
 * Live delivery map showing the courier's real-time position together with the
 * restaurant pickup pin and the customer drop-off pin.
 *
 * - the courier marker rides along at a constant speed derived from the GPS
 *   cadence (requestAnimationFrame), sliding along the drawn road route so it
 *   follows the streets instead of cutting straight across them; it keeps
 *   moving between pings, points the way the rider is heading, and the camera
 *   follows until the user pans away (a "Follow" button brings it back)
 * - the active leg is the only line on the map: a road-snapped OSRM route
 *   that re-routes as the courier moves (on failure the last good line stays
 *   up and is retried with backoff)
 * - pins missing coordinates are geocoded from their address
 * - every network call is cached, throttled, self-healing and never throws
 *   (stale replies are dropped locally instead of cancelling requests, so a
 *   cancelled fetch can never poison the cache with a false "no result")
 *
 * The canvas is the Google Maps JavaScript API (Advanced Markers), loaded
 * once through `src/lib/googleMaps.ts`.
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
  courierFix,
  showNavigationHud = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const courierMarkerRef = useRef<PinMarker | null>(null);
  /** The courier marker's DOM node — heading rotation happens on this. */
  const courierContentRef = useRef<HTMLDivElement | null>(null);
  const destinationMarkerRef = useRef<PinMarker | null>(null);
  const pickupMarkerRef = useRef<PinMarker | null>(null);
  const roadPolylineRef = useRef<google.maps.Polyline | null>(null);
  /** Arc-length view of the drawn road route — the marker rides along this. */
  const trackRef = useRef<RouteTrack | null>(null);
  /** Secondary restaurant pins, keyed by restaurant id so updates are cheap. */
  const restaurantMarkersRef = useRef<Map<string, PinMarker>>(new Map());
  /** Fit-once guard: pin/courier presence signature the viewport was framed for. */
  const fitSigRef = useRef('');
  /** The marker's current *animated* position (may lag behind the latest ping). */
  const currentLatLngRef = useRef<LatLng | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // ── Continuous motion state (the "live navigation" feel) ──────────────
  /** Latest GPS fix — the animation loop always steers toward this. */
  const targetRef = useRef<LatLng | null>(null);
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
  /** Fresh drawing closure for the animation loop (set every render). */
  const drawRefs = useRef<{ route: (position: LatLng | null) => void }>({
    route: () => {},
  });
  /** Handlers the (mount-once) map setup needs from the latest render. */
  const actionRefs = useRef<{
    setFollow: (on: boolean) => void;
    openPopup: (marker: PinMarker) => void;
  }>({ setFollow: () => {}, openPopup: () => {} });

  // ── Map bootstrap state ───────────────────────────────────────────────
  /** Guards the async loader against React StrictMode's double effect. */
  const initStartedRef = useRef(false);
  /** Zoom events the API itself fires while the map is being constructed. */
  const ignoreZoomUntilRef = useRef(0);
  /** Timestamp of the last real gesture on the map (pointer / wheel / key). */
  const userGestureAtRef = useRef(0);
  /** One shared popup for every pin (Leaflet used one per marker). */
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const popupTextsRef = useRef<Map<PinMarker, string>>(new Map());
  const popupAnchorRef = useRef<PinMarker | null>(null);

  const mountedRef = useRef(true);
  const attemptRef = useRef<{ courier: LatLng; target: LatLng; leg: RouteLeg; at: number } | null>(null);
  const failuresRef = useRef(0);
  const routeInFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const lastNotifiedRef = useRef('none');
  const onRouteUpdateRef = useRef(onRouteUpdate);
  /** Consecutive off-route fixes — a single bad reading never reroutes. */
  const offRouteStreakRef = useRef(0);
  /** GPS heading while it is reliable (speed above the noise floor). */
  const gpsHeadingRef = useRef<number | null>(null);
  /** Latest GPS telemetry, readable from long-lived closures. */
  const courierFixRef = useRef(courierFix ?? null);

  const [resolvedPickup, setResolvedPickup] = useState<LatLng | null>(null);
  const [resolvedDestination, setResolvedDestination] = useState<LatLng | null>(null);
  const [roadRoute, setRoadRoute] = useState<
    (NavigationRoute & { leg: RouteLeg; phase: NavigationPhase }) | null
  >(null);
  /** Lifecycle of the current route request, surfaced on the HUD. */
  const [routeStatus, setRouteStatus] = useState<
    'idle' | 'loading' | 'recalculating' | 'ready' | 'retrying'
  >('idle');
  /** Live navigation progress (remaining distance/ETA, next maneuver). */
  const [navProgress, setNavProgress] = useState<NavProgress | null>(null);
  /** Camera-follow UI: false once the user drags/zooms away from the rider. */
  const [following, setFollowing] = useState(true);
  /** Flip once the API has loaded and the map exists, so pins can be drawn. */
  const [mapReady, setMapReady] = useState(false);
  /** Human-readable reason the map could not be shown, if any. */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Always call the newest callback without re-running effects that depend on it.
  useEffect(() => {
    onRouteUpdateRef.current = onRouteUpdate;
    courierFixRef.current = courierFix ?? null;

    // Compass-free devices report `heading: null`, and at walking pace the
    // reported heading is pure noise — only trust it above the speed floor.
    const heading = courierFix?.heading;
    const speed = courierFix?.speed ?? 0;
    const headingOk =
      typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && heading < 360;
    gpsHeadingRef.current =
      headingOk && Number.isFinite(speed) && speed >= GPS_HEADING_MIN_SPEED_MPS
        ? (heading as number)
        : null;
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
  // ONE source of truth: the phase is derived from the REAL order status and
  // the pins that actually exist (see src/lib/navigation.ts). A delivery-phase
  // order can only ever resolve to the customer — never back to the kitchen,
  // and never to another order's destination.
  const phase: NavigationPhase = resolveNavigationPhase(status, {
    hasPickup: Boolean(pickupPt),
    hasDestination: Boolean(destinationPt),
  });
  const phaseTarget = destinationForPhase(phase, pickupPt, destinationPt);

  const leg: { kind: RouteLeg; target: LatLng; phase: NavigationPhase } | null = phaseTarget
    ? {
        kind: phase === 'TO_RESTAURANT' ? 'TO_PICKUP' : 'TO_CUSTOMER',
        target: phaseTarget,
        phase,
      }
    : null;

  const legKind: RouteLeg | null = leg?.kind ?? null;
  const targetKey = leg ? `${round5(leg.target.lat)},${round5(leg.target.lng)}` : '';

  // ── Popups (one shared InfoWindow, text kept per pin) ─────────────────
  const setPopupText = (marker: PinMarker, text: string) => {
    popupTextsRef.current.set(marker, text);
    // Keep an open bubble in sync — the courier's caption changes on every ping.
    if (popupAnchorRef.current === marker) infoWindowRef.current?.setContent(text);
  };

  const openPopup = (marker: PinMarker) => {
    const map = mapRef.current;
    const text = popupTextsRef.current.get(marker);
    if (!map || !text) return;
    if (!infoWindowRef.current) {
      // No auto-pan: the camera belongs to the rider, not to a stray tap.
      infoWindowRef.current = new google.maps.InfoWindow({ disableAutoPan: true });
      infoWindowRef.current.addListener('closeclick', () => {
        popupAnchorRef.current = null;
      });
    }
    infoWindowRef.current.setContent(text);
    infoWindowRef.current.open({ anchor: marker, map, shouldFocus: false });
    popupAnchorRef.current = marker;
  };

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
    applyHeading(courierContentRef.current, normalized);
  };

  /**
   * Icon for the HUD's "next maneuver" card — derived from the routing
   * engine's own maneuver type/modifier, never from a hardcoded list of
   * streets.
   */
  const maneuverIcon = (step: NavigationStep | undefined | null) => {
    const type = (step?.maneuverType ?? '').toLowerCase();
    const modifier = (step?.maneuverModifier ?? '').toLowerCase();
    if (type === 'arrive') return <MapPin className="w-5 h-5" />;
    if (modifier.includes('left')) return <CornerUpLeft className="w-5 h-5" />;
    if (modifier.includes('right')) return <CornerUpRight className="w-5 h-5" />;
    return <ArrowUp className="w-5 h-5" />;
  };

  /** While parked, point the pin at the stop the rider is driving to. */
  const aimAtLeg = (from: LatLng, currentLeg: { target: LatLng } | null) => {
    setHeading(currentLeg ? bearingDeg(from, currentLeg.target) : 180);
  };

  /**
   * One frame of the ride: advance toward the latest fix at the speed implied
   * by the previous gap (distance ÷ time), **sliding along the drawn road
   * route** so the rider follows the streets instead of cutting through the
   * blocks. Falls back to a straight hop when no route has arrived yet or the
   * fix is nowhere near the road.
   */
  const stepAlongRoute = (current: LatLng, target: LatLng, stepKm: number, chordKm: number) => {
    const track = trackRef.current;
    if (track) {
      const from = projectOnTrack(track, current);
      const to = projectOnTrack(track, target);
      const sane =
        from.perpKm < ROUTE_SNAP_KM &&
        to.perpKm < ROUTE_SNAP_KM &&
        to.sKm > from.sKm &&
        to.sKm - from.sKm < Math.max(chordKm, 0.03) * ROUTE_DETOUR_RATIO;
      if (sane) {
        const sKm = Math.min(to.sKm, from.sKm + stepKm);
        if (sKm > from.sKm) return trackPointAt(track, sKm);
      }
    }

    const k = chordKm > 0 ? Math.min(1, stepKm / chordKm) : 1;
    return {
      lat: current.lat + (target.lat - current.lat) * k,
      lng: current.lng + (target.lng - current.lng) * k,
    };
  };

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
    const stepKm = speedRef.current * dt;

    // Arrived, no speed, or the screen went off — park on the latest fix.
    if (document.hidden || speedRef.current <= 0 || stepKm >= remainingKm) {
      currentLatLngRef.current = target;
      marker.position = target;
      drawRefs.current.route(target);
      animFrameRef.current = null;
      return;
    }

    const next = stepAlongRoute(current, target, stepKm, remainingKm);

    currentLatLngRef.current = next;
    marker.position = next;
    // The road route can carry hundreds of points — repaint it on a slow tick.
    if (now - lastRouteDrawRef.current > 200) {
      lastRouteDrawRef.current = now;
      drawRefs.current.route(next);
    }
    // Point the pin where the rider is actually driving: a trustworthy GPS
    // heading wins over the geometry of the animated hop (which lags a fix
    // behind), and the leg bearing stays the fallback while moving slowly.
    const gpsHeading = gpsHeadingRef.current;
    if (gpsHeading !== null) setHeading(gpsHeading);
    else if (remainingKm > HEADING_MIN_KM) setHeading(bearingDeg(current, next));

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
    const map = mapRef.current;
    if (!map) return;
    if (!on) {
      cancelCameraPan(map);
      return;
    }
    const at = currentLatLngRef.current ?? targetRef.current;
    if (at) panToAnimated(map, at, 700);
  };

  // The map is created once, so keep its handlers pointed at the newest closure.
  useEffect(() => {
    actionRefs.current.setFollow = setFollow;
    actionRefs.current.openPopup = openPopup;
  });

  // ── Route bookkeeping ─────────────────────────────────────────────────
  /**
   * Report the active route (and the courier's progress along it) to parents.
   * Deduped — including remaining distance in 100 m buckets — so a GPS stream
   * can never turn into a re-render storm.
   */
  const notifyRouteUpdate = (info: ActiveRouteInfo | null) => {
    const key = info
      ? `${info.leg}:${info.distanceMeters}:${info.durationSeconds}:${Math.round(
          (info.remainingMeters ?? 0) / PROGRESS_NOTIFY_M
        )}`
      : 'none';
    if (key === lastNotifiedRef.current) return;
    lastNotifiedRef.current = key;
    onRouteUpdateRef.current?.(info);
  };

  // ── A changed phase/destination invalidates every in-flight request ───
  // Bump the request id FIRST: a response from the previous destination
  // (restaurant → customer, or an old customer pin) must never overwrite the
  // route to the new one, no matter when it finally lands.
  useEffect(() => {
    requestIdRef.current += 1;
    routeInFlightRef.current = false;
    attemptRef.current = null;
    failuresRef.current = 0;
    offRouteStreakRef.current = 0;
    setRoadRoute((current) => (current && leg && current.leg !== leg.kind ? null : current));
    setRouteStatus('idle');
    setNavProgress(null);
    if (leg) {
      navLog('NAVIGATION_DESTINATION_CHANGED', { phase: leg.phase, target: leg.target });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKind, targetKey]);

  // ── Live road route: deviation-aware, debounced, failure-tolerant ─────
  useEffect(() => {
    if (!courierPosition || !leg) {
      attemptRef.current = null;
      failuresRef.current = 0;
      offRouteStreakRef.current = 0;
      setRoadRoute(null);
      setRouteStatus('idle');
      notifyRouteUpdate(null);
      return;
    }

    // The trip changed legs (food picked up) — drop the stale route at once.
    if (roadRoute && roadRoute.leg !== leg.kind) setRoadRoute(null);

    const now = Date.now();
    const attempt = attemptRef.current;
    const activeRoute = roadRoute && roadRoute.leg === leg.kind ? roadRoute : null;

    // Deviation: where does the LIVE fix sit relative to the drawn road route?
    const projection = activeRoute ? projectOnRoute(activeRoute, courierPosition) : null;
    const offRouteMeters = projection?.offRouteMeters ?? null;
    const accuracy = courierFixRef.current?.accuracy ?? null;
    const offRoute = isOffRoute(offRouteMeters, accuracy);
    // Two consecutive off-route fixes before a reroute is considered real —
    // one noisy reading must never trigger a routing request.
    offRouteStreakRef.current = offRoute
      ? Math.min(offRouteStreakRef.current + 1, 4)
      : 0;

    const destinationChanged =
      !attempt ||
      attempt.leg !== leg.kind ||
      haversineKm(attempt.target, leg.target) >= 0.01;
    const movedKm = attempt ? haversineKm(courierPosition, attempt.courier) : null;

    const decision = evaluateReroute({
      now,
      hasRoute: Boolean(activeRoute),
      destinationChanged,
      offRoute,
      offRouteStreak: offRouteStreakRef.current,
      lastAttemptAt: attempt?.at ?? null,
      failureCount: failuresRef.current,
      movedFromRouteOriginMeters:
        movedKm != null && Number.isFinite(movedKm) ? movedKm * 1000 : null,
      routeAgeMs: activeRoute ? now - Date.parse(activeRoute.calculatedAt) : null,
    });

    if (!decision.recalculate) return;
    // One request at a time; the next ping retries if this one was skipped.
    if (routeInFlightRef.current) return;

    if (decision.reason === 'ROUTE_DEVIATION') {
      navLog('NAVIGATION_DEVIATION_DETECTED', {
        offRouteMeters: Math.round(offRouteMeters ?? 0),
        accuracyMeters: accuracy ?? undefined,
        streak: offRouteStreakRef.current,
      });
      navLog('NAVIGATION_REROUTE', { reason: decision.reason, origin: courierPosition });
    }

    routeInFlightRef.current = true;
    const requestId = ++requestIdRef.current;
    attemptRef.current = { courier: courierPosition, target: leg.target, leg: leg.kind, at: now };
    setRouteStatus(activeRoute ? 'recalculating' : 'loading');

    // A failed refresh keeps the last good line for this leg (its origin still
    // snaps to the rider) and retries with exponential backoff instead of
    // blanking the trip.
    const handleFailure = () => {
      failuresRef.current = Math.min(failuresRef.current + 1, 4);
      setRouteStatus('retrying');
    };

    // Origin is ALWAYS the courier's current GPS position; destination is the
    // active phase's target. Steps=true powers the turn-by-turn HUD.
    calculateRoute(courierPosition, leg.target, { steps: true })
      .then((route) => {
        routeInFlightRef.current = false;
        // Stale response guard: an older request can never overwrite a newer one.
        if (!mountedRef.current || requestId !== requestIdRef.current) return;

        if (!route) {
          handleFailure(); // keep the last line; the next ping retries with backoff
          return;
        }

        failuresRef.current = 0;
        setRoadRoute({ ...route, leg: leg.kind, phase: leg.phase });
        setRouteStatus('ready');
        recordSessionRoute(route);
        notifyRouteUpdate({
          leg: leg.kind,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          remainingMeters: route.distanceMeters,
          remainingSeconds: route.durationSeconds,
          phase: leg.phase,
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

  // ── Live progress: remaining distance/ETA, next maneuver, arrival ─────
  useEffect(() => {
    if (!roadRoute || !courierPosition || !leg) {
      setNavProgress(null);
      notifyRouteUpdate(null);
      return;
    }

    const projection = projectOnRoute(roadRoute, courierPosition);
    if (!projection) return;

    const total = Math.max(1, roadRoute.distanceMeters);
    const travelled = Math.min(projection.alongMeters, total);
    const remainingMeters = Math.max(0, Math.round(total - travelled));
    const remainingSeconds = Math.max(
      0,
      Math.round(Math.max(1, roadRoute.durationSeconds) * (remainingMeters / total))
    );
    const offRouteMeters = Math.round(projection.offRouteMeters);
    const maneuver = nextManeuver(roadRoute, travelled);
    const currentRoad = currentRoadName(roadRoute, travelled);
    const arrived = haversineKm(courierPosition, leg.target) * 1000 <= ARRIVAL_RADIUS_M;

    notifyRouteUpdate({
      leg: roadRoute.leg,
      distanceMeters: roadRoute.distanceMeters,
      durationSeconds: roadRoute.durationSeconds,
      remainingMeters,
      remainingSeconds,
      phase: roadRoute.phase,
    });

    setNavProgress((previous) => {
      if (
        previous &&
        Math.abs(previous.remainingMeters - remainingMeters) < PROGRESS_STATE_M &&
        previous.maneuver?.step.instruction === maneuver?.step.instruction &&
        Math.abs(previous.offRouteMeters - offRouteMeters) < 10 &&
        previous.arrived === arrived &&
        previous.currentRoad === currentRoad
      ) {
        return previous;
      }
      return { remainingMeters, remainingSeconds, offRouteMeters, maneuver, currentRoad, arrived };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadRoute, courierPosition, legKind, targetKey]);

  // ── Initialize the map once ───────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current || initStartedRef.current) return;
    initStartedRef.current = true;

    let cancelled = false;
    let observer: ResizeObserver | null = null;

    // Same affordance as before: the wheel scrolls the page until the map is
    // clicked, then it takes the wheel — and hands it back when the pointer
    // leaves.
    const enableWheel = () => mapRef.current?.setOptions({ scrollwheel: true });
    const disableWheel = () => mapRef.current?.setOptions({ scrollwheel: false });
    // Anything that could be a zoom gesture. `zoom_changed` alone cannot tell
    // a pinch/wheel/+- button apart from our own `fitPoints`, and Google may
    // raise it a beat after the change, so gestures are remembered for a
    // second instead of being checked synchronously.
    const markGesture = () => {
      userGestureAtRef.current = Date.now();
    };

    loadGoogleMaps()
      .then(() => {
        if (cancelled || mapRef.current || !containerRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
          center: ACCRA,
          zoom: 13,
          mapId: MAP_ID, // Advanced Markers refuse to draw without one
          zoomControl: true,
          scrollwheel: false, // prevent page-scroll hijack; the map is clicked first
          gestureHandling: 'greedy', // touches pan the map, like Leaflet did
          maxZoom: 19,
        });
        mapRef.current = map;
        ignoreZoomUntilRef.current = Date.now() + 750;

        // The camera follows the rider by default. The moment the user drags
        // the map or zooms they take control — following pauses and a "Follow"
        // button appears. Programmatic pans and fits are never gestures, so
        // they keep following.
        map.addListener('dragstart', () => actionRefs.current.setFollow(false));
        map.addListener('zoom_changed', () => {
          if (Date.now() < ignoreZoomUntilRef.current) return;
          if (Date.now() - userGestureAtRef.current > 1000) return;
          actionRefs.current.setFollow(false);
        });

        container.addEventListener('click', enableWheel);
        container.addEventListener('mouseleave', disableWheel);
        container.addEventListener('pointerdown', markGesture);
        container.addEventListener('wheel', markGesture, { passive: true });
        container.addEventListener('touchstart', markGesture, { passive: true });
        container.addEventListener('keydown', markGesture);

        const resize = () => {
          const current = mapRef.current;
          if (!current) return;
          google.maps.event.trigger(current, 'resize');
          const centre = current.getCenter();
          if (centre) current.setCenter(centre); // keep the camera steady
        };
        observer = new ResizeObserver(resize);
        observer.observe(container);

        setMapReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Google Maps failed to load.');
        }
      });

    return () => {
      cancelled = true;
      initStartedRef.current = false;
      observer?.disconnect();
      container.removeEventListener('click', enableWheel);
      container.removeEventListener('mouseleave', disableWheel);
      container.removeEventListener('pointerdown', markGesture);
      container.removeEventListener('wheel', markGesture);
      container.removeEventListener('touchstart', markGesture);
      container.removeEventListener('keydown', markGesture);

      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }

      const map = mapRef.current;
      if (map) {
        cancelCameraPan(map);
        infoWindowRef.current?.close();
        google.maps.event.clearInstanceListeners(map);
        // There is no `map.remove()` in the Google API: detach what we added
        // and empty the container so a remount starts from a clean slate.
        if (courierMarkerRef.current) courierMarkerRef.current.map = null;
        if (destinationMarkerRef.current) destinationMarkerRef.current.map = null;
        if (pickupMarkerRef.current) pickupMarkerRef.current.map = null;
        roadPolylineRef.current?.setMap(null);
        restaurantMarkersRef.current.forEach((marker) => {
          marker.map = null;
        });
        container.replaceChildren();
        mapRef.current = null;
      }
      drawRefs.current = { route: () => {} };
      restaurantMarkersRef.current.clear();
      courierMarkerRef.current = null;
      courierContentRef.current = null;
      destinationMarkerRef.current = null;
      pickupMarkerRef.current = null;
      roadPolylineRef.current = null;
      infoWindowRef.current = null;
      popupTextsRef.current.clear();
      popupAnchorRef.current = null;
      currentLatLngRef.current = null;
      fitSigRef.current = '';
      trackRef.current = null;
      // Motion state belongs to the map that was just torn down (StrictMode
      // remounts reuse these refs): force a fresh target, cadence and heading.
      targetRef.current = null;
      lastFixAtRef.current = 0;
      speedRef.current = 0;
      headingRef.current = -1;
      gpsHeadingRef.current = null;
      offRouteStreakRef.current = 0;
      lastRouteDrawRef.current = 0;
      userGestureAtRef.current = 0;
      setMapReady(false);
    };
  }, []);

  // ── Pins, route lines & animated courier marker ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Destination pin (created once, then kept in sync with its coordinates)
    if (destinationPt) {
      const position: google.maps.LatLngLiteral = { lat: destinationPt.lat, lng: destinationPt.lng };
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.position = position;
      } else {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position,
          content: makePinContent('🏠', '#0f172a'),
          title: 'Customer drop-off',
          zIndex: 600,
          gmpClickable: true,
          ...pinAnchor(34),
        });
        setPopupText(marker, 'Customer drop-off');
        marker.addEventListener('gmp-click', () => actionRefs.current.openPopup(marker));
        destinationMarkerRef.current = marker;
      }
    } else if (destinationMarkerRef.current) {
      destinationMarkerRef.current.map = null;
      destinationMarkerRef.current = null;
    }

    // Restaurant pickup pin
    if (pickupPt) {
      const position: google.maps.LatLngLiteral = { lat: pickupPt.lat, lng: pickupPt.lng };
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.position = position;
      } else {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position,
          content: makePinContent('🍳', '#f59e0b'),
          title: 'Restaurant pickup',
          zIndex: 600,
          gmpClickable: true,
          ...pinAnchor(34),
        });
        setPopupText(marker, 'Restaurant pickup');
        marker.addEventListener('gmp-click', () => actionRefs.current.openPopup(marker));
        pickupMarkerRef.current = marker;
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.map = null;
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

        const position: google.maps.LatLngLiteral = { lat: spot.lat, lng: spot.lng };
        const name = spot.name?.trim() || 'Restaurant';
        const existing = restaurantMarkersRef.current.get(spot.id);
        if (existing) {
          existing.position = position;
        } else {
          const marker = new google.maps.marker.AdvancedMarkerElement({
            map,
            position,
            content: makePinContent('🏪', '#475569', 26),
            title: name,
            zIndex: 400,
            gmpClickable: true,
            ...pinAnchor(26),
          });
          setPopupText(marker, escapeHtml(name));
          marker.addEventListener('gmp-click', () => actionRefs.current.openPopup(marker));
          restaurantMarkersRef.current.set(spot.id, marker);
        }
      }
    }
    for (const [id, marker] of Array.from(restaurantMarkersRef.current.entries())) {
      if (!nextRestaurantIds.has(id)) {
        marker.map = null;
        restaurantMarkersRef.current.delete(id);
      }
    }

    /** Solid road-snapped route for the leg the rider is actually driving. */
    const drawRoadRoute = (courierLL: LatLng | null) => {
      if (!roadRoute || roadRoute.geometry.coordinates.length < 2) {
        if (roadPolylineRef.current) {
          roadPolylineRef.current.setMap(null);
          roadPolylineRef.current = null;
        }
        return;
      }

      const coords: google.maps.LatLngLiteral[] = roadRoute.geometry.coordinates.map((point) => ({
        lat: point.lat,
        lng: point.lng,
      }));

      // Keep the line glued to the live marker — but ONLY when the rider is
      // already on the route. Rewriting the first vertex from up to 500 m away
      // drew a fake straight-line segment across the city blocks between them;
      // 150 m is the deviation threshold at which we re-route anyway, so beyond
      // that the correct fix is a fresh route from the current GPS, not a lie.
      if (courierLL) {
        const origin = roadRoute.geometry.coordinates[0];
        if (
          haversineKm({ lat: origin.lat, lng: origin.lng }, { lat: courierLL.lat, lng: courierLL.lng }) <
          0.15
        ) {
          coords[0] = { lat: courierLL.lat, lng: courierLL.lng };
        }
      }

      if (roadPolylineRef.current) {
        roadPolylineRef.current.setPath(coords);
      } else {
        roadPolylineRef.current = new google.maps.Polyline({
          path: coords,
          strokeColor: '#059669',
          strokeOpacity: 0.95,
          strokeWeight: 4,
          zIndex: 1,
        });
        roadPolylineRef.current.setMap(map);
      }
    };

    // Hand the drawing helper to the animation loop — it closes over this run's
    // route, and the effect re-runs whenever that changes. The arc-length track
    // is rebuilt alongside it so the marker slides along the drawn road.
    drawRefs.current = { route: drawRoadRoute };
    trackRef.current = roadRoute ? buildTrack(roadRoute.geometry.coordinates) : null;

    if (courierPosition) {
      const target: LatLng = { lat: courierPosition.lat, lng: courierPosition.lng };
      const popupText = escapeHtml(
        courierName ? `${courierName} is here` : 'Your courier is here'
      );

      if (!courierMarkerRef.current) {
        // First fix — place the marker directly (no glide from nowhere)
        const content = makePinContent('🛵', '#059669', 34, true);
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: target,
          content,
          title: courierName || 'Your courier',
          zIndex: 1000,
          gmpClickable: true,
          ...pinAnchor(34),
        });
        marker.addEventListener('gmp-click', () => actionRefs.current.openPopup(marker));
        courierMarkerRef.current = marker;
        courierContentRef.current = content;
        setPopupText(marker, popupText);
        currentLatLngRef.current = target;
        drawRoadRoute(target);
      } else {
        setPopupText(courierMarkerRef.current, popupText);
        courierMarkerRef.current.title = courierName || 'Your courier';
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
          courierMarkerRef.current!.position = target;
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
        if (followRef.current && outsideCenterZone(map, target, OUTSIDE_FOLLOW_ZONE)) {
          panToAnimated(map, target, Math.min(6000, Math.max(600, gapMs)));
        }
      }

      const at = currentLatLngRef.current ?? target;

      // Re-draw the line on every run: the road route or the trip pins may
      // have changed even when the GPS fix didn't.
      drawRoadRoute(at);
      lastRouteDrawRef.current = performance.now();

      // Stationary (or just snapped): keep the real driving direction when the
      // GPS still knows it, otherwise aim down the leg he's driving to.
      if (gpsHeadingRef.current !== null) setHeading(gpsHeadingRef.current);
      else if (speedRef.current === 0) aimAtLeg(target, leg);
    } else {
      // No courier fix yet — no rider, so there is no leg to route
      stopLoop();
      targetRef.current = null;
      lastFixAtRef.current = 0;
      speedRef.current = 0;
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
      const points: google.maps.LatLngLiteral[] = [];
      if (courierPosition) points.push({ lat: courierPosition.lat, lng: courierPosition.lng });
      if (pickupPt) points.push({ lat: pickupPt.lat, lng: pickupPt.lng });
      if (destinationPt) points.push({ lat: destinationPt.lat, lng: destinationPt.lng });
      // Every kitchen too, so the full network is on screen from the first frame
      for (const spot of restaurantPins) points.push({ lat: spot.lat, lng: spot.lng });

      // Room around the pins that mirrors the old `bounds.pad(0.35)`.
      const width = containerRef.current?.clientWidth ?? 320;
      const height = containerRef.current?.clientHeight ?? 240;
      const padding = Math.max(32, Math.round(Math.min(width, height) * 0.12));

      fitPoints(map, points, { padding });
      fitSigRef.current = fitSig;
    }
  }, [mapReady, courierPosition, destinationPt, pickupPt, courierName, roadRoute, restaurantKey]);

  // ── HUD copy (courier screen only — customers never see turn-by-turn) ──
  const maneuver = navProgress?.maneuver ?? null;
  const weakGps = courierFix?.accuracy != null && courierFix.accuracy > 100;
  const routeStatusText = !courierPosition
    ? 'Locating you…'
    : routeStatus === 'loading'
      ? 'Calculating route…'
      : routeStatus === 'recalculating'
        ? 'Recalculating route…'
        : routeStatus === 'retrying'
          ? 'Unable to calculate route. Retrying…'
          : null;
  const destinationLabel =
    leg?.kind === 'TO_PICKUP'
      ? pickupAddress || 'Restaurant pickup'
      : destinationAddress || 'Customer drop-off';
  const etaAt =
    navProgress && navProgress.remainingSeconds > 0
      ? new Date(Date.now() + navProgress.remainingSeconds * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <div
      className={`relative w-full ${className} rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 z-0`}
    >
      {/* The API owns its container's children, so the map gets a dedicated
          empty div and every overlay below stays a sibling. */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Navigation HUD — courier-only turn-by-turn overlay ──────────── */}
      {showNavigationHud && mapReady && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[900] flex flex-col items-start gap-1.5 p-2">
          {/* Next maneuver, straight from the routing engine's steps */}
          {!navProgress?.arrived && maneuver && (
            <div className="flex max-w-full items-center gap-3 rounded-xl bg-slate-900/90 px-3 py-2 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500 text-white">
                {maneuverIcon(maneuver.step)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black leading-tight">
                  {maneuver.step.instruction}
                </p>
                <p className="truncate text-[11px] text-slate-300">
                  {formatRouteDistance(maneuver.distanceMeters) || '0 m'}
                  {navProgress?.currentRoad ? ` · on ${navProgress.currentRoad}` : ''}
                </p>
              </div>
            </div>
          )}

          {/* Route/GPS lifecycle, so a blank line is never mistaken for a route */}
          {routeStatusText && (
            <span className="w-fit rounded-full bg-amber-100/95 px-2.5 py-1 text-[11px] font-bold text-amber-800 shadow">
              {routeStatusText}
            </span>
          )}
          {weakGps && !routeStatusText && (
            <span className="w-fit rounded-full bg-amber-100/95 px-2.5 py-1 text-[11px] font-bold text-amber-800 shadow">
              GPS signal is weak
            </span>
          )}

          {/* Arrival prompt — it never confirms anything by itself: pickup and
              delivery still go through the existing confirmation/OTP flow. */}
          {navProgress?.arrived && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/95 px-3 py-2 shadow-lg backdrop-blur-sm">
              <p className="text-xs font-black text-emerald-800">You have arrived</p>
              <p className="text-[11px] leading-snug text-emerald-700">
                {leg?.phase === 'TO_RESTAURANT'
                  ? 'At the restaurant — confirm the pickup in your order screen.'
                  : 'At the drop-off — complete the delivery in your order screen.'}
              </p>
            </div>
          )}

          {/* Dev-only diagnostics HUD (spec §40): raw GPS + route telemetry.
              Flows under the cards above it, so it can never collide with the
              Follow button or the modal's guidance panel. */}
          {import.meta.env.DEV && (
            <div className="mt-1 rounded-lg bg-slate-900/85 p-2 font-mono text-[10px] leading-relaxed text-emerald-300 ring-1 ring-emerald-400/30">
              <div>
                phase {leg?.phase ?? '—'} · {routeStatus} · {roadRoute?.provider ?? '—'}
              </div>
              <div>
                gps acc {courierFix?.accuracy != null ? Math.round(courierFix.accuracy) : '—'}m ·
                hdg {courierFix?.heading != null ? Math.round(courierFix.heading) : '—'}° · spd{' '}
                {courierFix?.speed != null ? courierFix.speed.toFixed(1) : '—'}m/s
              </div>
              <div>
                route{' '}
                {roadRoute
                  ? `${roadRoute.geometry.coordinates.length} pts / ${roadRoute.steps.length} steps`
                  : '—'}{' '}
                · off {navProgress?.offRouteMeters ?? 0}m
              </div>
              <div>
                rem {navProgress?.remainingMeters ?? 0}m · {navProgress?.remainingSeconds ?? 0}s ·{' '}
                {navProgress?.arrived ? 'ARRIVED' : 'EN_ROUTE'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom strip: how far/long the rest of this leg is (courier screen) */}
      {showNavigationHud && mapReady && navProgress && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[900] flex items-end justify-between gap-3 border-t border-slate-200/80 bg-white/95 px-3 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {leg?.kind === 'TO_PICKUP' ? 'To pickup' : 'To drop-off'} · {destinationLabel}
            </p>
            <p className="truncate text-sm font-black text-slate-900">
              {formatRouteDistance(navProgress.remainingMeters) || '0 m'}
              {navProgress.remainingSeconds > 0
                ? ` · ${formatRouteDuration(navProgress.remainingSeconds)}`
                : ''}
            </p>
          </div>
          {etaAt && (
            <p className="shrink-0 text-[11px] font-bold text-slate-600">ETA {etaAt}</p>
          )}
        </div>
      )}

      {/* Missing/broken key → say so instead of showing a grey box */}
      {loadError && (
        <div className="absolute inset-0 z-[999] grid place-items-center bg-slate-100 p-5 text-center">
          <div className="max-w-xs space-y-1">
            <p className="text-xs font-black text-slate-700">Map unavailable</p>
            <p className="text-[11px] leading-snug text-slate-500">{loadError}</p>
          </div>
        </div>
      )}

      {/* Camera-follow: shown only after the user drags/zooms away from the rider */}
      {courierPosition && !following && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className={`absolute right-2 z-[1000] flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/95 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-700 shadow-md transition active:scale-95 hover:bg-emerald-50 ${
            showNavigationHud && navProgress ? 'bottom-14' : 'bottom-6'
          }`}
        >
          <LocateFixed className="w-3.5 h-3.5" />
          Follow
        </button>
      )}
    </div>
  );
};
