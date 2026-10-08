import React from 'react';
import { Link } from 'react-router-dom';
import { Store, Star } from 'lucide-react';
import { Restaurant } from '../../types/database';
import { formatGHS } from '../../lib/pricing';

export interface RestaurantCardProps {
  restaurant: Restaurant;
  /** The platform's real starting delivery fee (platform_settings delivery_pricing). */
  deliveryFrom?: number;
}

/**
 * The customer kitchen card: real cover photo, live open/closed state,
 * rating and the platform's delivery starting fee — every figure comes from
 * the database, none of it is invented per restaurant.
 *
 * Compact horizontal card on phones (image left) and a vertical card from
 * `sm` up, so a list of kitchens stays scannable at 320px.
 * The whole card is one link to the existing menu experience.
 */
export const RestaurantCard: React.FC<RestaurantCardProps> = ({ restaurant, deliveryFrom }) => {
  const isOpen = restaurant.is_open;
  const hasReviews = restaurant.total_reviews > 0 && Number(restaurant.rating) > 0;
  const cover = restaurant.cover_url || restaurant.logo_url;

  return (
    <Link
      to={`/restaurant/${restaurant.id}`}
      className="group flex gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card transition hover:shadow-md active:scale-[0.995] sm:block sm:p-0"
      aria-label={`${restaurant.name} — ${isOpen ? 'open now' : 'closed'}`}
    >
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-brand-deep sm:aspect-[16/10] sm:h-auto sm:w-full sm:rounded-none">
        {cover ? (
          <img
            src={cover}
            alt={restaurant.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center sm:px-4">
            <Store className="h-6 w-6 text-white/70 sm:h-7 sm:w-7" aria-hidden="true" />
            <span className="hidden truncate text-sm font-semibold text-white sm:block">
              {restaurant.name}
            </span>
            <span className="hidden truncate text-[11px] text-emerald-200 sm:block">
              {restaurant.cuisine_type}
            </span>
          </div>
        )}

        {/* Open / closed — a quiet status line, never the loudest thing on the card. */}
        <span
          className={`absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold shadow-xs backdrop-blur-sm sm:left-3 sm:top-3 ${
            isOpen ? 'bg-white/95 text-slate-800' : 'bg-slate-900/85 text-slate-200'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${isOpen ? 'bg-brand' : 'bg-slate-400'}`}
            aria-hidden="true"
          />
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col sm:p-3 lg:p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900 sm:line-clamp-1">
            {restaurant.name}
          </h3>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-700">
            <Star
              className={`h-3.5 w-3.5 ${
                hasReviews ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
              }`}
              aria-hidden="true"
            />
            {hasReviews ? (
              <span className="tabular-nums">{Number(restaurant.rating).toFixed(1)}</span>
            ) : (
              <span className="font-medium text-slate-400">New</span>
            )}
          </span>
        </div>

        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 sm:line-clamp-1">
          {restaurant.cuisine_type} · {restaurant.address}
        </p>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] sm:pt-2.5">
          <span className="text-slate-500">
            {restaurant.total_reviews > 0
              ? `${restaurant.total_reviews} review${restaurant.total_reviews === 1 ? '' : 's'}`
              : 'No reviews yet'}
          </span>
          {typeof deliveryFrom === 'number' && (
            <span className="font-semibold text-brand-dark">
              Delivery from {formatGHS(deliveryFrom)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};
