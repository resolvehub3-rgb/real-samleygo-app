import React from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';

/**
 * The floating location bar that sits over the map: close, pickup, direction,
 * destination, add-a-stop.
 *
 * Every label is the customer's REAL text (or an honest placeholder while it
 * is still empty) and truncates with an ellipsis instead of wrapping, so the
 * bar keeps the reference's single-line proportions at any width. Tapping a
 * side opens that side's editor; the close button only navigates back — it
 * never touches a booking.
 */

export interface RideLocationBarProps {
  pickupLabel: string;
  destinationLabel: string;
  onEditPickup: () => void;
  onEditDestination: () => void;
  /** Returns to the previous screen without touching any booking. */
  onClose: () => void;
  /** Adding a stop — wired to an honest "not supported" notice by the page. */
  onAddStop: () => void;
  /** True while the map itself is fullscreen (the bar then floats over it). */
  fixed?: boolean;
  disabled?: boolean;
  className?: string;
}

export const RideLocationBar: React.FC<RideLocationBarProps> = ({
  pickupLabel,
  destinationLabel,
  onEditPickup,
  onEditDestination,
  onClose,
  onAddStop,
  fixed = false,
  disabled = false,
  className = '',
}) => (
  <div
    className={`${
      fixed
        ? 'fixed left-3 right-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[70]'
        : 'absolute left-3 right-3 top-3 z-20'
    } ${className}`}
  >
    <div className="flex items-center gap-1 rounded-2xl border border-slate-200/70 bg-white p-1.5 pl-1 shadow-[0_6px_20px_rgba(15,23,42,0.18)]">
      <button
        type="button"
        onClick={onClose}
        aria-label="Back"
        className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50 active:scale-95"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      <span className="h-6 w-px flex-shrink-0 bg-slate-200" aria-hidden="true" />

      <button
        type="button"
        onClick={onEditPickup}
        disabled={disabled}
        aria-label={`Edit pickup: ${pickupLabel}`}
        title={pickupLabel}
        className="min-w-0 flex-[1.1] rounded-xl px-1.5 py-1 text-left transition hover:bg-slate-50 active:scale-[0.99] disabled:opacity-60"
      >
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full bg-brand ring-2 ring-brand/25"
            aria-hidden="true"
          />
          <span className="truncate text-[13px] font-bold leading-tight text-brand-dark">
            {pickupLabel}
          </span>
        </span>
      </button>

      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />

      <button
        type="button"
        onClick={onEditDestination}
        disabled={disabled}
        aria-label={`Edit destination: ${destinationLabel}`}
        title={destinationLabel}
        className="min-w-0 flex-1 rounded-xl px-1.5 py-1 text-left transition hover:bg-slate-50 active:scale-[0.99] disabled:opacity-60"
      >
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-deep"
            aria-hidden="true"
          />
          <span className="truncate text-[13px] font-bold leading-tight text-slate-800">
            {destinationLabel}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onAddStop}
        disabled={disabled}
        aria-label="Add a stop"
        className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50 active:scale-95 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </div>
);

export default RideLocationBar;
