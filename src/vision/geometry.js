// Pure maths for vision: no OpenCV, no DOM. Turns shapes measured on the
// flattened page (pixels) into a Level JSON in world units.
import { WORLD, clampPigR, validateLevel } from '../shared/level.js';

const DEG = Math.PI / 180;
const FORT_W = WORLD.fortZone.x2 - WORLD.fortZone.x1; // 650
const TOP_MARGIN = 100; // keep the top of the fort below y = 100 so it fits on screen
const MAX_FORT_H = WORLD.groundY - TOP_MARGIN; // 750

/**
 * OpenCV's minAreaRect angle convention changed between versions. Normalise any
 * rotated rect to: w along the angle, angle in (-45°, 45°], in degrees.
 * @param {{cx:number, cy:number, w:number, h:number, angleDeg:number}} r
 */
export function normaliseRect({ cx, cy, w, h, angleDeg }) {
  let a = angleDeg;
  let W = w;
  let H = h;
  while (a > 45) { a -= 90; [W, H] = [H, W]; }
  while (a <= -45) { a += 90; [W, H] = [H, W]; }
  return { cx, cy, w: W, h: H, angleDeg: a };
}

/** Snap blocks that are within `deg` of flat to exactly flat (stops self-collapse). */
export function snapAngle(angleDeg, deg) {
  return Math.abs(angleDeg) <= deg ? 0 : angleDeg;
}

/**
 * Page pixels -> world units. Keeps the aspect ratio, centres the page in the
 * fort zone (x 900-1550) and puts the bottom of the page on the ground (y 850).
 */
export function pageToWorld(pageW, pageH) {
  const s = Math.min(FORT_W / pageW, MAX_FORT_H / pageH);
  const offX = WORLD.fortZone.x1 + (FORT_W - pageW * s) / 2;
  return {
    scale: s,
    x: (px) => offX + px * s,
    y: (py) => WORLD.groundY - (pageH - py) * s,
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Build a Level JSON from detections on the flattened page.
 * @param {object} d
 * @param {number} d.pageW  width of the flattened page in px
 * @param {number} d.pageH  height in px
 * @param {Array<{material:string, cx:number, cy:number, w:number, h:number, angleDeg:number, area:number}>} d.blocks
 * @param {Array<{cx:number, cy:number, r:number}>} d.pigs
 * @param {object} settings  see settings.js
 * @param {object} [meta]    extra meta (imageW, imageH…)
 * @returns {{ level: object, warnings: string[] }}
 */
export function buildLevel({ pageW, pageH, blocks, pigs }, settings, meta = {}) {
  const map = pageToWorld(pageW, pageH);
  const warnings = [];

  let kept = blocks;
  if (kept.length > settings.maxBlocks) {
    kept = [...kept].sort((a, b) => b.area - a.area).slice(0, settings.maxBlocks);
    warnings.push(`Too many blocks: kept the ${settings.maxBlocks} biggest`);
  }

  const outBlocks = kept.map((b, i) => {
    const n = normaliseRect(b);
    const angleDeg = snapAngle(n.angleDeg, settings.snapDegrees);
    const w = Math.max(n.w * map.scale, settings.minThickness);
    const h = Math.max(n.h * map.scale, settings.minThickness);
    let y = map.y(n.cy);
    // never start a block below the ground
    const halfH = (Math.abs(Math.sin(angleDeg * DEG)) * w + Math.abs(Math.cos(angleDeg * DEG)) * h) / 2;
    y = Math.min(y, WORLD.groundY - halfH);
    return {
      id: `b${i + 1}`,
      material: b.material,
      x: round1(clamp(map.x(n.cx), 0, WORLD.w)),
      y: round1(clamp(y, 0, WORLD.h)),
      w: round1(w),
      h: round1(h),
      angle: Math.round(angleDeg * DEG * 1000) / 1000,
    };
  });

  const outPigs = pigs.map((p, i) => {
    const r = clampPigR(p.r * map.scale);
    return {
      id: `p${i + 1}`,
      x: round1(clamp(map.x(p.cx), 0, WORLD.w)),
      y: round1(clamp(Math.min(map.y(p.cy), WORLD.groundY - r), 0, WORLD.h)),
      r: round1(r),
    };
  });

  const level = {
    version: 1,
    blocks: outBlocks,
    pigs: outPigs,
    meta: { source: 'photo', ...meta },
  };
  return { level, warnings };
}

/** Player-facing problems with a level (structural errors are bugs, not player errors). */
export function checkLevel(level) {
  const { ok, errors } = validateLevel(level);
  if (!ok) return { ok: false, message: `Vision produced an invalid level: ${errors[0]}` , bug: true };
  if (level.pigs.length === 0) return { ok: false, message: 'Draw at least one green pig', bug: false };
  return { ok: true };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Order 4 points as top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(pts) {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}
