import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  Bike,
  Car,
  ChartColumn,
  CheckCircle,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCheck,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Map as MapIcon,
  MapPin,
  Menu,
  Package,
  Percent,
  Phone,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Star,
  Store,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  Restaurant,
  Courier,
  CourierDocument,
  CourierVerificationStatus,
  Order,
  OrderStatus,
  OrderSettlementAdjustment,
  SettlementStatus,
  CommissionSettings,
  PlatformPricingSettings,
  AuditLog,
} from '../../types/database';
import {
  aggregateDeliveryStats,
  calculateDeliveryFee,
  formatGHS,
  DEFAULT_PRICING,
} from '../../lib/pricing';
import {
  aggregateFinancials,
  getOrderFinancials,
  validateCommissionPercentage,
  round2,
  DEFAULT_COMMISSION_SETTINGS,
  MAX_RESTAURANT_COMMISSION_PERCENTAGE,
} from '../../lib/commission';
import { VERIFICATION_META } from '../../lib/verification';
import {
  ACTIVE_ERRANDS_STATUSES,
  ERRANDS_SERVICE_LABELS,
  ERRANDS_STATUS_LABELS,
  canTransition,
  type ErrandsBooking,
  type ErrandsBookingDetails,
  type ErrandsBookingStatus,
  type ErrandsConfig,
  type ErrandsDriverCapability,
  type ErrandsPricingSettings,
} from '../../lib/errands/types';
import { calculateErrandsFare, ERRANDS_PRICING_UNCONFIGURED_MESSAGE } from '../../lib/errands/pricing';
import {
  fetchErrandsConfig,
  fetchErrandsPricingSettings,
  parseConfig,
  parsePricingSettings,
} from '../../lib/errands/config';
import { parseBooking, setErrandsBookingStatus } from '../../lib/errands/booking';
import { DocumentImage } from '../../components/common/DocumentImage';
import { AdminDispatchMap } from '../../components/admin/AdminDispatchMap';
import type { LucideIcon } from 'lucide-react';

/** Sections of the super-admin console. Also drives the sidebar. */
type AdminTab =
  | 'OVERVIEW'
  | 'RESTAURANTS'
  | 'COURIERS'
  | 'ORDERS'
  | 'ERRANDS'
  | 'SETTINGS'
  | 'AUDIT';

interface AdminNavItem {
  key: AdminTab;
  label: string;
  icon: LucideIcon;
  /** Live badge shown next to the label; omit for sections without a count. */
  count?: number;
}

/** Every valid `?tab=` value, used for URL sync and validation. */
const TAB_KEYS: AdminTab[] = [
  'OVERVIEW',
  'RESTAURANTS',
  'COURIERS',
  'ORDERS',
  'ERRANDS',
  'SETTINGS',
  'AUDIT',
];

/**
 * Sidebar label to restore when a section is opened from the URL (deep link,
 * refresh, back/forward) instead of by clicking the row. "Earnings" and
 * "Dashboard" both live on the overview, so the highlight is label-driven.
 */
const DEFAULT_NAV_LABEL: Record<AdminTab, string> = {
  OVERVIEW: 'Dashboard',
  RESTAURANTS: 'Kitchen Queue',
  COURIERS: 'Courier Map',
  ORDERS: 'Dispatch',
  ERRANDS: 'Errands & Rides',
  SETTINGS: 'Settings',
  AUDIT: 'Analytics',
};

/** Status dropdown options offered by the live kitchen queue panel. */
type QueueStatusFilter = 'ALL' | 'PREPARING' | 'READY_FOR_PICKUP' | 'ON_THE_WAY';

/** Statuses that mean an order is no longer moving through the pipeline. */
const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  'COMPLETED',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
];

const isActiveOrder = (status: OrderStatus): boolean =>
  !TERMINAL_ORDER_STATUSES.includes(status);

/** A typo'd or outdated `?tab=` falls back to the overview instead of a blank console. */
const isTabKey = (value: string | null): value is AdminTab =>
  !!value && (TAB_KEYS as string[]).includes(value);

/** Shared card surface so every section reads as one design system. */
const CARD =
  'bg-white rounded-3xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.05)]';

const STAT_TONE = {
  emerald: {
    tile: 'bg-emerald-50 text-emerald-600 ring-emerald-500/15',
    bar: 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500',
    blob: 'bg-emerald-500/10 group-hover:bg-emerald-500/20',
    fill: 'bg-emerald-500',
    tint: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20',
  },
  amber: {
    tile: 'bg-amber-50 text-amber-600 ring-amber-500/15',
    bar: 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500',
    blob: 'bg-amber-500/10 group-hover:bg-amber-500/20',
    fill: 'bg-amber-500',
    tint: 'bg-amber-50 text-amber-700 ring-amber-500/20',
  },
  sky: {
    tile: 'bg-sky-50 text-sky-600 ring-sky-500/15',
    bar: 'bg-gradient-to-r from-sky-400 via-sky-500 to-cyan-500',
    blob: 'bg-sky-500/10 group-hover:bg-sky-500/20',
    fill: 'bg-sky-500',
    tint: 'bg-sky-50 text-sky-700 ring-sky-500/20',
  },
  violet: {
    tile: 'bg-violet-50 text-violet-600 ring-violet-500/15',
    bar: 'bg-gradient-to-r from-violet-400 via-violet-500 to-fuchsia-500',
    blob: 'bg-violet-500/10 group-hover:bg-violet-500/20',
    fill: 'bg-violet-500',
    tint: 'bg-violet-50 text-violet-700 ring-violet-500/20',
  },
  rose: {
    tile: 'bg-rose-50 text-rose-600 ring-rose-500/15',
    bar: 'bg-gradient-to-r from-rose-400 via-rose-500 to-pink-500',
    blob: 'bg-rose-500/10 group-hover:bg-rose-500/20',
    fill: 'bg-rose-500',
    tint: 'bg-rose-50 text-rose-700 ring-rose-500/20',
  },
} as const;

type StatTone = keyof typeof STAT_TONE;

const INPUT_CLASS =
  'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 tabular-nums transition focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20';

/**
 * Row accent + stacked status badge used by the Live Kitchen Order Queue.
 * `minutes` is how long the order has been in this state (shown as "– 14m").
 */
const queueBadge = (
  status: OrderStatus,
  minutes: number
): { accent: string; title: string; titleClass: string; pill: string; dot: string; label: string } => {
  switch (status) {
    case 'READY_FOR_PICKUP':
      return {
        accent: 'bg-emerald-500',
        title: 'Ready for pickup',
        titleClass: 'text-emerald-700',
        pill: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20',
        dot: 'bg-emerald-500',
        label: 'Ready for Pickup',
      };
    case 'RESTAURANT_ACCEPTED':
    case 'PREPARING':
      return {
        accent: 'bg-amber-500',
        title: 'Preparing',
        titleClass: 'text-amber-700',
        pill: 'bg-amber-50 text-amber-700 ring-amber-500/25',
        dot: 'bg-amber-500',
        label: `Preparing – ${minutes}m`,
      };
    case 'PENDING_PAYMENT':
    case 'PAID':
    case 'RESTAURANT_PENDING':
      return {
        accent: 'bg-amber-400',
        title: 'In queue',
        titleClass: 'text-amber-700',
        pill: 'bg-amber-50 text-amber-700 ring-amber-500/25',
        dot: 'bg-amber-400',
        label: 'Waiting for kitchen',
      };
    case 'COURIER_ASSIGNED':
    case 'COURIER_ACCEPTED':
    case 'PICKED_UP':
    case 'ON_THE_WAY':
    case 'ARRIVED':
      return {
        accent: 'bg-sky-500',
        title: 'On the way',
        titleClass: 'text-sky-700',
        pill: 'bg-sky-50 text-sky-700 ring-sky-500/20',
        dot: 'bg-sky-500',
        label: 'On the Way',
      };
    case 'DELIVERED':
    case 'COMPLETED':
      return {
        accent: 'bg-emerald-400',
        title: 'Delivered',
        titleClass: 'text-emerald-700',
        pill: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20',
        dot: 'bg-emerald-400',
        label: 'Delivered',
      };
    default:
      return {
        accent: 'bg-rose-500',
        title: 'Cancelled',
        titleClass: 'text-rose-700',
        pill: 'bg-rose-50 text-rose-700 ring-rose-500/20',
        dot: 'bg-rose-500',
        label: 'Cancelled',
      };
  }
};

/** "12 mins ago" wording used by the kitchen queue (mockup phrasing). */
const formatQueueTime = (iso: string): string => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/** "Ab Cam" style monogram used when an avatar image is not available. */
const monogram = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '–';

/** Compact "3m ago" / "12 Feb" timestamp used across the console lists. */
const formatRelativeTime = (iso: string): string => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

interface ListToolbarProps<T extends string> {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  filters: { key: T; label: string; count: number }[];
  activeKey: T;
  onFilterChange: (key: T) => void;
}

/** Search field + segmented status filters shared by the tabular sections. */
function ListToolbar<T extends string>({
  query,
  onQueryChange,
  placeholder,
  ariaLabel,
  filters,
  activeKey,
  onFilterChange,
}: ListToolbarProps<T>) {
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs font-bold text-slate-900 transition placeholder:font-medium placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const isActive = activeKey === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilterChange(f.key)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {f.label}
              <span className={`tabular-nums ${isActive ? 'text-white/60' : 'text-slate-400'}`}>
                {f.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SectionCardProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const SectionCard: React.FC<SectionCardProps> = ({
  title,
  subtitle,
  action,
  children,
  className = '',
}) => (
  <section className={`${CARD} p-5 sm:p-6 ${className}`}>
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-black tracking-tight text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </header>
    {children}
  </section>
);

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, hint, action }) => (
  <div className="flex flex-col items-center py-12 text-center">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
      <Icon className="w-5 h-5" />
    </span>
    <p className="mt-3 text-sm font-bold text-slate-700">{title}</p>
    {hint && <p className="mt-1 max-w-sm text-xs text-slate-400">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

interface SummaryTileProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: StatTone;
}

/** Compact metric tile used above tabular sections (restaurants, couriers). */
const SummaryTile: React.FC<SummaryTileProps> = ({ label, value, icon: Icon, tone }) => {
  const t = STAT_TONE[tone];
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${t.tile}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-black leading-none tabular-nums text-slate-900">
          {value}
        </span>
        <span className="mt-1.5 block truncate text-[10px] font-black uppercase tracking-wider text-slate-400">
          {label}
        </span>
      </span>
    </div>
  );
};

interface OpsStatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Hover definition — real numbers only make sense with a plain-English gloss. */
  hint?: string;
  /** Makes the whole card a shortcut to the section behind the number. */
  onClick?: () => void;
}

/**
 * Flat KPI tile from the operations mockup: label, big value and a round teal
 * icon. Deliberately free of progress bars and captions — the four overview
 * numbers have to be readable in a single glance.
 */
const OpsStatCard: React.FC<OpsStatCardProps> = ({ label, value, icon: Icon, hint, onClick }) => {
  const body = (
    <>
      {/* Row 1: label left, round teal icon right — like the mockup. */}
      <span className="flex w-full items-center justify-between gap-3">
        <span className="min-w-0 text-xs font-bold leading-snug text-slate-600 sm:text-sm">{label}</span>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-600 ring-1 ring-teal-500/15 transition duration-200 group-hover:scale-110">
          <Icon className="h-5 w-5" />
        </span>
      </span>
      {/* Row 2: the value spans the full card width. The font scales with the
          card (container query) so four KPIs still fit one row on ~1024px
          screens instead of breaking the mockup's single-line numbers. */}
      <span className="block text-[clamp(18px,10.5cqw,30px)] font-black leading-none tabular-nums tracking-tight text-slate-900">
        {value}
      </span>
    </>
  );

  const baseClass = `group @container flex w-full flex-col gap-3 overflow-hidden p-4 text-left xl:p-5 ${CARD} transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60`;

  // Interactive cards are real buttons so keyboard and screen-reader users get
  // the same shortcut as mouse users.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={hint} className={baseClass}>
        {body}
      </button>
    );
  }

  return (
    <div className={baseClass} title={hint}>
      {body}
    </div>
  );
};

const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />
);

/** Shown while the first dashboard query round-trip is still in flight. */
const DashboardSkeleton = () => (
  <div className="space-y-6" role="status" aria-label="Loading dashboard data">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`${CARD} space-y-3 p-5`}>
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-7 w-32" />
          <SkeletonBlock className="h-3 w-40" />
        </div>
      ))}
    </div>
    <div className={`${CARD} space-y-4 p-6`}>
      <SkeletonBlock className="h-4 w-44" />
      <SkeletonBlock className="h-3 w-full" />
      <SkeletonBlock className="h-3 w-5/6" />
      <SkeletonBlock className="h-3 w-2/3" />
    </div>
    <span className="sr-only">Loading dashboard…</span>
  </div>
);

/** Distance used by the pricing preview panel. */
const SAMPLE_DISTANCE_KM = 5;

/** ---- Errands & On-Demand Rides — console helpers ------------------------- */

const errandsStatusStyle = (status: ErrandsBookingStatus): string => {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/20';
    case 'CANCELLED':
    case 'FAILED':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-500/20';
    case 'EXPIRED':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-500/25';
    default:
      return 'bg-sky-50 text-sky-700 ring-1 ring-sky-500/20';
  }
};

const errandsStatusDot = (status: ErrandsBookingStatus): string => {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-500';
    case 'CANCELLED':
    case 'FAILED':
      return 'bg-rose-500';
    case 'EXPIRED':
      return 'bg-amber-500';
    default:
      return 'bg-sky-500';
  }
};

const errandsStatusIsLive = (status: ErrandsBookingStatus): boolean =>
  ACTIVE_ERRANDS_STATUSES.includes(status);

interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: React.ReactNode;
}

/** On/off switch used by the Errands operator and driver-capability toggles. */
const Switch: React.FC<SwitchProps> = ({ id, checked, onChange, disabled, label, hint }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <label htmlFor={id} className="block text-[13px] font-black text-slate-900">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-emerald-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  </div>
);

/** Fare-rules form draft — kept as strings so an optional field can be empty. */
interface ErrandsPricingDraft {
  baseFare: string;
  perKmRate: string;
  minFare: string;
  maxFare: string;
  bookingFee: string;
  taxRatePercent: string;
  driverEarningPercentage: string;
  surgeMultiplier: string;
}

interface ErrandsPricingDraftValues {
  baseFare: number;
  perKmRate: number;
  minFare: number;
  /** `null` = no ceiling. */
  maxFare: number | null;
  bookingFee: number;
  taxRatePercent: number;
  driverEarningPercentage: number;
  surgeMultiplier: number;
}

/**
 * Mirrors the bounds enforced by `set_errands_pricing()` in the database, so
 * the admin gets a fast, friendly message; the database validates again and
 * remains the authority (its sentences are shown verbatim on failure).
 */
const parseErrandsPricingDraft = (
  draft: ErrandsPricingDraft
): { ok: true; values: ErrandsPricingDraftValues } | { ok: false; error: string } => {
  const read = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const base = read(draft.baseFare);
  if (base === null || base < 0 || base > 9999.99) {
    return { ok: false, error: 'Base fare must be a number between 0 and 9999.99.' };
  }
  const perKm = read(draft.perKmRate);
  if (perKm === null || perKm < 0 || perKm > 9999.99) {
    return { ok: false, error: 'Price per kilometre must be a number between 0 and 9999.99.' };
  }
  const min = read(draft.minFare);
  if (min === null || min < 0 || min > 999999.99) {
    return { ok: false, error: 'Minimum fare must be a number between 0 and 999999.99.' };
  }
  let max: number | null = null;
  if (draft.maxFare.trim() !== '') {
    max = read(draft.maxFare);
    if (max === null || max < 0 || max > 999999.99) {
      return {
        ok: false,
        error: 'Maximum fare must be empty (no cap) or a number between 0 and 999999.99.',
      };
    }
    if (max < min) {
      return { ok: false, error: 'The maximum fare cannot be lower than the minimum fare.' };
    }
  }
  const fee = read(draft.bookingFee);
  if (fee === null || fee < 0 || fee > 9999.99) {
    return { ok: false, error: 'Booking fee must be a number between 0 and 9999.99.' };
  }
  const tax = read(draft.taxRatePercent);
  if (tax === null || tax < 0 || tax > 100) {
    return { ok: false, error: 'Tax rate must be between 0 and 100 percent.' };
  }
  const earning = read(draft.driverEarningPercentage);
  if (earning === null || earning < 0 || earning > 100) {
    return { ok: false, error: 'Driver earning percentage must be between 0 and 100.' };
  }
  const surge = read(draft.surgeMultiplier);
  if (surge === null || surge < 0.1 || surge > 5) {
    return {
      ok: false,
      error:
        'Surge multiplier must be between 0.1 and 5 (use 1 when surge pricing is not in effect).',
    };
  }
  return {
    ok: true,
    values: {
      baseFare: base,
      perKmRate: perKm,
      minFare: min,
      maxFare: max,
      bookingFee: fee,
      taxRatePercent: tax,
      driverEarningPercentage: earning,
      surgeMultiplier: surge,
    },
  };
};

const asNullableNum = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** `errands_booking_details` row → the shape the console renders. */
const parseErrandsDetailsRow = (raw: unknown): ErrandsBookingDetails | null => {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    pickupLatitude: asNullableNum(row.pickup_latitude),
    pickupLongitude: asNullableNum(row.pickup_longitude),
    pickupAddress: asText(row.pickup_address),
    destinationLatitude: asNullableNum(row.destination_latitude),
    destinationLongitude: asNullableNum(row.destination_longitude),
    destinationAddress: asText(row.destination_address),
    customerName: asText(row.customer_name),
    customerPhone: asText(row.customer_phone),
    driverName: asText(row.driver_name),
    driverAvatarUrl: asText(row.driver_avatar_url),
    driverVehicleType: asText(row.driver_vehicle_type),
    driverVehiclePlate: asText(row.driver_vehicle_plate),
    driverRating: asNullableNum(row.driver_rating),
  };
};

interface ErrandsHistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
  actor?: { full_name?: string | null; role?: string | null } | null;
}

/** `errands_status_history` rows, oldest first (the audit order). */
const parseErrandsHistoryRows = (raw: unknown): ErrandsHistoryEntry[] => {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((row) => typeof row?.id === 'string')
    .map((row) => ({
      id: String(row.id),
      from_status: asText(row.from_status),
      to_status: String(row.to_status ?? ''),
      note: asText(row.note),
      created_at: String(row.created_at ?? ''),
      actor: (row.actor ?? null) as ErrandsHistoryEntry['actor'],
    }));
};

/** Short form of an ID for the console lists (full value stays in titles). */
const shortId = (value: string | null | undefined): string =>
  value ? value.slice(0, 8) : '—';

export const AdminDashboard: React.FC = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  // The active section lives in the URL (`?tab=couriers`) so refresh, deep
  // links and the browser back/forward buttons all behave like real navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: AdminTab = isTabKey(tabParam) ? tabParam : 'OVERVIEW';

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [courierDocs, setCourierDocs] = useState<CourierDocument[]>([]);
  const [expandedCourierId, setExpandedCourierId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pricingSettings, setPricingSettings] = useState<PlatformPricingSettings>(DEFAULT_PRICING);
  // Refund / settlement adjustments on any order (append-only ledger).
  const [adjustments, setAdjustments] = useState<OrderSettlementAdjustment[]>([]);
  // Marketplace commission rules (platform_settings key `commission`).
  const [commissionSettings, setCommissionSettings] = useState<CommissionSettings>(
    DEFAULT_COMMISSION_SETTINGS
  );
  const [commissionDraft, setCommissionDraft] = useState<string>(
    String(DEFAULT_COMMISSION_SETTINGS.restaurant_commission_percentage)
  );
  const [commissionError, setCommissionError] = useState('');
  const [commissionConfirm, setCommissionConfirm] = useState<number | null>(null);
  const [isSavingCommission, setIsSavingCommission] = useState(false);

  // ---- Errands & On-Demand Rides (super admin console) ----
  // Bookings are fetched newest-first (latest 200) and every metric on the
  // tab is computed from those real rows — nothing here is a placeholder.
  const [errandsBookings, setErrandsBookings] = useState<ErrandsBooking[]>([]);
  const [errandsCapabilities, setErrandsCapabilities] = useState<ErrandsDriverCapability[]>([]);
  const [errandsConfig, setErrandsConfig] = useState<ErrandsConfig | null>(null);
  const [errandsPricing, setErrandsPricing] = useState<ErrandsPricingSettings | null>(null);
  const [isErrandsLoading, setIsErrandsLoading] = useState(true);

  // Service switches (module enabled + per-category), saved via set_errands_config.
  const [errandsConfigDraft, setErrandsConfigDraft] = useState({
    enabled: true,
    motorcycle: true,
    rideCar: false,
  });
  const [isSavingErrandsConfig, setIsSavingErrandsConfig] = useState(false);

  // Fare rules draft, saved via set_errands_pricing (the ONLY write path).
  const [errandsPricingDraft, setErrandsPricingDraft] = useState<ErrandsPricingDraft>({
    baseFare: '',
    perKmRate: '',
    minFare: '',
    maxFare: '',
    bookingFee: '',
    taxRatePercent: '',
    driverEarningPercentage: '',
    surgeMultiplier: '',
  });
  const [errandsPricingFormError, setErrandsPricingFormError] = useState('');
  const [isSavingErrandsPricing, setIsSavingErrandsPricing] = useState(false);
  // Admin-only preview distance (never a customer price — see pricing.ts).
  const [errandsPreviewKmInput, setErrandsPreviewKmInput] = useState(
    String(SAMPLE_DISTANCE_KM)
  );

  // Bookings: text search, status filter and the lazily-loaded expand row.
  const [errandsQuery, setErrandsQuery] = useState('');
  const [errandsStatusFilter, setErrandsStatusFilter] = useState<'ALL' | ErrandsBookingStatus>(
    'ALL'
  );
  const [errandsExpandedId, setErrandsExpandedId] = useState<string | null>(null);
  const [errandsExpanded, setErrandsExpanded] = useState<{
    loading: boolean;
    details: ErrandsBookingDetails | null;
    history: ErrandsHistoryEntry[];
    error: string;
  } | null>(null);
  const [errandsCancelTarget, setErrandsCancelTarget] = useState<ErrandsBooking | null>(null);
  const [isCancellingErrands, setIsCancellingErrands] = useState(false);

  // Driver service capabilities (motorcycle errands / passenger rides).
  const [savingCapabilityId, setSavingCapabilityId] = useState<string | null>(null);

  // Refund dialog (server-side validated through the record_order_refund RPC).
  const [refundOrder, setRefundOrder] = useState<Order | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundError, setRefundError] = useState('');
  const [isRecordingRefund, setIsRecordingRefund] = useState(false);
  // Settlement progression (ELIGIBLE → PROCESSING → PAID) confirmation.
  const [settlementConfirm, setSettlementConfirm] = useState<{
    order: Order;
    status: Extract<SettlementStatus, 'PROCESSING' | 'PAID'>;
  } | null>(null);
  const [isAdvancingSettlement, setIsAdvancingSettlement] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  // Restaurant partner directory filters (client-side; the table is small)
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [restaurantFilter, setRestaurantFilter] = useState<
    'ALL' | 'PENDING' | 'APPROVED' | 'OPEN'
  >('ALL');

  // Courier verification directory filters
  const [courierQuery, setCourierQuery] = useState('');
  const [courierFilter, setCourierFilter] = useState<
    'ALL' | 'PENDING' | 'ONLINE' | 'APPROVED'
  >('ALL');

  // Live order pipeline filters
  const [orderQuery, setOrderQuery] = useState('');
  const [orderFilter, setOrderFilter] = useState<
    'ALL' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  >('ALL');

  // Operations overview: the header's Global Search narrows the kitchen queue,
  // and the queue panel has its own status dropdown.
  const [globalQuery, setGlobalQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState<QueueStatusFilter>('ALL');

  // Ticking clock for the dispatch map header (shown in Accra time).
  const [now, setNow] = useState(() => new Date());

  const notify = (text: string, tone: 'success' | 'error' = 'success') =>
    setNotice({ text, tone });

  // Auto-dismiss the confirmation toast so it can never cover the console.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Keep the dispatch map's clock honest without re-rendering every second.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const fetchAdminData = async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch Restaurants
      const { data: restData } = await supabase.from('restaurants').select('*').order('created_at', { ascending: false });
      if (restData) setRestaurants(restData as Restaurant[]);

      // 2. Fetch Couriers
      const { data: courData } = await supabase.from('couriers').select('*, profile:profiles(*)').order('created_at', { ascending: false });
      if (courData) setCouriers(courData as Courier[]);

      // 2b. Fetch courier verification documents (Ghana Card front/back, licences)
      const { data: docData } = await supabase.from('courier_documents').select('*').order('uploaded_at', { ascending: false });
      if (docData) setCourierDocs(docData as CourierDocument[]);

      // 3. Fetch Orders (with line items + customer so the kitchen queue can
      //    show "Jollof Rice (x2)" and the name on the order)
      const { data: ordData } = await supabase
        .from('orders')
        .select(
          '*, order_items(*), restaurant:restaurants(*), customer:profiles!orders_customer_id_fkey(*), courier:profiles!orders_courier_id_fkey(*)'
        )
        .order('created_at', { ascending: false });
      if (ordData) setOrders(ordData as Order[]);

      // 4. Settlement adjustments (refunds / reversals) — append-only, so the
      //    financial totals below stay truthful after money goes back.
      const { data: adjData } = await supabase
        .from('order_settlement_adjustments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      setAdjustments((adjData || []) as OrderSettlementAdjustment[]);

      // 5. Fetch Platform Settings (merged over the defaults so a partial
      //    row can never drop a rule — an absent max_fee means "no cap").
      const { data: settsData } = await supabase.from('platform_settings').select('*').eq('key', 'delivery_pricing').maybeSingle();
      if (settsData && settsData.value) {
        const raw = settsData.value as Partial<PlatformPricingSettings>;
        setPricingSettings({
          ...DEFAULT_PRICING,
          ...raw,
          max_fee: raw.max_fee ?? null,
        });
      }

      // 5b. Commission rules (seeded by the Phase 1 migration).
      const { data: commData } = await supabase
        .from('platform_settings')
        .select('*')
        .eq('key', 'commission')
        .maybeSingle();
      if (commData && commData.value) {
        const merged: CommissionSettings = {
          ...DEFAULT_COMMISSION_SETTINGS,
          ...(commData.value as Partial<CommissionSettings>),
        };
        setCommissionSettings(merged);
        setCommissionDraft(String(merged.restaurant_commission_percentage));
      }

      // 6. Fetch Audit Logs
      const { data: logsData } = await supabase.from('audit_logs').select('*, actor:profiles(*)').order('created_at', { ascending: false }).limit(20);
      if (logsData) setAuditLogs(logsData as AuditLog[]);
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: kitchen signups, courier signups, document uploads and admin
  // decisions all refresh live.
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      // Debounced so courier GPS pings (couriers table) don't spam the console
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        fetchAdminData();
      }, 1500);
    };

    // `restaurants` is what a newly registered kitchen writes, so without this
    // line the console only learns about a new kitchen on the next full reload.
    const channel = supabase
      .channel('admin-courier-verification')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couriers' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courier_documents' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Admin Actions: Approve Restaurant
  const handleToggleRestaurantApproval = async (id: string, current: boolean) => {
    const name = restaurants.find((r) => r.id === id)?.name ?? 'Restaurant';
    const approved = !current;

    const { error } = await supabase
      .from('restaurants')
      .update({ is_approved: approved })
      .eq('id', id);

    if (error) {
      notify(`Could not update ${name}. Please try again.`, 'error');
      return;
    }

    if (user) {
      await supabase.from('audit_logs').insert({
        actor_id: user.id,
        action: approved ? 'RESTAURANT_APPROVED' : 'RESTAURANT_SUSPENDED',
        target_type: 'restaurant',
        target_id: id,
      });
    }
    await fetchAdminData();
    notify(`${name} ${approved ? 'approved' : 'suspended'}.`);
  };

  // Admin Actions: Approve / suspend courier after reviewing Ghana Card & licence
  const handleToggleCourierApproval = async (id: string, current: boolean) => {
    const approve = !current;
    const name = couriers.find((c) => c.id === id)?.profile?.full_name ?? 'Courier partner';
    const reviewedAt = new Date().toISOString();
    const nextStatus: CourierVerificationStatus = approve ? 'APPROVED' : 'REJECTED';

    const { error } = await supabase
      .from('couriers')
      .update({
        is_approved: approve,
        verification_status: nextStatus,
        verification_reviewed_at: reviewedAt,
        verification_note: approve ? 'Approved by platform admin' : 'Rejected by platform admin',
      })
      .eq('id', id);

    if (error) {
      notify(`Could not update ${name}. Please try again.`, 'error');
      return;
    }

    await supabase
      .from('courier_documents')
      .update({
        status: nextStatus,
        rejection_reason: approve ? null : 'Rejected by platform admin',
        reviewed_at: reviewedAt,
      })
      .eq('courier_id', id);

    if (user) {
      await supabase.from('audit_logs').insert({
        actor_id: user.id,
        action: approve ? 'COURIER_APPROVED' : 'COURIER_SUSPENDED',
        target_type: 'courier',
        target_id: id,
        metadata: { verification_status: nextStatus },
      });
    }
    await fetchAdminData();
    notify(
      approve
        ? `${name} approved for deliveries.`
        : `${name} sent back for review.`
    );
  };

  // Save Delivery Pricing — the numbers are validated by the DATABASE
  // (set_delivery_pricing), which also bumps pricing_version so quotes and
  // orders placed before the change keep the rules they were priced with.
  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();

    const base = pricingSettings.base_fee;
    const perKm = pricingSettings.per_km_rate;
    const min = pricingSettings.min_fee;
    const max = pricingSettings.max_fee ?? null;
    const earning = pricingSettings.courier_earning_percentage ?? 100;

    if ([base, perKm, min, earning].some((v) => !Number.isFinite(v))) {
      notify('Enter a valid number in every delivery pricing field.', 'error');
      return;
    }
    if (max !== null && max < min) {
      notify('The maximum delivery fee cannot be lower than the minimum.', 'error');
      return;
    }

    setIsSavingSettings(true);
    try {
      const { data, error } = await supabase.rpc('set_delivery_pricing', {
        p_base_fee: base,
        p_per_km_rate: perKm,
        p_min_fee: min,
        p_max_fee: max,
        p_courier_earning_percentage: earning,
      });
      if (error) throw error;

      // Store exactly what the server saved (it normalizes and versions).
      const saved = data as Partial<PlatformPricingSettings> | null;
      if (saved) {
        setPricingSettings({
          ...DEFAULT_PRICING,
          ...saved,
          max_fee: saved.max_fee ?? null,
        });
      }

      // The database writes its own authoritative audit entry
      // (DELIVERY_PRICING_UPDATED) with the values it actually stored, so
      // this screen does not log a second, potentially different copy.
      notify(
        `Delivery pricing saved — version ${saved?.pricing_version ?? 'updated'}. New quotes and orders use it; existing orders never change.`
      );
      await fetchAdminData();
    } catch (err) {
      notify(
        cleanRpcErrorMessage(
          err instanceof Error ? err.message : null,
          'Failed to save delivery pricing. Please try again.'
        ),
        'error'
      );
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ---- Commission settings -------------------------------------------------
  // The browser validates first for a fast, friendly message; the database
  // (set_commission_settings) validates again and is the authority.
  const handleCommissionInput = (raw: string) => {
    setCommissionDraft(raw);
    const check = validateCommissionPercentage(raw, MAX_RESTAURANT_COMMISSION_PERCENTAGE);
    setCommissionError(check.ok ? '' : check.error);
  };

  const requestCommissionSave = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateCommissionPercentage(
      commissionDraft,
      MAX_RESTAURANT_COMMISSION_PERCENTAGE
    );
    if (!check.ok) {
      setCommissionError(check.error);
      return;
    }
    if (check.value === commissionSettings.restaurant_commission_percentage) {
      setCommissionError('That is already the current rate.');
      return;
    }
    setCommissionError('');
    setCommissionConfirm(check.value);
  };

  const confirmCommissionSave = async () => {
    if (commissionConfirm === null) return;
    setIsSavingCommission(true);
    try {
      const { error } = await supabase.rpc('set_commission_settings', {
        p_restaurant_commission_percentage: commissionConfirm,
        p_courier_commission_percentage:
          commissionSettings.courier_commission_percentage ??
          DEFAULT_COMMISSION_SETTINGS.courier_commission_percentage,
      });
      if (error) throw error;

      setCommissionSettings((prev) => ({
        ...prev,
        restaurant_commission_percentage: commissionConfirm,
      }));
      setCommissionDraft(String(commissionConfirm));
      setCommissionConfirm(null);
      notify(
        `Restaurant commission set to ${commissionConfirm}%. Existing orders keep the rate they were placed with.`
      );
      await fetchAdminData();
    } catch (err) {
      notify(
        err instanceof Error
          ? err.message.replace(/^Failed to call RPC '.*': /, '')
          : 'Failed to update commission settings.',
        'error'
      );
    } finally {
      setIsSavingCommission(false);
    }
  };

  // ---- Refunds -------------------------------------------------------------
  const priorRefundedOn = (orderId: string) =>
    round2(
      adjustments
        .filter((a) => a.order_id === orderId)
        .reduce((sum, a) => sum + (a.refund_amount || 0), 0)
    );

  const openRefundDialog = (order: Order) => {
    const f = getOrderFinancials(order);
    const remaining = round2(Math.max(0, f.customerTotal - priorRefundedOn(order.id)));
    setRefundOrder(order);
    setRefundAmount(remaining > 0 ? remaining.toFixed(2) : '');
    setRefundReason('');
    setRefundError(
      remaining > 0
        ? ''
        : 'This order has already been refunded in full.'
    );
  };

  const handleRecordRefund = async () => {
    if (!refundOrder) return;
    const raw = refundAmount.trim();
    const value = Number(raw);
    const f = getOrderFinancials(refundOrder);
    const remaining = round2(f.customerTotal - priorRefundedOn(refundOrder.id));

    if (raw === '' || !Number.isFinite(value)) {
      setRefundError('Enter a refund amount.');
      return;
    }
    if (value <= 0) {
      setRefundError('The refund amount must be greater than zero.');
      return;
    }
    if (value > remaining) {
      setRefundError(`At most ${formatGHS(remaining)} is still refundable on this order.`);
      return;
    }

    setIsRecordingRefund(true);
    try {
      const { error } = await supabase.rpc('record_order_refund', {
        p_order_id: refundOrder.id,
        p_refund_amount: round2(value),
        p_reason: refundReason.trim() === '' ? null : refundReason.trim(),
      });
      if (error) throw error;

      notify(
        `${formatGHS(round2(value))} refunded on #${refundOrder.order_number} — commission reversed by the same amount.`
      );
      setRefundOrder(null);
      await fetchAdminData();
    } catch (err) {
      notify(
        err instanceof Error
          ? err.message.replace(/^Failed to call RPC '.*': /, '')
          : 'Failed to record the refund.',
        'error'
      );
    } finally {
      setIsRecordingRefund(false);
    }
  };

  // ---- Settlement (ELIGIBLE → PROCESSING → PAID) ---------------------------
  const handleAdvanceSettlement = async () => {
    if (!settlementConfirm) return;
    const { order, status } = settlementConfirm;
    setIsAdvancingSettlement(true);
    try {
      const { error } = await supabase.rpc('set_order_settlement_status', {
        p_order_id: order.id,
        p_status: status,
      });
      if (error) throw error;
      notify(`#${order.order_number} settlement marked ${status}.`);
      setSettlementConfirm(null);
      await fetchAdminData();
    } catch (err) {
      notify(
        err instanceof Error
          ? err.message.replace(/^Failed to call RPC '.*': /, '')
          : 'Could not advance the settlement.',
        'error'
      );
      setSettlementConfirm(null);
    } finally {
      setIsAdvancingSettlement(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchAdminData();
    } finally {
      setIsRefreshing(false);
    }
  };

  // ---- Errands & On-Demand Rides: data, operators switches and actions ----

  // The tab loads its own data (bookings, switches, pricing, capabilities)
  // the first time it is opened and on every explicit refresh, instead of
  // adding four queries to every dashboard mount.
  const fetchErrandsData = async () => {
    if (!isSupabaseConfigured) {
      setIsErrandsLoading(false);
      return;
    }
    try {
      const [bookingsResult, config, pricing, capsResult] = await Promise.all([
        supabase
          .from('errands_bookings')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        fetchErrandsConfig(),
        fetchErrandsPricingSettings(),
        supabase
          .from('driver_service_capabilities')
          .select('courier_id, errands_enabled, motorcycle_errands, car_rides'),
      ]);

      const bookingRows = Array.isArray(bookingsResult.data)
        ? (bookingsResult.data as unknown[])
        : [];
      setErrandsBookings(
        bookingRows
          .map((row) => parseBooking(row as Parameters<typeof parseBooking>[0] | null))
          .filter((booking): booking is ErrandsBooking => booking !== null)
      );

      setErrandsConfig(config);
      setErrandsPricing(pricing);

      const capRows = Array.isArray(capsResult.data)
        ? (capsResult.data as Record<string, unknown>[])
        : [];
      setErrandsCapabilities(
        capRows
          .map((row) => ({
            courierId: String(row.courier_id ?? ''),
            errandsEnabled: row.errands_enabled === true,
            motorcycleErrands: row.motorcycle_errands === true,
            carRides: row.car_rides === true,
          }))
          .filter((cap) => cap.courierId !== '')
      );
    } catch {
      // Each reader never throws; a failure simply leaves the honest empty state.
    } finally {
      setIsErrandsLoading(false);
    }
  };

  // Open = first visit to the tab; the refresh button inside the tab repeats it.
  useEffect(() => {
    if (activeTab === 'ERRANDS') fetchErrandsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Keep both form drafts in step with whatever the database last saved (first
  // load and every successful save — the server response is the source of truth).
  useEffect(() => {
    if (!errandsConfig) return;
    setErrandsConfigDraft({
      enabled: errandsConfig.enabled,
      motorcycle: errandsConfig.services.ERRAND_MOTORCYCLE,
      rideCar: errandsConfig.services.RIDE_CAR,
    });
  }, [errandsConfig]);

  useEffect(() => {
    if (!errandsPricing) return;
    setErrandsPricingDraft({
      baseFare: String(errandsPricing.baseFare),
      perKmRate: String(errandsPricing.perKmRate),
      minFare: String(errandsPricing.minFare),
      maxFare: errandsPricing.maxFare === null ? '' : String(errandsPricing.maxFare),
      bookingFee: String(errandsPricing.bookingFee),
      taxRatePercent: String(errandsPricing.taxRatePercent),
      driverEarningPercentage: String(errandsPricing.driverEarningPercentage),
      surgeMultiplier: String(errandsPricing.surgeMultiplier),
    });
    setErrandsPricingFormError('');
  }, [errandsPricing]);

  // Service switches — the database (set_errands_config) validates and audits.
  const handleSaveErrandsConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingErrandsConfig(true);
    try {
      const { data, error } = await supabase.rpc('set_errands_config', {
        p_enabled: errandsConfigDraft.enabled,
        p_service_motorcycle: errandsConfigDraft.motorcycle,
        p_service_ride_car: errandsConfigDraft.rideCar,
      });
      if (error) throw error;
      const saved = parseConfig(data);
      if (saved) setErrandsConfig(saved);
      notify('Errands service switches saved.');
    } catch (err) {
      notify(
        cleanRpcErrorMessage(
          err instanceof Error ? err.message : null,
          'Failed to save the Errands service switches. Please try again.'
        ),
        'error'
      );
    } finally {
      setIsSavingErrandsConfig(false);
    }
  };

  // Fare rules — validated here for a fast message AND again by
  // set_errands_pricing(), whose exact sentence is surfaced on failure.
  const handleSaveErrandsPricing = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = parseErrandsPricingDraft(errandsPricingDraft);
    if (!check.ok) {
      setErrandsPricingFormError(check.error);
      return;
    }
    setErrandsPricingFormError('');
    setIsSavingErrandsPricing(true);
    try {
      const { data, error } = await supabase.rpc('set_errands_pricing', {
        p_base_fare: check.values.baseFare,
        p_per_km_rate: check.values.perKmRate,
        p_min_fare: check.values.minFare,
        p_max_fare: check.values.maxFare,
        p_booking_fee: check.values.bookingFee,
        p_tax_rate_percent: check.values.taxRatePercent,
        p_driver_earning_percentage: check.values.driverEarningPercentage,
        p_surge_multiplier: check.values.surgeMultiplier,
      });
      if (error) throw error;
      const saved = parsePricingSettings(data);
      if (saved) setErrandsPricing(saved);
      notify(
        `Errands fare rules saved — pricing version ${
          saved?.pricingVersion ?? 'updated'
        }. New quotes use them; existing bookings never change.`
      );
    } catch (err) {
      notify(
        cleanRpcErrorMessage(
          err instanceof Error ? err.message : null,
          'Failed to save the Errands fare rules. Please try again.'
        ),
        'error'
      );
    } finally {
      setIsSavingErrandsPricing(false);
    }
  };

  // Expanded row: exact endpoints, contacts and the audit trail, loaded only
  // when a booking is opened (never bulk-fetched for the whole table).
  const toggleErrandsBookingDetails = async (booking: ErrandsBooking) => {
    if (errandsExpandedId === booking.id) {
      setErrandsExpandedId(null);
      setErrandsExpanded(null);
      return;
    }
    setErrandsExpandedId(booking.id);
    setErrandsExpanded({ loading: true, details: null, history: [], error: '' });

    const [detailsResult, historyResult] = await Promise.all([
      supabase.from('errands_booking_details').select('*').eq('booking_id', booking.id).maybeSingle(),
      supabase
        .from('errands_status_history')
        .select('id, from_status, to_status, note, created_at, actor:profiles(full_name, role)')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: true }),
    ]);

    const failed = detailsResult.error ?? historyResult.error;
    setErrandsExpanded({
      loading: false,
      details: parseErrandsDetailsRow(detailsResult.data),
      history: parseErrandsHistoryRows(historyResult.data),
      error: failed
        ? cleanRpcErrorMessage(
            failed.message,
            "Could not load this booking's details and history."
          )
        : '',
    });
  };

  // Admin cancellation — the same guarded transition the drivers and
  // customers use; the database re-checks the actor and the status move.
  const confirmErrandsCancel = async () => {
    const booking = errandsCancelTarget;
    if (!booking) return;
    setIsCancellingErrands(true);
    const result = await setErrandsBookingStatus({
      bookingId: booking.id,
      status: 'CANCELLED',
      note: 'Cancelled by administration',
    });
    setIsCancellingErrands(false);
    if (!result.ok) {
      notify(result.error, 'error');
      return;
    }
    setErrandsBookings((prev) =>
      prev.map((row) => (row.id === result.booking.id ? result.booking : row))
    );
    setErrandsCancelTarget(null);
    notify(`${result.booking.bookingNumber || 'Booking'} cancelled by administration.`);
  };

  // Per-driver service capabilities — super-admin grant, never self-service.
  const handleSaveErrandsCapability = async (
    courierId: string,
    motorcycleErrands: boolean,
    carRides: boolean
  ) => {
    setSavingCapabilityId(courierId);
    try {
      const { data, error } = await supabase.rpc('set_driver_service_capabilities', {
        p_courier_id: courierId,
        p_motorcycle_errands: motorcycleErrands,
        p_car_rides: carRides,
      });
      if (error) throw error;

      const payload = data as {
        courier_id?: string;
        errands_enabled?: boolean;
        motorcycle_errands?: boolean;
        car_rides?: boolean;
      } | null;
      const savedFor = String(payload?.courier_id ?? courierId);
      const next: ErrandsDriverCapability = {
        courierId: savedFor,
        errandsEnabled: payload?.errands_enabled === true,
        motorcycleErrands: payload?.motorcycle_errands === true,
        carRides: payload?.car_rides === true,
      };
      setErrandsCapabilities((prev) =>
        prev.some((cap) => cap.courierId === savedFor)
          ? prev.map((cap) => (cap.courierId === savedFor ? next : cap))
          : [...prev, next]
      );
      notify('Driver service capabilities saved.');
    } catch (err) {
      notify(
        cleanRpcErrorMessage(
          err instanceof Error ? err.message : null,
          "Failed to save this driver's service capabilities. Please try again."
        ),
        'error'
      );
    } finally {
      setSavingCapabilityId(null);
    }
  };

  // Real aggregations — every money figure is read from the per-order
  // financial snapshot the database wrote (commission_rate, commission_amount,
  // *_amount), net of refund adjustments. No hard-coded percentages anywhere.
  const financials = aggregateFinancials(orders, adjustments);
  // Delivery economics, summed from the same real order rows: distance is
  // the restaurant → customer route the database priced each order with.
  const deliveryStats = aggregateDeliveryStats(orders, adjustments);
  const totalVolume = round2(orders.reduce((sum, o) => sum + o.total_amount, 0));
  const totalPlatformCut = financials.platformRevenue;
  const onlineCouriers = couriers.filter((c) => c.is_online).length;
  const pendingRestaurants = restaurants.filter((r) => !r.is_approved).length;
  const pendingCouriers = couriers.filter((c) => !c.is_approved).length;
  const pendingDocs = courierDocs.filter((d) => d.status === 'PENDING').length;

  // Ratio metrics that make the overview cards readable at a glance
  const avgOrderValue = orders.length > 0 ? totalVolume / orders.length : 0;
  const takeRatePercent = totalVolume > 0 ? (totalPlatformCut / totalVolume) * 100 : 0;
  const fleetOnlinePercent =
    couriers.length > 0 ? (onlineCouriers / couriers.length) * 100 : 0;
  const pendingTotal = pendingRestaurants + pendingCouriers + pendingDocs;

  // ---- Operations overview: the four mockup KPI numbers ----
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isToday = (iso: string) => new Date(iso).getTime() >= startOfToday.getTime();
  const ordersToday = orders.filter((o) => isToday(o.created_at)).length;
  // Today's platform earnings = commission accrued on today's live orders,
  // minus any refund reversals recorded today. Cancelled orders never count.
  const todayEarnings = round2(
    orders
      .filter(
        (o) =>
          isToday(o.created_at) &&
          o.status !== 'CANCELLED' &&
          o.status !== 'REJECTED' &&
          o.status !== 'FAILED'
      )
      .reduce((sum, o) => sum + getOrderFinancials(o).commissionAmount, 0) +
      adjustments
        .filter((a) => isToday(a.created_at))
        .reduce((sum, a) => sum + (a.commission_adjustment || 0), 0)
  );
  // How much of the platform's recognized money is still awaiting payout.
  const settlementBreakdown = orders.reduce((acc, o) => {
    const key = (o.settlement_status ?? 'PENDING') as SettlementStatus;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<SettlementStatus, number>>);
  // Orders parked on a kitchen that has not accepted them yet — the count
  // behind the header's mail badge.
  const ordersAwaitingKitchen = orders.filter((o) => o.status === 'RESTAURANT_PENDING').length;

  // Dispatch map header: city comes from the data, clock runs on Accra time.
  const mapCity = restaurants.find((r) => r.city)?.city || 'Accra';
  const nowLabel = `${now.toLocaleString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Accra',
  })} (GMT)`;

  // Restaurant directory rollups
  const approvedRestaurants = restaurants.length - pendingRestaurants;
  const openRestaurants = restaurants.filter((r) => r.is_open).length;
  const averageRating =
    restaurants.length > 0
      ? restaurants.reduce((sum, r) => sum + (r.rating || 0), 0) / restaurants.length
      : 0;

  const restaurantFilters: { key: typeof restaurantFilter; label: string; count: number }[] = [
    { key: 'ALL', label: 'All', count: restaurants.length },
    { key: 'PENDING', label: 'Pending', count: pendingRestaurants },
    { key: 'APPROVED', label: 'Approved', count: approvedRestaurants },
    { key: 'OPEN', label: 'Open now', count: openRestaurants },
  ];

  const filteredRestaurants = useMemo(() => {
    const query = restaurantQuery.trim().toLowerCase();
    return restaurants.filter((r) => {
      const matchesQuery =
        !query ||
        [r.name, r.cuisine_type, r.city, r.address, r.phone].some((field) =>
          (field ?? '').toLowerCase().includes(query)
        );
      if (!matchesQuery) return false;
      if (restaurantFilter === 'PENDING') return !r.is_approved;
      if (restaurantFilter === 'APPROVED') return r.is_approved;
      if (restaurantFilter === 'OPEN') return r.is_open;
      return true;
    });
  }, [restaurants, restaurantQuery, restaurantFilter]);

  // Courier directory rollups + filtered list
  const courierFilters: { key: typeof courierFilter; label: string; count: number }[] = [
    { key: 'ALL', label: 'All', count: couriers.length },
    { key: 'PENDING', label: 'Awaiting', count: pendingCouriers },
    { key: 'ONLINE', label: 'Online', count: onlineCouriers },
    { key: 'APPROVED', label: 'Approved', count: couriers.length - pendingCouriers },
  ];

  const filteredCouriers = useMemo(() => {
    const query = courierQuery.trim().toLowerCase();
    return couriers.filter((c) => {
      const matchesQuery =
        !query ||
        [
          c.profile?.full_name,
          c.profile?.email,
          c.vehicle_plate,
          c.vehicle_type,
        ].some((field) => (field ?? '').toLowerCase().includes(query));
      if (!matchesQuery) return false;
      if (courierFilter === 'PENDING') return !c.is_approved;
      if (courierFilter === 'ONLINE') return c.is_online;
      if (courierFilter === 'APPROVED') return c.is_approved;
      return true;
    });
  }, [couriers, courierQuery, courierFilter]);

  // Live order rollups + filtered list
  const activeOrdersCount = orders.filter((o) => isActiveOrder(o.status)).length;
  const completedOrdersCount = orders.filter(
    (o) => o.status === 'COMPLETED' || o.status === 'DELIVERED'
  ).length;
  const cancelledOrdersCount = orders.filter(
    (o) => o.status === 'CANCELLED' || o.status === 'REJECTED' || o.status === 'FAILED'
  ).length;

  const orderFilters: { key: typeof orderFilter; label: string; count: number }[] = [
    { key: 'ALL', label: 'All', count: orders.length },
    { key: 'ACTIVE', label: 'In progress', count: activeOrdersCount },
    { key: 'COMPLETED', label: 'Completed', count: completedOrdersCount },
    { key: 'CANCELLED', label: 'Cancelled', count: cancelledOrdersCount },
  ];

  const filteredOrders = useMemo(() => {
    const query = orderQuery.trim().toLowerCase();
    return orders.filter((o) => {
      const matchesQuery =
        !query ||
        [
          o.order_number,
          o.restaurant?.name,
          o.courier?.full_name,
          o.delivery_address,
          o.payment_method,
        ].some((field) => (field ?? '').toLowerCase().includes(query));
      if (!matchesQuery) return false;
      if (orderFilter === 'ACTIVE') return isActiveOrder(o.status);
      if (orderFilter === 'COMPLETED')
        return o.status === 'COMPLETED' || o.status === 'DELIVERED';
      if (orderFilter === 'CANCELLED')
        return o.status === 'CANCELLED' || o.status === 'REJECTED' || o.status === 'FAILED';
      return true;
    });
  }, [orders, orderQuery, orderFilter]);

  // Live kitchen queue: active orders only, narrowed by the header's Global
  // Search and the panel's status dropdown.
  const queueOrders = useMemo(() => {
    const query = globalQuery.trim().toLowerCase();
    return orders
      .filter((o) => isActiveOrder(o.status))
      .filter((o) => {
        if (queueFilter === 'ALL') return true;
        if (queueFilter === 'PREPARING')
          return (
            o.status === 'PREPARING' ||
            o.status === 'RESTAURANT_ACCEPTED' ||
            o.status === 'RESTAURANT_PENDING' ||
            o.status === 'PAID' ||
            o.status === 'PENDING_PAYMENT'
          );
        if (queueFilter === 'READY_FOR_PICKUP') return o.status === 'READY_FOR_PICKUP';
        return (
          o.status === 'COURIER_ASSIGNED' ||
          o.status === 'COURIER_ACCEPTED' ||
          o.status === 'PICKED_UP' ||
          o.status === 'ON_THE_WAY' ||
          o.status === 'ARRIVED'
        );
      })
      .filter((o) => {
        if (!query) return true;
        return [
          o.order_number,
          o.customer?.full_name,
          o.restaurant?.name,
          o.delivery_address,
          ...(o.order_items ?? []).map((item) => item.item_name),
        ].some((field) => (field ?? '').toLowerCase().includes(query));
      })
      .slice(0, 25);
  }, [orders, globalQuery, queueFilter]);

  // Dispatch map: every rider currently on shift who has sent a GPS fix.
  const mapCouriers = useMemo(
    () =>
      couriers
        .filter(
          (c) =>
            c.is_online &&
            typeof c.current_latitude === 'number' &&
            typeof c.current_longitude === 'number'
        )
        .map((c) => ({
          id: c.id,
          label: c.profile?.full_name || 'Rider',
          lat: c.current_latitude as number,
          lng: c.current_longitude as number,
        })),
    [couriers]
  );

  // Dispatch map: kitchens that have saved coordinates.
  const mapKitchens = useMemo(
    () =>
      restaurants
        .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
        .map((r) => ({
          id: r.id,
          label: r.name,
          lat: r.latitude as number,
          lng: r.longitude as number,
        })),
    [restaurants]
  );

  // One line per live order: rider → kitchen → customer (skipping any leg
  // whose coordinates are missing — plenty of orders never saved a GPS point).
  const mapRoutes = useMemo(() => {
    const riderPositionByProfile = new Map<string, { lat: number; lng: number }>();
    couriers.forEach((c) => {
      if (
        c.profile?.id &&
        typeof c.current_latitude === 'number' &&
        typeof c.current_longitude === 'number'
      ) {
        riderPositionByProfile.set(c.profile.id, {
          lat: c.current_latitude,
          lng: c.current_longitude,
        });
      }
    });

    const coord = (lat?: number, lng?: number) =>
      typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;

    return orders
      .filter((o) => isActiveOrder(o.status))
      .map((o) => ({
        id: o.id,
        points: [
          o.courier_id ? riderPositionByProfile.get(o.courier_id) ?? null : null,
          coord(o.restaurant?.latitude, o.restaurant?.longitude),
          coord(o.delivery_latitude, o.delivery_longitude),
        ].filter((point): point is { lat: number; lng: number } => point !== null),
      }))
      .filter((route) => route.points.length > 1);
  }, [orders, couriers]);

  // Pricing preview (mirrors the exact fee the customer would be charged)
  const sampleFee = calculateDeliveryFee(SAMPLE_DISTANCE_KM, pricingSettings);
  const courierSampleEarning = round2(
    (sampleFee * (pricingSettings.courier_earning_percentage ?? 100)) / 100
  );
  // Phase 1: the courier keeps the whole delivery fee (0% courier commission);
  // the platform earns the restaurant commission on the FOOD subtotal only.
  const sampleFoodOrder = 100;
  const sampleCommission = round2(
    (sampleFoodOrder * commissionSettings.restaurant_commission_percentage) / 100
  );

  // ---- Errands & On-Demand Rides: real metrics, filters and preview --------
  // Every number below is summed from the fetched `errands_bookings` rows —
  // the tab never shows a fabricated total. Fare volume and driver earnings
  // count COMPLETED bookings only (that is when money actually settles).
  const errandsStats = useMemo(() => {
    const rows = errandsBookings;
    const completedRows = rows.filter((b) => b.status === 'COMPLETED');
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const completedLast7Days = completedRows.filter((b) => {
      const settledAt = Date.parse(b.completedAt ?? b.createdAt);
      return Number.isFinite(settledAt) && settledAt >= sevenDaysAgo;
    }).length;
    return {
      active: rows.filter((b) => ACTIVE_ERRANDS_STATUSES.includes(b.status)).length,
      completed: completedRows.length,
      completedLast7Days,
      cancelled: rows.filter((b) => b.status === 'CANCELLED').length,
      expired: rows.filter((b) => b.status === 'EXPIRED').length,
      failed: rows.filter((b) => b.status === 'FAILED').length,
      completedFareVolume: round2(
        completedRows.reduce((sum, b) => sum + (b.finalFare ?? b.estimatedFare), 0)
      ),
      driverEarningsPaid: round2(completedRows.reduce((sum, b) => sum + b.driverEarning, 0)),
    };
  }, [errandsBookings]);

  const filteredErrandsBookings = useMemo(() => {
    const query = errandsQuery.trim().toLowerCase();
    return errandsBookings.filter((b) => {
      // Search covers the booking number and the coarse areas (exact addresses
      // live in `errands_booking_details` and are only loaded per expanded row).
      const matchesQuery =
        !query ||
        [b.bookingNumber, b.pickupArea, b.destinationArea].some(
          (field) => (field ?? '').toLowerCase().includes(query)
        );
      if (!matchesQuery) return false;
      return errandsStatusFilter === 'ALL' || b.status === errandsStatusFilter;
    });
  }, [errandsBookings, errandsQuery, errandsStatusFilter]);

  // Live preview of the fare rules as they are being typed. This is the
  // admin-preview copy of the formula (see errands/pricing.ts) — customers
  // only ever see what create_errands_quote() answers for their own route.
  const errandsPreviewSettings = useMemo<ErrandsPricingSettings>(() => {
    const previewNumber = (raw: string, fallback: number): number => {
      const parsed = Number(raw.trim());
      return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : fallback;
    };
    const maxFare =
      errandsPricingDraft.maxFare.trim() === ''
        ? null
        : previewNumber(errandsPricingDraft.maxFare, 0);
    return {
      configured: true,
      currency: errandsPricing?.currency ?? 'GHS',
      pricingVersion: errandsPricing?.pricingVersion ?? 1,
      baseFare: previewNumber(errandsPricingDraft.baseFare, errandsPricing?.baseFare ?? 0),
      perKmRate: previewNumber(errandsPricingDraft.perKmRate, errandsPricing?.perKmRate ?? 0),
      minFare: previewNumber(errandsPricingDraft.minFare, errandsPricing?.minFare ?? 0),
      maxFare,
      bookingFee: previewNumber(errandsPricingDraft.bookingFee, errandsPricing?.bookingFee ?? 0),
      taxRatePercent: previewNumber(
        errandsPricingDraft.taxRatePercent,
        errandsPricing?.taxRatePercent ?? 0
      ),
      surgeMultiplier: previewNumber(
        errandsPricingDraft.surgeMultiplier,
        errandsPricing?.surgeMultiplier ?? 1
      ),
      driverEarningPercentage: previewNumber(
        errandsPricingDraft.driverEarningPercentage,
        errandsPricing?.driverEarningPercentage ?? 100
      ),
      quoteTtlMinutes: errandsPricing?.quoteTtlMinutes ?? 5,
      requestTtlSeconds: errandsPricing?.requestTtlSeconds ?? 90,
    };
  }, [errandsPricingDraft, errandsPricing]);

  const errandsPreviewKm = Number(errandsPreviewKmInput.trim());
  const errandsPreview = calculateErrandsFare(
    Number.isFinite(errandsPreviewKm) && errandsPreviewKm > 0 ? errandsPreviewKm : 0,
    errandsPreviewSettings
  );

  const errandsCapabilityByCourier = useMemo(() => {
    const map = new Map<string, ErrandsDriverCapability>();
    errandsCapabilities.forEach((cap) => map.set(cap.courierId, cap));
    return map;
  }, [errandsCapabilities]);

  // Single source of truth for the sidebar: desktop rail, mobile drawer and the
  // mobile top bar all render from this list, so a section can never drift.
  // Labels follow the operations mockup; `key` maps each row to the console
  // section that actually backs it ("Earnings" and "Dashboard" both open the
  // overview, where today's earnings live).
  const navItems: AdminNavItem[] = [
    { key: 'OVERVIEW', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'RESTAURANTS', label: 'Kitchen Queue', icon: ChefHat },
    { key: 'COURIERS', label: 'Courier Map', icon: MapIcon },
    { key: 'ORDERS', label: 'Dispatch', icon: Send },
    { key: 'AUDIT', label: 'Analytics', icon: ChartColumn },
    { key: 'OVERVIEW', label: 'Earnings', icon: Wallet },
    // Inserted just above Settings so the index-based KPI shortcuts above
    // (navItems[2]/[3]/[5]) keep pointing at the sections they always did.
    { key: 'ERRANDS', label: 'Errands & Rides', icon: Bike },
    { key: 'SETTINGS', label: 'Settings', icon: Settings },
  ];

  // Two rows can share a tab, so the highlight is tracked by label rather than
  // by key; the effect below re-syncs it whenever the URL changes (deep link,
  // refresh, back/forward).
  const [activeNav, setActiveNav] = useState<{ label: string; key: AdminTab }>(() => ({
    label: DEFAULT_NAV_LABEL[activeTab],
    key: activeTab,
  }));

  useEffect(() => {
    setActiveNav((prev) =>
      prev.key === activeTab ? prev : { label: DEFAULT_NAV_LABEL[activeTab], key: activeTab }
    );
  }, [activeTab]);

  const activeLabel = activeNav.label;

  const handleSelectTab = (key: AdminTab) => {
    // Push the section into the URL so back/forward and refresh keep working.
    setSearchParams(key === 'OVERVIEW' ? {} : { tab: key });
    setIsSidebarOpen(false);
    setExpandedCourierId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Sidebar click: moves the highlight first, then navigates. */
  const handleSelectNav = (item: AdminNavItem) => {
    setActiveNav({ label: item.label, key: item.key });
    handleSelectTab(item.key);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // Pill styling for the Live Orders list.
  const orderStatusStyle = (status: Order['status']) => {
    switch (status) {
      case 'COMPLETED':
      case 'DELIVERED':
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/20';
      case 'CANCELLED':
      case 'REJECTED':
      case 'FAILED':
        return 'bg-rose-50 text-rose-700 ring-1 ring-rose-500/20';
      case 'PENDING_PAYMENT':
      case 'RESTAURANT_PENDING':
        return 'bg-amber-50 text-amber-700 ring-1 ring-amber-500/25';
      default:
        return 'bg-sky-50 text-sky-700 ring-1 ring-sky-500/20';
    }
  };

  /** Leading status dot — pulses while the order is still moving. */
  const orderStatusDot = (status: Order['status']) => {
    switch (status) {
      case 'COMPLETED':
      case 'DELIVERED':
        return 'bg-emerald-500';
      case 'CANCELLED':
      case 'REJECTED':
      case 'FAILED':
        return 'bg-rose-500';
      case 'PENDING_PAYMENT':
      case 'RESTAURANT_PENDING':
        return 'bg-amber-500';
      default:
        return 'bg-sky-500';
    }
  };

  const paymentStatusStyle = (status: Order['payment_status']) =>
    status === 'COMPLETED'
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/20'
      : status === 'FAILED'
        ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-500/20'
        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-500/25';

  // Prevent the page behind the mobile drawer from scrolling under it.
  useEffect(() => {
    document.body.style.overflow = isSidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpen]);

  const initials = monogram(profile?.full_name || user?.email || 'Admin');

  const brand = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <h1 className="truncate text-[17px] font-black tracking-tight text-slate-900">
          SamleyGo
        </h1>
        <p className="truncate text-xs font-bold text-slate-500">Dispatch</p>
      </div>
    </div>
  );

  /** One light sidebar row; shared by the rail, the mobile drawer and pills. */
  const renderNavItem = (item: AdminNavItem, isActive: boolean) => {
    const Icon = item.icon;
    return (
      <button
        key={item.label}
        type="button"
        onClick={() => handleSelectNav(item)}
        aria-current={isActive ? 'page' : undefined}
        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
          isActive
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-500/20'
            : 'text-slate-600 ring-1 ring-transparent hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <Icon
          className={`h-[18px] w-[18px] shrink-0 ${
            isActive ? 'text-emerald-600' : 'text-slate-500 group-hover:text-slate-700'
          }`}
        />
        <span className="flex-1 truncate text-left">{item.label}</span>
      </button>
    );
  };

  const navList = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Admin sections">
      {navItems.slice(0, -1).map((item) => renderNavItem(item, activeNav.label === item.label))}
      {/* Settings is pinned to the bottom of the rail, like the mockup */}
      <div className="mt-3 border-t border-slate-200 pt-3">
        {renderNavItem(navItems[navItems.length - 1], activeNav.label === 'Settings')}
      </div>
    </nav>
  );

  const sidebarFooter = (
    <div className="shrink-0 space-y-3 border-t border-slate-200 px-3 py-4">
      <div className="flex min-w-0 items-center gap-3 px-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[11px] font-black text-white ring-1 ring-emerald-600/20">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-slate-900" title={user?.email ?? ''}>
            {profile?.full_name || user?.email || 'Administrator'}
          </p>
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">
            {profile ? profile.role.replace(/_/g, ' ') : 'Loading role…'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/"
          className="flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          Storefront
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-2 py-2.5 text-[11px] font-bold text-slate-600 transition hover:bg-rose-50 hover:text-rose-600"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* ===== DESKTOP SIDEBAR (fixed rail) ===== */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-hidden border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="shrink-0 border-b border-slate-200 px-4 py-5">{brand}</div>
        {navList}
        {sidebarFooter}
      </aside>

      {/* ===== MOBILE DRAWER ===== */}
      {isSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-hidden border-r border-slate-200 bg-white shadow-2xl lg:hidden">
            <div className="relative flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-4 py-5">
              {brand}
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close navigation"
                className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navList}
            {sidebarFooter}
          </aside>
        </>
      )}

      {/* ===== MAIN ===== */}
      <div className="lg:pl-64">
        {/* Mobile top bar + one-tap section pills */}
        <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open navigation"
              aria-expanded={isSidebarOpen}
              className="-ml-2 shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200">
              <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase leading-none tracking-[0.18em] text-emerald-600">
                SamleyGo Admin
              </p>
              <p className="mt-1 truncate text-sm font-black leading-tight text-slate-900">
                {activeLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="-mr-2 shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-rose-600"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navItems.map((item) => {
              const isActive = activeNav.label === item.label;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleSelectNav(item)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Desktop header */}
        <header className="sticky top-0 z-20 hidden items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur-md lg:flex xl:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-xl font-black tracking-tight text-slate-900">
              Operations Dashboard
            </h1>
            <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-black tracking-wide text-slate-600 ring-1 ring-slate-200">
              GHS
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Global Search narrows the live kitchen queue */}
            <div className="relative hidden md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder="Global Search"
                aria-label="Global search — filters the live kitchen order queue"
                className="w-56 rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-medium text-slate-900 transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 xl:w-72"
              />
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh dashboard data"
              aria-label="Refresh dashboard data"
              className="grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60"
            >
              <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab('COURIERS')}
              title={`${pendingTotal} item${pendingTotal === 1 ? '' : 's'} waiting for your review`}
              aria-label={`${pendingTotal} items waiting for review`}
              className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Bell className="h-5 w-5" />
              {pendingTotal > 0 && (
                <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
                  {pendingTotal}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab('ORDERS')}
              title={`${ordersAwaitingKitchen} order${ordersAwaitingKitchen === 1 ? '' : 's'} waiting for a kitchen to confirm`}
              aria-label={`${ordersAwaitingKitchen} orders waiting for kitchen confirmation`}
              className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Mail className="h-5 w-5" />
              {ordersAwaitingKitchen > 0 && (
                <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
                  {ordersAwaitingKitchen}
                </span>
              )}
            </button>

            <div
              className="ml-1 flex items-center gap-2.5 border-l border-slate-200 pl-3"
              title={user?.email ?? ''}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[11px] font-black text-white ring-1 ring-emerald-600/20">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </span>
              <span className="hidden leading-tight xl:block">
                <span className="block truncate text-sm font-black text-slate-900">
                  {profile?.full_name || user?.email || 'Admin'}
                </span>
                <span className="block text-[11px] font-bold text-slate-500">Admin</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            </div>
          </div>
        </header>

        <main className="max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {!isSupabaseConfigured && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs font-bold leading-relaxed text-amber-800">
                Supabase is not configured in this environment, so the console cannot load live
                data. Add your project keys to see restaurants, couriers and orders here.
              </p>
            </div>
          )}

          {isLoading ? (
            <DashboardSkeleton />
          ) : (
            <div key={activeTab} className="animate-fade-up space-y-6">
              {/* ================= OVERVIEW ================= */}
              {activeTab === 'OVERVIEW' && (
                <>
                  {/* ===== KPI row ===== */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                    <OpsStatCard
                      label="Today's Earnings"
                      value={formatGHS(todayEarnings)}
                      icon={Wallet}
                      hint={`${ordersToday} order${ordersToday === 1 ? '' : 's'} placed since midnight · commission accrued today ${formatGHS(
                        todayEarnings
                      )} · recognized lifetime ${formatGHS(totalPlatformCut)} across ${
                        financials.recognizedOrders
                      } settled orders (≈${takeRatePercent.toFixed(1)}% of ${formatGHS(
                        totalVolume
                      )} lifetime volume)`}
                      onClick={() => handleSelectNav(navItems[5])}
                    />
                    <OpsStatCard
                      label="Live Orders"
                      value={String(activeOrdersCount)}
                      icon={Receipt}
                      hint="Orders that have not reached the customer yet"
                      onClick={() => handleSelectNav(navItems[3])}
                    />
                    <OpsStatCard
                      label="Active Couriers"
                      value={String(onlineCouriers)}
                      icon={Bike}
                      hint={`Riders who are online and on shift right now — ${onlineCouriers} of ${
                        couriers.length
                      } (${Math.round(fleetOnlinePercent)}% of the fleet)`}
                      onClick={() => handleSelectNav(navItems[2])}
                    />
                    <OpsStatCard
                      label="Delivered"
                      value={String(completedOrdersCount)}
                      icon={CheckCircle}
                      hint="Orders marked delivered or completed"
                      onClick={() => {
                        setOrderFilter('COMPLETED');
                        handleSelectNav(navItems[3]);
                      }}
                    />
                  </div>

                  {/* ===== Financials: gross → commission → net ===== */}
                  <SectionCard
                    title="Financials — food sales, commission & payouts"
                    subtitle="Every figure is computed by the database on each order and netted against refunds"
                    action={
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-500/20">
                        <Percent className="h-3.5 w-3.5" />
                        Restaurant commission{' '}
                        {commissionSettings.restaurant_commission_percentage}%
                      </span>
                    }
                  >
                    {financials.recognizedOrders === 0 ? (
                      <EmptyState
                        icon={Wallet}
                        title="No recognized revenue yet"
                        hint="Revenue is recognized only when an order is delivered and paid. Cancelled, rejected and refunded orders never count."
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <SummaryTile
                            label="Food sales"
                            value={formatGHS(financials.totalFoodSales)}
                            icon={Receipt}
                            tone="emerald"
                          />
                          <SummaryTile
                            label="Commission earned"
                            value={formatGHS(financials.platformRevenue)}
                            icon={Percent}
                            tone="amber"
                          />
                          <SummaryTile
                            label="Owed to restaurants"
                            value={formatGHS(financials.restaurantPayouts)}
                            icon={Store}
                            tone="sky"
                          />
                          <SummaryTile
                            label="Owed to couriers"
                            value={formatGHS(financials.courierEarnings)}
                            icon={Bike}
                            tone="violet"
                          />
                        </div>

                        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-xs sm:grid-cols-2">
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-slate-500">Delivery fees collected</dt>
                            <dd className="font-black tabular-nums text-slate-900">
                              {formatGHS(financials.deliveryFees)}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-slate-500">Refunds recorded</dt>
                            <dd className="font-black tabular-nums text-rose-600">
                              −
                              {formatGHS(
                                round2(
                                  adjustments.reduce(
                                    (sum, a) => sum + (a.refund_amount || 0),
                                    0
                                  )
                                )
                              )}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-slate-500">
                              Average order value (all orders)
                            </dt>
                            <dd className="font-black tabular-nums text-slate-900">
                              {formatGHS(avgOrderValue)}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-slate-500">Commission rate applied</dt>
                            <dd className="font-black tabular-nums text-slate-900">
                              {commissionSettings.restaurant_commission_percentage}% on food
                              subtotal
                            </dd>
                          </div>
                        </dl>

                        {/* ---- Delivery economics: fees, earnings, distance ---- */}
                        <div className="mt-4 border-t border-slate-100 pt-4">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Delivery — fees, courier earnings &amp; distance
                          </p>
                          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                            <div className="flex items-center justify-between gap-3">
                              <dt className="text-slate-500">Total delivery fees collected</dt>
                              <dd className="font-black tabular-nums text-slate-900">
                                {formatGHS(deliveryStats.totalDeliveryFees)}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <dt className="text-slate-500">Total courier earnings</dt>
                              <dd className="font-black tabular-nums text-emerald-700">
                                {formatGHS(deliveryStats.totalCourierEarnings)}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <dt className="text-slate-500">Total delivery distance</dt>
                              <dd className="font-black tabular-nums text-slate-900">
                                {deliveryStats.totalDistanceKm.toFixed(1)} km
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <dt className="text-slate-500">Average delivery distance</dt>
                              <dd className="font-black tabular-nums text-slate-900">
                                {deliveryStats.averageDistanceKm.toFixed(1)} km
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <dt className="text-slate-500">Average delivery fee</dt>
                              <dd className="font-black tabular-nums text-slate-900">
                                {formatGHS(deliveryStats.averageDeliveryFee)}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <dt className="text-slate-500">Orders measured</dt>
                              <dd className="font-black tabular-nums text-slate-900">
                                {deliveryStats.measuredOrders} of {deliveryStats.orders}
                              </dd>
                            </div>
                          </dl>
                          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                            Summed from stored order records (delivered &amp; paid, net of
                            refunds). The delivery fee funds the courier earning; the
                            restaurant commission is calculated separately on food sales.
                          </p>
                        </div>
                      </>
                    )}

                    {/* Settlement lifecycle — payment states stay separate from payouts */}
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Settlement status of every order
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(
                          [
                            'PENDING',
                            'ELIGIBLE',
                            'PROCESSING',
                            'PAID',
                            'REVERSED',
                            'CANCELLED',
                          ] as SettlementStatus[]
                        ).map((state) => {
                          const count = settlementBreakdown[state] ?? 0;
                          if (count === 0) return null;
                          return (
                            <span
                              key={state}
                              className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 ring-1 ring-slate-200"
                            >
                              {state.replace(/_/g, ' ')} · {count}
                            </span>
                          );
                        })}
                      </div>
                      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                        Payment success never marks a restaurant as paid out — an order has to
                        reach ELIGIBLE, then be advanced to PROCESSING and PAID from its row in
                        Dispatch.
                      </p>
                    </div>
                  </SectionCard>

                  {/* ===== Live kitchen queue + courier dispatch map ===== */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {/* ---------- Live Kitchen Order Queue ---------- */}
                    <section className={`${CARD} flex h-[620px] min-w-0 flex-col overflow-hidden`}>
                      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
                        <div className="min-w-0">
                          <h2 className="text-[17px] font-black tracking-tight text-slate-900">
                            Live Kitchen Order Queue
                          </h2>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {queueOrders.length} {queueOrders.length === 1 ? 'order' : 'orders'}
                            {globalQuery.trim() ? ' matching your search' : ''}
                          </p>
                        </div>
                        <label className="relative">
                          <span className="sr-only">Filter the queue by status</span>
                          <select
                            value={queueFilter}
                            onChange={(e) => setQueueFilter(e.target.value as QueueStatusFilter)}
                            className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-bold text-slate-700 transition focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          >
                            <option value="ALL">All statuses</option>
                            <option value="PREPARING">Preparing</option>
                            <option value="READY_FOR_PICKUP">Ready for pickup</option>
                            <option value="ON_THE_WAY">On the way</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        </label>
                      </header>

                      {orders.length === 0 ? (
                        <EmptyState
                          icon={Inbox}
                          title="No orders yet"
                          hint="Every order placed on the platform streams into this queue in realtime."
                        />
                      ) : queueOrders.length === 0 ? (
                        <EmptyState
                          icon={Search}
                          title={
                            globalQuery.trim() ? 'No orders match your search' : 'The kitchen queue is clear'
                          }
                          hint={
                            globalQuery.trim()
                              ? `Nothing live matches “${globalQuery.trim()}”.`
                              : 'Nothing is being prepared, picked up or delivered right now.'
                          }
                          action={
                            globalQuery.trim() ? (
                              <button
                                type="button"
                                onClick={() => setGlobalQuery('')}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black text-white transition hover:bg-slate-800"
                              >
                                Clear search
                              </button>
                            ) : undefined
                          }
                        />
                      ) : (
                        <div className="max-h-[560px] flex-1 overflow-auto border-t border-slate-200">
                          <table className="w-full min-w-[460px] text-left text-[13px]">
                            <thead>
                              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                <th className="sticky top-0 z-10 bg-white px-5 py-3">Order ID</th>
                                <th className="sticky top-0 z-10 bg-white px-4 py-3">Customer</th>
                                <th className="sticky top-0 z-10 bg-white px-4 py-3">Items</th>
                                <th className="sticky top-0 z-10 bg-white px-4 py-3">Time</th>
                                <th className="sticky top-0 z-10 bg-white px-4 py-3">Status Badge</th>
                                <th className="sticky top-0 z-10 bg-white py-3 pr-5">
                                  <span className="sr-only">Open order</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {queueOrders.map((o) => {
                                const minutes = Math.max(
                                  1,
                                  Math.round(
                                    (Date.now() - new Date(o.created_at).getTime()) / 60000
                                  )
                                );
                                const badge = queueBadge(o.status, minutes);
                                const items = o.order_items ?? [];
                                const openOrder = () => {
                                  setOrderQuery(o.order_number);
                                  setOrderFilter('ALL');
                                  handleSelectNav(navItems[3]);
                                };
                                return (
                                  <tr
                                    key={o.id}
                                    tabIndex={0}
                                    onClick={openOrder}
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter' && e.key !== ' ') return;
                                      e.preventDefault();
                                      openOrder();
                                    }}
                                    className="group cursor-pointer transition hover:bg-slate-50/80 focus:outline-none focus-visible:bg-emerald-50/60"
                                  >
                                    <td className="relative px-5 py-3.5 font-black text-slate-900">
                                      <span
                                        aria-hidden="true"
                                        className={`absolute inset-y-0 left-0 w-1 ${badge.accent}`}
                                      />
                                      #{o.order_number}
                                    </td>
                                    <td className="px-4 py-3.5 font-medium text-slate-700">
                                      {o.customer?.full_name || o.customer_phone || '—'}
                                    </td>
                                    <td className="px-4 py-3.5">
                                      {items.length > 0 ? (
                                        <div className="space-y-0.5">
                                          {items.slice(0, 2).map((item) => (
                                            <p key={item.id} className="font-medium text-slate-700">
                                              {item.item_name}
                                              {item.quantity > 1 ? ` (x${item.quantity})` : ''}
                                            </p>
                                          ))}
                                          {items.length > 2 && (
                                            <p className="text-[11px] text-slate-400">
                                              +{items.length - 2} more
                                            </p>
                                          )}
                                        </div>
                                      ) : (
                                        <p className="text-slate-500">{o.restaurant?.name || '—'}</p>
                                      )}
                                    </td>
                                    <td className="px-4 py-3.5 tabular-nums text-slate-500">
                                      {formatQueueTime(o.created_at)}
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <span
                                        className={`block text-[11px] font-black uppercase tracking-wide ${badge.titleClass}`}
                                      >
                                        {badge.title}
                                      </span>
                                      <span
                                        className={`mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold ring-1 ring-inset ${badge.pill}`}
                                      >
                                        <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                                        {badge.label}
                                      </span>
                                    </td>
                                    <td className="py-3.5 pr-5 text-right">
                                      <ChevronRight className="inline h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    {/* ---------- Courier Dispatch Map ---------- */}
                    <section className={`${CARD} flex h-[620px] min-w-0 flex-col overflow-hidden`}>
                      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
                        <div className="min-w-0">
                          <h2 className="text-[17px] font-black tracking-tight text-slate-900">
                            Courier Dispatch Map
                          </h2>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Live interactive map of {mapCity}
                          </p>
                        </div>
                        <p className="text-sm font-black tabular-nums text-slate-700">{nowLabel}</p>
                      </header>
                      <div className="min-h-0 flex-1 border-t border-slate-200">
                        <AdminDispatchMap
                          couriers={mapCouriers}
                          kitchens={mapKitchens}
                          routes={mapRoutes}
                        />
                      </div>
                    </section>
                  </div>

                </>
              )}

              {/* ================= RESTAURANTS ================= */}
              {activeTab === 'RESTAURANTS' && (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <SummaryTile
                      label="Approved partners"
                      value={String(approvedRestaurants)}
                      icon={CheckCircle}
                      tone="emerald"
                    />
                    <SummaryTile
                      label="Awaiting review"
                      value={String(pendingRestaurants)}
                      icon={AlertCircle}
                      tone="amber"
                    />
                    <SummaryTile
                      label="Open right now"
                      value={String(openRestaurants)}
                      icon={Store}
                      tone="sky"
                    />
                    <SummaryTile
                      label="Average rating"
                      value={averageRating > 0 ? averageRating.toFixed(1) : '—'}
                      icon={Star}
                      tone="violet"
                    />
                  </div>

                  <SectionCard
                    title="Restaurant partners"
                    subtitle="Approve or suspend kitchens operating on the platform"
                    action={
                      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-500/15">
                        {approvedRestaurants} of {restaurants.length} approved
                      </span>
                    }
                  >
                    {/* ---- Toolbar: search + segmented status filters ---- */}
                    <ListToolbar
                      query={restaurantQuery}
                      onQueryChange={setRestaurantQuery}
                      placeholder="Search kitchen, cuisine or city…"
                      ariaLabel="Search restaurants"
                      filters={restaurantFilters}
                      activeKey={restaurantFilter}
                      onFilterChange={setRestaurantFilter}
                    />

                    {/* ---- Results ---- */}
                    {restaurants.length === 0 ? (
                      <EmptyState
                        icon={Store}
                        title="No restaurant registrations"
                        hint="Kitchens that sign up through SamleyGo will appear here so you can review and approve them."
                      />
                    ) : filteredRestaurants.length === 0 ? (
                      <EmptyState
                        icon={Search}
                        title="No kitchens match your search"
                        hint="Try a different kitchen name, cuisine or city — or clear the filters to see every partner."
                        action={
                          <button
                            type="button"
                            onClick={() => {
                              setRestaurantQuery('');
                              setRestaurantFilter('ALL');
                            }}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black text-white transition hover:bg-slate-800"
                          >
                            Clear search & filters
                          </button>
                        }
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {filteredRestaurants.map((r) => (
                          <li
                            key={r.id}
                            className={`group relative -mx-2 flex flex-col gap-3 px-2 py-4 transition first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4 ${
                              r.is_approved ? 'hover:bg-slate-50/70' : 'bg-amber-50/40'
                            }`}
                          >
                            {/* Pending kitchens get a attention rail down the left edge */}
                            {!r.is_approved && (
                              <span
                                aria-hidden="true"
                                className="absolute inset-y-0 left-0 w-1 rounded-full bg-gradient-to-b from-amber-400 to-orange-500 sm:-left-2"
                              />
                            )}

                            {/* Identity: logo, name, cuisine, location, rating */}
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 text-xs font-black text-white shadow-md shadow-emerald-900/15 ring-1 ring-black/5">
                                {r.logo_url ? (
                                  <img
                                    src={r.logo_url}
                                    alt=""
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  monogram(r.name)
                                )}
                              </span>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <p className="truncate text-[13px] font-black text-slate-900">
                                    {r.name}
                                  </p>
                                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
                                    {r.cuisine_type}
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                      r.is_open
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-500'
                                    }`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        r.is_open ? 'bg-emerald-500' : 'bg-slate-400'
                                      }`}
                                    />
                                    {r.is_open ? 'Open' : 'Closed'}
                                  </span>
                                </div>

                                <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500">
                                  <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                                  <span className="truncate">
                                    {r.address}, {r.city}
                                  </span>
                                </p>

                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                  <span className="inline-flex items-center gap-1">
                                    <Phone className="h-3 w-3 text-slate-400" />
                                    {r.phone}
                                  </span>
                                  <span className="inline-flex items-center gap-1 font-bold text-amber-500">
                                    <Star className="h-3 w-3 fill-current" />
                                    {(r.rating || 0).toFixed(1)}
                                    <span className="font-normal text-slate-400">
                                      ({r.total_reviews || 0})
                                    </span>
                                  </span>
                                  <span className="hidden text-slate-400 md:inline">
                                    Joined{' '}
                                    {new Date(r.created_at).toLocaleDateString('en-GH', {
                                      day: 'numeric',
                                      month: 'short',
                                      year: 'numeric',
                                    })}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Status + actions */}
                            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${
                                  r.is_approved
                                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-500/20'
                                    : 'bg-amber-50 text-amber-700 ring-amber-500/25'
                                }`}
                              >
                                {r.is_approved ? (
                                  <CheckCircle className="h-3 w-3" />
                                ) : (
                                  <AlertCircle className="h-3 w-3" />
                                )}
                                {r.is_approved ? 'Approved' : 'Pending review'}
                              </span>

                              <Link
                                to={`/restaurant/${r.id}`}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900"
                              >
                                View
                                <ExternalLink className="h-3 w-3" />
                              </Link>

                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleRestaurantApproval(r.id, r.is_approved)
                                }
                                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-black transition active:scale-95 ${
                                  r.is_approved
                                    ? 'bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-600 hover:text-white hover:ring-rose-600'
                                    : 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700 hover:shadow-lg'
                                }`}
                              >
                                {r.is_approved ? 'Suspend' : 'Approve partner'}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionCard>
                </>
              )}

              {/* ================= COURIERS ================= */}
              {activeTab === 'COURIERS' && (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <SummaryTile
                      label="Riders registered"
                      value={String(couriers.length)}
                      icon={Users}
                      tone="sky"
                    />
                    <SummaryTile
                      label="Online right now"
                      value={String(onlineCouriers)}
                      icon={Bike}
                      tone="emerald"
                    />
                    <SummaryTile
                      label="Awaiting approval"
                      value={String(pendingCouriers)}
                      icon={AlertCircle}
                      tone="amber"
                    />
                    <SummaryTile
                      label="Documents pending"
                      value={String(pendingDocs)}
                      icon={FileCheck}
                      tone="violet"
                    />
                  </div>

                  <SectionCard
                    title="Courier verification"
                    subtitle="Review Ghana Card photos, licences and rider approvals"
                    action={
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-[11px] font-black text-sky-700 ring-1 ring-sky-500/15">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            onlineCouriers > 0 ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        {onlineCouriers} online · {couriers.length} total
                      </span>
                    }
                  >
                    <ListToolbar
                      query={courierQuery}
                      onQueryChange={setCourierQuery}
                      placeholder="Search rider, plate or email…"
                      ariaLabel="Search couriers"
                      filters={courierFilters}
                      activeKey={courierFilter}
                      onFilterChange={setCourierFilter}
                    />

                    {couriers.length === 0 ? (
                      <EmptyState
                        icon={Bike}
                        title="No couriers registered"
                        hint="Riders who sign up will land here with their Ghana Card and licence documents ready for review."
                      />
                    ) : filteredCouriers.length === 0 ? (
                      <EmptyState
                        icon={Search}
                        title="No riders match your search"
                        hint="Try a rider name, number plate or email — or clear the filters to see the whole fleet."
                        action={
                          <button
                            type="button"
                            onClick={() => {
                              setCourierQuery('');
                              setCourierFilter('ALL');
                            }}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black text-white transition hover:bg-slate-800"
                          >
                            Clear search & filters
                          </button>
                        }
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {filteredCouriers.map((c) => {
                          const docs = courierDocs.filter((d) => d.courier_id === c.id);
                          const photoDocs = docs.filter(
                            (d) =>
                              d.document_type === 'GHANA_CARD_FRONT' ||
                              d.document_type === 'GHANA_CARD_BACK'
                          );
                          const cardNumber = docs.find(
                            (d) => d.document_type === 'GHANA_CARD_FRONT'
                          )?.document_number;
                          const licenceNumber = docs.find(
                            (d) => d.document_type === 'DRIVING_LICENCE'
                          )?.document_number;
                          const status: CourierVerificationStatus =
                            c.verification_status || 'UNSUBMITTED';
                          const meta = VERIFICATION_META[status];
                          const isExpanded = expandedCourierId === c.id;
                          const riderName = c.profile?.full_name || 'Courier partner';

                          return (
                            <li
                              key={c.id}
                              className={`group relative -mx-2 px-2 py-4 transition first:pt-0 last:pb-0 ${
                                c.is_approved ? 'hover:bg-slate-50/70' : 'bg-amber-50/40'
                              }`}
                            >
                              {!c.is_approved && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 w-1 rounded-full bg-gradient-to-b from-amber-400 to-orange-500 sm:-left-2"
                                />
                              )}

                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                  <span className="relative shrink-0">
                                    <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 via-sky-500 to-indigo-600 text-xs font-black text-white shadow-md shadow-sky-900/15 ring-1 ring-black/5">
                                      {c.profile?.avatar_url ? (
                                        <img
                                          src={c.profile.avatar_url}
                                          alt=""
                                          className="h-full w-full object-cover"
                                          loading="lazy"
                                        />
                                      ) : (
                                        monogram(riderName)
                                      )}
                                    </span>
                                    <span
                                      className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                                        c.is_online ? 'bg-emerald-500' : 'bg-slate-300'
                                      }`}
                                    />
                                  </span>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <p className="truncate text-[13px] font-black text-slate-900">
                                        {riderName}
                                      </p>
                                      <span
                                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${meta.chipClass}`}
                                      >
                                        {meta.label}
                                      </span>
                                      <span
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                          c.is_online
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : 'bg-slate-100 text-slate-500'
                                        }`}
                                      >
                                        <span
                                          className={`h-1.5 w-1.5 rounded-full ${
                                            c.is_online
                                              ? 'animate-pulse bg-emerald-500'
                                              : 'bg-slate-400'
                                          }`}
                                        />
                                        {c.is_online ? 'Online' : 'Offline'}
                                      </span>
                                    </div>

                                    <p className="mt-1 truncate text-[11px] text-slate-400">
                                      {c.profile?.email}
                                    </p>

                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      <span className="rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-black tracking-wide text-slate-700">
                                        {c.vehicle_plate || 'NO PLATE'}
                                      </span>
                                      <span className="text-[11px] text-slate-500">
                                        {c.vehicle_type}
                                      </span>
                                    </div>

                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black tabular-nums text-slate-600">
                                        <CheckCircle className="h-3 w-3 text-emerald-500" />
                                        {c.total_deliveries} deliveries
                                      </span>
                                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black tabular-nums text-slate-600">
                                        <Star className="h-3 w-3 fill-current text-amber-500" />
                                        {(c.rating || 0).toFixed(1)}
                                      </span>
                                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                                        <FileCheck className="h-3 w-3 text-slate-400" />
                                        {photoDocs.length} photo
                                        {photoDocs.length === 1 ? '' : 's'}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedCourierId(isExpanded ? null : c.id)
                                    }
                                    aria-expanded={isExpanded}
                                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black transition ${
                                      isExpanded
                                        ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                                        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900'
                                    }`}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                    {isExpanded ? 'Hide documents' : 'Review documents'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleToggleCourierApproval(c.id, c.is_approved)
                                    }
                                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-black transition active:scale-95 ${
                                      c.is_approved
                                        ? 'bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-600 hover:text-white hover:ring-rose-600'
                                        : 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700 hover:shadow-lg'
                                    }`}
                                  >
                                    {c.is_approved ? 'Suspend' : 'Approve courier'}
                                  </button>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/40">
                                  <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
                                    <div className="space-y-1.5 rounded-2xl bg-white p-4 text-[12px] text-slate-600 ring-1 ring-slate-200/70">
                                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                                        Identity details
                                      </span>
                                      <p>
                                        <strong>Ghana Card:</strong>{' '}
                                        {cardNumber || 'Not provided'}
                                      </p>
                                      <p>
                                        <strong>Licence ID:</strong>{' '}
                                        {licenceNumber || 'Not provided'}
                                      </p>
                                      <p>
                                        <strong>Number plate:</strong>{' '}
                                        {c.vehicle_plate || 'Not provided'}
                                      </p>
                                      <p>
                                        <strong>Submitted:</strong>{' '}
                                        {c.verification_submitted_at
                                          ? new Date(
                                              c.verification_submitted_at
                                            ).toLocaleString('en-GH', {
                                              dateStyle: 'medium',
                                              timeStyle: 'short',
                                            })
                                          : '—'}
                                      </p>
                                      <p>
                                        <strong>Last review:</strong>{' '}
                                        {c.verification_reviewed_at
                                          ? new Date(
                                              c.verification_reviewed_at
                                            ).toLocaleString('en-GH', {
                                              dateStyle: 'medium',
                                              timeStyle: 'short',
                                            })
                                          : '—'}
                                      </p>
                                      <p className="pt-1 text-slate-500 italic">
                                        {meta.hint}
                                      </p>
                                      {c.verification_note && (
                                        <p className="text-slate-500 italic">
                                          {c.verification_note}
                                        </p>
                                      )}
                                    </div>

                                    <div className="space-y-2 md:col-span-2">
                                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                                        Ghana Card photos ({photoDocs.length})
                                      </span>
                                      {photoDocs.length === 0 ? (
                                        <p className="rounded-xl border border-dashed border-emerald-200 bg-white p-4 text-[11px] text-slate-500">
                                          No photos were uploaded for this courier yet.
                                        </p>
                                      ) : (
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                          {photoDocs.map((doc) => (
                                            <div
                                              key={doc.id}
                                              className="overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:shadow-lg hover:shadow-slate-900/10"
                                            >
                                              <DocumentImage
                                                document={doc}
                                                className="h-28 w-full object-cover"
                                              />
                                              <div className="p-2">
                                                <span className="block text-[10px] font-bold text-slate-700">
                                                  {doc.document_type.replace(/_/g, ' ')}
                                                </span>
                                                <span
                                                  className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                                    doc.status === 'APPROVED'
                                                      ? 'bg-emerald-100 text-emerald-800'
                                                      : doc.status === 'REJECTED'
                                                        ? 'bg-rose-100 text-rose-800'
                                                        : 'bg-amber-100 text-amber-800'
                                                  }`}
                                                >
                                                  {doc.status}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </SectionCard>
                </>
              )}

              {/* ================= LIVE ORDERS ================= */}
              {activeTab === 'ORDERS' && (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <SummaryTile
                      label="Total orders"
                      value={String(orders.length)}
                      icon={Receipt}
                      tone="sky"
                    />
                    <SummaryTile
                      label="In progress"
                      value={String(activeOrdersCount)}
                      icon={Bike}
                      tone="amber"
                    />
                    <SummaryTile
                      label="Completed"
                      value={String(completedOrdersCount)}
                      icon={CheckCircle}
                      tone="emerald"
                    />
                    <SummaryTile
                      label="Cancelled / failed"
                      value={String(cancelledOrdersCount)}
                      icon={AlertCircle}
                      tone="rose"
                    />
                  </div>

                  <SectionCard
                    title="Live order pipeline"
                    subtitle={`${orders.length} order${orders.length === 1 ? '' : 's'} · ${activeOrdersCount} moving right now`}
                    action={
                      <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 ring-1 ring-slate-200">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        Refreshes in realtime
                      </span>
                    }
                  >
                    <ListToolbar
                      query={orderQuery}
                      onQueryChange={setOrderQuery}
                      placeholder="Search order, kitchen or rider…"
                      ariaLabel="Search orders"
                      filters={orderFilters}
                      activeKey={orderFilter}
                      onFilterChange={setOrderFilter}
                    />

                    {orders.length === 0 ? (
                      <EmptyState
                        icon={Receipt}
                        title="No orders have been placed yet"
                        hint="New orders appear here the moment a customer checks out, with live status changes."
                      />
                    ) : filteredOrders.length === 0 ? (
                      <EmptyState
                        icon={Search}
                        title="No orders match your search"
                        hint="Try an order number, kitchen, rider or delivery area — or clear the filters."
                        action={
                          <button
                            type="button"
                            onClick={() => {
                              setOrderQuery('');
                              setOrderFilter('ALL');
                            }}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black text-white transition hover:bg-slate-800"
                          >
                            Clear search & filters
                          </button>
                        }
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {filteredOrders.map((o) => {
                          const inFlight = isActiveOrder(o.status);
                          // DB-computed financial snapshot for this order.
                          const fin = getOrderFinancials(o);
                          const isCancelledOrder = [
                            'CANCELLED',
                            'REJECTED',
                            'FAILED',
                          ].includes(o.status);
                          const refundedSoFar = priorRefundedOn(o.id);
                          const refundable = round2(
                            Math.max(0, fin.customerTotal - refundedSoFar)
                          );
                          const canRefund =
                            ['COMPLETED', 'PAID'].includes(o.payment_status) &&
                            refundable > 0;
                          const canSettleToProcessing =
                            ['DELIVERED', 'COMPLETED'].includes(o.status) &&
                            fin.settlementStatus === 'ELIGIBLE';
                          const canSettleToPaid =
                            ['DELIVERED', 'COMPLETED'].includes(o.status) &&
                            ['ELIGIBLE', 'PROCESSING'].includes(fin.settlementStatus);
                          return (
                            <li
                              key={o.id}
                              className={`group relative -mx-2 px-2 py-4 transition first:pt-0 last:pb-0 ${
                                inFlight
                                  ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                                  : 'hover:bg-slate-50/70'
                              }`}
                            >
                              {inFlight && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-teal-500 sm:-left-2"
                                />
                              )}

                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                  <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-400 via-violet-500 to-indigo-600 text-xs font-black text-white shadow-md shadow-violet-900/15 ring-1 ring-black/5">
                                    {o.restaurant?.logo_url ? (
                                      <img
                                        src={o.restaurant.logo_url}
                                        alt=""
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      monogram(o.restaurant?.name || 'KG')
                                    )}
                                  </span>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <p className="text-[13px] font-black tabular-nums text-slate-900">
                                        #{o.order_number}
                                      </p>
                                      <span
                                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${orderStatusStyle(
                                          o.status
                                        )}`}
                                      >
                                        <span
                                          className={`h-1.5 w-1.5 rounded-full ${orderStatusDot(
                                            o.status
                                          )} ${inFlight ? 'animate-pulse' : ''}`}
                                        />
                                        {o.status.replace(/_/g, ' ')}
                                      </span>
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${paymentStatusStyle(
                                          o.payment_status
                                        )}`}
                                      >
                                        {o.payment_status.replace(/_/g, ' ')}
                                      </span>
                                      <span
                                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600 ring-1 ring-slate-200"
                                        title="Settlement status — payment success alone never marks a restaurant as paid out"
                                      >
                                        {fin.settlementStatus.replace(/_/g, ' ')}
                                      </span>
                                    </div>

                                    <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500">
                                      <Store className="h-3 w-3 shrink-0 text-slate-400" />
                                      <span className="truncate font-bold text-slate-700">
                                        {o.restaurant?.name ?? 'Kitchen'}
                                      </span>
                                      <span className="text-slate-300">·</span>
                                      <span>{o.payment_method}</span>
                                    </p>

                                    <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500">
                                      <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                                      <span className="truncate">{o.delivery_address}</span>
                                    </p>

                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                                      <span className="inline-flex items-center gap-1">
                                        <Bike className="h-3 w-3" />
                                        {o.courier?.full_name ?? (
                                          <span className="font-bold text-amber-600">
                                            Unassigned
                                          </span>
                                        )}
                                      </span>
                                      <span>Placed {formatRelativeTime(o.created_at)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end sm:text-right">
                                  <span className="text-base font-black leading-none tabular-nums text-slate-900">
                                    {formatGHS(o.total_amount)}
                                  </span>
                                  <span className="text-[10px] font-bold tabular-nums text-slate-400">
                                    food {formatGHS(fin.foodSubtotal)} + delivery{' '}
                                    {formatGHS(fin.deliveryFee)}
                                    {fin.tip > 0 ? ` + tip ${formatGHS(fin.tip)}` : ''}
                                  </span>
                                  {isCancelledOrder ? (
                                    <span className="text-[10px] font-bold text-slate-400">
                                      cancelled — no commission charged
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold tabular-nums text-amber-600">
                                      commission {formatGHS(fin.commissionAmount)} (
                                      {fin.commissionRate}%) → restaurant{' '}
                                      {formatGHS(fin.restaurantNet)}
                                    </span>
                                  )}
                                  {refundedSoFar > 0 && (
                                    <span className="text-[10px] font-bold tabular-nums text-rose-600">
                                      refunded {formatGHS(refundedSoFar)} of{' '}
                                      {formatGHS(fin.customerTotal)}
                                    </span>
                                  )}

                                  {(canRefund ||
                                    canSettleToProcessing ||
                                    canSettleToPaid) && (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5 sm:justify-end">
                                      {canSettleToProcessing && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setSettlementConfirm({
                                              order: o,
                                              status: 'PROCESSING',
                                            })
                                          }
                                          className="rounded-lg bg-slate-900 px-2.5 py-1 text-[10px] font-black text-white transition hover:bg-slate-800"
                                        >
                                          Start payout
                                        </button>
                                      )}
                                      {canSettleToPaid && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setSettlementConfirm({ order: o, status: 'PAID' })
                                          }
                                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-black text-white transition hover:bg-emerald-700"
                                        >
                                          Mark paid
                                        </button>
                                      )}
                                      {canRefund && (
                                        <button
                                          type="button"
                                          onClick={() => openRefundDialog(o)}
                                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black text-rose-700 transition hover:bg-rose-100"
                                          title={`Refund up to ${formatGHS(refundable)} — commission reverses with it`}
                                        >
                                          <RotateCcw className="h-3 w-3" />
                                          Refund
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </SectionCard>
                </>
              )}
              {/* ================= SETTINGS ================= */}
              {activeTab === 'SETTINGS' && (
                <div className="space-y-6">
                  <SectionCard
                    title="Restaurant commission"
                    subtitle="Charged per order on the food subtotal only — never on the delivery fee, and never shown to the customer as a fee"
                    className="max-w-2xl"
                  >
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                      <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                          <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Current rate
                          </span>
                          <span className="block text-3xl font-black leading-tight text-slate-900">
                            {commissionSettings.restaurant_commission_percentage}%
                          </span>
                          <span className="block text-[11px] text-slate-500">
                            Applied to every new order's food subtotal
                          </span>
                        </div>
                        <div className="text-right text-[11px] text-slate-500">
                          <p>
                            Courier commission:{' '}
                            <strong className="text-slate-700">
                              {commissionSettings.courier_commission_percentage}%
                            </strong>{' '}
                            (keeps the full delivery fee)
                          </p>
                          <p>
                            Allowed range: 0–{MAX_RESTAURANT_COMMISSION_PERCENTAGE}%
                          </p>
                        </div>
                      </div>

                      <form onSubmit={requestCommissionSave} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start">
                        <div className="flex-1">
                          <label
                            htmlFor="commission_rate"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            New restaurant commission (%)
                          </label>
                          <input
                            id="commission_rate"
                            type="number"
                            min={0}
                            max={MAX_RESTAURANT_COMMISSION_PERCENTAGE}
                            step="0.5"
                            inputMode="decimal"
                            value={commissionDraft}
                            onChange={(e) => handleCommissionInput(e.target.value)}
                            aria-invalid={Boolean(commissionError)}
                            aria-describedby="commission_rate_hint"
                            className={INPUT_CLASS}
                          />
                          <p
                            id="commission_rate_hint"
                            className={`mt-1.5 text-[11px] font-bold ${
                              commissionError ? 'text-rose-600' : 'text-slate-400'
                            }`}
                          >
                            {commissionError ||
                              `A number between 0 and ${MAX_RESTAURANT_COMMISSION_PERCENTAGE}%.`}
                          </p>
                        </div>
                        <button
                          type="submit"
                          disabled={isSavingCommission}
                          className="mt-0.5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Review change
                        </button>
                      </form>
                    </div>

                    <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-xs leading-relaxed text-emerald-900">
                      <p className="font-black">
                        Example: a GH₵100.00 food order
                      </p>
                      <p className="mt-1 text-emerald-800">
                        Commission{' '}
                        {formatGHS(
                          round2(
                            (100 * commissionSettings.restaurant_commission_percentage) / 100
                          )
                        )}{' '}
                        · restaurant keeps{' '}
                        {formatGHS(
                          round2(
                            100 -
                              (100 * commissionSettings.restaurant_commission_percentage) / 100
                          )
                        )}{' '}
                        · customer still pays only food + delivery fee.
                      </p>
                    </div>

                    <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-[11px] leading-relaxed text-slate-500">
                      <li className="flex gap-2">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        A rate change applies to new orders only — every existing order keeps
                        the rate it was placed with.
                      </li>
                      <li className="flex gap-2">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        Cancelled and refunded orders never recognize commission.
                      </li>
                      <li className="flex gap-2">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        The database re-validates the value, so an out-of-range number is
                        rejected even if it reaches the API.
                      </li>
                    </ul>
                  </SectionCard>

                  <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <SectionCard
                    title="Delivery Pricing"
                    subtitle="Distance-based fees for every new order: base + (distance × rate), clamped by the floor and an optional cap"
                    className="max-w-2xl"
                  >
                    <form onSubmit={handleSavePricing} className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="base_fee"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            Base delivery fee (GH₵)
                          </label>
                          <input
                            id="base_fee"
                            type="number"
                            step="0.50"
                            value={pricingSettings.base_fee}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                base_fee: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={INPUT_CLASS}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="per_km_rate"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            Per kilometre rate (GH₵ / km)
                          </label>
                          <input
                            id="per_km_rate"
                            type="number"
                            step="0.10"
                            value={pricingSettings.per_km_rate}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                per_km_rate: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={INPUT_CLASS}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="min_fee"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            Minimum fee floor (GH₵)
                          </label>
                          <input
                            id="min_fee"
                            type="number"
                            step="0.50"
                            value={pricingSettings.min_fee}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                min_fee: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={INPUT_CLASS}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="max_fee"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            Maximum fee cap (GH₵){' '}
                            <span className="font-normal text-slate-400">— optional</span>
                          </label>
                          <input
                            id="max_fee"
                            type="number"
                            step="1.00"
                            min={pricingSettings.min_fee}
                            placeholder="No maximum"
                            value={pricingSettings.max_fee ?? ''}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                max_fee:
                                  e.target.value.trim() === ''
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                            className={INPUT_CLASS}
                          />
                          <p className="mt-1 text-[10px] text-slate-400">
                            Leave empty to charge the calculated fee with no ceiling.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="courier_earning_percentage"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            Courier earning (% of the delivery fee)
                          </label>
                          <input
                            id="courier_earning_percentage"
                            type="number"
                            step="1"
                            min={0}
                            max={100}
                            value={pricingSettings.courier_earning_percentage ?? 100}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                courier_earning_percentage: Math.min(
                                  100,
                                  Math.max(0, Number(e.target.value) || 0)
                                ),
                              })
                            }
                            className={INPUT_CLASS}
                          />
                        </div>
                        <div>
                          <span className="mb-1.5 block text-xs font-bold text-slate-600">
                            Courier commission
                          </span>
                          <div className={`${INPUT_CLASS} bg-slate-50 text-slate-500`}>
                            {round2(100 - (pricingSettings.courier_earning_percentage ?? 100))}%
                          </div>
                          <p className="mt-1 text-[10px] text-slate-400">
                            The restaurant never pays anything out of the delivery fee — this
                            only decides how the fee is split between courier and platform.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          type="submit"
                          disabled={isSavingSettings}
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                          {isSavingSettings ? 'Saving…' : 'Apply pricing rules'}
                        </button>
                        <span className="text-[11px] text-slate-400">
                          Applies to new quotes and orders only · pricing version{' '}
                          {pricingSettings.pricing_version ?? 1}
                        </span>
                      </div>
                    </form>
                  </SectionCard>

                  <aside className="space-y-4">
                    <div className={`${CARD} p-5`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600">
                        Live preview
                      </p>
                      <p className="mt-1 text-sm font-black text-slate-900">
                        A {SAMPLE_DISTANCE_KM} km delivery
                      </p>
                      <div className="mt-4 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-500">Delivery fee (customer pays)</span>
                          <span className="font-black tabular-nums text-slate-900">
                            {formatGHS(sampleFee)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-500">
                            Courier earns ({round2(100 - (pricingSettings.courier_earning_percentage ?? 100))}%
                            {' '}commission)
                          </span>
                          <span className="font-black tabular-nums text-emerald-700">
                            {formatGHS(courierSampleEarning)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-500">
                            Commission on a GH₵{sampleFoodOrder}.00 food order (
                            {commissionSettings.restaurant_commission_percentage}%)
                          </span>
                          <span className="font-black tabular-nums text-sky-700">
                            {formatGHS(sampleCommission)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
                        The customer pays food + delivery fee only. The delivery fee goes
                        entirely to the courier; SamleyGo's revenue is the commission on the
                        food subtotal.
                      </p>
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                        Floor {formatGHS(pricingSettings.min_fee)} ·{' '}
                        {pricingSettings.max_fee != null
                          ? `cap ${formatGHS(pricingSettings.max_fee)}`
                          : 'no maximum cap'}{' '}
                        · ×{pricingSettings.surge_multiplier ?? 1} surge
                      </p>
                    </div>

                    <div className={`${CARD} p-5`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                        How fees are calculated
                      </p>
                      <ul className="mt-3 space-y-2.5 text-[11px] leading-relaxed text-slate-500">
                        <li className="flex gap-2">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          Base fee + (distance × per-kilometre rate)
                        </li>
                        <li className="flex gap-2">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          Distance is measured restaurant → customer on the real road route
                          whenever the mapping service can provide one
                        </li>
                        <li className="flex gap-2">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          Result is clamped by the minimum floor and the optional maximum cap
                        </li>
                        <li className="flex gap-2">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          Surge multiplier is applied before the cap is enforced
                        </li>
                      </ul>
                    </div>
                  </aside>
                  </div>
                </div>
              )}

              {/* ================= ERRANDS & ON-DEMAND RIDES ================= */}
              {activeTab === 'ERRANDS' && (
                <div className="space-y-6">
                  {/* ===== A. Module status + real metrics ===== */}
                  <SectionCard
                    title="Errands & On-Demand Rides — module status"
                    subtitle="Every figure is computed from the 200 most recent bookings; fare volume and driver earnings count COMPLETED trips only (that is when money settles)"
                    action={
                      <button
                        type="button"
                        onClick={fetchErrandsData}
                        disabled={isErrandsLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isErrandsLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    }
                  >
                    {/* Config summary chips */}
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      {errandsConfig ? (
                        <>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black ring-1 ${
                              errandsConfig.enabled
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-500/20'
                                : 'bg-slate-100 text-slate-600 ring-slate-200'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                errandsConfig.enabled ? 'bg-emerald-500' : 'bg-slate-400'
                              }`}
                            />
                            Module {errandsConfig.enabled ? 'on' : 'off'}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black ring-1 ${
                              errandsConfig.services.ERRAND_MOTORCYCLE
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-500/20'
                                : 'bg-slate-100 text-slate-600 ring-slate-200'
                            }`}
                          >
                            Motorcycle errands{' '}
                            {errandsConfig.services.ERRAND_MOTORCYCLE ? 'on' : 'off'}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black ring-1 ${
                              errandsConfig.services.RIDE_CAR
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-500/20'
                                : 'bg-slate-100 text-slate-600 ring-slate-200'
                            }`}
                          >
                            Passenger rides {errandsConfig.services.RIDE_CAR ? 'on' : 'off'}
                          </span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-500 ring-1 ring-slate-200">
                          Service switches —
                        </span>
                      )}
                      {errandsPricing ? (
                        errandsPricing.configured ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-500/20">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Pricing configured · v{errandsPricing.pricingVersion}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-700 ring-1 ring-amber-500/25">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Pricing NOT configured
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-500 ring-1 ring-slate-200">
                          Pricing —
                        </span>
                      )}
                    </div>
                    {errandsPricing && !errandsPricing.configured && (
                      <p className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold leading-relaxed text-amber-800">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        Customers cannot see a fare until pricing is saved below.
                      </p>
                    )}

                    {isErrandsLoading ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                        {[
                          'Active trips',
                          'Completed',
                          'Completed (7 days)',
                          'Cancelled',
                          'Completed fare volume',
                          'Driver earnings paid',
                        ].map((label) => (
                          <SummaryTile
                            key={label}
                            label={label}
                            value="—"
                            icon={Bike}
                            tone="sky"
                          />
                        ))}
                      </div>
                    ) : errandsBookings.length === 0 ? (
                      <EmptyState
                        icon={Package}
                        title="No Errands bookings yet."
                        hint="Real trips booked by customers will appear here — this console never shows placeholder totals."
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                          <SummaryTile
                            label="Active trips"
                            value={String(errandsStats.active)}
                            icon={Bike}
                            tone="sky"
                          />
                          <SummaryTile
                            label="Completed"
                            value={String(errandsStats.completed)}
                            icon={CheckCircle}
                            tone="emerald"
                          />
                          <SummaryTile
                            label="Completed (7 days)"
                            value={String(errandsStats.completedLast7Days)}
                            icon={Receipt}
                            tone="sky"
                          />
                          <SummaryTile
                            label="Cancelled"
                            value={String(errandsStats.cancelled)}
                            icon={X}
                            tone="rose"
                          />
                          <SummaryTile
                            label="Completed fare volume"
                            value={formatGHS(errandsStats.completedFareVolume)}
                            icon={Wallet}
                            tone="emerald"
                          />
                          <SummaryTile
                            label="Driver earnings paid"
                            value={formatGHS(errandsStats.driverEarningsPaid)}
                            icon={Car}
                            tone="violet"
                          />
                        </div>
                        <p className="mt-3 text-[11px] text-slate-400">
                          {errandsStats.expired} expired · {errandsStats.failed} failed ·{' '}
                          {errandsBookings.length} booking
                          {errandsBookings.length === 1 ? '' : 's'} in view (newest 200)
                        </p>
                      </>
                    )}
                  </SectionCard>

                  {/* ===== B. Service switches ===== */}
                  <SectionCard
                    title="Service switches"
                    subtitle="The master switch plus the two service categories customers can book — saved through set_errands_config and audited by the database"
                  >
                    {errandsConfig ? (
                      <form onSubmit={handleSaveErrandsConfig} className="space-y-4">
                        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                          <Switch
                            id="errands_module_enabled"
                            label="Errands module enabled"
                            hint="When the module is off, neither motorcycle errands nor passenger rides can be quoted or booked."
                            checked={errandsConfigDraft.enabled}
                            disabled={isSavingErrandsConfig}
                            onChange={(next) =>
                              setErrandsConfigDraft((d) => ({ ...d, enabled: next }))
                            }
                          />
                          <div className="border-t border-slate-200 pt-4">
                            <Switch
                              id="errands_service_motorcycle"
                              label="Motorcycle errands (ERRAND_MOTORCYCLE)"
                              hint="Parcels, food and small deliveries across town."
                              checked={errandsConfigDraft.motorcycle}
                              disabled={isSavingErrandsConfig}
                              onChange={(next) =>
                                setErrandsConfigDraft((d) => ({ ...d, motorcycle: next }))
                              }
                            />
                          </div>
                          <div className="border-t border-slate-200 pt-4">
                            <Switch
                              id="errands_service_ride_car"
                              label="Passenger rides (RIDE_CAR)"
                              hint={
                                <span className="flex gap-1.5 text-amber-700">
                                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  Passenger rides must only be enabled after the operational and
                                  regulatory requirements for carrying passengers have been
                                  reviewed.
                                </span>
                              }
                              checked={errandsConfigDraft.rideCar}
                              disabled={isSavingErrandsConfig}
                              onChange={(next) =>
                                setErrandsConfigDraft((d) => ({ ...d, rideCar: next }))
                              }
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="submit"
                            disabled={isSavingErrandsConfig}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle className="h-4 w-4" />
                            {isSavingErrandsConfig ? 'Saving…' : 'Save service switches'}
                          </button>
                          <span className="text-[11px] text-slate-400">
                            Applies immediately to new quotes · current:{' '}
                            {errandsConfig.enabled ? 'module on' : 'module off'}
                          </span>
                        </div>
                      </form>
                    ) : (
                      <EmptyState
                        icon={AlertCircle}
                        title="Service switches unavailable"
                        hint="The configuration could not be loaded — connect Supabase and make sure the Errands migration is applied, then refresh."
                      />
                    )}
                  </SectionCard>

                  {/* ===== C. Fare rules ===== */}
                  <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <SectionCard
                      title="Fare rules"
                      subtitle="Base + (distance × per-km), clamped by the floor and an optional ceiling, then booking fee, tax and the driver's share"
                    >
                      {errandsPricing && !errandsPricing.configured && (
                        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold leading-relaxed text-amber-800">
                              Fare rules have not been configured yet.
                            </p>
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                              {ERRANDS_PRICING_UNCONFIGURED_MESSAGE}
                            </p>
                            <p className="mt-1 text-[11px] font-bold leading-relaxed text-amber-800">
                              Customers cannot see a fare until pricing is saved below.
                            </p>
                          </div>
                        </div>
                      )}

                      <form onSubmit={handleSaveErrandsPricing} className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label htmlFor="errands_base_fare" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Base fare (GH₵)
                            </label>
                            <input
                              id="errands_base_fare"
                              type="number"
                              step="0.50"
                              min={0}
                              max={9999.99}
                              value={errandsPricingDraft.baseFare}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({ ...d, baseFare: e.target.value }))
                              }
                              className={INPUT_CLASS}
                            />
                          </div>
                          <div>
                            <label htmlFor="errands_per_km" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Price per kilometre (GH₵ / km)
                            </label>
                            <input
                              id="errands_per_km"
                              type="number"
                              step="0.10"
                              min={0}
                              max={9999.99}
                              value={errandsPricingDraft.perKmRate}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({ ...d, perKmRate: e.target.value }))
                              }
                              className={INPUT_CLASS}
                            />
                          </div>
                          <div>
                            <label htmlFor="errands_min_fare" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Minimum fare floor (GH₵)
                            </label>
                            <input
                              id="errands_min_fare"
                              type="number"
                              step="0.50"
                              min={0}
                              value={errandsPricingDraft.minFare}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({ ...d, minFare: e.target.value }))
                              }
                              className={INPUT_CLASS}
                            />
                            <p className="mt-1 text-[10px] text-slate-400">
                              0 means no floor.
                            </p>
                          </div>
                          <div>
                            <label htmlFor="errands_max_fare" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Maximum fare cap (GH₵){' '}
                              <span className="font-normal text-slate-400">— optional</span>
                            </label>
                            <input
                              id="errands_max_fare"
                              type="number"
                              step="1.00"
                              min={0}
                              placeholder="No maximum"
                              value={errandsPricingDraft.maxFare}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({ ...d, maxFare: e.target.value }))
                              }
                              className={INPUT_CLASS}
                            />
                            <p className="mt-1 text-[10px] text-slate-400">
                              Leave empty to charge the calculated fare with no ceiling.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                          <div>
                            <label htmlFor="errands_booking_fee" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Booking fee (GH₵)
                            </label>
                            <input
                              id="errands_booking_fee"
                              type="number"
                              step="0.50"
                              min={0}
                              max={9999.99}
                              value={errandsPricingDraft.bookingFee}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({ ...d, bookingFee: e.target.value }))
                              }
                              className={INPUT_CLASS}
                            />
                            <p className="mt-1 text-[10px] text-slate-400">
                              Added after the clamp, then taxed with the trip fare.
                            </p>
                          </div>
                          <div>
                            <label htmlFor="errands_tax_rate" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Tax rate (%)
                            </label>
                            <input
                              id="errands_tax_rate"
                              type="number"
                              step="0.5"
                              min={0}
                              max={100}
                              value={errandsPricingDraft.taxRatePercent}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({ ...d, taxRatePercent: e.target.value }))
                              }
                              className={INPUT_CLASS}
                            />
                          </div>
                          <div>
                            <label htmlFor="errands_earning_pct" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Driver earning (% of the total the customer pays)
                            </label>
                            <input
                              id="errands_earning_pct"
                              type="number"
                              step="1"
                              min={0}
                              max={100}
                              value={errandsPricingDraft.driverEarningPercentage}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({
                                  ...d,
                                  driverEarningPercentage: e.target.value,
                                }))
                              }
                              className={INPUT_CLASS}
                            />
                          </div>
                          <div>
                            <label htmlFor="errands_surge" className="mb-1.5 block text-xs font-bold text-slate-600">
                              Surge multiplier
                            </label>
                            <input
                              id="errands_surge"
                              type="number"
                              step="0.1"
                              min={0.1}
                              max={5}
                              value={errandsPricingDraft.surgeMultiplier}
                              onChange={(e) =>
                                setErrandsPricingDraft((d) => ({ ...d, surgeMultiplier: e.target.value }))
                              }
                              className={INPUT_CLASS}
                            />
                            <p className="mt-1 text-[10px] text-slate-400">
                              Between 0.1 and 5 — use 1 when surge pricing is not in effect.
                            </p>
                          </div>
                        </div>

                        {errandsPricingFormError && (
                          <p className="text-[11px] font-bold text-rose-600">
                            {errandsPricingFormError}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <button
                            type="submit"
                            disabled={isSavingErrandsPricing}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle className="h-4 w-4" />
                            {isSavingErrandsPricing ? 'Saving…' : 'Apply fare rules'}
                          </button>
                          <span className="text-[11px] text-slate-400">
                            Applies to new quotes and bookings only ·{' '}
                            {errandsPricing?.configured
                              ? `pricing version ${errandsPricing.pricingVersion}`
                              : 'not configured yet'}
                          </span>
                        </div>
                      </form>
                    </SectionCard>

                    <aside className="space-y-4">
                      <div className={`${CARD} p-5`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600">
                          Live preview
                        </p>
                        <p className="mt-1 text-sm font-black text-slate-900">
                          A {Number.isFinite(errandsPreviewKm) && errandsPreviewKm > 0 ? errandsPreviewKm : 0} km trip
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <input
                            id="errands_preview_km"
                            type="number"
                            min={0.1}
                            step="0.5"
                            inputMode="decimal"
                            value={errandsPreviewKmInput}
                            onChange={(e) => setErrandsPreviewKmInput(e.target.value)}
                            aria-label="Preview distance in kilometres"
                            className={INPUT_CLASS}
                          />
                          <div className="flex shrink-0 gap-1.5">
                            {[5, 10].map((km) => (
                              <button
                                key={km}
                                type="button"
                                onClick={() => setErrandsPreviewKmInput(String(km))}
                                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black transition ${
                                  errandsPreviewKm === km
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                {km} km
                              </button>
                            ))}
                          </div>
                        </div>
                        {errandsPreview ? (
                          <div className="mt-4 space-y-2.5 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-500">Trip fare (after floor/cap)</span>
                              <span className="font-black tabular-nums text-slate-900">
                                {formatGHS(errandsPreview.tripFare)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-500">Booking fee</span>
                              <span className="font-black tabular-nums text-slate-900">
                                {formatGHS(errandsPreview.bookingFee)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-500">
                                Tax ({errandsPreviewSettings.taxRatePercent}%)
                              </span>
                              <span className="font-black tabular-nums text-slate-900">
                                {formatGHS(errandsPreview.taxAmount)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
                              <span className="font-bold text-slate-700">Customer pays</span>
                              <span className="text-base font-black tabular-nums text-slate-900">
                                {formatGHS(errandsPreview.total)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-500">
                                Driver earns ({errandsPreviewSettings.driverEarningPercentage}%)
                              </span>
                              <span className="font-black tabular-nums text-emerald-700">
                                {formatGHS(errandsPreview.driverEarning)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-4 text-[11px] font-bold text-amber-600">
                            Enter a distance above 0 km to preview these rules.
                          </p>
                        )}
                        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
                          Preview only — it applies the formula in
                          {' '}<code className="font-bold">errands/pricing.ts</code> to the numbers
                          typed above. The price a customer sees is always computed by the server
                          for their real route.
                        </p>
                        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                          Floor {formatGHS(errandsPreviewSettings.minFare)} ·{' '}
                          {errandsPreviewSettings.maxFare !== null
                            ? `cap ${formatGHS(errandsPreviewSettings.maxFare)}`
                            : 'no maximum cap'}{' '}
                          · ×{errandsPreviewSettings.surgeMultiplier} surge
                        </p>
                      </div>

                      <div className={`${CARD} p-5`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em]">
                          How fares are calculated
                        </p>
                        <ul className="mt-3 space-y-2.5 text-[11px] leading-relaxed text-slate-500">
                          <li className="flex gap-2">
                            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            Trip fare = (base + km × per-km rate) × surge, clamped by the floor
                            and the optional cap
                          </li>
                          <li className="flex gap-2">
                            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            Booking fee is added after the clamp, so the minimum fare never
                            swallows it
                          </li>
                          <li className="flex gap-2">
                            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            Tax applies to trip fare + booking fee; the driver's share is a
                            percentage of the customer's total
                          </li>
                          <li className="flex gap-2">
                            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            A rate change bumps the pricing version — existing bookings keep the
                            rules they were priced with
                          </li>
                        </ul>
                      </div>
                    </aside>
                  </div>

                  {/* ===== D. Bookings ===== */}
                  <SectionCard
                    title="Bookings"
                    subtitle={`${errandsBookings.length} most recent booking${errandsBookings.length === 1 ? '' : 's'} · ${errandsStats.active} active right now`}
                  >
                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="relative w-full lg:max-w-xs">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          type="search"
                          value={errandsQuery}
                          onChange={(e) => setErrandsQuery(e.target.value)}
                          placeholder="Search booking number or area…"
                          aria-label="Search Errands bookings"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs font-bold text-slate-900 transition placeholder:font-medium placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                      <select
                        value={errandsStatusFilter}
                        onChange={(e) =>
                          setErrandsStatusFilter(e.target.value as 'ALL' | ErrandsBookingStatus)
                        }
                        aria-label="Filter bookings by status"
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      >
                        <option value="ALL">All statuses</option>
                        {(
                          [
                            'REQUESTED',
                            'DRIVER_ACCEPTED',
                            'DRIVER_ARRIVING',
                            'DRIVER_ARRIVED',
                            'IN_PROGRESS',
                            'COMPLETED',
                            'CANCELLED',
                            'EXPIRED',
                            'FAILED',
                          ] as ErrandsBookingStatus[]
                        ).map((status) => (
                          <option key={status} value={status}>
                            {ERRANDS_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isErrandsLoading ? (
                      <div className="space-y-3">
                        <SkeletonBlock className="h-16 w-full" />
                        <SkeletonBlock className="h-16 w-full" />
                        <SkeletonBlock className="h-16 w-full" />
                      </div>
                    ) : errandsBookings.length === 0 ? (
                      <EmptyState
                        icon={Package}
                        title="No Errands bookings yet."
                        hint="Trips booked by customers appear here the moment the first one is placed."
                      />
                    ) : filteredErrandsBookings.length === 0 ? (
                      <EmptyState
                        icon={Search}
                        title="No bookings match your search"
                        hint="Try a booking number or an area — or clear the search and filter."
                        action={
                          <button
                            type="button"
                            onClick={() => {
                              setErrandsQuery('');
                              setErrandsStatusFilter('ALL');
                            }}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black text-white transition hover:bg-slate-800"
                          >
                            Clear search & filters
                          </button>
                        }
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {filteredErrandsBookings.map((b) => {
                          const live = errandsStatusIsLive(b.status);
                          const isExpanded = errandsExpandedId === b.id;
                          const ServiceIcon =
                            b.serviceCategory === 'RIDE_CAR' ? Car : Package;
                          return (
                            <li
                              key={b.id}
                              className={`group relative -mx-2 px-2 py-4 transition first:pt-0 last:pb-0 ${
                                live
                                  ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                                  : 'hover:bg-slate-50/70'
                              }`}
                            >
                              {live && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-teal-500 sm:-left-2"
                                />
                              )}

                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                                    <ServiceIcon className="h-4 w-4" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <p className="text-[13px] font-black tabular-nums text-slate-900">
                                        {b.bookingNumber || shortId(b.id)}
                                      </p>
                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600 ring-1 ring-slate-200">
                                        {ERRANDS_SERVICE_LABELS[b.serviceCategory]}
                                      </span>
                                      <span
                                        title={ERRANDS_STATUS_LABELS[b.status]}
                                        className={`inline-flex max-w-[240px] items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${errandsStatusStyle(
                                          b.status
                                        )}`}
                                      >
                                        <span
                                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${errandsStatusDot(
                                            b.status
                                          )} ${live ? 'animate-pulse' : ''}`}
                                        />
                                        <span className="truncate">
                                          {ERRANDS_STATUS_LABELS[b.status]}
                                        </span>
                                      </span>
                                    </div>

                                    <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500">
                                      <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                                      <span className="truncate font-bold text-slate-700">
                                        {b.pickupArea ?? '—'}
                                      </span>
                                      <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
                                      <span className="truncate font-bold text-slate-700">
                                        {b.destinationArea ?? '—'}
                                      </span>
                                    </p>

                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                                      <span>
                                        {b.routeDistanceKm.toFixed(1)} km ·{' '}
                                        {b.distanceSource === 'ROAD_ROUTE'
                                          ? 'road route'
                                          : 'straight line'}
                                      </span>
                                      <span>Placed {formatRelativeTime(b.createdAt)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end sm:text-right">
                                  <span className="text-base font-black leading-none tabular-nums text-slate-900">
                                    {formatGHS(b.finalFare ?? b.estimatedFare)}
                                  </span>
                                  <span className="text-[10px] font-bold tabular-nums text-emerald-700">
                                    driver {formatGHS(b.driverEarning)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleErrandsBookingDetails(b)}
                                    aria-expanded={isExpanded}
                                    className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 transition hover:bg-slate-50"
                                  >
                                    {isExpanded ? 'Hide details' : 'View details'}
                                    <ChevronDown
                                      className={`h-3 w-3 transition-transform ${
                                        isExpanded ? 'rotate-180' : ''
                                      }`}
                                    />
                                  </button>
                                </div>
                              </div>

                              {/* ---- Expanded: everything on the row + details + history ---- */}
                              {isExpanded && errandsExpanded && (
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                  {errandsExpanded.loading ? (
                                    <div className="space-y-2" role="status">
                                      <SkeletonBlock className="h-3 w-1/3" />
                                      <SkeletonBlock className="h-3 w-1/2" />
                                      <SkeletonBlock className="h-3 w-2/3" />
                                      <span className="sr-only">Loading booking details…</span>
                                    </div>
                                  ) : (
                                    <>
                                      {errandsExpanded.error && (
                                        <p className="mb-3 text-[11px] font-bold text-rose-600">
                                          {errandsExpanded.error}
                                        </p>
                                      )}

                                      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Booking ID</dt>
                                          <dd className="font-bold tabular-nums text-slate-700" title={b.id}>
                                            {shortId(b.id)}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Service</dt>
                                          <dd className="font-bold text-slate-700">
                                            {ERRANDS_SERVICE_LABELS[b.serviceCategory]}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Customer</dt>
                                          <dd className="font-bold tabular-nums text-slate-700" title={b.customerId}>
                                            {shortId(b.customerId)}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Driver</dt>
                                          <dd className="font-bold tabular-nums text-slate-700" title={b.driverId}>
                                            {shortId(b.driverId)}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Distance</dt>
                                          <dd className="font-bold tabular-nums text-slate-700">
                                            {b.routeDistanceKm.toFixed(2)} km ·{' '}
                                            {b.distanceSource === 'ROAD_ROUTE'
                                              ? 'road route'
                                              : 'straight line'}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Estimated duration</dt>
                                          <dd className="font-bold tabular-nums text-slate-700">
                                            {b.estimatedDurationSeconds
                                              ? `${Math.max(1, Math.round(b.estimatedDurationSeconds / 60))} min`
                                              : '—'}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Estimated fare</dt>
                                          <dd className="font-bold tabular-nums text-slate-700">
                                            {formatGHS(b.estimatedFare)}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Final fare</dt>
                                          <dd className="font-bold tabular-nums text-slate-700">
                                            {b.finalFare !== null
                                              ? formatGHS(b.finalFare)
                                              : '— (not completed)'}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Driver earning</dt>
                                          <dd className="font-bold tabular-nums text-emerald-700">
                                            {formatGHS(b.driverEarning)}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Pricing version</dt>
                                          <dd className="font-bold tabular-nums text-slate-700">
                                            v{b.pricingVersion} · {b.currency}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Quote</dt>
                                          <dd className="font-bold tabular-nums text-slate-700" title={b.quoteId ?? ''}>
                                            {shortId(b.quoteId)}
                                          </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                          <dt className="text-slate-500">Placed</dt>
                                          <dd className="font-bold tabular-nums text-slate-700">
                                            {new Date(b.createdAt).toLocaleString('en-GH', {
                                              dateStyle: 'medium',
                                              timeStyle: 'short',
                                            })}
                                          </dd>
                                        </div>
                                        {b.acceptedAt && (
                                          <div className="flex items-center justify-between gap-3">
                                            <dt className="text-slate-500">Accepted</dt>
                                            <dd className="font-bold tabular-nums text-slate-700">
                                              {formatRelativeTime(b.acceptedAt)}
                                            </dd>
                                          </div>
                                        )}
                                        {b.startedAt && (
                                          <div className="flex items-center justify-between gap-3">
                                            <dt className="text-slate-500">Started</dt>
                                            <dd className="font-bold tabular-nums text-slate-700">
                                              {formatRelativeTime(b.startedAt)}
                                            </dd>
                                          </div>
                                        )}
                                        {b.completedAt && (
                                          <div className="flex items-center justify-between gap-3">
                                            <dt className="text-slate-500">Completed</dt>
                                            <dd className="font-bold tabular-nums text-slate-700">
                                              {formatRelativeTime(b.completedAt)}
                                            </dd>
                                          </div>
                                        )}
                                        {b.cancellationReason && (
                                          <div className="flex items-center justify-between gap-3">
                                            <dt className="text-slate-500">Cancellation reason</dt>
                                            <dd className="text-right font-bold text-slate-700">
                                              {b.cancellationReason}
                                            </dd>
                                          </div>
                                        )}
                                        {b.failureNote && (
                                          <div className="flex items-center justify-between gap-3">
                                            <dt className="text-slate-500">Failure note</dt>
                                            <dd className="text-right font-bold text-slate-700">
                                              {b.failureNote}
                                            </dd>
                                          </div>
                                        )}
                                      </dl>

                                      {/* Exact endpoints + contacts (admins may see them) */}
                                      <div className="mt-4 border-t border-slate-200 pt-3">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                          Route &amp; contacts
                                        </p>
                                        {errandsExpanded.details ? (
                                          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                                            <div className="flex items-start justify-between gap-3">
                                              <dt className="shrink-0 text-slate-500">Pickup</dt>
                                              <dd className="text-right font-bold text-slate-700">
                                                {errandsExpanded.details.pickupAddress ?? '—'}
                                                {errandsExpanded.details.pickupLatitude !== null &&
                                                  errandsExpanded.details.pickupLongitude !== null && (
                                                    <span className="block text-[10px] font-medium text-slate-400">
                                                      {errandsExpanded.details.pickupLatitude.toFixed(5)},{' '}
                                                      {errandsExpanded.details.pickupLongitude.toFixed(5)}
                                                    </span>
                                                  )}
                                              </dd>
                                            </div>
                                            <div className="flex items-start justify-between gap-3">
                                              <dt className="shrink-0 text-slate-500">Destination</dt>
                                              <dd className="text-right font-bold text-slate-700">
                                                {errandsExpanded.details.destinationAddress ?? '—'}
                                                {errandsExpanded.details.destinationLatitude !== null &&
                                                  errandsExpanded.details.destinationLongitude !== null && (
                                                    <span className="block text-[10px] font-medium text-slate-400">
                                                      {errandsExpanded.details.destinationLatitude.toFixed(5)},{' '}
                                                      {errandsExpanded.details.destinationLongitude.toFixed(5)}
                                                    </span>
                                                  )}
                                              </dd>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <dt className="text-slate-500">Customer</dt>
                                              <dd className="text-right font-bold text-slate-700">
                                                {errandsExpanded.details.customerName ?? '—'}
                                                {errandsExpanded.details.customerPhone && (
                                                  <span className="block text-[10px] font-medium text-slate-500">
                                                    {errandsExpanded.details.customerPhone}
                                                  </span>
                                                )}
                                              </dd>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <dt className="text-slate-500">Driver</dt>
                                              <dd className="text-right font-bold text-slate-700">
                                                {errandsExpanded.details.driverName ?? '—'}
                                                <span className="block text-[10px] font-medium text-slate-500">
                                                  {[
                                                    errandsExpanded.details.driverVehicleType,
                                                    errandsExpanded.details.driverVehiclePlate,
                                                  ]
                                                    .filter(Boolean)
                                                    .join(' · ') || 'Vehicle on file: —'}
                                                </span>
                                              </dd>
                                            </div>
                                          </dl>
                                        ) : (
                                          <p className="mt-2 text-[11px] text-slate-400">
                                            No exact addresses or contacts are on file for this
                                            booking.
                                          </p>
                                        )}
                                      </div>

                                      {/* Status history (audit trail) */}
                                      <div className="mt-4 border-t border-slate-200 pt-3">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                          Status history
                                        </p>
                                        {errandsExpanded.history.length === 0 ? (
                                          <p className="mt-2 text-[11px] text-slate-400">
                                            No status history recorded for this booking.
                                          </p>
                                        ) : (
                                          <ol className="mt-2 space-y-1.5">
                                            {errandsExpanded.history.map((entry) => (
                                              <li
                                                key={entry.id}
                                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600"
                                              >
                                                <span className="font-bold text-slate-700">
                                                  {entry.from_status
                                                    ? `${entry.from_status.replace(/_/g, ' ')} → `
                                                    : ''}
                                                  {entry.to_status.replace(/_/g, ' ')}
                                                </span>
                                                <span className="text-slate-400">
                                                  {entry.actor?.full_name
                                                    ? `by ${entry.actor.full_name}${
                                                        entry.actor.role
                                                          ? ` (${entry.actor.role.replace(/_/g, ' ')})`
                                                          : ''
                                                      }`
                                                    : ''}
                                                </span>
                                                {entry.note && (
                                                  <span className="text-slate-400">
                                                    — {entry.note}
                                                  </span>
                                                )}
                                                <span className="ml-auto text-slate-400">
                                                  {entry.created_at
                                                    ? formatRelativeTime(entry.created_at)
                                                    : ''}
                                                </span>
                                              </li>
                                            ))}
                                          </ol>
                                        )}
                                      </div>

                                      {canTransition(b.status, 'CANCELLED', 'ADMIN') && (
                                        <div className="mt-4 border-t border-slate-200 pt-3">
                                          <button
                                            type="button"
                                            onClick={() => setErrandsCancelTarget(b)}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-700 transition hover:bg-rose-100"
                                            title="Admin cancellation uses the same validated transition as drivers and customers"
                                          >
                                            <X className="h-3 w-3" />
                                            Cancel booking
                                          </button>
                                          <p className="mt-1.5 text-[10px] text-slate-400">
                                            Only allowed while the driver can still decline —
                                            in-progress trips must be failed instead.
                                          </p>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </SectionCard>

                  {/* ===== E. Driver services ===== */}
                  <SectionCard
                    title="Driver services"
                    subtitle="Errands opt-in is the driver's own decision; the motorcycle-errand and passenger-ride categories are granted by super admin only"
                  >
                    {couriers.length === 0 ? (
                      <EmptyState
                        icon={Users}
                        title="No drivers registered yet"
                        hint="Approved couriers show up here with their Errands service categories."
                      />
                    ) : errandsCapabilities.length === 0 ? (
                      <EmptyState
                        icon={Bike}
                        title="No driver has an Errands capability yet"
                        hint="A driver becomes listed here once they opt in to Errands from their driver app — until then there is nothing to grant or withdraw."
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {couriers.map((c) => {
                          const cap = errandsCapabilityByCourier.get(c.id);
                          const isSaving = savingCapabilityId === c.id;
                          const driverName =
                            c.profile?.full_name || c.profile?.email || `Driver ${shortId(c.id)}`;
                          return (
                            <li key={c.id} className="py-4 first:pt-0 last:pb-0">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-[11px] font-black text-white ring-1 ring-emerald-600/20">
                                    {c.profile?.avatar_url ? (
                                      <img
                                        src={c.profile.avatar_url}
                                        alt=""
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      monogram(driverName)
                                    )}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-[13px] font-black text-slate-900">
                                      {driverName}
                                    </p>
                                    <p className="truncate text-[11px] text-slate-500">
                                      {c.vehicle_type || 'Vehicle not set'}
                                      {c.vehicle_plate ? ` · ${c.vehicle_plate}` : ''}
                                    </p>
                                  </div>
                                </div>
                                <span
                                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black ring-1 ${
                                    cap?.errandsEnabled
                                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-500/20'
                                      : 'bg-slate-100 text-slate-500 ring-slate-200'
                                  }`}
                                  title="Opting in to Errands discovery is the driver's own decision — it cannot be granted from here"
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      cap?.errandsEnabled ? 'bg-emerald-500' : 'bg-slate-400'
                                    }`}
                                  />
                                  Errands opted-in: {cap?.errandsEnabled ? 'Yes' : 'No'}
                                  {cap ? '' : ' (no capability row)'}
                                </span>
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                                <Switch
                                  id={`cap_motorcycle_${c.id}`}
                                  label="Motorcycle errands"
                                  hint="Parcels, food and small deliveries."
                                  checked={cap?.motorcycleErrands ?? false}
                                  disabled={isSaving}
                                  onChange={(next) =>
                                    handleSaveErrandsCapability(
                                      c.id,
                                      next,
                                      cap?.carRides ?? false
                                    )
                                  }
                                />
                                <Switch
                                  id={`cap_car_${c.id}`}
                                  label="Passenger rides"
                                  hint={
                                    <span className="flex gap-1.5 text-amber-700">
                                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      Passenger rides must only be enabled after the operational
                                      and regulatory requirements for carrying passengers have
                                      been reviewed.
                                    </span>
                                  }
                                  checked={cap?.carRides ?? false}
                                  disabled={isSaving}
                                  onChange={(next) =>
                                    handleSaveErrandsCapability(
                                      c.id,
                                      cap?.motorcycleErrands ?? false,
                                      next
                                    )
                                  }
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </SectionCard>
                </div>
              )}

              {/* ================= AUDIT ================= */}
              {activeTab === 'AUDIT' && (
                <SectionCard
                  title="System audit trail"
                  subtitle="The 20 most recent administrative actions"
                  action={
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200">
                      {auditLogs.length} entr{auditLogs.length === 1 ? 'y' : 'ies'}
                    </span>
                  }
                >
                  {auditLogs.length === 0 ? (
                    <EmptyState
                      icon={FileText}
                      title="No administrative actions yet"
                      hint="Approvals, suspensions and pricing changes you make will be recorded here."
                    />
                  ) : (
                    <ol className="space-y-0">
                      {auditLogs.map((log, index) => {
                        const isLast = index === auditLogs.length - 1;
                        return (
                          <li key={log.id} className="relative flex gap-3 pb-4 last:pb-0">
                            <div className="relative flex flex-col items-center">
                              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
                              {!isLast && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                            </div>
                            <div className="min-w-0 flex-1 pb-1">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <p className="text-[13px] font-black text-slate-900">
                                  {log.action.replace(/_/g, ' ')}
                                </p>
                                <span className="text-[10px] font-bold text-slate-400">
                                  {new Date(log.created_at).toLocaleString('en-GH', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  })}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                Target: {log.target_type || 'system'}
                                {log.target_id ? ` · ${log.target_id}` : ''}
                                {log.actor?.full_name ? ` · by ${log.actor.full_name}` : ''}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </SectionCard>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ===== Confirmation dialogs (commission / refund / settlement) ===== */}
      {commissionConfirm !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="commission_confirm_title"
        >
          <div className={`${CARD} w-full max-w-md p-5 sm:p-6`}>
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
              Confirm change
            </p>
            <h3
              id="commission_confirm_title"
              className="mt-1 text-base font-black text-slate-900"
            >
              Set restaurant commission to {commissionConfirm}%?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              It replaces the current {commissionSettings.restaurant_commission_percentage}%
              rate on <strong className="text-slate-800">new orders only</strong>. Every order
              already placed keeps the rate snapshotted on it, so historical payouts never
              change.
            </p>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <span>Commission on a GH₵100.00 food order</span>
                <span className="font-black tabular-nums text-amber-600">
                  {formatGHS(round2((100 * commissionConfirm) / 100))}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span>Restaurant keeps</span>
                <span className="font-black tabular-nums text-emerald-700">
                  {formatGHS(round2(100 - (100 * commissionConfirm) / 100))}
                </span>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setCommissionConfirm(null)}
                disabled={isSavingCommission}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCommissionSave}
                disabled={isSavingCommission}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {isSavingCommission ? 'Saving…' : `Yes, set ${commissionConfirm}%`}
              </button>
            </div>
          </div>
        </div>
      )}

      {refundOrder && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="refund_dialog_title"
        >
          <div className={`${CARD} w-full max-w-md p-5 sm:p-6`}>
            <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">
              Refund customer
            </p>
            <h3 id="refund_dialog_title" className="mt-1 text-base font-black text-slate-900">
              Order #{refundOrder.order_number}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Paid {formatGHS(getOrderFinancials(refundOrder).customerTotal)} ·{' '}
              {formatGHS(priorRefundedOn(refundOrder.id))} already refunded. Commission and
              restaurant payouts reverse proportionally — history is never rewritten.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="refund_amount"
                  className="mb-1.5 block text-xs font-bold text-slate-600"
                >
                  Refund amount (GH₵)
                </label>
                <input
                  id="refund_amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={refundAmount}
                  onChange={(e) => {
                    setRefundAmount(e.target.value);
                    setRefundError('');
                  }}
                  aria-invalid={Boolean(refundError)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label
                  htmlFor="refund_reason"
                  className="mb-1.5 block text-xs font-bold text-slate-600"
                >
                  Reason (optional)
                </label>
                <input
                  id="refund_reason"
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="e.g. Cold food on arrival"
                  className={INPUT_CLASS}
                />
              </div>
              {refundError && (
                <p className="text-[11px] font-bold text-rose-600">{refundError}</p>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setRefundOrder(null)}
                disabled={isRecordingRefund}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRecordRefund}
                disabled={isRecordingRefund || Boolean(refundError)}
                className="rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-black text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {isRecordingRefund ? 'Recording…' : 'Record refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {settlementConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settlement_dialog_title"
        >
          <div className={`${CARD} w-full max-w-md p-5 sm:p-6`}>
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
              Settlement
            </p>
            <h3 id="settlement_dialog_title" className="mt-1 text-base font-black text-slate-900">
              {settlementConfirm.status === 'PAID'
                ? 'Mark this payout as paid?'
                : 'Start processing this payout?'}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Order #{settlementConfirm.order.order_number} ·{' '}
              {formatGHS(getOrderFinancials(settlementConfirm.order).restaurantNet)} to{' '}
              {settlementConfirm.order.restaurant?.name ?? 'the restaurant'} (after{' '}
              {formatGHS(getOrderFinancials(settlementConfirm.order).commissionAmount)}{' '}
              commission). This
              advances the settlement from{' '}
              {settlementConfirm.order.settlement_status ?? 'PENDING'} — payment success alone
              never marks a restaurant as paid out.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setSettlementConfirm(null)}
                disabled={isAdvancingSettlement}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdvanceSettlement}
                disabled={isAdvancingSettlement}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {isAdvancingSettlement
                  ? 'Saving…'
                  : `Yes, mark ${settlementConfirm.status}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Errands admin cancellation confirm ===== */}
      {errandsCancelTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="errands_cancel_dialog_title"
        >
          <div className={`${CARD} w-full max-w-md p-5 sm:p-6`}>
            <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">
              Cancel Errands booking
            </p>
            <h3
              id="errands_cancel_dialog_title"
              className="mt-1 text-base font-black text-slate-900"
            >
              {errandsCancelTarget.bookingNumber || 'This booking'}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {ERRANDS_SERVICE_LABELS[errandsCancelTarget.serviceCategory]} ·{' '}
              {errandsCancelTarget.pickupArea ?? '—'} → {errandsCancelTarget.destinationArea ?? '—'}{' '}
              · status {ERRANDS_STATUS_LABELS[errandsCancelTarget.status]}. This uses the same
              validated status transition as drivers and customers, recorded as{' '}
              <strong className="text-slate-700">Cancelled by administration</strong>. The driver
              is released and no fare is charged.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setErrandsCancelTarget(null)}
                disabled={isCancellingErrands}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Keep booking
              </button>
              <button
                type="button"
                onClick={confirmErrandsCancel}
                disabled={isCancellingErrands}
                className="rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-black text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {isCancellingErrands ? 'Cancelling…' : 'Yes, cancel this booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation toast — replaces the old blocking window.alert() */}
      {notice && (
        <div className="pointer-events-none fixed inset-x-4 bottom-5 z-50 flex justify-center sm:inset-x-auto sm:right-6 sm:justify-end">
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-3 text-xs font-bold text-white shadow-xl ring-1 ${
              notice.tone === 'success'
                ? 'bg-emerald-600 ring-emerald-700/40'
                : 'bg-rose-600 ring-rose-700/40'
            }`}
          >
            {notice.tone === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {notice.text}
          </div>
        </div>
      )}
    </div>
  );
};
