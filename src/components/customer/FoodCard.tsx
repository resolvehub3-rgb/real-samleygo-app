import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, Utensils } from 'lucide-react';
import { MenuItem, Restaurant } from '../../types/database';
import { formatGHS } from '../../lib/pricing';

/** A menu item that has already been joined with its kitchen (Supabase `restaurant:restaurants(*)`). */
export type DishWithRestaurant = MenuItem & { restaurant?: Restaurant };

export interface FoodCardProps {
  dish: DishWithRestaurant;
  /** Add-to-cart handler — the card itself links to the kitchen menu. */
  onAdd: (event: React.MouseEvent, dish: DishWithRestaurant) => void;
}

/**
 * The customer food card: real photo, dish, kitchen, price and a compact
 * 44px "+ Add" control wired to the production cart.
 *
 * The image always renders at 4:3 (`aspect-[4/3]` + `object-cover`) so a
 * card never grows taller than its neighbours because of the photo it got.
 */
export const FoodCard: React.FC<FoodCardProps> = ({ dish, onAdd }) => {
  const restaurant = dish.restaurant;
  const restaurantPath = restaurant ? `/restaurant/${restaurant.id}` : `/restaurant/${dish.restaurant_id}`;
  const restaurantName = restaurant?.name || 'Partner kitchen';
  const available = dish.is_available;

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card transition active:scale-[0.995] hover:shadow-md">
      <div className="relative">
        <Link
          to={restaurantPath}
          className="block aspect-[4/3] w-full overflow-hidden bg-canvas"
          aria-label={`${dish.name} from ${restaurantName}`}
        >
          {dish.image_url ? (
            <img
              src={dish.image_url}
              alt={dish.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#f1efe8] text-emerald-900/25">
              <Utensils className="h-7 w-7" aria-hidden="true" />
            </div>
          )}
        </Link>

        {!available && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55">
            <span className="rounded-md bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-600">
              Sold out
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={(event) => onAdd(event, dish)}
          disabled={!available}
          aria-label={
            available ? `Add ${dish.name} to cart` : `${dish.name} is sold out`
          }
          className={`absolute bottom-2 right-2 flex h-11 min-w-11 items-center gap-1 rounded-xl px-3 text-xs font-bold shadow-md transition active:scale-95 ${
            available
              ? 'bg-brand text-white hover:bg-brand-dark'
              : 'cursor-not-allowed bg-white/95 text-slate-400'
          }`}
        >
          <Plus className="h-4 w-4" strokeWidth={2.75} aria-hidden="true" />
          <span>{available ? 'Add' : 'Sold out'}</span>
        </button>
      </div>

      <div className="flex flex-1 flex-col p-2.5 sm:p-3">
        {/* One 44px target carries the dish + kitchen to the kitchen's menu
            (the photo above links to the same place for thumb-sized tapping). */}
        <Link
          to={restaurantPath}
          className="flex min-h-[44px] flex-col justify-center rounded-lg py-0.5 transition hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-brand"
        >
          <h3 className="line-clamp-2 text-[13px] font-semibold leading-[1.35] text-slate-900">
            {dish.name}
          </h3>
          <span className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
            {restaurantName}
          </span>
        </Link>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="text-sm font-bold tabular-nums text-slate-900">
            {formatGHS(dish.price)}
          </span>
        </div>
      </div>
    </article>
  );
};
