# NOTES: fatgoat032 (Game agent)

Branch: `game`. Owns `src/game/` and `public/assets/`.

## Built
- `src/game/index.js`: `createGame(canvas, { localInput })` returns
  `{ loadLevel, aim, launch, on, off, reset, getState, setMuted, destroy }`.
  - Emits `shotDone({ pigsLeft, birdsUsed, score })` after each shot (everything still for 1.5 s, or 8 s).
  - Other events: `levelLoaded({ blocks, pigs })`, `levelError({ errors })`, `phase({ phase })`,
    `aim`, `launch`, `pigKilled`, `blockBroken`, `explode`, `score`, `fortDestroyed`, `outOfBirds`.
  - Phases: `waiting` → `settling` (1 s, nothing breaks) → `aiming` ⇄ `flying` → `destroyed` | `outOfBirds`.
  - `localInput: true` (default) enables mouse drag on the slingshot, arrow keys and space. Pass `false` on display.html once phones drive it.
- `src/game/world.js`: Matter.js physics and rules, no DOM, so it runs in Node for tests.
- `src/game/render.js`: hand-drawn notebook-style renderer (wobbly "boiling" lines, paper-ball shots, green doodle blobs as targets). When a fort is destroyed it plays an INSTANT REPLAY of the final blow at 0.35× before the banner.
- `src/game/sound.js`: all sounds synthesised with Web Audio, so there are no audio files.
- `src/game/config.js`: every tuning number (table below).
- `src/game/dev.html`: standalone test page, at `/src/game/dev.html` under Vite. Keys: 1/2/3 sample forts, 0 empty, M mute.
- `public/assets/fonts/`: Permanent Marker (Apache 2.0), served locally for offline use.

## Changes from the plan
- **No fork of yumin-jung/angry-birds and no Angry Birds art.** The repo is public, that fork has no licence, and its art is Rovio's. Everything here is original, which also fits "Angry Sketches".
- Launch speed is `6 + power × 16`, not `8 + power × 22`: 30 units/step flew off screen.
- Imports WORLD, validateLevel, clampPigR and sampleLevels from `src/shared/level.js`. A level with zero pigs is rejected with levelError "Draw at least one green pig".

## Tuning (src/game/config.js)
| Thing | Value |
|---|---|
| wood | density 0.002, breaks at impact 8, 500 pts |
| ice | density 0.001, breaks at 4, 300 pts |
| stone | density 0.005, breaks at 15, 800 pts |
| tnt | explodes on impact > 2, radius 150, 1000 pts |
| blob (pig) | dies at impact > 4 or off-world, 5000 pts |
| shots | Scrunch (no ability), Dart (speed ×1.9), Puff (grows ×2), Boomer (flies back); order Scrunch, Dart, Puff each turn; bird density 0.005 and ice friction 0.05 from yumin-jung/angry-birds |
| shots per turn | 3, unused shot bonus 10,000 |
| launch speed | 6 + power × 16 |

## Not done yet (plan P3/P4)

- Custom bird from abdurub10's polygon.
- Live Repair (`repair` event).
- Session leaderboard.

## Mechanics taken from yumin-jung/angry-birds
Bird types with one-time abilities (none / speed boost / grow ×2 / boomerang), bird density 0.005, ice friction 0.05. Re-implemented in `world.js` (`ability()`); the characters are our own paper designs with our own names, no art from that repo.
`game.ability()` fires the ability; space does it locally. Wiring a phone "tap" to it needs a socket event, which is a contract change for Ahmeds-abbas.
