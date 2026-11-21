// Physics and rules. No drawing and no DOM here, so it can be tested in Node.
import Matter from 'matter-js';
import { validateLevel, clampPigR } from '../shared/level.js';
import { WORLD, MATERIALS, TNT, BIRD, PIG, TIMING, SCORE, SHOTS, SHOT_ORDER, SHOT_ALIASES } from './config.js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

// The shared contract check, plus one game rule: a fort needs at least one pig.
export function checkLevel(level) {
  const result = validateLevel(level);
  const errors = [...result.errors];
  if (result.ok && level.pigs.length === 0) errors.push('Draw at least one green pig');
  return { ok: errors.length === 0, errors };
}

export function createWorld() {
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = 1;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;

  const listeners = {};
  const emit = (name, data) => (listeners[name] || []).forEach((fn) => fn(data));

  const w = {
    engine,
    time: 0,
    phase: 'waiting', // waiting | settling | aiming | flying | destroyed | outOfBirds
    phaseAt: 0,
    level: null,
    blocks: new Map(), // body.id -> { body, material, w, h, id }
    pigs: new Map(), // body.id -> { body, r, id }
    bird: null, // { body }
    birdsUsed: 0,
    score: 0,
    aimState: { angle: -0.6, power: 0 },
    effects: [],
    shotStart: 0,
    restSince: null,
    settleUntil: 0,
  };

  let ground = null;
  const pending = { breakBlocks: new Set(), killPigs: new Set(), explode: new Set() };

  function setPhase(p) {
    w.phase = p;
    w.phaseAt = w.time;
    emit('phase', { phase: p });
  }

  function addGround() {
    ground = Bodies.rectangle(WORLD.w / 2, WORLD.groundY + 100, WORLD.w * 4, 200, {
      isStatic: true,
      friction: 0.9,
      label: 'ground',
    });
    Composite.add(engine.world, ground);
  }

  function clearWorld() {
    Composite.clear(engine.world, false);
    w.blocks.clear();
    w.pigs.clear();
    w.bird = null;
    w.effects = [];
    addGround();
  }

  function addScore(points, x, y) {
    w.score += points;
    w.effects.push({ type: 'text', text: `+${points.toLocaleString('en-GB')}`, x, y, vy: -0.8, life: 60, max: 60 });
    emit('score', { score: w.score });
  }

  function debris(x, y, material, n = 7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 4;
      w.effects.push({
        type: 'debris', material, x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        len: 8 + Math.random() * 14, life: 50, max: 50,
      });
    }
  }

  // ---- level loading ----
  function loadLevel(level) {
    const check = checkLevel(level);
    if (!check.ok) {
      emit('levelError', check);
      return check;
    }
    clearWorld();
    w.level = level;
    for (const b of level.blocks) {
      const m = MATERIALS[b.material];
      const body = Bodies.rectangle(b.x, b.y, b.w, b.h, {
        angle: b.angle || 0,
        density: m.density,
        friction: m.friction,
        frictionStatic: 1,
        restitution: 0.05,
        label: 'block',
      });
      Composite.add(engine.world, body);
      w.blocks.set(body.id, { body, material: b.material, w: b.w, h: b.h, id: b.id });
    }
    for (const p of level.pigs) {
      const r = clampPigR(p.r);
      const body = Bodies.circle(p.x, p.y, r, { density: 0.001, friction: 0.6, restitution: 0.1, label: 'pig' });
      Composite.add(engine.world, body);
      w.pigs.set(body.id, { body, r, id: p.id });
    }
    w.birdsUsed = 0;
    w.score = 0;
    w.restSince = null;
    w.settleUntil = w.time + TIMING.settleMs;
    setPhase('settling');
    emit('levelLoaded', { blocks: w.blocks.size, pigs: w.pigs.size });
    return check;
  }

  // ---- input ----
  function aim({ angle, power }) {
    if (Number.isFinite(angle)) w.aimState.angle = Math.max(-1.55, Math.min(0.9, angle));
    if (Number.isFinite(power)) w.aimState.power = Math.max(0, Math.min(1, power));
    emit('aim', { ...w.aimState });
  }

  // Which shot is next: the turn's order, unless the launch asks for a
  // specific non-default type (the contract's default is "red").
  function nextShot(requested) {
    const kind = SHOT_ALIASES[requested] || requested;
    if (kind && kind !== 'scrunch' && SHOTS[kind]) return kind;
    return SHOT_ORDER[w.birdsUsed % SHOT_ORDER.length];
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
      density: BIRD.density,
      frictionAir: 0,
      friction: 0.6,
      restitution: 0.3,
      label: 'bird',
    });
    Composite.add(engine.world, body);
    Body.setVelocity(body, { x: Math.cos(a) * speed, y: Math.sin(a) * speed });
    w.bird = { body, kind, r, abilityUsed: false };
    w.birdsUsed += 1;
    w.aimState.power = 0;
    w.shotStart = w.time;
    w.restSince = null;
    setPhase('flying');
    emit('launch', { angle: a, power: p, bird: kind });
    return true;
  }

  // One-time ability of the shot in flight (abilities from yumin-jung/angry-birds).
  function ability() {
    const bird = w.bird;
    if (w.phase !== 'flying' || !bird || bird.abilityUsed) return false;
    bird.abilityUsed = true;
    const spec = SHOTS[bird.kind];
    const b = bird.body;
    const { x, y } = b.position;
    if (spec.ability === 'boost') {
      Body.setVelocity(b, { x: b.velocity.x * spec.boost, y: b.velocity.y * spec.boost });
      w.effects.push({ type: 'text', text: 'ZOOM!', x, y: y - 40, vy: -0.6, life: 40, max: 40 });
    } else if (spec.ability === 'grow') {
      Body.scale(b, spec.grow, spec.grow);
      bird.r *= spec.grow;
      w.effects.push({ type: 'text', text: 'PUFF!', x, y: y - 60, vy: -0.6, life: 40, max: 40 });
    } else if (spec.ability === 'boomerang') {
      Body.setVelocity(b, { x: -Math.abs(b.velocity.x) * spec.back, y: b.velocity.y - spec.lift });
      Body.setAngularVelocity(b, 0.4);
      w.effects.push({ type: 'text', text: 'WHOOSH!', x, y: y - 40, vy: -0.6, life: 40, max: 40 });
    } else {
      w.effects.push({ type: 'text', text: 'HRMPH!', x, y: y - 40, vy: -0.6, life: 40, max: 40 });
    }
    emit('ability', { kind: bird.kind });
    return true;
  }

  // The shot that will be loaded next, and the ones waiting after it.
  function shotQueue() {
    const left = Math.max(0, BIRD.perTurn - w.birdsUsed);
    return Array.from({ length: left }, (_, i) => SHOT_ORDER[(w.birdsUsed + i) % SHOT_ORDER.length]);
  }

  // Dots along the predicted flight path, for the aiming preview.
  function predictPath(angle = w.aimState.angle, power = w.aimState.power, n = 34) {
    const speed = BIRD.minSpeed + power * BIRD.speedRange;
    const g = engine.gravity.y * engine.gravity.scale * TIMING.step * TIMING.step;
    let x = WORLD.sling.x, y = WORLD.sling.y;
    let vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed;
    const pts = [];
    for (let i = 0; i < n * 3; i++) {
      vy += g;
      x += vx;
      y += vy;
      if (i % 3 === 2) pts.push({ x, y });
      if (y > WORLD.groundY || x > WORLD.w + 50) break;
    }
    return pts;
  }

  // ---- collisions ----
  Events.on(engine, 'collisionStart', (e) => {
    if (w.time < w.settleUntil) return;
    for (const pair of e.pairs) {
      const a = pair.bodyA.parent || pair.bodyA;
      const b = pair.bodyB.parent || pair.bodyB;
      const n = pair.collision.normal;
      const impact = Math.abs((a.velocity.x - b.velocity.x) * n.x + (a.velocity.y - b.velocity.y) * n.y);
      hit(a, impact);
      hit(b, impact);
    }
  });

  function hit(body, impact) {
    const pig = w.pigs.get(body.id);
    if (pig && impact > PIG.killImpact) pending.killPigs.add(body.id);
    const block = w.blocks.get(body.id);
    if (block) {
      const m = MATERIALS[block.material];
      if (m.explode && impact > m.breakAt) pending.explode.add(body.id);
      else if (impact > m.breakAt) pending.breakBlocks.add(body.id);
    }
  }

  function killPig(id) {
    const pig = w.pigs.get(id);
    if (!pig) return;
    const { x, y } = pig.body.position;
    Composite.remove(engine.world, pig.body);
    w.pigs.delete(id);
    w.effects.push({ type: 'puff', x, y, r: pig.r, life: 30, max: 30 });
    addScore(PIG.points, x, y - 30);
    emit('pigKilled', { id: pig.id, pigsLeft: w.pigs.size });
  }

  function breakBlock(id) {
    const block = w.blocks.get(id);
    if (!block) return;
    const { x, y } = block.body.position;
    Composite.remove(engine.world, block.body);
    w.blocks.delete(id);
    debris(x, y, block.material);
    addScore(MATERIALS[block.material].points, x, y - 20);
    emit('blockBroken', { id: block.id, material: block.material });
  }

  function explode(id) {
    const block = w.blocks.get(id);
    if (!block) return;
    const c = { ...block.body.position };
    Composite.remove(engine.world, block.body);
    w.blocks.delete(id);
    w.effects.push({ type: 'boom', x: c.x, y: c.y, life: 36, max: 36 });
    debris(c.x, c.y, 'tnt', 14);
    addScore(MATERIALS.tnt.points, c.x, c.y - 40);
    emit('explode', { x: c.x, y: c.y });

    for (const body of Composite.allBodies(engine.world)) {
      if (body.isStatic) continue;
      const dx = body.position.x - c.x;
      const dy = body.position.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d > TNT.radius || d === 0) continue;
      const k = 1 - d / TNT.radius;
      Body.applyForce(body, body.position, {
        x: (dx / d) * TNT.force * body.mass * k,
        y: (dy / d) * TNT.force * body.mass * k,
      });
      if (w.pigs.has(body.id)) pending.killPigs.add(body.id);
      const other = w.blocks.get(body.id);
      if (other && d < TNT.radius * TNT.breakRadius) {
        if (other.material === 'tnt') pending.explode.add(body.id);
        else if (other.material !== 'stone') pending.breakBlocks.add(body.id);
      }
    }
  }

  function flushPending() {
    // Explosions can queue more work, so loop until nothing is left.
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
  function outOfBounds(p) {
    return p.y > WORLD.groundY + 150 || p.x < -300 || p.x > WORLD.w + 300;
  }

  function cleanup() {
    for (const [id, pig] of w.pigs) if (outOfBounds(pig.body.position)) pending.killPigs.add(id);
    for (const [id, block] of w.blocks) {
      if (outOfBounds(block.body.position)) {
        Composite.remove(engine.world, block.body);
        w.blocks.delete(id);
      }
    }
    if (w.bird && outOfBounds(w.bird.body.position)) {
      Composite.remove(engine.world, w.bird.body);
      w.bird = null;
    }
  }

  function everythingResting() {
    for (const body of Composite.allBodies(engine.world)) {
      if (body.isStatic) continue;
      if (body.speed > TIMING.restSpeed || body.angularSpeed > TIMING.restAngular) return false;
    }
    return true;
  }

  function endShot() {
    if (w.bird) {
      const { x, y } = w.bird.body.position;
      w.effects.push({ type: 'puff', x, y, r: w.bird.r, life: 24, max: 24, paper: true });
      Composite.remove(engine.world, w.bird.body);
      w.bird = null;
    }
    const pigsLeft = w.pigs.size;
    const birdsUsed = w.birdsUsed;
    if (pigsLeft === 0) {
      const spare = BIRD.perTurn - birdsUsed;
      if (spare > 0) addScore(spare * SCORE.unusedShotBonus, WORLD.sling.x, WORLD.sling.y - 80);
      setPhase('destroyed');
    } else if (birdsUsed >= BIRD.perTurn) {
      setPhase('outOfBirds');
    } else {
      setPhase('aiming');
    }
    emit('shotDone', { pigsLeft, birdsUsed, score: w.score });
    if (w.phase === 'destroyed') emit('fortDestroyed', { score: w.score, birdsUsed });
    if (w.phase === 'outOfBirds') emit('outOfBirds', { score: w.score, pigsLeft });
  }

  function updateEffects() {
    for (const fx of w.effects) {
      fx.life -= 1;
      if (fx.type === 'debris') {
        fx.x += fx.vx; fx.y += fx.vy; fx.vy += 0.3; fx.rot += fx.vr;
      } else if (fx.type === 'text') {
        fx.y += fx.vy;
      }
    }
    w.effects = w.effects.filter((fx) => fx.life > 0);
  }

  function step(dt = TIMING.step) {
    Engine.update(engine, dt);
    w.time += dt;
    flushPending();
    cleanup();
    flushPending();
    updateEffects();

    if (w.phase === 'settling' && w.time >= w.settleUntil) setPhase('aiming');

    if (w.phase === 'flying') {
      const elapsed = w.time - w.shotStart;
      if (elapsed > TIMING.maxShotMs) return endShot();
      if (elapsed > 400 && everythingResting()) {
        if (w.restSince === null) w.restSince = w.time;
        if (w.time - w.restSince > TIMING.restMs) endShot();
      } else {
        w.restSince = null;
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
    w.score = 0;
    w.birdsUsed = 0;
    setPhase('waiting');
  }

  addGround();

  return Object.assign(w, { loadLevel, aim, launch, ability, shotQueue, predictPath, step, on, off, reset });
}
