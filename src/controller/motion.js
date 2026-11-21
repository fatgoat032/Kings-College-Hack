// "Real slingshot" mode: hold anywhere on the screen to grab the pouch, tilt the phone
// to aim (streamed as `aim`), swing it forward and lift your thumb to fire. Power comes
// from the peak swing acceleration around the release.
//
// Needs motion sensors, which browsers only give to HTTPS pages (npm run dev:https).
// iOS also needs DeviceMotionEvent.requestPermission() from a tap. When sensors are
// missing, main.js falls back to the drag pad automatically.
import { click, twang, unlock } from './sfx.js';

const PREVIEW_POWER = 0.6; // trajectory preview power while aiming
const PEAK_BEFORE_MS = 450; // swing window before release…
const PEAK_AFTER_MS = 130; // …and just after it
const MIN_SWING = 1.5; // m/s²: below this, lifting the thumb cancels instead of firing
const FULL_SWING = 17; // m/s² extra above MIN_SWING for full power

export const motionSupported = () => window.isSecureContext && 'DeviceMotionEvent' in window;
export const needsPermission = () => typeof window.DeviceMotionEvent?.requestPermission === 'function';

/** Ask iOS for motion + orientation permission. Must be called from a tap. */
export async function requestMotionPermission() {
  unlock();
  try {
    const res = await window.DeviceMotionEvent.requestPermission();
    await window.DeviceOrientationEvent?.requestPermission?.().catch(() => {});
    return res === 'granted';
  } catch {
    return false;
  }
}

export function createMotionPad(canvas, { onAim, onLaunch, onTap, onFeedback }) {
  const ctx = canvas.getContext('2d');
  let enabled = false;
  let flying = false;
  let holding = false;
  let releasing = false;
  let tilt = { beta: 60, gamma: 0, ok: false };
  let samples = []; // { t, a } smoothed linear acceleration magnitude
  let smooth = 0;
  let gravity = null; // low-pass gravity estimate when only accelerationIncludingGravity exists
  let lastMotionAt = 0;
  let raf = 0;

  // ---- sensors ----
  function onOrientation(e) {
    if (e.beta == null) return;
    tilt = { beta: e.beta, gamma: e.gamma ?? 0, ok: true };
  }
  function onMotion(e) {
    let a = e.acceleration;
    if (!a || a.x == null) {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      gravity = gravity
        ? { x: gravity.x * 0.9 + g.x * 0.1, y: gravity.y * 0.9 + g.y * 0.1, z: gravity.z * 0.9 + g.z * 0.1 }
        : { x: g.x, y: g.y, z: g.z };
      a = { x: g.x - gravity.x, y: g.y - gravity.y, z: g.z - gravity.z };
    }
    const mag = Math.hypot(a.x, a.y, a.z);
    smooth = smooth * 0.5 + mag * 0.5;
    const t = performance.now();
    lastMotionAt = t;
    samples.push({ t, a: smooth });
    while (samples.length && samples[0].t < t - 1500) samples.shift();
  }
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);

  /** True once real sensor data has arrived recently. */
  const sensorsLive = () => performance.now() - lastMotionAt < 1500;

  // ---- aim from tilt ----
  // Phone upright (portrait, screen facing you) = flat shot. Tip the top away from you
  // to aim higher: elevation = 90° - beta. In landscape use gamma instead.
  function elevationDeg() {
    const landscape = Math.abs(screen.orientation?.angle ?? window.orientation ?? 0) === 90;
    const raw = landscape ? 90 - Math.abs(tilt.gamma) : 90 - tilt.beta;
    return Math.max(-10, Math.min(80, raw));
  }
  const aimAngle = () => (-elevationDeg() * Math.PI) / 180;

  function peakAround(tRelease) {
    let peak = 0;
    for (const s of samples) if (s.t >= tRelease - PEAK_BEFORE_MS && s.t <= tRelease + PEAK_AFTER_MS) peak = Math.max(peak, s.a);
    return peak;
  }

  // ---- input ----
  canvas.addEventListener('pointerdown', (e) => {
    unlock();
    if (flying) return onTap?.();
    if (!enabled || holding || releasing) return;
    holding = true;
    canvas.setPointerCapture?.(e.pointerId);
    navigator.vibrate?.(15);
    click();
    onFeedback?.('grab');
  });
  const release = async (cancel) => {
    if (!holding) return;
    holding = false;
    if (cancel || !enabled) return onAim({ angle: aimAngle(), power: 0 });
    releasing = true;
    const tRelease = performance.now();
    await new Promise((r) => setTimeout(r, PEAK_AFTER_MS));
    releasing = false;
    const peak = peakAround(tRelease);
    if (peak < MIN_SWING) {
      onAim({ angle: aimAngle(), power: 0 });
      onFeedback?.('noswing');
      return;
    }
    const power = Math.min(1, 0.2 + (0.8 * (peak - MIN_SWING)) / FULL_SWING);
    onLaunch({ angle: aimAngle(), power });
    navigator.vibrate?.([40, 30, 70]);
    twang(power);
    onFeedback?.('launched', power);
  };
  canvas.addEventListener('pointerup', () => release(false));
  canvas.addEventListener('pointercancel', () => release(true));
  canvas.style.touchAction = 'none';

  // ---- draw + stream aim while holding ----
  let lastAimSent = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (holding && now - lastAimSent > 50) {
      lastAimSent = now;
      onAim({ angle: aimAngle(), power: PREVIEW_POWER });
    }
    draw(now);
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

  function draw(now) {
    const { w, h } = size();
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = enabled || flying ? 1 : 0.35;
    const cx = w * 0.25;
    const cy = h * 0.72;
    const R = Math.min(w * 0.65, h * 0.55);
    const el = elevationDeg();

    // protractor arc 0-80°
    ctx.strokeStyle = '#2b2622';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, -(80 * Math.PI) / 180, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    // aim line
    const a = (-el * Math.PI) / 180;
    ctx.strokeStyle = holding ? '#d8322b' : '#2b2622';
    ctx.lineWidth = holding ? 8 : 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
    // pouch
    ctx.fillStyle = '#d8322b';
    ctx.beginPath();
    ctx.arc(cx, cy, holding ? 30 : 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2b2622';
    ctx.textAlign = 'center';
    ctx.font = "36px 'Permanent Marker', system-ui, sans-serif";
    ctx.fillText(`${Math.round(el)}°`, cx + Math.cos(a) * (R * 0.55), cy + Math.sin(a) * (R * 0.55) - 16);

    // live swing meter while holding
    if (holding) {
      const live = Math.min(1, Math.max(0, (smooth - MIN_SWING) / FULL_SWING));
      const mw = w * 0.8;
      ctx.strokeStyle = '#2b2622';
      ctx.lineWidth = 3;
      ctx.strokeRect((w - mw) / 2, h - 46, mw, 22);
      ctx.fillStyle = '#d8322b';
      ctx.fillRect((w - mw) / 2 + 3, h - 43, (mw - 6) * live, 16);
    }
    ctx.globalAlpha = 1;
  }

  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    sensorsLive,
    isHolding: () => holding,
    setEnabled(v) {
      enabled = v;
      if (!v) holding = false;
    },
    setFlying(v) {
      flying = v;
    },
    resize,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
    },
  };
}
