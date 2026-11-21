// Vision debug overlay on the big screen, toggled with D.
// Shows the last scan: the raw phone photo, every debug canvas vision returned
// (debugCanvas, page, masks per colour, …) and a count of blocks per material.
// It picks up whatever canvases vision adds, so abdurub10's richer overlay appears here
// without changes on this side.

const isPic = (v) =>
  typeof HTMLCanvasElement !== 'undefined' &&
  (v instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas) || v instanceof HTMLImageElement || v instanceof ImageData);

function toCanvas(v) {
  if (v instanceof HTMLCanvasElement) return v;
  const c = document.createElement('canvas');
  if (v instanceof ImageData) {
    c.width = v.width;
    c.height = v.height;
    c.getContext('2d').putImageData(v, 0, 0);
  } else {
    c.width = v.naturalWidth || v.width;
    c.height = v.naturalHeight || v.height;
    c.getContext('2d').drawImage(v, 0, 0);
  }
  return c;
}

/** Collect labelled pictures from a parseFort result or error (e.g. debug.masks.red), 3 levels deep. */
function collectPictures(src, prefix = '', depth = 0, out = [], skip = []) {
  if (!src || typeof src !== 'object' || depth > 2) return out;
  for (const [k, v] of Object.entries(src)) {
    if (skip.includes(k)) continue;
    const label = prefix ? `${prefix}.${k}` : k;
    if (isPic(v)) out.push([label, v]);
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'level') collectPictures(v, label, depth + 1, out);
  }
  return out;
}

const MAT_COLOUR = { wood: '#7a4a24', ice: '#5aa7e8', stone: '#9a9590', tnt: '#e2463c' };
const VIEW = { x: 850, y: 250, w: 750, h: 620 }; // fort zone of the 1600 x 900 world

/** Draw a level (fort zone only) so candidates can be compared side by side. */
export function renderLevel(level, scale = 0.5) {
  const c = document.createElement('canvas');
  c.width = VIEW.w * scale;
  c.height = VIEW.h * scale;
  const x = c.getContext('2d');
  x.fillStyle = '#fbf7ec';
  x.fillRect(0, 0, c.width, c.height);
  x.scale(scale, scale);
  x.translate(-VIEW.x, -VIEW.y);
  x.strokeStyle = '#2b2622';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(VIEW.x, 850);
  x.lineTo(VIEW.x + VIEW.w, 850);
  x.stroke();
  x.lineWidth = 2;
  for (const b of level?.blocks || []) {
    x.fillStyle = MAT_COLOUR[b.material] || '#888';
    x.beginPath();
    if (b.shape === 'poly') {
      b.vertices.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.closePath();
      x.fill();
      x.stroke();
    } else {
      x.save();
      x.translate(b.x, b.y);
      x.rotate(b.angle || 0);
      x.rect(-b.w / 2, -b.h / 2, b.w, b.h);
      x.fill();
      x.stroke();
      x.restore();
    }
  }
  for (const p of level?.pigs || []) {
    x.fillStyle = '#5cb85c';
    x.beginPath();
    x.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    x.fill();
    x.stroke();
  }
  return c;
}

const countLine = (level) => {
  if (!level) return '';
  const counts = {};
  for (const b of level.blocks || []) counts[b.material] = (counts[b.material] || 0) + 1;
  return `${Object.entries(counts).map(([m, n]) => `${m} ${n}`).join(', ') || 'no blocks'} · pigs ${level.pigs?.length ?? 0}`;
};

export function createScanDebug() {
  const root = document.createElement('section');
  root.id = 'scanDebug';
  root.hidden = true;
  document.body.append(root);
  let last = null;

  function render() {
    root.replaceChildren();
    const head = document.createElement('h3');
    head.textContent = last ? `Last scan · ${last.when}` : 'No scan yet';
    root.append(head);
    if (!last) return;

    const info = document.createElement('p');
    info.textContent = last.summary;
    root.append(info);

    // auto-pick: every candidate's level side by side, the chosen one outlined, plus why
    if (last.candidates) {
      const pick = document.createElement('p');
      pick.innerHTML = '';
      pick.textContent = `auto-pick chose ${last.pick?.chose ?? '?'}${last.pick?.reason ? `: ${last.pick.reason}` : ''}`;
      pick.style.fontWeight = '800';
      root.append(pick);
      const row = document.createElement('div');
      row.className = 'grid';
      for (const [name, cand] of Object.entries(last.candidates)) {
        if (!cand) continue;
        const fig = document.createElement('figure');
        if (name === last.pick?.chose) fig.style.outline = '6px solid #d8322b';
        const cap = document.createElement('figcaption');
        const bits = [name.toUpperCase()];
        if (cand.ms != null) bits.push(`${Math.round(cand.ms)} ms`);
        if (cand.avgConfidence != null) bits.push(`conf ${cand.avgConfidence.toFixed(2)}`);
        if (cand.complete != null) bits.push(cand.complete ? 'all shapes answered' : 'some shapes unanswered');
        bits.push(cand.ok === false || cand.error ? `FAILED: ${cand.error ?? '?'}` : countLine(cand.level));
        cap.textContent = bits.join(' · ');
        if (cand.level) fig.append(renderLevel(cand.level));
        if (isPic(cand.overlay)) fig.append(toCanvas(cand.overlay));
        fig.append(cap);
        row.append(fig);
      }
      root.append(row);
    }

    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const [label, pic] of last.pictures) {
      const fig = document.createElement('figure');
      const cap = document.createElement('figcaption');
      cap.textContent = label;
      const c = toCanvas(pic);
      fig.append(c, cap);
      grid.append(fig);
    }
    root.append(grid);
  }

  /** Record a scan. `result` is parseFort's result or the thrown error. */
  function record({ photo, result, error, detector }) {
    const pictures = [];
    if (photo) {
      const img = new Image();
      img.src = photo;
      pictures.push(['photo (as sent by the phone)', img]);
    }
    pictures.push(...collectPictures(result, '', 0, [], ['candidates']), ...collectPictures(error));
    const level = result?.level || error?.level;
    let summary = '';
    if (level) {
      const counts = {};
      for (const b of level.blocks || []) counts[b.material] = (counts[b.material] || 0) + 1;
      const thin = (level.blocks || []).map((b) => (b.shape === 'poly' ? 'poly' : Math.round(Math.min(b.w, b.h))));
      summary = `blocks: ${Object.entries(counts).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'} · pigs: ${level.pigs?.length ?? 0} · thickness: ${thin.join(', ')}`;
    }
    if (error) summary = `ERROR: ${error.message}${summary ? ` · ${summary}` : ''}`;
    if (result?.warnings?.length) summary += ` · warnings: ${result.warnings.join('; ')}`;
    const used = level?.meta?.detector;
    if (detector || used) summary += ` · detector: ${used ?? '?'}${detector && used && detector !== used && detector !== 'auto' ? ` (asked ${detector}, fell back)` : ''}`;
    if (result?.timings?.claude) summary += ` · Claude ${Math.round(result.timings.claude)} ms`;
    if (result?.timings?.total) summary += ` · ${Math.round(result.timings.total)} ms`;
    if (!result?.pick && error?.pick) summary += ` · auto-pick: ${error.pick.chose}`;
    if (result?.pick) summary += ` · auto-pick: ${result.pick.chose}`;
    last = { when: new Date().toLocaleTimeString(), pictures, summary, candidates: result?.candidates ?? error?.candidates, pick: result?.pick ?? error?.pick };
    console.info('[scan]', summary, result || error);
    if (!root.hidden) render();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'd' && e.key !== 'D') return;
    root.hidden = !root.hidden;
    if (!root.hidden) render();
  });

  return { record };
}
