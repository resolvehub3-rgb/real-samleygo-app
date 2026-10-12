import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bike } from 'lucide-react';

/**
 * The customer's shortcut into `/errands`. Hidden on the Errands page itself
 * (the page IS the destination), and parked above the mobile bottom nav so it
 * never covers the checkout/cart controls.
 *
 * Motion (all of it disabled under `prefers-reduced-motion`):
 *   - `animate-fab-in` — one springy overshoot as it lands on the home screen;
 *   - `fab-ring` — a slow attention halo breathing behind the button;
 *   - hover lifts/tilts the button, press squashes it (group-hover / group-active).
 */
export const ErrandsFab: React.FC = () => {
  const location = useLocation();
  if (location.pathname === '/errands') return null;

  return (
    <Link
      to="/errands"
      aria-label="Book an Errand"
      className="group fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 animate-fab-in"
    >
      {/* Attention halo — sits behind the button, never over the icon. */}
      <span aria-hidden="true" className="fab-ring pointer-events-none" />
      <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-brand-deep text-white shadow-lg transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-110 group-hover:bg-brand-dark group-hover:shadow-xl group-active:translate-y-0 group-active:scale-95 motion-safe:group-hover:-rotate-6">
        <Bike className="h-6 w-6" aria-hidden="true" />
      </span>
    </Link>
  );
};

export default ErrandsFab;
