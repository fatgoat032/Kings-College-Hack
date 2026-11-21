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
function collectPictures(src, prefix = '', depth = 0, out = []) {
  if (!src || typeof src !== 'object' || depth > 2) return out;
  for (const [k, v] of Object.entries(src)) {
    const label = prefix ? `${prefix}.${k}` : k;
    if (isPic(v)) out.push([label, v]);
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'level') collectPictures(v, label, depth + 1, out);
  }
  return out;
}

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
    pictures.push(...collectPictures(result), ...collectPictures(error));
    const level = result?.level || error?.level;
    let summary = '';
    if (level) {
      const counts = {};
      for (const b of level.blocks || []) counts[b.material] = (counts[b.material] || 0) + 1;
      const thin = (level.blocks || []).map((b) => Math.round(Math.min(b.w, b.h)));
      summary = `blocks: ${Object.entries(counts).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'} · pigs: ${level.pigs?.length ?? 0} · thickness: ${thin.join(', ')}`;
    }
    if (error) summary = `ERROR: ${error.message}${summary ? ` · ${summary}` : ''}`;
    if (result?.warnings?.length) summary += ` · warnings: ${result.warnings.join('; ')}`;
    const used = level?.meta?.detector;
    if (detector || used) summary += ` · detector: ${used ?? '?'}${detector && used && detector !== used ? ` (asked ${detector}, fell back)` : ''}`;
    if (result?.timings?.claude) summary += ` · Claude ${Math.round(result.timings.claude)} ms`;
    if (result?.timings?.total) summary += ` · ${Math.round(result.timings.total)} ms`;
    last = { when: new Date().toLocaleTimeString(), pictures, summary };
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
