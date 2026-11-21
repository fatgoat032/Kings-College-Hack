// Angry Sketches sound effects. Everything is generated in code, no audio
// files: ZzFX (src/game/vendor/zzfx.js) makes the tonal retro bleeps, and
// filtered white-noise bursts (BiquadFilter) make the paper and pencil sounds.
//
//   const sfx = createSfx();
//   addEventListener('pointerdown', () => sfx.unlock());  // first gesture
//   sfx.play('hitWood', { force: 0.8 });
//
// Browsers only allow audio after a user gesture, so every call is a silent
// no-op until unlock() has run. Nothing in here ever throws.

import { zzfxG, zzfxBuffer } from './vendor/zzfx.js';

/* ============================== PRESETS ===================================
 * Tune every sound here.
 *
 *   gain      mix level at the default force (0.5). Hits and pop loudest.
 *   hit       true = voice-limited (see MIX) and force nudges the pitch up.
 *   pitchVar  random pitch spread per play (default MIX.pitchVar = ±6%).
 *   layers    all played together, each one either:
 *     { zzfx: [ZzFX params], delay, semi, rate, gain }
 *        params in order: volume, randomness (ignored, we add our own),
 *        frequency, attack, sustain, release, shape (0 sin 1 tri 2 saw 3 tan
 *        4 noise 5 square), shapeCurve, slide (1 = +500 Hz/s), deltaSlide,
 *        pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush,
 *        delay, sustainVolume, decay, tremolo, filter (+ highpass, - lowpass)
 *        `semi` shifts by semitones, `rate` scales playback speed.
 *     { noise: 'bandpass' | 'lowpass' | 'highpass', freq, freqEnd, q,
 *       dur, attack, hold, delay, gain,
 *       grains (n random crackles, for crumple/shatter),
 *       rough  (0-1 choppy amplitude, for tears and scratches) }
 *
 *   stretch and whistle are used by stretch() and startWhistle().
 * ======================================================================== */

// Shared tonal building blocks (C5 = 523.25 Hz; use `semi` for other notes).
const NOTE = [1, 0, 523.25, .005, .05, .1, 5, 1, , , , , , , , , , .7];          // square bleep
const NOTE_SOFT = [1, 0, 523.25, .005, .06, .14, 1, 1, , , , , , , , , , .7];    // triangle bleep
const NOTE_LONG = [1, 0, 523.25, .02, .55, .45, 5, 1, , , , , .08, , , , , .6, , .2];
const HEH = [1, 0, 700, .004, .025, .05, 1, 1, -1.5];                         // laugh syllable
const CREAK = [1, 0, 130, .008, .05, .05, 2, 2, 3, , , , .02, .3, , , , .8, , .5, -1800];

export const PRESETS = {
  // --- slingshot -----------------------------------------------------------
  grab: { gain: .55, layers: [
    { zzfx: CREAK },
    { noise: 'bandpass', freq: 900, q: 2, dur: .08, attack: .01, rough: .7, gain: .8 },
  ] },
  launch: { gain: .6, layers: [
    { zzfx: [1, 0, 190, .005, .12, .18, 1, 1.5, 6, , , , .035, , , , , .8, , .4] }, // springy twang
    { noise: 'bandpass', freq: 500, freqEnd: 2600, q: 1.5, dur: .38, attack: .1, gain: 3 }, // whoosh
  ] },
  squawk: { gain: .5, pitchVar: .25, layers: [
    { zzfx: [1, 0, 700, .01, .06, .1, 2, 2.5, -3, , 180, .035, , .6, , .05, , .9, , , -3500] },
  ] },

  // --- impacts (voice-limited) ---------------------------------------------
  hitWood: { gain: 1.2, hit: true, layers: [
    { zzfx: [1, 0, 330, 0, .01, .09, 1, 1.5, -1] },
    { zzfx: [1, 0, 780, 0, .005, .04, 0, 1, -2], gain: .4 },
    { noise: 'bandpass', freq: 1400, q: 4, dur: .05, attack: .001, gain: 2.5 },
  ] },
  hitIce: { gain: 1, hit: true, layers: [
    { zzfx: [1, 0, 2300, 0, .01, .22, 0], gain: .5 },
    { zzfx: [1, 0, 3150, 0, .01, .16, 0], gain: .4, delay: .03 },
    { noise: 'highpass', freq: 6000, q: .7, dur: .08, attack: .001, gain: 1.4 },      // crack
    { noise: 'highpass', freq: 3500, q: .7, dur: .35, grains: 18, gain: 1.4 },        // shards
  ] },
  hitStone: { gain: .9, hit: true, layers: [
    { zzfx: [1, 0, 90, 0, .03, .22, 0, 1, -.2, , , , , .3] },
    { noise: 'lowpass', freq: 500, q: .8, dur: .18, attack: .002, rough: .4, gain: 2.2 },
  ] },
  hitGround: { gain: 1.2, hit: true, layers: [
    { noise: 'lowpass', freq: 350, q: .7, dur: .14, attack: .003, gain: 3 },
    { zzfx: [1, 0, 70, 0, .01, .1, 0], gain: .5 },
  ] },
  tear: { gain: .8, hit: true, layers: [
    { noise: 'bandpass', freq: 2200, freqEnd: 1400, q: 1.2, dur: .32, attack: .01, hold: .15, rough: .85, gain: 2.5 },
    { noise: 'highpass', freq: 5000, q: .7, dur: .3, grains: 12, gain: 1 },          // fibre snaps
  ] },
  crumple: { gain: 1, hit: true, layers: [
    { noise: 'bandpass', freq: 2800, q: .8, dur: .45, attack: .005, hold: .25, grains: 30, gain: 2.2 },
    { noise: 'lowpass', freq: 900, q: .7, dur: .4, grains: 10, gain: 1.5 },
  ] },
  rumble: { gain: .8, layers: [
    { noise: 'lowpass', freq: 140, q: 1, dur: 1.3, attack: .06, hold: .3, rough: .6, gain: 5 },
    { zzfx: [1, 0, 45, .05, .4, .7, 0, 1, , , , , .07, .4, , , , .8, , .4], gain: .6 },
    { noise: 'bandpass', freq: 700, q: 1, dur: 1.1, grains: 20, gain: 1.2 },          // debris
  ] },
  tnt: { gain: 1, layers: [
    { zzfx: [1, 0, 90, .01, .25, .9, 4, 2, -.05, , , , , 1, , .4, , .5] },           // crunchy bitcrush
    { zzfx: [1, 0, 55, 0, .1, .6, 0, 1, -.05], gain: .7 },                            // sub boom
    { noise: 'lowpass', freq: 260, freqEnd: 80, q: .8, dur: 1.2, attack: .005, hold: .1, rough: .5, gain: 4 },
    { noise: 'bandpass', freq: 2500, q: .8, dur: .7, grains: 25, gain: 1.2, delay: .05 }, // debris
  ] },

  // --- blobs -----------------------------------------------------------------
  squeak: { gain: .18, pitchVar: .12, layers: [
    { zzfx: [1, 0, 1100, .01, .02, .04, 0, 1, 40] },
    { zzfx: [1, 0, 1100, .01, .02, .04, 0, 1, 40], semi: 3, delay: .08 },
  ] },
  pop: { gain: 1.1, layers: [
    { zzfx: [1, 0, 300, 0, .02, .05, 0, 1, 40] },
    { noise: 'highpass', freq: 1500, q: .7, dur: .03, attack: .001, gain: 1.2 },
  ] },
  laugh: { gain: .2, pitchVar: .1, layers: [
    { zzfx: HEH },
    { zzfx: HEH, delay: .085, semi: -1 },
    { zzfx: HEH, delay: .17, semi: 1 },
    { zzfx: HEH, delay: .255, semi: -2 },
    { zzfx: HEH, delay: .34, semi: -4 },
  ] },
  sigh: { gain: .15, layers: [
    { zzfx: [1, 0, 600, .1, .15, .4, 0, 1, -.8] },
    { noise: 'lowpass', freq: 900, freqEnd: 400, q: .7, dur: .6, attack: .15, gain: 1.5 },
  ] },

  // --- pencil and paper UI ---------------------------------------------------
  scratch: { gain: .7, layers: [
    { noise: 'bandpass', freq: 3800, q: 3, dur: .16, attack: .01, rough: .9, gain: 5 },
    { noise: 'bandpass', freq: 3200, q: 3, dur: .14, attack: .01, rough: .9, gain: 5, delay: .17 },
  ] },
  blink: { gain: .4, layers: [
    { zzfx: [1, 0, 2000, 0, .01, .04, 0, 1, 60] },
  ] },
  stamp: { gain: .65, layers: [
    { zzfx: [1, 0, 140, 0, .02, .12, 0, 1, -.5] },
    { noise: 'lowpass', freq: 1200, q: .7, dur: .07, attack: .001, gain: 2.5 },
    { noise: 'highpass', freq: 3000, q: .7, dur: .015, attack: .001, gain: 1 },
  ] },
  click: { gain: .5, layers: [
    { noise: 'highpass', freq: 3000, q: .7, dur: .02, attack: .001, gain: 1.5 },
    { zzfx: [1, 0, 1500, 0, .005, .015, 0], gain: .4 },
  ] },
  ability: { gain: .35, layers: [
    { noise: 'bandpass', freq: 400, freqEnd: 3500, q: 2, dur: .45, attack: .3, gain: 3 },
    { zzfx: [1, 0, 300, .02, .2, .12, 1, 1, 8] },
  ] },

  // --- jingles -----------------------------------------------------------------
  jingle: { gain: .3, pitchVar: .02, layers: [
    { zzfx: NOTE },
    { zzfx: NOTE, semi: 4, delay: .08 },
    { zzfx: NOTE, semi: 7, delay: .16 },
    { zzfx: NOTE_SOFT, semi: 12, delay: .26 },
  ] },
  fanfare: { gain: .35, pitchVar: .02, layers: [
    { zzfx: NOTE, semi: -5 },
    { zzfx: NOTE, semi: 0, delay: .1 },
    { zzfx: NOTE, semi: 4, delay: .2 },
    { zzfx: NOTE, semi: 7, delay: .3 },
    { zzfx: NOTE, semi: 4, delay: .45 },
    { zzfx: NOTE_LONG, semi: 12, delay: .6 },
    { zzfx: NOTE_LONG, semi: 7, delay: .6, gain: .6 },
    { zzfx: NOTE_SOFT, semi: 4, delay: .6, gain: .6 },
    { zzfx: NOTE_SOFT, semi: -12, delay: .6, gain: .7 },
  ] },

  // --- used by stretch() and startWhistle() ------------------------------------
  stretch: { gain: .35, layers: [{ zzfx: [1, 0, 150, .005, .03, .04, 2, 2, 2, , , , .015, .3, , , , .8, , .4, -2000] }] },
  whistle: { gain: .05, freq: 1250, freqEnd: 750, glide: 2.5, vibratoHz: 7, vibratoDepth: 18, fadeIn: .12, fadeOut: .3, maxDur: 4 },
};

// Global mixing rules.
export const MIX = {
  master: .7,          // master volume
  pitchVar: .06,       // ±6% random pitch on every play
  volVar: .1,          // ±10% random volume on every play
  maxHits: 4,          // at most this many hit sounds ...
  hitWindowMs: 120,    // ... within this window; extras are dropped
  stretchEveryMs: 80,  // stretch() throttle
};

const rand = (spread) => 1 + (Math.random() * 2 - 1) * spread;
const clamp01 = (v, fallback) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : fallback);

// createSfx({ context }) — pass a context (e.g. an OfflineAudioContext) only
// for testing; normally the AudioContext is created by unlock().
export function createSfx({ context = null } = {}) {
  const injected = !!context;
  let ctx = null;
  let master = null;   // volume
  let out = null;      // mute switch, after the compressor
  let muted = false;
  let volume = MIX.master;
  let noiseBuf = null;
  let whistle = null;
  let lastStretch = -Infinity;
  let recentHits = [];
  const buffers = new Map(); // ZzFX params array -> AudioBuffer

  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = context || (AC ? new AC() : null);
        if (!ctx) return;
        master = ctx.createGain();
        master.gain.value = volume;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = .003;
        comp.release.value = .2;
        out = ctx.createGain();
        out.gain.value = muted ? 0 : 1;
        master.connect(comp).connect(out).connect(ctx.destination);
      }
      if (!injected && ctx.state !== 'running' && ctx.state !== 'closed') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
        // iOS needs a sound started inside the gesture.
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.start();
      }
    } catch { /* audio unavailable: stay silent */ }
  }

  const ready = () => !!ctx && !muted && (injected || ctx.state === 'running');

  function setMuted(m) {
    muted = !!m;
    try {
      if (out) out.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, .02);
      if (muted) stopWhistle();
    } catch { /* ignore */ }
    return muted;
  }
  const toggleMute = () => setMuted(!muted);
  const isMuted = () => muted;

  function setVolume(v) {
    volume = clamp01(v, MIX.master);
    try { if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, .02); } catch { /* ignore */ }
  }

  // --- layer players ---------------------------------------------------------

  function zzfxLayer(params, t, vol, rate) {
    let buf = buffers.get(params);
    if (!buf) {
      const p = params.slice();
      p[1] = 0; // no built-in randomness; play() adds its own
      buf = zzfxBuffer(ctx, zzfxG(...p));
      buffers.set(params, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(master);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    src.start(t);
  }

  function makeNoise(dur, grains, rough) {
    const sr = ctx.sampleRate;
    const n = Math.max(1, Math.floor(dur * sr));
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    if (grains) {
      // sparse crackles: short decaying noise bursts at random times
      for (let k = 0; k < grains; k++) {
        const start = Math.floor(Math.random() * n * .9);
        const len = Math.floor((.003 + Math.random() * .02) * sr);
        const amp = .4 + Math.random() * .6;
        for (let i = 0; i < len && start + i < n; i++) d[start + i] += (Math.random() * 2 - 1) * amp * (1 - i / len);
      }
    } else {
      // white noise, optionally chopped into rough random-amplitude chunks
      let amp = 1, next = 0;
      for (let i = 0; i < n; i++) {
        if (rough && i >= next) { amp = 1 - rough * Math.random(); next = i + (.003 + Math.random() * .006) * sr; }
        d[i] = (Math.random() * 2 - 1) * amp;
      }
    }
    return buf;
  }

  function noiseLayer(L, t, vol, rate) {
    const dur = L.dur || .1;
    const src = ctx.createBufferSource();
    let offset = 0;
    if (L.grains || L.rough) {
      src.buffer = makeNoise(dur, L.grains, L.rough);
    } else {
      if (!noiseBuf) noiseBuf = makeNoise(2, 0, 0);
      src.buffer = noiseBuf;
      offset = Math.random() * Math.max(0, 2 - dur);
    }
    const f = ctx.createBiquadFilter();
    f.type = L.noise;
    f.Q.value = L.q ?? 1;
    const nyq = ctx.sampleRate / 2 - 100;
    f.frequency.setValueAtTime(Math.min(nyq, L.freq * rate), t);
    if (L.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.min(nyq, L.freqEnd * rate), t + dur);
    const g = ctx.createGain();
    const attack = Math.max(.001, L.attack ?? .005);
    const hold = L.hold || 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.max(1e-4, vol), t + attack);
    g.gain.setValueAtTime(Math.max(1e-4, vol), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(1e-4, t + Math.max(dur, attack + hold + .01));
    src.connect(f).connect(g).connect(master);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.start(t, offset, dur + .02);
  }

  function voice(preset, vol, rate) {
    const t0 = ctx.currentTime + .005;
    for (const L of preset.layers) {
      const t = t0 + (L.delay || 0);
      const r = rate * (L.rate || 1) * (L.semi ? 2 ** (L.semi / 12) : 1);
      const v = vol * (L.gain ?? 1);
      if (L.zzfx) zzfxLayer(L.zzfx, t, v, r);
      else if (L.noise) noiseLayer(L, t, v, r);
    }
  }

  // --- public ----------------------------------------------------------------

  // play(name, { force = 0.5, pitch = 1 })
  function play(name, opts) {
    try {
      if (!ready()) return;
      let { force = .5, pitch = 1 } = opts || {};
      const preset = PRESETS[name];
      if (!preset || !preset.layers) return;
      force = clamp01(force, .5);
      if (preset.hit) {
        const now = performance.now();
        recentHits = recentHits.filter((t) => now - t < MIX.hitWindowMs);
        if (recentHits.length >= MIX.maxHits) return;
        recentHits.push(now);
      }
      let rate = (pitch > 0 ? +pitch : 1) * rand(preset.pitchVar ?? MIX.pitchVar);
      if (preset.hit) rate *= .94 + .12 * force; // harder hits a touch brighter
      const vol = (preset.gain ?? 1) * (.4 + 1.2 * force) * rand(MIX.volVar);
      voice(preset, vol, rate);
    } catch { /* never throw from a sound call */ }
  }

  function stretch(power = 0) {
    try {
      const now = performance.now();
      if (now - lastStretch < MIX.stretchEveryMs || !ready()) return;
      lastStretch = now;
      const p = clamp01(power, 0);
      const preset = PRESETS.stretch;
      voice(preset, preset.gain * (.6 + .6 * p) * rand(MIX.volVar), (.7 + 1.1 * p) * rand(.03));
    } catch { /* ignore */ }
  }

  function startWhistle() {
    try {
      if (!ready()) return;
      stopWhistle();
      const W = PRESETS.whistle;
      const t = ctx.currentTime;
      const end = t + W.maxDur;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(W.freq * rand(MIX.pitchVar), t);
      osc.frequency.exponentialRampToValueAtTime(W.freqEnd, t + W.glide);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = W.vibratoHz;
      const depth = ctx.createGain();
      depth.gain.value = W.vibratoDepth;
      lfo.connect(depth).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(W.gain, t + W.fadeIn);
      g.gain.setValueAtTime(W.gain, end - W.fadeOut); // auto fade if never stopped
      g.gain.linearRampToValueAtTime(0, end);
      osc.connect(g).connect(master);
      osc.start(t);
      lfo.start(t);
      osc.stop(end + .05);
      lfo.stop(end + .05);
      const w = { osc, lfo, depth, g };
      osc.onended = () => {
        try { osc.disconnect(); lfo.disconnect(); depth.disconnect(); g.disconnect(); } catch { /* ignore */ }
        if (whistle === w) whistle = null;
      };
      whistle = w;
    } catch { /* ignore */ }
  }

  function stopWhistle() {
    const w = whistle;
    whistle = null;
    if (!w || !ctx) return;
    try {
      const t = ctx.currentTime;
      const fade = PRESETS.whistle.fadeOut;
      w.g.gain.cancelScheduledValues(t);
      w.g.gain.setValueAtTime(w.g.gain.value, t);
      w.g.gain.linearRampToValueAtTime(0, t + fade);
      w.osc.stop(t + fade + .02);
      w.lfo.stop(t + fade + .02);
    } catch { /* ignore */ }
  }

  return { unlock, setMuted, toggleMute, isMuted, setVolume, play, stretch, startWhistle, stopWhistle };
}
