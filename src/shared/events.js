// CONTRACT: socket event names and payloads. Frozen after P0.
// Changes need all three people to agree; ahmeds-abbas commits them with a "CONTRACT:" prefix.
//
// Angles are radians (0 = right, negative = up). Power is 0-1.

export const EVENTS = Object.freeze({
  /** any client -> server: { room, role: "display" | "controller", name, pid? }
   *  pid (optional) is a stable per-device id so a phone keeps its team after a reconnect. */
  JOIN: 'join',
  /** server -> all: { players, teams, turn, phase } (+ code, scores; see ROOM_STATE_SHAPE) */
  ROOM_STATE: 'room:state',
  /** server -> all: { phase: "lobby" | "draw" | "scan" | "fling" | "result" } */
  PHASE: 'phase',
  /** controller -> server -> display: { dataUrl } (JPEG, max 1280 px wide) */
  FORT_IMAGE: 'fort:image',
  /** display -> server: { blocks: n, pigs: n } */
  LEVEL_READY: 'level:ready',
  /** controller -> server -> display: { angle, power, source? }, at most AIM_RATE (30) per second while gripping.
   *  This is the "grip:move" stream. source: "webcam" | "tilt" | "drag" (where power came from). */
  AIM: 'aim',
  /** controller -> server -> display: { held: true } on grip start, { held: false, cancel? } on release.
   *  The display stores the webcam hand size at grip start (the pull-by-webcam baseline). */
  GRIP: 'grip',
  /** display -> server -> the shooter's phone only: { power, source: "webcam" | "tilt" }, up to 20/s
   *  while gripping. Live pull power measured on the big screen, so the phone can show a meter and buzz. */
  POWER_UPDATE: 'power:update',
  /** controller -> server -> display: { angle, power, bird: "red" } */
  LAUNCH: 'launch',
  /** controller -> server -> display: {} . Fires the flying bird's one-time ability (game.ability()). */
  ABILITY: 'ability',
  /** display -> server: { pigsLeft, birdsUsed, score? } */
  SHOT_DONE: 'shot:done',
  /** server -> all: { winner, scores } */
  RESULT: 'result',
  /** any client -> server: {} . Advances lobby -> draw, draw -> scan, result -> next round. */
  NEXT: 'next',
});

export const ROLES = Object.freeze({ DISPLAY: 'display', CONTROLLER: 'controller' });

export const PHASES = Object.freeze(['lobby', 'draw', 'scan', 'fling', 'result']);

export const TEAMS = Object.freeze(['A', 'B']);

/** Birds per attacking turn. */
export const BIRDS_PER_TURN = 3;

/** Max aim ("grip:move") messages per second from a controller. */
export const AIM_RATE = 30;

/** Max width of a fort:image JPEG, in pixels. */
export const FORT_IMAGE_MAX_W = 1280;

/** Where launch power came from (AIM.source, POWER_UPDATE.source). */
export const POWER_SOURCES = Object.freeze(['webcam', 'tilt', 'drag']);

// room:state shape (documentation only):
// {
//   code: "ABCD",
//   phase: "lobby" | "draw" | "scan" | "fling" | "result",
//   players: [ { id, name, role, team: "A" | "B" | null, connected } ],
//   teams: { A: [playerId], B: [playerId] },
//   turn: { round, attacker: "A" | "B", defender: "A" | "B", shooter: playerId | null,
//           birdsUsed, pigsLeft, inFlight },
//   scores: { A: n, B: n }
// }
//
// Phase flow (server decides; clients only send events):
//   lobby  --next-->          draw    (defender team draws a fort on paper)
//   draw   --fort:image|next-> scan   (display runs parseFort)
//   scan   --level:ready-->    fling  (attacker team flings, shooters rotate per bird)
//   fling  --shot:done with pigsLeft 0 or birdsUsed >= BIRDS_PER_TURN--> result
//   result --next-->          draw    (teams swap)

// Bonus (P4), not active yet. It gets added here in a CONTRACT: commit:
//   repair: controller -> server -> display, { x1, y1, x2, y2 } in world units,
//   once per defending team per round.
