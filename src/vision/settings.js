// Colour + detection settings. Defaults below; the calibration screen (P3)
// saves overrides to localStorage so they survive a page reload.
//
// HSV uses OpenCV's ranges: H 0-180, S 0-255, V 0-255.
// Colours are measured AFTER white-balancing the page, so "white paper" = ~255.

export const STORAGE_KEY = 'angry-sketches.vision.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  colours: {
    // material: { h: [min, max] (may wrap, e.g. [170, 10] for red), s: [min, max], v: [min, max] }
    green: { h: [35, 90], s: [60, 255], v: [40, 255] }, // pigs
    blue: { h: [90, 135], s: [60, 255], v: [40, 255] }, // ice
    red: { h: [165, 12], s: [80, 255], v: [50, 255] }, // tnt
    black: { h: [0, 180], s: [0, 140], v: [0, 85] }, // wood
    grey: { h: [0, 180], s: [0, 55], v: [86, 190] }, // stone (pencil)
  },
  /** Ignore blobs smaller than this fraction of the page area (plan: 0.3%). */
  minBlockArea: 0.003,
  /** Pigs can be a bit smaller than blocks. */
  minPigArea: 0.0015,
  /** Thinnest block, in world units (plan: 14). */
  minThickness: 14,
  /** Blocks within this many degrees of flat (or upright) are snapped (plan P3: 6°). */
  snapDegrees: 6,
  /** Most blocks we hand the game (keeps it at 60 fps). Biggest ones are kept. */
  maxBlocks: 60,
});

export function loadSettings() {
  const base = structuredClone(DEFAULT_SETTINGS);
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return { ...base, ...saved, colours: { ...base.colours, ...(saved.colours || {}) } };
    }
  } catch {
    /* private mode or bad JSON: fall back to defaults */
  }
  return base;
}

export function saveSettings(settings) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function resetSettings() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return structuredClone(DEFAULT_SETTINGS);
}
