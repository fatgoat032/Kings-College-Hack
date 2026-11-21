// Motion slingshot: hold anywhere on the screen to grip the pouch, turn the phone like a
// steering wheel to aim, pull to set the power, lift your thumb to fire.
//
// Aim: gravity from devicemotion (accelerationIncludingGravity), so it does not drift.
//   rotation = atan2(gx, gy) is how the phone is turned in the screen plane. At grip start we
//   store rotation0; aim = 45° up + (rotation - rotation0), smoothed, ±3° dead zone, ±45° max,
//   clamped to 0-85° up. Turning left aims higher, right aims flatter ("flip" swaps that).
// Pull: the webcam on the big screen measures how far the hand moved back and sends
//   power:update. If that isn't arriving, tilting the top of the phone back towards you gives
//   the power: (pitch - pitch0) / 35°.
// iOS reports gravity with the opposite sign to Android; we flip it so both read the same.
// Needs HTTPS (npm run dev:https). iOS also needs DeviceMotionEvent.requestPermission() from a
// tap. main.js falls back to the drag pad when there are no sensors.
import { click, twang, unlock } from './sfx.js';

const BASE_DEG = 45; // elevation with the phone held straight
const MAX_TURN_DEG = 45;
const DEAD_ZONE_DEG = 3;
const ELEV_MIN = 0;
const ELEV_MAX = 85;
const ALPHA = 0.2; // low-pass for aim and pull
const TILT_FULL_DEG = 35; // tilt back this far for full power
const MIN_POWER = 0.08; // release below this cancels
const WEBCAM_FRESH_MS = 400; // webcam power older than this counts as "not tracking"
const SEND_EVERY_MS = 50; // aim stream, 20 per second

const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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
    const res = await window.DeviceMotionEvent.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} cb  onAim({angle, power, source}), onLaunch({angle, power, source}),
 *                     onGrip({held, cancel?}), onTap(), onFeedback(kind, power?)
 */
export function createMotionPad(canvas, { onAim, onLaunch, onGrip, onTap, onFeedback }) {
  const ctx = canvas.getContext('2d');
  const sign = isIOS() ? -1 : 1;
  let enabled = false;
  let flying = false;
  let testMode = false; // aim test: live readout, nothing is sent
  let holding = false;
  let flip = false;
  let pullMode = 'auto'; // 'auto' | 'webcam' | 'tilt'

  let g = null; // smoothed, sign-normalised gravity
  let lastMotionAt = 0;
  let count = 0;
  let hz = 0;
  let hzWindow = performance.now();

  let rot0 = 0;
  let pitch0 = 0;
  let turn = 0; // smoothed aim delta (radians)
  let tiltPower = 0;
  let webcam = { power: 0, at: -Infinity };
  let lastBuzz = 0;
  let raf = 0;

  // ---- sensors ----
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const x = a.x * sign;
    const y = a.y * sign;
    const z = (a.z ?? 0) * sign;
    g = g ? { x: g.x + ALPHA * (x - g.x), y: g.y + ALPHA * (y - g.y), z: g.z + ALPHA * (z - g.z) } : { x, y, z };
    const t = performance.now();
    lastMotionAt = t;
    count++;
    if (t - hzWindow >= 1000) {
      hz = Math.round((count * 1000) / (t - hzWindow));
      count = 0;
      hzWindow = t;
    }
  }
  window.addEventListener('devicemotion', onMotion);

  const sensorsLive = () => performance.now() - lastMotionAt < 1500;
  /** In-plane rotation like a steering wheel; 0 when the phone is upright. */
  const rotation = () => (g ? Math.atan2(g.x, g.y) : 0);
  /** Top of the phone tipped back towards you, in degrees (0 = upright, 90 = flat, screen up). */
  const pitch = () => (g ? deg(Math.atan2(g.z, Math.hypot(g.x, g.y))) : 0);

  function update() {
    if (!g) return;
    if (holding || testMode) {
      let d = wrapPi(rotation() - rot0);
      if (flip) d = -d;
      const dz = (DEAD_ZONE_DEG * Math.PI) / 180;
      d = Math.abs(d) < dz ? 0 : d - Math.sign(d) * dz;
      d = clamp(d, (-MAX_TURN_DEG * Math.PI) / 180, (MAX_TURN_DEG * Math.PI) / 180);
      turn += ALPHA * (d - turn);
      const raw = clamp((pitch() - pitch0) / TILT_FULL_DEG, 0, 1);
      tiltPower += ALPHA * (raw - tiltPower);
    }
  }

  const elevationDeg = () => clamp(BASE_DEG + deg(turn), ELEV_MIN, ELEV_MAX);
  const aimAngle = () => (-elevationDeg() * Math.PI) / 180; // contract: negative = up
  const webcamLive = () => performance.now() - webcam.at < WEBCAM_FRESH_MS;
  function source() {
    if (pullMode === 'webcam') return 'webcam';
    if (pullMode === 'tilt') return 'tilt';
    return webcamLive() ? 'webcam' : 'tilt';
  }
  const power = () => (source() === 'webcam' ? (webcamLive() ? webcam.power : 0) : tiltPower);

  function zero() {
    rot0 = rotation();
    pitch0 = pitch();
    turn = 0;
    tiltPower = 0;
    lastBuzz = 0;
  }

  // ---- input ----
  canvas.addEventListener('pointerdown', (e) => {
    unlock();
    if (flying) return onTap?.();
    if (testMode) return zero();
    if (!enabled || holding || isLandscape()) return;
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
    const p = power();
    const src = source();
    if (cancel || !enabled || p < MIN_POWER) {
      onAim({ angle: aimAngle(), power: 0, source: src });
      onGrip?.({ held: false, cancel: true });
      if (!cancel && enabled) onFeedback?.('nopull');
      return;
    }
    onGrip?.({ held: false });
    onLaunch({ angle: aimAngle(), power: p, source: src });
    navigator.vibrate?.([40, 30, 70]);
    twang(p);
    onFeedback?.('launched', p);
  }
  canvas.addEventListener('pointerup', () => release(false));
  canvas.addEventListener('pointercancel', () => release(true));
  canvas.style.touchAction = 'none';

  // ---- stream + draw ----
  let lastSent = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    update();
    if (holding && enabled) {
      const p = power();
      if (now - lastSent >= SEND_EVERY_MS) {
        lastSent = now;
        onAim({ angle: aimAngle(), power: p, source: source(), hz });
      }
      const step = Math.floor(p * 4); // buzz harder at each quarter
      if (step > lastBuzz) navigator.vibrate?.(10 + step * 15);
      lastBuzz = Math.max(lastBuzz, step);
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
  function draw() {
    const { w, h } = size();
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    if (isLandscape()) {
      ctx.fillStyle = INK;
      ctx.font = `${Math.min(30, w / 13)}px 'Permanent Marker', system-ui, sans-serif`;
      ctx.fillText('Hold your phone upright', w / 2, h / 2);
      return;
    }
    const active = enabled || flying || testMode;
    ctx.globalAlpha = active ? 1 : 0.35;
    const cx = w * 0.2;
    const cy = h * 0.66;
    const R = Math.min(w * 0.7, h * 0.5);
    const live = holding || testMode;
    const el = live ? elevationDeg() : BASE_DEG;
    const a = (-el * Math.PI) / 180;

    // range arc 0-85°
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, (-ELEV_MAX * Math.PI) / 180, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // big arrow, same direction as the slingshot arrow on the big screen
    const len = R * (0.55 + 0.45 * (live ? power() : 0.4));
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
    ctx.font = "44px 'Permanent Marker', system-ui, sans-serif";
    ctx.fillText(`${Math.round(el)}°`, w * 0.68, h * 0.2);
    ctx.font = "16px 'Permanent Marker', system-ui, sans-serif";
    ctx.fillText(live ? '← higher   turn   flatter →' : 'hold anywhere to grip', w * 0.68, h * 0.2 + 26);

    // power meter
    const p = live ? power() : 0;
    const mw = w * 0.84;
    const mx = (w - mw) / 2;
    const my = h - 64;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(mx, my, mw, 26);
    ctx.fillStyle = RED;
    ctx.fillRect(mx + 3, my + 3, (mw - 6) * p, 20);
    ctx.fillStyle = INK;
    ctx.font = "16px 'Permanent Marker', system-ui, sans-serif";
    const src = source();
    const how = src === 'webcam' ? 'pull your hand back (webcam)' : 'tip the top back towards you (tilt)';
    ctx.fillText(`${Math.round(p * 100)}% · ${how}`, w / 2, my - 8);

    // sensor readout for tuning
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = '#6d655d';
    ctx.fillText(
      g ? `rot ${deg(rotation()).toFixed(0)}° · tilt ${pitch().toFixed(0)}° · ${hz} Hz · ${sign < 0 ? 'iOS' : 'Android'}${flip ? ' · flipped' : ''}` : 'no motion data yet',
      w / 2,
      h - 14,
    );
    ctx.globalAlpha = 1;
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
    /** Aim test: live angle and pull on the phone only (tap to re-centre). */
    setTestMode(v) {
      testMode = v;
      if (v) zero();
    },
    setFlip(v) {
      flip = !!v;
    },
    setPullMode(m) {
      pullMode = m;
    },
    /** power:update from the display (webcam pull). */
    setWebcamPower(p) {
      webcam = { power: clamp(Number(p) || 0, 0, 1), at: performance.now() };
    },
    debug: () => ({ rot: deg(rotation()), pitch: pitch(), hz, elevation: elevationDeg(), power: power(), source: source(), holding }),
    resize,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('devicemotion', onMotion);
    },
  };
}
