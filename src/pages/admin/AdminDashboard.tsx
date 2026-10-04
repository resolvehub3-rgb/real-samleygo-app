import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  Bike,
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
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
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
import { DocumentImage } from '../../components/common/DocumentImage';
import { AdminDispatchMap } from '../../components/admin/AdminDispatchMap';
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

      // 5. Fetch Platform Settings
      const { data: settsData } = await supabase.from('platform_settings').select('*').eq('key', 'delivery_pricing').maybeSingle();
      if (settsData && settsData.value) setPricingSettings(settsData.value as PlatformPricingSettings);

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

  // Real aggregations — every money figure is read from the per-order
  // financial snapshot the database wrote (commission_rate, commission_amount,
  // *_amount), net of refund adjustments. No hard-coded percentages anywhere.
  const financials = aggregateFinancials(orders, adjustments);
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
  // Phase 1: the courier keeps the whole delivery fee (0% courier commission);
  // the platform earns the restaurant commission on the FOOD subtotal only.
  const sampleFoodOrder = 100;
  const sampleCommission = round2(
    (sampleFoodOrder * commissionSettings.restaurant_commission_percentage) / 100
  );

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
                    title="Ghana delivery fee rules"
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
                          <span className="text-slate-500">Delivery fee (customer pays)</span>
                          <span className="font-black tabular-nums text-slate-900">
                            {formatGHS(sampleFee)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-500">
                            Courier keeps (0% commission)
                          </span>
                          <span className="font-black tabular-nums text-emerald-700">
                            {formatGHS(sampleFee)}
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
