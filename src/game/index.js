// Public API of the game module (the plan's P2 handoff):
//
//   const game = createGame(canvas, { localInput: true });
//   game.loadLevel(level)              // Level JSON, see src/shared/level.js
//   game.aim({ angle, power })         // radians (0 = right, negative = up), power 0-1
//   game.launch({ angle, power, bird })
//   game.on('shotDone', ({ pigsLeft, birdsUsed, score }) => ...)
//
//   game.ability()                     // fire the flying shot's one-time ability
//
// Events: levelLoaded, levelError, phase, aim, launch, ability, pigKilled,
// blockBroken, explode, score, shotDone, fortDestroyed, outOfBirds.
//
// localInput (default true) turns on mouse drag and keyboard control on the
// big screen, for testing before the phones are wired in.
import { createWorld } from './world.js';
import { createRenderer } from './render.js';
import { createSound } from './sound.js';
import { WORLD, TIMING } from './config.js';

export function createGame(canvas, { localInput = true } = {}) {
  const world = createWorld();
  const renderer = createRenderer(canvas, world);
  const sound = createSound();

  world.on('blockBroken', ({ material }) => {
    if (material === 'ice') sound.ice();
    else if (material === 'stone') sound.stone();
    else sound.wood();
  });
  world.on('pigKilled', () => sound.pop());
  world.on('explode', () => sound.boom());
  world.on('launch', () => sound.launch());
  world.on('ability', () => sound.ability());
  world.on('aim', ({ power }) => sound.stretch(power));
  world.on('fortDestroyed', () => sound.win());
  world.on('outOfBirds', () => sound.lose());

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

  // ---- local mouse and keyboard input ----
  const cleanups = [];
  const unlock = () => sound.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  cleanups.push(() => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  });

  if (localInput) {
    let dragging = false;
    const MAX_PULL = 160;
    const aimFrom = (e) => {
      const p = renderer.toWorld(e.clientX, e.clientY);
      const dx = WORLD.sling.x - p.x;
      const dy = WORLD.sling.y - p.y;
      const len = Math.hypot(dx, dy);
      world.aim({ angle: Math.atan2(dy, dx), power: Math.min(1, len / MAX_PULL) });
    };
    const down = (e) => {
      if (world.phase !== 'aiming') return;
      const p = renderer.toWorld(e.clientX, e.clientY);
      if (Math.hypot(p.x - WORLD.sling.x, p.y - WORLD.sling.y) > 140) return;
      dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
      aimFrom(e);
    };
    const move = (e) => dragging && aimFrom(e);
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (world.aimState.power > 0.1) world.launch({ ...world.aimState });
      else world.aim({ power: 0 });
    };
    const key = (e) => {
      const a = world.aimState;
      if (e.key === 'ArrowUp') world.aim({ angle: a.angle - 0.03 });
      else if (e.key === 'ArrowDown') world.aim({ angle: a.angle + 0.03 });
      else if (e.key === 'ArrowRight') world.aim({ power: a.power + 0.04 });
      else if (e.key === 'ArrowLeft') world.aim({ power: a.power - 0.04 });
      else if (e.key === ' ') {
        if (world.phase === 'flying') world.ability();
        else world.launch({ ...a });
      }
      else return;
      e.preventDefault();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key);
    canvas.style.touchAction = 'none';
    cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
    });
  }

  return {
    loadLevel: (level) => world.loadLevel(level),
    aim: (a) => world.aim(a),
    launch: (l) => world.launch(l),
    ability: () => world.ability(),
    on: (name, fn) => world.on(name, fn),
    off: (name, fn) => world.off(name, fn),
    reset: () => world.reset(),
    getState: () => ({ phase: world.phase, score: world.score, pigsLeft: world.pigs.size, birdsUsed: world.birdsUsed }),
    setMuted: (m) => sound.setMuted(m),
    destroy() {
      cancelAnimationFrame(raf);
      cleanups.forEach((fn) => fn());
    },
  };
}
