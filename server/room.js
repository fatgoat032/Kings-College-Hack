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
    scores: { A: 0, B: 0 },
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
    if (!actsFor(p, other(room.attacker))) return [];
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
    if (room.phase !== 'scan' && room.phase !== 'draw') return [];
    room.pigsLeft = Number.isFinite(pigs) ? pigs : null;
    room.birdsUsed = 0;
    room.inFlight = false;
    setPhase('fling');
    return [{ type: 'phase' }];
  }

  function aim(pid) {
    if (room.phase !== 'fling' || room.inFlight) return [];
    return shooter()?.id === pid ? [{ type: 'relay' }] : [];
  }

  function launch(pid) {
    if (room.phase !== 'fling' || room.inFlight) return [];
    if (shooter()?.id !== pid) return [];
    room.inFlight = true;
    return [{ type: 'relay' }, { type: 'state' }];
  }

  function ability(pid) {
    if (room.phase !== 'fling' || !room.inFlight) return [];
    return actsFor(players.get(pid), room.attacker) ? [{ type: 'relay' }] : [];
  }

  function shotDone(pid, { pigsLeft, birdsUsed, score } = {}) {
    const p = players.get(pid);
    if (!p || p.role !== ROLES.DISPLAY || room.phase !== 'fling') return [];
    room.inFlight = false;
    room.birdsUsed = Number.isFinite(birdsUsed) ? birdsUsed : room.birdsUsed + 1;
    room.pigsLeft = Number.isFinite(pigsLeft) ? pigsLeft : room.pigsLeft;
    // the game reports its running total for this attack; keep the best we've seen
    if (Number.isFinite(score)) room.attackScore = Math.max(room.attackScore || 0, score);
    if (room.pigsLeft === 0 || room.birdsUsed >= BIRDS_PER_TURN) return endAttack();
    return [{ type: 'state' }];
  }

  function endAttack() {
    room.scores[room.attacker] += room.attackScore || 0;
    room.attackScore = 0;
    room.attacksThisRound += 1;
    setPhase('result');
    const { A, B } = room.scores;
    const roundDone = room.attacksThisRound >= 2;
    const winner = roundDone ? (A === B ? null : A > B ? 'A' : 'B') : null;
    return [{ type: 'phase' }, { type: 'result', winner, scores: { ...room.scores }, roundDone }];
  }

  return { code, players, state, join, leave, next, fortImage, levelReady, aim, launch, ability, shotDone };
}
