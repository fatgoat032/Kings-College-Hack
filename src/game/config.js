// Every tuning number for the game lives here, so it can be changed in one place.
// Units are Matter.js units: world units for distance, units per 1/60 s step for speed.

// World size, ground, slingshot and fort zone come from the shared contract.
export { WORLD } from '../shared/level.js';

// hp: health. floor: impacts below this speed do nothing (resting contact, rolling).
// Damage per hit = (impact - floor) × sqrt(otherMass / ownMass), clamped.
// Cracks show at 50% health; at 0 the block tears into paper scraps.
export const MATERIALS = {
  wood: { density: 0.002, hp: 9, floor: 2, friction: 0.7, restitution: 0.05 },
  ice: { density: 0.0012, hp: 3.5, floor: 1.4, friction: 0.08, restitution: 0.1 },
  stone: { density: 0.005, hp: 38, floor: 3.5, friction: 0.9, restitution: 0.02 },
  tnt: { density: 0.002, hp: 1, floor: 2.4, friction: 0.7, restitution: 0.05, explode: true },
};
export const MASS_FACTOR = { min: 0.35, max: 2.5 };

export const SCRAPS = {
  pieces: [3, 5], // a broken block tears into 3-5 scraps
  life: 3200, // ms before scraps fade out
  max: 45, // oldest scraps are removed above this
  crumpleChance: 0.3, // wood or ice may crumple into a rolling paper ball instead
};

export const TNT = {
  radius: 190,
  kick: 15, // velocity added at the centre, fading to 0 at the radius
  damage: 14, // damage at the centre, fading to 0 at the radius
};

export const BIRD = {
  radius: 26,
  density: 0.006, // heavy enough to hit hard (yumin-jung base used 0.005)
  // speed = minSpeed + power * speedRange; 22 max lands a 45° shot at the far fort edge
  minSpeed: 6,
  speedRange: 16,
  perTurn: 3,
  pullBack: 95,
  stillMs: 1500, // a bird that stays still this long is removed
  stillSpeed: 0.35,
};

// Shot types and their one-time ability (abilities follow yumin-jung/angry-birds;
// the characters and names are our own paper designs). "red" maps to Scrunch.
export const SHOTS = {
  scrunch: { name: 'Scrunch', radius: 26, ability: 'none' },
  dart: { name: 'Dart', radius: 23, ability: 'boost', boost: 1.9 },
  puff: { name: 'Puff', radius: 27, ability: 'grow', grow: 2 },
  boomer: { name: 'Boomer', radius: 25, ability: 'boomerang', back: 1.2, lift: 7 },
};
export const SHOT_ORDER = ['scrunch', 'dart', 'puff'];
export const SHOT_ALIASES = { red: 'scrunch', chuck: 'dart', bomb: 'puff', hal: 'boomer' };

export const PIG = {
  hp: 4,
  floor: 2.6, // a bird rolling slowly into a blob does nothing
  sizeBoost: 1.15, // blobs are simulated and drawn a bit bigger than drawn on paper
};

export const TIMING = {
  step: 1000 / 60,
  settleMs: 1000, // after loadLevel, nothing can break or die for this long
  maxShotMs: 9000,
  bannerMs: 1300,
  collapseWindow: 700, // this many ms...
  collapseBlocks: 3, // ...with this many breaks counts as a collapse
  collapseSlowMo: { scale: 0.45, ms: 650 },
  killCam: { scale: 0.22, ms: 1500 },
};
