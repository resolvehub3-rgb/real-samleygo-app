import React, { useEffect } from 'react';
import { CourierLiveMap, type LatLng, type MapRestaurantPin } from '../courier/CourierLiveMap';

export interface NavigationScreenProps {
  /** Rider's live GPS fix (the courier dashboard's watchPosition stream). */
  courierPosition: LatLng | null;
  /** Drop-off pin (customer delivery coordinates). */
  destination: LatLng | null;
  /** Pickup pin (restaurant coordinates). */
  pickup?: LatLng | null;
  /** Order status — decides which leg is driven (pickup vs. delivery). */
  status?: string;
  pickupAddress?: string;
  destinationAddress?: string;
  /** Other kitchens drawn as smaller secondary pins. */
  restaurants?: MapRestaurantPin[];
  courierName?: string;
  /** Order this trip belongs to — recorded on incident reports. */
  orderId?: string | null;
  /** Latest GPS telemetry (accuracy / heading / speed / timestamp). */
  courierFix?: {
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
    timestamp?: number | null;
  } | null;
  /** Leave navigation (✕, Escape, or the arrival card's end button). */
  onExit(): void;
}

/**
 * The full-screen rider view: a dark, tilted, heading-following map with the
 * Google-Maps-style turn-by-turn chrome on top of it.
 *
 * The host owns exactly the things that belong to *being fullscreen* —
 * covering the viewport, respecting the device's safe areas, locking the page
 * behind it, and Escape-to-exit. Everything navigation-related (route, GPS
 * progress, voice, banner, sheets) lives in `CourierLiveMap` + `NavigationChrome`,
 * which is why this component holds no navigation state of its own: the same
 * map instance that draws the line is the one that speaks.
 *
 * It is deliberately NOT a modal in the app's stacking sense — there is no
 * scrim, no card, no close button of its own. It replaces the dashboard's
 * content while it is open, so the rider never sees two maps at once.
 */
export const NavigationScreen: React.FC<NavigationScreenProps> = ({
  courierPosition,
  destination,
  pickup,
  status,
  pickupAddress,
  destinationAddress,
  restaurants,
  courierName,
  orderId = null,
  courierFix,
  onExit,
}) => {
  // Escape leaves navigation — the same path the ✕ button takes, so the
  // session is cancelled exactly once either way.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', handleKeyDown);

    // Lock the page behind the fullscreen view: on a phone a background
    // scroll would otherwise leak through while the map is being panned.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onExit]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Turn-by-turn navigation"
      className="fixed inset-0 z-[1000] bg-nav-ink"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      <CourierLiveMap
        variant="navigation"
        courierPosition={courierPosition}
        destination={destination}
        pickup={pickup}
        status={status}
        pickupAddress={pickupAddress}
        destinationAddress={destinationAddress}
        restaurants={restaurants}
        courierName={courierName}
        courierFix={courierFix}
        orderId={orderId}
        onExitNavigation={onExit}
        showNavigationHud
        flat
        className="h-full w-full"
      />
    </div>
  );
};

export default NavigationScreen;
