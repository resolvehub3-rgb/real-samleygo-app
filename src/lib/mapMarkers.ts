/**
 * DOM building blocks shared by every Google map in the app (courier live
 * map, admin dispatch map).
 *
 * Advanced Markers — unlike Leaflet's `divIcon` — position a *real* DOM node
 * on the map, so the pin markup lives here as element factories rather than
 * HTML strings. Everything keeps the exact dimensions the Leaflet version used
 * so the maps look the same after the migration; only the anchoring is
 * re-derived (`pinAnchor`) because Google anchors by the content box rather
 * than by an explicit icon anchor.
 */

/** User-supplied text (rider / kitchen names) never reaches the DOM raw. */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);

/**
 * The teardrop pin used for the courier, both trip pins, kitchens and the
 * dispatch map. The `halo` adds the pulsing "live position" ring behind the
 * courier pin (the round part of the teardrop sits in the middle of the box,
 * so a centred circle lines up with it) — it comes first so it paints
 * underneath.
 */
export const makePinContent = (
  emoji: string,
  bg: string,
  size = 34,
  halo = false
): HTMLDivElement => {
  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.width = `${size}px`;
  root.style.height = `${size}px`;
  root.innerHTML = `${halo ? '<div class="sg-courier-halo"></div>' : ''}<div class="sg-pin" style="
      display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      transition:transform .5s cubic-bezier(.22,1,.36,1);
      background:${bg};box-shadow:0 2px 8px rgba(0,0,0,.35);
      border:2px solid white;">
      <span class="sg-pin-emoji" style="transform:rotate(45deg);transition:transform .5s cubic-bezier(.22,1,.36,1);font-size:${Math.round(
        size * 0.44
      )}px;line-height:1;">${emoji}</span>
    </div>`;
  return root;
};

/**
 * Marker anchors for a teardrop of `size` px. Advanced Markers put the
 * content box's top-left at `position + (anchorLeft, anchorTop)`, and the
 * pin's sharp corner points due south once it is rotated -45°, sitting
 * `size/2 + (size/2)·√2` px below the box's top edge — so these offsets drop
 * the tip exactly on the coordinate.
 */
export const pinAnchor = (size: number): { anchorLeft: string; anchorTop: string } => ({
  anchorLeft: `${-size / 2}px`,
  anchorTop: `${(-size * (1 + Math.SQRT2)) / 2}px`,
});

/**
 * The pill-shaped rider chip used by the dispatch map. Its wrapper is a 1×1
 * box with explicit anchors so the chip's bottom-centre lands on the rider's
 * position.
 */
export const makeChipContent = (label: string): HTMLDivElement => {
  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.width = '1px';
  root.style.height = '1px';
  root.innerHTML = `<span style="position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:inline-flex;align-items:center;gap:5px;white-space:nowrap;background:#ffffff;border:1px solid #e2e8f0;border-radius:9999px;padding:5px 10px;box-shadow:0 4px 12px rgba(15,23,42,.18);font:700 12px/1.1 'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;">🛵 ${escapeHtml(
    label
  )}</span>`;
  return root;
};

/** Anchors for `makeChipContent`'s 1×1 wrapper (tip of the pill on the point). */
export const CHIP_ANCHOR = { anchorLeft: '0px', anchorTop: '0px' } as const;
