// Phone controller: join a room, then show the screen for the current phase and role.
import { connect } from '../net/socket.js';
import { EVENTS, ROLES, BIRDS_PER_TURN } from '../shared/events.js';
import { createPad } from './pad.js';
import { fileToJpeg } from './camera.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const params = new URLSearchParams(location.search);
const room = (params.get('room') || '').toUpperCase();

if (!/^[A-Z]{4}$/.test(room)) showJoinForm();
else if (!store.get('angry-sketches:name')) showJoinForm(room);
else start(room, store.get('angry-sketches:name'));

function showJoinForm(prefill = '') {
  $('status').textContent = '';
  $('join').hidden = false;
  $('joinRoom').value = prefill;
  $('joinName').value = store.get('angry-sketches:name') || '';
  (prefill ? $('joinName') : $('joinRoom')).focus();
  $('joinBtn').onclick = () => {
    const code = $('joinRoom').value.trim().toUpperCase();
    const name = $('joinName').value.trim() || 'Player';
    if (!/^[A-Z]{4}$/.test(code)) return $('joinRoom').focus();
    store.set('angry-sketches:name', name);
    history.replaceState(null, '', `?room=${code}`);
    $('join').hidden = true;
    start(code, name);
  };
}

function start(code, name) {
  const net = connect({ room: code, role: ROLES.CONTROLLER, name });
  let state = null;
  let lastResult = null;
  let scanning = false;

  const pad = createPad($('pad'), {
    onAim: (a) => net.send(EVENTS.AIM, a),
    onLaunch: (a) => net.send(EVENTS.LAUNCH, { ...a, bird: 'red' }),
    onTap: () => {
      net.send(EVENTS.ABILITY, {});
      navigator.vibrate?.(30);
    },
  });

  net.socket.on('connect', () => ($('status').textContent = 'connected'));
  net.socket.on('disconnect', () => ($('status').textContent = 'reconnecting…'));
  net.on(EVENTS.ROOM_STATE, (s) => {
    state = s;
    if (s.phase !== 'scan') scanning = false;
    render();
  });
  net.on(EVENTS.RESULT, (r) => {
    lastResult = r;
    render();
  });

  async function sendPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    scanning = true;
    render('Sending photo…');
    try {
      const dataUrl = await fileToJpeg(file);
      net.send(EVENTS.FORT_IMAGE, { dataUrl });
      render('Photo sent! Check the big screen.');
    } catch (err) {
      scanning = false;
      render(`Could not read that photo (${err.message}). Try again.`);
    }
  }
  $('scanInput').addEventListener('change', sendPhoto);
  $('uploadInput').addEventListener('change', sendPhoto);
  $('nextBtn').onclick = () => net.send(EVENTS.NEXT, {});

  function render(note) {
    if (!state) return;
    const me = state.players.find((p) => p.id === net.pid);
    const team = me?.team;
    const { attacker, defender, shooter, birdsUsed, inFlight, round } = state.turn;
    const solo = state.teams.B.length === 0 || state.teams.A.length === 0;
    const amAttacker = team === attacker || solo;
    const amDefender = team === defender || solo;
    const shooterName = state.players.find((p) => p.id === shooter)?.name || '?';

    $('who').innerHTML = `${esc(me?.name || name)} · <b class="${team}">Team ${team || '?'}</b> · room ${state.code}`;

    const show = (screen) => {
      $('msg').hidden = screen !== 'msg';
      $('fling').hidden = screen !== 'fling';
      if (screen === 'fling') pad.resize();
    };
    const msg = (title, text, { legend = false, scan = false, upload = false, next = '', scores = false } = {}) => {
      show('msg');
      $('msgTitle').textContent = title;
      $('msgText').textContent = note || text;
      $('legend').hidden = !legend;
      $('scanLabel').hidden = !scan;
      $('uploadLabel').hidden = !(scan || upload);
      $('nextBtn').hidden = !next;
      $('nextBtn').textContent = next;
      $('scores').hidden = !scores;
      if (scores) {
        $('scores').innerHTML = ['A', 'B']
          .map((t) => `<div class="${t}">${state.scores[t].toLocaleString()}<small>Team ${t}</small></div>`)
          .join('');
      }
    };

    pad.setEnabled(false);
    pad.setFlying(false);

    switch (state.phase) {
      case 'lobby': {
        const a = state.teams.A.length;
        const b = state.teams.B.length;
        msg('You’re in!', `Team A: ${a} · Team B: ${b}. Start when everyone has joined.`, { next: 'Start game' });
        break;
      }
      case 'draw':
        if (amDefender) {
          msg(`Round ${round}: draw your fort`, `Team ${defender} builds. Draw on white paper, then scan it.`, { legend: true, scan: true });
        } else {
          msg('Get ready…', `Team ${defender} is drawing a fort for you to smash.`, { upload: true });
        }
        break;
      case 'scan':
        if (amDefender) {
          msg('Scanning…', scanning ? 'Photo sent! Check the big screen.' : 'If the big screen shows an error, scan again.', { scan: true });
        } else {
          msg('Scanning…', `Team ${defender}'s fort is being built.`, { upload: true });
        }
        break;
      case 'fling': {
        const myShot = shooter === net.pid;
        const left = BIRDS_PER_TURN - birdsUsed;
        if (myShot) {
          show('fling');
          pad.setEnabled(!inFlight);
          pad.setFlying(inFlight);
          $('flingHint').textContent = inFlight
            ? 'Tap for the bird’s power!'
            : `Your shot! ${left} bird${left === 1 ? '' : 's'} left. Drag back, let go.`;
        } else if (amAttacker) {
          msg('Fling time', inFlight ? 'Bird in the air…' : `${shooterName} is aiming. ${left} left.`);
        } else {
          msg('Defend!', `Team ${attacker} is attacking your fort. ${left} bird${left === 1 ? '' : 's'} left.`);
        }
        break;
      }
      case 'result': {
        const r = lastResult;
        let title = 'Turn over';
        if (r?.roundDone) title = r.winner ? `Team ${r.winner} wins round ${round}!` : 'It’s a tie!';
        msg(title, r?.roundDone ? 'Play another round?' : `Next: Team ${defender} attacks.`, { scores: true, next: 'Next' });
        break;
      }
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
