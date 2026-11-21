// All sounds are synthesised with Web Audio, so there are no audio files to
// license or load. Browsers only allow audio after a user gesture; unlock()
// is called on the first pointer or key press.

export function createSound() {
  let ctx = null;
  let master = null;
  let muted = false;
  let lastStretch = 0;

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  const ready = () => ctx && !muted && ctx.state === 'running';

  function noise(duration) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(gainValue, attack, decay) {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gainValue, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(master);
    return g;
  }

  function burst({ duration, type = 'lowpass', freq, q = 1, gain = 0.5, sweepTo }) {
    if (!ready()) return;
    const src = noise(duration);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
    src.connect(f).connect(env(gain, 0.005, duration));
    src.start();
  }

  function tone({ freq, to, duration, type = 'sine', gain = 0.3, delay = 0 }) {
    if (!ready()) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  return {
    unlock,
    setMuted(m) { muted = m; },
    stretch(power) {
      const now = performance.now();
      if (now - lastStretch < 90 || power < 0.05) return;
      lastStretch = now;
      tone({ freq: 140 + power * 260, duration: 0.07, type: 'sawtooth', gain: 0.05 });
    },
    launch() {
      burst({ duration: 0.35, type: 'bandpass', freq: 600, sweepTo: 2600, q: 0.8, gain: 0.5 });
      tone({ freq: 220, to: 90, duration: 0.15, type: 'triangle', gain: 0.25 });
    },
    ability() {
      tone({ freq: 300, to: 1200, duration: 0.25, type: 'square', gain: 0.12 });
      burst({ duration: 0.25, type: 'bandpass', freq: 1800, sweepTo: 4000, gain: 0.35 });
    },
    wood() {
      burst({ duration: 0.18, type: 'lowpass', freq: 900, gain: 0.7 });
      tone({ freq: 180, to: 70, duration: 0.12, type: 'square', gain: 0.08 });
    },
    ice() {
      burst({ duration: 0.3, type: 'highpass', freq: 3500, gain: 0.5 });
      [2400, 3100, 3900].forEach((f, i) => tone({ freq: f, duration: 0.18, gain: 0.06, delay: i * 0.03 }));
    },
    stone() {
      burst({ duration: 0.25, type: 'lowpass', freq: 400, gain: 0.8 });
    },
    pop() {
      tone({ freq: 700, to: 140, duration: 0.18, type: 'sine', gain: 0.45 });
      burst({ duration: 0.06, type: 'bandpass', freq: 1500, gain: 0.3 });
    },
    boom() {
      burst({ duration: 0.9, type: 'lowpass', freq: 700, sweepTo: 80, gain: 1 });
      tone({ freq: 90, to: 30, duration: 0.7, type: 'sine', gain: 0.7 });
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, duration: 0.35, type: 'triangle', gain: 0.25, delay: i * 0.12 }));
    },
    lose() {
      [392, 330, 262].forEach((f, i) => tone({ freq: f, duration: 0.4, type: 'triangle', gain: 0.2, delay: i * 0.18 }));
    },
  };
}
