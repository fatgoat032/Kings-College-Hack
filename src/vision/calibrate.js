// Calibration screen for room lighting (plan P3).
//   1. load a photo of a drawing (file or phone camera)
//   2. pick a colour, then TAP a stroke of that colour on the page: its HSV
//      range is set around what you tapped
//   3. fine-tune with sliders; the mask and detections update live
//   4. Save (localStorage) — parseFort() uses the saved settings from then on
//
// Mount it anywhere: mountCalibration(document.getElementById('x'))
// Dev page: /src/vision/calibrate.html
import { loadCv } from './opencv.js';
import { detect } from './pipeline.js';
import { buildLevel, checkLevel } from './geometry.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, resetSettings } from './settings.js';
import { rgbToHsv, rangeAround } from './colour.js';

const COLOURS = [
  { key: 'black', label: 'Wood (black)' },
  { key: 'blue', label: 'Ice (blue)' },
  { key: 'grey', label: 'Stone (pencil)' },
  { key: 'red', label: 'TNT (red)' },
  { key: 'green', label: 'Pig (green)' },
];
const MAX = { h: 180, s: 255, v: 255 };

export function mountCalibration(root) {
  let settings = loadSettings();
  let active = 'black';
  let image = null; // ImageData of the loaded photo
  let flat = null; // { w, h, data } lighting-corrected page for sampling

  root.innerHTML = `
  <div class="cal">
    <div class="cal-top">
      <label class="cal-btn">📷 Load photo <input type="file" accept="image/*" capture="environment" hidden></label>
      <button class="cal-btn" data-act="save">💾 Save</button>
      <button class="cal-btn" data-act="reset">↺ Defaults</button>
      <span class="cal-status">Load a photo of a drawing to start.</span>
    </div>
    <div class="cal-colours"></div>
    <div class="cal-sliders"></div>
    <div class="cal-views">
      <figure><canvas class="cal-page"></canvas><figcaption>Tap a <b class="cal-active-name"></b> stroke to sample it</figcaption></figure>
      <figure><canvas class="cal-mask"></canvas><figcaption>What counts as <b class="cal-active-name"></b> (white)</figcaption></figure>
    </div>
    <pre class="cal-result"></pre>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const status = (t) => ($('.cal-status').textContent = t);
  const pageCanvas = $('.cal-page');
  const maskCanvas = $('.cal-mask');

  // colour buttons
  const colourBox = $('.cal-colours');
  for (const c of COLOURS) {
    const b = document.createElement('button');
    b.className = 'cal-btn cal-colour';
    b.dataset.key = c.key;
    b.textContent = c.label;
    b.onclick = () => { active = c.key; renderControls(); run(); };
    colourBox.append(b);
  }

  function renderControls() {
    colourBox.querySelectorAll('.cal-colour').forEach((b) => b.classList.toggle('on', b.dataset.key === active));
    root.querySelectorAll('.cal-active-name').forEach((e) => (e.textContent = COLOURS.find((c) => c.key === active).label));
    const box = $('.cal-sliders');
    box.innerHTML = '';
    const range = settings.colours[active];
    for (const ch of ['h', 's', 'v']) {
      for (const i of [0, 1]) {
        const id = `${ch}${i}`;
        const row = document.createElement('label');
        row.className = 'cal-slider';
        row.innerHTML = `<span>${ch.toUpperCase()} ${i ? 'max' : 'min'}</span><input type="range" min="0" max="${MAX[ch]}" value="${range[ch][i]}" data-id="${id}"><output>${range[ch][i]}</output>`;
        const input = row.querySelector('input');
        input.oninput = () => {
          settings.colours[active][ch][i] = Number(input.value);
          row.querySelector('output').textContent = input.value;
          run();
        };
        box.append(row);
      }
    }
  }

  // load a photo
  $('input[type=file]').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1280 / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, c.width, c.height);
    image = g.getImageData(0, 0, c.width, c.height);
    run();
  };

  // tap to sample (average a 7×7 patch of the lighting-corrected page)
  pageCanvas.onclick = (e) => {
    if (!flat) return;
    const rect = pageCanvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * flat.w);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * flat.h);
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = Math.min(flat.w - 1, Math.max(0, x + dx));
        const py = Math.min(flat.h - 1, Math.max(0, y + dy));
        const i = (py * flat.w + px) * 3;
        r += flat.data[i]; g += flat.data[i + 1]; b += flat.data[i + 2]; n++;
      }
    }
    const hsv = rgbToHsv(r / n, g / n, b / n);
    settings.colours[active] = rangeAround(active, hsv);
    status(`Sampled ${active}: H ${hsv[0]} S ${hsv[1]} V ${hsv[2]}. Check the mask, then Save.`);
    renderControls();
    run();
  };

  root.querySelector('[data-act=save]').onclick = () => {
    status(saveSettings(settings) ? '✅ Saved. parseFort() will use these settings.' : '⚠ Could not save (private browsing?)');
  };
  root.querySelector('[data-act=reset]').onclick = () => {
    settings = resetSettings();
    status('Back to default colours (saved settings cleared).');
    renderControls();
    run();
  };

  let pending = false;
  async function run() {
    if (!image || pending) return;
    pending = true;
    requestAnimationFrame(async () => {
      pending = false;
      const cv = await loadCv();
      const t = performance.now();
      const found = detect(cv, image, settings);
      try {
        cv.imshow(pageCanvas, found.debug.page);
        cv.imshow(maskCanvas, found.debug.masks[active]);
        flat = { w: found.debug.flat.cols, h: found.debug.flat.rows, data: found.debug.flat.data.slice() };
      } finally {
        found.debug.page.delete();
        found.debug.flat.delete();
        for (const m of Object.values(found.debug.masks)) m.delete();
      }
      const { level } = buildLevel(found, settings, {});
      const check = checkLevel(level);
      const count = (m) => level.blocks.filter((b) => b.material === m).length;
      $('.cal-result').textContent =
        `${Math.round(performance.now() - t)} ms · paper ${found.paperFound ? 'found' : 'NOT found (using whole photo)'}\n` +
        `wood ${count('wood')} · ice ${count('ice')} · stone ${count('stone')} · tnt ${count('tnt')} · pigs ${level.pigs.length}` +
        (check.ok ? '' : `\n⚠ ${check.message}`);
    });
  }

  renderControls();
  loadCv().then(() => status('Ready. Load a photo of a drawing.')).catch((e) => status(`⚠ ${e.message}`));
  return { getSettings: () => settings, defaults: DEFAULT_SETTINGS };
}
