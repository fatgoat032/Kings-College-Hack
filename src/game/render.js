// Hand-drawn "sketchbook" renderer. Every shape is drawn with slightly wobbly
// double strokes, and the wobble re-rolls a few times a second (line "boil"),
// so the whole screen looks like an animated pencil drawing.
import { WORLD, BIRD, TIMING } from './config.js';
import * as screens from './screens.js';

import { FONT, INK, PAPER, rng, wobblyLine, wobblyCircle, wobblyRect, markerText as markerTextOn } from './sketch.js';

const STYLE = {
  wood: { fill: '#e9c991', stroke: '#4a3220', hatch: '#a4723f' },
  ice: { fill: 'rgba(176, 221, 245, 0.75)', stroke: '#2f78ad', hatch: '#ffffff' },
  stone: { fill: '#bfbcb6', stroke: '#45423e', hatch: '#7d7a74' },
  tnt: { fill: '#e2483d', stroke: '#6e1410', hatch: '#9e2219' },
};

// Bundled locally (public/assets/fonts, Apache 2.0) so it works without venue Wi-Fi.
function loadFont() {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  new FontFace('Permanent Marker', 'url(/assets/fonts/PermanentMarker-Regular.ttf)')
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => {});
}

export function createRenderer(canvas, world, hooks = {}) {
  loadFont();
  const ctx = canvas.getContext('2d');
  // base: fits the whole 1600x900 world in the canvas. cam: where we look and how close.
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1, cw: 1, ch: 1 };
  const cam = { x: WORLD.w / 2, y: WORLD.h / 2, zoom: 1 };
  let shake = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    view.dpr = dpr;
    view.cw = cw;
    view.ch = ch;
    view.scale = Math.min(cw / WORLD.w, ch / WORLD.h);
    view.ox = (cw - WORLD.w * view.scale) / 2;
    view.oy = (ch - WORLD.h * view.scale) / 2;
  }

  // Screen-space transform: the fixed 1600x900 frame (HUD, overlays).
  function screenTransform() {
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
  }
  // World transform: the camera, plus screen shake.
  function worldTransform() {
    const s = view.scale * cam.zoom;
    const sx = (Math.random() - 0.5) * shake * view.scale;
    const sy = (Math.random() - 0.5) * shake * view.scale;
    ctx.setTransform(s, 0, 0, s, view.cw / 2 - cam.x * s + sx, view.ch / 2 - cam.y * s + sy);
  }

  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const s = view.scale * cam.zoom;
    return {
      x: ((clientX - r.left) * view.dpr - view.cw / 2) / s + cam.x,
      y: ((clientY - r.top) * view.dpr - view.ch / 2) / s + cam.y,
    };
  }
  function toScreen(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) * view.dpr - view.ox) / view.scale,
      y: ((clientY - r.top) * view.dpr - view.oy) / view.scale,
    };
  }

  // ---- camera targets ----
  function fitTarget() {
    let x1 = WORLD.sling.x - 130, x2 = WORLD.sling.x + 120, y1 = WORLD.sling.y - 120;
    const y2 = WORLD.groundY + 40;
    for (const b of world.blocks.values()) {
      const p = b.body.position;
      const e = Math.max(b.w, b.h) / 2;
      x1 = Math.min(x1, p.x - e); x2 = Math.max(x2, p.x + e); y1 = Math.min(y1, p.y - e);
    }
    for (const pg of world.pigs.values()) {
      const p = pg.body.position;
      x2 = Math.max(x2, p.x + pg.r); y1 = Math.min(y1, p.y - pg.r * 1.5);
    }
    x1 -= 50; x2 += 60; y1 -= 110;
    const zoom = Math.max(1, Math.min(1.7, WORLD.w / (x2 - x1), WORLD.h / (y2 - y1)));
    return clampCam({ x: (x1 + x2) / 2, y: y2 - WORLD.h / zoom / 2, zoom });
  }
  function clampCam(t) {
    const hw = WORLD.w / t.zoom / 2;
    const hh = WORLD.h / t.zoom / 2;
    t.x = Math.max(hw, Math.min(WORLD.w - hw, t.x));
    t.y = Math.min(WORLD.groundY + 50 - hh, Math.max(hh - 200, t.y));
    return t;
  }
  let hold = null; // { x, y, until } camera holds on an impact
  world.on('birdHit', ({ x, y, force }) => {
    hold = { x, y, until: performance.now() + 900 };
    shake = Math.max(shake, 6 + force * 14);
  });
  world.on('impact', ({ force }) => { shake = Math.max(shake, force * 10); });
  world.on('explode', () => { shake = Math.max(shake, 26); });
  world.on('collapse', () => { shake = Math.max(shake, 14); });
  world.on('launch', () => { hold = null; });

  function updateCamera(now) {
    const fit = fitTarget();
    let t = fit;
    let k = 0.06;
    if (seq.stage === 'killcam' && world.lastKill) {
      t = clampCam({ x: world.lastKill.x, y: world.lastKill.y - 40, zoom: 2.3 });
      k = 0.12;
    } else if (seq.stage) {
      t = fit;
    } else if (hold && now < hold.until) {
      const z = fit.zoom * 1.25;
      t = clampCam({ x: hold.x, y: Math.max(hold.y - 60, WORLD.groundY + 40 - WORLD.h / z / 2), zoom: z });
      k = 0.1;
    } else if (world.phase === 'flying' && world.bird) {
      const b = world.bird.body.position;
      t = clampCam({ x: b.x + 120, y: Math.min(b.y, fit.y), zoom: fit.zoom * 1.12 });
      k = 0.12;
    }
    cam.x += (t.x - cam.x) * k;
    cam.y += (t.y - cam.y) * k;
    cam.zoom += (t.zoom - cam.zoom) * k;
    shake *= 0.86;
    if (shake < 0.3) shake = 0;
  }

  // ---- background ----
  function drawPaper(rand) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.strokeStyle = 'rgba(120, 165, 210, 0.28)';
    ctx.lineWidth = 1.5;
    for (let y = 70; y < WORLD.groundY; y += 38) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(225, 110, 110, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(110, 0);
    ctx.lineTo(110, WORLD.h);
    ctx.stroke();

    // ground: pencil line plus hatching
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    wobblyLine(ctx, -20, WORLD.groundY, WORLD.w + 20, WORLD.groundY, rand, 2);
    ctx.strokeStyle = 'rgba(43, 38, 34, 0.35)';
    ctx.lineWidth = 1.5;
    for (let x = -40; x < WORLD.w + 40; x += 22) {
      wobblyLine(ctx, x, WORLD.groundY + 8, x + 30, WORLD.h, rand, 1);
    }
    // grass scribbles
    ctx.strokeStyle = '#5c9a45';
    ctx.lineWidth = 2;
    for (let x = 0; x < WORLD.w; x += 47) {
      const h = 6 + ((x * 7) % 9);
      wobblyLine(ctx, x, WORLD.groundY, x - 4, WORLD.groundY - h, rand, 0.8);
      wobblyLine(ctx, x + 6, WORLD.groundY, x + 9, WORLD.groundY - h + 2, rand, 0.8);
    }
  }

  // ---- slingshot ----
  const fork = {
    back: { x: WORLD.sling.x - 22, y: WORLD.sling.y - 18 },
    front: { x: WORLD.sling.x + 22, y: WORLD.sling.y - 18 },
  };

  function pulledPos() {
    const { angle, power } = world.aimState;
    const d = power * BIRD.pullBack;
    return { x: WORLD.sling.x - Math.cos(angle) * d, y: WORLD.sling.y - Math.sin(angle) * d };
  }

  function drawSlingBack(rand) {
    ctx.strokeStyle = '#5a3a22';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    wobblyLine(ctx, WORLD.sling.x, WORLD.groundY, WORLD.sling.x, WORLD.sling.y + 30, rand, 1);
    wobblyLine(ctx, WORLD.sling.x, WORLD.sling.y + 30, fork.back.x, fork.back.y, rand, 1);
  }

  function drawSlingFront(rand) {
    ctx.strokeStyle = '#5a3a22';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    wobblyLine(ctx, WORLD.sling.x, WORLD.sling.y + 30, fork.front.x, fork.front.y, rand, 1);
  }

  function drawBand(from, to) {
    ctx.strokeStyle = '#3a2416';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  // ---- characters ----
  // The shot: a crumpled ball of angry paper.
  function drawPaperBall(x, y, r, rot, rand, seed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = '#fffdf6';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    wobblyCircle(ctx, 0, 0, r, rand, 2);
    // crumple creases (fixed per ball so they don't boil too much)
    const crease = rng(seed);
    ctx.strokeStyle = 'rgba(43, 38, 34, 0.45)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      const a = crease() * Math.PI * 2;
      const b = a + 1 + crease() * 2;
      wobblyLine(ctx, Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, Math.cos(b) * r * 0.3, Math.sin(b) * r * 0.3, rand, 1);
    }
    ctx.restore();
    // face stays upright
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    wobblyLine(ctx, x - r * 0.55, y - r * 0.45, x - r * 0.1, y - r * 0.2, rand, 0.8);
    wobblyLine(ctx, x + r * 0.55, y - r * 0.45, x + r * 0.1, y - r * 0.2, rand, 0.8);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y, r * 0.1, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    wobblyLine(ctx, x - r * 0.3, y + r * 0.45, x + r * 0.3, y + r * 0.4, rand, 0.8);
  }

  function drawFace(x, y, r, rand) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    wobblyLine(ctx, x - r * 0.55, y - r * 0.45, x - r * 0.1, y - r * 0.2, rand, 0.8);
    wobblyLine(ctx, x + r * 0.55, y - r * 0.45, x + r * 0.1, y - r * 0.2, rand, 0.8);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y, r * 0.1, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dart: a folded paper aeroplane pointing where it's flying.
  function drawDart(x, y, r, heading, rand) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    const nose = { x: r * 1.7, y: 0 };
    const top = { x: -r * 1.1, y: -r * 0.9 };
    const bot = { x: -r * 1.1, y: r * 0.9 };
    const fold = { x: -r * 0.7, y: 0 };
    ctx.fillStyle = '#fffdf6';
    ctx.beginPath();
    ctx.moveTo(nose.x, nose.y);
    ctx.lineTo(top.x, top.y);
    ctx.lineTo(fold.x, fold.y);
    ctx.lineTo(bot.x, bot.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(43, 38, 34, 0.12)';
    ctx.beginPath();
    ctx.moveTo(nose.x, nose.y);
    ctx.lineTo(fold.x, fold.y);
    ctx.lineTo(bot.x, bot.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    wobblyLine(ctx, nose.x, nose.y, top.x, top.y, rand, 1);
    wobblyLine(ctx, top.x, top.y, fold.x, fold.y, rand, 1);
    wobblyLine(ctx, fold.x, fold.y, bot.x, bot.y, rand, 1);
    wobblyLine(ctx, bot.x, bot.y, nose.x, nose.y, rand, 1);
    ctx.lineWidth = 1.6;
    wobblyLine(ctx, nose.x, nose.y, fold.x, fold.y, rand, 0.6);
    // one squinting angry eye
    ctx.lineWidth = 2.6;
    wobblyLine(ctx, r * 0.15, -r * 0.5, r * 0.65, -r * 0.3, rand, 0.6);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(r * 0.45, -r * 0.12, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Puff: a brown paper bag that inflates when its ability fires.
  function drawPuff(x, y, r, rot, rand) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot * 0.5);
    ctx.fillStyle = '#d8b47a';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.05, r * 1.0, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5b3f1f';
    ctx.lineWidth = 2.6;
    wobblyCircle(ctx, 0, r * 0.05, r, rand, 1.8);
    // scrunched top
    ctx.lineWidth = 2.2;
    for (let i = -2; i <= 2; i++) {
      wobblyLine(ctx, i * r * 0.22, -r * 0.85, i * r * 0.28, -r * 1.25, rand, 0.8);
    }
    wobblyLine(ctx, -r * 0.5, -r * 0.82, r * 0.5, -r * 0.82, rand, 1);
    ctx.restore();
    drawFace(x, y, r * 0.9, rand);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.55, r * 0.18, 0, Math.PI * 2); // "o" mouth, holding its breath
    ctx.stroke();
  }

  // Boomer: a folded paper boomerang that spins.
  function drawBoomer(x, y, r, rot, rand) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = INK;
    ctx.fillStyle = '#fffdf6';
    const arm = (sign) => {
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, 0);
      ctx.lineTo(sign * r * 1.3, -r * 0.9);
      ctx.lineTo(sign * r * 1.5, -r * 0.45);
      ctx.lineTo(r * 0.25, r * 0.45);
      ctx.closePath();
      ctx.fill();
    };
    arm(1);
    arm(-1);
    ctx.lineWidth = 2.4;
    wobblyLine(ctx, -r * 0.2, 0, r * 1.3, -r * 0.9, rand, 1);
    wobblyLine(ctx, r * 1.3, -r * 0.9, r * 1.5, -r * 0.45, rand, 1);
    wobblyLine(ctx, r * 1.5, -r * 0.45, r * 0.25, r * 0.45, rand, 1);
    wobblyLine(ctx, -r * 0.2, 0, -r * 1.3, -r * 0.9, rand, 1);
    wobblyLine(ctx, -r * 1.3, -r * 0.9, -r * 1.5, -r * 0.45, rand, 1);
    wobblyLine(ctx, -r * 1.5, -r * 0.45, r * 0.25, r * 0.45, rand, 1);
    ctx.restore();
    drawFace(x, y - r * 0.1, r * 0.6, rand);
  }

  function drawShot(kind, x, y, r, rot, heading, rand) {
    if (kind === 'dart') drawDart(x, y, r, heading, rand);
    else if (kind === 'puff') drawPuff(x, y, r, rot, rand);
    else if (kind === 'boomer') drawBoomer(x, y, r, rot, rand);
    else drawPaperBall(x, y, r, rot, rand, 7);
  }

  // The targets: smug green doodle blobs, with moods.
  // p: { x, y, r, angle, k, hurt }, mood: { look, nervous, taunt, relief, asleep }
  function drawBlob(p, rand, mood, now) {
    let { x, y } = p;
    const r = p.r;
    let sx = 1, sy = 1;
    if (mood.nervous > 0) x += Math.sin(now / 25 + p.k) * mood.nervous * 2.2;
    if (mood.taunt > 0) {
      const b = Math.abs(Math.sin(now / 110 + p.k));
      y -= b * 10 * mood.taunt;
      sy = 1 + b * 0.08; sx = 1 - b * 0.05;
    }
    if (mood.relief > 0) {
      const wv = Math.sin(now / 70 + p.k) * 0.09 * mood.relief;
      sx = 1 + wv; sy = 1 - wv;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.angle * 0.3);
    ctx.scale(sx, sy);
    ctx.fillStyle = p.hurt ? '#a6d98a' : '#86cf63';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2f6b1f';
    ctx.lineWidth = 2.6;
    wobblyCircle(ctx, 0, 0, r, rand, 1.8);
    // antennae
    ctx.lineWidth = 2;
    wobblyLine(ctx, -r * 0.3, -r * 0.9, -r * 0.5, -r * 1.35, rand, 0.8);
    wobblyLine(ctx, r * 0.3, -r * 0.9, r * 0.5, -r * 1.35, rand, 0.8);
    ctx.fillStyle = '#2f6b1f';
    ctx.beginPath();
    ctx.arc(-r * 0.5, -r * 1.38, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.5, -r * 1.38, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const ex = r * 0.32, ey = y - r * 0.15, er = r * 0.27;
    if (mood.asleep) {
      // closed eyes until the drawing comes alive
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      wobblyLine(ctx, x - ex - er * 0.8, ey, x - ex + er * 0.8, ey, rand, 0.5);
      wobblyLine(ctx, x + ex - er * 0.8, ey, x + ex + er * 0.8, ey, rand, 0.5);
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - ex, ey, er, 0, Math.PI * 2);
      ctx.arc(x + ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      wobblyCircle(ctx, x - ex, ey, er, rand, 0.6);
      wobblyCircle(ctx, x + ex, ey, er, rand, 0.6);
      // pupils follow whatever they're scared of
      const dx = mood.look.x - x, dy = mood.look.y - ey;
      const d = Math.hypot(dx, dy) || 1;
      const px = (dx / d) * er * 0.45, py = (dy / d) * er * 0.45;
      const pr = mood.nervous > 0.5 ? er * 0.3 : er * 0.42;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x - ex + px, ey + py, pr, 0, Math.PI * 2);
      ctx.arc(x + ex + px, ey + py, pr, 0, Math.PI * 2);
      ctx.fill();
      if (mood.nervous > 0.3 || p.hurt) {
        ctx.lineWidth = 2.2;
        wobblyLine(ctx, x - ex - er, ey - er * 1.25, x - ex + er * 0.6, ey - er * 1.6, rand, 0.5);
        wobblyLine(ctx, x + ex + er, ey - er * 1.25, x + ex - er * 0.6, ey - er * 1.6, rand, 0.5);
      }
    }
    // mouth
    ctx.strokeStyle = '#2f6b1f';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    if (mood.taunt > 0) {
      ctx.fillStyle = '#2f6b1f';
      ctx.ellipse(x, y + r * 0.38, r * 0.32, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (mood.nervous > 0.4 || p.hurt) {
      ctx.moveTo(x - r * 0.3, y + r * 0.42);
      for (let i = 1; i <= 6; i++) ctx.lineTo(x - r * 0.3 + i * r * 0.1, y + r * 0.42 + (i % 2 ? -3 : 3));
      ctx.stroke();
    } else {
      ctx.arc(x, y + r * 0.25, r * 0.38, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    if (mood.nervous > 0.6) {
      ctx.fillStyle = '#7cc3ee';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.95, y - r * 0.35, r * 0.11, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // block is a scene entry: { k, material, w, h, x, y, angle, cracked, src }
  function drawBlock(block, rand, lift = 1) {
    const s = STYLE[block.material];
    const { w, h, angle } = block;
    ctx.save();
    ctx.translate(block.x, block.y - (1 - lift) * 40);
    ctx.rotate(angle);
    if (lift < 1) {
      const sc = 1 + (1 - lift) * 0.35;
      ctx.scale(sc, sc);
      ctx.globalAlpha = lift;
    }
    ctx.fillStyle = s.fill;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    drawTexture(block, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    ctx.strokeStyle = s.hatch;
    ctx.lineWidth = 1.4;
    if (block.material === 'wood') {
      // grain along the long side
      const along = w >= h;
      const span = along ? h : w;
      for (let i = 1; i < span / 6; i++) {
        const o = -span / 2 + i * 6;
        if (along) wobblyLine(ctx, -w / 2, o, w / 2, o + (rand() - 0.5) * 3, rand, 0.7);
        else wobblyLine(ctx, o, -h / 2, o + (rand() - 0.5) * 3, h / 2, rand, 0.7);
      }
    } else if (block.material === 'ice') {
      ctx.lineWidth = 2;
      for (let i = -w - h; i < w + h; i += 26) wobblyLine(ctx, i, -h / 2, i + h * 0.6, h / 2, rand, 0.6);
    } else if (block.material === 'stone') {
      for (let i = -w - h; i < w + h; i += 9) {
        wobblyLine(ctx, i, -h / 2, i + h, h / 2, rand, 0.5);
        wobblyLine(ctx, i + h, -h / 2, i, h / 2, rand, 0.5);
      }
    }
    ctx.restore();

    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = 2.6;
    wobblyRect(ctx, w, h, rand);

    if (block.cracked) {
      // zigzag crack, fixed per block
      const cr = rng(block.k * 977);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      const long = w >= h;
      ctx.beginPath();
      let cx = long ? -w * 0.1 : -w / 2, cy = long ? -h / 2 : -h * 0.1;
      ctx.moveTo(cx, cy);
      for (let i = 0; i < 5; i++) {
        if (long) { cx += (cr() - 0.5) * w * 0.15; cy += h / 5; }
        else { cx += w / 5; cy += (cr() - 0.5) * h * 0.15; }
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    if (block.material === 'tnt') {
      ctx.fillStyle = '#fff6e0';
      ctx.font = `${Math.min(w, h) * 0.42}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TNT', 0, 2);
    }
    ctx.restore();
  }

  // ---- photo textures for the "your drawing comes alive" reveal ----
  let reveal = null; // { start, img, page, map, photoMs, perBlock, wakeAt, fired, woke }

  function drawTexture(block, w, h) {
    if (!reveal || !reveal.page || !reveal.map || !block.src) return;
    const { sx, sy, ox, oy } = reveal.map;
    const src = block.src;
    const px = (src.x - src.w / 2 - ox) / sx;
    const py = (src.y - src.h / 2 - oy) / sy;
    const pw = src.w / sx;
    const ph = src.h / sy;
    try {
      ctx.save();
      ctx.globalAlpha *= 0.85;
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(reveal.page, px, py, pw, ph, -w / 2, -h / 2, w, h);
      ctx.restore();
    } catch {
      ctx.restore();
    }
  }

  // Where the paper sits on screen: the fort zone, bottom on the ground (as vision maps it).
  function photoRect(img) {
    const zw = WORLD.fortZone.x2 - WORLD.fortZone.x1;
    const iw = img.width || img.naturalWidth || 4;
    const ih = img.height || img.naturalHeight || 3;
    let w = zw, h = (zw * ih) / iw;
    const maxH = WORLD.groundY - 60;
    if (h > maxH) { h = maxH; w = (h * iw) / ih; }
    return { x: (WORLD.fortZone.x1 + WORLD.fortZone.x2) / 2 - w / 2, y: WORLD.groundY - h, w, h };
  }

  function revealLift(i, now) {
    if (!reveal) return 1;
    const t = now - reveal.start - reveal.photoMs - i * reveal.perBlock;
    return Math.max(0, Math.min(1, t / 260));
  }

  function updateReveal(now) {
    if (!reveal) return;
    const n = world.blocks.size;
    for (let i = reveal.fired; i < n; i++) {
      if (now - reveal.start - reveal.photoMs - i * reveal.perBlock < 0) break;
      reveal.fired = i + 1;
      hooks.onRevealBlock && hooks.onRevealBlock(i);
    }
    if (!reveal.woke && now >= reveal.wakeAt) {
      reveal.woke = true;
      hooks.onWake && hooks.onWake();
    }
  }

  function drawRevealPhoto(now) {
    if (!reveal || !reveal.img) return;
    const t = now - reveal.start;
    const fadeStart = reveal.photoMs;
    const alpha = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / 900);
    if (alpha <= 0) return;
    const img = reveal.page || reveal.img;
    if (!img.getContext && (!img.complete || !img.naturalWidth)) return; // photo still decoding
    // centred on screen, like a photo taped to the page (screen space)
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sc = Math.min(760 / iw, 540 / ih);
    const r = { x: 980 - (iw * sc) / 2, y: 500 - (ih * sc) / 2, w: iw * sc, h: ih * sc };
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.rotate(-0.02);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-r.w / 2 - 12, -r.h / 2 - 12, r.w + 24, r.h + 24);
    ctx.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(-r.w / 2 - 12, -r.h / 2 - 12, r.w + 24, r.h + 24);
    // tape
    ctx.fillStyle = 'rgba(240, 220, 150, 0.8)';
    ctx.rotate(0.1);
    ctx.fillRect(-60, -r.h / 2 - 30, 120, 34);
    ctx.restore();
  }

  // ---- effects ----
  function drawEffects(rand, effects) {
    for (const fx of effects) {
      const t = fx.life / fx.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, t * 1.6));
      if (fx.type === 'dust') {
        ctx.strokeStyle = 'rgba(90, 80, 70, 0.7)';
        ctx.lineWidth = 2;
        wobblyCircle(ctx, fx.x, fx.y, fx.r * (1.6 - t * 0.6), rand, 1.5);
      } else if (fx.type === 'puff') {
        const grow = 1 + (1 - t) * 1.4;
        ctx.strokeStyle = fx.paper ? INK : '#4f8f37';
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          wobblyCircle(ctx, fx.x + Math.cos(a) * fx.r * grow, fx.y + Math.sin(a) * fx.r * grow, fx.r * 0.45 * t + 3, rand, 1);
        }
      } else if (fx.type === 'squash') {
        // the blob flattens before it pops
        ctx.fillStyle = '#86cf63';
        ctx.strokeStyle = '#2f6b1f';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(fx.x, fx.y + fx.r * (1 - t) * 0.6, fx.r * (1 + (1 - t) * 0.6), fx.r * t * 0.7 + 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (fx.type === 'boom') {
        const r = 40 + (1 - t) * 210;
        ctx.strokeStyle = '#e2483d';
        ctx.lineWidth = 7;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
          wobblyLine(ctx, fx.x + Math.cos(a) * r * 0.35, fx.y + Math.sin(a) * r * 0.35, fx.x + Math.cos(a) * r, fx.y + Math.sin(a) * r, rand, 4);
        }
        ctx.strokeStyle = '#ffb020';
        ctx.lineWidth = 4;
        wobblyCircle(ctx, fx.x, fx.y, r * 0.5, rand, 6);
        markerText('BOOM!', fx.x, fx.y - 30, 90 + (1 - t) * 40, '#ffb020', 'center', -0.1);
      } else if (fx.type === 'word') {
        const pop = Math.min(1, (fx.max - fx.life) / 6);
        markerText(fx.text, fx.x, fx.y, fx.size * (0.6 + 0.4 * pop), fx.color, 'center', fx.rot);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Torn paper scraps and crumpled paper balls.
  function drawScrap(sc, rand) {
    const s = STYLE[sc.material] || STYLE.wood;
    ctx.save();
    ctx.globalAlpha = sc.alpha;
    ctx.translate(sc.x, sc.y);
    ctx.rotate(sc.angle);
    if (sc.kind === 'ball') {
      ctx.fillStyle = s.fill;
      ctx.beginPath();
      ctx.arc(0, 0, sc.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = 2;
      wobblyCircle(ctx, 0, 0, sc.r, rand, 2);
      const cr = rng(sc.k);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const a = cr() * 6.28, b = a + 1 + cr() * 2;
        wobblyLine(ctx, Math.cos(a) * sc.r * 0.8, Math.sin(a) * sc.r * 0.8, Math.cos(b) * sc.r * 0.25, Math.sin(b) * sc.r * 0.25, rand, 0.8);
      }
    } else {
      const { w, h } = sc;
      const cr = rng(sc.k);
      // jagged torn outline
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      const teeth = 4;
      for (let i = 1; i <= teeth; i++) ctx.lineTo(-w / 2 + (w * i) / teeth, -h / 2 + (i % 2 ? -1 : 1) * cr() * 3);
      for (let i = 1; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? 1 : -1) * (2 + cr() * 4), -h / 2 + (h * i) / teeth);
      for (let i = 1; i <= teeth; i++) ctx.lineTo(w / 2 - (w * i) / teeth, h / 2 + (i % 2 ? 1 : -1) * cr() * 3);
      for (let i = 1; i <= teeth; i++) ctx.lineTo(-w / 2 + (i % 2 ? -1 : 1) * (2 + cr() * 4), h / 2 - (h * i) / teeth);
      ctx.closePath();
      ctx.fillStyle = s.fill;
      ctx.fill();
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrails() {
    ctx.fillStyle = 'rgba(43, 38, 34, 0.28)';
    for (const p of world.lastTrail) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(43, 38, 34, 0.5)';
    for (const p of world.trail) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- HUD (screen space) ----
  function markerText(text, x, y, size, color, align = 'left', rot = 0) {
    markerTextOn(ctx, text, x, y, size, color, align, rot);
  }

  let team = null;

  function drawMiniBlob(x, y, r, gone, rand) {
    ctx.save();
    ctx.globalAlpha = gone ? 0.35 : 1;
    ctx.fillStyle = '#86cf63';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2f6b1f';
    ctx.lineWidth = 2;
    wobblyCircle(ctx, x, y, r, rand, 1);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.15, r * 0.14, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y - r * 0.15, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (gone) {
      ctx.strokeStyle = '#e2483d';
      ctx.lineWidth = 4;
      wobblyLine(ctx, x - r, y - r, x + r, y + r, rand, 1);
      wobblyLine(ctx, x + r, y - r, x - r, y + r, rand, 1);
    }
  }

  function drawHud(rand) {
    if (team) screens.drawTurnBanner(ctx, { team }, rand);
    if (!world.level) return;
    const total = world.pigsAtStart;
    const left = world.pigs.size;
    const r = 18;
    const x0 = WORLD.w - 40 - (total - 1) * (r * 2 + 10);
    for (let i = 0; i < total; i++) drawMiniBlob(x0 + i * (r * 2 + 10), 50, r, i >= left, rand);
  }

  function banner(title, sub, color, t) {
    const pop = Math.min(1, t / 220);
    const scale = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) + 0.04 * Math.sin(t / 140);
    ctx.save();
    ctx.translate(WORLD.w / 2, WORLD.h * 0.3);
    ctx.scale(scale, scale);
    markerText(title, 0, 0, 110, color, 'center', -0.04);
    if (sub) markerText(sub, 0, 85, 44, INK, 'center', -0.02);
    ctx.restore();
  }

  function drawBanners(now) {
    const t = now - phaseRealAt;
    if (seq.stage) return;
    switch (world.phase) {
      case 'waiting': {
        const dots = '.'.repeat(1 + (Math.floor(now / 400) % 3));
        banner(`Waiting for a fort${dots}`, 'draw it, snap it, send it', INK, 1000 + now);
        break;
      }
      case 'settling':
        if (reveal) {
          const rt = now - reveal.start;
          if (rt < reveal.photoMs) banner('Your drawing...', null, INK, rt);
          else banner('...comes alive!', null, '#e2483d', rt - reveal.photoMs);
        } else banner('Building your fort...', null, INK, t);
        break;
      case 'aiming':
        if (world.birdsUsed === 0 && t < TIMING.bannerMs) banner('FLING!', null, '#e2483d', t);
        break;
    }
  }

  // ---- end-of-turn sequence: kill cam -> CLEARED! stamp -> instant replay -> summary ----
  const seq = { stage: null, at: 0, summary: null, winner: null, onPlayAgain: null, button: null };
  let phaseRealAt = performance.now();
  let tauntUntil = 0;
  let reliefFrom = 0, reliefUntil = 0;
  world.on('phase', () => { phaseRealAt = performance.now(); });
  world.on('taunt', () => { tauntUntil = performance.now() + 1800; });
  world.on('collapse', () => {
    const now = performance.now();
    reliefFrom = now + 900;
    reliefUntil = now + 2400;
    hooks.onRelief && setTimeout(() => world.pigs.size > 0 && hooks.onRelief(), 900);
  });
  world.on('fortDestroyed', () => {
    seq.stage = 'killcam';
    seq.at = performance.now();
  });
  world.on('outOfBirds', () => {
    seq.stage = 'outro';
    seq.at = performance.now();
    tauntUntil = performance.now() + 2200;
  });
  world.on('levelLoaded', () => {
    replay.active = false;
    history.length = 0;
    seq.stage = null;
    seq.summary = null;
    seq.winner = null;
  });

  function advanceSeq(now) {
    const t = now - seq.at;
    if (seq.stage === 'killcam' && t > TIMING.killCam.ms + 150) {
      seq.stage = 'stamp';
      seq.at = now;
      seq.stamped = false;
    } else if (seq.stage === 'stamp') {
      if (!seq.stamped && t > 180) {
        seq.stamped = true;
        hooks.onStamp && hooks.onStamp();
      }
      if (t > 1700) startReplayOrDone(now);
    } else if (seq.stage === 'replay' && !replay.active) {
      seq.stage = 'done';
      seq.at = now;
    } else if (seq.stage === 'outro' && t > 2200) {
      seq.stage = 'done';
      seq.at = now;
    }
    if (seq.stage === 'done' && seq.summary) {
      seq.stage = 'summary';
      seq.at = now;
      hooks.onSummary && hooks.onSummary();
    }
  }

  function startReplayOrDone(now) {
    const end = replay.lastKill >= 0 ? Math.min(history.length, replay.lastKill + 45) : history.length;
    const frames = history.slice(Math.max(0, end - 110), end);
    if (frames.length >= 20) {
      replay.frames = frames;
      replay.i = 0;
      replay.active = true;
      seq.stage = 'replay';
    } else {
      seq.stage = 'done';
    }
    seq.at = now;
  }

  function showTurnSummary(data) {
    seq.summary = { ...data };
    if (seq.stage === 'done' || seq.stage === null) {
      seq.stage = 'summary';
      seq.at = performance.now();
      hooks.onSummary && hooks.onSummary();
    }
  }

  function showWinner(data, onPlayAgain) {
    seq.winner = { ...data };
    seq.onPlayAgain = onPlayAgain;
    seq.stage = 'winner';
    seq.at = performance.now();
    replay.active = false;
    hooks.onWinner && hooks.onWinner();
  }

  // Returns true if the click was used (Play again).
  function click(clientX, clientY) {
    if (seq.stage !== 'winner' || !seq.button) return false;
    const p = toScreen(clientX, clientY);
    if (!screens.hitRect(seq.button, p.x, p.y)) return false;
    hooks.onClick && hooks.onClick();
    const fn = seq.onPlayAgain;
    seq.stage = null;
    seq.winner = null;
    if (fn) fn();
    return true;
  }

  function drawOverlays(now, rand) {
    const t = now - seq.at;
    if (seq.stage === 'stamp' || (seq.stage === 'replay' && false)) screens.drawStamp(ctx, 'CLEARED!', t, rand);
    if (seq.stage === 'outro') banner('OUT OF SHOTS', `${world.pigs.size} blob${world.pigs.size === 1 ? '' : 's'} survived`, '#2f78ad', t);
    if (seq.stage === 'summary' && seq.summary) {
      const s = seq.summary;
      screens.drawTurnSummary(ctx, {
        team: s.team,
        blobs: s.blobs ?? world.pigsAtStart - world.pigs.size,
        blobsTotal: s.blobsTotal ?? world.pigsAtStart,
        birds: s.birds ?? world.birdsUsed,
        birdsTotal: s.birdsTotal ?? BIRD.perTurn,
      }, t, rand);
    }
    if (seq.stage === 'winner' && seq.winner) {
      seq.button = screens.drawWinner(ctx, seq.winner, t, rand);
    }
  }

  // ---- scene snapshots (live drawing and the slow-motion replay) ----
  function snapshot() {
    return {
      blocks: [...world.blocks.values()].map((b) => ({
        k: b.body.id, material: b.material, w: b.w, h: b.h, cracked: b.cracked, src: b.src,
        x: b.body.position.x, y: b.body.position.y, angle: b.body.angle,
      })),
      pigs: [...world.pigs.values()].map((p) => ({
        k: p.body.id, r: p.r, x: p.body.position.x, y: p.body.position.y, angle: p.body.angle,
        hurt: world.time - p.hurtAt < 600,
      })),
      scraps: world.scraps.map((s) => {
        const age = world.time - s.born;
        return {
          kind: s.kind, material: s.material, w: s.w, h: s.h, r: s.r, k: Math.floor(s.seed),
          x: s.body.position.x, y: s.body.position.y, angle: s.body.angle,
          alpha: Math.max(0, Math.min(1, (3200 - age) / 600)),
        };
      }),
      bird: world.bird
        ? {
          x: world.bird.body.position.x, y: world.bird.body.position.y, angle: world.bird.body.angle,
          kind: world.bird.kind, r: world.bird.r,
          heading: Math.atan2(world.bird.body.velocity.y, world.bird.body.velocity.x),
        }
        : null,
      effects: world.effects.map((fx) => ({ ...fx })),
    };
  }

  const REPLAY_FRAMES = 1200;
  const REPLAY_SPEED = 0.35;
  const history = [];
  const replay = { active: false, frames: null, i: 0, lastKill: -1 };
  world.on('launch', () => {
    history.length = 0;
    replay.lastKill = -1;
  });
  world.on('pigKilled', () => { replay.lastKill = history.length; });

  function mood(now) {
    let look = { x: WORLD.sling.x, y: WORLD.sling.y };
    let nervous = 0;
    if (world.phase === 'aiming') {
      look = pulledPos();
      nervous = world.aimState.power;
    } else if (world.phase === 'flying' && world.bird) {
      look = world.bird.body.position;
      nervous = 0.75;
    }
    const taunt = now < tauntUntil ? 1 : 0;
    const relief = now > reliefFrom && now < reliefUntil ? 1 : 0;
    const asleep = !!(reveal && !reveal.woke);
    return { look, nervous: taunt ? 0 : nervous, taunt, relief, asleep };
  }

  function drawScene(scene, rand, seed, now, live) {
    drawTrails();
    let i = 0;
    for (const block of scene.blocks) {
      const lift = live && reveal ? revealLift(i, now) : 1;
      i++;
      if (lift <= 0) continue;
      drawBlock(block, rng(block.k * 31 + seed), lift);
    }
    for (const sc of scene.scraps) drawScrap(sc, rng(sc.k + seed));
    const m = live ? mood(now) : { look: { x: WORLD.sling.x, y: WORLD.sling.y }, nervous: 0, taunt: 0, relief: 0, asleep: false };
    const revealHidden = live && reveal && now - reveal.start < reveal.photoMs;
    if (!revealHidden) for (const pig of scene.pigs) drawBlob(pig, rng(pig.k * 17 + seed), m, now);
    if (m.taunt && scene.pigs.length) {
      const p = scene.pigs[0];
      markerText('HA HA!', p.x, p.y - p.r - 50, 44, '#2f6b1f', 'center', -0.1);
    }

    const aimingLive = live && world.phase === 'aiming';
    if (aimingLive) {
      const p = pulledPos();
      drawBand(fork.back, p);
      const kind = world.shotQueue()[0] || 'scrunch';
      drawShot(kind, p.x, p.y, BIRD.radius, 0, world.aimState.angle, rand);
      drawBand(fork.front, p);
    } else {
      drawBand(fork.back, fork.front);
    }
    drawSlingFront(rand);

    if (scene.bird) {
      const b = scene.bird;
      drawShot(b.kind, b.x, b.y, b.r, b.angle, b.heading, rand);
    }
    drawEffects(rand, scene.effects);

    // shots waiting on the ground behind the slingshot
    if (live) {
      const queue = world.shotQueue().slice(world.phase === 'aiming' ? 1 : 0);
      queue.forEach((kind, j) => drawShot(kind, 150 - j * 52, WORLD.groundY - 18, 16, 0, 0, rand));
    }
  }

  function drawReplayOverlay(now) {
    ctx.fillStyle = 'rgba(43, 38, 34, 0.92)';
    ctx.fillRect(0, 0, WORLD.w, 70);
    ctx.fillRect(0, WORLD.h - 70, WORLD.w, 70);
    if (Math.floor(now / 450) % 2 === 0) {
      ctx.fillStyle = '#e2483d';
      ctx.beginPath();
      ctx.arc(70, 35, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `36px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PAPER;
    ctx.fillText('INSTANT REPLAY', 95, 37);
  }

  // ---- frame ----
  function draw(now) {
    resize();
    const seed = Math.floor(now / 110) % 4; // 4-frame line boil
    const rand = rng(1000 + seed);
    advanceSeq(now);
    updateReveal(now);
    updateCamera(now);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#e8e1d0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    worldTransform();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = PAPER;
    ctx.fillRect(-400, -900, WORLD.w + 800, WORLD.h + 1200);
    drawPaper(rand);
    drawSlingBack(rand);

    if (replay.active) {
      const frame = replay.frames[Math.min(replay.frames.length - 1, Math.floor(replay.i))];
      drawScene(frame, rand, seed, now, false);
      screenTransform();
      drawReplayOverlay(now);
      replay.i += REPLAY_SPEED;
      if (replay.i >= replay.frames.length) replay.active = false;
      return;
    }

    const scene = snapshot();
    if (world.phase === 'flying' || (seq.stage === 'killcam')) {
      history.push(scene);
      if (history.length > REPLAY_FRAMES) history.shift();
    }
    drawScene(scene, rand, seed, now, true);

    screenTransform();
    if (world.phase === 'settling') drawRevealPhoto(now);
    if (seq.stage !== 'winner') drawHud(rand);
    drawBanners(now);
    drawOverlays(now, rand);
  }

  function startReveal({ img, page, map, blocks }) {
    const photoMs = 1100;
    const perBlock = Math.max(50, Math.min(110, 1600 / Math.max(1, blocks)));
    const start = performance.now();
    reveal = { start, img, page, map, photoMs, perBlock, fired: 0, woke: false, wakeAt: start + photoMs + blocks * perBlock + 350 };
    return photoMs + blocks * perBlock + 450;
  }
  function clearReveal() { reveal = null; }

  return {
    draw, toWorld, view,
    isReplaying: () => replay.active,
    showTurnSummary, showWinner, click,
    setTeam: (t) => { team = t; },
    startReveal, clearReveal,
  };
}
