// TEAM FIX #3 B3/B4: prompts, schemas, few-shot examples and tidying for /api/read and /api/verify.
// Contract: src/shared/classify.js. All coordinates are absolute pixels of the image sent.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { READING_COLOURS, READING_POLY_MAX } from '../src/shared/classify.js';

const FIXTURES = fileURLToPath(new URL('../public/fixtures/', import.meta.url));

export const READ_SYSTEM = `You read hand-drawn forts for a slingshot game. Kids draw them with markers or pencil on white paper (sometimes on an iPad), and we photograph the paper.

What is on the page:
- Each BLOCK is one straight stroke or bar of ink. Its colour is its material: black = wood, blue = ice, grey/pencil = stone, red = TNT.
- PIGS are green blobs (filled or outlined circles, may have a face). They are never blocks.
- Ignore writing, smudges, shadows, the paper edge, and our own marks.

Our marks (not part of the drawing):
- A faint labelled grid every 10 % of the image with small edge labels 0-100. Use it only to place coordinates precisely.
- A colour swatch row at the top of the paper (black, blue, grey, red, green boxes) when present. Compare ink colours against it.

Colour rules:
- Red may look orange or pink. It is still red.
- Dark blue may look nearly black. Compare with the blue swatch, and look at the stroke's edges and thin parts, where the hue shows.
- Grey/pencil is lighter than black, often grainy or shiny, and has no hue.
- Black is the darkest ink.

Coordinates: pixels of THIS image, origin at the top-left corner, x to the right, y down. The prompt gives the image width and height.

Each straight block = one stroke: (x1, y1) and (x2, y2) are the two ends of its CENTRE LINE, and thickness is its TRUE drawn width in pixels, measured across the stroke. A wide pencil bar is one thick stroke, not two thin ones. Touching blocks of different colours are separate strokes. A curved or blob-shaped block (not a pig) is a polygon of up to ${READING_POLY_MAX} vertices around its outline. A pig is a circle: centre (x, y) and radius r.

First fill "seen" with one short line per thing you see (e.g. "red square on top of the blue beam"), then give strokes, polys and pigs.`;

export const VERIFY_SYSTEM = `${READ_SYSTEM}

You are now checking a previous reading. The second image is the same drawing with our reading drawn over it as coloured outlines (each outline in the colour we think the block is; pigs as green circles). Compare it with the real ink in the first image.`;

const num = { type: 'number' };
const strokeSchema = {
  type: 'object',
  properties: { colour: { type: 'string', enum: [...READING_COLOURS] }, x1: num, y1: num, x2: num, y2: num, thickness: num },
  required: ['colour', 'x1', 'y1', 'x2', 'y2', 'thickness'],
  additionalProperties: false,
};
const polySchema = {
  type: 'object',
  properties: {
    colour: { type: 'string', enum: [...READING_COLOURS] },
    vertices: { type: 'array', items: { type: 'array', items: num } },
  },
  required: ['colour', 'vertices'],
  additionalProperties: false,
};
const pigSchema = { type: 'object', properties: { x: num, y: num, r: num }, required: ['x', 'y', 'r'], additionalProperties: false };
const readingProps = {
  strokes: { type: 'array', items: strokeSchema },
  polys: { type: 'array', items: polySchema },
  pigs: { type: 'array', items: pigSchema },
};

export const READ_SCHEMA = {
  type: 'object',
  properties: { seen: { type: 'array', items: { type: 'string' } }, ...readingProps },
  required: ['seen', 'strokes', 'polys', 'pigs'],
  additionalProperties: false,
};
export const VERIFY_SCHEMA = {
  type: 'object',
  properties: { changes: { type: 'array', items: { type: 'string' } }, ...readingProps },
  required: ['changes', 'strokes', 'polys', 'pigs'],
  additionalProperties: false,
};

export const readPrompt = (w, h) =>
  `This image is ${w} x ${h} pixels. Read the fort. Answer in pixels of this image.`;
export const verifyPrompt = (w, h, reading) =>
  `Both images are ${w} x ${h} pixels. Our reading, in pixels:\n${JSON.stringify(reading)}\n\nThese outlines are our reading. List anything wrong in "changes": missing strokes, extra strokes, wrong colours, wrong thickness, misplaced shapes, missing or extra pigs. Then return the corrected FULL reading (every block and pig, not only the changed ones). If it is all correct, return it unchanged with an empty "changes".`;

/** Plain-language "seen" lines for a few-shot answer. */
function describe(r) {
  const lines = (r.strokes || []).map((s) => `${s.colour} stroke from (${Math.round(s.x1)}, ${Math.round(s.y1)}) to (${Math.round(s.x2)}, ${Math.round(s.y2)}), ${Math.round(s.thickness)} px thick`);
  for (const p of r.polys || []) lines.push(`${p.colour} curved block with ${p.vertices.length} corners`);
  for (const p of r.pigs || []) lines.push(`green pig at (${Math.round(p.x)}, ${Math.round(p.y)}), radius ${Math.round(p.r)}`);
  return lines;
}

/**
 * Few-shot examples from vision's truth set: public/fixtures/truth/*.json with fewshot: true,
 * { image, width, height, strokes, polys, pigs } in the image's own pixels.
 * Returns alternating user/assistant messages to put before the real photo.
 */
export function loadFewShot(dir = join(FIXTURES, 'truth'), max = 2, exclude = '') {
  if (!existsSync(dir)) return [];
  const msgs = [];
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    if (n >= max) break;
    try {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (!t.fewshot || !t.image || !t.width || !t.height || f === exclude) continue;
      const imgPath = join(FIXTURES, t.image);
      const ext = imgPath.split('.').pop().toLowerCase();
      const media = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext];
      if (!media || !existsSync(imgPath)) continue;
      const answer = { seen: describe(t), strokes: t.strokes || [], polys: t.polys || [], pigs: t.pigs || [] };
      msgs.push(
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: readFileSync(imgPath).toString('base64') } },
            { type: 'text', text: `Example. ${readPrompt(t.width, t.height)}` },
          ],
        },
        { role: 'assistant', content: JSON.stringify(answer) },
      );
      n++;
    } catch {
      /* skip a broken example */
    }
  }
  return msgs;
}

const fin = (v) => Number.isFinite(v);

/** Keep only valid, on-image entries; clamp to the image; at most READING_POLY_MAX vertices. */
export function tidyReading(r, w, h) {
  const cx = (v) => Math.min(w, Math.max(0, v));
  const cy = (v) => Math.min(h, Math.max(0, v));
  const okColour = (c) => READING_COLOURS.includes(c);
  const strokes = (r?.strokes || [])
    .filter((s) => okColour(s.colour) && [s.x1, s.y1, s.x2, s.y2, s.thickness].every(fin) && s.thickness > 0)
    .map((s) => ({ colour: s.colour, x1: cx(s.x1), y1: cy(s.y1), x2: cx(s.x2), y2: cy(s.y2), thickness: Math.min(s.thickness, Math.max(w, h)) }))
    .filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) + s.thickness > 4);
  const polys = (r?.polys || [])
    .filter((p) => okColour(p.colour) && Array.isArray(p.vertices))
    .map((p) => ({
      colour: p.colour,
      vertices: p.vertices.filter((v) => Array.isArray(v) && v.length >= 2 && fin(v[0]) && fin(v[1])).slice(0, READING_POLY_MAX).map(([x, y]) => [cx(x), cy(y)]),
    }))
    .filter((p) => p.vertices.length >= 3);
  const pigs = (r?.pigs || [])
    .filter((p) => [p.x, p.y, p.r].every(fin) && p.r > 0 && p.r < Math.max(w, h) / 2)
    .map((p) => ({ x: cx(p.x), y: cy(p.y), r: p.r }));
  return { strokes, polys, pigs };
}
