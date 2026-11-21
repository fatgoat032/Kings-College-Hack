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
