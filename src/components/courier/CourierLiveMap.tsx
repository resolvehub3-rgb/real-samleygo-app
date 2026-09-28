import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface LatLng {
  lat: number;
  lng: number;
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

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // Earth radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Jumps larger than this snap instantly instead of animating (fresh fix / courier reassignment). */
const SNAP_THRESHOLD_KM = 1.5;

/**
 * Live delivery map showing the courier's real-time position along with the
 * restaurant pickup pin and the customer drop-off pin. Powered by Leaflet +
 * free OpenStreetMap tiles (no API key required). The courier glides smoothly
 * between pings via requestAnimationFrame interpolation and the dashed route
 * line stretches continuously with the rider.
 */
export const CourierLiveMap: React.FC<CourierLiveMapProps> = ({
  courierPosition,
  destination,
  pickup,
  courierName,
  className = 'h-64',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const courierMarkerRef = useRef<L.Marker | null>(null);
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const hasFitRef = useRef(false);
  /** The marker's current *animated* position (may lag behind the latest ping). */
  const currentLatLngRef = useRef<L.LatLng | null>(null);
  const animFrameRef = useRef<number | null>(null);

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

    mapRef.current = map;

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      courierMarkerRef.current = null;
      destinationMarkerRef.current = null;
      pickupMarkerRef.current = null;
      routePolylineRef.current = null;
      currentLatLngRef.current = null;
      hasFitRef.current = false;
    };
  }, []);

  // ── Pins, route line & animated courier marker ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Cancel any in-flight glide — a new effect run supersedes it
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Static destination marker
    if (destination && destinationMarkerRef.current === null) {
      destinationMarkerRef.current = L.marker([destination.lat, destination.lng], {
        icon: destinationIcon,
      })
        .addTo(map)
        .bindPopup('Your delivery address');
    }

    // Static pickup marker
    if (pickup && pickupMarkerRef.current === null) {
      pickupMarkerRef.current = L.marker([pickup.lat, pickup.lng], { icon: pickupIcon })
        .addTo(map)
        .bindPopup('Restaurant pickup');
    }

    /** Rebuild/refresh the dashed route line pickup → courier → destination. */
    const rebuildRoute = (courierLL: L.LatLng | null) => {
      const points: L.LatLngExpression[] = [];
      if (pickup) points.push([pickup.lat, pickup.lng]);
      if (courierLL) points.push([courierLL.lat, courierLL.lng]);
      if (destination) points.push([destination.lat, destination.lng]);

      if (points.length >= 2) {
        if (routePolylineRef.current) {
          routePolylineRef.current.setLatLngs(points);
        } else {
          routePolylineRef.current = L.polyline(points, {
            color: '#059669',
            weight: 3,
            opacity: 0.85,
            dashArray: '8 8',
            lineCap: 'round',
          }).addTo(map);
        }
      } else if (routePolylineRef.current) {
        map.removeLayer(routePolylineRef.current);
        routePolylineRef.current = null;
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
        rebuildRoute(frameLL);

        animFrameRef.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      animFrameRef.current = requestAnimationFrame(step);
    };

    if (courierPosition) {
      const target = L.latLng(courierPosition.lat, courierPosition.lng);
      const start = currentLatLngRef.current;

      if (!courierMarkerRef.current) {
        // First fix — place the marker directly (no glide from nowhere)
        courierMarkerRef.current = L.marker(target, { icon: courierIcon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup(courierName ? `${courierName} is here` : 'Your courier is here');
        currentLatLngRef.current = target;
        rebuildRoute(target);
      } else {
        const distKm = start
          ? haversineKm({ lat: start.lat, lng: start.lng }, { lat: target.lat, lng: target.lng })
          : Number.POSITIVE_INFINITY;

        if (!start || distKm > SNAP_THRESHOLD_KM) {
          // Huge jump (page refresh, courier reassignment, stale fix) — snap
          currentLatLngRef.current = target;
          courierMarkerRef.current.setLatLng(target);
          rebuildRoute(target);
        } else {
          // Normal ping — glide smoothly
          animateTo(target);
        }
      }

      // Fit bounds once, when we first have courier + destination
      if (!hasFitRef.current && destination) {
        const points: L.LatLngExpression[] = [
          [courierPosition.lat, courierPosition.lng],
          [destination.lat, destination.lng],
        ];
        if (pickup) points.push([pickup.lat, pickup.lng]);
        map.fitBounds(L.latLngBounds(points).pad(0.35));
        hasFitRef.current = true;
      }
    } else {
      // No courier fix yet — still show pickup → destination corridor
      rebuildRoute(null);

      if (destination && !hasFitRef.current) {
        map.setView([destination.lat, destination.lng], 14);
        hasFitRef.current = true;
      }
    }
  }, [courierPosition, destination, pickup, courierName]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${className} rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 z-0`}
    />
  );
};
