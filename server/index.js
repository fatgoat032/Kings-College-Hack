// Express + Socket.io server: rooms by 4-letter code, two teams, turn order and the
// lobby -> draw -> scan -> fling -> result phase machine (logic in room.js).
import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { EVENTS, ROLES } from '../src/shared/events.js';
import { createRoom } from './room.js';

const PORT = Number(process.env.SERVER_PORT || 3000);
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const lanIps = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

const app = express();
app.use(express.static(DIST)); // production build (npm start); in dev Vite serves the pages
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/info', (_req, res) => res.json({ lanIps: lanIps() }));

const http = createServer(app);
// fort photos: 1280 px JPEG at q 0.85, ~0.3-1.5 MB as base64; over this limit socket.io drops the client silently
const io = new Server(http, { maxHttpBufferSize: 1e7 });

/** code -> room */
const rooms = new Map();
const getRoom = (code) => {
  if (!rooms.has(code)) rooms.set(code, createRoom(code));
  return rooms.get(code);
};

/** "CODE:pid" -> socket id of that player's newest connection */
const owners = new Map();

const log = (code, ...a) => console.log(new Date().toISOString().slice(11, 19), `[${code}]`, ...a);

io.on('connection', (socket) => {
  let room = null;
  let pid = null;

  const broadcastState = () => io.to(room.code).emit(EVENTS.ROOM_STATE, room.state());

  /** Perform the effects a room action returned. */
  function apply(fx, event, payload) {
    for (const f of fx) {
      if (f.type === 'relay') io.to(`${room.code}:${ROLES.DISPLAY}`).emit(event, payload);
      else if (f.type === 'phase') {
        log(room.code, 'phase ->', room.state().phase);
        io.to(room.code).emit(EVENTS.PHASE, { phase: room.state().phase });
        broadcastState();
      } else if (f.type === 'state') broadcastState();
      else if (f.type === 'result') {
        log(room.code, 'result', f);
        io.to(room.code).emit(EVENTS.RESULT, {
          winner: f.winner, scores: f.scores, roundDone: f.roundDone, blobs: f.blobs, birds: f.birds, turn: f.turn,
        });
      }
    }
  }

  socket.on(EVENTS.JOIN, ({ room: code, role, name, pid: clientPid } = {}) => {
    if (typeof code !== 'string' || !/^[A-Za-z]{4}$/.test(code)) return;
    if (!Object.values(ROLES).includes(role)) return;
    if (room) room.leave(pid);
    room = getRoom(code.toUpperCase());
    pid = typeof clientPid === 'string' && clientPid.length <= 64 ? clientPid : socket.id;
    owners.set(`${room.code}:${pid}`, socket.id);
    const p = room.join(pid, { name, role });
    socket.join(room.code);
    socket.join(`${room.code}:${role}`);
    log(room.code, `join ${role} ${p.name} team=${p.team}`);
    socket.emit(EVENTS.PHASE, { phase: room.state().phase });
    broadcastState();
  });

  const on = (event, action) =>
    socket.on(event, (payload, ack) => {
      if (!room) return; // no ack: the client resends after it has rejoined
      try {
        apply(action(pid, payload ?? {}), event, payload);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error(event, err);
      }
    });

  on(EVENTS.NEXT, (id) => room.next(id));
  on(EVENTS.FORT_IMAGE, (id) => {
    log(room.code, `fort:image from ${id}`);
    return room.fortImage(id);
  });
  on(EVENTS.LEVEL_READY, (id, p) => room.levelReady(id, p));
  on(EVENTS.AIM, (id) => room.aim(id));
  on(EVENTS.LAUNCH, (id) => room.launch(id));
  on(EVENTS.ABILITY, (id) => room.ability(id));
  on(EVENTS.SHOT_DONE, (id, p) => room.shotDone(id, p));

  socket.on('disconnect', () => {
    if (!room) return;
    const key = `${room.code}:${pid}`;
    if (owners.get(key) !== socket.id) return; // a newer connection already took over
    owners.delete(key);
    room.leave(pid);
    broadcastState();
  });
});

http.listen(PORT, () => {
  console.log(`socket server on :${PORT}  (LAN: ${lanIps().join(', ') || 'none'})`);
});
