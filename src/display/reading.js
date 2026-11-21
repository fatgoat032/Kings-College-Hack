// "Reading your fort…" animation for the scan card (vision + Claude take a few seconds):
// a magnifying glass sweeps over a little marker sketch while the caption cycles through
// what it is looking for. The game's own drop-in reveal plays when the level loads.
const TIPS = [
  'Finding the pen lines…',
  'Spotting the red TNT…',
  'Checking which blocks are ice…',
  'Weighing the stone…',
  'Counting green pigs…',
  'Measuring every block…',
  'Asking Claude about the colours…',
];

const STYLE = `
.reading { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.reading svg { width: 340px; height: 170px; overflow: visible; }
.reading .glass { animation: reading-sweep 2.2s ease-in-out infinite alternate; }
.reading .blk { animation: reading-pop 2.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
.reading .blk:nth-child(2) { animation-delay: .25s } .reading .blk:nth-child(3) { animation-delay: .5s }
.reading .blk:nth-child(4) { animation-delay: .75s } .reading .blk:nth-child(5) { animation-delay: 1s }
.reading .blk:nth-child(6) { animation-delay: 1.25s }
.reading p { margin: 0; font: 24px 'Permanent Marker', system-ui, sans-serif; min-height: 1.3em; }
.reading .bar { width: 300px; height: 10px; border: 3px solid var(--ink, #2b2622); border-radius: 8px; overflow: hidden; }
.reading .bar i { display: block; height: 100%; width: 40%; background: #d8322b; animation: reading-bar 1.4s ease-in-out infinite; }
@keyframes reading-sweep { from { transform: translate(-20px, 10px) rotate(-8deg) } to { transform: translate(250px, -6px) rotate(8deg) } }
@keyframes reading-pop { 0%, 70%, 100% { transform: scale(1) } 80% { transform: scale(1.12) } }
@keyframes reading-bar { from { transform: translateX(-100%) } to { transform: translateX(260%) } }
@media (prefers-reduced-motion: reduce) { .reading .glass, .reading .blk, .reading .bar i { animation: none } }
`;

const SKETCH = `
<svg viewBox="0 0 340 170" aria-hidden="true">
  <g stroke-linecap="round" stroke-linejoin="round">
    <rect class="blk" x="60" y="90" width="12" height="70" fill="#2b2622" rx="2"/>
    <rect class="blk" x="150" y="90" width="12" height="70" fill="#2b2622" rx="2"/>
    <rect class="blk" x="50" y="76" width="124" height="14" fill="#5aa7e8" rx="3"/>
    <rect class="blk" x="95" y="48" width="30" height="28" fill="#e2463c" rx="3"/>
    <rect class="blk" x="220" y="70" width="34" height="90" fill="#9a9590" rx="3"/>
    <circle class="blk" cx="111" cy="146" r="13" fill="#5cb85c"/>
  </g>
  <line x1="10" y1="161" x2="330" y2="161" stroke="#2b2622" stroke-width="4"/>
  <g class="glass">
    <circle cx="40" cy="70" r="30" fill="rgba(255,255,255,.35)" stroke="#2b2622" stroke-width="7"/>
    <line x1="61" y1="92" x2="88" y2="122" stroke="#2b2622" stroke-width="11" stroke-linecap="round"/>
  </g>
</svg>`;

export function createReading() {
  if (!document.getElementById('reading-style')) {
    const s = document.createElement('style');
    s.id = 'reading-style';
    s.textContent = STYLE;
    document.head.append(s);
  }
  const el = document.createElement('div');
  el.className = 'reading';
  el.innerHTML = `${SKETCH}<p></p><div class="bar"><i></i></div>`;
  const caption = el.querySelector('p');
  let timer = 0;
  let i = 0;

  return {
    el,
    start() {
      clearInterval(timer);
      i = 0;
      caption.textContent = TIPS[0];
      timer = setInterval(() => (caption.textContent = TIPS[++i % TIPS.length]), 1100);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
