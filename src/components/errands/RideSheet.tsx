import React, { useCallback, useRef } from 'react';

/**
 * The ride-selection bottom sheet: rounded top, drag handle, a scrollable body
 * and a fixed booking footer.
 *
 * Gesture rules (they must never fight the map or the list):
 *  • Only the handle zone captures pointers — the body scrolls normally and
 *    the map underneath keeps every one of its own gestures.
 *  • `touch-action: none` on the handle keeps a vertical drag from being
 *    stolen by the browser's scroll, and the pointer is captured so the drag
 *    survives leaving the bar.
 *  • The resting heights live in CSS (`.sg-sheet` + `data-expanded`), while a
 *    drag writes the height imperatively. React therefore never owns the
 *    value being dragged: an unrelated re-render (a price ticker, a realtime
 *    booking update) cannot snap the sheet back mid-gesture.
 */

/** Resting heights, as a share of the screen container. */
export const SHEET_COLLAPSED_HEIGHT = 0.56;
export const SHEET_EXPANDED_HEIGHT = 0.82;
/** Drag bounds so the sheet can neither swallow the map nor vanish. */
const MIN_HEIGHT = 0.34;
const MAX_HEIGHT = 0.92;
/** Release above this share → expanded; below → collapsed. */
const SNAP_MIDPOINT = (SHEET_COLLAPSED_HEIGHT + SHEET_EXPANDED_HEIGHT) / 2;

export interface RideSheetProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Screen-reader name for the sheet. */
  label: string;
  /** Anything rendered between the handle and the scrollable list. */
  header?: React.ReactNode;
  /** The fixed booking footer (payment, primary action, schedule). */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const RideSheet: React.FC<RideSheetProps> = ({
  expanded,
  onExpandedChange,
  label,
  header,
  footer,
  children,
  className = '',
}) => {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: number; startY: number; startHeight: number; moved: boolean } | null>(
    null
  );
  /** Set when a pointer gesture just resolved, so `click` must not fire too. */
  const suppressClickRef = useRef(false);

  const parentHeight = useCallback(
    () => sheetRef.current?.parentElement?.getBoundingClientRect().height ?? 0,
    []
  );

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressClickRef.current = false;
    dragRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startHeight: sheet.getBoundingClientRect().height,
      moved: false,
    };
    sheet.dataset.dragging = 'true';
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || drag.id !== event.pointerId || !sheet) return;
    const total = sheet.parentElement?.getBoundingClientRect().height ?? 0;
    if (!total) return;

    const delta = drag.startY - event.clientY;
    if (Math.abs(delta) > 4) drag.moved = true;
    const next = Math.min(
      Math.max(drag.startHeight + delta, total * MIN_HEIGHT),
      total * MAX_HEIGHT
    );
    sheet.style.height = `${next}px`;
  }, []);

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      const sheet = sheetRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      dragRef.current = null;
      suppressClickRef.current = drag.moved;
      if (sheet) {
        sheet.dataset.dragging = '';
        const total = sheet.parentElement?.getBoundingClientRect().height ?? 0;
        const released = total ? sheet.getBoundingClientRect().height / total : 0;
        // Hand the height back to CSS; the prop below decides where it lands.
        sheet.style.height = '';
        if (drag.moved) onExpandedChange(released > SNAP_MIDPOINT);
      }
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer already released */
      }
    },
    [onExpandedChange]
  );

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onExpandedChange(!expanded);
  }, [expanded, onExpandedChange]);

  return (
    <div
      ref={sheetRef}
      data-expanded={expanded ? 'true' : 'false'}
      className={`sg-sheet absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-10px_34px_rgba(15,23,42,0.16)] ${className}`}
    >
      {/* Drag handle — the only zone that moves the sheet. */}
      <div className="shrink-0 border-b border-slate-100">
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onClick={handleClick}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse ride options' : 'Expand ride options'}
          className="flex w-full touch-none flex-col items-center gap-1.5 px-4 pb-2 pt-2.5 select-none"
        >
          <span
            className="h-1 w-10 rounded-full bg-slate-300"
            aria-hidden="true"
          />
          <span className="sr-only">{label}</span>
        </button>
        {header}
      </div>

      {/* Scrollable content — never drags the sheet, never chains to the map. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        {children}
      </div>

      {footer && (
        <div className="shrink-0 border-t border-slate-100 bg-white px-4 pb-3 pt-2.5">
          {footer}
        </div>
      )}
    </div>
  );
};

export default RideSheet;
