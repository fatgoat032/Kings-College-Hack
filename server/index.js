// Express + Socket.io server. P0: rooms + relay so both pages can talk.
// P1 adds teams, turn order and the lobby -> draw -> scan -> fling -> result phase machine.
import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { EVENTS, ROLES } from '../src/shared/events.js';

const PORT = Number(process.env.SERVER_PORT || 3000);
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const app = express();
app.use(express.static(DIST)); // production build (npm start); in dev Vite serves the pages
app.get('/health', (_req, res) => res.json({ ok: true }));

const http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 5e6 }); // fort photos are a few hundred KB

/** room code -> { players: Map<socketId, {name, role}>, phase } */
const rooms = new Map();

function roomState(code) {
  const room = rooms.get(code);
  return {
    players: [...room.players.values()],
    teams: { A: [], B: [] },
    turn: null,
    phase: room.phase,
  };
}

io.on('connection', (socket) => {
  let code = null;

  socket.on(EVENTS.JOIN, ({ room, role, name } = {}) => {
    if (typeof room !== 'string' || !Object.values(ROLES).includes(role)) return;
    code = room.toUpperCase();
    if (!rooms.has(code)) rooms.set(code, { players: new Map(), phase: 'lobby' });
    rooms.get(code).players.set(socket.id, { id: socket.id, name: String(name || role), role });
    socket.join(code);
    socket.join(`${code}:${role}`);
    io.to(code).emit(EVENTS.ROOM_STATE, roomState(code));
  });

  // controller -> display relays
  for (const ev of [EVENTS.FORT_IMAGE, EVENTS.AIM, EVENTS.LAUNCH]) {
    socket.on(ev, (payload) => code && io.to(`${code}:${ROLES.DISPLAY}`).emit(ev, payload));
  }
  // display -> server (logged for now; P1 drives the phase machine from these)
  for (const ev of [EVENTS.LEVEL_READY, EVENTS.SHOT_DONE]) {
    socket.on(ev, (payload) => console.log(`[${code}] ${ev}`, payload));
  }

  socket.on('disconnect', () => {
    const room = code && rooms.get(code);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) rooms.delete(code);
    else io.to(code).emit(EVENTS.ROOM_STATE, roomState(code));
  });
});

http.listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal);
  console.log(`socket server on :${PORT}  (LAN: ${ips.map((i) => i.address).join(', ') || 'none'})`);
});
