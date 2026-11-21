// Pure shape maths for "draw your own bird" (plan P4). No OpenCV, no DOM.
//
// The game (fatgoat032) turns these into physics:
//   area       0-1  share of the page the bird covers  -> bigger = heavier
//   pointiness 0-1  0 = round blob, ~0.3 = triangle, 0.6+ = spiky star -> pointier = faster, smaller hitbox
//   polygon    points centred on (0,0), scaled so the farthest point is at radius 1;
//              multiply by the bird's radius to get a Matter.js vertex list (y down)

/** Shoelace area of a closed polygon. */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function polygonPerimeter(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return s;
}

/**
 * 1 - circularity, where circularity = 4πA / P² (1 for a circle).
 * Rescaled so a circle -> 0, a square -> ~0.15, a triangle -> ~0.35, a star -> 0.6+.
 */
export function pointiness(pts) {
  const A = polygonArea(pts);
  const P = polygonPerimeter(pts);
  if (!A || !P) return 0;
  const circularity = Math.min(1, (4 * Math.PI * A) / (P * P));
  return Math.round(Math.min(1, Math.max(0, 1 - circularity)) * 1000) / 1000;
}

/** Centre on the area centroid and scale so the farthest vertex is at radius 1. */
export function normalisePolygon(pts) {
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const c = p.x * q.y - q.x * p.y;
    a2 += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a2) < 1e-9) {
    cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  } else {
    cx /= 3 * a2;
    cy /= 3 * a2;
  }
  const rMax = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) || 1;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return pts.map((p) => ({ x: r3((p.x - cx) / rMax), y: r3((p.y - cy) / rMax) }));
}

/**
 * @param {Array<{x:number,y:number}>} outline  simplified outline in page pixels
 * @param {number} pageArea  page width × height in pixels
 */
export function birdFromOutline(outline, pageArea) {
  return {
    polygon: normalisePolygon(outline),
    area: Math.round((polygonArea(outline) / pageArea) * 10000) / 10000,
    pointiness: pointiness(outline),
  };
}
