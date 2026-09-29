import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  AlertCircle,
  Bike,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCheck,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Phone,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Sliders,
  Star,
  Store,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  Restaurant,
  Courier,
  CourierDocument,
  CourierVerificationStatus,
  Order,
  OrderStatus,
  PlatformPricingSettings,
  AuditLog,
} from '../../types/database';
import {
  calculateDeliveryFee,
  formatGHS,
  DEFAULT_PRICING,
} from '../../lib/pricing';
import { VERIFICATION_META } from '../../lib/verification';
import { DocumentImage } from '../../components/common/DocumentImage';
import type { LucideIcon } from 'lucide-react';

/** Sections of the super-admin console. Also drives the sidebar. */
type AdminTab =
  | 'OVERVIEW'
  | 'RESTAURANTS'
  | 'COURIERS'
  | 'ORDERS'
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
  'SETTINGS',
  'AUDIT',
];

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

const TH = 'pb-3 pr-4 font-black uppercase tracking-wider';
const TD = 'py-3 pr-4 align-middle';

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

interface StatCardProps {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
  tone: StatTone;
  /** Plain-language definition shown when the admin hovers the ⓘ hint. */
  hint?: string;
  /** Small secondary read-out rendered under the value (e.g. "12 orders today"). */
  meta?: string;
  /** Optional 0–100 completion bar shown above the footer. */
  progress?: number;
  progressLabel?: string;
  /** Makes the whole card a clickable shortcut to the related section. */
  onClick?: () => void;
}

/**
 * Platform Overview KPI card: colour-coded accent, gradient wash, hover lift,
 * an optional ⓘ definition (so a new admin never has to guess what a number
 * means) and an optional progress bar for ratio metrics.
 */
const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  caption,
  icon: Icon,
  tone,
  hint,
  meta,
  progress,
  progressLabel,
  onClick,
}) => {
  const t = STAT_TONE[tone];
  const clamped = typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : null;

  const body = (
    <>
      {/* Gradient accent bar + ambient glow */}
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${t.bar}`} />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full blur-2xl transition duration-500 ${t.blob}`}
      />

      <span className="relative flex items-start justify-between gap-3">
        <span className="block min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">
            {label}
            {hint && (
              <span
                tabIndex={0}
                role="note"
                title={hint}
                className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-slate-200 text-[8px] font-black not-italic leading-none text-slate-500 transition hover:bg-slate-900 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                i
              </span>
            )}
          </span>
          <span className="mt-2 block text-2xl font-black tabular-nums tracking-tight text-slate-900">
            {value}
          </span>
          {meta && (
            <span className="mt-1.5 block text-[11px] font-bold tabular-nums text-slate-500">
              {meta}
            </span>
          )}
        </span>
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 transition duration-200 group-hover:scale-110 group-hover:-rotate-6 ${t.tile}`}
        >
          <Icon className="w-5 h-5" />
        </span>
      </span>

      {clamped !== null && (
        <span className="mt-4 block">
          <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400">
            <span>{progressLabel}</span>
            <span className="tabular-nums text-slate-600">{Math.round(clamped)}%</span>
          </span>
          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <span
              className={`block h-full rounded-full ${t.fill} transition-[width] duration-700 ease-out`}
              style={{ width: `${clamped}%` }}
            />
          </span>
        </span>
      )}

      <span className="relative mt-3 block text-[11px] leading-relaxed text-slate-500">
        {caption}
      </span>

      {onClick && (
        <span className="relative mt-3 inline-flex items-center gap-1 text-[11px] font-black text-slate-400 transition group-hover:text-emerald-600">
          Open section
          <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </span>
      )}
    </>
  );

  const baseClass = `group relative isolate overflow-hidden ${CARD} p-5 transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60`;

  // Interactive cards are real buttons so keyboard and screen-reader users get
  // the same shortcut as mouse users.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${baseClass} block w-full text-left`}>
        {body}
      </button>
    );
  }

  return <div className={baseClass}>{body}</div>;
};

interface QuickActionCardProps {
  label: string;
  caption: string;
  count: number;
  icon: LucideIcon;
  tone: StatTone;
  onClick: () => void;
}

/** Shortcut tile that jumps straight to the section that needs attention. */
const QuickActionCard: React.FC<QuickActionCardProps> = ({
  label,
  caption,
  count,
  icon: Icon,
  tone,
  onClick,
}) => {
  const t = STAT_TONE[tone];
  const hasWork = count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative isolate flex items-center gap-3.5 overflow-hidden p-4 text-left ${CARD} transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
        hasWork ? 'ring-2 ring-inset ring-amber-400/50' : ''
      }`}
    >
      {/* Attention rail: only shown when there is something to review */}
      {hasWork && (
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} />
      )}

      <span
        className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 transition duration-200 group-hover:scale-110 ${t.tile}`}
      >
        <Icon className="h-5 w-5" />
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-black text-slate-900">{label}</span>
          {hasWork && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{caption}</span>
      </span>

      <span
        className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-black tabular-nums transition ${
          hasWork
            ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20 group-hover:bg-emerald-600'
            : 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-500/20'
        }`}
      >
        {hasWork ? (
          <>
            {count}
            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </>
        ) : (
          <CheckCircle className="h-4 w-4" />
        )}
      </span>
    </button>
  );
};

const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />
);

/** Shown while the first dashboard query round-trip is still in flight. */
const DashboardSkeleton = () => (
  <div className="space-y-6" role="status" aria-label="Loading dashboard data">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
  const [usersCount, setUsersCount] = useState<number>(0);
  const [pricingSettings, setPricingSettings] = useState<PlatformPricingSettings>(DEFAULT_PRICING);
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

  const notify = (text: string, tone: 'success' | 'error' = 'success') =>
    setNotice({ text, tone });

  // Auto-dismiss the confirmation toast so it can never cover the console.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

      // 3. Fetch Orders
      const { data: ordData } = await supabase.from('orders').select('*, restaurant:restaurants(*), courier:profiles!orders_courier_id_fkey(*)').order('created_at', { ascending: false });
      if (ordData) setOrders(ordData as Order[]);

      // 4. Fetch Profiles count
      const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
      if (count !== null) setUsersCount(count);

      // 5. Fetch Platform Settings
      const { data: settsData } = await supabase.from('platform_settings').select('*').eq('key', 'delivery_pricing').maybeSingle();
      if (settsData && settsData.value) setPricingSettings(settsData.value as PlatformPricingSettings);

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

  // Realtime: courier signups, document uploads and admin decisions refresh live
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

    const channel = supabase
      .channel('admin-courier-verification')
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

  // Save Pricing Settings
  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const { error } = await supabase.from('platform_settings').upsert({
        key: 'delivery_pricing',
        value: pricingSettings,
        description: 'Updated by Super Admin',
      });

      if (error) throw error;

      if (user) {
        await supabase.from('audit_logs').insert({
          actor_id: user.id,
          action: 'PLATFORM_SETTINGS_UPDATED',
          target_type: 'settings',
          metadata: { pricing: pricingSettings },
        });
      }
      notify('Platform pricing rules updated successfully.');
    } catch {
      notify('Failed to save settings. Please try again.', 'error');
    } finally {
      setIsSavingSettings(false);
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

  // Real aggregations
  const totalVolume = orders.reduce((sum, o) => sum + o.total_amount, 0);
  const totalPlatformCut = orders.reduce((sum, o) => sum + o.delivery_fee * 0.2 + o.subtotal * 0.15, 0);
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

  // Pricing preview (mirrors the exact fee the customer would be charged)
  const sampleFee = calculateDeliveryFee(SAMPLE_DISTANCE_KM, pricingSettings);
  const sampleCourierPayout =
    (sampleFee * (pricingSettings.courier_payout_percentage ?? 80)) / 100;
  const samplePlatformCut =
    (sampleFee * (pricingSettings.platform_commission_percentage ?? 20)) / 100;

  // Single source of truth for the sidebar: desktop rail, mobile drawer and the
  // mobile top bar all render from this list, so a section can never drift.
  const navItems: AdminNavItem[] = [
    { key: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
    { key: 'RESTAURANTS', label: 'Restaurants', icon: Store, count: restaurants.length },
    { key: 'COURIERS', label: 'Couriers', icon: Bike, count: couriers.length },
    { key: 'ORDERS', label: 'Live Orders', icon: Receipt, count: orders.length },
    { key: 'SETTINGS', label: 'Pricing Rules', icon: Sliders },
    { key: 'AUDIT', label: 'Audit Logs', icon: FileText },
  ];

  // Grouped sidebar: operations up top, platform governance below.
  const navGroups: { label: string; keys: AdminTab[] }[] = [
    { label: 'Operations', keys: ['OVERVIEW', 'RESTAURANTS', 'COURIERS', 'ORDERS'] },
    { label: 'Platform', keys: ['SETTINGS', 'AUDIT'] },
  ];

  const activeLabel =
    navItems.find((item) => item.key === activeTab)?.label ?? 'Overview';

  const handleSelectTab = (key: AdminTab) => {
    // Push the section into the URL so back/forward and refresh keep working.
    setSearchParams(key === 'OVERVIEW' ? {} : { tab: key });
    setIsSidebarOpen(false);
    setExpandedCourierId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      <span className="flex h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-white/15">
        <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
          Protected Web Console
        </span>
        <h1 className="truncate text-[15px] font-black tracking-tight text-white">
          SamleyGo Super Admin
        </h1>
      </div>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25">
        <ShieldCheck className="h-4 w-4" />
      </span>
    </div>
  );

  const navList = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Admin sections">
      {navGroups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/30">
            {group.label}
          </p>
          {group.keys.map((key) => {
            const item = navItems.find((nav) => nav.key === key);
            if (!item) return null;
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleSelectTab(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold transition ${
                  isActive
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                    : 'text-slate-300/90 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate text-left">{item.label}</span>
                {typeof item.count === 'number' && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-black tabular-nums transition ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const sidebarFooter = (
    <div className="shrink-0 space-y-3 border-t border-white/5 px-3 py-4">
      <div className="flex min-w-0 items-center gap-3 px-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[11px] font-black text-white ring-1 ring-white/10">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-white" title={user?.email ?? ''}>
            {profile?.full_name || user?.email || 'Administrator'}
          </p>
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">
            {profile ? profile.role.replace(/_/g, ' ') : 'Loading role…'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/"
          className="flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[11px] font-bold text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          Storefront
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-2 py-2.5 text-[11px] font-bold text-slate-200 transition hover:bg-rose-600 hover:text-white"
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-hidden border-r border-white/5 bg-[#04140e] lg:flex lg:flex-col">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl"
        />
        <div className="relative shrink-0 border-b border-white/5 px-4 py-5">{brand}</div>
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
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-hidden border-r border-white/5 bg-[#04140e] shadow-2xl lg:hidden">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl"
            />
            <div className="relative flex shrink-0 items-start justify-between gap-2 border-b border-white/5 px-4 py-5">
              {brand}
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close navigation"
                className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
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
        <div className="sticky top-0 z-30 border-b border-white/5 bg-[#04140e] text-white shadow-lg lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open navigation"
              aria-expanded={isSidebarOpen}
              className="-ml-2 shrink-0 rounded-lg p-2 text-slate-300 transition hover:bg-white/5"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="flex h-7 w-7 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-white/15">
              <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase leading-none tracking-[0.18em] text-emerald-400">
                SamleyGo Admin
              </p>
              <p className="mt-1 truncate text-sm font-black leading-tight">{activeLabel}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="-mr-2 shrink-0 rounded-lg p-2 text-slate-300 transition hover:bg-white/5 hover:text-rose-400"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleSelectTab(item.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                    isActive
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-950/40'
                      : 'bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Desktop header */}
        <header className="sticky top-0 z-20 hidden items-center justify-between gap-4 border-b border-slate-200/70 bg-slate-100/85 px-6 py-4 backdrop-blur-md lg:flex xl:px-8">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600">
              SamleyGo · Protected console
            </p>
            <h2 className="text-lg font-black tracking-tight text-slate-900">{activeLabel}</h2>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 xl:inline-flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Realtime sync
            </span>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              View storefront
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
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
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <h1 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
                        Platform overview
                      </h1>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date().toLocaleDateString('en-GH', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                        {' · '}
                        {usersCount} registered {usersCount === 1 ? 'user' : 'users'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                      label="Gross merchandise value"
                      value={formatGHS(totalVolume)}
                      meta={
                        orders.length > 0
                          ? `${orders.length} orders · ${formatGHS(avgOrderValue)} average`
                          : 'No orders recorded yet'
                      }
                      caption="Total order volume processed through the platform"
                      hint="The sum of every order total placed across all kitchens — before commissions or delivery fees are taken out."
                      icon={Wallet}
                      tone="emerald"
                      onClick={() => handleSelectTab('ORDERS')}
                    />
                    <StatCard
                      label="Platform commission"
                      value={formatGHS(totalPlatformCut)}
                      meta="Delivery share plus restaurant commission"
                      caption={`Approx. ${takeRatePercent.toFixed(1)}% of everything sold on the platform`}
                      hint="What SamleyGo earns: 15% of each order subtotal plus 20% of each delivery fee. Adjust both in Pricing Rules."
                      progress={takeRatePercent}
                      progressLabel="Take rate"
                      icon={Receipt}
                      tone="sky"
                      onClick={() => handleSelectTab('SETTINGS')}
                    />
                    <StatCard
                      label="Registered users"
                      value={String(usersCount)}
                      meta={`${restaurants.length} kitchens · ${couriers.length} riders on the platform`}
                      caption="Customer, courier and restaurant owner accounts"
                      hint="Every account that has signed up, including customers, kitchen owners and delivery riders."
                      icon={Users}
                      tone="violet"
                    />
                    <StatCard
                      label="Couriers online"
                      value={`${onlineCouriers}/${couriers.length}`}
                      meta="Riders currently on shift right now"
                      caption={
                        couriers.length > 0
                          ? fleetOnlinePercent >= 50
                            ? 'Fleet capacity looks healthy'
                            : 'Below half the fleet — coverage may be thin'
                          : 'No riders registered yet'
                      }
                      hint="Riders who have toggled themselves ONLINE and can accept deliveries this minute."
                      progress={fleetOnlinePercent}
                      progressLabel="Fleet online"
                      icon={Bike}
                      tone="amber"
                      onClick={() => handleSelectTab('COURIERS')}
                    />
                  </div>

                  <div>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-[13px] font-black tracking-tight text-slate-900">
                          Needs your attention
                        </h2>
                        <p className="text-[11px] text-slate-500">
                          {pendingTotal > 0
                            ? `${pendingTotal} item${pendingTotal === 1 ? '' : 's'} waiting for a decision`
                            : 'Nothing is waiting on you right now'}
                        </p>
                      </div>
                      {pendingTotal > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700 ring-1 ring-amber-500/20">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
                          </span>
                          {pendingTotal} pending
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <QuickActionCard
                        label="Restaurant approvals"
                        caption={pendingRestaurants ? 'Waiting for your review' : 'Everything is approved'}
                        count={pendingRestaurants}
                        icon={Store}
                        tone="emerald"
                        onClick={() => handleSelectTab('RESTAURANTS')}
                      />
                      <QuickActionCard
                        label="Courier reviews"
                        caption={pendingCouriers ? 'Riders awaiting a decision' : 'Everyone is verified'}
                        count={pendingCouriers}
                        icon={UserCheck}
                        tone="sky"
                        onClick={() => handleSelectTab('COURIERS')}
                      />
                      <QuickActionCard
                        label="Documents pending"
                        caption={pendingDocs ? 'Ghana Card & licence uploads' : 'Inbox zero'}
                        count={pendingDocs}
                        icon={FileCheck}
                        tone="violet"
                        onClick={() => handleSelectTab('COURIERS')}
                      />
                    </div>
                  </div>

                  <SectionCard
                    title="Recent platform transactions"
                    subtitle="The newest orders across every kitchen"
                    action={
                      <button
                        type="button"
                        onClick={() => handleSelectTab('ORDERS')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        View all orders
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    }
                  >
                    {orders.length === 0 ? (
                      <EmptyState
                        icon={Inbox}
                        title="No orders recorded yet"
                        hint="As soon as customers start ordering, the latest transactions will stream in here in realtime."
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left text-[13px]">
                          <thead>
                            <tr className="border-b border-slate-200 text-[10px] text-slate-500">
                              <th className={TH}>Order number</th>
                              <th className={TH}>Kitchen</th>
                              <th className={TH}>Total amount</th>
                              <th className={TH}>Payment</th>
                              <th className={TH}>Status</th>
                              <th className="pb-3 text-right font-black uppercase tracking-wider">
                                Timestamp
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {orders.slice(0, 8).map((o) => (
                              <tr key={o.id} className="transition hover:bg-slate-50/70">
                                <td className={`${TD} font-black text-slate-900`}>
                                  #{o.order_number}
                                </td>
                                <td className={`${TD} font-medium text-slate-700`}>
                                  {o.restaurant?.name || 'Kitchen'}
                                </td>
                                <td className={`${TD} font-black text-emerald-700 tabular-nums`}>
                                  {formatGHS(o.total_amount)}
                                </td>
                                <td className={`${TD} text-slate-500`}>{o.payment_method}</td>
                                <td className={TD}>
                                  <span
                                    className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${orderStatusStyle(
                                      o.status
                                    )}`}
                                  >
                                    {o.status.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="py-3 text-right text-slate-400">
                                  {new Date(o.created_at).toLocaleTimeString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </SectionCard>
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

                                <div className="flex shrink-0 items-baseline gap-2 sm:flex-col sm:items-end sm:gap-1">
                                  <span className="text-base font-black leading-none tabular-nums text-slate-900">
                                    {formatGHS(o.total_amount)}
                                  </span>
                                  <span className="text-[10px] font-bold tabular-nums text-slate-400">
                                    incl. {formatGHS(o.delivery_fee)} delivery
                                  </span>
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
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <SectionCard
                    title="Ghana delivery fee & commission"
                    subtitle="Controls dynamic distance-based pricing across Accra, Kumasi and other operational hubs"
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
                            Maximum fee cap (GH₵)
                          </label>
                          <input
                            id="max_fee"
                            type="number"
                            step="1.00"
                            value={pricingSettings.max_fee}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                max_fee: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={INPUT_CLASS}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="courier_payout"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            Courier payout share (%)
                          </label>
                          <input
                            id="courier_payout"
                            type="number"
                            value={pricingSettings.courier_payout_percentage}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                courier_payout_percentage:
                                  parseFloat(e.target.value) || 80,
                              })
                            }
                            className={INPUT_CLASS}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="platform_commission"
                            className="mb-1.5 block text-xs font-bold text-slate-600"
                          >
                            Platform commission (%)
                          </label>
                          <input
                            id="platform_commission"
                            type="number"
                            value={pricingSettings.platform_commission_percentage}
                            onChange={(e) =>
                              setPricingSettings({
                                ...pricingSettings,
                                platform_commission_percentage:
                                  parseFloat(e.target.value) || 20,
                              })
                            }
                            className={INPUT_CLASS}
                          />
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
                          Applies to every new order instantly.
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
                          <span className="text-slate-500">Customer pays</span>
                          <span className="font-black tabular-nums text-slate-900">
                            {formatGHS(sampleFee)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-500">
                            Courier payout ({pricingSettings.courier_payout_percentage}%)
                          </span>
                          <span className="font-black tabular-nums text-emerald-700">
                            {formatGHS(sampleCourierPayout)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-500">
                            Platform share ({pricingSettings.platform_commission_percentage}%)
                          </span>
                          <span className="font-black tabular-nums text-sky-700">
                            {formatGHS(samplePlatformCut)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
                        Fees are clamped between {formatGHS(pricingSettings.min_fee)} and{' '}
                        {formatGHS(pricingSettings.max_fee)} with a ×
                        {pricingSettings.surge_multiplier ?? 1} surge multiplier.
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
                          Result is clamped by the minimum floor and maximum cap
                        </li>
                        <li className="flex gap-2">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          Surge multiplier is applied before the cap is enforced
                        </li>
                      </ul>
                    </div>
                  </aside>
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
