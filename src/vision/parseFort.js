// Vision: paper photo -> Level JSON.  Owner: abdurub10.
//
// HANDOFF CONTRACT (plan, P2):
//   parseFort(imageSource) -> Promise<{ level, debugCanvas }>
//   ready() -> Promise that resolves when the vision engine (OpenCV.js) is loaded
//
// imageSource can be an <img>, <canvas>, ImageBitmap or a data URL string
// (what arrives in the fort:image socket event).
//
// On failure parseFort REJECTS with an Error whose .message is safe to show on
// the big screen, e.g. "Draw at least one green pig". The error has
// .code = 'VISION_ERROR' so display.html can tell it apart from a crash.
//
// P0 STUB: always returns sample level 1 so display.html and the game can be
// wired up now. The real OpenCV pipeline replaces the body in P1.

import { sampleLevels, validateLevel } from '../shared/level.js';

/** Resolves when parseFort is ready to use. The stub is ready immediately. */
export function ready() {
  return Promise.resolve();
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap|string} imageSource
 * @returns {Promise<{ level: object, debugCanvas: HTMLCanvasElement|null }>}
 */
export async function parseFort(imageSource) {
  await ready();
  const level = structuredClone(sampleLevels[0]);
  level.meta = { ...level.meta, source: 'stub' };

  const { ok, errors } = validateLevel(level);
  if (!ok) throw visionError(`Stub level is invalid: ${errors.join('; ')}`);

  return { level, debugCanvas: stubDebugCanvas(imageSource) };
}

/** An Error the display can show to players as-is. */
export function visionError(message) {
  const err = new Error(message);
  err.code = 'VISION_ERROR';
  return err;
}

function stubDebugCanvas() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#c00';
  g.font = 'bold 18px system-ui, sans-serif';
  g.fillText('VISION STUB: sample level 1', 16, 96);
  return c;
}
