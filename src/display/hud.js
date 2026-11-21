// Debug HUD for tuning motion controls on real phones, toggled with H:
// live angle, power, power source, grip state, aim messages per second, the phone's
// sensor rate, the webcam power going back to the phone, and the last scan's detector/latency.
export function createDebugHud() {
  const el = document.createElement('pre');
  el.id = 'debugHud';
  el.hidden = true;
  Object.assign(el.style, {
    position: 'fixed', top: '64px', left: '12px', margin: 0, padding: '10px 14px', zIndex: 50,
    font: '600 18px ui-monospace, monospace', background: 'rgba(251,247,236,.94)',
    border: '3px solid #2b2622', borderRadius: '10px', pointerEvents: 'none', lineHeight: 1.45,
  });
  document.body.append(el);

  const s = {
    aim: null, aimAt: 0, aimTimes: [], grip: null, gripAt: 0, sent: null, sentAt: 0,
    launch: null, scan: null,
  };
  const ago = (t) => (t ? `${((performance.now() - t) / 1000).toFixed(1)} s ago` : '-');

  function render() {
    if (el.hidden) return;
    const now = performance.now();
    s.aimTimes = s.aimTimes.filter((t) => now - t < 1000);
    const a = s.aim;
    const elev = a ? Math.round((-a.angle * 180) / Math.PI) : null;
    el.textContent = [
      'DEBUG (H)',
      `angle     ${elev == null ? '-' : `${elev}° up`}`,
      `power     ${a ? `${Math.round(a.power * 100)}%` : '-'}`,
      `source    ${a?.source ?? '-'}`,
      `grip      ${s.grip == null ? '-' : s.grip.held ? 'HELD' : s.grip.cancel ? 'released (cancel)' : 'released'} · ${ago(s.gripAt)}`,
      `aim msgs  ${s.aimTimes.length}/s · phone sensor ${a?.hz ?? '-'} Hz`,
      `webcam -> ${s.sent ? `${Math.round(s.sent.power * 100)}% (${s.sent.source}) ${ago(s.sentAt)}` : '-'}`,
      `launch    ${s.launch ? `${Math.round((-s.launch.angle * 180) / Math.PI)}° · ${Math.round(s.launch.power * 100)}%` : '-'}`,
      `scan      ${s.scan ?? '-'}`,
    ].join('\n');
  }
  setInterval(render, 100);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'h' && e.key !== 'H') return;
    el.hidden = !el.hidden;
    render();
  });

  return {
    aim(a) {
      s.aim = a;
      s.aimAt = performance.now();
      s.aimTimes.push(s.aimAt);
    },
    grip(g) {
      s.grip = g;
      s.gripAt = performance.now();
    },
    powerSent(p) {
      s.sent = p;
      s.sentAt = performance.now();
    },
    launch(l) {
      s.launch = l;
    },
    scan(text) {
      s.scan = text;
    },
  };
}
