// Claude image endpoints for fort scanning (contract: src/shared/classify.js).
//   POST /api/classify  OpenCV found the shapes; Claude says what colour / kind each numbered one is.
//   POST /api/layout    fallback: Claude reads the whole layout from the clean page.
//   GET  /api/claude/status
// The API key lives only here (.env ANTHROPIC_API_KEY) and is never sent to a browser.
// Every failure (no key, no internet, timeout, refusal, bad answer) answers 200 { error } fast,
// so vision falls back to its OpenCV colour masks and the game keeps going.
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { CLAUDE_COLOURS, CLAUDE_KINDS, CLASSIFY_MAX_SHAPES } from '../src/shared/classify.js';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit per image
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const CLASSIFY_PROMPT = `This is a child's-drawing-style fort for an Angry Birds game, drawn with markers on white paper. The first image has each shape outlined and numbered; the second is the same page without our marks.
For every number from 1 to {count}, report the marker colour of the shape (black, blue, grey/pencil, red, green), whether it is a block, a pig (green blob, may have a face) or something to ignore (writing, smudges, the swatch row). Judge colour by the ink, not by the outline we drew.
Use "grey" for pencil or grey marker, "other" if the ink is none of these colours. Report each number exactly once; confidence is 0 to 1.`;

const LAYOUT_PROMPT = `This is a child's-drawing-style fort for an Angry Birds game, drawn with markers on white paper.
Read the whole layout. Each block is a rectangle of marker ink: black = wood, blue = ice, grey/pencil = stone, red = TNT. Pigs are green blobs (may have a face).
Use page coordinates from 0 to 1: x and w are fractions of the image width, y and h of the image height, measured from the top-left corner. x, y are the centre of each block; w and h are its size before rotation, angle is its rotation in radians (0 = axis-aligned). For pigs, x, y are the centre and r is the radius as a fraction of the image width.
Match the drawn thickness of each block exactly. Ignore writing, smudges and the colour swatch row.`;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    shapes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          colour: { type: 'string', enum: [...CLAUDE_COLOURS] },
          kind: { type: 'string', enum: [...CLAUDE_KINDS] },
          confidence: { type: 'number' },
        },
        required: ['n', 'colour', 'kind', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['shapes'],
  additionalProperties: false,
};

const num = { type: 'number' };
const LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { colour: { type: 'string', enum: [...CLAUDE_COLOURS] }, x: num, y: num, w: num, h: num, angle: num },
        required: ['colour', 'x', 'y', 'w', 'h', 'angle'],
        additionalProperties: false,
      },
    },
    pigs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { x: num, y: num, r: num },
        required: ['x', 'y', 'r'],
        additionalProperties: false,
      },
    },
  },
  required: ['blocks', 'pigs'],
  additionalProperties: false,
};

class ScanError extends Error {}

/** "data:image/jpeg;base64,..." -> an image content block. Throws ScanError when unusable. */
function imageBlock(dataUrl, label) {
  const m = typeof dataUrl === 'string' && /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new ScanError(`${label} must be a base64 data URL`);
  if (!IMAGE_TYPES.includes(m[1])) throw new ScanError(`${label} must be JPEG, PNG, WebP or GIF`);
  if ((m[2].length * 3) / 4 > MAX_IMAGE_BYTES) throw new ScanError(`${label} is over 5 MB; send at most 1568 px on the long edge`);
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

/** Keep one answer per number 1..count; numbers Claude skipped get confidence 0 (vision uses its HSV guess). */
export function tidyShapes(shapes, count) {
  const byN = new Map();
  for (const s of Array.isArray(shapes) ? shapes : []) {
    const n = Math.round(Number(s?.n));
    if (!(n >= 1 && n <= count) || byN.has(n)) continue;
    byN.set(n, {
      n,
      colour: CLAUDE_COLOURS.includes(s.colour) ? s.colour : 'other',
      kind: CLAUDE_KINDS.includes(s.kind) ? s.kind : 'block',
      confidence: clamp01(s.confidence),
    });
  }
  const out = [];
  for (let n = 1; n <= count; n++) out.push(byN.get(n) ?? { n, colour: 'other', kind: 'block', confidence: 0 });
  return out;
}

/** Drop layout entries outside the page or with no size. */
export function tidyLayout({ blocks, pigs }) {
  const inPage = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
  return {
    blocks: (blocks || [])
      .filter((b) => inPage(b.x) && inPage(b.y) && b.w > 0 && b.h > 0 && b.w <= 1.5 && b.h <= 1.5)
      .map((b) => ({ colour: CLAUDE_COLOURS.includes(b.colour) ? b.colour : 'other', x: b.x, y: b.y, w: b.w, h: b.h, angle: Number.isFinite(b.angle) ? b.angle : 0 })),
    pigs: (pigs || []).filter((p) => inPage(p.x) && inPage(p.y) && p.r > 0 && p.r < 0.5).map((p) => ({ x: p.x, y: p.y, r: p.r })),
  };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.apiKey]   defaults to process.env.ANTHROPIC_API_KEY
 * @param {string} [opts.model]    defaults to process.env.CLAUDE_MODEL or claude-sonnet-5-5
 * @param {object} [opts.client]   an Anthropic-like client (tests inject a fake)
 * @param {(...a) => void} [opts.log]
 */
export function createClaude(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = opts.model ?? process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
  const timeout = opts.timeoutMs ?? TIMEOUT_MS;
  const log = opts.log ?? ((...a) => console.log(new Date().toISOString().slice(11, 19), '[claude]', ...a));
  const client = opts.client ?? (apiKey ? new Anthropic({ apiKey, timeout, maxRetries: 0 }) : null);

  /** One structured-output call with images; returns the parsed JSON object. */
  async function ask(images, prompt, schema) {
    if (!client) throw new ScanError('no ANTHROPIC_API_KEY on the server');
    let res;
    try {
      res = await client.messages.create(
        {
          model,
          max_tokens: 8000,
          output_config: { effort: 'low', format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content: [...images, { type: 'text', text: prompt }] }],
        },
        { timeout, maxRetries: 0 },
      );
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ScanError(`timed out after ${timeout / 1000} s`);
      if (e instanceof Anthropic.AuthenticationError) throw new ScanError('the API key was rejected');
      if (e instanceof Anthropic.RateLimitError) throw new ScanError('rate limited');
      if (e instanceof Anthropic.APIConnectionError) throw new ScanError('no connection to the Claude API (no internet?)');
      if (e instanceof Anthropic.APIError) throw new ScanError(`Claude API error ${e.status}: ${e.message}`);
      throw e;
    }
    if (res.stop_reason === 'refusal') throw new ScanError('Claude declined this image');
    if (res.stop_reason === 'max_tokens') throw new ScanError('answer was cut off');
    const text = res.content.find((b) => b.type === 'text')?.text;
    try {
      return JSON.parse(text);
    } catch {
      throw new ScanError('answer was not valid JSON');
    }
  }

  async function classify({ annotated, clean, count }) {
    const n = Math.round(Number(count));
    if (!(n >= 1 && n <= CLASSIFY_MAX_SHAPES)) throw new ScanError(`count must be 1-${CLASSIFY_MAX_SHAPES}; use /api/layout`);
    const images = [imageBlock(annotated, 'annotated'), imageBlock(clean, 'clean')];
    const out = await ask(images, CLASSIFY_PROMPT.replace('{count}', String(n)), CLASSIFY_SCHEMA);
    return { shapes: tidyShapes(out.shapes, n) };
  }

  async function layout({ clean }) {
    const out = await ask([imageBlock(clean, 'clean')], LAYOUT_PROMPT, LAYOUT_SCHEMA);
    return tidyLayout(out);
  }

  /** Wrap a handler: always 200, { ...result, ms, model } or { error, ms }, plus a log line. */
  const route = (name, fn, summary) => async (req, res) => {
    const t0 = Date.now();
    try {
      const out = await fn(req.body || {});
      const ms = Date.now() - t0;
      log(`${name} ok in ${ms} ms (${model}): ${summary(out)}`);
      res.json({ ...out, ms, model });
    } catch (e) {
      const ms = Date.now() - t0;
      const error = e instanceof ScanError ? e.message : `server error: ${e.message}`;
      log(`${name} failed in ${ms} ms: ${error}`);
      res.json({ error, ms });
    }
  };

  const router = express.Router();
  router.use(express.json({ limit: '15mb' }));
  router.get('/claude/status', (_req, res) => res.json({ enabled: !!client, model }));
  router.post(
    '/classify',
    route('classify', classify, (o) => {
      const c = {};
      for (const s of o.shapes) c[`${s.kind}:${s.colour}`] = (c[`${s.kind}:${s.colour}`] || 0) + 1;
      return `${o.shapes.length} shapes ${JSON.stringify(c)}`;
    }),
  );
  router.post('/layout', route('layout', layout, (o) => `${o.blocks.length} blocks, ${o.pigs.length} pigs`));

  return { router, classify, layout, enabled: !!client, model };
}
