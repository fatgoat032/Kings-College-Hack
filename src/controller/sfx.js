// Tiny Web Audio sounds for the phone: click on grab, twang on release.
// The AudioContext is created/resumed on the first user gesture (unlock()).
let ctx = null;

export function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}

function env(gain, t0, attack, decay, peak) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

/** Short wooden click when the pouch is grabbed. */
export function click() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(1800, t);
  o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
  env(g, t, 0.002, 0.05, 0.25);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.08);
}

/** Rubber-band twang on release; stronger power = higher, louder. */
export function twang(power = 0.7) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  const g = ctx.createGain();
  o.type = 'sawtooth';
  const f0 = 180 + power * 220;
  o.frequency.setValueAtTime(f0 * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.45);
  lfo.frequency.value = 28;
  lfoGain.gain.value = f0 * 0.06;
  lfo.connect(lfoGain).connect(o.frequency);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  env(g, t, 0.004, 0.45, 0.25 + power * 0.25);
  o.connect(filter).connect(g).connect(ctx.destination);
  o.start(t);
  lfo.start(t);
  o.stop(t + 0.5);
  lfo.stop(t + 0.5);
}
