// Full-screen slingshot pad. Drag back from the centre: angle is the drag direction
// reversed (0 = right, negative = up), power = drag length / max. Release fires.
const MIN_POWER = 0.1;

export function createPad(canvas, { onAim, onLaunch, onTap }) {
  const ctx = canvas.getContext('2d');
  let enabled = false;
  let drag = null; // { x, y } finger position relative to centre, CSS px
  let flying = false;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top, max: Math.min(r.width, r.height) * 0.4 };
  };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function aimOf(d, max) {
    const len = Math.hypot(d.x, d.y);
    return { angle: Math.atan2(-d.y, -d.x), power: Math.min(1, len / max) };
  }

  function draw() {
    const { w, h, max } = size();
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = enabled ? 1 : 0.3;

    // max-pull ring
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = '#2b2622';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, max, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // fork
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7a4a24';
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 20);
    ctx.lineTo(cx, cy + 20);
    ctx.lineTo(cx + 30, cy - 20);
    ctx.moveTo(cx, cy + 20);
    ctx.lineTo(cx, cy + 70);
    ctx.stroke();

    const p = drag ? { x: cx + clampLen(drag, max).x, y: cy + clampLen(drag, max).y } : { x: cx, y: cy - 10 };
    // band
    ctx.strokeStyle = '#3b2314';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 20);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(cx + 30, cy - 20);
    ctx.stroke();
    // ball
    ctx.fillStyle = '#d8322b';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.fill();

    if (drag) {
      const { angle, power } = aimOf(drag, max);
      // direction arrow
      ctx.strokeStyle = '#2b2622';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * max * 1.2, cy + Math.sin(angle) * max * 1.2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#2b2622';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(power * 100)}%`, cx, 36);
    }
    ctx.globalAlpha = 1;
  }

  function clampLen(d, max) {
    const len = Math.hypot(d.x, d.y);
    return len > max ? { x: (d.x / len) * max, y: (d.y / len) * max } : d;
  }

  function rel(e) {
    const { w, h, left, top } = size();
    return { x: e.clientX - left - w / 2, y: e.clientY - top - h / 2 };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (flying) return onTap?.();
    if (!enabled) return;
    canvas.setPointerCapture?.(e.pointerId);
    drag = rel(e);
    onAim(aimOf(drag, size().max));
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag = rel(e);
    onAim(aimOf(drag, size().max));
    draw();
  });
  const release = (cancel) => {
    if (!drag) return;
    const a = aimOf(drag, size().max);
    drag = null;
    if (!cancel && enabled && a.power >= MIN_POWER) {
      onLaunch(a);
      navigator.vibrate?.(60);
    } else {
      onAim({ angle: a.angle, power: 0 });
    }
    draw();
  };
  canvas.addEventListener('pointerup', () => release(false));
  canvas.addEventListener('pointercancel', () => release(true));
  canvas.style.touchAction = 'none';
  window.addEventListener('resize', resize);
  resize();

  return {
    setEnabled(v) {
      enabled = v;
      if (!v) drag = null;
      draw();
    },
    setFlying(v) {
      flying = v;
    },
    resize,
  };
}
