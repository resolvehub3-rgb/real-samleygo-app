/**
 * SamleyGo navigation speech — the ONE place the app talks to the browser's
 * text-to-speech engine.
 *
 * Why a service instead of scattered utterance calls inside React components:
 *
 *  - a single owner for voice selection (en-GH → en-GB → en-US → any English
 *    voice), rate/volume, the utterance queue and cancellation, so pending
 *    instructions can never stack up or outlive the route they belong to;
 *  - every failure — unsupported browser, blocked autoplay, a throwing engine
 *    — is caught HERE and surfaced as state. Voice may break; GPS, maps,
 *    routing, realtime and the delivery flow must never notice;
 *  - the module is import-safe in plain Node (the unit tests run there):
 *    every browser API is touched lazily behind `isSupported()`.
 *
 * PLATFORM LIMITATION (documented on purpose): browsers do not guarantee
 * speech while the PWA is backgrounded or the screen is locked. SamleyGo does
 * not fake it — during a trip `src/lib/wakeLock.ts` keeps the screen awake,
 * which is what actually keeps speech alive on mobile.
 */

import { navLog } from './navigation';

export interface NavigationSpeechState {
  /** Voice output is switched on (policy layer, persisted by the engine). */
  enabled: boolean;
  /** The platform offers speech synthesis at all. */
  supported: boolean;
  /**
   * The browser refused speech (autoplay/gesture policy). The engine shows a
   * non-blocking hint and re-arms on the next user gesture (`unlock()`).
   */
  blocked: boolean;
}

/**
 * The speech abstraction consumed by the navigation voice engine — never a
 * raw `SpeechSynthesis` handle, so the engine stays testable and provider of
 * the TTS stays swappable.
 */
export interface NavigationSpeechService {
  /** Speak one instruction. Never throws, never stacks without bound. */
  speak(text: string): void;
  /** Drop everything queued and stop whatever is speaking right now. */
  cancel(): void;
  isSupported(): boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
  setRate(rate: number): void;
  /** Re-arm speech from inside a real user gesture after a policy block. */
  unlock(): void;
  isBlocked(): boolean;
  subscribe(listener: (state: NavigationSpeechState) => void): () => void;
}

/** Preference order for the spoken voice: Ghana English first, English last. */
export const VOICE_LANGUAGE_PREFERENCE = ['en-GH', 'en-GB', 'en-US'] as const;

const FALLBACK_LANG = 'en-US';
/** Navigation speech reads slightly faster than conversation. */
const DEFAULT_RATE = 1.05;
const DEFAULT_VOLUME = 1;
/** Hard cap on queued utterances — an instruction must never pile up. */
const MAX_PENDING_UTTERANCES = 3;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;

const normalizeLang = (lang: string | undefined): string =>
  (lang ?? '').trim().replace(/_/g, '-').toLowerCase();

/**
 * Best available voice for a Ghanaian delivery app: exact `en-GH`, then
 * other English locales, then any English voice — never a fabricated pick.
 */
const pickVoice = (voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
  for (const wanted of VOICE_LANGUAGE_PREFERENCE) {
    const exact = voices.find((voice) => normalizeLang(voice.lang) === wanted);
    if (exact) return exact;
  }
  const english = voices.filter((voice) => normalizeLang(voice.lang).startsWith('en'));
  return english.find((voice) => voice.localService) ?? english[0] ?? null;
};

/**
 * Create a speech service. The returned object is safe to construct in Node:
 * nothing touches the DOM until a method is called on a platform that has it.
 */
export function createSpeechService(): NavigationSpeechService {
  const listeners = new Set<(state: NavigationSpeechState) => void>();

  let enabled = true;
  let blocked = false;
  let rate = DEFAULT_RATE;
  let volume = DEFAULT_VOLUME;
  /** Incremented by `cancel()` so late callbacks of dropped utterances are ignored. */
  let generation = 0;
  let pending = 0;
  let chosenVoice: SpeechSynthesisVoice | null = null;
  let voicesLoaded = false;

  const isSupported = (): boolean => {
    try {
      return (
        typeof window !== 'undefined' &&
        typeof window.speechSynthesis !== 'undefined' &&
        typeof window.SpeechSynthesisUtterance !== 'undefined'
      );
    } catch {
      return false;
    }
  };

  const snapshot = (): NavigationSpeechState => ({
    enabled,
    supported: isSupported(),
    blocked,
  });

  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(snapshot());
      } catch {
        // A listener must never break speech.
      }
    }
  };

  const loadVoices = (): void => {
    if (!isSupported()) return;
    try {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return; // still loading (Chrome is async)
      chosenVoice = pickVoice(Array.from(voices));
      voicesLoaded = true;
    } catch {
      // Voice enumeration is best-effort; the fallback language still speaks.
    }
  };

  if (isSupported()) {
    loadVoices();
    try {
      // Chrome/Android populate the voice list only after this event.
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    } catch {
      // Older engines: the fallback language path still works.
    }
  }

  return {
    speak(text: string): void {
      const message = (text ?? '').trim();
      if (!enabled || !message) return;
      if (!isSupported()) return;

      try {
        const synth = window.speechSynthesis;
        if (!voicesLoaded) loadVoices();

        // Bound the queue: drop everything before it can grow unbounded.
        if (pending >= MAX_PENDING_UTTERANCES) {
          generation += 1;
          pending = 0;
          synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(message);
        if (chosenVoice) {
          utterance.voice = chosenVoice;
          utterance.lang = chosenVoice.lang;
        } else {
          utterance.lang = FALLBACK_LANG;
        }
        utterance.rate = rate;
        utterance.volume = volume;
        utterance.pitch = 1;

        const utteranceGeneration = generation;
        let settled = false;
        const settle = (error?: string): void => {
          if (settled) return;
          settled = true;
          // The utterance was superseded by a cancel — its outcome is history.
          if (utteranceGeneration !== generation) return;
          pending = Math.max(0, pending - 1);
          // Policy refusal → tell the engine so it can ask for a gesture.
          // 'canceled'/'interrupted' are OUR own cancel, never a block.
          if (error === 'not-allowed' || error === 'service-not-supported') {
            blocked = true;
            notify();
          }
        };
        utterance.onend = () => settle();
        utterance.onerror = (event) => settle(event.error);

        pending += 1;
        synth.speak(utterance);
      } catch {
        // Engine threw (locked-down browser, extension interference): mark the
        // block, log for developers, and leave navigation completely alone.
        blocked = true;
        notify();
        navLog('NAVIGATION_VOICE_ERROR', { reason: 'SPEAK_FAILED' }, 'warn');
      }
    },

    cancel(): void {
      if (!isSupported()) return;
      try {
        generation += 1;
        pending = 0;
        window.speechSynthesis.cancel();
      } catch {
        // Cancelling must never throw into navigation.
      }
    },

    isSupported,

    isEnabled(): boolean {
      return enabled;
    },

    setEnabled(value: boolean): void {
      if (value === enabled) return;
      enabled = value;
      if (!enabled) this.cancel();
      notify();
    },

    setVolume(value: number): void {
      volume = clamp01(value);
    },

    setRate(value: number): void {
      if (Number.isFinite(value) && value > 0) rate = Math.min(2, Math.max(0.5, value));
    },

    unlock(): void {
      if (!isSupported()) return;
      try {
        // A gesture-driven resume is what iOS/Chrome look for before allowing
        // the next utterance; the optimistic un-block is verified by the very
        // next speak (which re-sets `blocked` if the platform still refuses).
        window.speechSynthesis.resume();
      } catch {
        // Ignore — the next speak() reports the real outcome.
      }
      if (blocked) {
        blocked = false;
        notify();
      }
    },

    isBlocked(): boolean {
      return blocked;
    },

    subscribe(listener: (state: NavigationSpeechState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** App-wide speech service (one per page — never two queues for one rider). */
export const speechService: NavigationSpeechService = createSpeechService();
