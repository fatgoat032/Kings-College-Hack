// End-to-end flow test: node server/test/flow.test.js (server must be running on :3000)
import { io } from 'socket.io-client';
const URL = process.env.URL || 'http://localhost:3000';
const ROOM = 'TEST';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (role, name, pid) => {
  const s = io(URL, { transports: ['websocket'] });
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
check(!d.got.some(([e]) => e === 'fort:image'), 'attacker cannot send the fort photo');
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
check(d.state.phase === 'result' && d.state.scores.A === 16000, 'all pigs dead -> result, A scored 16000');
check(d.got.some(([e, p]) => e === 'result' && p.winner === null && !p.roundDone), 'result after first attack: no winner yet');

b.emit('next'); await wait(150);
check(d.state.phase === 'draw' && d.state.turn.attacker === 'B' && d.state.turn.round === 1, 'swap: B attacks, A draws, still round 1');
d.emit('level:ready', { blocks: 6, pigs: 2 }); await wait(100);
for (let i = 1; i <= 3; i++) {
  b.emit('launch', { angle: -0.5, power: 0.7, bird: 'red' }); await wait(80);
  d.emit('shot:done', { pigsLeft: 2, birdsUsed: i, score: 1000 * i }); await wait(80);
}
check(d.state.phase === 'result' && d.state.scores.B === 3000, 'out of birds -> result, B scored 3000');
check(d.got.some(([e, p]) => e === 'result' && p.roundDone && p.winner === 'A'), 'round done, A wins');
a2.emit('next'); await wait(150);
check(d.state.turn.round === 2 && d.state.turn.attacker === 'A', 'round 2, A attacks again');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
