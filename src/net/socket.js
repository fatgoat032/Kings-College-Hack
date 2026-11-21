// Client wrapper used by both pages. Auto-reconnects (socket.io default) and
// re-sends `join` after every reconnect with a stable per-device pid, so a phone
// that sleeps keeps its team. aim is throttled to AIM_RATE per second.
import { io } from 'socket.io-client';
import { EVENTS, AIM_RATE } from '../shared/events.js';

function devicePid(role) {
  const key = `angry-sketches:pid:${role}`;
  try {
    let pid = sessionStorage.getItem(key);
    if (!pid) {
      pid = `${role[0]}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(key, pid);
    }
    return pid;
  } catch {
    return `${role[0]}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function connect({ room, role, name, url }) {
  const socket = url ? io(url) : io();
  const pid = devicePid(role);
  socket.on('connect', () => socket.emit(EVENTS.JOIN, { room, role, name, pid }));

  let lastAim = 0;
  let pendingAim = null;
  let aimTimer = 0;
  const minGap = 1000 / AIM_RATE;

  function send(event, payload = {}) {
    if (event !== EVENTS.AIM) {
      if (event === EVENTS.LAUNCH) {
        clearTimeout(aimTimer); // a late aim must not arrive after the launch
        pendingAim = null;
      }
      return socket.emit(event, payload);
    }
    const now = performance.now();
    if (now - lastAim >= minGap) {
      lastAim = now;
      socket.emit(event, payload);
    } else {
      pendingAim = payload; // keep only the newest aim
      clearTimeout(aimTimer);
      aimTimer = setTimeout(() => {
        lastAim = performance.now();
        if (pendingAim) socket.emit(EVENTS.AIM, pendingAim);
        pendingAim = null;
      }, minGap - (now - lastAim));
    }
  }

  return {
    pid,
    send,
    on: (event, fn) => socket.on(event, fn),
    off: (event, fn) => socket.off(event, fn),
    socket,
  };
}
