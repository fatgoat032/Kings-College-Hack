// One game room: players, two teams, turn order and the phase machine.
// Pure logic, no sockets, so it can be tested on its own. server/index.js does the I/O.
import { ROLES, TEAMS, BIRDS_PER_TURN } from '../src/shared/events.js';

const other = (t) => (t === 'A' ? 'B' : 'A');

export function createRoom(code) {
  /** pid -> { id, name, role, team, connected } */
  const players = new Map();
  const room = {
    code,
    phase: 'lobby',
    scores: { A: 0, B: 0 }, // = blobs knocked out (kept for older clients)
    blobs: { A: 0, B: 0 },
    birds: { A: 0, B: 0 },
    pigsAtStart: null,
    round: 1,
    attacker: 'A',
    birdsUsed: 0,
    pigsLeft: null,
    inFlight: false,
    attacksThisRound: 0,
  };

  const controllers = (team) =>
    [...players.values()].filter((p) => p.role === ROLES.CONTROLLER && (!team || p.team === team));
  const connected = (team) => controllers(team).filter((p) => p.connected);

  function shooter() {
    const team = connected(room.attacker);
    const pool = team.length ? team : connected(); // a one-team test game: anyone can shoot
    return pool.length ? pool[room.birdsUsed % pool.length] : null;
  }

  /** Is this player allowed to act for `team`? An empty team lets anyone act (solo testing). */
  const actsFor = (p, team) => p && p.role === ROLES.CONTROLLER && (p.team === team || connected(team).length === 0);

  function state() {
    const list = [...players.values()];
    return {
      code,
      phase: room.phase,
      players: list,
      teams: Object.fromEntries(TEAMS.map((t) => [t, controllers(t).map((p) => p.id)])),
      turn: {
        round: room.round,
        attacker: room.attacker,
        defender: other(room.attacker),
        shooter: shooter()?.id ?? null,
        birdsUsed: room.birdsUsed,
        pigsLeft: room.pigsLeft,
        inFlight: room.inFlight,
      },
      scores: { ...room.scores },
      blobs: { ...room.blobs },
      birds: { ...room.birds },
    };
  }

  function setPhase(phase) {
    room.phase = phase;
    if (phase === 'draw') {
      room.birdsUsed = 0;
      room.pigsLeft = null;
      room.inFlight = false;
    }
  }

  // ---- actions; each returns a list of effects for index.js to perform ----
  // effect: { type: 'phase' } | { type: 'result', winner, scores } | { type: 'relay' }

  function join(pid, { name, role }) {
    let p = players.get(pid);
    if (!p) {
      let team = null;
      if (role === ROLES.CONTROLLER) {
        const a = controllers('A').length;
        const b = controllers('B').length;
        team = a <= b ? 'A' : 'B';
      }
      p = { id: pid, name: String(name || role).slice(0, 20), role, team, connected: true };
      players.set(pid, p);
    } else {
      p.connected = true;
      if (name) p.name = String(name).slice(0, 20);
    }
    return p;
  }

  function leave(pid) {
    const p = players.get(pid);
    if (p) p.connected = false;
  }

  function next(pid) {
    const p = players.get(pid);
    if (!p) return [];
    if (room.phase === 'lobby') {
      if (connected().length === 0) return [];
      setPhase('draw');
      return [{ type: 'phase' }];
    }
    if (room.phase === 'draw') {
      setPhase('scan');
      return [{ type: 'phase' }];
    }
    if (room.phase === 'result') {
      if (room.attacksThisRound >= 2) {
        room.round += 1;
        room.attacksThisRound = 0;
      }
      room.attacker = other(room.attacker);
      setPhase('draw');
      return [{ type: 'phase' }];
    }
    return [];
  }

  function fortImage(pid) {
    const p = players.get(pid);
    if (room.phase !== 'draw' && room.phase !== 'scan') return [];
    // any phone may send the fort: a shared iPad drawing can be uploaded from whichever team it joined
    if (!p || p.role !== ROLES.CONTROLLER) return [];
    const fx = [{ type: 'relay' }];
    if (room.phase === 'draw') {
      setPhase('scan');
      fx.unshift({ type: 'phase' });
    }
    return fx;
  }

  function levelReady(pid, { pigs } = {}) {
    const p = players.get(pid);
    if (!p || p.role !== ROLES.DISPLAY) return [];
    // fling too: a reloaded display re-sends its fort and the attack restarts
    if (!['draw', 'scan', 'fling'].includes(room.phase)) return [];
    room.pigsAtStart = Number.isFinite(pigs) ? pigs : null;
    room.pigsLeft = room.pigsAtStart;
    room.birdsUsed = 0;
    room.inFlight = false;
    setPhase('fling');
    return [{ type: 'phase' }];
  }

  function aim(pid) {
    if (room.phase !== 'fling' || room.inFlight) return [];
    return shooter()?.id === pid ? [{ type: 'relay' }] : [];
  }

  /** grip {held}: the shooter grabbed or let go of the pouch (display takes its webcam baseline). */
  function grip(pid) {
    if (room.phase !== 'fling' || room.inFlight) return [];
    return shooter()?.id === pid ? [{ type: 'relay' }] : [];
  }

  /** power:update from the display goes only to the current shooter's phone. */
  function powerUpdate(pid) {
    const p = players.get(pid);
    if (!p || p.role !== ROLES.DISPLAY || room.phase !== 'fling' || room.inFlight) return [];
    const s = shooter();
    return s ? [{ type: 'toPlayer', id: s.id }] : [];
  }

  function launch(pid) {
    if (room.phase !== 'fling' || room.inFlight) return [];
    if (shooter()?.id !== pid) return [];
    room.inFlight = true;
    room.launchAt = Date.now();
    return [{ type: 'relay' }, { type: 'state' }];
  }

  function ability(pid) {
    if (room.phase !== 'fling' || !room.inFlight) return [];
    return actsFor(players.get(pid), room.attacker) ? [{ type: 'relay' }] : [];
  }

  function shotDone(pid, { pigsLeft, birdsUsed } = {}) {
    const p = players.get(pid);
    if (!p || p.role !== ROLES.DISPLAY || room.phase !== 'fling') return [];
    room.inFlight = false;
    room.birdsUsed = Number.isFinite(birdsUsed) ? birdsUsed : room.birdsUsed + 1;
    room.pigsLeft = Number.isFinite(pigsLeft) ? pigsLeft : room.pigsLeft;
    if (room.pigsLeft === 0 || room.birdsUsed >= BIRDS_PER_TURN) return endAttack();
    return [{ type: 'state' }];
  }

  // Scoring: blobs (pigs) knocked out, counted by the server from level:ready pigs
  // minus pigsLeft. Winner = more blobs; tie = fewer birds used; else a draw.
  function endAttack() {
    const t = room.attacker;
    const blobs = Number.isFinite(room.pigsAtStart) && Number.isFinite(room.pigsLeft)
      ? Math.max(0, room.pigsAtStart - room.pigsLeft) : 0;
    room.blobs[t] += blobs;
    room.birds[t] += room.birdsUsed;
    room.scores[t] = room.blobs[t];
    room.attacksThisRound += 1;
    setPhase('result');
    const roundDone = room.attacksThisRound >= 2;
    let winner = null;
    if (roundDone) {
      const { A, B } = room.blobs;
      if (A !== B) winner = A > B ? 'A' : 'B';
      else if (room.birds.A !== room.birds.B) winner = room.birds.A < room.birds.B ? 'A' : 'B';
    }
    const turn = { team: t, blobs, birds: room.birdsUsed };
    return [{ type: 'phase' }, {
      type: 'result', winner, roundDone, turn,
      scores: { ...room.scores }, blobs: { ...room.blobs }, birds: { ...room.birds },
    }];
  }

  /** Safety net: a launch with no shot:done for this long is dropped so the turn can't hang. */
  function tick(now = Date.now(), maxFlightMs = 20000) {
    if (room.phase === 'fling' && room.inFlight && now - (room.launchAt || 0) > maxFlightMs) {
      room.inFlight = false;
      return [{ type: 'state' }];
    }
    return [];
  }

  return { code, players, state, tick, join, leave, next, fortImage, levelReady, aim, grip, powerUpdate, launch, ability, shotDone };
}
