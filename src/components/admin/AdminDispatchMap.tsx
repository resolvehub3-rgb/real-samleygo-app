import React, { useEffect, useRef, useState } from 'react';
import { ACCRA, MAP_ID, fitPoints, loadGoogleMaps } from '../../lib/googleMaps';
import { CHIP_ANCHOR, makeChipContent, makePinContent, pinAnchor } from '../../lib/mapMarkers';

/** A labelled map pin (rider chip or kitchen pin). */
export interface DispatchMapPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

/** One live trip drawn as a polyline: rider → kitchen → customer. */
export interface DispatchMapRoute {
  id: string;
  points: { lat: number; lng: number }[];
}

interface AdminDispatchMapProps {
  /** Riders currently on shift, drawn as white name chips. */
  couriers: DispatchMapPoint[];
  /** Kitchens that have saved coordinates. */
  kitchens: DispatchMapPoint[];
  /** Road-less overview lines for every order still moving. */
  routes: DispatchMapRoute[];
  /** Extra classes for the outer wrapper (the map always fills it). */
  className?: string;
}

/** Kitchen teardrop — same proportions as the courier dashboard's pins. */
const KITCHEN_PIN_SIZE = 30;

/**
 * Read-only operations map for the admin console: Google Maps tiles with a
 * rider chip per online courier, a kitchen pin per restaurant and one line per
 * live order. The camera only refits when the *set* of riders/kitchens changes
 * — GPS pings move markers every few seconds and must never wrestle the view
 * away from whoever is dragging the map.
 */
export const AdminDispatchMap: React.FC<AdminDispatchMapProps> = ({
  couriers,
  kitchens,
  routes,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const fitSignatureRef = useRef('');
  /** Guards the async loader against React StrictMode's double effect. */
  const initStartedRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Initialize the map once ───────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current || initStartedRef.current) return;
    initStartedRef.current = true;

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let invalidateTimer: number | null = null;

    // Page scrolling wins until the map is clicked, then the wheel zooms the
    // map — and hands itself back when the pointer leaves.
    const enableWheel = () => mapRef.current?.setOptions({ scrollwheel: true });
    const disableWheel = () => mapRef.current?.setOptions({ scrollwheel: false });

    loadGoogleMaps()
      .then(() => {
        if (cancelled || mapRef.current || !containerRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
          center: ACCRA,
          zoom: 12,
          mapId: MAP_ID, // Advanced Markers refuse to draw without one
          zoomControl: true,
          scrollwheel: false,
          gestureHandling: 'greedy',
          maxZoom: 19,
        });
        mapRef.current = map;

        container.addEventListener('click', enableWheel);
        container.addEventListener('mouseleave', disableWheel);

        observer = new ResizeObserver(() => {
          const current = mapRef.current;
          if (!current) return;
          google.maps.event.trigger(current, 'resize');
          const centre = current.getCenter();
          if (centre) current.setCenter(centre);
        });
        observer.observe(container);

        // The panel animates in with the rest of the page, so give the API a
        // beat to measure the container before the first paint of the tiles.
        invalidateTimer = window.setTimeout(() => {
          google.maps.event.trigger(map, 'resize');
        }, 150);

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
      if (invalidateTimer !== null) window.clearTimeout(invalidateTimer);
      observer?.disconnect();
      container.removeEventListener('click', enableWheel);
      container.removeEventListener('mouseleave', disableWheel);

      const map = mapRef.current;
      if (map) {
        google.maps.event.clearInstanceListeners(map);
        // There is no `map.remove()` in the Google API: detach what we added
        // and empty the container so a remount starts from a clean slate.
        polylinesRef.current.forEach((line) => line.setMap(null));
        markersRef.current.forEach((marker) => {
          marker.map = null;
        });
        container.replaceChildren();
        mapRef.current = null;
      }
      polylinesRef.current = [];
      markersRef.current = [];
      fitSignatureRef.current = '';
      setMapReady(false);
    };
  }, []);

  // ── Redraw riders, kitchens and live routes whenever data changes ─────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Start from an empty canvas: markers are cheap to rebuild and the old
    // layer group behaved exactly the same way.
    markersRef.current.forEach((marker) => {
      marker.map = null;
    });
    markersRef.current = [];
    polylinesRef.current.forEach((line) => line.setMap(null));
    polylinesRef.current = [];

    const points: google.maps.LatLngLiteral[] = [];

    routes.forEach((route) => {
      if (route.points.length < 2) return;
      const path = route.points.map((point) => ({ lat: point.lat, lng: point.lng }));
      const line = new google.maps.Polyline({
        path,
        strokeColor: '#0f766e',
        strokeOpacity: 0.85,
        strokeWeight: 4,
        zIndex: 1,
      });
      line.setMap(map);
      polylinesRef.current.push(line);
      path.forEach((point) => points.push(point));
    });

    kitchens.forEach((kitchen) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: kitchen.lat, lng: kitchen.lng },
        content: makePinContent('🍳', '#f59e0b', KITCHEN_PIN_SIZE),
        title: kitchen.label,
        zIndex: 500,
        ...pinAnchor(KITCHEN_PIN_SIZE),
      });
      markersRef.current.push(marker);
      points.push({ lat: kitchen.lat, lng: kitchen.lng });
    });

    couriers.forEach((courier) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: courier.lat, lng: courier.lng },
        content: makeChipContent(courier.label),
        title: courier.label,
        zIndex: 900,
        ...CHIP_ANCHOR,
      });
      markersRef.current.push(marker);
      points.push({ lat: courier.lat, lng: courier.lng });
    });

    // Refit only when the roster changes (never on a GPS ping).
    const fitSignature = [...couriers.map((c) => c.id), ...kitchens.map((k) => k.id)]
      .sort()
      .join('|');
    if (points.length > 0 && fitSignature !== fitSignatureRef.current) {
      fitSignatureRef.current = fitSignature;
      fitPoints(map, points, { padding: 40, maxZoom: 14 });
    }
  }, [mapReady, couriers, kitchens, routes]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div
        ref={containerRef}
        className="h-full w-full"
        role="img"
        aria-label="Live map of couriers, kitchens and active deliveries"
      />

      {/* Missing/broken key → say so instead of showing a grey box */}
      {loadError && (
        <div className="absolute inset-0 z-[1000] grid place-items-center bg-slate-100 p-5 text-center">
          <div className="max-w-xs space-y-1">
            <p className="text-xs font-black text-slate-700">Map unavailable</p>
            <p className="text-[11px] leading-snug text-slate-500">{loadError}</p>
          </div>
        </div>
      )}

      {/* Rider legend, stacked the same way as the operations mockup */}
      {couriers.length > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex max-w-[70%] flex-wrap justify-end gap-1.5">
          {couriers.map((courier) => (
            <span
              key={courier.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] font-black text-slate-700 shadow-sm backdrop-blur"
            >
              🛵 {courier.label}
            </span>
          ))}
        </div>
      )}

      {couriers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[1000] grid place-items-center">
          <span className="rounded-full bg-white/95 px-3.5 py-2 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200">
            No riders online right now
          </span>
        </div>
      )}
    </div>
  );
};
