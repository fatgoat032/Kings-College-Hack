// Generates synthetic "photos" of drawn forts (SVG) with exact expected Level
// JSON, so vision can be tested before real photos exist.
// Run: node src/vision/tools/make-synthetic-fixtures.js
// Writes public/fixtures/synthetic-*.svg, *.expected.json and updates fixtures.json.
import fs from 'node:fs';
import { pageToWorld } from '../geometry.js';
import { clampPigR } from '../../shared/level.js';

const OUT = 'public/fixtures';
const PAGE_W = 800; // the paper inside the SVG, in SVG units
const PAGE_H = 566; // A4 landscape ratio

// One fort, drawn in page units (origin top-left of the paper).
const FORT = {
  blocks: [
    { m: 'wood', x: 250, y: 470, w: 22, h: 150 },
    { m: 'wood', x: 450, y: 470, w: 22, h: 150 },
    { m: 'wood', x: 350, y: 384, w: 260, h: 22 },
    { m: 'ice', x: 290, y: 330, w: 18, h: 90 },
    { m: 'ice', x: 410, y: 330, w: 18, h: 90 },
    { m: 'stone', x: 620, y: 490, w: 40, h: 110 },
    { m: 'tnt', x: 350, y: 250, w: 60, h: 60 },
  ],
  pigs: [
    { x: 350, y: 520, r: 26 },
    { x: 620, y: 395, r: 22 },
  ],
};

const FILL = { wood: '#1b1b1b', ice: '#1f5fd6', stone: '#8c8c8c', tnt: '#d62424', pig: '#2fa83a' };

function fortSvg(fort) {
  const blocks = fort.blocks
    .map((b) => `<rect x="${b.x - b.w / 2}" y="${b.y - b.h / 2}" width="${b.w}" height="${b.h}" rx="3" fill="${FILL[b.m]}"/>`)
    .join('\n    ');
  const pigs = fort.pigs
    .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${FILL.pig}"/>` +
      // pig eyes: small black dots that vision must ignore (below the min block area)
      `<circle cx="${p.x - p.r / 3}" cy="${p.y - p.r / 4}" r="3" fill="#111"/><circle cx="${p.x + p.r / 3}" cy="${p.y - p.r / 4}" r="3" fill="#111"/>`)
    .join('\n    ');
  return `${blocks}\n    ${pigs}`;
}

/** A photo: table background, white page (optionally transformed), optional shadow. */
function photo({ transform = '', shadow = false, fort = FORT, light = 1 }) {
  const W = 1280;
  const H = 960;
  const px = (W - PAGE_W) / 2;
  const py = (H - PAGE_H) / 2;
  const paper = light === 1 ? '#fbfbf7' : '#d9d6cc';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0.3">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#6b5a48"/>
  <g transform="${transform}">
   <g transform="translate(${px} ${py})">
    <rect width="${PAGE_W}" height="${PAGE_H}" fill="${paper}"/>
    ${fortSvg(fort)}
   </g>
  </g>
  ${shadow ? `<rect width="${W}" height="${H}" fill="url(#shade)"/>` : ''}
</svg>
`;
}

/** Expected Level JSON straight from the drawn geometry (same mapping as geometry.js). */
function expected(fort) {
  const map = pageToWorld(PAGE_W, PAGE_H);
  return {
    version: 1,
    blocks: fort.blocks.map((b, i) => ({
      id: `b${i + 1}`, material: b.m,
      x: Math.round(map.x(b.x)), y: Math.round(map.y(b.y)),
      w: Math.round(b.w * map.scale), h: Math.round(b.h * map.scale), angle: 0,
    })),
    pigs: fort.pigs.map((p, i) => ({
      id: `p${i + 1}`, x: Math.round(map.x(p.x)), y: Math.round(map.y(p.y)), r: clampPigR(Math.round(p.r * map.scale)),
    })),
    meta: { source: 'expected' },
  };
}

const NO_PIGS = { blocks: FORT.blocks, pigs: [] };

const cases = [
  { name: 'synthetic-flat', note: 'Flat page, good light', svg: photo({}), exp: expected(FORT) },
  { name: 'synthetic-tilted', note: 'Page rotated 9° and skewed', svg: photo({ transform: 'rotate(9 640 480) skewX(6) translate(-50 0)' }), exp: expected(FORT) },
  { name: 'synthetic-dim', note: 'Dim light with a shadow across the page', svg: photo({ shadow: true, light: 0.85 }), exp: expected(FORT) },
  { name: 'synthetic-no-pig', note: 'No green pig: must fail with a friendly error', svg: photo({ fort: NO_PIGS }), exp: { error: 'Draw at least one green pig' } },
];

fs.mkdirSync(OUT, { recursive: true });
for (const c of cases) {
  fs.writeFileSync(`${OUT}/${c.name}.svg`, c.svg);
  fs.writeFileSync(`${OUT}/${c.name}.expected.json`, JSON.stringify(c.exp, null, 2) + '\n');
}


// ---- P4 bird drawings: simple shapes, expected pointiness ranges -------------
function birdPhoto(shape) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960" viewBox="0 0 1280 960">
  <rect width="1280" height="960" fill="#6b5a48"/>
  <rect x="240" y="197" width="800" height="566" fill="#fbfbf7"/>
  <g transform="translate(640 480)" fill="#c2185b">${shape}</g>
</svg>
`;
}
const starPts = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 45 : 130;
  const a = (i / 10) * 2 * Math.PI - Math.PI / 2;
  return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
}).join(' ');
const birds = [
  { name: 'bird-round', note: 'Round blob: heavy, not pointy', shape: '<circle r="110"/>', exp: { bird: { pointiness: [0, 0.08] } } },
  { name: 'bird-triangle', note: 'Triangle: medium pointy', shape: '<polygon points="-120,80 120,80 0,-128"/>', exp: { bird: { pointiness: [0.28, 0.45] } } },
  { name: 'bird-star', note: 'Star: very pointy', shape: `<polygon points="${starPts}"/>`, exp: { bird: { pointiness: [0.5, 1] } } },
];
for (const b of birds) {
  fs.writeFileSync(`${OUT}/${b.name}.svg`, birdPhoto(b.shape));
  fs.writeFileSync(`${OUT}/${b.name}.expected.json`, JSON.stringify(b.exp, null, 2) + '\n');
}


// ---- Digital drawing (iPad Notes / whiteboard export): no paper edges, pen strokes ----
const DIG_W = 1600;
const DIG_H = 1200;
const APPLE = { wood: '#1c1c1e', ice: '#0a84ff', stone: '#8e8e93', tnt: '#ff453a', pig: '#30d158' };
// pen-drawn rectangles: an outline stroke plus a scribble fill, slightly wobbly like a finger/pencil
function penRect(b) {
  const x0 = b.x - b.w / 2, y0 = b.y - b.h / 2, x1 = b.x + b.w / 2, y1 = b.y + b.h / 2;
  const c = APPLE[b.m];
  return `<path d="M${x0} ${y0 + 2} L${x1 - 1} ${y0} L${x1} ${y1 - 2} L${x0 + 2} ${y1} Z" fill="${c}" stroke="${c}" stroke-width="10" stroke-linejoin="round"/>`;
}
const DIG_FORT = {
  blocks: [
    { m: 'wood', x: 520, y: 1010, w: 34, h: 300 },
    { m: 'wood', x: 900, y: 1010, w: 34, h: 300 },
    { m: 'wood', x: 710, y: 842, w: 470, h: 34 },
    { m: 'ice', x: 600, y: 745, w: 30, h: 160 },
    { m: 'ice', x: 820, y: 745, w: 30, h: 160 },
    { m: 'tnt', x: 710, y: 610, w: 100, h: 100 },
    { m: 'stone', x: 1250, y: 1040, w: 70, h: 240 },
  ],
  pigs: [
    { x: 710, y: 1110, r: 48 },
    { x: 1250, y: 860, r: 42 },
  ],
};
const digSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DIG_W}" height="${DIG_H}" viewBox="0 0 ${DIG_W} ${DIG_H}">
  <rect width="${DIG_W}" height="${DIG_H}" fill="#ffffff"/>
  ${DIG_FORT.blocks.map(penRect).join('\n  ')}
  ${DIG_FORT.pigs.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${APPLE.pig}"/><circle cx="${p.x - p.r / 3}" cy="${p.y - p.r / 4}" r="5" fill="#111"/><circle cx="${p.x + p.r / 3}" cy="${p.y - p.r / 4}" r="5" fill="#111"/>`).join('\n  ')}
</svg>
`;
{
  const map = pageToWorld(DIG_W, DIG_H);
  const exp = {
    version: 1,
    blocks: DIG_FORT.blocks.map((b, i) => ({ id: `b${i + 1}`, material: b.m, x: Math.round(map.x(b.x)), y: Math.round(map.y(b.y)), w: Math.round(b.w * map.scale), h: Math.round(b.h * map.scale), angle: 0 })),
    pigs: DIG_FORT.pigs.map((p, i) => ({ id: `p${i + 1}`, x: Math.round(map.x(p.x)), y: Math.round(map.y(p.y)), r: clampPigR(Math.round(p.r * map.scale)) })),
    meta: { source: 'expected' },
  };
  fs.writeFileSync(`${OUT}/digital-ipad.svg`, digSvg);
  fs.writeFileSync(`${OUT}/digital-ipad.expected.json`, JSON.stringify(exp, null, 2) + '\n');
}

// Manifest: keep real photos already listed, replace synthetic entries.
const manifestPath = `${OUT}/fixtures.json`;
const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
const real = old.filter((f) => !f.name.startsWith('synthetic-') && !f.name.startsWith('bird-') && f.name !== 'digital-ipad');
const manifest = [
  ...cases.map((c) => ({ name: c.name, image: `${c.name}.svg`, expected: `${c.name}.expected.json`, note: c.note })),
  { name: 'digital-ipad', image: 'digital-ipad.svg', expected: 'digital-ipad.expected.json', note: 'iPad Notes-style digital drawing: no paper edges, Apple pen colours' },
  ...birds.map((b) => ({ name: b.name, type: 'bird', image: `${b.name}.svg`, expected: `${b.name}.expected.json`, note: b.note })),
  ...real,
];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${cases.length} synthetic fixtures; manifest has ${manifest.length} entries.`);
