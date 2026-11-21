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

import { rgbToHsv, rangeAround } from '../colour.js';

test('rgbToHsv uses OpenCV ranges', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), [0, 255, 255]);
  assert.deepEqual(rgbToHsv(0, 255, 0), [60, 255, 255]);
  assert.deepEqual(rgbToHsv(0, 0, 255), [120, 255, 255]);
  assert.deepEqual(rgbToHsv(128, 128, 128), [0, 0, 128]);
});

test('rangeAround wraps red hue', () => {
  const r = rangeAround('red', [2, 200, 200]);
  assert.ok(r.h[0] > r.h[1], 'wraps');
  assert.deepEqual(rangeAround('black', [0, 10, 30]).h, [0, 180]);
});

import { polygonArea, pointiness, normalisePolygon, birdFromOutline } from '../birdShape.js';

const circle = Array.from({ length: 48 }, (_, i) => ({ x: 100 + 50 * Math.cos((i / 48) * 2 * Math.PI), y: 100 + 50 * Math.sin((i / 48) * 2 * Math.PI) }));
const triangle = [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 50, y: 13.4 }];
const star = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 20 : 60;
  const a = (i / 10) * 2 * Math.PI;
  return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) };
});

test('bird pointiness: circle < triangle < star', () => {
  const [c, t, s] = [pointiness(circle), pointiness(triangle), pointiness(star)];
  assert.ok(c < 0.02, `circle ${c}`);
  assert.ok(t > 0.3 && t < 0.45, `triangle ${t}`);
  assert.ok(s > 0.55, `star ${s}`);
});

test('bird polygon is centred with max radius 1, area is a page fraction', () => {
  const poly = normalisePolygon(triangle);
  const rMax = Math.max(...poly.map((p) => Math.hypot(p.x, p.y)));
  assert.ok(Math.abs(rMax - 1) < 0.002);
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  assert.ok(Math.abs(cx) < 0.01);
  const b = birdFromOutline(triangle, 1000 * 1000);
  assert.equal(b.area, Math.round((polygonArea(triangle) / 1e6) * 10000) / 10000);
});

import { pageTransform } from '../geometry.js';

test('pageTransform matches pageToWorld exactly (for the game to crop strokes)', () => {
  for (const [w, h] of [[800, 566], [400, 1000], [1580, 1180]]) {
    const t = pageTransform(w, h);
    const m = pageToWorld(w, h);
    for (const [px, py] of [[0, 0], [w, h], [w / 3, h / 2]]) {
      assert.ok(Math.abs(t.ox + px * t.sx - m.x(px)) < 1e-9);
      assert.ok(Math.abs(t.oy + py * t.sy - m.y(py)) < 1e-9);
    }
    assert.ok(Math.abs(t.oy + h * t.sy - WORLD.groundY) < 1e-9, 'page bottom = ground');
  }
});

import { hsvColour, decideShapes, shapesToLevel, layoutToLevel } from '../hybridLevel.js';

test('hybrid: hsvColour guesses the five ink colours', () => {
  assert.equal(hsvColour([40, 160, 60]), 'green');
  assert.equal(hsvColour([30, 70, 200]), 'blue');
  assert.equal(hsvColour([200, 40, 45]), 'red');
  assert.equal(hsvColour([30, 30, 32]), 'black');
  assert.equal(hsvColour([170, 170, 175]), 'grey');
});

test('hybrid: Claude wins when confident, HSV otherwise, ignore dropped', () => {
  const shapes = [{ n: 1, meanColour: [30, 30, 32] }, { n: 2, meanColour: [30, 70, 200] }, { n: 3, meanColour: [40, 160, 60] }];
  const d = decideShapes(shapes, [{ n: 1, colour: 'red', kind: 'block', confidence: 0.9 }, { n: 2, colour: 'grey', kind: 'block', confidence: 0.2 }, { n: 3, colour: 'green', kind: 'ignore', confidence: 0.9 }]);
  assert.deepEqual(d.map((s) => [s.colour, s.kind, s.by]), [['red', 'block', 'claude'], ['blue', 'block', 'hsv'], ['green', 'ignore', 'claude']]);
});

test('hybrid: shapes and layout become valid levels (rect + poly + pig)', () => {
  const lv = shapesToLevel([
    { kind: 'block', colour: 'black', type: 'rect', rect: { cx: 400, cy: 500, w: 300, h: 4, angleDeg: 0 } },
    { kind: 'block', colour: 'grey', type: 'poly', vertices: [[100, 560], [200, 560], [150, 450]] },
    { kind: 'pig', colour: 'green', circle: { cx: 600, cy: 540, r: 25 } },
  ], 800, 566, { detector: 'hybrid' });
  assert.deepEqual(validateLevel(lv), { ok: true, errors: [] });
  assert.ok(lv.blocks[0].h >= 12, '12-unit floor');
  assert.equal(lv.blocks[1].shape, 'poly');
  const lay = layoutToLevel({ blocks: [{ colour: 'blue', x: 0.5, y: 0.9, w: 0.3, h: 0.05, angle: 0 }], pigs: [{ x: 0.5, y: 0.8, r: 0.03 }] }, 800, 566, { detector: 'claude' });
  assert.deepEqual(validateLevel(lay), { ok: true, errors: [] });
  assert.equal(lay.blocks[0].material, 'ice');
});
