import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bike } from 'lucide-react';

/**
 * The customer's shortcut into `/errands`. Hidden on the Errands page itself
 * (the page IS the destination), and parked above the mobile bottom nav so it
 * never covers the checkout/cart controls.
 */
export const ErrandsFab: React.FC = () => {
  const location = useLocation();
  if (location.pathname === '/errands') return null;

  return (
    <Link
      to="/errands"
      aria-label="Book an Errand"
      className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-deep text-white shadow-lg transition hover:bg-brand-dark active:scale-95"
    >
      <Bike className="h-6 w-6" aria-hidden="true" />
    </Link>
  );
};

export default ErrandsFab;
