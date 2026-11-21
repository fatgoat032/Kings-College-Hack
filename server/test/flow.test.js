// End-to-end flow test: `npm test`. Starts its own server on a spare port.
import { io } from 'socket.io-client';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 3917;
const server = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
  env: { ...process.env, SERVER_PORT: String(PORT) },
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
console.log(fails ? `${fails} FAILED` : 'all passed');
finish(fails ? 1 : 0);
