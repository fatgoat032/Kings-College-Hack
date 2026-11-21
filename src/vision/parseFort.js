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
import { decideShapes, shapesToLevel, layoutToLevel, cleanLayout, classifyStats, pickCandidate, readingToLevel } from './hybridLevel.js';
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
 * parseFort(img, { detector }) with detector 'auto' (default) | 'hybrid' | 'claude' | 'opencv'.
 *
 * auto (17:24 brief): run HYBRID (OpenCV per-colour shapes + /api/classify) and CLAUDE-ONLY
 * (/api/layout + clean-up: snap angles within 8°, settle blocks, drop pigs) in parallel with one
 * shared 10 s timeout, then pick: HYBRID if Claude answered every shape, average confidence
 * >= 0.7 and its block count is within ±30% of CLAUDE-ONLY's; otherwise CLAUDE-ONLY; if only
 * one worked, that one; if both failed (or no key / no internet), the OpenCV detector.
 *
 * Extra result fields: candidates = { hybrid?, claude?, opencv? }, each
 * { ok, level?, error?, ms, avgConfidence?, complete?, overlay? }, and pick = { chose, reason }.
 * level.meta.detector says which one was used. A failed scan carries both on the error too.
 */
export async function parseFort(imageSource, options = {}) {
  const mode = options.detector ?? 'auto';
  const t0 = performance.now();
  const candidates = {};

  // OpenCV always runs locally: it's the fallback and costs well under a second.
  let opencv = null;
  const tO = performance.now();
  try {
    opencv = await parseFortOpenCV(imageSource, options);
    candidates.opencv = { ok: true, level: opencv.level, ms: Math.round(performance.now() - tO), overlay: opencv.debug.overlay };
  } catch (err) {
    candidates.opencv = { ok: false, error: err.message, ms: Math.round(performance.now() - tO), overlay: err.debug?.overlay };
    opencv = { error: err };
  }

  let pick;
  let claudeBase = null;
  if (mode === 'opencv') {
    pick = { chose: 'opencv', reason: 'OpenCV requested' };
  } else if (!(await claudeEnabled())) {
    pick = { chose: 'opencv', reason: 'Claude not configured on the server' };
  } else {
    const cv = await loadCv();
    const settings = options.settings ?? loadSettings();
    const imageData = await toImageData(imageSource);
    const fs = findShapesByColour(cv, imageData, settings);
    claudeBase = fs;
    const meta = { imageW: imageData.width, imageH: imageData.height, paperFound: fs.paperFound };
    const jpeg = (c) => c.toDataURL('image/jpeg', 0.85);
    const clean = jpeg(fs.canvases.clean);
    const signal = AbortSignal.timeout(10_000); // one shared timeout for both calls

    const runHybrid = async () => {
      if (fs.shapes.length < 1 || fs.shapes.length > CLASSIFY_MAX_SHAPES) throw new Error(`${fs.shapes.length} shapes: outside 1-${CLASSIFY_MAX_SHAPES}`);
      const res = await postJson('/api/classify', { annotated: jpeg(fs.canvases.annotated), clean, count: fs.shapes.length }, signal);
      const level = shapesToLevel(decideShapes(fs.shapes, res.shapes), fs.pageW, fs.pageH, { ...meta, detector: 'hybrid' });
      return { level, ...classifyStats(res.shapes, fs.shapes.length) };
    };
    const runClaude = async () => {
      const res = await postJson('/api/layout', { clean }, signal);
      return { level: cleanLayout(layoutToLevel(res, fs.pageW, fs.pageH, { ...meta, detector: 'claude' })) };
    };
    // Team Fix #3: Claude reads the page itself (/api/read), we draw its reading over the page,
    // and Claude checks and corrects it (/api/verify). Budget: read ~10 s + verify ~5 s
    // (the server runs effort high with 2 few-shot images), plus 1 s for the uploads.
    const runVerified = async () => {
      const pageCanvas = fs.canvases.clean;
      const W = pageCanvas.width;
      const H = pageCanvas.height;
      const image = pageCanvas.toDataURL('image/png');
      const vSignal = AbortSignal.timeout(16_000);
      const read = await postJson('/api/read', { image, width: W, height: H, timeoutMs: 10_000 }, vSignal);
      let reading = read.reading;
      let changes = [];
      const overlayCanvas = drawReading(pageCanvas, reading);
      try {
        const v = await postJson('/api/verify', { image, overlay: overlayCanvas.toDataURL('image/png'), width: W, height: H, reading, timeoutMs: 5000 }, vSignal);
        if (v.reading) reading = v.reading;
        changes = v.changes || [];
      } catch (err) {
        changes = [`verify skipped: ${err?.message || err}`];
      }
      const level = cleanLayout(readingToLevel(reading, W, H, { ...meta, detector: 'claude', reading: 'verified' }));
      return { level, changes, verifiedOverlay: drawReading(pageCanvas, reading) };
    };
    const timed = async (name, fn) => {
      const t = performance.now();
      try {
        const r = await fn();
        const check = checkLevel(r.level);
        if (!check.ok) throw new Error(check.message);
        const { verifiedOverlay, ...rest } = r;
        candidates[name] = { ok: true, ...rest, ms: Math.round(performance.now() - t), overlay: verifiedOverlay ?? fs.canvases.annotated };
      } catch (err) {
        candidates[name] = { ok: false, error: err?.message || String(err), ms: Math.round(performance.now() - t) };
      }
    };
    const jobs = [];
    if (mode === 'auto' || mode === 'hybrid') jobs.push(timed('hybrid', runHybrid));
    if (mode === 'auto' || mode === 'claude') jobs.push(timed('claude', runClaude));
    if (mode === 'auto' || mode === 'claude-verified') jobs.push(timed('verified', runVerified));
    await Promise.allSettled(jobs);

    const key = mode === 'claude-verified' ? 'verified' : mode;
    if (mode === 'auto') pick = pickVerified(candidates) ?? pickCandidate(candidates);
    else if (candidates[key]?.ok) pick = { chose: mode, reason: `${mode} requested` };
    else pick = { chose: 'opencv', reason: `${mode} requested but failed: ${candidates[key]?.error}` };
  }

  // Build the result around the chosen level
  if (pick.chose === 'opencv') {
    if (opencv.error) {
      opencv.error.candidates = candidates;
      opencv.error.pick = pick;
      throw opencv.error;
    }
    opencv.level.meta.detector = 'opencv';
    return { ...opencv, candidates, pick, timings: { ...opencv.timings, total: performance.now() - t0 } };
  }
  const chosen = candidates[pick.chose === 'claude-verified' ? 'verified' : pick.chose];
  const fs = claudeBase;
  const copy = (c) => {
    const d = document.createElement('canvas');
    d.width = c.width;
    d.height = c.height;
    d.getContext('2d').drawImage(c, 0, 0);
    return d;
  };
  return {
    level: chosen.level,
    debugCanvas: fs.canvases.annotated,
    page: fs.canvases.clean,
    pageToWorld: pageTransform(fs.pageW, fs.pageH),
    debug: { overlay: copy(fs.canvases.annotated), masks: fs.masks },
    warnings: fs.paperFound ? [] : ['Paper edges not found: used the whole photo'],
    candidates,
    pick,
    timings: { claude: chosen.ms, total: performance.now() - t0 },
  };
}

/**
 * Prefer Claude's verified reading when it worked and its block count is within ±50% of the
 * best other candidate (claude-only, then hybrid, then opencv): a sanity check against a bad read.
 * Returns null to fall back to the hybrid/claude/opencv rule.
 */
function pickVerified(c) {
  const v = c.verified;
  if (!v?.ok) return null;
  const ref = [c.claude, c.hybrid, c.opencv].find((x) => x?.ok);
  const vn = v.level.blocks.length;
  if (!ref) return { chose: 'claude-verified', reason: 'only Claude-verified worked' };
  const rn = ref.level.blocks.length;
  if (Math.abs(vn - rn) <= 0.5 * Math.max(rn, 1)) {
    return { chose: 'claude-verified', reason: `Claude read + verified (${vn} blocks vs ${rn}${v.changes?.length ? `, ${v.changes.length} corrections` : ''})` };
  }
  return null;
}

/** Draw a reading (page pixels) over a copy of the page, for /api/verify and the D overlay. */
function drawReading(pageCanvas, reading) {
  const c = document.createElement('canvas');
  c.width = pageCanvas.width;
  c.height = pageCanvas.height;
  const g = c.getContext('2d');
  g.drawImage(pageCanvas, 0, 0);
  const COL = { black: '#ff00c8', blue: '#00b7ff', grey: '#ff8c00', red: '#ffe600' };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const s of reading?.strokes || []) {
    g.strokeStyle = COL[s.colour] || '#ff00c8';
    g.globalAlpha = 0.35;
    g.lineWidth = Math.max(2, s.thickness || 4);
    g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
  }
  for (const p of reading?.polys || []) {
    if (!p.vertices?.length) continue;
    g.strokeStyle = COL[p.colour] || '#ff00c8';
    g.lineWidth = 3;
    g.beginPath();
    p.vertices.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath(); g.stroke();
  }
  g.strokeStyle = '#00d24a';
  g.lineWidth = 3;
  for (const p of reading?.pigs || []) {
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.stroke();
  }
  return c;
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

async function postJson(url, body, signal) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  const json = await r.json();
  if (json.error) throw new Error(`${url}: ${json.error}`);
  return json;
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
