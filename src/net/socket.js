// Client wrapper used by both pages. Auto-reconnects (socket.io default) and
// re-sends `join` after every reconnect. P1: aim throttled to AIM_RATE per second.
import { io } from 'socket.io-client';
import { EVENTS, AIM_RATE } from '../shared/events.js';

export function connect({ room, role, name }) {
  const socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => socket.emit(EVENTS.JOIN, { room, role, name }));

  let lastAim = 0;
  let pendingAim = null;
  let aimTimer = 0;
  const minGap = 1000 / AIM_RATE;

  function send(event, payload) {
    if (event !== EVENTS.AIM) return socket.emit(event, payload);
    const now = performance.now();
    if (now - lastAim >= minGap) {
      lastAim = now;
      socket.emit(event, payload);
    } else {
      pendingAim = payload; // keep only the newest aim
      clearTimeout(aimTimer);
      aimTimer = setTimeout(() => {
        lastAim = performance.now();
        socket.emit(EVENTS.AIM, pendingAim);
      }, minGap - (now - lastAim));
    }
  }

  return {
    send,
    on: (event, fn) => socket.on(event, fn),
    off: (event, fn) => socket.off(event, fn),
    socket,
  };
}
