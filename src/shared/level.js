// CONTRACT: Level JSON (vision -> game). Frozen after P0.
// Changes need all three people to agree; ahmeds-abbas commits them with a "CONTRACT:" prefix.
//
// World is 1600 x 900 units, origin top-left, y pointing down.
// The fort always sits in x 900-1550; the ground is at y = 850; the slingshot is at (200, 700).
//
// {
//   "version": 1,
//   "blocks": [ { "id": "b1", "material": "wood", "x": 1100, "y": 800, "w": 200, "h": 20, "angle": 0 } ],
//   "pigs":   [ { "id": "p1", "x": 1150, "y": 760, "r": 22 } ],
//   "meta":   { "source": "photo", "imageW": 1280, "imageH": 720 }
// }
//
// - material: wood (black marker), ice (blue), stone (pencil/grey), tnt (red)
// - x, y are the block's centre; angle is in radians
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
      for (const k of ['x', 'y', 'w', 'h', 'angle']) {
        if (!isNum(b[k])) errors.push(`${where}.${k} must be a finite number`);
      }
      if (isNum(b.w) && b.w <= 0) errors.push(`${where}.w must be > 0`);
      if (isNum(b.h) && b.h <= 0) errors.push(`${where}.h must be > 0`);
      checkInWorld(where, b.x, b.y);
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
  }

  return { ok: errors.length === 0, errors };
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
