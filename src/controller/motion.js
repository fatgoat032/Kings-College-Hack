// Motion slingshot, "zero on press, two axes" (TEAM FIX #3).
//
// Press anywhere = grip. That exact phone pose becomes zero. From then on the gyroscope
// (devicemotion rotationRate) is integrated:
//   aimRot  += rate around the screen normal (Z, alpha) * dt   -> steering-wheel turn
//   pullRot += rate around the screen's X axis (beta) * dt     -> top tipped back towards you
// with a complementary filter (98 % gyro, 2 % gravity-derived angle) against drift.
// Aim: 45° up + aimRot (±2° dead zone, ±45°) -> 0-90° up. Power: clamp(pullRot, 0, 40)/40, ^1.3.
// Both outputs are low-passed (0.25). Release fires the pose from 100 ms before the release.
// A two-step calibration (turn right, tilt back) learns, per phone, WHICH rotationRate field
// (alpha/beta/gamma; browsers map them to device axes differently) belongs to each motion, its
// sign and the units, so iPhone/Android differences need no guessing. 3-finger tap = debug readout.
// Needs HTTPS (npm run dev:https); iOS also needs DeviceMotionEvent.requestPermission() on a tap.
import { click, twang, unlock } from './sfx.js';

const BASE_DEG = 45;
const MAX_TURN = 45;
const DEAD_ZONE = 2;
const PULL_FULL = 40;
const EASE = 1.3;
const OUT_ALPHA = 0.25;
const GYRO_WEIGHT = 0.98;
const SETTLE_MS = 80; // ignore the jolt of the press itself
const SNAPSHOT_MS = 100; // fire with the pose from this long before release
const MIN_POWER = 0.08;
const WEBCAM_FRESH_MS = 400;
const SEND_EVERY_MS = 1000 / 30; // grip:move at 30/s
const CAL_KEY = 'angry-sketches:motioncal';
const RAD = 180 / Math.PI;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
export const motionSupported = () => window.isSecureContext && 'DeviceMotionEvent' in window;
export const needsPermission = () => typeof window.DeviceMotionEvent?.requestPermission === 'function';
/** The viewport follows the phone's orientation, so its shape is the reliable signal. */
export const isLandscape = () => window.innerWidth > window.innerHeight * 1.1;

/** Ask iOS for motion permission. Must be called from a tap. */
export async function requestMotionPermission() {
  unlock();
  try {
    return (await window.DeviceMotionEvent.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

const DEFAULT_CAL = () => ({
  // rotationRate field for the steering turn and for tipping the top back ('a' alpha, 'b' beta,
  // 'c' gamma). Chrome puts screen-normal rotation in gamma and screen-X in alpha; the spec
  // reading (alpha = Z) is the iOS guess. Calibration replaces both on first use.
  aimAxis: isIOS() ? 'a' : 'c',
  pullAxis: isIOS() ? 'b' : 'a',
  aimGyro: 1, // sign: + = counter-clockwise = turn left = aim higher
  pullGyro: 1, // sign: + = top towards you
  aimGrav: 1,
  pullGrav: isIOS() ? -1 : 1, // iOS reports gravity with the opposite sign
  unit: 1, // 1 = deg/s, RAD = the browser reports rad/s
  done: false,
});
function loadCal() {
  try {
    const c = JSON.parse(localStorage.getItem(CAL_KEY));
    if (c && typeof c === 'object') return { ...DEFAULT_CAL(), ...c };
  } catch { /* none or private mode */ }
  return DEFAULT_CAL();
}
function saveCal(c) {
  try { localStorage.setItem(CAL_KEY, JSON.stringify(c)); } catch { /* private mode */ }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} cb onAim({angle, power, source, hz}), onLaunch({angle, power, source}),
 *                    onGrip({held, cancel?}), onTap(), onFeedback(kind, power?)
 */
export function createMotionPad(canvas, { onAim, onLaunch, onGrip, onTap, onFeedback }) {
  const ctx = canvas.getContext('2d');
  let cal = loadCal();
  let enabled = false;
  let flying = false;
  let testMode = false;
  let pullMode = 'tilt'; // webcam is optional now: 'tilt' | 'webcam' | 'auto'
  let showDebug = false;
  /** calibration wizard: null, or { step: 1 | 2, msg } */
  let wizard = null;

  // ---- sensor state ----
  let g = null; // smoothed raw gravity
  let rate = { a: 0, b: 0, c: 0 }; // raw rotationRate as reported
  let lastT = 0;
  let lastMotionAt = 0;
  let count = 0;
  let hz = 0;
  let hzWindow = performance.now();

  // ---- grip state ----
  let holding = false;
  let pressAt = 0;
  let zeroed = false;
  let aimRot = 0;
  let pullRot = 0;
  let gRot0 = 0;
  let gPitch0 = 0;
  let raw = { a: 0, b: 0, c: 0 }; // raw gyro integrals per field since zero (calibration / units)
  let aimOut = 0; // smoothed turn, degrees after dead zone
  let powOut = 0; // smoothed power 0-1
  let history = []; // { t, turn, power }
  let webcam = { power: 0, at: -Infinity };
  let tick = 0;
  let fullBuzzed = false;
  let lastSent = 0;
  let raf = 0;
  let multiTouch = false;

  const gravRot = () => (g ? Math.atan2(g.x, g.y) * RAD : 0); // in-plane rotation
  const gravPitch = () => (g ? Math.atan2(g.z, Math.hypot(g.x, g.y)) * RAD : 0);
  const sensorsLive = () => performance.now() - lastMotionAt < 1500;
  const tracking = () => holding || testMode || !!wizard;

  function zero() {
    zeroed = false;
    pressAt = performance.now();
    aimRot = pullRot = 0;
    aimOut = powOut = 0;
    raw = { a: 0, b: 0, c: 0 };
    history = [];
    tick = 0;
    fullBuzzed = false;
  }

  function onMotion(e) {
    const t = performance.now();
    const ag = e.accelerationIncludingGravity;
    if (ag && ag.x != null) {
      const x = ag.x;
      const y = ag.y;
      const z = ag.z ?? 0;
      g = g ? { x: g.x + 0.3 * (x - g.x), y: g.y + 0.3 * (y - g.y), z: g.z + 0.3 * (z - g.z) } : { x, y, z };
    }
    const rr = e.rotationRate;
    const hasGyro = !!rr && rr.alpha != null;
    if (hasGyro) rate = { a: rr.alpha, b: rr.beta ?? 0, c: rr.gamma ?? 0 };
    const dt = lastT ? clamp((t - lastT) / 1000, 0, 0.1) : 0;
    lastT = t;
    lastMotionAt = t;
    count++;
    if (t - hzWindow >= 1000) {
      hz = Math.round((count * 1000) / (t - hzWindow));
      count = 0;
      hzWindow = t;
    }
    if (!tracking() || t - pressAt < SETTLE_MS) return;

    if (!zeroed) {
      zeroed = true;
      gRot0 = gravRot();
      gPitch0 = gravPitch();
      return;
    }
    const gAim = wrapDeg(gravRot() - gRot0) * cal.aimGrav;
    const gPull = (gravPitch() - gPitch0) * cal.pullGrav;
    if (hasGyro) {
      raw.a += rate.a * dt;
      raw.b += rate.b * dt;
      raw.c += rate.c * dt;
      const rAim = rate[cal.aimAxis] * cal.unit * cal.aimGyro;
      const rPull = rate[cal.pullAxis] * cal.unit * cal.pullGyro;
      aimRot = GYRO_WEIGHT * (aimRot + rAim * dt) + (1 - GYRO_WEIGHT) * gAim;
      pullRot = GYRO_WEIGHT * (pullRot + rPull * dt) + (1 - GYRO_WEIGHT) * gPull;
    } else {
      aimRot = gAim; // no gyroscope: gravity only
      pullRot = gPull;
    }
    let turn = Math.abs(aimRot) < DEAD_ZONE ? 0 : aimRot - Math.sign(aimRot) * DEAD_ZONE;
    turn = clamp(turn, -MAX_TURN, MAX_TURN);
    const p = Math.pow(clamp(pullRot, 0, PULL_FULL) / PULL_FULL, EASE);
    aimOut += OUT_ALPHA * (turn - aimOut);
    powOut += OUT_ALPHA * (p - powOut);
    history.push({ t, turn: aimOut, power: powOut });
    while (history.length && history[0].t < t - 400) history.shift();
  }
  window.addEventListener('devicemotion', onMotion);

  const elevation = (turn = aimOut) => clamp(BASE_DEG + turn, 0, 90);
  const toAngle = (elev) => (-elev * Math.PI) / 180; // contract: negative = up
  const webcamLive = () => performance.now() - webcam.at < WEBCAM_FRESH_MS;
  function source() {
    if (pullMode === 'webcam') return 'webcam';
    if (pullMode === 'auto' && webcamLive()) return 'webcam';
    return 'tilt';
  }
  const powerNow = () => (source() === 'webcam' ? (webcamLive() ? webcam.power : 0) : powOut);

  /** The pose SNAPSHOT_MS before t (letting go jolts the phone). */
  function poseBefore(t) {
    let pick = null;
    for (const h of history) if (h.t <= t - SNAPSHOT_MS) pick = h;
    pick ??= history[0] ?? { turn: aimOut, power: powOut };
    return { elev: elevation(pick.turn), power: source() === 'webcam' ? powerNow() : pick.power };
  }

  // ---- calibration wizard ----
  function startWizard() {
    wizard = { step: 1, msg: 'Hold the screen and turn the phone RIGHT like a steering wheel, then let go.' };
  }
  /** If the gyro integral is ~57x smaller than the gravity angle, the browser reports rad/s. */
  function learnUnit(gyroInt, gravDeg) {
    if (Math.abs(gravDeg) < 12 || Math.abs(gyroInt) < 1e-3) return cal.unit;
    return Math.abs(gyroInt) * 10 < Math.abs(gravDeg) ? RAD : 1;
  }
  function finishWizardStep() {
    const gAimRaw = wrapDeg(gravRot() - gRot0);
    const gPullRaw = gravPitch() - gPitch0;
    // the rotationRate field that moved most is the one for this motion
    const biggest = (skip) => ['a', 'b', 'c'].filter((k) => k !== skip).sort((x, y) => Math.abs(raw[y]) - Math.abs(raw[x]))[0];
    if (wizard.step === 1) {
      const axis = biggest();
      if (Math.abs(gAimRaw) < 12 && Math.abs(raw[axis]) < 0.2) {
        wizard.msg = 'Turn a bit further. Hold, turn RIGHT like a steering wheel, let go.';
        return;
      }
      // turning right must make aimRot negative (flatter shot)
      cal.aimAxis = axis;
      cal.aimGyro = raw[axis] > 0 ? -1 : 1;
      cal.aimGrav = gAimRaw > 0 ? -1 : 1;
      cal.unit = learnUnit(raw[axis], gAimRaw);
      wizard = { step: 2, msg: 'Now hold and tilt the TOP of the phone back towards you, then let go.' };
      return;
    }
    const axis = biggest(cal.aimAxis);
    if (Math.abs(gPullRaw) < 12 && Math.abs(raw[axis]) < 0.2) {
      wizard.msg = 'Tilt a bit further. Hold, tip the TOP back towards you, let go.';
      return;
    }
    cal.pullAxis = axis;
    cal.pullGyro = raw[axis] > 0 ? 1 : -1;
    cal.pullGrav = gPullRaw > 0 ? 1 : -1;
    cal.done = true;
    saveCal(cal);
    wizard = null;
    onFeedback?.('calibrated');
  }

  // ---- input ----
  canvas.addEventListener('pointerdown', (e) => {
    unlock();
    if (multiTouch) return;
    if (flying && !wizard) return onTap?.();
    if (isLandscape()) return;
    if (wizard) {
      holding = true;
      zero();
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (testMode) return zero();
    if (!enabled || holding) return;
    holding = true;
    zero();
    canvas.setPointerCapture?.(e.pointerId);
    navigator.vibrate?.(15);
    click();
    onGrip?.({ held: true });
    onFeedback?.('grab');
  });
  function release(cancel) {
    if (!holding) return;
    holding = false;
    if (wizard) {
      if (!cancel) finishWizardStep();
      return;
    }
    const { elev, power } = poseBefore(performance.now());
    const src = source();
    if (cancel || !enabled || power < MIN_POWER) {
      onAim({ angle: toAngle(elev), power: 0, source: src });
      onGrip?.({ held: false, cancel: true });
      if (!cancel && enabled) onFeedback?.('nopull');
      return;
    }
    onGrip?.({ held: false });
    onLaunch({ angle: toAngle(elev), power, source: src });
    navigator.vibrate?.([40, 30, 70]);
    twang(power);
    onFeedback?.('launched', power);
  }
  canvas.addEventListener('pointerup', () => release(false));
  canvas.addEventListener('pointercancel', () => release(true));
  canvas.style.touchAction = 'none';

  // 3-finger tap toggles the debug readout (and never fires a shot)
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length >= 3) {
      multiTouch = true;
      showDebug = !showDebug;
      if (holding) release(true);
    }
  });
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) multiTouch = false;
  });

  // ---- stream + haptics + draw ----
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (holding && enabled && !wizard) {
      const p = powerNow();
      if (now - lastSent >= SEND_EVERY_MS) {
        lastSent = now;
        onAim({ angle: toAngle(elevation()), power: p, source: source(), hz });
      }
      const step = Math.floor(p * 10); // a tick every 10 %
      if (step > tick) navigator.vibrate?.(8);
      tick = Math.max(tick, step);
      if (p >= 0.99 && !fullBuzzed) {
        fullBuzzed = true;
        navigator.vibrate?.(60);
      }
    }
    draw();
  }

  function size() {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const INK = '#2b2622';
  const RED = '#d8322b';
  const marker = (px) => `${px}px 'Permanent Marker', system-ui, sans-serif`;
  function wrapText(text, x, y, maxW, lh) {
    let line = '';
    for (const word of text.split(' ')) {
      if (line && ctx.measureText(`${line} ${word}`).width > maxW) {
        ctx.fillText(line, x, y);
        line = word;
        y += lh;
      } else line = line ? `${line} ${word}` : word;
    }
    ctx.fillText(line, x, y);
  }

  function draw() {
    const { w, h } = size();
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    if (isLandscape()) {
      ctx.font = marker(Math.min(30, w / 13));
      ctx.fillText('Hold your phone upright', w / 2, h / 2);
      return;
    }
    if (wizard) {
      ctx.font = marker(24);
      ctx.fillText(`Calibrate ${wizard.step}/2`, w / 2, h * 0.16);
      ctx.font = marker(20);
      wrapText(wizard.msg, w / 2, h * 0.26, w * 0.85, 28);
      ctx.font = marker(72);
      ctx.fillText(wizard.step === 1 ? '↻' : '⤺', w / 2, h * 0.62);
      if (holding && zeroed) {
        ctx.font = '14px ui-monospace, monospace';
        ctx.fillText(`turn ${wrapDeg(gravRot() - gRot0).toFixed(0)}° · tilt ${(gravPitch() - gPitch0).toFixed(0)}°`, w / 2, h * 0.76);
      }
      drawDebug(w);
      return;
    }
    const live = holding || testMode;
    ctx.globalAlpha = enabled || flying || testMode ? 1 : 0.35;
    const cx = w * 0.2;
    const cy = h * 0.66;
    const R = Math.min(w * 0.7, h * 0.5);
    const el = live ? elevation() : BASE_DEG;
    const a = (-el * Math.PI) / 180;
    const p = live ? powerNow() : 0;

    // 0-90° range arc
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // big arrow, stretches with power
    const len = R * (0.5 + 0.5 * (live ? p : 0.4));
    const tx = cx + Math.cos(a) * len;
    const ty = cy + Math.sin(a) * len;
    ctx.strokeStyle = live ? RED : INK;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = live ? 12 : 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    const head = 30;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(a) * head * 0.6, ty + Math.sin(a) * head * 0.6);
    ctx.lineTo(tx + Math.cos(a + 2.5) * head, ty + Math.sin(a + 2.5) * head);
    ctx.lineTo(tx + Math.cos(a - 2.5) * head, ty + Math.sin(a - 2.5) * head);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, live ? 28 : 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = INK;
    ctx.font = marker(44);
    ctx.fillText(`${Math.round(el)}°`, w * 0.68, h * 0.2);
    ctx.font = marker(16);
    ctx.fillText(live ? '← higher   turn   flatter →' : 'hold to grip: that pose is zero', w * 0.68, h * 0.2 + 26);

    // power bar with 10 % ticks
    const mw = w * 0.84;
    const mx = (w - mw) / 2;
    const my = h - 64;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(mx, my, mw, 26);
    ctx.fillStyle = RED;
    ctx.fillRect(mx + 3, my + 3, (mw - 6) * p, 20);
    ctx.fillStyle = INK;
    for (let i = 1; i < 10; i++) ctx.fillRect(mx + (mw * i) / 10, my + 18, 2, 8);
    ctx.font = marker(16);
    const how = source() === 'webcam' ? 'pull your hand back (webcam)' : 'tip the top back towards you';
    ctx.fillText(`${Math.round(p * 100)}% · ${how}`, w / 2, my - 8);
    ctx.globalAlpha = 1;
    drawDebug(w);
  }

  function drawDebug(w) {
    if (!showDebug) return;
    const lines = [
      `rate α ${rate.a.toFixed(2)} β ${rate.b.toFixed(2)} γ ${rate.c.toFixed(2)} (${cal.unit === 1 ? 'deg/s' : 'rad/s ×57.3'})`,
      `aimRot ${aimRot.toFixed(1)}°  pullRot ${pullRot.toFixed(1)}°  ${hz} Hz`,
      `out turn ${aimOut.toFixed(1)}°  power ${(powOut * 100).toFixed(0)}%  src ${source()}`,
      `aim ${cal.aimAxis}${cal.aimGyro > 0 ? '+' : '-'} pull ${cal.pullAxis}${cal.pullGyro > 0 ? '+' : '-'} · grav ${cal.aimGrav > 0 ? '+' : '-'}/${cal.pullGrav > 0 ? '+' : '-'} · ${cal.done ? 'calibrated' : 'defaults'}`,
    ];
    ctx.fillStyle = 'rgba(251,247,236,.92)';
    ctx.fillRect(4, 4, w - 8, lines.length * 16 + 10);
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.font = '11px ui-monospace, monospace';
    lines.forEach((l, i) => ctx.fillText(l, 10, 20 + i * 16));
    ctx.textAlign = 'center';
  }

  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    sensorsLive,
    isHolding: () => holding,
    // main.js re-renders on every room:state (setEnabled(false), then true in the same tick),
    // so this must not drop a grip in progress; a release while disabled cancels instead.
    setEnabled(v) {
      enabled = v;
    },
    setFlying(v) {
      flying = v;
    },
    setTestMode(v) {
      testMode = v;
      if (v) zero();
    },
    setPullMode(m) {
      pullMode = m;
    },
    setWebcamPower(p) {
      webcam = { power: clamp(Number(p) || 0, 0, 1), at: performance.now() };
    },
    /** Calibration wizard: run on first use (needsCalibration) and from settings. */
    calibrate: startWizard,
    needsCalibration: () => !cal.done,
    isCalibrating: () => !!wizard,
    debug: () => ({ aimRot, pullRot, turn: aimOut, power: powOut, elevation: elevation(), hz, cal: { ...cal }, rate: { ...rate } }),
    resize,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('devicemotion', onMotion);
    },
  };
}
