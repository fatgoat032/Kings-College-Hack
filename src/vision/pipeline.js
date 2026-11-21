// The OpenCV part of vision. Pure function of (cv, image pixels, settings):
// no DOM, so it can run anywhere OpenCV.js runs.
//
//   1. find the paper (largest bright quadrilateral) and warp it flat
//   2. even out the lighting (divide by a blurred "paper only" background)
//   3. HSV colour masks: black=wood, blue=ice, grey=stone, red=tnt, green=pig
//   4. close small gaps in marker strokes, find blobs
//   5. blocks -> minAreaRect, pigs -> minEnclosingCircle
// Coordinates returned are pixels on the flattened page; geometry.js maps them to world units.
import { orderQuad } from './geometry.js';

const PAGE_LONG_SIDE = 800; // work size of the flattened page (speed vs detail)
const MATERIAL_OF = { black: 'wood', blue: 'ice', grey: 'stone', red: 'tnt' };
const DEBUG_COLOUR = {
  wood: [120, 72, 30, 255],
  ice: [0, 140, 255, 255],
  stone: [110, 110, 110, 255],
  tnt: [230, 0, 0, 255],
  pig: [0, 190, 0, 255],
};

/**
 * @param {object} cv  ready OpenCV.js
 * @param {{data: Uint8ClampedArray, width: number, height: number}} imageData  RGBA pixels
 * @param {object} settings  see settings.js
 * @returns {{ pageW, pageH, blocks, pigs, paperFound: boolean, debug: object }}  debug.page is a cv.Mat the caller must delete()
 */
export function detect(cv, imageData, settings) {
  const mats = []; // everything here is freed at the end, except debug.page
  const keep = (m) => (mats.push(m), m);

  try {
    const src = keep(cv.matFromImageData(imageData));

    // ---- 1. find the paper and flatten it -------------------------------------
    const quad = findPaper(cv, src, keep);
    const paperFound = quad !== null;
    const corners = quad ?? [
      { x: 0, y: 0 }, { x: src.cols - 1, y: 0 },
      { x: src.cols - 1, y: src.rows - 1 }, { x: 0, y: src.rows - 1 },
    ];
    const [tl, tr, br, bl] = corners;
    const quadW = Math.max(dist(tl, tr), dist(bl, br));
    const quadH = Math.max(dist(tl, bl), dist(tr, br));
    const k = PAGE_LONG_SIDE / Math.max(quadW, quadH);
    const pageW = Math.round(quadW * k);
    const pageH = Math.round(quadH * k);

    const from = keep(cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((p) => [p.x, p.y])));
    const to = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, pageW, 0, pageW, pageH, 0, pageH]));
    const M = keep(cv.getPerspectiveTransform(from, to));
    const page = keep(new cv.Mat());
    cv.warpPerspective(src, page, M, new cv.Size(pageW, pageH), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());

    // Trim a thin border: paper edges and the table often sneak in after warping.
    const trim = Math.round(Math.min(pageW, pageH) * 0.015);
    const inner = keep(page.roi(new cv.Rect(trim, trim, pageW - 2 * trim, pageH - 2 * trim)).clone());
    const W = inner.cols;
    const H = inner.rows;

    // ---- 2. even out lighting ---------------------------------------------------
    const rgb = keep(new cv.Mat());
    cv.cvtColor(inner, rgb, cv.COLOR_RGBA2RGB);
    flattenLighting(cv, rgb, keep);

    // ---- 3. colour masks ----------------------------------------------------------
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const masks = {};
    for (const name of ['black', 'blue', 'red', 'green', 'grey']) {
      masks[name] = keep(hsvMask(cv, hsv, settings.colours[name], keep));
    }
    // Pencil (grey) also appears on the soft edges of every marker stroke:
    // remove grey pixels that sit next to any marker colour.
    const markers = keep(new cv.Mat());
    cv.bitwise_or(masks.black, masks.blue, markers);
    cv.bitwise_or(markers, masks.red, markers);
    cv.bitwise_or(markers, masks.green, markers);
    const grow = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9)));
    const near = keep(new cv.Mat());
    cv.dilate(markers, near, grow);
    cv.bitwise_not(near, near);
    cv.bitwise_and(masks.grey, near, masks.grey);

    // ---- 4 + 5. close gaps, find blobs ------------------------------------------
    const closeK = Math.max(3, Math.round(Math.min(W, H) * 0.012)) | 1;
    const closeKernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(closeK, closeK)));
    const openKernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
    const pageArea = W * H;

    const blocks = [];
    const minBlock = pageArea * settings.minBlockArea;
    for (const [name, material] of Object.entries(MATERIAL_OF)) {
      for (const c of blobs(cv, masks[name], closeKernel, openKernel, minBlock, keep)) {
        for (const r of splitIntoBars(cv, c, W, H, minBlock, keep)) {
          blocks.push({
            material,
            cx: r.center.x, cy: r.center.y,
            w: r.size.width, h: r.size.height,
            angleDeg: r.angle,
            area: r.size.width * r.size.height,
            rect: r,
          });
        }
      }
    }
    const pigs = [];
    for (const c of blobs(cv, masks.green, closeKernel, openKernel, pageArea * settings.minPigArea, keep)) {
      const { center, radius } = cv.minEnclosingCircle(c.contour);
      pigs.push({ cx: center.x, cy: center.y, r: radius, area: c.area });
    }

    // ---- debug view: what we detected, drawn over the flattened page -------------
    const flat = rgb.clone(); // caller frees: the lighting-corrected page (calibration samples it)
    const debugPage = rgb.clone(); // caller frees
    cv.cvtColor(debugPage, debugPage, cv.COLOR_RGB2RGBA);
    for (const b of blocks) {
      const pts = cv.RotatedRect.points(b.rect);
      const col = new cv.Scalar(...DEBUG_COLOUR[b.material]);
      for (let i = 0; i < 4; i++) {
        cv.line(debugPage, pts[i], pts[(i + 1) % 4], col, 3);
      }
      cv.putText(debugPage, b.material, new cv.Point(b.cx - 18, b.cy + 4), cv.FONT_HERSHEY_SIMPLEX, 0.45, col, 1);
      delete b.rect;
    }
    for (const p of pigs) {
      cv.circle(debugPage, new cv.Point(p.cx, p.cy), Math.round(p.r), new cv.Scalar(...DEBUG_COLOUR.pig), 3);
    }

    return {
      pageW: W,
      pageH: H,
      blocks,
      pigs,
      paperFound,
      debug: { page: debugPage, flat, masks: Object.fromEntries(Object.entries(masks).map(([n, m]) => [n, m.clone()])) },
    };
  } finally {
    for (const m of mats) {
      try { m.delete(); } catch { /* already freed */ }
    }
  }
}

/** Largest bright 4-sided shape covering at least 20% of the photo, or null. */
function findPaper(cv, src, keep) {
  const gray = keep(new cv.Mat());
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(7, 7), 0);
  const bin = keep(new cv.Mat());
  cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  const k = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15)));
  cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k); // fill the drawing so the page is one blob

  const contours = keep(new cv.MatVector());
  const hier = keep(new cv.Mat());
  cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let best = null;
  let bestArea = src.rows * src.cols * 0.2;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area > bestArea) {
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const d = approx.data32S;
        best = orderQuad([0, 1, 2, 3].map((j) => ({ x: d[j * 2], y: d[j * 2 + 1] })));
        bestArea = area;
      }
      approx.delete();
    }
    c.delete();
  }
  return best;
}

/**
 * Divide each channel by an estimate of the bare paper behind it, so shadows
 * and dim light don't turn white paper grey. The background estimate is a big
 * morphological close (removes strokes thinner than the kernel) plus a blur.
 * Result: bare paper is ~255 in every channel, so colour ranges hold in any light.
 */
function flattenLighting(cv, rgb, keep) {
  const k = Math.max(15, Math.round(Math.min(rgb.cols, rgb.rows) * 0.12)) | 1;
  const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k)));
  const bg = keep(new cv.Mat());
  cv.morphologyEx(rgb, bg, cv.MORPH_CLOSE, kernel);
  cv.blur(bg, bg, new cv.Size(k, k));

  // pixel / local paper colour: bare paper becomes ~255 in every channel,
  // whatever the light (this also white-balances warm or cool lamps).
  const px = rgb.data;
  const b = bg.data;
  for (let i = 0; i < px.length; i++) {
    px[i] = Math.min(255, (px[i] * 255) / Math.max(b[i], 1));
  }
}

/** Binary mask for an HSV range; hue may wrap (e.g. red: h [165, 12]). */
function hsvMask(cv, hsv, range, keep) {
  const [h0, h1] = range.h;
  const lo = (h) => keep(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(h, range.s[0], range.v[0], 0)));
  const hi = (h) => keep(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(h, range.s[1], range.v[1], 255)));
  const out = new cv.Mat();
  if (h0 <= h1) {
    cv.inRange(hsv, lo(h0), hi(h1), out);
  } else {
    const a = keep(new cv.Mat());
    cv.inRange(hsv, lo(h0), hi(180), a);
    cv.inRange(hsv, lo(0), hi(h1), out);
    cv.bitwise_or(out, a, out);
  }
  return out;
}

/** Close gaps, drop specks, return contours above minArea (caller's keep() frees them). */
function blobs(cv, mask, closeKernel, openKernel, minArea, keep) {
  const m = keep(new cv.Mat());
  cv.morphologyEx(mask, m, cv.MORPH_CLOSE, closeKernel);
  cv.morphologyEx(m, m, cv.MORPH_OPEN, openKernel);
  const contours = keep(new cv.MatVector());
  const hier = keep(new cv.Mat());
  cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const out = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = keep(contours.get(i));
    const area = cv.contourArea(c);
    if (area >= minArea) out.push({ contour: c, area });
  }
  return out;
}

/**
 * Same-colour blocks that touch (pillars under a beam) come out as one blob.
 * A blob that fills its rotated rectangle well is one block. Otherwise split it
 * into horizontal and vertical bars: an "opening" with a long thin kernel keeps
 * only runs longer than the kernel, so beams survive the horizontal pass and
 * pillars the vertical one. Kernel length scales with the stroke thickness.
 * @returns {Array<object>} rotated rects (cv.minAreaRect results)
 */
function splitIntoBars(cv, blob, W, H, minArea, keep) {
  const whole = cv.minAreaRect(blob.contour);
  const fill = blob.area / Math.max(1, whole.size.width * whole.size.height);
  if (fill >= 0.78) return [whole];

  // filled mask of just this blob
  const m = keep(cv.Mat.zeros(H, W, cv.CV_8UC1));
  const one = keep(new cv.MatVector());
  one.push_back(blob.contour);
  cv.drawContours(m, one, 0, new cv.Scalar(255), cv.FILLED);

  // stroke thickness ≈ 2 × the deepest point of the distance transform
  const dt = keep(new cv.Mat());
  cv.distanceTransform(m, dt, cv.DIST_L2, 5);
  const half = cv.minMaxLoc(dt).maxVal;
  const L = Math.max(15, Math.round(half * 4.5));

  const pieces = [];
  for (const size of [new cv.Size(L, 1), new cv.Size(1, L)]) {
    const k = keep(cv.getStructuringElement(cv.MORPH_RECT, size));
    const part = keep(new cv.Mat());
    cv.morphologyEx(m, part, cv.MORPH_OPEN, k);
    const cs = keep(new cv.MatVector());
    const hier = keep(new cv.Mat());
    cv.findContours(part, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < cs.size(); i++) {
      const c = keep(cs.get(i));
      if (cv.contourArea(c) >= minArea * 0.5) pieces.push({ rect: cv.minAreaRect(c), box: cv.boundingRect(c) });
    }
  }
  // a chunky piece (e.g. a square) survives both passes: keep it once
  const out = [];
  for (const p of pieces) {
    if (!out.some((q) => iou(p.box, q.box) > 0.5)) out.push(p);
  }
  return out.length ? out.map((p) => p.rect) : [whole];
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.width * a.height + b.width * b.height - inter);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
