import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
  /** Reports the active leg's road route whenever it changes (or clears). */
  onRouteUpdate?: (route: ActiveRouteInfo | null) => void;
}

// Small inline SVG pin icons so we don't depend on Leaflet's image assets
const makeIcon = (emoji: string, bg: string) =>
  L.divIcon({
    className: '',
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${bg};box-shadow:0 2px 8px rgba(0,0,0,.35);
      border:2px solid white;">
      <span style="transform:rotate(45deg);font-size:15px;line-height:1;">${emoji}</span>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 32],
  });

const courierIcon = makeIcon('🛵', '#059669'); // emerald-600
const destinationIcon = makeIcon('🏠', '#0f172a'); // slate-900
const pickupIcon = makeIcon('🍳', '#f59e0b'); // amber-500

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
/** Re-route when the rider has drifted this far from the road route's origin. */
const REROUTE_DISTANCE_KM = 0.08;
/** …or when this much time passed since the last attempt (with exponential backoff on failure). */
const REROUTE_MIN_INTERVAL_MS = 20_000;
const REROUTE_MAX_BACKOFF_MS = 120_000;

/**
 * Live delivery map showing the courier's real-time position together with the
 * restaurant pickup pin and the customer drop-off pin.
 *
 * - the courier marker glides between GPS pings (requestAnimationFrame)
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
  onRouteUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const courierMarkerRef = useRef<L.Marker | null>(null);
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const corridorPolylineRef = useRef<L.Polyline | null>(null);
  const roadPolylineRef = useRef<L.Polyline | null>(null);
  /** Fit-once guard: pin/courier presence signature the viewport was framed for. */
  const fitSigRef = useRef('');
  /** The marker's current *animated* position (may lag behind the latest ping). */
  const currentLatLngRef = useRef<L.LatLng | null>(null);
  const animFrameRef = useRef<number | null>(null);

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
      currentLatLngRef.current = null;
      fitSigRef.current = '';
    };
  }, []);

  // ── Pins, route lines & animated courier marker ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Cancel any in-flight glide — a new effect run supersedes it
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

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

    /** Glide the marker from its current position to the target. */
    const animateTo = (target: L.LatLng) => {
      const marker = courierMarkerRef.current;
      const start = currentLatLngRef.current ?? target;
      if (!marker) return;

      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }

      const distKm = haversineKm(
        { lat: start.lat, lng: start.lng },
        { lat: target.lat, lng: target.lng }
      );
      // ~0.3s per km of travel, clamped to a natural-feeling window
      const durationMs = Math.min(1800, Math.max(600, distKm * 3000));
      const startMs = performance.now();

      const step = (now: number) => {
        const t = Math.min(1, (now - startMs) / durationMs);
        const lat = start.lat + (target.lat - start.lat) * t;
        const lng = start.lng + (target.lng - start.lng) * t;
        const frameLL = L.latLng(lat, lng);

        currentLatLngRef.current = frameLL;
        marker.setLatLng(frameLL);
        rebuildCorridor(frameLL);
        drawRoadRoute(frameLL);

        animFrameRef.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      animFrameRef.current = requestAnimationFrame(step);
    };

    if (courierPosition) {
      const target = L.latLng(courierPosition.lat, courierPosition.lng);
      const start = currentLatLngRef.current;
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

        const distKm = start
          ? haversineKm({ lat: start.lat, lng: start.lng }, { lat: target.lat, lng: target.lng })
          : Number.POSITIVE_INFINITY;

        if (!start || distKm > SNAP_THRESHOLD_KM) {
          // Huge jump (page refresh, courier reassignment, stale fix) — snap
          currentLatLngRef.current = target;
          courierMarkerRef.current.setLatLng(target);
          rebuildCorridor(target);
          drawRoadRoute(target);
        } else {
          // Normal ping — glide smoothly (keeps both polylines tracking the rider)
          animateTo(target);
        }
      }
    } else {
      // No courier fix yet — still show pickup → destination corridor
      rebuildCorridor(null);
      drawRoadRoute(null);
    }

    // Frame the viewport whenever the set of visible pins changes (never on
    // subsequent GPS pings, so the user's pan/zoom is respected).
    const fitSig = `${courierPosition ? 1 : 0}${pickupPt ? 1 : 0}${destinationPt ? 1 : 0}`;
    if (fitSig !== fitSigRef.current && fitSig !== '000') {
      const points: L.LatLngExpression[] = [];
      if (courierPosition) points.push([courierPosition.lat, courierPosition.lng]);
      if (pickupPt) points.push([pickupPt.lat, pickupPt.lng]);
      if (destinationPt) points.push([destinationPt.lat, destinationPt.lng]);

      if (points.length >= 2) {
        map.fitBounds(L.latLngBounds(points).pad(0.35));
      } else {
        const only = points[0] as [number, number];
        map.setView(only, 14);
      }
      fitSigRef.current = fitSig;
    }
  }, [courierPosition, destinationPt, pickupPt, courierName, roadRoute]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${className} rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 z-0`}
    />
  );
};
