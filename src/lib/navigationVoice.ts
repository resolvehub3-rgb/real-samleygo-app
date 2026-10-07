/**
 * SamleyGo navigation voice guidance — the `NavigationVoiceGuidanceEngine`.
 *
 * One engine per page, feeding on the SAME navigation state the courier's
 * map already produces (no second GPS watcher, no second router):
 *
 *   existing progress effect (CourierLiveMap)
 *        │  route + upcoming maneuver + progress along the route
 *        ▼
 *   NavigationVoiceGuidance ── announcement state machine ──► speech service
 *        ▲                                                    (src/lib/speech.ts)
 *        └── courier-request bell event (duck + re-announce)
 *
 * Responsibilities, in order of the pipeline:
 *
 *  1. Route awareness — accepts only the provider's real `NavigationRoute`
 *     and its real steps. Every spoken word derives from `NavigationStep`
 *     maneuver data; nothing is ever invented (no AI, no compass guessing).
 *  2. Distance thresholds — FAR → NEAR → IMMEDIATE bands around the next
 *     maneuver, scaled by the courier's speed and gated by GPS accuracy.
 *     The same `maneuver.step` drives the visual HUD card, so what the rider
 *     reads and what they hear are always the same instruction.
 *  3. Duplicate suppression — a per-maneuver announcement record: each band
 *     speaks at most once per maneuver, and a minimum gap absorbs GPS jitter.
 *  4. Lifecycle — destination change, reroute, arrival, cancellation and
 *     logout all cancel pending speech and reset state deterministically.
 *  5. Session exclusivity — mounted navigation surfaces `attach()` an owner
 *     id; only attached owners may feed the engine, and the last `detach()`
 *     stops speech. Customers/restaurants never attach, so they never speak.
 *
 * The module is dependency-light on purpose (navigation domain + the speech
 * interface) so `scripts/navigation_voice.test.ts` can drive every path in
 * plain Node with a fake speech service.
 */

import {
  buildInstruction,
  currentStepIndex,
  isOffRoute,
  navLog,
  type NavigationPhase,
  type NavigationRoute,
  type NavigationStep,
  type UpcomingManeuver,
} from './navigation';
import { createSpeechService, type NavigationSpeechService } from './speech';
import { AUDIO_ALERT_EVENT, isSoundMuted } from './soundAlerts';

// ───────────────────────────────────────────────────────────────────────────
// Configuration (no magic numbers elsewhere)
// ───────────────────────────────────────────────────────────────────────────

/** Base announcement bands (metres), scaled by speed at evaluation time. */
export const VOICE_THRESHOLDS = {
  /** "In 300 meters, turn right." */
  FAR_TURN: 300,
  /** "In 100 meters, turn right." */
  NEAR_TURN: 100,
  /** "Turn right." */
  IMMEDIATE_TURN: 30,
} as const;

/** Speed at which the base bands are exactly right (~29 km/h, city riding). */
export const VOICE_SPEED_REFERENCE_MPS = 8;
export const VOICE_SPEED_FACTOR_MIN = 0.6;
export const VOICE_SPEED_FACTOR_MAX = 1.6;
/** Fixes worse than this never produce speech (the marker is guessing too). */
export const VOICE_MAX_ACCURACY_M = 500;
/** Never confirm a 30 m turn from a fix less precise than this. */
export const VOICE_IMMEDIATE_MAX_ACCURACY_M = 60;
/** Two announcements closer than this are jitter, not progress. */
export const VOICE_MIN_GAP_MS = 1_200;
/** From this step length a straight leg gets one "Continue straight for …". */
export const VOICE_LONG_STRAIGHT_M = 400;
/** Departure guidance only ever fires right at the start of a route. */
export const VOICE_DEPART_MAX_ALONG_M = 30;
/** A deviation reroute note stays valid this long (route requests take seconds). */
export const VOICE_REROUTE_NOTE_TTL_MS = 45_000;
/** …and "Recalculating route." is never repeated within this window. */
export const VOICE_REROUTE_MIN_GAP_MS = 15_000;
/** Debounce for "Destination changed." across rapid phase flips. */
export const VOICE_DESTINATION_MIN_GAP_MS = 5_000;
/** After the courier-request bell: hold speech, then re-say the current band. */
export const VOICE_ALERT_QUIET_MS = 2_500;
/** Cap on remembered maneuver keys (bounded memory per journey). */
const ANNOUNCED_KEYS_MAX = 64;
/** Persisted ON/OFF preference (one rider, one device). */
export const VOICE_STORAGE_KEY = 'samleygo_nav_voice_enabled';

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export type VoiceAnnouncementStage =
  | 'DEPART'
  | 'FAR'
  | 'NEAR'
  | 'IMMEDIATE'
  | 'STRAIGHT'
  | 'DESTINATION_CHANGED'
  | 'RECALCULATING'
  | 'ARRIVAL';

/**
 * One navigation progress sample, exactly as the map already computed it.
 * `alongMeters`/`offRouteMeters` come from the shared route projection — the
 * voice engine never re-projects or re-runs routing.
 */
export interface VoiceUpdate {
  /** Which mounted navigation surface reported this (only attached ones count). */
  owner: string;
  /** Identity of the destination being driven to (`''` = no target right now). */
  sessionKey: string;
  phase: NavigationPhase;
  /** The active leg's road route, already filtered for staleness by the caller. */
  route: NavigationRoute | null;
  /** Upcoming maneuver from `nextManeuver` (null while there is no route). */
  maneuver: UpcomingManeuver | null;
  /** Metres travelled along the route (from `projectOnRoute`). */
  alongMeters: number;
  /** Perpendicular distance from the route (from `projectOnRoute`). */
  offRouteMeters: number;
  /** Existing proximity-prompt arrival flag — voice never re-invents it. */
  arrived: boolean;
  accuracyMeters?: number | null;
  speedMps?: number | null;
}

export interface NavigationVoiceUiState {
  enabled: boolean;
  supported: boolean;
  blocked: boolean;
}

export interface NavigationVoiceGuidance {
  /** A navigation screen joins the session (customers never call this). */
  attach(owner: string): void;
  /** A navigation screen unmounts; the last one out stops all speech. */
  detach(owner: string): void;
  /** Feed one navigation progress sample. Cheap, synchronous, never throws. */
  update(input: VoiceUpdate): void;
  /** The map started a deviation reroute — next route says so (debounced). */
  noteDeviationReroute(): void;
  /** End all voice activity now (session over, order cancelled, logout). */
  stop(): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  isSupported(): boolean;
  /** Re-arm speech from inside a user gesture (autoplay policy). */
  unlock(): void;
  getState(): NavigationVoiceUiState;
  subscribe(listener: (state: NavigationVoiceUiState) => void): () => void;
}

export interface NavigationVoiceOptions {
  /** Injectable speech backend (unit tests pass a fake). */
  speech?: NavigationSpeechService;
  /** Injectable clock (unit tests control time). */
  now?: () => number;
  /** Persist the ON/OFF preference (off in unit tests). */
  persist?: boolean;
  /** Event target for the courier-request bell (unit tests pass their own). */
  eventTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for the test suite)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Natural spoken distance — "30 meters", "100 meters", "1 kilometer",
 * "1.5 kilometers". Never "0.03 kilometers".
 */
export function formatSpokenDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 meters';
  if (meters < 1000) {
    const rounded =
      meters < 30 ? Math.max(5, Math.round(meters / 5) * 5) : Math.round(meters / 10) * 10;
    return `${rounded} meters`;
  }
  const km = meters / 1000;
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} kilometer${rounded === 1 ? '' : 's'}`;
}

const ORDINALS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
  6: 'sixth',
  7: 'seventh',
  8: 'eighth',
  9: 'ninth',
  10: 'tenth',
};

const ordinalWord = (value: number): string => ORDINALS[value] ?? `${value}th`;

const lowerFirst = (text: string): string =>
  text ? text[0].toLowerCase() + text.slice(1) : text;

const ROAD_NAMES_NEEDED = true;
const ROAD_NAMES_DROPPED = false;

/**
 * The maneuver phrase exactly as it should be SPOKEN (no distance prefix).
 *
 * Derived from the routing provider's own maneuver type/modifier/road name
 * via `buildInstruction` (the SAME function that renders the HUD card), with
 * two speech-specific refinements: roundabout exits read as ordinals
 * ("the second exit"), and callers can drop the road name for the short
 * near/immediate forms ("turn right", not "turn right onto Ring Road").
 */
export function spokenManeuverPhrase(
  step: NavigationStep,
  includeRoadName: boolean
): string {
  const type = (step.maneuverType ?? '').toLowerCase().trim();
  const name = includeRoadName ? (step.roadName ?? '').trim() : '';

  if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout') {
    const exit = step.maneuverExit ?? 0;
    if (exit > 0) {
      return `At the roundabout, take the ${ordinalWord(exit)} exit${
        name ? ` onto ${name}` : ''
      }`;
    }
  }

  return buildInstruction({
    type: step.maneuverType,
    modifier: step.maneuverModifier,
    name,
    bearingAfter: step.maneuverBearingAfter ?? null,
    exit: step.maneuverExit ?? null,
  });
}

export interface VoiceThresholds {
  far: number;
  near: number;
  immediate: number;
}

/**
 * Announcement bands for the current motion: faster riding gets warned
 * earlier, walking pace waits until closer, and an unknown/zero speed falls
 * back to the reference (a stationary courier must still hear "In 300
 * meters, turn right." while waiting at a light).
 */
export function voiceThresholds(
  input: { speedMps?: number | null; accuracyMeters?: number | null } = {}
): VoiceThresholds {
  const reported = input.speedMps;
  const speed =
    typeof reported === 'number' && Number.isFinite(reported) && reported > 0
      ? reported
      : VOICE_SPEED_REFERENCE_MPS;
  const factor = Math.min(
    VOICE_SPEED_FACTOR_MAX,
    Math.max(VOICE_SPEED_FACTOR_MIN, speed / VOICE_SPEED_REFERENCE_MPS)
  );
  return {
    far: Math.round(VOICE_THRESHOLDS.FAR_TURN * factor),
    near: Math.round(VOICE_THRESHOLDS.NEAR_TURN * factor),
    immediate: Math.round(VOICE_THRESHOLDS.IMMEDIATE_TURN * factor),
  };
}

const TURN_MODIFIERS = new Set([
  'uturn',
  'sharp left',
  'sharp right',
  'left',
  'right',
  'slight left',
  'slight right',
]);

/** A step that just keeps going (no turn) — eligible for the long-road line. */
const isStraightStep = (step: NavigationStep): boolean => {
  const type = (step.maneuverType ?? '').toLowerCase().trim();
  if (type !== 'continue' && type !== 'new name' && type !== 'default') return false;
  return !TURN_MODIFIERS.has((step.maneuverModifier ?? '').toLowerCase().trim());
};

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/** Identity of a maneuver across routine route refreshes (index+type+road). */
const maneuverKeyOf = (maneuver: UpcomingManeuver): string =>
  `${maneuver.index}|${maneuver.step.maneuverType}|${maneuver.step.maneuverModifier ?? ''}|${
    maneuver.step.roadName ?? ''
  }`;

interface AnnouncementFlags {
  far: boolean;
  near: boolean;
  immediate: boolean;
}

/**
 * The full text for an announcement stage, assembled from real maneuver data.
 * `step` is required for the maneuver stages and ignored for the events
 * (destination changed / recalculating / arrival).
 */
export function announcementText(
  stage: VoiceAnnouncementStage,
  step: NavigationStep | null,
  distanceMeters: number,
  phase: NavigationPhase
): string {
  switch (stage) {
    case 'DEPART':
      return `${spokenManeuverPhrase(step as NavigationStep, ROAD_NAMES_NEEDED)}.`;
    case 'FAR':
      return `In ${formatSpokenDistance(distanceMeters)}, ${lowerFirst(
        spokenManeuverPhrase(step as NavigationStep, ROAD_NAMES_NEEDED)
      )}.`;
    case 'NEAR':
      return `In ${formatSpokenDistance(distanceMeters)}, ${lowerFirst(
        spokenManeuverPhrase(step as NavigationStep, ROAD_NAMES_DROPPED)
      )}.`;
    case 'IMMEDIATE':
      return `${spokenManeuverPhrase(step as NavigationStep, ROAD_NAMES_DROPPED)}.`;
    case 'STRAIGHT':
      return `Continue straight for ${formatSpokenDistance(distanceMeters)}.`;
    case 'DESTINATION_CHANGED':
      return phase === 'TO_CUSTOMER' || phase === 'ARRIVED'
        ? 'Navigation updated. Continue to the customer.'
        : 'Destination changed.';
    case 'RECALCULATING':
      return 'Recalculating route.';
    case 'ARRIVAL':
      return phase === 'TO_RESTAURANT'
        ? 'You have arrived at the restaurant.'
        : 'You have arrived at your destination.';
    default:
      return '';
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Engine
// ───────────────────────────────────────────────────────────────────────────

/** Read the persisted preference; falls back to the existing sound setting. */
const readInitialEnabled = (): boolean => {
  try {
    const stored = localStorage.getItem(VOICE_STORAGE_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // No storage (Node, privacy mode) — fall through to the app preference.
  }
  try {
    return !isSoundMuted();
  } catch {
    return true;
  }
};

/**
 * Create a voice guidance engine. Production uses the module singleton
 * below; tests create isolated instances with a fake speech service, a
 * controlled clock and persistence disabled.
 */
export function createNavigationVoiceGuidance(
  options: NavigationVoiceOptions = {}
): NavigationVoiceGuidance {
  const speech = options.speech ?? createSpeechService();
  const clock = options.now ?? (() => Date.now());
  const persist = options.persist ?? true;
  const eventTarget =
    options.eventTarget !== undefined
      ? options.eventTarget
      : typeof window !== 'undefined'
        ? window
        : null;

  const owners = new Set<string>();
  const listeners = new Set<(state: NavigationVoiceUiState) => void>();
  let alertListenerAttached = false;
  let enabled = persist ? readInitialEnabled() : true;

  // ── Journey state (reset on destination change / reroute / stop) ──────
  let sessionKey: string | null = null;
  let phase: NavigationPhase = 'IDLE';
  let routeId: string | null = null;
  const announced = new Map<string, AnnouncementFlags>();
  let straightAnnouncedKey: string | null = null;
  let departAnnounced = false;
  let arrivalAnnounced = false;
  /** Key of the maneuver most recently evaluated (bell re-announcement). */
  let lastBandKey: string | null = null;

  // ── Timing state ──────────────────────────────────────────────────────
  let lastSpokenAt = 0;
  let voiceQuietUntil = 0;
  let rerouteNotedAt = 0;
  let lastRerouteSpokenAt = 0;
  let lastDestinationSpokenAt = 0;

  const uiState = (): NavigationVoiceUiState => ({
    enabled,
    supported: speech.isSupported(),
    blocked: speech.isBlocked(),
  });

  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(uiState());
      } catch {
        // A UI listener must never break voice guidance.
      }
    }
  };

  // The speech backend owns `blocked` — mirror its changes to the UI.
  speech.subscribe(() => notify());

  const announce = (stage: VoiceAnnouncementStage, text: string, at: number): void => {
    if (!text) return;
    lastSpokenAt = at;
    navLog('NAVIGATION_VOICE_ANNOUNCEMENT', { stage, text, phase });
    try {
      speech.speak(text);
    } catch {
      // Voice failure must never break navigation (§35).
      navLog('NAVIGATION_VOICE_ERROR', { stage, reason: 'SPEAK_THREW' }, 'warn');
    }
  };

  /** Quiet window (bell) and anti-jitter gap both gate routine stages. */
  const canSpeakBand = (at: number): boolean =>
    at >= voiceQuietUntil && at - lastSpokenAt >= VOICE_MIN_GAP_MS;

  const resetManeuverState = (): void => {
    announced.clear();
    straightAnnouncedKey = null;
    lastBandKey = null;
  };

  const resetJourney = (): void => {
    routeId = null;
    departAnnounced = false;
    arrivalAnnounced = false;
    resetManeuverState();
  };

  const flagsFor = (key: string): AnnouncementFlags => {
    const existing = announced.get(key);
    if (existing) return existing;
    const fresh: AnnouncementFlags = { far: false, near: false, immediate: false };
    announced.set(key, fresh);
    // Bounded memory: drop the oldest maneuver once the cap is reached.
    if (announced.size > ANNOUNCED_KEYS_MAX) {
      const oldest = announced.keys().next().value;
      if (oldest !== undefined) announced.delete(oldest);
    }
    return fresh;
  };

  const routeSignature = (route: NavigationRoute): string =>
    `${route.calculatedAt}|${route.steps.length}|${route.distanceMeters}`;

  const handleUpdate = (input: VoiceUpdate): void => {
    const at = clock();
    if (!enabled) return;
    // Unsupported platform or a policy block: stay silent, never crash.
    if (!speech.isSupported() || speech.isBlocked()) return;

    const nextSession = input.sessionKey;
    phase = input.phase;

    // ── 1. Destination lifecycle ────────────────────────────────────────
    if (nextSession !== sessionKey) {
      const previous = sessionKey;
      // Only a REPLACED journey can have speech in flight to cancel; the
      // very first adoption starts from silence.
      if (previous) speech.cancel();
      resetJourney();
      sessionKey = nextSession || null;
      if (previous && nextSession && at - lastDestinationSpokenAt >= VOICE_DESTINATION_MIN_GAP_MS) {
        lastDestinationSpokenAt = at;
        announce(
          'DESTINATION_CHANGED',
          announcementText('DESTINATION_CHANGED', null, 0, input.phase),
          at
        );
      }
      if (!nextSession) return; // no target → completely silent
    }

    // ── 2. Route lifecycle (null never counts as a change) ──────────────
    const route = input.route;
    if (route) {
      const nextRouteId = routeSignature(route);
      if (nextRouteId !== routeId) {
        const fromDeviation =
          rerouteNotedAt > 0 && at - rerouteNotedAt <= VOICE_REROUTE_NOTE_TTL_MS;
        if (fromDeviation) {
          // Old route's pending speech dies before the new one loads (§13).
          speech.cancel();
          resetManeuverState();
          rerouteNotedAt = 0;
          if (
            !input.arrived &&
            !arrivalAnnounced &&
            at - lastRerouteSpokenAt >= VOICE_REROUTE_MIN_GAP_MS
          ) {
            lastRerouteSpokenAt = at;
            announce('RECALCULATING', announcementText('RECALCULATING', null, 0, input.phase), at);
          }
        }
        // A routine origin-refresh adopts silently: the maneuver announcement
        // keys survive, so a 45 s route refresh can never repeat an instruction.
        routeId = nextRouteId;
      }
    }

    if (!route || !input.maneuver) return;

    // ── 3. Arrival — the existing proximity prompt, spoken exactly once ─
    if (input.arrived && !arrivalAnnounced) {
      speech.cancel();
      arrivalAnnounced = true;
      announce('ARRIVAL', announcementText('ARRIVAL', null, 0, input.phase), at);
      return;
    }
    if (arrivalAnnounced) return;

    // ── 4. Trust gates: only a fix the navigation stack trusts may speak ─
    const accuracy = finiteOrNull(input.accuracyMeters);
    if (accuracy != null && accuracy > VOICE_MAX_ACCURACY_M) return;
    if (isOffRoute(input.offRouteMeters, accuracy)) {
      // Lost: the reroute owns the next words, not a stale projection.
      return;
    }

    const steps = route.steps;
    const maneuver = input.maneuver;

    // ── 5. Departure guidance, once, at the very start of the trip ──────
    const first = steps[0];
    if (
      !departAnnounced &&
      first &&
      (first.maneuverType ?? '').toLowerCase() === 'depart' &&
      input.alongMeters <= VOICE_DEPART_MAX_ALONG_M &&
      canSpeakBand(at)
    ) {
      departAnnounced = true;
      announce('DEPART', announcementText('DEPART', first, 0, input.phase), at);
    }

    // ── 6. One calm "Continue straight for …" when a long straight begins ─
    const currentIndex = currentStepIndex(route, input.alongMeters);
    const current = steps[currentIndex];
    if (
      current &&
      isStraightStep(current) &&
      current.distanceMeters >= VOICE_LONG_STRAIGHT_M &&
      canSpeakBand(at)
    ) {
      const remaining = Math.min(
        current.distanceMeters,
        Math.max(0, current.cumulativeMeters + current.distanceMeters - input.alongMeters)
      );
      const straightKey = `${currentIndex}|${current.roadName ?? ''}`;
      if (
        straightAnnouncedKey !== straightKey &&
        remaining >= VOICE_LONG_STRAIGHT_M / 2
      ) {
        straightAnnouncedKey = straightKey;
        announce('STRAIGHT', announcementText('STRAIGHT', null, remaining, input.phase), at);
      }
    }

    // ── 7. Progressive bands on the upcoming maneuver ───────────────────
    const step = maneuver.step;
    const type = (step.maneuverType ?? '').toLowerCase().trim();
    if (type === 'arrive') return; // the arrival announcement speaks for itself

    const key = maneuverKeyOf(maneuver);
    lastBandKey = key;
    const flags = flagsFor(key);
    const thresholds = voiceThresholds({
      speedMps: input.speedMps,
      accuracyMeters: accuracy,
    });
    const distance = Math.max(0, maneuver.distanceMeters);

    let stage: 'FAR' | 'NEAR' | 'IMMEDIATE' | null = null;
    if (
      distance <= thresholds.immediate &&
      !(accuracy != null && accuracy > VOICE_IMMEDIATE_MAX_ACCURACY_M)
    ) {
      stage = 'IMMEDIATE';
    } else if (distance <= thresholds.near) {
      stage = 'NEAR';
    } else if (distance <= thresholds.far) {
      stage = 'FAR';
    }
    if (!stage) return;

    const flagName = stage === 'FAR' ? 'far' : stage === 'NEAR' ? 'near' : 'immediate';
    if (flags[flagName]) return; // already spoken for THIS maneuver (§7)
    if (!canSpeakBand(at)) return; // jitter/gap — retry on the next fix

    flags[flagName] = true;
    announce(stage, announcementText(stage, step, distance, input.phase), at);
  };

  // ── Courier-request bell: duck, stay quiet through the chime, then
  //    re-announce whatever band the courier is actually in (§18) ───────
  const handleAudioAlert = (): void => {
    if (!enabled || owners.size === 0 || !sessionKey) return;
    speech.cancel();
    voiceQuietUntil = Math.max(voiceQuietUntil, clock() + VOICE_ALERT_QUIET_MS);
    if (lastBandKey) announced.delete(lastBandKey);
  };

  const attachAlertListener = (): void => {
    if (alertListenerAttached || !eventTarget) return;
    try {
      eventTarget.addEventListener(AUDIO_ALERT_EVENT, handleAudioAlert);
      alertListenerAttached = true;
    } catch {
      // Coordination is optional; navigation never depends on it.
    }
  };

  const detachAlertListener = (): void => {
    if (!alertListenerAttached || !eventTarget) return;
    try {
      eventTarget.removeEventListener(AUDIO_ALERT_EVENT, handleAudioAlert);
    } catch {
      // Ignore.
    }
    alertListenerAttached = false;
  };

  return {
    attach(owner: string): void {
      if (!owner) return;
      const wasIdle = owners.size === 0;
      owners.add(owner);
      if (wasIdle) attachAlertListener();
    },

    detach(owner: string): void {
      owners.delete(owner);
      if (owners.size > 0) return;
      // Last navigation screen gone (logout, screen change, modal closed):
      // stop speech, drop the bell hook, forget the journey.
      detachAlertListener();
      speech.cancel();
      resetJourney();
      sessionKey = null;
    },

    update(input: VoiceUpdate): void {
      try {
        if (!input.owner || !owners.has(input.owner)) return; // attached screens only
        handleUpdate(input);
      } catch (error) {
        // Defensive: voice must never take navigation down with it.
        navLog(
          'NAVIGATION_VOICE_ERROR',
          { reason: 'UPDATE_THREW', message: error instanceof Error ? error.name : 'unknown' },
          'warn'
        );
      }
    },

    noteDeviationReroute(): void {
      rerouteNotedAt = clock();
    },

    stop(): void {
      speech.cancel();
      resetJourney();
      sessionKey = null;
      rerouteNotedAt = 0;
      voiceQuietUntil = 0;
    },

    setEnabled(value: boolean): void {
      if (value === enabled) return;
      enabled = value;
      speech.setEnabled(value);
      if (!value) {
        // Turning voice off must immediately silence anything in flight.
        speech.cancel();
      } else {
        // Fresh start: the next sample adopts the journey silently and the
        // CURRENT band is announced normally (no stale history).
        resetJourney();
        sessionKey = null;
      }
      if (persist) {
        try {
          localStorage.setItem(VOICE_STORAGE_KEY, value ? 'true' : 'false');
        } catch {
          // Preference is best-effort.
        }
      }
      notify();
    },

    isEnabled(): boolean {
      return enabled;
    },

    isSupported(): boolean {
      return speech.isSupported();
    },

    unlock(): void {
      speech.unlock();
      notify();
    },

    getState(): NavigationVoiceUiState {
      return uiState();
    },

    subscribe(listener: (state: NavigationVoiceUiState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The app-wide engine. Created once at import; safe in plain Node (every
 * browser API is touched lazily behind the speech service's capability
 * checks). There is only ever ONE active voice session per page.
 */
export const navigationVoice: NavigationVoiceGuidance = createNavigationVoiceGuidance();
