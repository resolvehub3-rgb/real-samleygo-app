/**
 * SamleyGo Real-Time Audio Alerts Engine
 * Professional ringing bell and notification sounds for:
 * 1. Restaurant: Ringing bell when customer places a new order.
 * 2. Courier: Bolt/Yango driver-style ringing alert when assigned an order by a restaurant.
 * 3. Customer: Alert chime when order is picked up by courier and when delivered.
 *
 * Includes:
 * - HTML5 Audio playback using real bundled audio assets (/restaurant-bell.mp3, /Courier_Incoming_Request.wav)
 * - Studio-quality Web Audio API synthesized fallbacks (modeled after Bolt/Yango driver chimes)
 * - User gesture audio unlock for mobile Safari & Chrome autoplay restrictions
 * - User preference mute toggle support
 */

let sharedAudioCtx: AudioContext | null = null;
let isAudioUnlocked = false;

/** Returns or initializes a shared Web Audio context */
function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        sharedAudioCtx = new AudioCtx();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/** Automatically unlock audio on first interaction (essential on iOS Safari and mobile Chrome) */
export function initAudioUnlock(): void {
  if (typeof window === 'undefined' || isAudioUnlocked) return;

  const unlock = () => {
    if (isAudioUnlocked) return;
    try {
      const ctx = getAudioContext();
      if (ctx) {
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        // Play silent 1-sample buffer to satisfy iOS audio unlock
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      }
      isAudioUnlocked = true;
    } catch {
      // Ignore
    }
    window.removeEventListener('click', unlock, true);
    window.removeEventListener('touchstart', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };

  window.addEventListener('click', unlock, { capture: true, once: true });
  window.addEventListener('touchstart', unlock, { capture: true, once: true });
  window.addEventListener('keydown', unlock, { capture: true, once: true });
}

// Automatically bind unlock listener on module import
if (typeof window !== 'undefined') {
  initAudioUnlock();
}

/** Check if user has muted sound alerts */
export function isSoundMuted(): boolean {
  try {
    return localStorage.getItem('samleygo_sound_muted') === 'true';
  } catch {
    return false;
  }
}

/** Toggle user sound mute preference */
export function setSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem('samleygo_sound_muted', muted ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

/**
 * Play an audio file with Web Audio synthesized fallback if autoplay is restricted
 * or file fails to load.
 */
function playAudioWithFallback(
  audioUrl: string,
  fallbackSynth: () => void,
  volume = 1.0
): void {
  if (isSoundMuted()) return;

  try {
    const audio = new Audio(audioUrl);
    audio.volume = Math.max(0, Math.min(1, volume));
    const playPromise = audio.play();

    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        // Autoplay policy or asset issue -> fall back to synthesized chime
        console.warn(`[AudioEngine] Falling back to Web Audio synth for ${audioUrl}:`, err?.message || err);
        fallbackSynth();
      });
    }
  } catch {
    fallbackSynth();
  }
}

// ============================================================================
// 1. RESTAURANT ALERT: Ringing Bell on Incoming Customer Order
// ============================================================================

/** Synthesizes a crisp brass service counter ringing bell */
export function synthesizeRestaurantBell(): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Double-strike service bell (strike 1 at 0s, strike 2 at 0.35s)
    const strikes = [0, 0.35];

    strikes.forEach((delay) => {
      const strikeTime = now + delay;

      // Primary bell tone (~2093 Hz, high C7 metallic ring)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(2093, strikeTime);
      gain1.gain.setValueAtTime(0, strikeTime);
      gain1.gain.linearRampToValueAtTime(0.5, strikeTime + 0.005);
      gain1.gain.exponentialRampToValueAtTime(0.0001, strikeTime + 0.9);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(strikeTime);
      osc1.stop(strikeTime + 0.95);

      // Shimmering overtone (~2793.8 Hz, F7 harmonic)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(2793.8, strikeTime);
      gain2.gain.setValueAtTime(0, strikeTime);
      gain2.gain.linearRampToValueAtTime(0.3, strikeTime + 0.005);
      gain2.gain.exponentialRampToValueAtTime(0.0001, strikeTime + 0.7);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(strikeTime);
      osc2.stop(strikeTime + 0.75);

      // Metallic transient ping (~4186 Hz, C8 strike click)
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(4186, strikeTime);
      gain3.gain.setValueAtTime(0.2, strikeTime);
      gain3.gain.exponentialRampToValueAtTime(0.0001, strikeTime + 0.08);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(strikeTime);
      osc3.stop(strikeTime + 0.09);
    });
  } catch (e) {
    console.error('[AudioEngine] Error synthesizing restaurant bell:', e);
  }
}

/**
 * Triggers the ringing bell alert for restaurants when a new customer order arrives.
 */
export function playRestaurantOrderAlert(): void {
  playAudioWithFallback('/restaurant-bell.mp3', synthesizeRestaurantBell, 0.95);
}

// ============================================================================
// 2. COURIER ALERT: Bolt / Yango Driver Request Sound
// ============================================================================

/**
 * Synthesizes a signature Bolt/Yango/Uber driver-style incoming trip request alert:
 * Rhythmic, high-energy ascending dual chime pattern.
 */
export function synthesizeCourierRequestSound(): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Bolt/Yango signature 3-pulse request chime:
    // Pulse 1: 880 Hz (A5) -> 1174 Hz (D6)
    // Pulse 2: 987 Hz (B5) -> 1318 Hz (E6)
    // Pulse 3: 1046 Hz (C6) -> 1568 Hz (G6)
    const notes = [
      { t: 0.00, f1: 880, f2: 1174 },
      { t: 0.28, f1: 987, f2: 1318 },
      { t: 0.56, f1: 1046, f2: 1568 },
    ];

    notes.forEach(({ t, f1, f2 }) => {
      const strikeTime = now + t;

      // First tone of pulse
      const oscA = ctx.createOscillator();
      const gainA = ctx.createGain();
      oscA.type = 'triangle';
      oscA.frequency.setValueAtTime(f1, strikeTime);
      gainA.gain.setValueAtTime(0, strikeTime);
      gainA.gain.linearRampToValueAtTime(0.45, strikeTime + 0.015);
      gainA.gain.exponentialRampToValueAtTime(0.001, strikeTime + 0.22);
      oscA.connect(gainA);
      gainA.connect(ctx.destination);
      oscA.start(strikeTime);
      oscA.stop(strikeTime + 0.24);

      // Accent tone of pulse (slightly higher)
      const oscB = ctx.createOscillator();
      const gainB = ctx.createGain();
      oscB.type = 'sine';
      oscB.frequency.setValueAtTime(f2, strikeTime + 0.06);
      gainB.gain.setValueAtTime(0, strikeTime + 0.06);
      gainB.gain.linearRampToValueAtTime(0.55, strikeTime + 0.075);
      gainB.gain.exponentialRampToValueAtTime(0.001, strikeTime + 0.26);
      oscB.connect(gainB);
      gainB.connect(ctx.destination);
      oscB.start(strikeTime + 0.06);
      oscB.stop(strikeTime + 0.28);
    });
  } catch (e) {
    console.error('[AudioEngine] Error synthesizing courier request chime:', e);
  }
}

/**
 * Triggers the ringing alert for couriers when an order is assigned to them by a restaurant.
 * Matches Bolt / Yango driver trip alert sound.
 */
export function playCourierAssignedAlert(): void {
  playAudioWithFallback('/Courier_Incoming_Request.wav', synthesizeCourierRequestSound, 1.0);
}

// ============================================================================
// 3. CUSTOMER ALERTS: Picked Up & Delivered Alerts (Bolt/Yango ride style)
// ============================================================================

/**
 * Customer Alert: When order is picked up from the restaurant kitchen.
 * Upbeat two-tone alert chime (like driver arrived / trip started in ride apps).
 */
export function playCustomerPickupAlert(): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Upbeat ascending double chime (E5 -> B5)
    const tones = [
      { time: now, freq: 659.25, dur: 0.18, vol: 0.4 },
      { time: now + 0.14, freq: 987.77, dur: 0.45, vol: 0.55 },
    ];

    tones.forEach(({ time, freq, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(vol, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    });
  } catch (e) {
    console.error('[AudioEngine] Error synthesizing pickup alert:', e);
  }
}

/**
 * Customer Alert: When order is delivered at drop-off.
 * Celebratory 4-note chime (C5 -> E5 -> G5 -> C6).
 */
export function playCustomerDeliveredAlert(): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Celebratory completion chime: C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1046Hz)
    const notes = [
      { time: now, freq: 523.25, dur: 0.25, vol: 0.35 },
      { time: now + 0.12, freq: 659.25, dur: 0.25, vol: 0.4 },
      { time: now + 0.24, freq: 783.99, dur: 0.3, vol: 0.45 },
      { time: now + 0.36, freq: 1046.50, dur: 0.7, vol: 0.6 },
    ];

    notes.forEach(({ time, freq, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(vol, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    });
  } catch (e) {
    console.error('[AudioEngine] Error synthesizing delivered alert:', e);
  }
}
