import React from 'react';
import { Minus, Plus, UtensilsCrossed } from 'lucide-react';

import {
  AddonCatalogShape,
  AddonSelection,
  MealAddonGroup,
  describeGroupHint,
  effectiveGroupMax,
  mealAddonView,
} from '../../lib/addons';
import type { MenuAddon, MenuItem } from '../../types/database';
import { formatGHS } from '../../lib/pricing';

interface MealExtrasPickerProps {
  menuItem: MenuItem;
  catalog: AddonCatalogShape;
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
  /** The blocking reason the selection is not legal yet, if any. */
  error?: string | null;
}

/**
 * The "Add extras" / "Make it a combo" section of the meal sheet.
 *
 * Every number on screen comes straight from `menu_addons` — a restaurant that
 * configured nothing simply does not render this component, and a meal the
 * restaurant scoped to other dishes shows no extras at all. Sold-out extras are
 * still listed, disabled, with their status, so the customer is told rather
 * than left wondering where the option went.
 */
export const MealExtrasPicker: React.FC<MealExtrasPickerProps> = ({
  menuItem,
  catalog,
  selection,
  onChange,
  error,
}) => {
  const { mealAddons, groups, loose } = mealAddonView(menuItem, catalog);

  if (mealAddons.length === 0) return null;

  const hasRequiredGroup = groups.some((entry) => entry.group.is_required);
  const showComboTitle = hasRequiredGroup;
  const showPlainTitle = groups.length === 0;
  const showLooseTitle = groups.length > 0;

  const qtyOf = (addon: MenuAddon): number => {
    const value = selection[addon.id];
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };

  /** Cap for one option: its own limit, tightened by a single-choice group. */
  const capFor = (addon: MenuAddon, group: MealAddonGroup | null): number => {
    if (group && effectiveGroupMax(group.group) === 1) return 1;
    return addon.max_quantity;
  };

  const setQty = (
    addon: MenuAddon,
    group: MealAddonGroup | null,
    quantity: number
  ): void => {
    const next: AddonSelection = { ...selection };
    const clamped = Math.max(0, Math.min(quantity, capFor(addon, group)));

    if (clamped === 0) delete next[addon.id];
    else next[addon.id] = clamped;

    // "Choose a drink" with a maximum of one behaves like a radio group:
    // picking another option replaces the current one instead of failing later.
    if (group && effectiveGroupMax(group.group) === 1 && clamped > 0) {
      for (const option of group.options) {
        if (option.id !== addon.id) delete next[option.id];
      }
    }

    onChange(next);
  };

  const OptionRow: React.FC<{ addon: MenuAddon; group: MealAddonGroup | null }> = ({
    addon,
    group,
  }) => {
    const quantity = qtyOf(addon);
    const available = addon.is_available && !addon.is_archived;
    const cap = capFor(addon, group);
    const isMaxed = quantity >= cap;

    return (
      <div
        className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
          quantity > 0
            ? 'border-emerald-500 bg-emerald-50/50'
            : 'border-slate-200 bg-white'
        } ${available ? '' : 'opacity-70'}`}
      >
        <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100 flex items-center justify-center">
          {addon.image_url ? (
            <img
              src={addon.image_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <UtensilsCrossed className="h-4.5 w-4.5 text-slate-300" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-bold text-slate-900">{addon.name}</span>
            {!available && (
              <span className="flex-shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-600">
                Unavailable
              </span>
            )}
          </div>
          {addon.description && (
            <p className="truncate text-[11px] leading-snug text-slate-500">{addon.description}</p>
          )}
          <span className="text-xs font-extrabold text-emerald-700">{formatGHS(addon.price)}</span>
        </div>

        {quantity === 0 ? (
          <button
            type="button"
            disabled={!available}
            onClick={() => setQty(addon, group, 1)}
            aria-label={`Add ${addon.name}`}
            className="h-9 flex-shrink-0 rounded-lg border border-emerald-600 px-3 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-50 active:scale-95 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            Add
          </button>
        ) : (
          <div className="flex flex-shrink-0 items-center gap-0.5 rounded-lg border border-emerald-600 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setQty(addon, group, quantity - 1)}
              aria-label={`Remove one ${addon.name}`}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100 active:scale-95"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-5 text-center text-xs font-bold tabular-nums text-slate-900">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQty(addon, group, quantity + 1)}
              disabled={isMaxed}
              aria-label={`Add one ${addon.name}`}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100 active:scale-95 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      {(showComboTitle || showPlainTitle) && (
        <div className="mb-2.5">
          <h4 className="text-xs font-bold text-slate-700">
            {showComboTitle ? 'Make it a combo' : 'Add extras'}
          </h4>
          <p className="text-[10px] text-slate-400">
            {showComboTitle
              ? 'Complete your meal with a drink or a side.'
              : 'Optional — tap to add as many as you like.'}
          </p>
        </div>
      )}

      {groups.map((entry) => (
        <section key={entry.group.id} className="mb-3.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-700">{entry.group.name}</span>
            <span
              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                entry.group.is_required
                  ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {entry.group.is_required ? 'Required · ' : ''}
              {describeGroupHint(entry.group)}
            </span>
          </div>
          {entry.group.description && (
            <p className="mb-1.5 text-[10px] text-slate-400">{entry.group.description}</p>
          )}
          <div className="space-y-2">
            {entry.options.map((addon) => (
              <OptionRow key={addon.id} addon={addon} group={entry} />
            ))}
          </div>
        </section>
      ))}

      {loose.length > 0 && (
        <section>
          {showLooseTitle && (
            <h4 className="mb-2 text-[11px] font-bold text-slate-700">Add extras</h4>
          )}
          <div className="space-y-2">
            {loose.map((addon) => (
              <OptionRow key={addon.id} addon={addon} group={null} />
            ))}
          </div>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold leading-snug text-rose-700"
        >
          {error}
        </p>
      )}
    </div>
  );
};

export default MealExtrasPicker;
