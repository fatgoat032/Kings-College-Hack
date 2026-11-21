// Builds the few-shot "truth set" for /api/read (Team Fix #3):
// public/fixtures/truth/<name>.json = { image, width, height, fewshot?, strokes, polys, pigs }
// in pixels of the PNG beside it. Derived from each fixture's expected level (world units),
// mapped back to image pixels (these digital drawings fill the whole image).
// Run: node src/vision/tools/make-truth.js
import fs from 'node:fs';
import { pageToWorld } from '../geometry.js';

const items = [
  { name: 'digital-ipad', w: 1600, h: 1200, fewshot: true },
  { name: 'ipad-marker-pencil', w: 1600, h: 1200, fewshot: true },
];
const COLOUR = { wood: 'black', ice: 'blue', stone: 'grey', tnt: 'red' };
const r1 = (v) => Math.round(v * 10) / 10;

for (const it of items) {
  const exp = JSON.parse(fs.readFileSync(`public/fixtures/${it.name}.expected.json`, 'utf8'));
  const m = pageToWorld(it.w, it.h);
  const ox = m.x(0);
  const oy = m.y(0);
  const px = (x) => (x - ox) / m.scale;
  const py = (y) => (y - oy) / m.scale;
  const strokes = exp.blocks.map((b) => {
    const cx = px(b.x);
    const cy = py(b.y);
    const w = b.w / m.scale;
    const h = b.h / m.scale;
    const vertical = h > w;
    const half = Math.max(w, h) / 2;
    return {
      colour: COLOUR[b.material],
      x1: r1(vertical ? cx : cx - half), y1: r1(vertical ? cy - half : cy),
      x2: r1(vertical ? cx : cx + half), y2: r1(vertical ? cy + half : cy),
      thickness: r1(Math.min(w, h)),
    };
  });
  const pigs = exp.pigs.map((p) => ({ x: r1(px(p.x)), y: r1(py(p.y)), r: r1(p.r / m.scale) }));
  const truth = { image: `truth/${it.name}.png`, width: it.w, height: it.h, fewshot: it.fewshot, strokes, polys: [], pigs };
  fs.writeFileSync(`public/fixtures/truth/${it.name}.json`, JSON.stringify(truth, null, 2) + '\n');
  console.log(`${it.name}: ${strokes.length} strokes, ${pigs.length} pigs`);
}
