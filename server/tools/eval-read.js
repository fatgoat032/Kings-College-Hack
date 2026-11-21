// Live eval of Claude's reading (/api/read logic, optionally + /api/verify) against vision's
// truth set: npm run eval:claude [-- --verify]. Needs ANTHROPIC_API_KEY in .env.
// Each photo is read with ITSELF left out of the few-shot examples.
// Try CLAUDE_READ_EFFORT=low|medium|high and CLAUDE_MODEL=... to compare accuracy and latency.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }
const { createClaude } = await import('../claude.js');

const FIX = fileURLToPath(new URL('../../public/fixtures/', import.meta.url));
const TRUTH = join(FIX, 'truth');
const withVerify = process.argv.includes('--verify');
const claude = createClaude({ log: () => {} });
if (!claude.enabled) {
  console.log('No ANTHROPIC_API_KEY in .env: nothing to evaluate.');
  process.exit(1);
}

const centre = (s) => [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
/** Greedy match truth strokes to predicted ones by centre distance (within 10 % of the diagonal). */
function score(truth, got, W, H) {
  const diag = Math.hypot(W, H);
  const free = got.strokes.map((s, i) => i);
  let colourOk = 0, posErr = 0, thickErr = 0, matched = 0;
  for (const t of truth.strokes || []) {
    const [tx, ty] = centre(t);
    let best = -1, bd = Infinity;
    for (const i of free) {
      const [gx, gy] = centre(got.strokes[i]);
      const d = Math.hypot(gx - tx, gy - ty);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd > diag * 0.1) continue;
    free.splice(free.indexOf(best), 1);
    const g = got.strokes[best];
    matched++;
    if (g.colour === t.colour) colourOk++;
    posErr += bd / diag;
    thickErr += Math.abs(g.thickness - t.thickness) / t.thickness;
  }
  const n = (truth.strokes || []).length;
  const pigsT = (truth.pigs || []).length;
  return {
    colour: n ? colourOk / n : 1,
    missed: n - matched,
    extra: free.length,
    pos: matched ? (posErr / matched) * 100 : 0,
    thick: matched ? (thickErr / matched) * 100 : 0,
    pigs: `${got.pigs.length}/${pigsT}`,
  };
}

const rows = [];
for (const f of readdirSync(TRUTH).filter((x) => x.endsWith('.json')).sort()) {
  const t = JSON.parse(readFileSync(join(TRUTH, f), 'utf8'));
  const ext = t.image.split('.').pop().toLowerCase();
  const image = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${readFileSync(join(FIX, t.image)).toString('base64')}`;
  const t0 = Date.now();
  try {
    let { reading } = await claude.read({ image, width: t.width, height: t.height, timeoutMs: 15000 }, { exclude: f });
    const readMs = Date.now() - t0;
    let verifyMs = 0;
    if (withVerify) {
      // the overlay needs a canvas; on the server we send the photo twice (vision sends a real overlay)
      const t1 = Date.now();
      ({ reading } = await claude.verify({ image, overlay: image, width: t.width, height: t.height, reading, timeoutMs: 15000 }));
      verifyMs = Date.now() - t1;
    }
    rows.push({ f, readMs, verifyMs, ...score(t, reading, t.width, t.height) });
  } catch (e) {
    rows.push({ f, readMs: Date.now() - t0, error: e.message });
  }
}
console.log(`model ${claude.model} · effort ${process.env.CLAUDE_READ_EFFORT || 'high'}${withVerify ? ' · + verify' : ''}`);
for (const r of rows) {
  if (r.error) console.log(`  ${r.f.padEnd(28)} ERROR ${r.error} (${r.readMs} ms)`);
  else console.log(`  ${r.f.padEnd(28)} colours ${(r.colour * 100).toFixed(0)}% · missed ${r.missed} · extra ${r.extra} · pos err ${r.pos.toFixed(1)}% · thickness err ${r.thick.toFixed(0)}% · pigs ${r.pigs} · read ${r.readMs} ms${withVerify ? ` + verify ${r.verifyMs} ms` : ''}`);
}
const ok = rows.filter((r) => !r.error);
if (ok.length) {
  const avg = (k) => ok.reduce((s, r) => s + r[k], 0) / ok.length;
  console.log(`  OVERALL colours ${(avg('colour') * 100).toFixed(0)}% · missed ${ok.reduce((s, r) => s + r.missed, 0)} · extra ${ok.reduce((s, r) => s + r.extra, 0)} · pos err ${avg('pos').toFixed(1)}% · thickness err ${avg('thick').toFixed(0)}% · avg read ${Math.round(avg('readMs'))} ms`);
}
