// Pure helpers for the hybrid detector (OpenCV shapes + Claude colours). No OpenCV, no DOM.
import { WORLD, clampPigR, validateLevel, POLY_MAX_VERTICES } from '../shared/level.js';
import { COLOUR_MATERIAL, MIN_CONFIDENCE } from '../shared/classify.js';
import { pageToWorld } from './geometry.js';
import { rgbToHsv } from './colour.js';

const MIN_THICK = 12; // brief: no thickness clamp except a 12-unit floor
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Our own colour guess from a shape's mean RGB (used when Claude is unsure or absent). */
export function hsvColour([r, g, b]) {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (s >= 60 && h >= 35 && h <= 90) return 'green';
  if (s >= 60 && h > 90 && h <= 135) return 'blue';
  if (s >= 70 && (h <= 10 || h >= 165)) return 'red';
  if (v < 80 && s < 80) return 'black';
  if (s < 45) return 'grey';
  return 'other';
}

/**
 * Pick each shape's colour + kind: Claude's answer when confident, else our HSV guess.
 * @param {Array<{n:number, meanColour:number[]}>} shapes
 * @param {Array<{n,colour,kind,confidence}>|null} claude
 */
export function decideShapes(shapes, claude) {
  const byN = new Map((claude || []).map((c) => [c.n, c]));
  return shapes.map((s) => {
    const c = byN.get(s.n);
    const own = s.guess ?? hsvColour(s.meanColour);
    if (c && c.confidence >= MIN_CONFIDENCE) {
      const kind = c.kind === 'ignore' ? 'ignore' : c.colour === 'green' || c.kind === 'pig' ? 'pig' : 'block';
      return { ...s, colour: c.colour, kind, by: 'claude' };
    }
    return { ...s, colour: own, kind: own === 'green' ? 'pig' : own === 'other' ? 'ignore' : 'block', by: 'hsv' };
  });
}

/**
 * Shapes measured on the flattened page (pixels) -> Level JSON.
 * shape: { kind, colour, type: 'rect'|'poly', rect?: {cx,cy,w,h,angleDeg}, vertices?: [[x,y]], circle?: {cx,cy,r} }
 */
export function shapesToLevel(decided, pageW, pageH, meta) {
  const map = pageToWorld(pageW, pageH);
  const blocks = [];
  const pigs = [];
  for (const s of decided) {
    if (s.kind === 'ignore') continue;
    if (s.kind === 'pig') {
      const r = clampPigR(s.circle.r * map.scale);
      pigs.push({ id: `p${pigs.length + 1}`, x: r1(clamp(map.x(s.circle.cx), 0, WORLD.w)), y: r1(clamp(Math.min(map.y(s.circle.cy), WORLD.groundY - r), 0, WORLD.h)), r: r1(r) });
      continue;
    }
    const material = COLOUR_MATERIAL[s.colour];
    if (!material) continue;
    const id = `b${blocks.length + 1}`;
    if (s.type === 'poly') {
      const vertices = s.vertices.slice(0, POLY_MAX_VERTICES).map(([x, y]) => [r1(clamp(map.x(x), 0, WORLD.w)), r1(clamp(map.y(y), 0, WORLD.groundY))]);
      blocks.push({ id, material, shape: 'poly', vertices });
    } else {
      const { cx, cy, w, h, angleDeg } = s.rect;
      const W = Math.max(w * map.scale, MIN_THICK);
      const H = Math.max(h * map.scale, MIN_THICK);
      const a = (angleDeg * Math.PI) / 180;
      const halfH = (Math.abs(Math.sin(a)) * W + Math.abs(Math.cos(a)) * H) / 2;
      blocks.push({
        id, material, shape: 'rect',
        x: r1(clamp(map.x(cx), 0, WORLD.w)),
        y: r1(clamp(Math.min(map.y(cy), WORLD.groundY - halfH), 0, WORLD.h)),
        w: r1(W), h: r1(H), angle: Math.round(a * 1000) / 1000,
      });
    }
  }
  return { version: 1, blocks, pigs, meta: { source: 'photo', ...meta } };
}

/** /api/layout answer (page fractions 0-1) -> Level JSON. */
export function layoutToLevel(layout, pageW, pageH, meta) {
  const map = pageToWorld(pageW, pageH);
  const blocks = [];
  for (const b of layout.blocks || []) {
    const material = COLOUR_MATERIAL[b.colour];
    if (!material) continue;
    const W = Math.max(b.w * pageW * map.scale, MIN_THICK);
    const H = Math.max(b.h * pageH * map.scale, MIN_THICK);
    blocks.push({
      id: `b${blocks.length + 1}`, material, shape: 'rect',
      x: r1(clamp(map.x(b.x * pageW), 0, WORLD.w)),
      y: r1(clamp(Math.min(map.y(b.y * pageH), WORLD.groundY - H / 2), 0, WORLD.h)),
      w: r1(W), h: r1(H), angle: Number.isFinite(b.angle) ? b.angle : 0,
    });
  }
  const pigs = (layout.pigs || []).map((p, i) => {
    const r = clampPigR(p.r * pageW * map.scale);
    return { id: `p${i + 1}`, x: r1(clamp(map.x(p.x * pageW), 0, WORLD.w)), y: r1(clamp(Math.min(map.y(p.y * pageH), WORLD.groundY - r), 0, WORLD.h)), r: r1(r) };
  });
  return { version: 1, blocks, pigs, meta: { source: 'photo', ...meta } };
}

export { validateLevel };

// ---------------------------------------------------------------------------
// Auto-pick (17:24 brief): clean up Claude's own layout, then choose a candidate.
// ---------------------------------------------------------------------------

const SNAP = (8 * Math.PI) / 180;

/** Rotated block -> its axis-aligned half extents. */
function halfExtents(b) {
  const c = Math.abs(Math.cos(b.angle || 0));
  const s = Math.abs(Math.sin(b.angle || 0));
  return { hx: (b.w * c + b.h * s) / 2, hy: (b.w * s + b.h * c) / 2 };
}

/**
 * Claude-only clean-up: snap angles within 8° of flat/upright, settle every block onto the
 * ground or the block below it (bottom-up), then drop pigs onto the surface under them.
 * Returns a new level; rect blocks only (that's all /api/layout produces).
 */
export function cleanLayout(level) {
  const out = structuredClone(level);
  for (const b of out.blocks) {
    if (b.shape === 'poly') continue;
    const k = Math.round((b.angle || 0) / (Math.PI / 2));
    if (Math.abs((b.angle || 0) - k * (Math.PI / 2)) <= SNAP) b.angle = k * (Math.PI / 2) === 0 ? 0 : k * (Math.PI / 2);
  }
  const rects = out.blocks.filter((b) => b.shape !== 'poly');
  // lowest first, so supports are settled before what rests on them
  rects.sort((a, b) => b.y + halfExtents(b).hy - (a.y + halfExtents(a).hy));
  const settled = [];
  const surfaceUnder = (x0, x1, yTop) => {
    let surface = WORLD.groundY;
    for (const s of settled) {
      const e = halfExtents(s);
      const overlaps = x1 > s.x - e.hx + 1 && x0 < s.x + e.hx - 1;
      const top = s.y - e.hy;
      if (overlaps && top >= yTop - 1 && top < surface) surface = top;
    }
    return surface;
  };
  for (const b of rects) {
    const e = halfExtents(b);
    const surface = surfaceUnder(b.x - e.hx, b.x + e.hx, b.y - e.hy);
    b.y = r1(surface - e.hy);
    settled.push(b);
  }
  for (const p of out.pigs) {
    const surface = surfaceUnder(p.x - p.r * 0.6, p.x + p.r * 0.6, p.y - p.r);
    p.y = r1(surface - p.r);
  }
  return out;
}

/** Average confidence and completeness of a /api/classify answer for `count` shapes. */
export function classifyStats(answer, count) {
  const byN = new Map((answer || []).map((a) => [a.n, a]));
  let sum = 0;
  for (let n = 1; n <= count; n++) sum += byN.get(n)?.confidence ?? 0;
  return {
    complete: count > 0 && Array.from({ length: count }, (_, i) => byN.has(i + 1)).every(Boolean),
    avgConfidence: count ? Math.round((sum / count) * 1000) / 1000 : 0,
  };
}

/**
 * The brief's pick rule. Each candidate: { ok, level?, complete?, avgConfidence? } or undefined.
 * @returns {{ chose: 'hybrid'|'claude'|'opencv', reason: string }}
 */
export function pickCandidate({ hybrid, claude }) {
  const hOk = !!hybrid?.ok;
  const cOk = !!claude?.ok;
  if (hOk && cOk) {
    const hn = hybrid.level.blocks.length;
    const cn = claude.level.blocks.length;
    const close = Math.abs(hn - cn) <= 0.3 * Math.max(cn, 1);
    if (hybrid.complete && hybrid.avgConfidence >= 0.7 && close) {
      return { chose: 'hybrid', reason: `hybrid complete, confidence ${hybrid.avgConfidence}, ${hn} blocks vs Claude ${cn}` };
    }
    const why = !hybrid.complete ? 'Claude skipped some shapes' : hybrid.avgConfidence < 0.7 ? `confidence ${hybrid.avgConfidence} < 0.7` : `${hn} blocks vs Claude-only ${cn} (more than ±30%)`;
    return { chose: 'claude', reason: `hybrid not trusted: ${why}` };
  }
  if (hOk) return { chose: 'hybrid', reason: 'Claude-only layout failed' };
  if (cOk) return { chose: 'claude', reason: 'hybrid failed' };
  return { chose: 'opencv', reason: 'both Claude paths failed' };
}

// ---------------------------------------------------------------------------
// Team Fix #3: Claude "reading" (/api/read, /api/verify) -> Level. Pixels of the sent page image.
// ---------------------------------------------------------------------------

/**
 * reading = { strokes: [{colour,x1,y1,x2,y2,thickness}], polys: [{colour, vertices}], pigs: [{x,y,r}] }
 * in pixels of a page image of size pageW x pageH (the same page our pageToWorld maps).
 */
export function readingToLevel(reading, pageW, pageH, meta) {
  const map = pageToWorld(pageW, pageH);
  const blocks = [];
  for (const s of reading?.strokes || []) {
    const material = COLOUR_MATERIAL[s.colour];
    if (!material || ![s.x1, s.y1, s.x2, s.y2, s.thickness].every(Number.isFinite)) continue;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const angle = len > 0 ? Math.atan2(s.y2 - s.y1, s.x2 - s.x1) : 0;
    // keep angles in (-90°, 90°] so a stroke drawn right-to-left isn't upside down
    const a = angle > Math.PI / 2 ? angle - Math.PI : angle <= -Math.PI / 2 ? angle + Math.PI : angle;
    const W = Math.max(len * map.scale, MIN_THICK);
    const H = Math.max(s.thickness * map.scale, MIN_THICK);
    const cx = (s.x1 + s.x2) / 2;
    const cy = (s.y1 + s.y2) / 2;
    blocks.push({
      id: `b${blocks.length + 1}`, material, shape: 'rect',
      x: r1(clamp(map.x(cx), 0, WORLD.w)), y: r1(clamp(map.y(cy), 0, WORLD.h)),
      w: r1(W), h: r1(H), angle: Math.round(a * 1000) / 1000,
    });
  }
  for (const p of reading?.polys || []) {
    const material = COLOUR_MATERIAL[p.colour];
    const v = (p.vertices || []).filter((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite));
    if (!material || v.length < 3) continue;
    blocks.push({
      id: `b${blocks.length + 1}`, material, shape: 'poly',
      vertices: v.slice(0, POLY_MAX_VERTICES).map(([x, y]) => [r1(clamp(map.x(x), 0, WORLD.w)), r1(clamp(map.y(y), 0, WORLD.groundY))]),
    });
  }
  const pigs = (reading?.pigs || []).filter((p) => [p.x, p.y, p.r].every(Number.isFinite)).map((p, i) => {
    const r = clampPigR(p.r * map.scale);
    return { id: `p${i + 1}`, x: r1(clamp(map.x(p.x), 0, WORLD.w)), y: r1(clamp(Math.min(map.y(p.y), WORLD.groundY - r), 0, WORLD.h)), r: r1(r) };
  });
  return { version: 1, blocks, pigs, meta: { source: 'photo', ...meta } };
}
