// Pure colour helpers for calibration (no OpenCV, no DOM).

/** RGB 0-255 -> OpenCV HSV (H 0-180, S/V 0-255). */
export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [Math.round(h / 2), max ? Math.round((d / max) * 255) : 0, max];
}

/** A range around a sampled HSV colour. Black/grey ignore hue. */
export function rangeAround(key, [h, s, v]) {
  const c = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));
  if (key === 'black') return { h: [0, 180], s: [0, c(s + 80, 60, 255)], v: [0, c(v + 40, 40, 140)] };
  if (key === 'grey') return { h: [0, 180], s: [0, c(s + 35, 30, 90)], v: [c(v - 45, 60, 200), c(v + 45, 100, 235)] };
  return {
    h: [(h - 14 + 180) % 180, (h + 14) % 180], // may wrap (red)
    s: [c(s * 0.45, 40, 200), 255],
    v: [c(v * 0.45, 30, 200), 255],
  };
}
