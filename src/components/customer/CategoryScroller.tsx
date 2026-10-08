import React, { useEffect, useRef } from 'react';
import { FoodCategory } from '../../lib/categories';

export interface CategoryScrollerProps {
  categories: FoodCategory[];
  value: string;
  onChange: (name: string) => void;
}

/**
 * Horizontally scrollable category filter that sits directly under the
 * discovery/search area.
 *
 * The row scrolls with the native touch momentum of the device and hides its
 * scrollbar (`.no-scrollbar`), so it behaves like a native app strip on
 * Android. Selection actually filters the feed — see `executeRealtimeSearch`
 * in the home screen.
 */
export const CategoryScroller: React.FC<CategoryScrollerProps> = ({
  categories,
  value,
  onChange,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  // Keep the active chip in view horizontally when it changes (never scrolls
  // the page itself — only the chip strip).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const active = list.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    const target =
      active.offsetLeft - list.clientWidth / 2 + active.offsetWidth / 2;
    list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [value]);

  return (
    <nav aria-label="Food categories" className="border-b border-slate-200/70 bg-canvas">
      <div
        ref={listRef}
        className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 py-3 sm:px-6 lg:px-8"
      >
        {categories.map((category) => {
          const isActive = value === category.name;
          return (
            <button
              key={category.name}
              type="button"
              data-active={isActive}
              aria-pressed={isActive}
              onClick={() => onChange(category.name)}
              className={`h-11 flex-shrink-0 whitespace-nowrap rounded-xl px-4 text-[13px] font-semibold transition active:scale-95 ${
                isActive
                  ? 'bg-brand text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {category.name}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
