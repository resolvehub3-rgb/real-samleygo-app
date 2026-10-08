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
 * The customer food card: real photo, then a text block where the dish and
 * kitchen share one 44px link and the "+ Add" control sits beside them,
 * with the price on its own unwrappable line below.
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
      </div>

      <div className="flex flex-1 flex-col p-2.5 sm:p-3">
        {/* Dish + kitchen on the left, the 44px Add control on the right — one
            row, so the control reads as part of the card rather than floating
            over the photo. The photo above links to the same menu. */}
        <div className="flex items-center justify-between gap-2">
          <Link
            to={restaurantPath}
            className="flex min-h-[44px] min-w-0 flex-col justify-center rounded-lg py-0.5 transition hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-brand"
          >
            <h3 className="line-clamp-2 text-[13px] font-semibold leading-[1.35] text-slate-900">
              {dish.name}
            </h3>
            <span className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
              {restaurantName}
            </span>
          </Link>

          {available ? (
            <button
              type="button"
              onClick={(event) => onAdd(event, dish)}
              aria-label={`Add ${dish.name} to cart`}
              className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-brand px-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-dark active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:px-2.5"
            >
              {/* On the narrowest phones the "+" yields its space so the dish name keeps room */}
              <Plus
                className="h-4 w-4 max-[359px]:hidden"
                strokeWidth={2.75}
                aria-hidden="true"
              />
              <span>Add</span>
            </button>
          ) : (
            <span className="flex h-11 shrink-0 items-center rounded-xl bg-slate-100 px-2 text-[11px] font-bold text-slate-400">
              Sold out
            </span>
          )}
        </div>

        {/* The price gets its own line so it stays on one line at 320px too */}
        <div className="mt-auto pt-2">
          <span className="whitespace-nowrap text-[13px] font-bold tabular-nums text-slate-900 sm:text-sm">
            {formatGHS(dish.price)}
          </span>
        </div>
      </div>
    </article>
  );
};
