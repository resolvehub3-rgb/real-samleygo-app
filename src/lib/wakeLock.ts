/**
 * Screen Wake Lock for an active courier delivery.
 *
 * The live maps are fed by `navigator.geolocation.watchPosition` callbacks
 * that a browser is free to throttle — or stop entirely — once the screen
 * turns off or the app is backgrounded. That is exactly what happens to a
 * courier who pockets the phone after collecting an order: the GPS write loop
 * stalls, the `couriers` row and `delivery_locations` breadcrumbs stop moving,
 * and every map downstream (customer, restaurant, courier) freezes on the last
 * ping. Holding a screen wake lock for as long as tracking is active keeps
 * those callbacks running for the whole trip.
 *
 * Deliberately best-effort: unsupported browsers, insecure contexts and
 * denied requests all mean "no lock" rather than an error — tracking still
 * works, just with the device's own screen timeout.
 */

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

let sentinel: WakeLockSentinelLike | null = null;
let wanted = false;

const getWakeLock = (): WakeLockLike | null => {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return null;
  if (typeof window !== 'undefined' && !window.isSecureContext) return null;
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock ?? null;
};

const releaseSentinel = () => {
  if (!sentinel) return;
  const held = sentinel;
  sentinel = null;
  // A rejected release is already a released lock — nothing to report.
  Promise.resolve(held.release()).catch(() => undefined);
};

const tryAcquire = async () => {
  const wakeLock = getWakeLock();
  if (!wakeLock || !wanted || sentinel) return;
  // request() rejects while the document is hidden — the visibilitychange
  // listener below re-tries the moment the page is visible again (the browser
  // drops a wake lock on hide, so it has to be re-acquired every time).
  if (document.visibilityState !== 'visible') return;
  try {
    const acquired = await wakeLock.request('screen');
    if (!wanted) {
      Promise.resolve(acquired.release()).catch(() => undefined);
      return;
    }
    sentinel = acquired;
    acquired.addEventListener?.('release', () => {
      if (sentinel === acquired) sentinel = null;
    });
  } catch {
    // Permission denied / battery saver policy — nothing further we can do.
  }
};

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    void tryAcquire();
  } else {
    releaseSentinel();
  }
};

/**
 * Keep the screen awake while courier GPS tracking is active.
 *
 * @returns a cleanup function that stops holding the lock.
 */
export function keepScreenAwake(): () => void {
  wanted = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  void tryAcquire();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    wanted = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseSentinel();
  };
}
