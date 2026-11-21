// Hand-drawn "sketchbook" renderer. Every shape is drawn with slightly wobbly
// double strokes, and the wobble re-rolls a few times a second (line "boil"),
// so the whole screen looks like an animated pencil drawing.
import { WORLD, BIRD, TIMING } from './config.js';

const FONT = '"Permanent Marker", "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';

const INK = '#2b2622';
const PAPER = '#fbf7ec';
const STYLE = {
  wood: { fill: '#e9c991', stroke: '#4a3220', hatch: '#a4723f' },
  ice: { fill: 'rgba(176, 221, 245, 0.75)', stroke: '#2f78ad', hatch: '#ffffff' },
  stone: { fill: '#bfbcb6', stroke: '#45423e', hatch: '#7d7a74' },
  tnt: { fill: '#e2483d', stroke: '#6e1410', hatch: '#9e2219' },
};

// Small seeded random so a shape wobbles the same way within one "boil" frame.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function wobblyLine(ctx, x1, y1, x2, y2, rand, amp = 1.6) {
  for (let pass = 0; pass < 2; pass++) {
    const j = () => (rand() - 0.5) * amp * 2;
    const mx = (x1 + x2) / 2 + j() * 1.5;
    const my = (y1 + y2) / 2 + j() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x1 + j(), y1 + j());
    ctx.quadraticCurveTo(mx, my, x2 + j(), y2 + j());
    ctx.stroke();
  }
}

function wobblyCircle(ctx, x, y, r, rand, amp = 1.5) {
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    const n = 14;
    const start = rand() * Math.PI * 2;
    for (let i = 0; i <= n + 1; i++) {
      const a = start + (i / n) * Math.PI * 2;
      const rr = r + (rand() - 0.5) * amp * 2;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function wobblyRect(ctx, w, h, rand) {
  const x = -w / 2, y = -h / 2;
  wobblyLine(ctx, x, y, x + w, y, rand);
  wobblyLine(ctx, x + w, y, x + w, y + h, rand);
  wobblyLine(ctx, x + w, y + h, x, y + h, rand);
  wobblyLine(ctx, x, y + h, x, y, rand);
}

// Bundled locally (public/assets/fonts, Apache 2.0) so it works without venue Wi-Fi.
function loadFont() {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  new FontFace('Permanent Marker', 'url(/assets/fonts/PermanentMarker-Regular.ttf)')
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => {});
}

export function createRenderer(canvas, world) {
  loadFont();
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    view.dpr = dpr;
    view.scale = Math.min(cw / WORLD.w, ch / WORLD.h);
    view.ox = (cw - WORLD.w * view.scale) / 2;
    view.oy = (ch - WORLD.h * view.scale) / 2;
  }

  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) * view.dpr - view.ox) / view.scale,
      y: ((clientY - r.top) * view.dpr - view.oy) / view.scale,
    };
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

  // The targets: smug green doodle blobs.
  function drawBlob(x, y, r, rot, rand) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot * 0.3);
    ctx.fillStyle = '#86cf63';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2f6b1f';
    ctx.lineWidth = 2.5;
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
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-r * 0.32, -r * 0.15, r * 0.26, 0, Math.PI * 2);
    ctx.arc(r * 0.32, -r * 0.15, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    wobblyCircle(ctx, -r * 0.32, -r * 0.15, r * 0.26, rand, 0.6);
    wobblyCircle(ctx, r * 0.32, -r * 0.15, r * 0.26, rand, 0.6);
    // pupils look towards the slingshot
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-r * 0.4, -r * 0.12, r * 0.11, 0, Math.PI * 2);
    ctx.arc(r * 0.24, -r * 0.12, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
    // smug grin
    ctx.strokeStyle = '#2f6b1f';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, r * 0.25, r * 0.38, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  // block is a scene entry: { k, material, w, h, x, y, angle }
  function drawBlock(block, rand) {
    const s = STYLE[block.material];
    const { w, h, angle } = block;
    ctx.save();
    ctx.translate(block.x, block.y);
    ctx.rotate(angle);
    ctx.fillStyle = s.fill;
    ctx.fillRect(-w / 2, -h / 2, w, h);

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

    if (block.material === 'tnt') {
      ctx.fillStyle = '#fff6e0';
      ctx.font = `${Math.min(w, h) * 0.42}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TNT', 0, 2);
    }
    ctx.restore();
  }

  // ---- effects ----
  function drawEffects(rand, effects) {
    for (const fx of effects) {
      const t = fx.life / fx.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, t * 1.5));
      if (fx.type === 'debris') {
        const s = STYLE[fx.material] || STYLE.wood;
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = 3;
        ctx.save();
        ctx.translate(fx.x, fx.y);
        ctx.rotate(fx.rot);
        wobblyLine(ctx, -fx.len / 2, 0, fx.len / 2, 0, rand, 1);
        ctx.restore();
      } else if (fx.type === 'puff') {
        const grow = 1 + (1 - t) * 1.4;
        ctx.strokeStyle = fx.paper ? INK : '#4f8f37';
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          wobblyCircle(ctx, fx.x + Math.cos(a) * fx.r * grow, fx.y + Math.sin(a) * fx.r * grow, fx.r * 0.45 * t + 3, rand, 1);
        }
      } else if (fx.type === 'boom') {
        const r = 30 + (1 - t) * 150;
        ctx.strokeStyle = '#e2483d';
        ctx.lineWidth = 5;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + rand() * 0.2;
          wobblyLine(ctx, fx.x + Math.cos(a) * r * 0.4, fx.y + Math.sin(a) * r * 0.4, fx.x + Math.cos(a) * r, fx.y + Math.sin(a) * r, rand, 3);
        }
        ctx.fillStyle = '#ffd34d';
        ctx.font = `${60 + (1 - t) * 30}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BOOM!', fx.x, fx.y - 20);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.strokeText('BOOM!', fx.x, fx.y - 20);
      } else if (fx.type === 'text') {
        ctx.fillStyle = '#e2483d';
        ctx.font = `30px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(fx.text, fx.x, fx.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawTrajectory() {
    const pts = world.predictPath();
    ctx.fillStyle = 'rgba(43, 38, 34, 0.55)';
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, 5 - i * 0.12), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---- HUD and banners ----
  function markerText(text, x, y, size, color, align = 'left', rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = size * 0.18;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function drawHud(rand, seed) {
    markerText(`SCORE ${world.score.toLocaleString('en-GB')}`, 140, 50, 40, INK);
    if (world.level) markerText(`blobs left: ${world.pigs.size}`, WORLD.w - 40, 50, 34, '#2f6b1f', 'right');

    // shots remaining, lined up on the ground behind the slingshot
    const loaded = world.phase === 'aiming' ? 1 : 0;
    const waiting = Math.max(0, BIRD.perTurn - world.birdsUsed - loaded);
    for (let i = 0; i < waiting; i++) {
      drawPaperBall(150 - i * 46, WORLD.groundY - 18, 16, 0, rand, seed + i);
    }
  }

  function banner(title, sub, color, t) {
    const pop = Math.min(1, t / 220);
    const scale = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) + 0.04 * Math.sin(t / 140);
    ctx.save();
    ctx.translate(WORLD.w / 2, WORLD.h * 0.36);
    ctx.scale(scale, scale);
    markerText(title, 0, 0, 110, color, 'center', -0.04);
    if (sub) markerText(sub, 0, 85, 40, INK, 'center', -0.02);
    ctx.restore();
  }

  function drawBanners(now) {
    const t = world.time - world.phaseAt;
    switch (world.phase) {
      case 'waiting': {
        const dots = '.'.repeat(1 + (Math.floor(now / 400) % 3));
        banner(`Waiting for a fort${dots}`, 'draw it, snap it, send it', INK, 1000 + now);
        break;
      }
      case 'settling':
        banner('Building your fort...', null, INK, t);
        break;
      case 'aiming':
        if (world.birdsUsed === 0 && t < TIMING.bannerMs) banner('FLING!', 'pull back on your phone and let go', '#e2483d', t);
        break;
      case 'destroyed':
        banner('FORT DESTROYED!', `${world.score.toLocaleString('en-GB')} points`, '#e2483d',
          replay.endedAt >= 0 ? now - replay.endedAt : t);
        break;
      case 'outOfBirds':
        banner('OUT OF SHOTS', `${world.pigs.size} blob${world.pigs.size === 1 ? '' : 's'} survived`, '#2f78ad', t);
        break;
    }
  }

  // ---- scene snapshots (for the slow-motion replay) ----
  function snapshot() {
    return {
      blocks: [...world.blocks.values()].map((b) => ({
        k: b.body.id, material: b.material, w: b.w, h: b.h,
        x: b.body.position.x, y: b.body.position.y, angle: b.body.angle,
      })),
      pigs: [...world.pigs.values()].map((p) => ({
        k: p.body.id, r: p.r, x: p.body.position.x, y: p.body.position.y, angle: p.body.angle,
      })),
      bird: world.bird
        ? { x: world.bird.body.position.x, y: world.bird.body.position.y, angle: world.bird.body.angle }
        : null,
      effects: world.effects.map((fx) => ({ ...fx })),
    };
  }

  const REPLAY_FRAMES = 1200; // whole shot kept in memory, even on 120 Hz screens
  const REPLAY_SPEED = 0.35;
  const history = [];
  const replay = { active: false, frames: null, i: 0, endedAt: -1, lastKill: -1 };

  world.on('launch', () => {
    history.length = 0;
    replay.endedAt = -1;
    replay.lastKill = -1;
  });
  // Centre the replay on the moment the last blob popped, not on the quiet
  // 1.5 s of settling that ends the shot.
  world.on('pigKilled', () => { replay.lastKill = history.length; });
  world.on('fortDestroyed', () => {
    const end = replay.lastKill >= 0 ? Math.min(history.length, replay.lastKill + 45) : history.length;
    const frames = history.slice(Math.max(0, end - 110), end);
    if (frames.length < 20) return;
    replay.frames = frames;
    replay.i = 0;
    replay.active = true;
  });

  function drawScene(scene, rand, seed, showSlingAim) {
    for (const block of scene.blocks) drawBlock(block, rng(block.k * 31 + seed));
    for (const pig of scene.pigs) drawBlob(pig.x, pig.y, pig.r, pig.angle, rng(pig.k * 17 + seed));

    if (showSlingAim) {
      const p = pulledPos();
      if (world.aimState.power > 0.02) drawTrajectory();
      drawBand(fork.back, p);
      drawPaperBall(p.x, p.y, BIRD.radius, 0, rand, 7);
      drawBand(fork.front, p);
    } else {
      drawBand(fork.back, fork.front);
    }
    drawSlingFront(rand);

    if (scene.bird) drawPaperBall(scene.bird.x, scene.bird.y, BIRD.radius, scene.bird.angle, rand, 7);
    drawEffects(rand, scene.effects);
  }

  function drawReplayOverlay(now) {
    // film-style letterbox bars and a blinking REPLAY tag
    ctx.fillStyle = 'rgba(43, 38, 34, 0.92)';
    ctx.fillRect(0, 0, WORLD.w, 70);
    ctx.fillRect(0, WORLD.h - 70, WORLD.w, 70);
    if (Math.floor(now / 450) % 2 === 0) {
      ctx.fillStyle = '#e2483d';
      ctx.beginPath();
      ctx.arc(70, 35, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `34px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PAPER;
    ctx.fillText('INSTANT REPLAY', 95, 37);
    ctx.textAlign = 'right';
    ctx.fillText('0.35×', WORLD.w - 40, 37);
  }

  // ---- frame ----
  function draw(now) {
    resize();
    const seed = Math.floor(now / 110) % 4; // 4-frame line boil
    const rand = rng(1000 + seed);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#e8e1d0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    drawPaper(rand);
    drawSlingBack(rand);

    if (replay.active) {
      const frame = replay.frames[Math.min(replay.frames.length - 1, Math.floor(replay.i))];
      drawScene(frame, rand, seed, false);
      drawReplayOverlay(now);
      replay.i += REPLAY_SPEED;
      if (replay.i >= replay.frames.length) {
        replay.active = false;
        replay.endedAt = now;
      }
      return;
    }

    const scene = snapshot();
    if (world.phase === 'flying') {
      history.push(scene);
      if (history.length > REPLAY_FRAMES) history.shift();
    }
    drawScene(scene, rand, seed, world.phase === 'aiming');
    drawHud(rand, seed);
    drawBanners(now);
  }

  return { draw, toWorld, view, isReplaying: () => replay.active };
}
