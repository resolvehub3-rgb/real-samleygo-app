import React, { useEffect, useState } from 'react';
import {
  X,
  Navigation,
  EyeOff,
  Store,
  Home,
  Bike,
  Clock,
  Phone,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  CourierLiveMap,
  LatLng,
  ActiveRouteInfo,
  MapRestaurantPin,
} from '../courier/CourierLiveMap';
import { formatRouteDistance, formatRouteDuration, haversineKm } from '../../lib/routing';

export interface LiveDeliveryMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderNumber?: string | number;
  status?: string;
  courierPosition: LatLng | null;
  pickup: LatLng | null;
  pickupName?: string;
  pickupAddress?: string;
  destination: LatLng | null;
  destinationName?: string;
  destinationAddress?: string;
  /** All other restaurants, shown as secondary pins. */
  restaurants?: MapRestaurantPin[];
  courierName?: string;
  courierPhone?: string;
  customerPhone?: string;
  lastPingAgeMinutes?: number | null;
  role?: 'COURIER' | 'CUSTOMER' | 'RESTAURANT';
}

export const LiveDeliveryMapModal: React.FC<LiveDeliveryMapModalProps> = ({
  isOpen,
  onClose,
  orderNumber,
  status = 'ON_THE_WAY',
  courierPosition,
  pickup,
  pickupName = 'Restaurant',
  pickupAddress,
  destination,
  destinationName = 'Customer',
  destinationAddress,
  restaurants,
  courierName = 'Courier',
  courierPhone,
  customerPhone,
  lastPingAgeMinutes,
  role = 'CUSTOMER',
}) => {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Road-route summary (distance + ETA) reported by the map for the leg the
  // courier is actually driving. Must live above the `isOpen` guard so the
  // hook count never changes between renders.
  const [routeInfo, setRouteInfo] = useState<ActiveRouteInfo | null>(null);

  if (!isOpen) return null;

  // Real-time distances
  const distCourierToPickup =
    courierPosition && pickup ? haversineKm(courierPosition, pickup) : null;
  const distCourierToDest =
    courierPosition && destination ? haversineKm(courierPosition, destination) : null;
  const distPickupToDest =
    pickup && destination ? haversineKm(pickup, destination) : null;

  // Determine stage and description
  const isMovingToRestaurant =
    status === 'COURIER_ASSIGNED' || status === 'COURIER_ACCEPTED';
  const isMovingToCustomer =
    status === 'PICKED_UP' || status === 'ON_THE_WAY' || status === 'ARRIVED';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-2 sm:p-4 md:p-6 overflow-y-auto animate-fade-in"
    >
      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <Navigation className="w-5 h-5 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black tracking-tight truncate">
                  Live Map {orderNumber ? `· Order #${orderNumber}` : ''}
                </h2>
                <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Realtime
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Live moves between kitchen, courier, and customer
              </p>
            </div>
          </div>

          {/* Prominent Hide Map Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 border border-white/10 transition shadow-xs"
              title="Hide live map"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Hide Map</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
              title="Close modal"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Real-time 3-Point Location Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 sm:p-4 bg-slate-50 border-b border-slate-200 flex-shrink-0 text-xs">
          {/* Point 1: Restaurant (Where food is) */}
          <div className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-2xs space-y-1">
            <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-amber-600 uppercase tracking-wide">
              <span className="flex items-center gap-1">
                <Store className="w-3.5 h-3.5" />
                Food Location (Kitchen)
              </span>
              {distCourierToPickup !== null && (
                <span className="text-slate-600 font-black">
                  {distCourierToPickup.toFixed(1)} km
                </span>
              )}
            </div>
            <p className="font-extrabold text-slate-900 truncate text-xs">{pickupName}</p>
            {pickupAddress && (
              <p className="text-[11px] text-slate-500 truncate">{pickupAddress}</p>
            )}
            <div className="pt-0.5 text-[10px] font-semibold text-amber-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span>
                {isMovingToRestaurant
                  ? 'Courier traveling here for pickup'
                  : 'Food packed & ready'}
              </span>
            </div>
          </div>

          {/* Point 2: Courier in Motion */}
          <div className="bg-emerald-50/60 rounded-2xl p-3 border border-emerald-200 shadow-2xs space-y-1">
            <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-emerald-700 uppercase tracking-wide">
              <span className="flex items-center gap-1">
                <Bike className="w-3.5 h-3.5" />
                Live Courier Move
              </span>
              {courierPosition && (
                <span className="flex items-center gap-1 text-emerald-800 font-black">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Moving Live
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="font-extrabold text-slate-900 truncate text-xs">{courierName}</p>
              {courierPhone && (
                <a
                  href={`tel:${courierPhone}`}
                  className="text-[11px] text-emerald-700 hover:underline font-bold flex items-center gap-1"
                >
                  <Phone className="w-3 h-3" />
                  Call
                </a>
              )}
            </div>
            <p className="text-[11px] text-emerald-900 font-semibold truncate">
              {isMovingToRestaurant
                ? '🛵 Moving to kitchen for pickup'
                : isMovingToCustomer
                ? '🛵 Moving to customer address'
                : '🛵 Courier dispatched'}
            </p>
            <div className="text-[10px] text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>
                {courierPosition
                  ? lastPingAgeMinutes != null
                    ? lastPingAgeMinutes < 1
                      ? 'Pinged just now'
                      : `Pinged ${lastPingAgeMinutes}m ago`
                    : 'Live GPS connected'
                  : 'Awaiting first GPS fix'}
              </span>
            </div>
          </div>

          {/* Point 3: Customer Destination */}
          <div className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-2xs space-y-1">
            <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-700 uppercase tracking-wide">
              <span className="flex items-center gap-1">
                <Home className="w-3.5 h-3.5 text-slate-600" />
                Customer Drop-off
              </span>
              {distCourierToDest !== null && (
                <span className="text-emerald-700 font-black">
                  {distCourierToDest.toFixed(1)} km away
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="font-extrabold text-slate-900 truncate text-xs">{destinationName}</p>
              {customerPhone && (
                <a
                  href={`tel:${customerPhone}`}
                  className="text-[11px] text-slate-600 hover:underline font-bold flex items-center gap-1"
                >
                  <Phone className="w-3 h-3" />
                  Call
                </a>
              )}
            </div>
            {destinationAddress && (
              <p className="text-[11px] text-slate-500 truncate">{destinationAddress}</p>
            )}
            <div className="pt-0.5 text-[10px] font-semibold text-slate-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-800" />
              <span>
                {status === 'ARRIVED'
                  ? 'Courier arrived at gate'
                  : isMovingToCustomer
                  ? 'Delivery destination'
                  : 'Awaiting courier pickup from kitchen'}
              </span>
            </div>
          </div>
        </div>

        {/* Live Map Area */}
        <div className="relative flex-1 min-h-[360px] sm:min-h-[440px] md:min-h-[480px] bg-slate-100">
          <CourierLiveMap
            courierPosition={courierPosition}
            destination={destination}
            pickup={pickup}
            courierName={courierName}
            status={status}
            pickupAddress={pickupAddress}
            destinationAddress={destinationAddress}
            restaurants={restaurants}
            onRouteUpdate={setRouteInfo}
            className="w-full h-full min-h-[360px] sm:min-h-[440px] md:min-h-[480px] rounded-none border-0"
          />

          {/* Floating Live Guidance Overlay */}
          <div className="absolute bottom-3 left-3 right-3 sm:left-4 sm:right-auto z-10 max-w-sm bg-white/95 backdrop-blur-md rounded-2xl p-3 border border-slate-200/90 shadow-lg text-xs space-y-1">
            <div className="flex items-center justify-between gap-2 font-bold text-slate-900">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>
                  {isMovingToRestaurant
                    ? 'Courier heading to kitchen'
                    : isMovingToCustomer
                    ? 'Food on the way to you'
                    : 'Dispatch in progress'}
                </span>
              </span>
              <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                {status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-tight">
              {courierPosition
                ? isMovingToRestaurant && distCourierToPickup !== null
                  ? `Courier is approximately ${distCourierToPickup.toFixed(1)} km from ${pickupName}.`
                  : distCourierToDest !== null
                  ? `Courier is approximately ${distCourierToDest.toFixed(1)} km from customer drop-off.`
                  : 'Pins and live movement are synchronized in realtime.'
                : 'Connecting to courier GPS device. Pins for restaurant and customer are active.'}
            </p>
            {routeInfo && (
              <div className="flex items-center gap-2 pt-1 border-t border-slate-200/80 text-[11px]">
                <Navigation className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span className="font-bold text-slate-700">
                  {routeInfo.leg === 'TO_PICKUP' ? 'Road route to kitchen' : 'Road route to customer'}
                </span>
                <span className="ml-auto font-black text-emerald-700 whitespace-nowrap">
                  {formatRouteDistance(routeInfo.distanceMeters)} · {formatRouteDuration(routeInfo.durationSeconds)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer with Hide Map button */}
        <div className="px-4 sm:px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="hidden sm:inline">
              Real-time OpenStreetMap &amp; Leaflet tracking
            </span>
            <span className="sm:hidden text-[11px]">Realtime GPS</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition"
          >
            <EyeOff className="w-4 h-4" />
            <span>Hide Map</span>
          </button>
        </div>
      </div>
    </div>
  );
};
