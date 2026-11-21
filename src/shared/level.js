// CONTRACT: Level JSON (vision -> game). Frozen after P0.
// Changes need all three people to agree; ahmeds-abbas commits them with a "CONTRACT:" prefix.
//
// World is 1600 x 900 units, origin top-left, y pointing down.
// The fort always sits in x 900-1550; the ground is at y = 850; the slingshot is at (200, 700).
//
// {
//   "version": 1,
//   "blocks": [
//     { "id": "b1", "material": "wood", "shape": "rect", "x": 1100, "y": 800, "w": 200, "h": 20, "angle": 0 },
//     { "id": "b2", "material": "stone", "shape": "poly", "vertices": [[1200, 850], [1260, 850], [1230, 760]] }
//   ],
//   "pigs":   [ { "id": "p1", "x": 1150, "y": 760, "r": 22 } ],
//   "meta":   { "source": "photo", "detector": "hybrid", "imageW": 1280, "imageH": 720 }
// }
//
// - material: wood (black marker), ice (blue), stone (pencil/grey), tnt (red)
// - shape: "rect" (the default when missing, so older levels stay valid) or "poly"
// - rect: x, y are the block's centre; angle is in radians
// - poly: vertices are [x, y] in world units, 3 to POLY_MAX_VERTICES of them, in drawing order
//   (convex or concave; the game decomposes concave ones). No x/y/w/h/angle needed;
//   polygonCentroid() below gives the centre.
// - meta.detector (optional): "hybrid" (OpenCV shapes + Claude colours) | "claude" (Claude layout) | "opencv"
// - pigs come from green blobs; r is clamped to 14-40 (vision clamps; validateLevel rejects outside it)

export const LEVEL_VERSION = 1;

export const WORLD = Object.freeze({
  w: 1600,
  h: 900,
  groundY: 850,
  sling: Object.freeze({ x: 200, y: 700 }),
  fortZone: Object.freeze({ x1: 900, x2: 1550 }),
});

export const MATERIALS = Object.freeze(['wood', 'ice', 'stone', 'tnt']);

export const PIG_R = Object.freeze({ min: 14, max: 40 });

export const SHAPES = Object.freeze(['rect', 'poly']);

/** Most vertices a "poly" block may have. */
export const POLY_MAX_VERTICES = 24;

export const DETECTORS = Object.freeze(['hybrid', 'claude', 'opencv']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isId = (v) => typeof v === 'string' && v.length > 0;

/**
 * Check a Level JSON object against the contract.
 * Structural only: a level with zero pigs is valid here (vision reports
 * "Draw at least one green pig" itself).
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateLevel(level) {
  const errors = [];
  if (!level || typeof level !== 'object' || Array.isArray(level)) {
    return { ok: false, errors: ['level must be an object'] };
  }
  if (level.version !== LEVEL_VERSION) errors.push(`version must be ${LEVEL_VERSION}`);

  const ids = new Set();
  const checkId = (where, id) => {
    if (!isId(id)) errors.push(`${where}.id must be a non-empty string`);
    else if (ids.has(id)) errors.push(`${where}.id "${id}" is duplicated`);
    else ids.add(id);
  };
  const checkInWorld = (where, x, y) => {
    if (isNum(x) && (x < 0 || x > WORLD.w)) errors.push(`${where}.x ${x} is outside 0-${WORLD.w}`);
    if (isNum(y) && (y < 0 || y > WORLD.h)) errors.push(`${where}.y ${y} is outside 0-${WORLD.h}`);
  };

  if (!Array.isArray(level.blocks)) {
    errors.push('blocks must be an array');
  } else {
    level.blocks.forEach((b, i) => {
      const where = `blocks[${i}]`;
      if (!b || typeof b !== 'object') return errors.push(`${where} must be an object`);
      checkId(where, b.id);
      if (!MATERIALS.includes(b.material)) errors.push(`${where}.material must be one of ${MATERIALS.join(', ')}`);
      const shape = b.shape ?? 'rect';
      if (!SHAPES.includes(shape)) return errors.push(`${where}.shape must be one of ${SHAPES.join(', ')}`);
      if (shape === 'rect') {
        for (const k of ['x', 'y', 'w', 'h', 'angle']) {
          if (!isNum(b[k])) errors.push(`${where}.${k} must be a finite number`);
        }
        if (isNum(b.w) && b.w <= 0) errors.push(`${where}.w must be > 0`);
        if (isNum(b.h) && b.h <= 0) errors.push(`${where}.h must be > 0`);
        checkInWorld(where, b.x, b.y);
        return;
      }
      const v = b.vertices;
      if (!Array.isArray(v) || v.length < 3 || v.length > POLY_MAX_VERTICES) {
        return errors.push(`${where}.vertices must be an array of 3-${POLY_MAX_VERTICES} [x, y] points`);
      }
      let pointsOk = true;
      v.forEach((p, j) => {
        if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) {
          pointsOk = false;
          errors.push(`${where}.vertices[${j}] must be [x, y] numbers`);
        } else checkInWorld(`${where}.vertices[${j}]`, p[0], p[1]);
      });
      if (pointsOk && Math.abs(polygonArea(v)) < 1) errors.push(`${where}.vertices enclose no area`);
    });
  }

  if (!Array.isArray(level.pigs)) {
    errors.push('pigs must be an array');
  } else {
    level.pigs.forEach((p, i) => {
      const where = `pigs[${i}]`;
      if (!p || typeof p !== 'object') return errors.push(`${where} must be an object`);
      checkId(where, p.id);
      for (const k of ['x', 'y', 'r']) {
        if (!isNum(p[k])) errors.push(`${where}.${k} must be a finite number`);
      }
      if (isNum(p.r) && (p.r < PIG_R.min || p.r > PIG_R.max)) {
        errors.push(`${where}.r ${p.r} is outside ${PIG_R.min}-${PIG_R.max}`);
      }
      checkInWorld(where, p.x, p.y);
    });
  }

  if (level.meta !== undefined && (typeof level.meta !== 'object' || level.meta === null)) {
    errors.push('meta must be an object if present');
  } else if (level.meta?.detector !== undefined && !DETECTORS.includes(level.meta.detector)) {
    errors.push(`meta.detector must be one of ${DETECTORS.join(', ')}`);
  }

  return { ok: errors.length === 0, errors };
}

/** Signed area of a polygon given as [[x, y], ...] (shoelace formula). */
export function polygonArea(vertices) {
  let a = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Area-weighted centre [x, y] of a polygon, for placing a poly body. */
export function polygonCentroid(vertices) {
  const a = polygonArea(vertices);
  if (Math.abs(a) < 1e-9) {
    const n = vertices.length;
    return [vertices.reduce((s, p) => s + p[0], 0) / n, vertices.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Clamp a pig radius into the allowed range (for vision and game to share). */
export const clampPigR = (r) => Math.min(PIG_R.max, Math.max(PIG_R.min, r));

// Sample levels 1-3 (index 0-2). Used as stubs, the "use sample fort" backup and game testing.
export const sampleLevels = Object.freeze([
  {
    version: 1,
    blocks: [
      { id: 'b1', material: 'wood', x: 1100, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b2', material: 'wood', x: 1240, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b3', material: 'wood', x: 1170, y: 720, w: 180, h: 20, angle: 0 },
      { id: 'b4', material: 'ice', x: 1130, y: 670, w: 20, h: 80, angle: 0 },
      { id: 'b5', material: 'ice', x: 1210, y: 670, w: 20, h: 80, angle: 0 },
      { id: 'b6', material: 'wood', x: 1170, y: 620, w: 120, h: 20, angle: 0 },
    ],
    pigs: [
      { id: 'p1', x: 1170, y: 828, r: 22 },
      { id: 'p2', x: 1170, y: 688, r: 20 },
    ],
    meta: { source: 'sample', name: 'Two storeys' },
  },
  {
    version: 1,
    blocks: [
      { id: 'b1', material: 'stone', x: 1000, y: 800, w: 30, h: 100, angle: 0 },
      { id: 'b2', material: 'stone', x: 1160, y: 800, w: 30, h: 100, angle: 0 },
      { id: 'b3', material: 'wood', x: 1080, y: 740, w: 210, h: 20, angle: 0 },
      { id: 'b4', material: 'tnt', x: 1080, y: 705, w: 50, h: 50, angle: 0 },
      { id: 'b5', material: 'ice', x: 1320, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b6', material: 'ice', x: 1440, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b7', material: 'ice', x: 1380, y: 720, w: 160, h: 20, angle: 0 },
    ],
    pigs: [
      { id: 'p1', x: 1080, y: 828, r: 22 },
      { id: 'p2', x: 1380, y: 828, r: 22 },
      { id: 'p3', x: 1380, y: 690, r: 18 },
    ],
    meta: { source: 'sample', name: 'TNT on top' },
  },
  {
    version: 1,
    blocks: [
      { id: 'b1', material: 'wood', x: 950, y: 810, w: 20, h: 80, angle: 0 },
      { id: 'b2', material: 'wood', x: 1050, y: 810, w: 20, h: 80, angle: 0 },
      { id: 'b3', material: 'wood', x: 1000, y: 760, w: 140, h: 20, angle: 0 },
      { id: 'b4', material: 'stone', x: 1200, y: 760, w: 40, h: 180, angle: 0 },
      { id: 'b5', material: 'wood', x: 1350, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b6', material: 'wood', x: 1500, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b7', material: 'wood', x: 1425, y: 720, w: 190, h: 20, angle: 0 },
      { id: 'b8', material: 'tnt', x: 1425, y: 685, w: 50, h: 50, angle: 0 },
      { id: 'b9', material: 'ice', x: 1200, y: 660, w: 120, h: 20, angle: 0 },
    ],
    pigs: [
      { id: 'p1', x: 1000, y: 828, r: 20 },
      { id: 'p2', x: 1425, y: 828, r: 24 },
      { id: 'p3', x: 1200, y: 634, r: 16 },
    ],
    meta: { source: 'sample', name: 'Castle wall' },
  },
]);
