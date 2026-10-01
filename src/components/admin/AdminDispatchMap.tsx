import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

/** Camera used before any rider or kitchen fix has loaded. */
const ACCRA: L.LatLngExpression = [5.6037, -0.187];

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Marker labels come from user data, so they are escaped before interpolation. */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);

/** White name chip used for live riders (mirrors the operations mockup). */
const courierChipIcon = (label: string) =>
  L.divIcon({
    className: '',
    // The icon box is 0×0, so the chip is translated into place around the point.
    html: `<span style="transform:translate(-50%,-100%);display:inline-flex;align-items:center;gap:5px;white-space:nowrap;background:#ffffff;border:1px solid #e2e8f0;border-radius:9999px;padding:5px 10px;box-shadow:0 4px 12px rgba(15,23,42,.18);font:700 12px/1.1 'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;">🛵 ${escapeHtml(
      label
    )}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

/** Teardrop kitchen pin, same construction as the courier dashboard map. */
const kitchenPinIcon = L.divIcon({
  className: '',
  html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#f59e0b;border:2px solid #ffffff;box-shadow:0 3px 10px rgba(15,23,42,.35);"><span style="transform:rotate(45deg);font-size:14px;line-height:1;">🍳</span></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 28],
});

/**
 * Read-only operations map for the admin console: OpenStreetMap tiles with a
 * rider chip per online courier, a kitchen pin per restaurant and one line per
 * live order. The camera only refits when the *set* of riders/kitchens changes —
 * GPS pings move markers every few seconds and must never wrestle the view away
 * from whoever is dragging the map.
 */
export const AdminDispatchMap: React.FC<AdminDispatchMapProps> = ({
  couriers,
  kitchens,
  routes,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitSignatureRef = useRef('');

  // ── Initialize the map once ───────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: ACCRA,
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false, // page scrolling wins until the map is clicked
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());

    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;
    mapRef.current = map;

    // The panel animates in with the rest of the page, so give Leaflet a beat
    // to measure the container before the first paint of the tiles.
    const invalidateTimer = window.setTimeout(() => map.invalidateSize(), 150);
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);

    return () => {
      window.clearTimeout(invalidateTimer);
      resizeObserver.disconnect();
      map.remove(); // also drops every marker and polyline on the layer
      mapRef.current = null;
      layerRef.current = null;
      fitSignatureRef.current = '';
    };
  }, []);

  // ── Redraw riders, kitchens and live routes whenever data changes ─────
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const bounds: L.LatLngTuple[] = [];

    routes.forEach((route) => {
      if (route.points.length < 2) return;
      L.polyline(
        route.points.map((point) => [point.lat, point.lng] as L.LatLngExpression),
        { color: '#0f766e', weight: 4, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }
      ).addTo(layer);
      route.points.forEach((point) => bounds.push([point.lat, point.lng]));
    });

    kitchens.forEach((kitchen) => {
      L.marker([kitchen.lat, kitchen.lng], {
        icon: kitchenPinIcon,
        title: kitchen.label,
      }).addTo(layer);
      bounds.push([kitchen.lat, kitchen.lng]);
    });

    couriers.forEach((courier) => {
      L.marker([courier.lat, courier.lng], {
        icon: courierChipIcon(courier.label),
        title: courier.label,
        zIndexOffset: 500,
      }).addTo(layer);
      bounds.push([courier.lat, courier.lng]);
    });

    // Refit only when the roster changes (never on a GPS ping).
    const fitSignature = [...couriers.map((c) => c.id), ...kitchens.map((k) => k.id)]
      .sort()
      .join('|');
    if (bounds.length > 0 && fitSignature !== fitSignatureRef.current) {
      fitSignatureRef.current = fitSignature;
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [couriers, kitchens, routes]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div
        ref={containerRef}
        className="h-full w-full"
        role="img"
        aria-label="Live map of couriers, kitchens and active deliveries"
      />

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
