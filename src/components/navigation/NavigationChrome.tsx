import React, { useState } from 'react';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronRight,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  GitMerge,
  List,
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  RotateCw,
  SatelliteDish,
  Search,
  Send,
  Share2,
  Split,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  ARRIVAL_RADIUS_M,
  maneuverIconKey,
  type BannerInstruction,
  type ManeuverIconKey,
  type NavigationState,
  type NavigationStep,
  type RouteCalcStatus,
} from '../../lib/navigation';
import { formatRouteDistance, formatRouteDuration, routingCapabilities } from '../../lib/routing';
import type { NavigationVoiceUiState } from '../../lib/navigationVoice';
import {
  NAVIGATION_REPORT_CATEGORIES,
  submitNavigationReport,
  type NavigationReportCategory,
} from '../../lib/navigationReports';

/** Which sheet (if any) is open over the bottom panel. */
export type NavigationPanel = 'destination' | 'overview' | 'steps' | 'report';

/** One selectable route in the overview sheet (index 0 is the primary route). */
export interface RouteOption {
  distanceMeters: number;
  durationSeconds: number;
}

export interface NavigationChromeProps {
  /** Derived navigation state — decides what the banner says. */
  state: NavigationState;
  /** Next maneuver straight from the route steps (`null` when there is none). */
  banner: BannerInstruction | null;
  remainingMeters: number;
  remainingSeconds: number;
  /** Wall-clock arrival ("21:18"), already formatted. */
  arrivalClock: string | null;
  /** Human label for the active destination (address or "Restaurant pickup"). */
  destinationLabel: string;
  /** "To pickup" / "To customer" — which leg is being driven. */
  legLabel: string;
  routeStatus: RouteCalcStatus;
  voice: NavigationVoiceUiState;
  /** Camera bearing in degrees (0 = north up) — drives the compass needle. */
  heading: number;
  /** True while the camera is locked to the rider. */
  following: boolean;
  /** GPS accuracy in metres, or `null` when the fix carried none. */
  accuracyMeters: number | null;
  steps: NavigationStep[];
  /** Every selectable route — index 0 is the primary, the rest are alternatives. */
  routes: RouteOption[];
  /** Index inside `routes` that is currently drawn. */
  selectedRouteIndex: number;
  providerId: string;
  orderId?: string | null;
  phase?: string | null;
  /** Where the courier is right now, for the report's single coordinate. */
  reportPoint?: { lat: number; lng: number } | null;

  onExit(): void;
  onRecenter(): void;
  onResetOrientation(): void;
  onToggleVoice(): void;
  onSelectRoute(index: number): void;
  onLoadRoutes(): void;
}

/** Turn an engine maneuver into the glyph the banner draws. */
const MANEUVER_ICONS: Record<ManeuverIconKey, React.ComponentType<{ className?: string }>> = {
  depart: Navigation,
  straight: ArrowUp,
  left: CornerUpLeft,
  right: CornerUpRight,
  'slight-left': ArrowUpLeft,
  'slight-right': ArrowUpRight,
  'sharp-left': CornerUpLeft,
  'sharp-right': CornerUpRight,
  uturn: Undo2,
  roundabout: RotateCw,
  'exit-roundabout': CornerUpRight,
  ramp: ArrowUp,
  'ramp-left': ArrowUpLeft,
  'ramp-right': ArrowUpRight,
  fork: Split,
  'fork-left': ArrowUpLeft,
  'fork-right': ArrowUpRight,
  merge: GitMerge,
  'merge-left': ArrowUpLeft,
  'merge-right': ArrowUpRight,
  arrive: MapPin,
  continue: ArrowUp,
};

const ManeuverGlyph: React.FC<{ icon: ManeuverIconKey; className?: string }> = ({
  icon,
  className,
}) => {
  const Glyph = MANEUVER_ICONS[icon] ?? ArrowUp;
  return <Glyph className={className ?? 'h-9 w-9'} />;
};

/** Copy for the states where there is no maneuver to show. */
const stateCopy: Partial<
  Record<NavigationState, { title: string; detail: string; Icon: React.ComponentType<{ className?: string }> }>
> = {
  ROUTE_CALCULATING: {
    title: 'Calculating route',
    detail: 'Finding the best road to your destination…',
    Icon: Loader2,
  },
  GPS_UNAVAILABLE: {
    title: 'GPS unavailable',
    detail: 'Waiting for a location fix. Move into the open if you can.',
    Icon: SatelliteDish,
  },
  OFF_ROUTE: {
    title: 'Off route',
    detail: 'You have left the planned road.',
    Icon: TriangleAlert,
  },
  REROUTING: {
    title: 'Rerouting',
    detail: 'Finding a new way to your destination…',
    Icon: Loader2,
  },
  ROUTE_READY: {
    title: 'Route ready',
    detail: 'Start riding — guidance begins with your first fix.',
    Icon: Navigation,
  },
  ARRIVING: {
    title: 'Arriving',
    detail: 'Your destination is just ahead.',
    Icon: MapPin,
  },
  ARRIVED: {
    title: 'You have arrived',
    detail: '',
    Icon: MapPin,
  },
  IDLE: { title: 'No active trip', detail: '', Icon: MapPin },
  NAVIGATING: { title: 'Navigating', detail: '', Icon: Navigation },
  APPROACHING: { title: 'Approaching turn', detail: '', Icon: CornerUpLeft },
  CANCELLED: { title: 'Navigation ended', detail: '', Icon: X },
};

const panelTitle: Record<NavigationPanel, string> = {
  destination: 'Destination',
  overview: 'Route overview',
  steps: 'Turn list',
  report: 'Report a problem',
};

/** Round icon button used by the right-hand floating column. */
const ControlButton: React.FC<{
  label: string;
  onClick(): void;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ label, onClick, active = false, children, className }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`pointer-events-auto grid h-[52px] w-[52px] place-items-center rounded-full border transition active:scale-95 ${
      active
        ? 'border-nav-cyan/60 bg-nav-cyan/15 text-nav-cyan'
        : 'border-white/15 bg-black/80 text-white hover:bg-black/90'
    } shadow-[0_4px_14px_rgba(0,0,0,0.45)] backdrop-blur-sm ${className ?? ''}`}
  >
    {children}
  </button>
);

/**
 * The full-screen turn-by-turn chrome: teal maneuver banner, black ETA panel,
 * the floating control column and every sheet they open.
 *
 * This component is deliberately **presentational** — it renders whatever the
 * map hands it and reports intent back through callbacks. It owns no map, no
 * GPS and no routing request, so the layout can be reviewed and reasoned about
 * on its own while `CourierLiveMap` stays the single owner of navigation truth.
 *
 * Every control does something real: compass → north-up, destination → the
 * active pin's details, sound → voice guidance, routes → overview + real
 * alternatives, report → a stored issue report, re-centre → camera follow,
 * turn list → the engine's actual steps, ✕ → leave navigation.
 */
export const NavigationChrome: React.FC<NavigationChromeProps> = ({
  state,
  banner,
  remainingMeters,
  remainingSeconds,
  arrivalClock,
  destinationLabel,
  legLabel,
  routeStatus,
  voice,
  heading,
  following,
  accuracyMeters,
  steps,
  routes,
  selectedRouteIndex,
  providerId,
  orderId,
  phase,
  reportPoint,
  onExit,
  onRecenter,
  onResetOrientation,
  onToggleVoice,
  onSelectRoute,
  onLoadRoutes,
}) => {
  const [panel, setPanel] = useState<NavigationPanel | null>(null);
  const [reportCategory, setReportCategory] = useState<NavigationReportCategory>('HAZARD');
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);

  const arrived = state === 'ARRIVED';
  const copy = stateCopy[state];
  const weakGps = accuracyMeters != null && accuracyMeters > WEAK_GPS_M;
  const status = routeStatus === 'loading' || routeStatus === 'recalculating';

  const closePanel = () => setPanel(null);

  const handleSendReport = async () => {
    if (reportBusy) return;
    setReportBusy(true);
    setReportFeedback(null);
    const result = await submitNavigationReport({
      category: reportCategory,
      note: reportNote,
      point: reportPoint ?? null,
      orderId: orderId ?? null,
      phase: phase ?? null,
    });
    setReportBusy(false);
    if (result.ok) {
      setReportFeedback('Report sent. Thank you.');
      setReportNote('');
      window.setTimeout(() => {
        setReportFeedback(null);
        closePanel();
      }, 1200);
    } else {
      setReportFeedback(result.error);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[900] select-none">
      {/* ── Top maneuver banner ─────────────────────────────────────────── */}
      <div
        className="absolute inset-x-0 top-0 px-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <div
          className={`overflow-hidden rounded-[18px] shadow-[0_10px_30px_rgba(0,0,0,0.45)] ${
            arrived ? 'bg-emerald-700' : 'bg-nav-teal'
          }`}
        >
          <div className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
            {arrived ? (
              <span className="grid h-12 w-12 shrink-0 place-items-center">
                <MapPin className="h-9 w-9 text-white" />
              </span>
            ) : banner ? (
              <span className="grid h-12 w-12 shrink-0 place-items-center">
                <ManeuverGlyph icon={banner.icon} className="h-10 w-10 text-white" />
              </span>
            ) : copy ? (
              <span className="grid h-12 w-12 shrink-0 place-items-center">
                <copy.Icon
                  className={`h-9 w-9 text-white ${state === 'ROUTE_CALCULATING' || state === 'REROUTING' ? 'animate-spin' : ''}`}
                />
              </span>
            ) : null}

            <div className="min-w-0 flex-1">
              {arrived ? (
                <>
                  <p className="text-[22px] font-black leading-tight text-white">
                    You have arrived
                  </p>
                  <p className="truncate text-[13px] leading-snug text-white/85">
                    {destinationLabel}
                  </p>
                </>
              ) : banner ? (
                <>
                  <p className="text-[15px] font-semibold leading-none text-white/85">
                    {formatRouteDistance(banner.distanceMeters) || '0 m'}
                  </p>
                  <p className="mt-1 truncate text-[24px] font-black leading-tight text-white sm:text-[27px]">
                    {banner.roadName || banner.instruction}
                  </p>
                  {banner.advance && (
                    <p className="mt-0.5 truncate text-[12px] leading-snug text-white/70">
                      then · {banner.advance.roadName || banner.advance.instruction}
                    </p>
                  )}
                </>
              ) : copy ? (
                <>
                  <p className="text-[21px] font-black leading-tight text-white">{copy.title}</p>
                  <p className="truncate text-[13px] leading-snug text-white/85">
                    {state === 'ROUTE_CALCULATING' ? destinationLabel : copy.detail}
                  </p>
                </>
              ) : null}
            </div>

            {arrived && (
              <button
                type="button"
                onClick={onExit}
                className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/30 text-white transition active:scale-95"
                aria-label="End navigation"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* Status strip — only for the states a rider must act on. */}
        {banner && state !== 'ARRIVED' && (
          <>
            {(state === 'OFF_ROUTE' || state === 'REROUTING') && (
              <div className="mt-2 flex w-fit items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/95 px-3 py-1.5 shadow-lg">
                <TriangleAlert className="h-4 w-4 text-amber-950" />
                <span className="text-[12px] font-black text-amber-950">
                  {state === 'REROUTING' ? 'Rerouting…' : 'Off route — rejoining'}
                </span>
              </div>
            )}
            {state === 'GPS_UNAVAILABLE' && (
              <div className="mt-2 flex w-fit items-center gap-2 rounded-full border border-white/20 bg-black/85 px-3 py-1.5 shadow-lg">
                <SatelliteDish className="h-4 w-4 text-white/80" />
                <span className="text-[12px] font-bold text-white">GPS unavailable</span>
              </div>
            )}
            {weakGps && state !== 'GPS_UNAVAILABLE' && (
              <div className="mt-2 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-black/80 px-3 py-1.5 shadow-lg">
                <SatelliteDish className="h-4 w-4 text-white/70" />
                <span className="text-[12px] font-semibold text-white/90">Weak GPS signal</span>
              </div>
            )}
            {status && (
              <div className="mt-2 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-black/80 px-3 py-1.5 shadow-lg">
                <Loader2 className="h-4 w-4 animate-spin text-white/80" />
                <span className="text-[12px] font-semibold text-white/90">
                  {routeStatus === 'recalculating' ? 'Updating route…' : 'Calculating route…'}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Right-hand floating controls ───────────────────────────────── */}
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-3">
        <ControlButton
          label="Reset orientation to north"
          onClick={onResetOrientation}
          active={Math.abs(heading) < 1}
        >
          <Compass
            className="h-6 w-6 transition-transform duration-300"
            style={{ transform: `rotate(${-heading}deg)` }}
          />
        </ControlButton>

        <ControlButton label="Destination details" onClick={() => setPanel('destination')}>
          <Search className="h-6 w-6" />
        </ControlButton>

        <ControlButton
          label={voice.enabled ? 'Turn voice guidance off' : 'Turn voice guidance on'}
          onClick={onToggleVoice}
          active={voice.enabled}
        >
          {voice.supported && voice.enabled ? (
            <Volume2 className="h-6 w-6" />
          ) : (
            <VolumeX className="h-6 w-6" />
          )}
        </ControlButton>

        <ControlButton label="Route overview" onClick={() => { setPanel('overview'); onLoadRoutes(); }}>
          <Share2 className="h-6 w-6" />
        </ControlButton>

        <ControlButton label="Report a problem" onClick={() => setPanel('report')}>
          <TriangleAlert className="h-6 w-6 text-amber-400" />
        </ControlButton>
      </div>

      {/* ── Re-centre (bottom-left, above the panel) ───────────────────── */}
      <div
        className="absolute left-3"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 132px)' }}
      >
        <button
          type="button"
          onClick={onRecenter}
          aria-label="Re-centre on the vehicle"
          className={`pointer-events-auto flex min-h-[46px] items-center gap-2 rounded-full border px-5 text-[14px] font-black shadow-[0_6px_20px_rgba(0,0,0,0.5)] transition active:scale-95 ${
            following
              ? 'border-white/25 bg-black/85 text-white'
              : 'border-nav-cyan/50 bg-nav-cyan/15 text-nav-cyan'
          }`}
        >
          <LocateFixed className="h-5 w-5" />
          Re-centre
        </button>
      </div>

      {/* ── Bottom ETA panel ───────────────────────────────────────────── */}
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-[22px] bg-black shadow-[0_-8px_30px_rgba(0,0,0,0.6)]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/25" aria-hidden="true" />
        <div className="flex items-center gap-3 px-4 pt-2">
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit navigation"
            className="pointer-events-auto grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full border border-white/30 text-white transition active:scale-95"
          >
            <X className="h-6 w-6" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-[26px] font-black leading-none text-accent tabular-nums">
              {remainingSeconds > 0 ? formatRouteDuration(remainingSeconds) : '—'}
            </p>
            <p className="mt-1.5 truncate text-[14px] font-semibold leading-none text-slate-300 tabular-nums">
              {formatRouteDistance(remainingMeters) || '0 m'}
              {arrivalClock ? ` · ${arrivalClock}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPanel(panel === 'steps' ? null : 'steps')}
            aria-label="Show the turn list"
            aria-pressed={panel === 'steps'}
            className={`pointer-events-auto grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full border transition active:scale-95 ${
              panel === 'steps'
                ? 'border-nav-cyan/60 bg-nav-cyan/15 text-nav-cyan'
                : 'border-white/30 text-white'
            }`}
          >
            <List className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* ── Sheet ──────────────────────────────────────────────────────── */}
      {panel && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[950] flex max-h-[70%] flex-col rounded-t-[22px] border-t border-white/10 bg-nav-ink shadow-[0_-10px_40px_rgba(0,0,0,0.7)]">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <h2 className="text-[15px] font-black text-white">{panelTitle[panel]}</h2>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-full border border-white/20 text-white transition active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {panel === 'destination' && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-white/5 p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-nav-cyan">
                    {legLabel}
                  </p>
                  <p className="mt-1 break-words text-[15px] font-bold leading-snug text-white">
                    {destinationLabel}
                  </p>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl bg-white/5 p-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Left
                    </dt>
                    <dd className="mt-1 text-[15px] font-black text-white tabular-nums">
                      {formatRouteDistance(remainingMeters) || '0 m'}
                    </dd>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Time
                    </dt>
                    <dd className="mt-1 text-[15px] font-black text-white tabular-nums">
                      {remainingSeconds > 0 ? formatRouteDuration(remainingSeconds) : '—'}
                    </dd>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Arrive
                    </dt>
                    <dd className="mt-1 text-[15px] font-black text-white tabular-nums">
                      {arrivalClock ?? '—'}
                    </dd>
                  </div>
                </dl>
                <p className="text-[12px] leading-relaxed text-slate-400">
                  Navigation stops automatically once you are within{' '}
                  {ARRIVAL_RADIUS_M} metres of this destination.
                </p>
              </div>
            )}

            {panel === 'overview' && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-white/5 p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-nav-cyan">
                    {legLabel}
                  </p>
                  <p className="mt-1 text-[15px] font-bold leading-snug text-white">
                    {destinationLabel}
                  </p>
                  <p className="mt-2 text-[13px] text-slate-300 tabular-nums">
                    {formatRouteDistance(remainingMeters) || '0 m'} left
                    {arrivalClock ? ` · arrive ${arrivalClock}` : ''}
                  </p>
                </div>

                <div className="rounded-2xl bg-white/5 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">
                      Routes
                    </p>
                    <button
                      type="button"
                      onClick={onLoadRoutes}
                      className="text-[12px] font-bold text-nav-cyan underline underline-offset-2"
                    >
                      Refresh
                    </button>
                  </div>

                  <ul className="mt-2 space-y-2">
                    {routes.map((route, index) => (
                      <li key={`route-${index}`}>
                        <button
                          type="button"
                          onClick={() => onSelectRoute(index)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                            selectedRouteIndex === index
                              ? 'border-nav-cyan/60 bg-nav-cyan/10'
                              : 'border-white/10 bg-white/5 hover:bg-white/10'
                          }`}
                        >
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                              selectedRouteIndex === index ? 'bg-nav-cyan' : 'bg-slate-500'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-bold text-white">
                              {index === 0
                                ? 'Recommended'
                                : `Route ${index + 1}`}
                              {selectedRouteIndex === index && routes.length > 1 && (
                                <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-nav-cyan">
                                  in use
                                </span>
                              )}
                            </span>
                            <span className="block text-[12px] text-slate-400 tabular-nums">
                              {formatRouteDuration(
                                index === 0 && remainingSeconds > 0
                                  ? remainingSeconds
                                  : route.durationSeconds,
                              )}
                              {' · '}
                              {formatRouteDistance(
                                index === 0 && remainingMeters > 0
                                  ? remainingMeters
                                  : route.distanceMeters,
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>

                  {routes.length <= 1 && routeStatus !== 'loading' && (
                    <p className="mt-2 text-[12px] text-slate-400">
                      {routingCapabilities.alternatives
                        ? 'The routing engine returned one route for this trip.'
                        : 'This routing engine does not provide alternative routes.'}
                    </p>
                  )}
                </div>

                <p className="text-[12px] leading-relaxed text-slate-400">
                  {routingCapabilities.liveTraffic
                    ? 'Travel time includes live traffic where the routing engine reports it.'
                    : `Live traffic is not available from the ${providerId} routing engine — travel time is based on road distance and typical speeds.`}
                </p>
              </div>
            )}

            {panel === 'steps' && (
              <ol className="space-y-2">
                {steps.length === 0 && (
                  <li className="text-[13px] text-slate-400">
                    No turn list yet — the route has not been calculated.
                  </li>
                )}
                {steps.map((step, index) => (
                  <li
                    key={`${step.cumulativeMeters}-${index}`}
                    className="flex items-start gap-3 rounded-xl bg-white/5 px-3 py-2.5"
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white">
                      <ManeuverGlyph
                        icon={index === 0 ? 'depart' : maneuverIconKey(step)}
                        className="h-5 w-5"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold leading-snug text-white">
                        {step.instruction}
                      </span>
                      <span className="block text-[11px] text-slate-400 tabular-nums">
                        {formatRouteDistance(step.distanceMeters)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {panel === 'report' && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {NAVIGATION_REPORT_CATEGORIES.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setReportCategory(entry.id)}
                      aria-pressed={reportCategory === entry.id}
                      className={`min-h-[40px] rounded-full border px-3.5 text-[13px] font-bold transition ${
                        reportCategory === entry.id
                          ? 'border-amber-400/70 bg-amber-400/15 text-amber-300'
                          : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>

                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Details (optional)
                  </span>
                  <textarea
                    value={reportNote}
                    onChange={(event) => setReportNote(event.target.value)}
                    maxLength={240}
                    rows={3}
                    placeholder="What did you see?"
                    className="mt-1.5 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-[14px] text-white placeholder:text-slate-500 focus:border-nav-cyan focus:outline-none"
                  />
                </label>

                {reportFeedback && (
                  <p
                    className={`text-[13px] font-semibold ${
                      reportFeedback.startsWith('Report sent') ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  >
                    {reportFeedback}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleSendReport}
                  disabled={reportBusy}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-[15px] font-black text-amber-950 transition active:scale-[0.99] disabled:opacity-60"
                >
                  {reportBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send report
                </button>

                <p className="text-[11px] leading-relaxed text-slate-500">
                  Your report is recorded against your account with the current position. It is
                  never shared with other customers.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-3">
            <button
              type="button"
              onClick={closePanel}
              className="flex min-h-[44px] w-full items-center justify-center gap-1 rounded-xl bg-white/10 text-[14px] font-bold text-white transition active:scale-[0.99]"
            >
              Close
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Weak-GPS threshold for the HUD chip (the engine has its own for routing). */
const WEAK_GPS_M = 100;
