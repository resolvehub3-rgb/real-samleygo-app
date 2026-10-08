import React from 'react';
import { AlertCircle, SearchX, RefreshCw } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* Section headings                                                            */
/* -------------------------------------------------------------------------- */

export const SectionHeading: React.FC<{
  title: string;
  subtitle?: string;
  /** Correctly pluralised count chip, e.g. "12 dishes" / "1 Restaurant". */
  countLabel?: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, countLabel, action }) => (
  <div className="mb-3 flex items-end justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
    {countLabel && (
      <span className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
        {countLabel}
      </span>
    )}
    {action}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Empty / error states                                                        */
/* -------------------------------------------------------------------------- */

const Frame: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => (
  <div className="mx-auto my-2 max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-card">
    {children}
  </div>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <Frame>
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-canvas text-slate-400">
      {icon ?? <SearchX className="h-6 w-6" aria-hidden="true" />}
    </div>
    <h3 className="mt-3 text-[15px] font-bold text-slate-900">{title}</h3>
    <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
    {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
  </Frame>
);

export const ErrorState: React.FC<{
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}> = ({
  title = 'We could not load this just now',
  description = 'Please check your connection and try again.',
  onRetry,
  retryLabel = 'Try again',
}) => (
  <Frame>
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
      <AlertCircle className="h-6 w-6" aria-hidden="true" />
    </div>
    <h3 className="mt-3 text-[15px] font-bold text-slate-900">{title}</h3>
    <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white transition hover:bg-brand-dark active:scale-95"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        {retryLabel}
      </button>
    )}
  </Frame>
);

/* -------------------------------------------------------------------------- */
/* Loading skeletons — shaped like the real cards, never fake food             */
/* -------------------------------------------------------------------------- */

const Shimmer: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-md bg-slate-200/80 ${className}`} />
);

export const FoodCardSkeleton: React.FC = () => (
  <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
    <div className="aspect-[4/3] w-full animate-pulse bg-slate-200/80" />
    <div className="space-y-2 p-2.5 sm:p-3">
      {/* Mirrors the real card: dish + kitchen beside the Add control, price below */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Shimmer className="h-3.5 w-4/5" />
          <Shimmer className="h-3 w-1/2" />
        </div>
        <Shimmer className="h-11 w-11 flex-shrink-0 rounded-xl" />
      </div>
      <Shimmer className="mt-3 h-4 w-2/5" />
    </div>
  </div>
);

export const FoodGridSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {Array.from({ length: count }).map((_, index) => (
      <FoodCardSkeleton key={index} />
    ))}
  </div>
);

export const RestaurantCardSkeleton: React.FC = () => (
  <div className="flex gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card sm:block sm:p-0">
    <div className="h-24 w-24 shrink-0 animate-pulse rounded-xl bg-slate-200/80 sm:aspect-[16/10] sm:h-auto sm:w-full sm:rounded-none" />
    <div className="flex-1 space-y-2 sm:p-3 lg:p-4">
      <Shimmer className="h-4 w-2/3" />
      <Shimmer className="h-3 w-1/2" />
      <Shimmer className="mt-4 h-3 w-full" />
    </div>
  </div>
);

export const RestaurantGridSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: count }).map((_, index) => (
      <RestaurantCardSkeleton key={index} />
    ))}
  </div>
);
