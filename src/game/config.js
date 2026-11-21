// Every tuning number for the game lives here, so it can be changed in one place.
// Units are Matter.js units: world units for distance, units per 1/60 s step for speed.

// World size, ground, slingshot and fort zone come from the shared contract.
export { WORLD } from '../shared/level.js';

// density: Matter density. breakAt: a single impact above this breaks the block.
// points: score for breaking it.
export const MATERIALS = {
  wood: { density: 0.002, breakAt: 8, points: 500, friction: 0.8 },
  ice: { density: 0.001, breakAt: 4, points: 300, friction: 0.05 }, // slippery, as in yumin-jung/angry-birds
  stone: { density: 0.005, breakAt: 15, points: 800, friction: 0.9 },
  tnt: { density: 0.002, breakAt: 2, points: 1000, friction: 0.8, explode: true },
};

export const TNT = {
  radius: 150, // bodies within this distance get pushed
  force: 0.06, // force per unit mass at the centre, fades to 0 at the radius
  breakRadius: 0.6, // fraction of radius inside which wood and ice break outright
};

export const BIRD = {
  radius: 22,
  density: 0.005, // yumin-jung/angry-birds bird density
  // speed = minSpeed + power * speedRange. The plan suggested 8 + 22, but at
  // 30 units/step a full-power shot flies off screen; 22 max lands a 45° shot
  // around the far edge of the fort zone.
  minSpeed: 6,
  speedRange: 16,
  perTurn: 3,
  pullBack: 90, // how far the shot is drawn back at full power (visual only)
};

// Shot types and their one-time ability (space bar, or game.ability()).
// The four abilities follow yumin-jung/angry-birds (none, speed boost, grow x2,
// boomerang); the characters and names are our own paper designs.
// The contract's launch payload says bird: "red"; "red" maps to Scrunch.
export const SHOTS = {
  scrunch: { name: 'Scrunch', radius: 22, ability: 'none' }, // crumpled paper ball
  dart: { name: 'Dart', radius: 20, ability: 'boost', boost: 1.9 }, // paper plane
  puff: { name: 'Puff', radius: 24, ability: 'grow', grow: 2 }, // paper bag
  boomer: { name: 'Boomer', radius: 22, ability: 'boomerang', back: 1.2, lift: 7 }, // paper boomerang
};
export const SHOT_ORDER = ['scrunch', 'dart', 'puff']; // one of each per 3-shot turn
export const SHOT_ALIASES = { red: 'scrunch', chuck: 'dart', bomb: 'puff', hal: 'boomer' };

export const PIG = {
  killImpact: 4,
  points: 5000,
};

export const TIMING = {
  step: 1000 / 60,
  settleMs: 1000, // after loadLevel, nothing can break or die for this long
  restMs: 1500, // a shot ends when everything has been still this long
  maxShotMs: 8000, // or after this long, whichever is first
  restSpeed: 0.2,
  restAngular: 0.02,
  bannerMs: 1600,
};

export const SCORE = {
  unusedShotBonus: 10000,
};
