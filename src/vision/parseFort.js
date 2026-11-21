// Vision: paper photo -> Level JSON.  Owner: abdurub10.
//
// HANDOFF CONTRACT (plan, P2):
//   parseFort(imageSource, options?) -> Promise<{ level, debugCanvas }>
//   ready() -> Promise that resolves when OpenCV.js is loaded
//
// imageSource: an <img>, <canvas>, ImageBitmap, Blob/File, or a data URL string
// (what arrives in the fort:image socket event).
//
// On a bad drawing parseFort REJECTS with an Error whose .message is safe to
// show on the big screen (e.g. "Draw at least one green pig") and
// .code === 'VISION_ERROR', so display.html can tell it apart from a crash.
//
// options.settings: override settings (the calibration screen uses this);
// default = loadSettings() (defaults + whatever calibration saved).

import { loadCv } from './opencv.js';
import { detect } from './pipeline.js';
import { buildLevel, checkLevel, pageTransform } from './geometry.js';
import { loadSettings } from './settings.js';
import { findShapesByColour } from './findShapes.js';
import { decideShapes, shapesToLevel, layoutToLevel } from './hybridLevel.js';
import { CLASSIFY_MAX_SHAPES } from '../shared/classify.js';

const MAX_INPUT_W = 1280; // plan: photos arrive at max 1280 px wide

/** Resolves when parseFort is ready to use (OpenCV.js loaded, ~1-2 s the first time). */
export function ready() {
  return loadCv().then(() => undefined);
}

/**
 * @returns {Promise<{ level: object, debugCanvas: HTMLCanvasElement, page: HTMLCanvasElement,
 *   pageToWorld: { sx: number, sy: number, ox: number, oy: number }, warnings: string[], timings: object }>}
 *   page: the clean flattened drawing; worldX = ox + pageX·sx, worldY = oy + pageY·sy
 */
export async function parseFortOpenCV(imageSource, options = {}) {
  const t0 = performance.now();
  const cv = await loadCv();
  const settings = options.settings ?? loadSettings();

  const imageData = await toImageData(imageSource);
  const t1 = performance.now();

  let found;
  try {
    found = detect(cv, imageData, settings);
  } catch (err) {
    throw visionError(`Couldn't read the drawing (${err?.message || err}). Try another photo.`);
  }
  const t2 = performance.now();

  const debugCanvas = document.createElement('canvas');
  // The clean flattened page (lighting-corrected, no debug drawings) so the game
  // can crop each block's real pen strokes as its texture.
  const page = document.createElement('canvas');
  // Per-colour masks as canvases (white = pixels counted as that colour), for the
  // display's D debug overlay: debug.masks.{black,blue,grey,red,green} + debug.overlay.
  // overlay is its own canvas (not debugCanvas itself): a canvas element can only sit in one
  // place in the page, so sharing it would leave one of them blank in the D overlay.
  const debug = { overlay: document.createElement('canvas'), masks: {} };
  try {
    cv.imshow(debugCanvas, found.debug.page);
    cv.imshow(debug.overlay, found.debug.page);
    cv.imshow(page, found.debug.flat);
    for (const [name, m] of Object.entries(found.debug.masks)) {
      const c = document.createElement('canvas');
      cv.imshow(c, m);
      debug.masks[name] = c;
    }
  } finally {
    found.debug.page.delete();
    found.debug.flat.delete();
    for (const m of Object.values(found.debug.masks)) m.delete();
  }

  const { level, warnings } = buildLevel(found, settings, {
    imageW: imageData.width,
    imageH: imageData.height,
    paperFound: found.paperFound,
    detector: 'opencv',
  });
  if (!found.paperFound) warnings.push('Paper edges not found: used the whole photo');

  const check = checkLevel(level);
  if (!check.ok) {
    const err = check.bug ? new Error(check.message) : visionError(check.message);
    err.debugCanvas = debugCanvas;
    err.debug = debug;
    err.level = level;
    throw err;
  }

  // worldX = ox + pageX * sx, worldY = oy + pageY * sy (pixels of `page`)
  const pageToWorld = pageTransform(found.pageW, found.pageH);

  const timings = { decode: t1 - t0, detect: t2 - t1, total: performance.now() - t0 };
  return { level, debugCanvas, page, pageToWorld, debug, warnings, timings };
}

/**
 * Team Fix #2 hybrid (OpenCV shapes + Claude colours via /api/classify, or Claude's own
 * layout via /api/layout for 0 or >60 shapes) is OPT-IN: parseFort(img, { detector: 'hybrid' }).
 * Default stays the per-colour OpenCV detector, because the brief's single ink mask merges
 * touching blocks of different colours into one shape (see /fixtures/hybrid-check.html), which
 * made real forts worse. ANY hybrid problem (no key, no internet, timeout, invalid level, no pig)
 * falls back to parseFortOpenCV. result.level.meta.detector says which path produced the level.
 */
export async function parseFort(imageSource, options = {}) {
  if (options.detector === 'hybrid') {
    try {
      return await parseFortHybrid(imageSource, options);
    } catch (err) {
      console.info('[vision] hybrid detector not used:', err?.message || err);
    }
  }
  return parseFortOpenCV(imageSource, options);
}

let statusCache = null; // { enabled, at }
async function claudeEnabled() {
  if (statusCache && performance.now() - statusCache.at < 60_000) return statusCache.enabled;
  let enabled = false;
  try {
    const r = await fetch('/api/claude/status', { signal: AbortSignal.timeout(2000) });
    enabled = r.ok && (await r.json()).enabled === true;
  } catch { /* server or endpoint missing */ }
  statusCache = { enabled, at: performance.now() };
  return enabled;
}

async function postJson(url, body, ms) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  const json = await r.json();
  if (json.error) throw new Error(`${url}: ${json.error}`);
  return json;
}

async function parseFortHybrid(imageSource, options) {
  const t0 = performance.now();
  if (!(await claudeEnabled())) throw new Error('Claude not configured on the server');
  const cv = await loadCv();
  const settings = options.settings ?? loadSettings();
  const imageData = await toImageData(imageSource);
  const fs = findShapesByColour(cv, imageData, settings);
  const jpeg = (c) => c.toDataURL('image/jpeg', 0.85);
  const meta = { imageW: imageData.width, imageH: imageData.height, paperFound: fs.paperFound };

  let level;
  let claudeMs = 0;
  if (fs.shapes.length >= 1 && fs.shapes.length <= CLASSIFY_MAX_SHAPES) {
    const t = performance.now();
    const res = await postJson('/api/classify', { annotated: jpeg(fs.canvases.annotated), clean: jpeg(fs.canvases.clean), count: fs.shapes.length }, 15000);
    claudeMs = performance.now() - t;
    level = shapesToLevel(decideShapes(fs.shapes, res.shapes), fs.pageW, fs.pageH, { ...meta, detector: 'hybrid' });
  } else {
    const t = performance.now();
    const res = await postJson('/api/layout', { clean: jpeg(fs.canvases.clean) }, 15000);
    claudeMs = performance.now() - t;
    level = layoutToLevel(res, fs.pageW, fs.pageH, { ...meta, detector: 'claude' });
  }

  const check = checkLevel(level);
  if (!check.ok) throw new Error(`hybrid level rejected: ${check.message}`);

  const copy = (c) => {
    const d = document.createElement('canvas');
    d.width = c.width;
    d.height = c.height;
    d.getContext('2d').drawImage(c, 0, 0);
    return d;
  };
  return {
    level,
    debugCanvas: fs.canvases.annotated,
    page: fs.canvases.clean,
    pageToWorld: pageTransform(fs.pageW, fs.pageH),
    debug: { overlay: copy(fs.canvases.annotated), masks: fs.masks },
    warnings: fs.paperFound ? [] : ['Paper edges not found: used the whole photo'],
    timings: { claude: claudeMs, total: performance.now() - t0 },
  };
}

/** An Error the display can show to players as-is. */
export function visionError(message) {
  const err = new Error(message);
  err.code = 'VISION_ERROR';
  return err;
}

/** Any supported image source -> RGBA ImageData, scaled to at most 1280 px wide. */
export async function toImageData(source) {
  let drawable = source;
  if (typeof source === 'string') drawable = await loadImage(source);
  else if (typeof Blob !== 'undefined' && source instanceof Blob) drawable = await createImageBitmap(source);
  if (drawable instanceof HTMLImageElement && !drawable.complete) await drawable.decode();

  const w0 = drawable.naturalWidth || drawable.videoWidth || drawable.width;
  const h0 = drawable.naturalHeight || drawable.videoHeight || drawable.height;
  if (!w0 || !h0) throw visionError('No image received. Try scanning again.');
  const s = Math.min(1, MAX_INPUT_W / w0);
  const w = Math.round(w0 * s);
  const h = Math.round(h0 * s);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(drawable, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(visionError('That photo could not be opened. Try scanning again.'));
    img.src = src;
  });
}
