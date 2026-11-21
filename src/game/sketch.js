// Shared hand-drawn drawing helpers. Everything on screen is drawn with these
// so it all matches the notebook-sketch style.

export const FONT = '"Permanent Marker", "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';

export const INK = '#2b2622';
export const PAPER = '#fbf7ec';

// Small seeded random so a shape wobbles the same way within one "boil" frame.
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function wobblyLine(ctx, x1, y1, x2, y2, rand, amp = 1.6) {
  for (let pass = 0; pass < 2; pass++) {
    const j = () => (rand() - 0.5) * amp * 2;
    const mx = (x1 + x2) / 2 + j() * 1.5;
    const my = (y1 + y2) / 2 + j() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x1 + j(), y1 + j());
    ctx.quadraticCurveTo(mx, my, x2 + j(), y2 + j());
    ctx.stroke();
  }
}

export function wobblyCircle(ctx, x, y, r, rand, amp = 1.5) {
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    const n = 14;
    const start = rand() * Math.PI * 2;
    for (let i = 0; i <= n + 1; i++) {
      const a = start + (i / n) * Math.PI * 2;
      const rr = r + (rand() - 0.5) * amp * 2;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

export function wobblyRect(ctx, w, h, rand) {
  const x = -w / 2, y = -h / 2;
  wobblyLine(ctx, x, y, x + w, y, rand);
  wobblyLine(ctx, x + w, y, x + w, y + h, rand);
  wobblyLine(ctx, x + w, y + h, x, y + h, rand);
  wobblyLine(ctx, x, y + h, x, y, rand);
}

// Big marker-pen text with a paper-coloured outline so it reads on any background.
export function markerText(ctx, text, x, y, size, color, align = 'left', rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = size * 0.18;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
