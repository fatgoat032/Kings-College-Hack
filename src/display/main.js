// Big-screen page: lobby with QR join, HUD, phase cards.
// P2 plugs vision (parseFort) and the game (createGame) in through integrate.js.
import QRCode from 'qrcode';
import { connect } from '../net/socket.js';
import { EVENTS, ROLES } from '../shared/events.js';
import { integrate } from './integrate.js';

const $ = (id) => document.getElementById(id);
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

const params = new URLSearchParams(location.search);
let room = (params.get('room') || '').toUpperCase();
if (!/^[A-Z]{4}$/.test(room)) {
  room = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
  history.replaceState(null, '', `?room=${room}`);
}

const net = connect({ room, role: ROLES.DISPLAY, name: 'display' });
let state = null;

// ---------- join URL + QR ----------
async function controllerUrl() {
  const { hostname, port, protocol } = location;
  let host = hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    try {
      const { lanIps } = await (await fetch('/api/info')).json();
      if (lanIps?.length) host = lanIps[0];
    } catch { /* server not reachable; keep localhost */ }
  }
  return `${protocol}//${host}${port ? `:${port}` : ''}/controller.html?room=${room}`;
}

controllerUrl().then((url) => {
  const shortUrl = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  $('joinUrl').textContent = shortUrl;
  $('code').textContent = room;
  $('miniCode').textContent = room;
  const opts = { margin: 1, color: { dark: '#2b2622', light: '#fbf7ec' } };
  QRCode.toCanvas($('qr'), url, { ...opts, width: 280 });
  QRCode.toCanvas($('miniQr'), url, { ...opts, width: 90 });
});

// ---------- debug log (press L) ----------
const logEl = $('log');
function log(ev, p) {
  const short = p?.dataUrl ? { dataUrl: `… ${Math.round(p.dataUrl.length / 1024)} KB` } : p;
  logEl.textContent = `${new Date().toLocaleTimeString()} ${ev} ${JSON.stringify(short)}\n${logEl.textContent}`.slice(0, 8000);
}
for (const ev of Object.values(EVENTS)) net.on(ev, (p) => log(ev, p));
window.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') logEl.hidden = !logEl.hidden;
});

// ---------- UI ----------
const ui = {
  card(title, text, buttons = [], image = null) {
    $('card').hidden = false;
    $('cardTitle').textContent = title;
    $('cardText').textContent = text;
    const box = $('cardButtons');
    box.replaceChildren(
      ...buttons.map(({ label, onClick }) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = onClick;
        return b;
      }),
    );
    const pic = $('cardImage');
    pic.replaceChildren();
    if (image) pic.append(image);
    pic.hidden = !image;
    $('mini').hidden = state?.phase === 'lobby';
  },
  hideCard() {
    $('card').hidden = true;
    $('mini').hidden = true;
  },
  phaseText(t) {
    $('phaseText').textContent = t;
  },
};

const game = integrate({ net, ui, canvas: $('game') });

$('startBtn').onclick = () => net.send(EVENTS.NEXT, {});

net.on(EVENTS.ROOM_STATE, (s) => {
  const prevPhase = state?.phase;
  state = s;
  renderLobby();
  $('scoreA').textContent = s.scores.A.toLocaleString();
  $('scoreB').textContent = s.scores.B.toLocaleString();
  if (s.phase !== prevPhase) renderPhase();
});

net.on(EVENTS.RESULT, (r) => game.onResult(r, state));

function renderLobby() {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  for (const t of ['A', 'B']) {
    $(`roster${t}`).innerHTML = state.teams[t]
      .map((id) => byId.get(id))
      .map((p) => `<li class="${p.connected ? '' : 'off'}">${esc(p.name)}</li>`)
      .join('');
  }
  $('startBtn').disabled = state.teams.A.length + state.teams.B.length === 0;
}

function renderPhase() {
  const { phase, turn } = state;
  $('lobby').hidden = phase !== 'lobby';
  $('hud').hidden = phase === 'lobby';
  if (phase === 'lobby') return ui.hideCard();
  const names = { draw: 'Draw', scan: 'Scan', fling: 'Fling!', result: 'Result' };
  ui.phaseText(`Round ${turn.round} · Team ${turn.attacker} attacks · ${names[phase]}`);
  game.onPhase(phase, state);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
