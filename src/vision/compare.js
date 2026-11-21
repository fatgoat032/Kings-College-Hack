// Compare a detected level with a hand-written expected level (fixtures).
// Pure JS: used by public/fixtures/fixtures.test.html and the Node tests.

export const TOLERANCE = { block: 45, pig: 35 }; // world units between centres

/**
 * @returns {{ pass: boolean, summary: string, missing: string[], extra: string[] }}
 */
export function compareLevels(got, want, tol = TOLERANCE) {
  const missing = [];
  const extra = [];

  const match = (wantItems, gotItems, sameKind, maxD, label) => {
    const left = [...gotItems];
    for (const w of wantItems) {
      let bestI = -1;
      let bestD = Infinity;
      left.forEach((g, i) => {
        if (!sameKind(w, g)) return;
        const d = Math.hypot(g.x - w.x, g.y - w.y);
        if (d < bestD) { bestD = d; bestI = i; }
      });
      if (bestI >= 0 && bestD <= maxD) left.splice(bestI, 1);
      else missing.push(`${label(w)} at (${Math.round(w.x)}, ${Math.round(w.y)})`);
    }
    for (const g of left) extra.push(`${label(g)} at (${Math.round(g.x)}, ${Math.round(g.y)})`);
  };

  match(want.blocks, got.blocks, (a, b) => a.material === b.material, tol.block, (b) => b.material);
  match(want.pigs, got.pigs, () => true, tol.pig, () => 'pig');

  const pass = missing.length === 0 && extra.length === 0;
  const summary = pass
    ? `${got.blocks.length} blocks, ${got.pigs.length} pigs: all matched`
    : `${missing.length} missing, ${extra.length} extra`;
  return { pass, summary, missing, extra };
}
