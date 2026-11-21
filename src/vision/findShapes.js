// A2: findShapes for the hybrid detector (Team Fix #2 brief).
//   ONE ink mask (darker OR more colourful than the paper) -> close -> external contours
//   (drop < 0.3% of the page) -> approxPolyDP 1% -> rect if near-rectangular, else poly.
//   Each shape gets meanColour (of its own ink pixels) and a number on an annotated image
//   that /api/classify (Claude) reads.
import { preparePage } from './pipeline.js';
import { normaliseRect, snapAngle } from './geometry.js';
import { POLY_MAX_VERTICES } from '../shared/level.js';

const RECT_FILL = 0.85; // contour fills >= 85% of its rotated rect -> treat as a rect

/**
 * @returns {{ pageW, pageH, shapes, paperFound, canvases: { annotated, clean, ink } }}
 */
export function findShapes(cv, imageData, settings) {
  const mats = [];
  const keep = (m) => (mats.push(m), m);
  try {
    const { rgb, W, H, paperFound } = preparePage(cv, imageData, keep);

    // ink = darker than the paper OR clearly coloured, judged on a slightly blurred page
    const k = Math.max(3, Math.round(W * 0.012)) | 1;
    const soft = keep(new cv.Mat());
    cv.blur(rgb, soft, new cv.Size(k, k));
    const hsv = keep(new cv.Mat());
    cv.cvtColor(soft, hsv, cv.COLOR_RGB2HSV);
    const full = (a, b, c, d) => keep(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(a, b, c, d)));
    const dark = keep(new cv.Mat());
    cv.inRange(hsv, full(0, 0, 0, 0), full(180, 255, settings.colours.grey.v[1], 255), dark);
    const sat = keep(new cv.Mat());
    cv.inRange(hsv, full(0, 61, 0, 0), full(180, 255, 255, 255), sat);
    const inkRaw = keep(new cv.Mat());
    cv.bitwise_or(dark, sat, inkRaw);

    const ink = keep(new cv.Mat());
    const ck = Math.max(5, Math.round(W * 0.015)) | 1;
    cv.morphologyEx(inkRaw, ink, cv.MORPH_CLOSE, keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ck, ck))));
    cv.morphologyEx(ink, ink, cv.MORPH_OPEN, keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))));

    const contours = keep(new cv.MatVector());
    const hier = keep(new cv.Mat());
    cv.findContours(ink, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const minArea = W * H * 0.003;
    const shapes = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = keep(contours.get(i));
      const area = cv.contourArea(c);
      if (area < minArea) continue;

      // mean colour of this shape's own ink (not the paper inside an outline)
      const fill = keep(cv.Mat.zeros(H, W, cv.CV_8UC1));
      cv.drawContours(fill, contours, i, new cv.Scalar(255), cv.FILLED);
      const own = keep(new cv.Mat());
      cv.bitwise_and(fill, inkRaw, own);
      const m = cv.mean(rgb, cv.countNonZero(own) > 0 ? own : fill);

      const rr = cv.minAreaRect(c);
      const rect = normaliseRect({ cx: rr.center.x, cy: rr.center.y, w: rr.size.width, h: rr.size.height, angleDeg: rr.angle });
      rect.angleDeg = snapAngle(rect.angleDeg, settings.snapDegrees);
      const rectFill = area / Math.max(1, rr.size.width * rr.size.height);

      let eps = 0.01 * cv.arcLength(c, true);
      let vertices = [];
      for (let t = 0; t < 8; t++) {
        const approx = keep(new cv.Mat());
        cv.approxPolyDP(c, approx, eps, true);
        const d = approx.data32S;
        vertices = Array.from({ length: approx.rows }, (_, j) => [d[j * 2], d[j * 2 + 1]]);
        if (vertices.length <= POLY_MAX_VERTICES) break;
        eps *= 1.5;
      }
      const type = rectFill >= RECT_FILL || vertices.length < 3 ? 'rect' : 'poly';
      const circ = cv.minEnclosingCircle(c);
      shapes.push({
        n: shapes.length + 1,
        type,
        rect,
        vertices,
        circle: { cx: circ.center.x, cy: circ.center.y, r: circ.radius },
        meanColour: [m[0], m[1], m[2]],
        area,
        contourIndex: i,
      });
    }

    // annotated page: every shape outlined and numbered big, for Claude to read
    const ann = keep(rgb.clone());
    for (const s of shapes) {
      cv.drawContours(ann, contours, s.contourIndex, new cv.Scalar(255, 0, 200), 3);
      const at = new cv.Point(Math.max(4, s.rect.cx - 14), Math.max(26, s.rect.cy + 12));
      cv.putText(ann, String(s.n), at, cv.FONT_HERSHEY_SIMPLEX, 1.1, new cv.Scalar(255, 255, 255), 7);
      cv.putText(ann, String(s.n), at, cv.FONT_HERSHEY_SIMPLEX, 1.1, new cv.Scalar(200, 0, 160), 3);
      delete s.contourIndex;
    }
    const toCanvas = (mat) => {
      const cvs = document.createElement('canvas');
      cv.imshow(cvs, mat);
      return cvs;
    };
    return {
      pageW: W,
      pageH: H,
      shapes,
      paperFound,
      canvases: { annotated: toCanvas(ann), clean: toCanvas(rgb), ink: toCanvas(ink) },
    };
  } finally {
    for (const m of mats) {
      try { m.delete(); } catch { /* already freed */ }
    }
  }
}
