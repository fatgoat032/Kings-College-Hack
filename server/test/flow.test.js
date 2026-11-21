// End-to-end flow test: `npm test`. Starts its own server on a spare port.
import { io } from 'socket.io-client';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 3917;
const server = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
  env: { ...process.env, SERVER_PORT: String(PORT), ANTHROPIC_API_KEY: '' }, // never call the real API from tests
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 10000);
  server.stdout.on('data', (d) => d.toString().includes('socket server on') && (clearTimeout(t), resolve()));
  server.on('exit', (c) => reject(new Error(`server exited with ${c}`)));
});
const finish = (code) => { server.kill(); process.exit(code); };

const BASE = `http://localhost:${PORT}`;
const ROOM = 'T' + Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (role, name, pid) => {
  const s = io(BASE, { transports: ['websocket'] });
  s.state = null; s.got = [];
  s.on('connect', () => s.emit('join', { room: ROOM, role, name, pid }));
  s.on('room:state', (st) => (s.state = st));
  s.onAny((ev, p) => s.got.push([ev, p]));
  return s;
};
let fails = 0;
const check = (cond, msg) => { console.log(cond ? '  ok  ' : '  FAIL', msg); if (!cond) fails++; };

const d = mk('display', 'd', 'd-1');
const a = mk('controller', 'Ann', 'c-ann');
await wait(150);
const b = mk('controller', 'Bob', 'c-bob');
await wait(300);
check(d.state.teams.A.includes('c-ann') && d.state.teams.B.includes('c-bob'), 'teams balanced A/B');
check(d.state.phase === 'lobby', 'starts in lobby');

a.emit('next'); await wait(150);
check(d.state.phase === 'draw' && d.state.turn.attacker === 'A', 'next -> draw, A attacks, B draws');

a.emit('fort:image', { dataUrl: 'data:x' }); await wait(150);
check(d.got.some(([e]) => e === 'fort:image'), 'any phone can send the fort photo (shared iPad upload)');
b.emit('fort:image', { dataUrl: 'data:x' }); await wait(150);
check(d.got.some(([e]) => e === 'fort:image') && d.state.phase === 'scan', 'defender photo reaches display, phase scan');

d.emit('level:ready', { blocks: 6, pigs: 2 }); await wait(150);
check(d.state.phase === 'fling' && d.state.turn.shooter === 'c-ann', 'level:ready -> fling, Ann shoots');

b.emit('launch', { angle: -0.5, power: 1, bird: 'red' }); await wait(100);
check(!d.got.some(([e]) => e === 'launch'), 'defender launch is dropped');
b.emit('grip', { held: true }); await wait(80);
check(!d.got.some(([e]) => e === 'grip'), 'defender grip is dropped');
a.emit('grip', { held: true }); await wait(100);
check(d.got.some(([e, p]) => e === 'grip' && p.held === true), 'shooter grip reaches the display');
d.emit('power:update', { power: 0.42, source: 'webcam' });
a.emit('power:update', { power: 1, source: 'webcam' }); await wait(120);
check(a.got.some(([e, p]) => e === 'power:update' && p.power === 0.42) && !b.got.some(([e]) => e === 'power:update') && !a.got.some(([e, p]) => e === 'power:update' && p.power === 1),
  'display power:update goes only to the shooter; a phone cannot send it');
a.emit('aim', { angle: -0.5, power: 0.5 });
a.emit('launch', { angle: -0.5, power: 0.9, bird: 'red' }); await wait(150);
check(d.got.some(([e]) => e === 'aim') && d.got.some(([e]) => e === 'launch') && d.state.turn.inFlight, 'shooter aim + launch relayed, inFlight');
a.emit('launch', { angle: -0.5, power: 0.9, bird: 'red' }); await wait(100);
check(d.got.filter(([e]) => e === 'launch').length === 1, 'second launch while in flight is dropped');
a.emit('ability', {}); await wait(100);
check(d.got.some(([e]) => e === 'ability'), 'ability relayed while in flight');

d.emit('shot:done', { pigsLeft: 1, birdsUsed: 1, score: 5500 }); await wait(100);
check(d.state.phase === 'fling' && !d.state.turn.inFlight && d.state.turn.birdsUsed === 1, 'shot done, still fling');
// reconnect: Ann drops and comes back with the same pid
a.disconnect(); await wait(150);
check(d.state.players.find((p) => p.id === 'c-ann').connected === false, 'disconnect marks player offline');
const a2 = mk('controller', 'Ann', 'c-ann'); await wait(300);
check(a2.state.teams.A.includes('c-ann') && a2.state.teams.A.length === 1, 'reconnect keeps team, no duplicate');
a2.emit('launch', { angle: -0.4, power: 0.8, bird: 'red' }); await wait(100);
d.emit('shot:done', { pigsLeft: 0, birdsUsed: 2, score: 16000 }); await wait(150);
check(d.state.phase === 'result' && d.state.blobs.A === 2 && d.state.birds.A === 2, 'all pigs dead -> result, A knocked out 2 blobs with 2 birds');
check(d.got.some(([e, p]) => e === 'result' && p.winner === null && !p.roundDone), 'result after first attack: no winner yet');

b.emit('next'); await wait(150);
check(d.state.phase === 'draw' && d.state.turn.attacker === 'B' && d.state.turn.round === 1, 'swap: B attacks, A draws, still round 1');
d.emit('level:ready', { blocks: 6, pigs: 2 }); await wait(100);
for (let i = 1; i <= 3; i++) {
  b.emit('launch', { angle: -0.5, power: 0.7, bird: 'red' }); await wait(80);
  d.emit('shot:done', { pigsLeft: 2, birdsUsed: i, score: 1000 * i }); await wait(80);
}
check(d.state.phase === 'result' && d.state.blobs.B === 0 && d.state.birds.B === 3, 'out of birds -> result, B 0 blobs, 3 birds');
check(d.got.some(([e, p]) => e === 'result' && p.roundDone && p.winner === 'A'), 'round done, A wins');
a2.emit('next'); await wait(150);
check(d.state.turn.round === 2 && d.state.turn.attacker === 'A', 'round 2, A attacks again');

// tie-break, straight on the room logic: equal blobs, fewer birds wins
{
  const { createRoom } = await import('../room.js');
  const r = createRoom('TIEB');
  r.join('disp', { role: 'display', name: 'd' });
  r.join('pa', { role: 'controller', name: 'a' });
  r.join('pb', { role: 'controller', name: 'b' });
  r.next('pa'); r.levelReady('disp', { pigs: 2 });
  r.launch('pa'); r.shotDone('disp', { pigsLeft: 1, birdsUsed: 1 });
  r.launch('pa'); r.shotDone('disp', { pigsLeft: 1, birdsUsed: 2 });
  r.launch('pa'); r.shotDone('disp', { pigsLeft: 1, birdsUsed: 3 }); // A: 1 blob, 3 birds
  r.next('pb'); r.levelReady('disp', { pigs: 1 });
  r.launch('pb'); const fx = r.shotDone('disp', { pigsLeft: 0, birdsUsed: 1 }); // B: 1 blob, 1 bird
  const res = fx.find((e) => e.type === 'result');
  check(res?.roundDone && res.winner === 'B' && res.blobs.A === 1 && res.blobs.B === 1, 'tie on blobs -> fewer birds (B) wins');
}
// stuck-launch safety net
{
  const { createRoom } = await import('../room.js');
  const r = createRoom('STUK');
  r.join('disp', { role: 'display', name: 'd' });
  r.join('pa', { role: 'controller', name: 'a' });
  r.next('pa'); r.levelReady('disp', { pigs: 2 });
  r.launch('pa');
  const early = r.tick(Date.now() + 5000).length;
  const late = r.tick(Date.now() + 25000).length;
  check(early === 0 && late === 1 && !r.state().turn.inFlight && r.launch('pa').length > 0, 'a launch with no shot:done is cleared after 20 s and the shooter can fire again');
}
// Claude endpoints: without a key they answer { error } at once (vision falls back to OpenCV)
{
  const st = await fetch(`${BASE}/api/claude/status`).then((r) => r.json());
  const t0 = Date.now();
  const cl = await fetch(`${BASE}/api/classify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ annotated: 'data:image/jpeg;base64,AAAA', clean: 'data:image/jpeg;base64,AAAA', count: 3 }) }).then((r) => r.json());
  check(st.enabled === false && /ANTHROPIC_API_KEY/.test(cl.error) && Date.now() - t0 < 1000, 'no key: /api/classify answers { error } fast');
}
// Claude endpoints with a fake client: structured answers are tidied to the contract
{
  const { createClaude } = await import('../claude.js');
  const reply = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });
  let sent = null;
  const fake = (obj) => ({ messages: { create: async (p) => ((sent = p), reply(obj)) } });
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(40);
  const c1 = createClaude({ client: fake({ shapes: [{ n: 2, colour: 'red', kind: 'block', confidence: 1.7 }, { n: 2, colour: 'blue', kind: 'block', confidence: 0.9 }, { n: 9, colour: 'blue', kind: 'block', confidence: 1 }, { n: 1, colour: 'pink', kind: 'pig', confidence: 0.8 }] }), log: () => {} });
  const r1 = await c1.classify({ annotated: img, clean: img, count: 3 });
  check(JSON.stringify(r1.shapes) === JSON.stringify([
    { n: 1, colour: 'other', kind: 'pig', confidence: 0.8 },
    { n: 2, colour: 'red', kind: 'block', confidence: 1 },
    { n: 3, colour: 'other', kind: 'block', confidence: 0 },
  ]) && sent.messages[0].content.filter((b) => b.type === 'image').length === 2 && sent.output_config.format.type === 'json_schema',
  'classify: one answer per number, bad values tidied, missing numbers get confidence 0, both images sent');
  const c2 = createClaude({ client: fake({ blocks: [{ colour: 'grey', x: 0.5, y: 0.8, w: 0.1, h: 0.3, angle: 0 }, { colour: 'red', x: 1.4, y: 0.5, w: 0.1, h: 0.1, angle: 0 }], pigs: [{ x: 0.6, y: 0.9, r: 0.03 }] }), log: () => {} });
  const r2 = await c2.layout({ clean: img });
  check(r2.blocks.length === 1 && r2.blocks[0].colour === 'grey' && r2.pigs.length === 1, 'layout: off-page entries dropped');
  const c3 = createClaude({ client: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } }, log: () => {} });
  let err = '';
  try { await c3.layout({ clean: img }); } catch (e) { err = e.message; }
  check(/declined/.test(err), 'refusal becomes an error (vision falls back)');
}
// TEAM FIX #3: /api/read + /api/verify with a fake client
{
  const { createClaude } = await import('../claude.js');
  let sent = null;
  const fake = (obj) => ({ messages: { create: async (p) => ((sent = p), { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] }) } });
  const img = 'data:image/png;base64,' + 'A'.repeat(40);
  const c = createClaude({ client: fake({ seen: ['red block'], strokes: [{ colour: 'red', x1: 10, y1: 20, x2: 90, y2: 20, thickness: 12 }, { colour: 'pink', x1: 0, y1: 0, x2: 5, y2: 5, thickness: 3 }, { colour: 'grey', x1: 50, y1: 50, x2: 5000, y2: 50, thickness: 30 }], polys: [{ colour: 'blue', vertices: [[1, 1], [2, 30], [40, 5], ['x', 3]] }, { colour: 'black', vertices: [[1, 1], [2, 2]] }], pigs: [{ x: 60, y: 80, r: 10 }, { x: 1, y: 1, r: -2 }] }), log: () => {} });
  const r = await c.read({ image: img, width: 200, height: 100, timeoutMs: 99999 });
  const user = sent.messages.at(-1);
  check(sent.output_config.effort === 'high' && /Red may look orange or pink/.test(sent.system) && sent.messages.length === 1 + 2 * c.fewShotCount && c.fewShotCount >= 1 && user.content[0].type === 'image' && /200 x 100 pixels/.test(user.content.at(-1).text),
    `read: effort high, colour rules in the system prompt, ${c.fewShotCount} few-shot examples before the photo, image size stated`);
  check(r.reading.strokes.length === 2 && r.reading.strokes[1].x2 === 200 && r.reading.polys.length === 1 && r.reading.polys[0].vertices.length === 3 && r.reading.pigs.length === 1 && r.seen[0] === 'red block',
    'read: bad colours/vertices/pigs dropped, coordinates clamped to the image');
  const v = createClaude({ client: fake({ changes: ['blue beam was black'], strokes: [{ colour: 'blue', x1: 10, y1: 20, x2: 90, y2: 20, thickness: 12 }], polys: [], pigs: [] }), log: () => {} });
  const vr = await v.verify({ image: img, overlay: img, width: 200, height: 100, reading: r.reading });
  check(vr.changes[0] === 'blue beam was black' && vr.reading.strokes[0].colour === 'blue' && sent.messages.length === 1 && sent.messages[0].content.filter((b) => b.type === 'image').length === 2 && /"strokes"/.test(sent.messages[0].content.at(-1).text),
    'verify: photo + overlay + our reading sent, corrected reading and changes returned');
  let err = '';
  try { await c.read({ image: img, width: 3000, height: 100 }); } catch (e) { err = e.message; }
  check(/2576/.test(err), 'read: images over 2576 px are refused');
}
console.log(fails ? `${fails} FAILED` : 'all passed');
finish(fails ? 1 : 0);
