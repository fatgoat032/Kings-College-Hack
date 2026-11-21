// CONTRACT: socket event names and payloads. Frozen after P0.
// Changes need all three people to agree; ahmeds-abbas commits them with a "CONTRACT:" prefix.
//
// Angles are radians (0 = right, negative = up). Power is 0-1.

export const EVENTS = Object.freeze({
  /** any client -> server: { room, role: "display" | "controller", name } */
  JOIN: 'join',
  /** server -> all: { players, teams, turn, phase } */
  ROOM_STATE: 'room:state',
  /** server -> all: { phase: "lobby" | "draw" | "scan" | "fling" | "result" } */
  PHASE: 'phase',
  /** controller -> server -> display: { dataUrl } (JPEG, max 1280 px wide) */
  FORT_IMAGE: 'fort:image',
  /** display -> server: { blocks: n, pigs: n } */
  LEVEL_READY: 'level:ready',
  /** controller -> server -> display: { angle, power }, at most 20 per second */
  AIM: 'aim',
  /** controller -> server -> display: { angle, power, bird: "red" } */
  LAUNCH: 'launch',
  /** display -> server: { pigsLeft, birdsUsed } */
  SHOT_DONE: 'shot:done',
  /** server -> all: { winner, scores } */
  RESULT: 'result',
});

export const ROLES = Object.freeze({ DISPLAY: 'display', CONTROLLER: 'controller' });

export const PHASES = Object.freeze(['lobby', 'draw', 'scan', 'fling', 'result']);

/** Max aim messages per second from a controller. */
export const AIM_RATE = 20;

/** Max width of a fort:image JPEG, in pixels. */
export const FORT_IMAGE_MAX_W = 1280;

// Bonus (P4), not active yet. It gets added here in a CONTRACT: commit:
//   repair: controller -> server -> display, { x1, y1, x2, y2 } in world units,
//   once per defending team per round.
