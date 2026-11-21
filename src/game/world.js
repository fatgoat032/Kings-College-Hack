// Physics and rules. No drawing and no DOM here, so it can be tested in Node.
import Matter from 'matter-js';
import { validateLevel, clampPigR } from '../shared/level.js';
import {
  WORLD, MATERIALS, MASS_FACTOR, SCRAPS, TNT, BIRD, PIG, TIMING,
  SHOTS, SHOT_ORDER, SHOT_ALIASES,
} from './config.js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

// The shared contract check, plus one game rule: a fort needs at least one pig.
export function checkLevel(level) {
  const result = validateLevel(level);
  const errors = [...result.errors];
  if (result.ok && level.pigs.length === 0) errors.push('Draw at least one green pig');
  return { ok: errors.length === 0, errors };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Axis-aligned half extents of a (possibly rotated) block.
function extents(b) {
  const c = Math.abs(Math.cos(b.angle || 0));
  const s = Math.abs(Math.sin(b.angle || 0));
  return { hw: (b.w * c + b.h * s) / 2, hh: (b.w * s + b.h * c) / 2 };
}

// Hand-drawn forts arrive with crossing lines: a plank drawn through the top of
// a post, a post that stops short of the ground. Overlapping bodies get shoved
// apart by the physics engine, so the fort jumps on load. This stacks each
// block exactly on whatever it was drawn resting on (bottom-up), and sits each
// blob on the surface under it. Positions only move by the overlap or gap.
export function fitLevel(level, pigScale = 1) {
  const blocks = level.blocks.map((b) => ({ ...b }));
  const order = [...blocks].sort((a, b) => (b.y + extents(b).hh) - (a.y + extents(a).hh));
  const placed = [];
  const supportUnder = (x, hw, y, hh) => {
    let top = WORLD.groundY;
    for (const q of placed) {
      const e = extents(q);
      const overlapX = Math.min(x + hw, q.x + e.hw) - Math.max(x - hw, q.x - e.hw);
      if (overlapX < 4) continue;
      // only things drawn clearly below count as support (not side-by-side neighbours)
      if (q.y - y < (hh + e.hh) * 0.45) continue;
      top = Math.min(top, q.y - e.hh);
    }
    return top;
  };
  for (const b of order) {
    const { hw, hh } = extents(b);
    b.y = supportUnder(b.x, hw, b.y, hh) - hh;
    placed.push(b);
  }
  const pigs = level.pigs.map((p) => {
    const r = clampPigR(p.r) * pigScale;
    const top = supportUnder(p.x, r * 0.6, p.y, r);
    return { ...p, y: top - r, r: p.r };
  });
  return { ...level, blocks, pigs };
}
const rand = (a, b) => a + Math.random() * (b - a);

export function createWorld() {
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = 1;
  engine.positionIterations = 10;
  engine.velocityIterations = 8;

  const listeners = {};
  const emit = (name, data) => (listeners[name] || []).forEach((fn) => fn(data));

  const w = {
    engine,
    time: 0, // simulated ms
    realTime: 0, // wall-clock ms fed to step()
    timeScale: 1,
    phase: 'waiting', // waiting | settling | aiming | flying | cleared | outOfBirds
    phaseAt: 0,
    phaseAtReal: 0,
    level: null,
    blocks: new Map(), // body.id -> { body, material, w, h, id, hp, maxHp, cracked }
    pigs: new Map(), // body.id -> { body, r, id, hp, hurtAt }
    scraps: [], // { body, kind: 'scrap'|'ball', material, w, h, r, born }
    bird: null, // { body, kind, r, abilityUsed, stillSince, hitAt }
    birdsUsed: 0,
    pigsAtStart: 0,
    aimState: { angle: -0.6, power: 0 },
    effects: [],
    trail: [], // current shot's path
    lastTrail: [], // previous shot's path (the only aiming help)
    shotStart: 0,
    settleUntil: 0,
    lastKill: null,
    slowMo: null, // { scale, until (realTime) }
    shotReported: false,
  };

  let ground = null;
  const pending = { breakBlocks: new Set(), killPigs: new Set(), explode: new Set() };
  const recentBreaks = [];
  let lastCollapseAt = -1e9;

  function setPhase(p) {
    w.phase = p;
    w.phaseAt = w.time;
    w.phaseAtReal = w.realTime;
    emit('phase', { phase: p });
  }

  function addGround() {
    ground = Bodies.rectangle(WORLD.w / 2, WORLD.groundY + 100, WORLD.w * 4, 200, {
      isStatic: true, friction: 0.9, label: 'ground',
    });
    Composite.add(engine.world, ground);
  }

  function clearWorld() {
    Composite.clear(engine.world, false);
    w.blocks.clear();
    w.pigs.clear();
    w.scraps = [];
    w.bird = null;
    w.effects = [];
    w.trail = [];
    w.lastTrail = [];
    w.slowMo = null;
    w.timeScale = 1;
    frozen = false;
    addGround();
  }

  function slowMotion(scale, ms) {
    if (w.slowMo && w.slowMo.scale <= scale && w.slowMo.until > w.realTime) return;
    w.slowMo = { scale, until: w.realTime + ms };
  }

  let lastWordAt = -1e9;
  function word(text, x, y, size = 46, color = '#e2483d') {
    // one hand-written word at a time (POP! always shows)
    if (text !== 'POP!' && w.realTime - lastWordAt < 350) return;
    lastWordAt = w.realTime;
    w.effects.push({ type: 'word', text, x, y, size, color, rot: rand(-0.25, 0.25), life: 55, max: 55 });
  }

  function dust(x, y, n = 5, size = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      w.effects.push({
        type: 'dust', x, y, vx: Math.cos(a) * rand(0.5, 2), vy: Math.sin(a) * rand(0.5, 2) - 0.5,
        r: size * rand(0.6, 1.2), life: 40, max: 40,
      });
    }
  }

  // ---- level loading ----
  // opts.revealMs: extra settle time while the display plays the "comes alive" reveal.
  function loadLevel(level, opts = {}) {
    const check = checkLevel(level);
    if (!check.ok) {
      emit('levelError', check);
      return check;
    }
    clearWorld();
    w.level = level;
    const fitted = fitLevel(level, PIG.sizeBoost);
    for (const b of fitted.blocks) {
      const m = MATERIALS[b.material];
      const body = Bodies.rectangle(b.x, b.y, b.w, b.h, {
        angle: b.angle || 0, density: m.density, friction: m.friction, frictionStatic: 1,
        restitution: m.restitution, label: 'block',
      });
      Composite.add(engine.world, body);
      const src = level.blocks.find((o) => o.id === b.id) || b; // original position, for photo textures
      w.blocks.set(body.id, { body, material: b.material, w: b.w, h: b.h, id: b.id, hp: m.hp, maxHp: m.hp, cracked: false, src });
    }
    for (const p of fitted.pigs) {
      const r = clampPigR(p.r) * PIG.sizeBoost;
      const body = Bodies.circle(p.x, p.y, r, {
        density: 0.0012, friction: 0.6, restitution: 0.1, label: 'pig',
      });
      Composite.add(engine.world, body);
      w.pigs.set(body.id, { body, r, id: p.id, hp: PIG.hp, hurtAt: -1e9 });
    }
    w.birdsUsed = 0;
    w.pigsAtStart = w.pigs.size;
    w.lastKill = null;
    freezeFort(true);
    w.settleUntil = w.time + TIMING.settleMs + (opts.revealMs || 0);
    setPhase('settling');
    emit('levelLoaded', { blocks: w.blocks.size, pigs: w.pigs.size });
    return check;
  }

  // The fort holds exactly as drawn until a shot comes close, then physics takes over.
  let frozen = false;
  function freezeFort(on) {
    frozen = on;
    for (const b of w.blocks.values()) Body.setStatic(b.body, on);
    for (const p of w.pigs.values()) Body.setStatic(p.body, on);
  }
  function fortNear(pos, margin) {
    for (const b of w.blocks.values()) {
      const bb = b.body.bounds;
      if (pos.x > bb.min.x - margin && pos.x < bb.max.x + margin && pos.y > bb.min.y - margin && pos.y < bb.max.y + margin) return true;
    }
    for (const p of w.pigs.values()) {
      if (Math.hypot(pos.x - p.body.position.x, pos.y - p.body.position.y) < p.r + margin) return true;
    }
    return false;
  }

  // ---- input ----
  function aim({ angle, power }) {
    if (Number.isFinite(angle)) w.aimState.angle = clamp(angle, -1.55, 0.9);
    if (Number.isFinite(power)) w.aimState.power = clamp(power, 0, 1);
    emit('aim', { ...w.aimState });
  }

  function nextShot(requested) {
    const kind = SHOT_ALIASES[requested] || requested;
    if (kind && kind !== 'scrunch' && SHOTS[kind]) return kind;
    return SHOT_ORDER[w.birdsUsed % SHOT_ORDER.length];
  }

  function shotQueue() {
    const left = Math.max(0, BIRD.perTurn - w.birdsUsed);
    return Array.from({ length: left }, (_, i) => SHOT_ORDER[(w.birdsUsed + i) % SHOT_ORDER.length]);
  }

  function launch({ angle, power, bird = 'red' } = {}) {
    if (w.phase !== 'aiming') return false;
    aim({ angle, power });
    const { angle: a, power: p } = w.aimState;
    if (p < 0.05) return false;
    const speed = BIRD.minSpeed + p * BIRD.speedRange;
    const kind = nextShot(bird);
    const r = SHOTS[kind].radius;
    const body = Bodies.circle(WORLD.sling.x, WORLD.sling.y, r, {
      density: BIRD.density, frictionAir: 0, friction: 0.5, restitution: 0.25, label: 'bird',
    });
    Composite.add(engine.world, body);
    Body.setVelocity(body, { x: Math.cos(a) * speed, y: Math.sin(a) * speed });
    w.bird = { body, kind, r, abilityUsed: false, stillSince: null, hitAt: null, pigsAtLaunch: w.pigs.size };
    w.birdsUsed += 1;
    w.aimState.power = 0;
    w.shotStart = w.time;
    w.shotReported = false;
    w.trail = [];
    setPhase('flying');
    emit('launch', { angle: a, power: p, bird: kind });
    return true;
  }

  function ability() {
    const bird = w.bird;
    if (!bird || bird.abilityUsed || (w.phase !== 'flying' && w.phase !== 'cleared')) return false;
    bird.abilityUsed = true;
    const spec = SHOTS[bird.kind];
    const b = bird.body;
    const { x, y } = b.position;
    if (spec.ability === 'boost') {
      Body.setVelocity(b, { x: b.velocity.x * spec.boost, y: b.velocity.y * spec.boost });
      word('ZOOM!', x, y - 50, 40);
    } else if (spec.ability === 'grow') {
      Body.scale(b, spec.grow, spec.grow);
      bird.r *= spec.grow;
      word('PUFF!', x, y - 70, 44);
    } else if (spec.ability === 'boomerang') {
      Body.setVelocity(b, { x: -Math.abs(b.velocity.x) * spec.back, y: b.velocity.y - spec.lift });
      Body.setAngularVelocity(b, 0.4);
      word('WHOOSH!', x, y - 50, 40);
    } else {
      word('HRMPH!', x, y - 50, 36);
    }
    emit('ability', { kind: bird.kind });
    return true;
  }

  // ---- damage ----
  const massOf = (body) => (body.isStatic ? Infinity : body.mass);
  function damageFrom(impact, floor, own, other) {
    if (impact <= floor) return 0;
    const f = clamp(Math.sqrt(massOf(other) / massOf(own)), MASS_FACTOR.min, MASS_FACTOR.max);
    return (impact - floor) * f;
  }

  Events.on(engine, 'collisionStart', (e) => {
    if (w.time < w.settleUntil) return;
    for (const pair of e.pairs) {
      const a = pair.bodyA.parent || pair.bodyA;
      const b = pair.bodyB.parent || pair.bodyB;
      const n = pair.collision.normal;
      const impact = Math.abs((a.velocity.x - b.velocity.x) * n.x + (a.velocity.y - b.velocity.y) * n.y);
      if (impact < 1) continue;
      const s = pair.collision.supports && pair.collision.supports[0];
      const at = s ? { x: s.x, y: s.y } : { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
      hit(a, b, impact, at);
      hit(b, a, impact, at);
      if (w.bird && (a === w.bird.body || b === w.bird.body) && w.bird.hitAt === null && impact > 2) {
        w.bird.hitAt = w.time;
        emit('birdHit', { x: at.x, y: at.y, force: clamp(impact / 16, 0, 1) });
      }
    }
  });

  function hit(body, other, impact, at) {
    const pig = w.pigs.get(body.id);
    if (pig) {
      const dmg = damageFrom(impact, PIG.floor, body, other);
      if (dmg > 0) {
        pig.hp -= dmg;
        pig.hurtAt = w.time;
        if (pig.hp <= 0) pending.killPigs.add(body.id);
      }
      return;
    }
    const block = w.blocks.get(body.id);
    if (block) {
      const m = MATERIALS[block.material];
      const dmg = damageFrom(impact, m.floor, body, other);
      if (dmg <= 0) return;
      block.hp -= dmg;
      emit('impact', { material: block.material, force: clamp(impact / 16, 0, 1), x: at.x, y: at.y });
      if (m.explode) pending.explode.add(body.id);
      else if (block.hp <= 0) pending.breakBlocks.add(body.id);
      else if (!block.cracked && block.hp <= block.maxHp / 2) {
        block.cracked = true;
        emit('blockCracked', { material: block.material, x: at.x, y: at.y });
      }
      return;
    }
    if (body === ground && w.bird && other === w.bird.body && impact > 3) {
      emit('impact', { material: 'ground', force: clamp(impact / 16, 0, 1), x: at.x, y: at.y });
      dust(at.x, at.y, 4, 9);
    }
  }

  function killPig(id) {
    const pig = w.pigs.get(id);
    if (!pig) return;
    const { x, y } = pig.body.position;
    Composite.remove(engine.world, pig.body);
    w.pigs.delete(id);
    w.effects.push({ type: 'squash', x, y, r: pig.r, life: 26, max: 26 });
    w.effects.push({ type: 'puff', x, y, r: pig.r, life: 32, max: 32 });
    word('POP!', x, y - pig.r - 20, 52, '#2f6b1f');
    w.lastKill = { x, y };
    emit('pigKilled', { id: pig.id, pigsLeft: w.pigs.size, x, y });
  }

  // Tear a block into 3-5 paper scraps, or crumple it into a rolling paper ball.
  function breakBlock(id) {
    const block = w.blocks.get(id);
    if (!block) return;
    const body = block.body;
    const { x, y } = body.position;
    const v = body.velocity;
    Composite.remove(engine.world, body);
    w.blocks.delete(id);
    const crumple = block.material !== 'stone' && Math.random() < SCRAPS.crumpleChance;
    if (crumple) {
      const r = clamp(Math.sqrt(block.w * block.h) * 0.33, 10, 22);
      const ball = Bodies.circle(x, y, r, { density: MATERIALS[block.material].density, friction: 0.3, restitution: 0.3, label: 'scrap' });
      Composite.add(engine.world, ball);
      Body.setVelocity(ball, { x: v.x + rand(-2, 3), y: v.y - rand(1, 3) });
      Body.setAngularVelocity(ball, rand(-0.3, 0.3));
      w.scraps.push({ body: ball, kind: 'ball', material: block.material, r, born: w.time, seed: Math.random() * 1e6 });
      word('CRUMPLE!', x, y - 30, 38, '#4a3220');
    } else {
      const n = Math.floor(rand(SCRAPS.pieces[0], SCRAPS.pieces[1] + 1));
      const long = block.w >= block.h;
      const len = (long ? block.w : block.h) / n;
      const thick = long ? block.h : block.w;
      const ax = { x: Math.cos(body.angle), y: Math.sin(body.angle) };
      const axis = long ? ax : { x: -ax.y, y: ax.x };
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * len;
        const pw = long ? len * rand(0.75, 0.95) : thick;
        const ph = long ? thick : len * rand(0.75, 0.95);
        const piece = Bodies.rectangle(x + axis.x * o, y + axis.y * o, pw, ph, {
          angle: body.angle + rand(-0.2, 0.2), density: MATERIALS[block.material].density,
          friction: 0.6, restitution: 0.1, label: 'scrap',
        });
        Composite.add(engine.world, piece);
        Body.setVelocity(piece, { x: v.x + rand(-2.5, 2.5), y: v.y - rand(0.5, 3) });
        Body.setAngularVelocity(piece, rand(-0.25, 0.25));
        w.scraps.push({ body: piece, kind: 'scrap', material: block.material, w: pw, h: ph, born: w.time, seed: Math.random() * 1e6 });
      }
      const words = { wood: 'CRACK!', ice: 'SMASH!', stone: 'THUD!' };
      word(words[block.material] || 'CRACK!', x, y - 30, 44);
    }
    dust(x, y, 6, 12);
    while (w.scraps.length > SCRAPS.max) {
      const old = w.scraps.shift();
      Composite.remove(engine.world, old.body);
    }
    recentBreaks.push(w.realTime);
    emit('blockBroken', { id: block.id, material: block.material, crumple, x, y });
  }

  function explode(id) {
    const block = w.blocks.get(id);
    if (!block) return;
    const c = { ...block.body.position };
    Composite.remove(engine.world, block.body);
    w.blocks.delete(id);
    w.effects.push({ type: 'boom', x: c.x, y: c.y, life: 42, max: 42 });
    dust(c.x, c.y, 12, 18);
    emit('explode', { x: c.x, y: c.y });
    for (const body of Composite.allBodies(engine.world)) {
      if (body.isStatic) continue;
      const dx = body.position.x - c.x;
      const dy = body.position.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > TNT.radius) continue;
      const k = 1 - d / TNT.radius;
      Body.setVelocity(body, {
        x: body.velocity.x + (dx / d) * TNT.kick * k,
        y: body.velocity.y + (dy / d) * TNT.kick * k - 3 * k,
      });
      Body.setAngularVelocity(body, body.angularVelocity + rand(-0.3, 0.3) * k);
      const pig = w.pigs.get(body.id);
      if (pig) {
        pig.hp -= TNT.damage * k;
        if (pig.hp <= 0) pending.killPigs.add(body.id);
      }
      const other = w.blocks.get(body.id);
      if (other) {
        if (MATERIALS[other.material].explode) pending.explode.add(body.id);
        else {
          other.hp -= TNT.damage * k * (other.material === 'stone' ? 0.5 : 1);
          if (other.hp <= 0) pending.breakBlocks.add(body.id);
          else if (other.hp <= other.maxHp / 2) other.cracked = true;
        }
      }
    }
    slowMotion(0.4, 500);
  }

  function flushPending() {
    for (let guard = 0; guard < 10; guard++) {
      if (!pending.explode.size && !pending.killPigs.size && !pending.breakBlocks.size) break;
      const ex = [...pending.explode]; pending.explode.clear();
      ex.forEach(explode);
      const kp = [...pending.killPigs]; pending.killPigs.clear();
      kp.forEach(killPig);
      const bb = [...pending.breakBlocks]; pending.breakBlocks.clear();
      bb.forEach(breakBlock);
    }
  }

  // ---- per-step rules ----
  const offWorld = (p) => p.y > WORLD.groundY + 150 || p.x < -300 || p.x > WORLD.w + 300;
  const birdGone = (p) => p.y > WORLD.groundY + 100 || p.x < -80 || p.x > WORLD.w + 60;

  function cleanup() {
    for (const [id, pig] of w.pigs) if (offWorld(pig.body.position)) pending.killPigs.add(id);
    for (const [id, block] of w.blocks) {
      if (offWorld(block.body.position)) {
        Composite.remove(engine.world, block.body);
        w.blocks.delete(id);
      }
    }
    w.scraps = w.scraps.filter((s) => {
      if (w.time - s.born > SCRAPS.life || offWorld(s.body.position)) {
        Composite.remove(engine.world, s.body);
        return false;
      }
      return true;
    });
  }

  function removeBird() {
    if (!w.bird) return;
    const { x, y } = w.bird.body.position;
    w.effects.push({ type: 'puff', x, y, r: w.bird.r, life: 24, max: 24, paper: true });
    Composite.remove(engine.world, w.bird.body);
    w.bird = null;
  }

  function reportShot() {
    if (w.shotReported) return;
    w.shotReported = true;
    const knocked = w.pigsAtStart - w.pigs.size;
    emit('shotDone', { pigsLeft: w.pigs.size, birdsUsed: w.birdsUsed, score: knocked });
  }

  function endShot() {
    const missed = w.bird && w.bird.pigsAtLaunch === w.pigs.size;
    w.lastTrail = w.trail;
    removeBird();
    reportShot();
    if (w.birdsUsed >= BIRD.perTurn) {
      setPhase('outOfBirds');
      emit('outOfBirds', { pigsLeft: w.pigs.size, knocked: w.pigsAtStart - w.pigs.size, birdsUsed: w.birdsUsed });
    } else {
      setPhase('aiming');
    }
    if (missed && w.pigs.size > 0) emit('taunt', {});
  }

  function cleared() {
    if (w.trail.length) w.lastTrail = w.trail;
    const wasLate = w.phase !== 'flying'; // last blob fell after the shot was already reported
    setPhase('cleared');
    slowMotion(TIMING.killCam.scale, TIMING.killCam.ms);
    if (wasLate) w.shotReported = false;
    reportShot();
    emit('fortDestroyed', { knocked: w.pigsAtStart, birdsUsed: w.birdsUsed, at: w.lastKill });
  }

  function updateEffects() {
    for (const fx of w.effects) {
      fx.life -= w.timeScale < 1 ? w.timeScale : 1;
      if (fx.type === 'dust') {
        fx.x += fx.vx * w.timeScale; fx.y += fx.vy * w.timeScale; fx.vx *= 0.95; fx.vy *= 0.95;
      } else if (fx.type === 'word') {
        fx.y -= 0.5 * w.timeScale;
      }
    }
    w.effects = w.effects.filter((fx) => fx.life > 0);
  }

  function detectCollapse() {
    while (recentBreaks.length && w.realTime - recentBreaks[0] > TIMING.collapseWindow) recentBreaks.shift();
    if (recentBreaks.length >= TIMING.collapseBlocks && w.realTime - lastCollapseAt > 1500) {
      lastCollapseAt = w.realTime;
      slowMotion(TIMING.collapseSlowMo.scale, TIMING.collapseSlowMo.ms);
      emit('collapse', { blocks: recentBreaks.length });
    }
  }

  // realDt: wall-clock ms since the last step. Physics advances one step × timeScale.
  function step(realDt = TIMING.step) {
    w.realTime += realDt;
    if (w.slowMo && w.realTime > w.slowMo.until) w.slowMo = null;
    w.timeScale = w.slowMo ? w.slowMo.scale : 1;
    const dt = TIMING.step * w.timeScale;
    Engine.update(engine, dt);
    w.time += dt;
    flushPending();
    cleanup();
    flushPending();
    detectCollapse();
    updateEffects();

    if (w.phase === 'settling' && w.time >= w.settleUntil) setPhase('aiming');

    if (w.pigs.size === 0 && w.pigsAtStart > 0 && ['flying', 'aiming', 'outOfBirds'].includes(w.phase)) {
      cleared();
      return;
    }

    const bird = w.bird;
    if (frozen && bird && fortNear(bird.body.position, bird.r + 90)) freezeFort(false);
    if (bird && (w.phase === 'flying' || w.phase === 'cleared')) {
      const p = bird.body.position;
      const last = w.trail[w.trail.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 22) w.trail.push({ x: p.x, y: p.y });
    }

    if (w.phase === 'flying') {
      if (!bird) return endShot();
      const p = bird.body.position;
      if (birdGone(p) || w.time - w.shotStart > TIMING.maxShotMs) return endShot();
      if (bird.body.speed < BIRD.stillSpeed) {
        if (bird.stillSince === null) bird.stillSince = w.time;
        if (w.time - bird.stillSince > BIRD.stillMs) endShot();
      } else {
        bird.stillSince = null;
      }
    }
  }

  function on(name, fn) {
    (listeners[name] ||= []).push(fn);
    return () => off(name, fn);
  }
  function off(name, fn) {
    listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
  }

  function reset() {
    clearWorld();
    w.level = null;
    w.birdsUsed = 0;
    w.pigsAtStart = 0;
    setPhase('waiting');
  }

  addGround();

  return Object.assign(w, { loadLevel, aim, launch, ability, shotQueue, step, on, off, reset });
}
