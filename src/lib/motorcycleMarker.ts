/**
 * SamleyGo courier motorcycle map marker — the supplied `motors.png` sprite
 * sheet rendered as a live, direction-aware vehicle instead of a location pin.
 *
 * The sheet (1362×1155, shipped byte-identical at `/assets/motors.png`) was
 * exported with a checkerboard *baked in* where transparency should be, so it
 * is keyed exactly once per session: a flood fill from the sheet borders
 * removes only background-connected checker cells, which keeps every white
 * highlight inside the artwork (wheel rims, lettering, headlight glass)
 * opaque. What remains is a transparent sheet used as a CSS background — the
 * source file on disk is never modified or re-encoded.
 *
 * The sheet's bottom row holds the two courier movement states, both drawn as
 * a side view facing **east**:
 *
 *   - `moving` — bike in motion with speed lines trailing behind it
 *   - `idle`   — rider parked on the green ground ring
 *
 * Because both variants face east, GPS bearing 90° maps to zero rotation, so
 * the marker rotates by `heading − 90°` (`motorcycleRotationDeg`) around the
 * wheel contact point that Advanced Markers anchor to the coordinate
 * (`geometry.anchors` + the same point as `transform-origin`). The bike stays
 * planted on the road at every angle, and a state switch only rewrites
 * `background-position` inside one fixed content box — identical geometry, so
 * the geographic anchor never shifts and no React re-render is involved.
 *
 * Crop rectangles and anchor points were measured from the shipped sheet
 * (label pills excluded: state art starts at y ≥ 852) and are asserted by
 * `scripts/motorcycle_marker.test.ts`.
 */

/** Sheet URL — same origin, no key, precached by the PWA like every icon. */
export const MOTORCYCLE_SHEET_URL = '/assets/motors.png';

/** Pixel dimensions of the shipped sheet (a mismatch refuses to load). */
export const SHEET_WIDTH = 1362;
export const SHEET_HEIGHT = 1155;

export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetPoint {
  x: number;
  y: number;
}

/** Bottom-row state sprites (art only — the "Moving"/"Idle" label pills sit below y 852). */
export const MOVING_ART: SheetRect = { x: 157, y: 852, w: 499, h: 223 };
export const IDLE_ART: SheetRect = { x: 830, y: 852, w: 301, h: 223 };

/** Wheel contact point inside each state sprite — the courier's exact coordinate. */
export const MOVING_ANCHOR: SheetPoint = { x: 535, y: 1046 };
export const IDLE_ANCHOR: SheetPoint = { x: 992, y: 1043 };

/**
 * The state sprites are side views facing east, so bearing 90° needs no
 * rotation. `rotation = heading − MOTORCYCLE_BASE_HEADING_DEG`.
 */
export const MOTORCYCLE_BASE_HEADING_DEG = 90;

export type MotorcycleState = 'moving' | 'idle';

// ---------------------------------------------------------------------------
// Checkerboard keying (baked background → alpha, once per session)
// ---------------------------------------------------------------------------

/**
 * Is this pixel part of the baked checkerboard? Two families: the near-white
 * cells — which also catches the faint glow tints compression blended into the
 * background — and the dim gray-blue cells. Saturated or dark artwork is
 * outside both tolerances, so the artwork's outline always seals its
 * silhouette and the flood fill in `keyCheckerboard` cannot leak inside
 * (interior whites stay opaque precisely because they are not reachable from
 * the sheet border).
 */
export const isCheckerColor = (r: number, g: number, b: number): boolean => {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  if (max - min <= 24 && min >= 226) return true; // white cell / glow tint
  // gray-blue cell, tolerant of the sheet's JPEG-era noise
  if (max <= 235 && r >= 195 && g >= 198 && b >= 201 && max - min <= 26 && b >= r - 4) {
    return true;
  }
  // Gray/white cells dimmed by a *faint* green glow (speed-line and ring
  // haloes): low-saturation, green-dominant, still light. Without this the
  // glow zone keeps a mosaic of opaque near-white blocks behind the marker.
  // Strongly saturated glow (the streak core) and any real artwork stay out:
  // white lettering is brighter than 250, chrome is not green-dominant, and
  // bright greens fall outside the ≤32 spread.
  return max <= 250 && min >= 205 && max - min <= 32 && g >= r && g >= b;
};

/**
 * Key the checkerboard out of an RGBA frame in place: flood fill from every
 * border pixel through checker-colored pixels, zeroing alpha as we go (a zero
 * alpha doubles as the visited flag). Returns how many pixels were removed.
 */
export const keyCheckerboard = (data: Uint8ClampedArray, width: number, height: number): number => {
  if (width <= 0 || height <= 0) return 0;
  const stack = new Int32Array(width * height);
  let top = 0;
  let removed = 0;

  const tryPush = (x: number, y: number): void => {
    const index = y * width + x;
    const rgba = index * 4;
    if (data[rgba + 3] === 0) return; // already keyed (visited)
    if (!isCheckerColor(data[rgba], data[rgba + 1], data[rgba + 2])) return;
    data[rgba + 3] = 0;
    removed += 1;
    stack[top] = index;
    top += 1;
  };

  for (let x = 0; x < width; x += 1) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  while (top > 0) {
    top -= 1;
    const index = stack[top];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) tryPush(x - 1, y);
    if (x < width - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < height - 1) tryPush(x, y + 1);
  }
  return removed;
};

/** Vite inlines `import.meta.env`; in plain Node (tests) it is simply absent. */
const isDevBuild = (): boolean => {
  try {
    return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });

let sheetPromise: Promise<string | null> | null = null;

/**
 * Load and key the sprite sheet exactly once per session, returning an object
 * URL of the transparent sheet (or `null` when anything fails — the caller
 * falls back so a courier is never invisible on a live map). Every map
 * instance (courier screen, live modal, customer/restaurant views) shares the
 * same promise, so the 2.1 MB sheet is downloaded, decoded and keyed a single
 * time; the object URL then lives for the page's lifetime.
 */
export const loadMotorcycleSheet = (): Promise<string | null> => {
  sheetPromise ??= (async () => {
    try {
      if (typeof document === 'undefined') return null;
      const image = await loadImage(MOTORCYCLE_SHEET_URL);
      if (image.naturalWidth !== SHEET_WIDTH || image.naturalHeight !== SHEET_HEIGHT) {
        // Crop rectangles are measured for this exact sheet — never draw a
        // re-exported asset with the wrong geometry.
        if (isDevBuild()) {
          console.warn(
            `[SamleyGo] motorcycle sheet is ${image.naturalWidth}×${image.naturalHeight}, expected ` +
              `${SHEET_WIDTH}×${SHEET_HEIGHT} — update the crops in motorcycleMarker.ts.`
          );
        }
        return null;
      }
      const canvas = document.createElement('canvas');
      canvas.width = SHEET_WIDTH;
      canvas.height = SHEET_HEIGHT;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0);
      const frame = context.getImageData(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
      keyCheckerboard(frame.data, SHEET_WIDTH, SHEET_HEIGHT);
      context.putImageData(frame, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return null;
      return URL.createObjectURL(blob);
    } catch {
      if (isDevBuild()) {
        console.warn(`[SamleyGo] could not key ${MOTORCYCLE_SHEET_URL} — courier marker will use the pin fallback.`);
      }
      return null;
    }
  })();
  return sheetPromise;
};

// ---------------------------------------------------------------------------
// Geometry: one fixed content box, both states aligned on the same anchor
// ---------------------------------------------------------------------------

interface UnionBox {
  /** Wheel-contact point → box left/top (source px). */
  left: number;
  top: number;
  /** Total box size (source px), covering both state arts after alignment. */
  width: number;
  height: number;
}

/**
 * Union of both state sprites after aligning their wheel contact points: each
 * sprite's art is laid out relative to *its* anchor, then the larger extents
 * win per side. Because both states share this box and the anchor's box
 * coordinates (`left`, `top`), switching sprites never moves the marker's
 * geographic point.
 */
const unionBox = (): UnionBox => {
  const extent = (art: SheetRect, anchor: SheetPoint) => ({
    left: anchor.x - art.x,
    right: art.x + art.w - anchor.x,
    top: anchor.y - art.y,
    bottom: art.y + art.h - anchor.y,
  });
  const moving = extent(MOVING_ART, MOVING_ANCHOR);
  const idle = extent(IDLE_ART, IDLE_ANCHOR);
  const left = Math.max(moving.left, idle.left);
  const top = Math.max(moving.top, idle.top);
  return {
    left,
    top,
    width: left + Math.max(moving.right, idle.right),
    height: top + Math.max(moving.bottom, idle.bottom),
  };
};

export interface MotorcycleGeometry {
  /** Display pixels per sheet pixel. */
  scale: number;
  /** Marker content box (CSS px) — transparent padding included. */
  width: number;
  height: number;
  /** AdvancedMarker anchors: the wheel contact lands exactly on the coordinate. */
  anchors: { anchorLeft: string; anchorTop: string };
  /** `transform-origin` of the rotating layer — the same point, in box coords. */
  origin: string;
  /** Shared `background-size` for both states. */
  backgroundSize: string;
  /** Per-state `background-position` — the only thing a state switch rewrites. */
  positions: Record<MotorcycleState, string>;
}

/** All display geometry for a given sheet scale. Pure — unit-tested. */
export const motorcycleGeometry = (scale: number): MotorcycleGeometry => {
  const box = unionBox();
  const position = (anchor: SheetPoint): string =>
    `${(box.left - anchor.x) * scale}px ${(box.top - anchor.y) * scale}px`;
  return {
    scale,
    width: box.width * scale,
    height: box.height * scale,
    anchors: {
      anchorLeft: `${-box.left * scale}px`,
      anchorTop: `${-box.top * scale}px`,
    },
    origin: `${box.left * scale}px ${box.top * scale}px`,
    backgroundSize: `${SHEET_WIDTH * scale}px ${SHEET_HEIGHT * scale}px`,
    positions: {
      moving: position(MOVING_ANCHOR),
      idle: position(IDLE_ANCHOR),
    },
  };
};

/** Content-box width (CSS px) the marker aims for at a given map width. */
export const MOTORCYCLE_BOX_MIN_W = 84;
export const MOTORCYCLE_BOX_MAX_W = 120;
export const MOTORCYCLE_BOX_FRACTION = 0.2;

/**
 * Responsive marker scale: the content box tracks 20% of the map container's
 * width, clamped to 84–120 px, so the bike (~47% of the box) stays crisply
 * identifiable on small Android phones without covering streets on desktop.
 * Evaluated once at marker creation — GPS updates never re-layout it.
 */
export const motorcycleScaleFor = (containerWidth: number): number => {
  const width =
    Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : MOTORCYCLE_BOX_MIN_W;
  const boxWidth = Math.min(
    MOTORCYCLE_BOX_MAX_W,
    Math.max(MOTORCYCLE_BOX_MIN_W, width * MOTORCYCLE_BOX_FRACTION)
  );
  return boxWidth / unionBox().width;
};

// ---------------------------------------------------------------------------
// Heading + movement state
// ---------------------------------------------------------------------------

/**
 * Marker rotation for a GPS/derived heading (degrees clockwise from north).
 * The sheet's side view faces east, so `heading − 90°`, normalised to
 * [−180°, 180°) to keep the CSS numbers small (270° → −180°, same direction).
 */
export const motorcycleRotationDeg = (headingDeg: number): number => {
  const raw = headingDeg - MOTORCYCLE_BASE_HEADING_DEG;
  return ((((raw + 180) % 360) + 360) % 360) - 180;
};

/** Speed (m/s) at which a still marker starts rolling — ~3.6 km/h. */
export const MOVING_SPEED_MPS = 1;
/** Speed (m/s) below which a rolling marker settles back onto the idle art. */
export const IDLE_SPEED_MPS = 0.6;
/**
 * A fix older than this no longer proves movement. `watchPosition` goes quiet
 * when the rider parks (GPS only fires on change), so a stale "speed: 4 m/s"
 * reading must not keep the bike in its moving pose forever.
 */
export const MOVING_FIX_MAX_AGE_MS = 15_000;

export interface CourierMovementInput {
  /** The marker is mid-glide between two real fixes — visibly travelling. */
  animating: boolean;
  /** Latest device speed (m/s), when the platform reports one. */
  speedMps: number | null | undefined;
  /** Age of the fix's device timestamp (ms); null when unknown. */
  fixAgeMs: number | null | undefined;
  /** Previous state — a narrow hysteresis band stops stop-go strobing. */
  previous: MotorcycleState;
}

/**
 * Moving vs Idle visual state (spec §13): an active glide or a fresh fix
 * rolling above the floor shows the Moving art; a stale fix, a missing speed
 * or a stopped rider settles on the Idle ring. Never invents motion — every
 * input comes from the existing GPS stream or the existing route animation.
 */
export const getCourierMovementState = (input: CourierMovementInput): MotorcycleState => {
  if (input.animating) return 'moving';
  if (input.fixAgeMs != null && input.fixAgeMs > MOVING_FIX_MAX_AGE_MS) return 'idle';
  const speed = input.speedMps;
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return 'idle';
  const floor = input.previous === 'moving' ? IDLE_SPEED_MPS : MOVING_SPEED_MPS;
  return speed >= floor ? 'moving' : 'idle';
};

// ---------------------------------------------------------------------------
// DOM factory (Advanced Markers position a real element)
// ---------------------------------------------------------------------------

/** Idempotent per-content state switch, keyed by the content root. */
const stateSetters = new WeakMap<HTMLElement, (state: MotorcycleState) => void>();

/**
 * Build the courier marker content: one fixed box with the rotating
 * motorcycle layer inside. The sheet is applied later by
 * `applyMotorcycleSheet` (it keys asynchronously), so the marker can be
 * created the moment the first fix arrives. `role="img"` + aria-label give
 * the marker the accessible name the map implementation then surfaces.
 */
export const makeMotorcycleContent = (geometry: MotorcycleGeometry): HTMLDivElement => {
  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.width = `${geometry.width}px`;
  root.style.height = `${geometry.height}px`;

  const bike = document.createElement('div');
  bike.className = 'sg-motorcycle';
  bike.setAttribute('role', 'img');
  bike.setAttribute('aria-label', 'SamleyGo courier motorcycle');
  bike.style.position = 'absolute';
  bike.style.inset = '0';
  bike.style.backgroundRepeat = 'no-repeat';
  bike.style.backgroundSize = geometry.backgroundSize;
  bike.style.backgroundPosition = geometry.positions.idle;
  bike.style.transformOrigin = geometry.origin;
  // Same easing the teardrop pin used: heading changes glide, they never snap.
  bike.style.transition = 'transform .5s cubic-bezier(.22,1,.36,1)';
  bike.dataset.state = 'idle';

  root.appendChild(bike);
  stateSetters.set(root, (state) => {
    if (bike.dataset.state === state) return; // per-GPS-fix idempotence
    bike.dataset.state = state;
    bike.style.backgroundPosition = geometry.positions[state];
  });
  return root;
};

/** Swap the keyed sheet into a content root (false when there is nothing to apply). */
export const applyMotorcycleSheet = (
  root: HTMLElement | null,
  sheetUrl: string | null
): boolean => {
  const bike = root?.querySelector('.sg-motorcycle') as HTMLElement | null;
  if (!bike || !sheetUrl) return false;
  bike.style.backgroundImage = `url("${sheetUrl}")`;
  return true;
};

/** Switch Moving/Idle art — a no-op when the state did not change. */
export const setMotorcycleState = (root: HTMLElement | null, state: MotorcycleState): void => {
  if (root) stateSetters.get(root)?.(state);
};
