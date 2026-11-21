// Node unit tests for the pure maths (no OpenCV needed). Run: node --test src/vision/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRect, snapAngle, pageToWorld, buildLevel, checkLevel, orderQuad } from '../geometry.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { validateLevel, WORLD } from '../../shared/level.js';

const S = structuredClone(DEFAULT_SETTINGS);

test('normaliseRect keeps angle in (-45, 45] and swaps w/h', () => {
  assert.deepEqual(normaliseRect({ cx: 0, cy: 0, w: 10, h: 100, angleDeg: 90 }), { cx: 0, cy: 0, w: 100, h: 10, angleDeg: 0 });
  assert.deepEqual(normaliseRect({ cx: 0, cy: 0, w: 10, h: 100, angleDeg: -80 }), { cx: 0, cy: 0, w: 100, h: 10, angleDeg: 10 });
  assert.equal(normaliseRect({ cx: 0, cy: 0, w: 5, h: 6, angleDeg: 30 }).angleDeg, 30);
});

test('snapAngle flattens within 6 degrees only', () => {
  assert.equal(snapAngle(5.9, 6), 0);
  assert.equal(snapAngle(-4, 6), 0);
  assert.equal(snapAngle(12, 6), 12);
});

test('page bottom maps to the ground, page fits the fort zone', () => {
  const m = pageToWorld(800, 600);
  assert.equal(m.y(600), WORLD.groundY);
  assert.ok(m.x(0) >= WORLD.fortZone.x1 - 1e-9 && m.x(800) <= WORLD.fortZone.x2 + 1e-9);
  assert.ok(Math.abs(m.x(800) - m.x(0) - 650) < 1e-9); // landscape page fills the width
  const tall = pageToWorld(400, 1000); // portrait: height-limited, centred
  assert.ok(tall.y(0) >= 100 - 1e-9);
  assert.ok(Math.abs((tall.x(0) + tall.x(400)) / 2 - 1225) < 1e-9);
});

test('buildLevel output passes validateLevel, clamps pigs, min thickness', () => {
  const { level } = buildLevel({
    pageW: 800, pageH: 600,
    blocks: [
      { material: 'wood', cx: 400, cy: 590, w: 300, h: 2, angleDeg: 3, area: 600 },
      { material: 'ice', cx: 200, cy: 500, w: 20, h: 150, angleDeg: 89, area: 3000 },
    ],
    pigs: [{ cx: 400, cy: 540, r: 2 }, { cx: 600, cy: 540, r: 500 }],
  }, S, { imageW: 1280, imageH: 720 });
  assert.deepEqual(validateLevel(level), { ok: true, errors: [] });
  assert.equal(level.blocks[0].angle, 0, 'near-flat snapped');
  assert.ok(level.blocks[0].h >= 14, 'min thickness');
  assert.ok(level.blocks.every((b) => b.y + b.h / 2 <= WORLD.groundY + 1e-6), 'no block below ground');
  assert.deepEqual(level.pigs.map((p) => p.r), [14, 40]);
  assert.ok(level.pigs.every((p) => p.y + p.r <= WORLD.groundY + 1e-6));
  assert.equal(level.meta.source, 'photo');
});

test('zero pigs is a player-facing error', () => {
  const { level } = buildLevel({ pageW: 100, pageH: 100, blocks: [], pigs: [] }, S);
  assert.deepEqual(checkLevel(level), { ok: false, message: 'Draw at least one green pig', bug: false });
});

test('maxBlocks keeps the biggest', () => {
  const blocks = Array.from({ length: 70 }, (_, i) => ({ material: 'wood', cx: 50, cy: 50, w: 10 + i, h: 10, angleDeg: 0, area: i }));
  const { level, warnings } = buildLevel({ pageW: 100, pageH: 100, blocks, pigs: [{ cx: 1, cy: 1, r: 5 }] }, S);
  assert.equal(level.blocks.length, 60);
  assert.equal(warnings.length, 1);
});

test('orderQuad', () => {
  const q = orderQuad([{ x: 10, y: 90 }, { x: 90, y: 10 }, { x: 5, y: 5 }, { x: 95, y: 95 }]);
  assert.deepEqual(q, [{ x: 5, y: 5 }, { x: 90, y: 10 }, { x: 95, y: 95 }, { x: 10, y: 90 }]);
});

import { compareLevels } from '../compare.js';

test('compareLevels matches by material and distance, reports missing/extra', () => {
  const want = { blocks: [{ material: 'wood', x: 1000, y: 800 }, { material: 'ice', x: 1200, y: 700 }], pigs: [{ x: 1100, y: 820 }] };
  const ok = compareLevels({ blocks: [{ material: 'ice', x: 1210, y: 690 }, { material: 'wood', x: 1020, y: 790 }], pigs: [{ x: 1090, y: 830 }] }, want);
  assert.equal(ok.pass, true);
  const bad = compareLevels({ blocks: [{ material: 'stone', x: 1000, y: 800 }], pigs: [] }, want);
  assert.equal(bad.pass, false);
  assert.equal(bad.missing.length, 3);
  assert.equal(bad.extra.length, 1);
});
