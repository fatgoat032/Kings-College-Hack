// Overlay screens for Angry Sketches: the "CLEARED!" stamp, the end-of-turn
// index card, the winner page, sketchy buttons and the turn tag in the HUD.
// Everything draws in the 1600x900 world space (the caller sets the canvas
// transform). `t` is ms since the screen appeared; `rand` is an rng() from
// sketch.js that the caller re-seeds every ~110 ms so the lines "boil".
// No score numbers anywhere: results are blobs knocked out and shots used.
import { FONT, INK, PAPER, rng, wobblyLine, wobblyCircle, wobblyRect, markerText } from './sketch.js';

const W = 1600;
const H = 900;
const RED = '#e2483d';
const BLUE = '#2f78ad';
const GREEN = '#86cf63';
const GREEN_DARK = '#2f6b1f';
const YELLOW = '#f2c230';
const CARD = '#fffdf6';

const teamColor = (team) => (team === 'B' ? BLUE : RED);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutCubic = (p) => 1 - Math.pow(1 - clamp01(p), 3);
function easeOutBack(p, s = 1.70158) {
  const q = clamp01(p) - 1;
  return 1 + q * q * ((s + 1) * q + s);
}
const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;

function textWidth(ctx, text, size) {
  ctx.save();
  ctx.font = `${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

// Largest size <= `size` (and >= `min`) that fits `text` into `maxW`.
function fitSize(ctx, text, size, maxW, min = 10) {
  const w = textWidth(ctx, text, size);
  return w <= maxW ? size : Math.max(min, Math.floor((size * maxW) / w));
}

// Several coloured runs of marker text on one line. All the paper outlines go
// down first so a later run's outline never eats into an earlier run's ink.
function richText(ctx, parts, x, y, size, align = 'center', rot = 0) {
  ctx.save();
  ctx.font = `${size}px ${FONT}`;
  const widths = parts.map(([s]) => ctx.measureText(s).width);
  const total = widths.reduce((a, b) => a + b, 0);
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const x0 = align === 'center' ? -total / 2 : align === 'right' ? -total : 0;
  for (const pass of ['stroke', 'fill']) {
    let cx = x0;
    parts.forEach(([s, color], i) => {
      if (pass === 'stroke') {
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = size * 0.18;
        ctx.strokeText(s, cx, 0);
      } else {
        ctx.fillStyle = color;
        ctx.fillText(s, cx, 0);
      }
      cx += widths[i];
    });
  }
  ctx.restore();
  return total;
}

// A rectangle path (centred at the origin) with slightly jittered corners, for fills.
function roughRectPath(ctx, w, h, rand, j = 3, dx = 0, dy = 0) {
  const r = () => (rand() - 0.5) * j * 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + dx + r(), -h / 2 + dy + r());
  ctx.lineTo(w / 2 + dx + r(), -h / 2 + dy + r());
  ctx.lineTo(w / 2 + dx + r(), h / 2 + dy + r());
  ctx.lineTo(-w / 2 + dx + r(), h / 2 + dy + r());
  ctx.closePath();
}

// A pen circle around something: an ellipse that overshoots its start, drawn twice.
function wobblyEllipse(ctx, x, y, rx, ry, rand, amp = 4, overshoot = 0.45) {
  for (let pass = 0; pass < 2; pass++) {
    const start = -2.2 + rand() * 0.6;
    const n = 30;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * (Math.PI * 2 + overshoot);
      const k = 1 + (rand() - 0.5) * (amp / Math.max(rx, ry)) * 2 + (i / n) * 0.05;
      const px = x + Math.cos(a) * rx * k;
      const py = y + Math.sin(a) * ry * k;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

// A big circle with enough points to stay round (wobblyCircle is tuned for small ones).
function roughCircle(ctx, x, y, r, rand, amp = 4, n = 48) {
  for (let pass = 0; pass < 2; pass++) {
    const start = rand() * Math.PI * 2;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      const rr = r + (rand() - 0.5) * amp * 2;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
}

// Line drawn from (x1,y1) towards (x2,y2), only `p` (0..1) of the way.
function partialLine(ctx, x1, y1, x2, y2, p, rand, amp) {
  if (p <= 0) return;
  wobblyLine(ctx, x1, y1, x1 + (x2 - x1) * p, y1 + (y2 - y1) * p, rand, amp);
}

function wash(ctx, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(251, 247, 236, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---- little doodles ----

// The green doodle blob (same look as the game's targets), centred at x,y.
export function drawBlobDoodle(ctx, x, y, r, rand) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GREEN_DARK;
  ctx.lineWidth = Math.max(2.5, r * 0.08);
  wobblyCircle(ctx, 0, 0, r, rand, 1.8);
  ctx.lineWidth = Math.max(2, r * 0.06);
  wobblyLine(ctx, -r * 0.3, -r * 0.9, -r * 0.5, -r * 1.35, rand, 0.8);
  wobblyLine(ctx, r * 0.3, -r * 0.9, r * 0.5, -r * 1.35, rand, 0.8);
  ctx.fillStyle = GREEN_DARK;
  ctx.beginPath();
  ctx.arc(-r * 0.5, -r * 1.38, r * 0.12, 0, Math.PI * 2);
  ctx.arc(r * 0.5, -r * 1.38, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.15, r * 0.26, 0, Math.PI * 2);
  ctx.arc(r * 0.32, -r * 0.15, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  wobblyCircle(ctx, -r * 0.32, -r * 0.15, r * 0.26, rand, 0.6);
  wobblyCircle(ctx, r * 0.32, -r * 0.15, r * 0.26, rand, 0.6);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(-r * 0.36, -r * 0.12, r * 0.11, 0, Math.PI * 2);
  ctx.arc(r * 0.28, -r * 0.12, r * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GREEN_DARK;
  ctx.lineWidth = Math.max(2.2, r * 0.07);
  ctx.beginPath();
  ctx.arc(0, r * 0.25, r * 0.38, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// A crumpled paper-ball shot. `ghost` draws an empty dashed outline (unused shot).
function drawShotDoodle(ctx, x, y, r, rand, ghost = false, seed = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (ghost) {
    ctx.strokeStyle = 'rgba(43, 38, 34, 0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.fillStyle = CARD;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  wobblyCircle(ctx, 0, 0, r, rand, 1.8);
  const crease = rng(seed * 131 + 7);
  ctx.strokeStyle = 'rgba(43, 38, 34, 0.22)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 2; i++) {
    const a = crease() * Math.PI * 2;
    const b = a + 1 + crease() * 2;
    wobblyLine(ctx, Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, Math.cos(b) * r * 0.3, Math.sin(b) * r * 0.3, rand, 1);
  }
  // angry face, like the game's paper characters
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  wobblyLine(ctx, -r * 0.55, -r * 0.45, -r * 0.1, -r * 0.2, rand, 0.8);
  wobblyLine(ctx, r * 0.55, -r * 0.45, r * 0.1, -r * 0.2, rand, 0.8);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(-r * 0.3, 0, r * 0.1, 0, Math.PI * 2);
  ctx.arc(r * 0.3, 0, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  wobblyLine(ctx, -r * 0.3, r * 0.45, r * 0.3, r * 0.4, rand, 0.8);
  ctx.restore();
}

// Red marker X over something, drawn stroke by stroke as `p` goes 0..1.
function drawCrossOut(ctx, x, y, s, p, rand) {
  if (p <= 0) return;
  ctx.save();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  partialLine(ctx, x - s, y - s, x + s, y + s, clamp01(p * 2), rand, 2);
  partialLine(ctx, x + s, y - s, x - s, y + s, clamp01(p * 2 - 1), rand, 2);
  ctx.restore();
}

// A strip of masking tape, centred at x,y.
function drawTape(ctx, x, y, rot, w, h, rand) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const teeth = 5;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? -6 : 0), -h / 2 + (h * i) / teeth);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = 1; i <= teeth; i++) ctx.lineTo(-w / 2 + (i % 2 ? 6 : 0), h / 2 - (h * i) / teeth);
  ctx.closePath();
  ctx.fillStyle = 'rgba(234, 219, 160, 0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(140, 118, 60, 0.55)';
  ctx.lineWidth = 1.5;
  wobblyLine(ctx, -w / 2, -h / 2, w / 2, -h / 2, rand, 0.8);
  wobblyLine(ctx, -w / 2, h / 2, w / 2, h / 2, rand, 0.8);
  ctx.restore();
}

function drawCrown(ctx, x, y, s, rand) {
  const pts = [
    [-0.62, 0.35], [-0.62, -0.28], [-0.31, 0.04], [0, -0.42], [0.31, 0.04], [0.62, -0.28], [0.62, 0.35],
  ].map(([px, py]) => [x + px * s, y + py * s]);
  ctx.save();
  ctx.fillStyle = YELLOW;
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    wobblyLine(ctx, ax, ay, bx, by, rand, 1.5);
  }
  ctx.fillStyle = RED;
  for (const i of [1, 3, 5]) {
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], s * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 2;
  wobblyLine(ctx, x - s * 0.55, y + s * 0.2, x + s * 0.55, y + s * 0.2, rand, 1.2);
  ctx.restore();
}

function drawStar(ctx, x, y, r, rand, fill = null) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    wobblyLine(ctx, ax, ay, bx, by, rand, 0.9);
  }
}

// ---- 1. the "CLEARED!" stamp ----

let stampCanvas = null;
const STAMP_RES = 2; // offscreen resolution, so it stays crisp on big screens

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Renders the stamp (border, text and patchy ink) into an offscreen canvas.
function renderStamp(text, size, boxW, boxH, rand) {
  const pad = 40;
  const cw = Math.ceil((boxW + pad * 2) * STAMP_RES);
  const ch = Math.ceil((boxH + pad * 2) * STAMP_RES);
  if (!stampCanvas) stampCanvas = document.createElement('canvas');
  if (stampCanvas.width !== cw || stampCanvas.height !== ch) {
    stampCanvas.width = cw;
    stampCanvas.height = ch;
  }
  const s = stampCanvas.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.globalAlpha = 1;
  s.clearRect(0, 0, cw, ch);
  s.setTransform(STAMP_RES, 0, 0, STAMP_RES, cw / 2, ch / 2);

  s.strokeStyle = RED;
  s.lineCap = 'round';
  s.lineJoin = 'round';
  s.lineWidth = 13;
  wobblyRect(s, boxW, boxH, rand);
  s.lineWidth = 5;
  wobblyRect(s, boxW - 38, boxH - 38, rand);

  s.font = `${size}px ${FONT}`;
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  s.fillStyle = RED;
  s.fillText(text, 0, size * 0.04);

  // Uneven ink: darker pooled patches, then gaps where the stamp missed.
  const spot = rng(hashString(text));
  s.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 14; i++) {
    s.fillStyle = `rgba(150, 25, 20, ${0.12 + spot() * 0.18})`;
    s.beginPath();
    s.ellipse((spot() - 0.5) * boxW, (spot() - 0.5) * boxH, 40 + spot() * 120, 25 + spot() * 60, spot() * 3, 0, Math.PI * 2);
    s.fill();
  }
  s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 420; i++) {
    const r = 0.8 + Math.pow(spot(), 2.2) * 5.5;
    s.fillStyle = `rgba(0, 0, 0, ${0.55 + spot() * 0.45})`;
    s.beginPath();
    s.arc((spot() - 0.5) * (boxW + 20), (spot() - 0.5) * (boxH + 20), r, 0, Math.PI * 2);
    s.fill();
  }
  // dry streaks where the ink pad ran thin
  for (let i = 0; i < 7; i++) {
    const y = (spot() - 0.5) * boxH * 0.9;
    const x = (spot() - 0.5) * boxW * 0.6;
    const len = 120 + spot() * 260;
    s.strokeStyle = `rgba(0, 0, 0, ${0.25 + spot() * 0.3})`;
    s.lineWidth = 3 + spot() * 9;
    s.beginPath();
    s.moveTo(x - len / 2, y);
    s.lineTo(x + len / 2, y + (spot() - 0.5) * 16);
    s.stroke();
  }
  // one faded corner, like the stamp was pressed unevenly
  const g = s.createRadialGradient(boxW * 0.5, boxH * 0.5, 0, boxW * 0.5, boxH * 0.5, boxW * 0.32);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  s.fillStyle = g;
  s.fillRect(-boxW, -boxH, boxW * 2, boxH * 2);
  s.globalCompositeOperation = 'source-over';
  return { canvas: stampCanvas, cw, ch };
}

export function drawStamp(ctx, text, t, rand) {
  const SLAM = 180;
  const cx = W / 2;
  const cy = H / 2 - 20;
  const size = fitSize(ctx, text, 160, 1150, 60);
  const boxW = textWidth(ctx, text, size) + 130;
  const boxH = size * 1.55;
  const ROT = (-8 * Math.PI) / 180;

  let scale;
  let alpha;
  let rot = ROT;
  if (t < SLAM) {
    const p = clamp01(t / SLAM);
    scale = 2.5 - (2.5 - 0.9) * p * p; // accelerates into the paper
    alpha = 0.3 + 0.7 * p;
    rot = ROT - 0.12 * (1 - p);
  } else {
    const q = clamp01((t - SLAM) / 220);
    scale = 1 - 0.1 * (1 - q) * Math.cos(q * Math.PI * 2.5); // squash, rebound, settle
    alpha = 1;
  }
  const tt = t - SLAM; // ms since impact (negative while falling)

  // Shadow on the paper, sharpening as the stamp comes down.
  if (tt < 0) {
    const p = clamp01(t / SLAM);
    ctx.save();
    ctx.translate(cx + 14, cy + 18);
    ctx.rotate(ROT);
    ctx.fillStyle = `rgba(43, 38, 34, ${0.03 + 0.1 * p})`;
    roughRectPath(ctx, boxW * (1.25 - 0.25 * p), boxH * (1.25 - 0.25 * p), rand, 4);
    ctx.fill();
    ctx.restore();
  }

  // Impact: quick paper flash, a ring of ink and a few speed lines.
  if (tt >= 0 && tt < 520) {
    const k = tt / 520;
    if (tt < 140) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * (1 - tt / 140)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    ctx.save();
    const ringR = boxW * 0.5 + easeOutCubic(k) * 260;
    ctx.strokeStyle = `rgba(226, 72, 61, ${0.75 * (1 - k)})`;
    ctx.lineWidth = 14 * (1 - k) + 2;
    roughCircle(ctx, cx, cy, ringR, rand, 5);
    ctx.strokeStyle = `rgba(43, 38, 34, ${0.5 * (1 - k)})`;
    ctx.lineWidth = 4;
    roughCircle(ctx, cx, cy, ringR * 0.88, rand, 4);
    ctx.lineCap = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = `rgba(43, 38, 34, ${0.85 * (1 - k)})`;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      const r1 = Math.max(boxW * 0.55 * Math.abs(Math.cos(a)), boxH * 0.75 * Math.abs(Math.sin(a))) + 20 + k * 140;
      const ex = Math.cos(a);
      const ey = Math.sin(a);
      wobblyLine(ctx, cx + ex * r1, cy + ey * r1, cx + ex * (r1 + 70 * (1 - k) + 10), cy + ey * (r1 + 70 * (1 - k) + 10), rand, 2);
    }
    ctx.restore();
  }

  const shake = tt >= 0 && tt < 180 ? 1 - tt / 180 : 0;
  const { canvas, cw, ch } = renderStamp(text, size, boxW, boxH, rand);
  ctx.save();
  ctx.globalAlpha = alpha * 0.93;
  ctx.translate(cx + Math.sin(t * 0.9) * 10 * shake, cy + Math.cos(t * 1.3) * 8 * shake);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.drawImage(canvas, -cw / STAMP_RES / 2, -ch / STAMP_RES / 2, cw / STAMP_RES, ch / STAMP_RES);
  ctx.restore();
}

// ---- 2. end-of-turn index card ----

export function drawTurnSummary(ctx, { team = 'A', blobs = 0, blobsTotal = 0, birds = 0, birdsTotal = 0 } = {}, t, rand) {
  const color = teamColor(team);
  wash(ctx, 0.6 * clamp01(t / 250));

  const cw = 1060;
  const ch = 640;
  const enter = easeOutBack(t / 520, 1.2);
  const y = H / 2 + 10 + (1 - enter) * 760;
  const rot = 0.1 * (1 - easeOutCubic(t / 600)) - 0.015;

  ctx.save();
  ctx.translate(W / 2, y);
  ctx.rotate(rot);

  // the card: shadow, paper, ruled lines, outline
  ctx.fillStyle = 'rgba(43, 38, 34, 0.18)';
  roughRectPath(ctx, cw, ch, rand, 3, 16, 18);
  ctx.fill();
  ctx.fillStyle = CARD;
  roughRectPath(ctx, cw, ch, rand, 2);
  ctx.fill();
  const top = -ch / 2;
  ctx.strokeStyle = 'rgba(120, 165, 210, 0.45)';
  ctx.lineWidth = 2;
  for (let ly = top + 214; ly < ch / 2 - 20; ly += 56) {
    ctx.beginPath();
    ctx.moveTo(-cw / 2 + 8, ly);
    ctx.lineTo(cw / 2 - 8, ly);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(226, 72, 61, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-cw / 2 + 8, top + 158);
  ctx.lineTo(cw / 2 - 8, top + 158);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  wobblyRect(ctx, cw, ch, rand);

  drawTape(ctx, -cw / 2 + 30, top + 6, -0.62, 170, 50, rand);
  drawTape(ctx, cw / 2 - 30, top + 6, 0.62, 170, 50, rand);

  // heading
  const heading = `TEAM ${team}'s TURN`;
  const hs = fitSize(ctx, heading, 108, cw - 140, 60);
  markerText(ctx, heading, 0, top + 88, hs, color, 'center', -0.02);

  // reveal timings
  const line1At = 280;
  const blobsAt = 380;
  const crossAt = 700;
  const crossEach = 170;
  const line2At = crossAt + Math.max(1, blobs) * crossEach + 120;
  const pop = (at, dur = 260) => easeOutBack((t - at) / dur, 2.2);

  // line 1: knocked out N of M blobs, with blob doodles crossed out
  const s1 = pop(line1At);
  if (s1 > 0) {
    ctx.save();
    ctx.translate(0, top + 222);
    ctx.scale(s1, s1);
    richText(ctx, [['knocked out ', INK], [`${blobs} of ${blobsTotal}`, GREEN_DARK], [` ${plural(blobsTotal, 'blob')}`, INK]], 0, 0, 66);
    ctx.restore();
  }
  const n = Math.max(0, blobsTotal);
  const gap = n ? Math.min(124, 900 / n) : 0;
  const br = Math.min(40, gap * 0.34);
  for (let i = 0; i < n; i++) {
    const bs = pop(blobsAt + i * 70, 240);
    if (bs <= 0) continue;
    const bx = (i - (n - 1) / 2) * gap;
    const by = top + 340;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(bs, bs);
    if (i < blobs) ctx.globalAlpha = 1 - 0.45 * clamp01((t - crossAt - i * crossEach) / crossEach);
    drawBlobDoodle(ctx, 0, 0, br, rand);
    ctx.restore();
    if (i < blobs) drawCrossOut(ctx, bx, by - br * 0.2, br * 1.05, (t - crossAt - i * crossEach) / crossEach, rand);
  }

  // line 2: used N of M shots, with paper-ball doodles
  const s2 = pop(line2At);
  if (s2 > 0) {
    ctx.save();
    ctx.translate(0, top + 462);
    ctx.scale(s2, s2);
    richText(ctx, [['used ', INK], [`${birds} of ${birdsTotal}`, color], [` ${plural(birdsTotal, 'shot')}`, INK]], 0, 0, 66);
    ctx.restore();
  }
  const m = Math.max(0, birdsTotal);
  const sg = m ? Math.min(92, 700 / m) : 0;
  for (let i = 0; i < m; i++) {
    const ss = pop(line2At + 120 + i * 70, 220);
    if (ss <= 0) continue;
    ctx.save();
    ctx.translate((i - (m - 1) / 2) * sg, top + 560);
    ctx.scale(ss, ss);
    drawShotDoodle(ctx, 0, 0, Math.min(31, sg * 0.36), rand, i >= birds, i + 1);
    ctx.restore();
  }
  ctx.restore();
}

// ---- 3. winner page ----

const CONFETTI_COLORS = [RED, BLUE, '#4f9a2f', YELLOW];
const CONFETTI_COUNT = 70;

function drawConfetti(ctx, t, rand) {
  const ts0 = t / 1000;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const R = rng(7919 * (i + 1));
    const x0 = R() * W;
    const speed = 120 + R() * 160;
    const delay = R() * 1.8;
    const sway = 18 + R() * 40;
    const swayF = 1 + R() * 2.2;
    const spin = (R() - 0.5) * 7;
    const kind = Math.floor(R() * 4);
    const color = CONFETTI_COLORS[Math.floor(R() * CONFETTI_COLORS.length)];
    const size = 13 + R() * 13;
    const ts = ts0 - delay;
    if (ts < 0) continue;
    const y = ((ts * speed) % (H + 120)) - 60;
    const x = x0 + Math.sin(ts * swayF + i) * sway;
    const a = ts * spin + i;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (kind === 0) {
      // squiggle
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let k = 0; k <= 12; k++) {
        const px = -size + (k / 12) * size * 2;
        const py = Math.sin((k / 12) * Math.PI * 3 + ts * 4) * size * 0.3;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else if (kind === 1) {
      ctx.lineWidth = 3;
      drawStar(ctx, 0, 0, size * 0.8, rand, color === YELLOW ? YELLOW : null);
    } else if (kind === 2) {
      // paper scrap fluttering (squashed to fake a 3D flip)
      ctx.scale(1, 0.25 + 0.75 * Math.abs(Math.cos(ts * 3 + i)));
      ctx.fillRect(-size * 0.6, -size * 0.4, size * 1.2, size * 0.8);
      ctx.strokeStyle = 'rgba(43, 38, 34, 0.6)';
      ctx.lineWidth = 1.5;
      wobblyRect(ctx, size * 1.2, size * 0.8, rand);
    } else {
      ctx.lineWidth = 3.5;
      wobblyCircle(ctx, 0, 0, size * 0.4, rand, 1.2);
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawWinner(ctx, { winner = null, blobs = {}, birds = {} } = {}, t, rand, { hover = false } = {}) {
  wash(ctx, 0.9 * clamp01(t / 300));
  drawConfetti(ctx, t, rand);

  // title
  const isTie = winner !== 'A' && winner !== 'B';
  const title = isTie ? "IT'S A TIE!" : `TEAM ${winner} WINS!`;
  const color = isTie ? INK : teamColor(winner);
  const ts = fitSize(ctx, title, 164, 1380, 80);
  const tw = textWidth(ctx, title, ts);
  const pop = easeOutBack(t / 480, 2);
  const bob = Math.sin(t / 260) * 0.015;
  if (pop > 0) {
    ctx.save();
    ctx.translate(W / 2, 222);
    ctx.scale(pop * (1 + bob), pop * (1 + bob));
    if (!isTie) drawCrown(ctx, 0, -138, 120, rand);
    else {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;
      drawStar(ctx, -tw / 2 - 40, -40, 34, rand, YELLOW);
      drawStar(ctx, tw / 2 + 40, -40, 34, rand, YELLOW);
    }
    if (isTie) richText(ctx, [["IT'S A ", RED], ['TIE!', BLUE]], 0, 0, ts, 'center', -0.035);
    else markerText(ctx, title, 0, 0, ts, color, 'center', -0.035);
    ctx.restore();
  }
  // underline scribble(s), drawn in once the title lands
  const ul = easeOutCubic((t - 350) / 450);
  if (ul > 0) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    const half = tw * 0.42;
    ctx.strokeStyle = isTie ? RED : color;
    partialLine(ctx, W / 2 - half, 318, W / 2 + half, 306, ul, rand, 3);
    ctx.strokeStyle = isTie ? BLUE : color;
    ctx.lineWidth = isTie ? 9 : 5;
    partialLine(ctx, W / 2 - half * 0.8, 336, W / 2 + half * 0.9, 326, ul, rand, 3);
    ctx.restore();
  }

  // the two teams side by side: blobs knocked out, shots used
  const cmp = easeOutCubic((t - 450) / 400);
  if (cmp > 0) {
    ctx.save();
    ctx.globalAlpha = cmp;
    ctx.translate(0, (1 - cmp) * 40);
    for (const team of ['A', 'B']) {
      const x = team === 'A' ? 450 : 1150;
      const b = blobs[team] ?? 0;
      const used = birds[team] ?? 0;
      markerText(ctx, `TEAM ${team}`, x, 420, 70, teamColor(team), 'center', -0.02);
      const line = `${b} ${plural(b, 'blob')}`;
      const lw = textWidth(ctx, line, 64);
      drawBlobDoodle(ctx, x - lw / 2 - 42, 512, 26, rand);
      richText(ctx, [[`${b}`, GREEN_DARK], [` ${plural(b, 'blob')}`, INK]], x + 20, 506, 64);
      markerText(ctx, `with ${used} ${plural(used, 'shot')}`, x, 584, 46, INK, 'center');
      if (team === winner) {
        ctx.strokeStyle = teamColor(team);
        ctx.lineWidth = 6;
        wobblyEllipse(ctx, x, 505, 292, 150, rand, 5);
      }
    }
    markerText(ctx, 'vs', W / 2, 505, 72, INK, 'center', -0.05);
    ctx.restore();
  }

  // play again button
  const rect = { x: W / 2 - 260, y: 690, w: 520, h: 130 };
  const bp = easeOutBack((t - 800) / 380, 2);
  if (bp > 0) {
    ctx.save();
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale(bp, bp);
    ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
    drawSketchButton(ctx, rect, 'Play again', rand, { hover });
    ctx.restore();
  }
  return rect;
}

// ---- 4. hand-drawn button ----

export function drawSketchButton(ctx, rect, label, rand, { hover = false } = {}) {
  const { x, y, w, h } = rect;
  const press = hover ? 5 : 0;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  // ink shadow, offset down-right
  ctx.fillStyle = 'rgba(43, 38, 34, 0.85)';
  roughRectPath(ctx, w, h, rand, 2.5, 11, 13);
  ctx.fill();
  ctx.translate(press, press);
  ctx.fillStyle = hover ? '#fff0a0' : CARD;
  roughRectPath(ctx, w, h, rand, 2);
  ctx.fill();
  // a bit of pencil hatching in the corner
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(43, 38, 34, 0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const ox = w / 2 - 14 - i * 14;
    wobblyLine(ctx, ox, h / 2, ox + 28, h / 2 - 28, rand, 0.8);
  }
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4.5;
  ctx.lineJoin = 'round';
  wobblyRect(ctx, w, h, rand);
  const size = Math.max(48, Math.min(h * 0.5, fitSize(ctx, label, 96, w - 50, 48)));
  markerText(ctx, label, 0, 3, size, INK, 'center', -0.01);
  ctx.restore();
}

// ---- 5. hit test ----

export function hitRect(rect, x, y) {
  return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// ---- 6. turn tag in the HUD ----

export function drawTurnBanner(ctx, { team = 'A', label } = {}, rand) {
  const text = label || `TEAM ${team} FLINGING`;
  const color = teamColor(team);
  const size = 46;
  const tw = textWidth(ctx, text, size);
  const w = tw + 128;
  const h = 82;
  const notch = 38;
  const pts = [
    [-w / 2 + notch, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2 + notch, h / 2], [-w / 2, 0],
  ];
  ctx.save();
  ctx.translate(W / 2, 58);
  ctx.rotate(-0.018);
  const path = (dx, dy) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const jx = px + dx + (rand() - 0.5) * 3;
      const jy = py + dy + (rand() - 0.5) * 3;
      if (i) ctx.lineTo(jx, jy);
      else ctx.moveTo(jx, jy);
    });
    ctx.closePath();
  };
  ctx.fillStyle = 'rgba(43, 38, 34, 0.22)';
  path(7, 8);
  ctx.fill();
  ctx.fillStyle = team === 'B' ? '#e3eff8' : '#fce6e2';
  path(0, 0);
  ctx.fill();
  // string from the hole, off the top of the screen
  const hx = -w / 2 + notch + 6;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  wobblyLine(ctx, hx, 0, hx - 46, -h / 2 - 40, rand, 2);
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    wobblyLine(ctx, ax, ay, bx, by, rand, 1.4);
  }
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(hx, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  wobblyCircle(ctx, hx, 0, 10, rand, 0.8);
  markerText(ctx, text, notch / 2 + 10, 3, size, color, 'center');
  ctx.restore();
}
