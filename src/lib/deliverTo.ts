/**
 * The customer's chosen "Deliver To" place.
 *
 * Persisted in localStorage so a refresh restores the customer's real choice
 * instead of falling back to a fabricated default address, and so the home
 * screen pill and the checkout address always start from the same value.
 *
 * Nothing here throws: private mode, blocked storage or a full quota simply
 * degrades to "unset", which the UI renders as "Choose your location" rather
 * than as somebody else's neighbourhood.
 */

const PLACE_KEY = 'samleygo:deliver-to';
const LIVE_KEY = 'samleygo:deliver-to-live';

/** Last place the customer picked or that live tracking resolved. '' = unset. */
export function readDeliverTo(): string {
  try {
    const value = window.localStorage.getItem(PLACE_KEY);
    return value ? value.trim() : '';
  } catch {
    return '';
  }
}

export function persistDeliverTo(value: string): void {
  try {
    const trimmed = (value || '').trim();
    if (trimmed) window.localStorage.setItem(PLACE_KEY, trimmed);
    else window.localStorage.removeItem(PLACE_KEY);
  } catch {
    // Storage unavailable — the session keeps working, it just won't survive.
  }
}

/** Whether the customer asked for live device tracking (resumed on load). */
export function readLiveTracking(): boolean {
  try {
    return window.localStorage.getItem(LIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistLiveTracking(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(LIVE_KEY, '1');
    else window.localStorage.removeItem(LIVE_KEY);
  } catch {
    // Ignore: tracking still works for this visit.
  }
}
