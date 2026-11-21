// P4 bonus: "draw your own bird".  Owner: abdurub10.
//
//   parseBird(imageSource) -> Promise<{ bird: { polygon, area, pointiness }, debugCanvas }>
//
// A small drawing (any marker colour, on white paper) becomes one polygon.
// See birdShape.js for what area / pointiness / polygon mean.
// Rejects with err.code === 'VISION_ERROR' and a player-safe message.
import { loadCv } from './opencv.js';
import { preparePage } from './pipeline.js';
import { birdFromOutline } from './birdShape.js';
import { visionError, toImageData } from './parseFort.js';

const MIN_AREA = 0.005; // the bird must cover at least 0.5% of the page
const MAX_VERTICES = 24; // Matter.js is happier with modest vertex counts

export async function parseBird(imageSource) {
  const cv = await loadCv();
  const imageData = await toImageData(imageSource);
  const mats = [];
  const keep = (m) => (mats.push(m), m);

  try {
    const { rgb, W, H } = preparePage(cv, imageData, keep);

    // ink = anything clearly darker or more colourful than the paper
    const gray = keep(new cv.Mat());
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    const ink = keep(new cv.Mat());
    cv.threshold(gray, ink, 200, 255, cv.THRESH_BINARY_INV);
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const sat = keep(new cv.Mat());
    const ch = keep(new cv.MatVector());
    cv.split(hsv, ch);
    cv.threshold(keep(ch.get(1)), sat, 70, 255, cv.THRESH_BINARY);
    cv.bitwise_or(ink, sat, ink);

    // join strokes, so an outlined bird becomes one solid shape
    const k = Math.max(5, Math.round(Math.min(W, H) * 0.02)) | 1;
    const kernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k)));
    cv.morphologyEx(ink, ink, cv.MORPH_CLOSE, kernel);

    const contours = keep(new cv.MatVector());
    const hier = keep(new cv.Mat());
    cv.findContours(ink, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
    let best = null;
    let bestArea = W * H * MIN_AREA;
    for (let i = 0; i < contours.size(); i++) {
      const c = keep(contours.get(i));
      const a = cv.contourArea(c);
      if (a > bestArea) { best = c; bestArea = a; }
    }
    if (!best) throw visionError('No bird found. Draw a bigger, darker bird shape.');

    // simplify, loosening until the outline is small enough for physics
    let eps = 0.006 * cv.arcLength(best, true);
    let pts = [];
    for (let tries = 0; tries < 8; tries++) {
      const approx = keep(new cv.Mat());
      cv.approxPolyDP(best, approx, eps, true);
      const d = approx.data32S;
      pts = Array.from({ length: approx.rows }, (_, j) => ({ x: d[j * 2], y: d[j * 2 + 1] }));
      if (pts.length <= MAX_VERTICES) break;
      eps *= 1.5;
    }
    if (pts.length < 3) throw visionError('That bird is too thin. Draw a filled-in shape.');

    const bird = birdFromOutline(pts, W * H);

    // debug view: the outline we found
    const dbg = keep(rgb.clone());
    const poly = keep(new cv.MatVector());
    const pm = keep(cv.matFromArray(pts.length, 1, cv.CV_32SC2, pts.flatMap((p) => [p.x, p.y])));
    poly.push_back(pm);
    cv.polylines(dbg, poly, true, new cv.Scalar(255, 0, 160), 3);
    const debugCanvas = document.createElement('canvas');
    cv.imshow(debugCanvas, dbg);

    return { bird, debugCanvas };
  } finally {
    for (const m of mats) {
      try { m.delete(); } catch { /* already freed */ }
    }
  }
}
