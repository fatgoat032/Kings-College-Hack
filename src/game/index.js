// Public API of the game module (the plan's P2 handoff):
//
//   const game = createGame(canvas, { localInput: true });
//   game.loadLevel(level, { photo, page, pageToWorld }) // Level JSON; extras drive the reveal
//   game.aim({ angle, power })         // radians (0 = right, negative = up), power 0-1
//   game.launch({ angle, power, bird })
//   game.ability()                     // fire the flying shot's one-time ability
//   game.setTeam('A' | 'B' | null)     // who is flinging (HUD tag)
//   game.showTurnSummary({ team, blobs, birds })
//   game.showWinner({ winner, blobs: { A, B }, birds: { A, B } }, onPlayAgain)
//   game.sampleLevels                  // the dense demo forts
//   game.on('shotDone', ({ pigsLeft, birdsUsed, score }) => ...) // score = blobs knocked out
//
// Events: levelLoaded, levelError, phase, aim, launch, ability, impact, blockCracked,
// blockBroken, collapse, pigKilled, explode, taunt, shotDone, fortDestroyed, outOfBirds.
//
// M toggles sound on the display. localInput (default true) adds mouse drag and
// hidden keyboard controls for testing without phones.
import { createWorld } from './world.js';
import { createRenderer } from './render.js';
import { createSfx } from './sfx.js';
import { demoLevels } from './levels.js';
import { WORLD, TIMING } from './config.js';

export function createGame(canvas, { localInput = true } = {}) {
  const world = createWorld();
  const sfx = createSfx();
  const renderer = createRenderer(canvas, world, {
    onRevealBlock: () => sfx.play('scratch', { force: 0.5 }),
    onWake: () => sfx.play('blink', { force: 0.7 }),
    onStamp: () => sfx.play('stamp', { force: 1 }),
    onSummary: () => sfx.play('jingle', { force: 0.7 }),
    onWinner: () => sfx.play('fanfare', { force: 0.9 }),
    onClick: () => sfx.play('click', { force: 0.6 }),
    onRelief: () => sfx.play('sigh', { force: 0.5 }),
  });

  // ---- sound on game events ----
  const HIT = { wood: 'hitWood', ice: 'hitIce', stone: 'hitStone', tnt: 'hitWood', ground: 'hitGround' };
  let grabbed = false;
  let squeaked = false;
  world.on('aim', ({ power }) => {
    if (world.phase !== 'aiming') return;
    if (power > 0.04 && !grabbed) {
      grabbed = true;
      sfx.play('grab', { force: 0.6 });
    }
    if (power <= 0.02) { grabbed = false; squeaked = false; }
    if (grabbed) sfx.stretch(power);
    if (power > 0.6 && !squeaked) {
      squeaked = true;
      sfx.play('squeak', { force: 0.5 });
    }
  });
  world.on('launch', () => {
    grabbed = false;
    squeaked = false;
    sfx.play('launch', { force: 0.9 });
    sfx.play('squawk', { force: 0.6, pitch: 0.85 + Math.random() * 0.3 });
    sfx.startWhistle();
  });
  world.on('birdHit', () => sfx.stopWhistle());
  world.on('shotDone', () => sfx.stopWhistle());
  world.on('ability', () => sfx.play('ability', { force: 0.8 }));
  world.on('impact', ({ material, force }) => sfx.play(HIT[material] || 'hitWood', { force }));
  world.on('blockBroken', ({ crumple }) => sfx.play(crumple ? 'crumple' : 'tear', { force: 0.75 }));
  world.on('collapse', () => sfx.play('rumble', { force: 0.8 }));
  world.on('pigKilled', () => sfx.play('pop', { force: 1 }));
  world.on('explode', () => sfx.play('tnt', { force: 1 }));
  world.on('taunt', () => sfx.play('laugh', { force: 0.6 }));
  world.on('outOfBirds', () => setTimeout(() => sfx.play('laugh', { force: 0.7 }), 300));

  // ---- main loop: fixed physics step, render every frame ----
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    acc += Math.min(100, now - last);
    last = now;
    let steps = 0;
    while (acc >= TIMING.step && steps < 5) {
      world.step(TIMING.step);
      acc -= TIMING.step;
      steps++;
    }
    if (steps === 5) acc = 0;
    renderer.draw(now);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ---- always-on display controls: audio unlock, mute, Play again ----
  const cleanups = [];
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  listen(window, 'pointerdown', (e) => {
    sfx.unlock();
    renderer.click(e.clientX, e.clientY);
  });
  listen(window, 'keydown', (e) => {
    sfx.unlock();
    if (e.key === 'm' || e.key === 'M') sfx.toggleMute();
  });

  // ---- hidden dev input: mouse drag on the slingshot, arrows + space ----
  if (localInput) {
    let dragging = false;
    const MAX_PULL = 160;
    const aimFrom = (e) => {
      const p = renderer.toWorld(e.clientX, e.clientY);
      const dx = WORLD.sling.x - p.x;
      const dy = WORLD.sling.y - p.y;
      world.aim({ angle: Math.atan2(dy, dx), power: Math.min(1, Math.hypot(dx, dy) / MAX_PULL) });
    };
    listen(canvas, 'pointerdown', (e) => {
      if (world.phase === 'flying') return world.ability();
      if (world.phase !== 'aiming') return;
      const p = renderer.toWorld(e.clientX, e.clientY);
      if (Math.hypot(p.x - WORLD.sling.x, p.y - WORLD.sling.y) > 160) return;
      dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
      aimFrom(e);
    });
    listen(canvas, 'pointermove', (e) => dragging && aimFrom(e));
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (world.aimState.power > 0.1) world.launch({ ...world.aimState });
      else world.aim({ power: 0 });
    };
    listen(canvas, 'pointerup', up);
    listen(canvas, 'pointercancel', up);
    listen(window, 'keydown', (e) => {
      const a = world.aimState;
      if (e.key === 'ArrowUp') world.aim({ angle: a.angle - 0.03 });
      else if (e.key === 'ArrowDown') world.aim({ angle: a.angle + 0.03 });
      else if (e.key === 'ArrowRight') world.aim({ power: a.power + 0.04 });
      else if (e.key === 'ArrowLeft') world.aim({ power: a.power - 0.04 });
      else if (e.key === ' ') {
        if (world.phase === 'flying') world.ability();
        else world.launch({ ...a });
      } else return;
      e.preventDefault();
    });
    canvas.style.touchAction = 'none';
  }

  // ---- level loading with the "your drawing comes alive" reveal ----
  function loadLevel(level, extras = {}) {
    const photo = extras.photo;
    const page = extras.page && (extras.page.canvas || extras.page);
    const map = extras.pageToWorld || extras.page?.pageToWorld || level?.meta?.pageToWorld || null;
    const pageOk = page && typeof page.getContext === 'function' ? page : null;
    if (!photo && !pageOk) {
      renderer.clearReveal();
      return world.loadLevel(level);
    }
    let img = null;
    if (photo) {
      img = new Image();
      img.src = photo;
    }
    const revealMs = renderer.startReveal({ img: img || pageOk, page: pageOk, map, blocks: level?.blocks?.length || 0 });
    const res = world.loadLevel(level, { revealMs });
    if (res && res.ok === false) renderer.clearReveal();
    return res;
  }

  return {
    loadLevel,
    aim: (a) => world.aim(a),
    launch: (l) => world.launch(l),
    ability: () => world.ability(),
    on: (name, fn) => world.on(name, fn),
    off: (name, fn) => world.off(name, fn),
    reset: () => { renderer.clearReveal(); world.reset(); },
    setTeam: (t) => renderer.setTeam(t),
    showTurnSummary: (d) => renderer.showTurnSummary(d),
    showWinner: (d, onPlayAgain) => renderer.showWinner(d, onPlayAgain),
    sampleLevels: demoLevels,
    getState: () => ({
      phase: world.phase, pigsLeft: world.pigs.size, birdsUsed: world.birdsUsed,
      knocked: world.pigsAtStart - world.pigs.size,
    }),
    setMuted: (m) => sfx.setMuted(m),
    toggleMute: () => sfx.toggleMute(),
    destroy() {
      cancelAnimationFrame(raf);
      sfx.stopWhistle();
      cleanups.forEach((fn) => fn());
    },
  };
}
