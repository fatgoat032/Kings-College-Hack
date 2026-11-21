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
- `src/game/render.js`: hand-drawn notebook-style renderer (wobbly "boiling" lines, paper-ball shots, green doodle blobs as targets).
- `src/game/sound.js`: all sounds synthesised with Web Audio, so there are no audio files.
- `src/game/config.js`: every tuning number (table below).
- `src/game/dev.html`: standalone test page, at `/src/game/dev.html` under Vite. Keys: 1/2/3 sample forts, 0 empty, M mute.
- `public/assets/fonts/`: Permanent Marker (Apache 2.0), served locally for offline use.

## Changes from the plan
- **No fork of yumin-jung/angry-birds and no Angry Birds art.** The repo is public, that fork has no licence, and its art is Rovio's. Everything here is original, which also fits "Angry Sketches".
- Launch speed is `6 + power × 16`, not `8 + power × 22`: 30 units/step flew off screen.
- Uses a local `sampleLevels.js` until `src/shared/level.js` lands; then switch the import over.

## Tuning (src/game/config.js)
| Thing | Value |
|---|---|
| wood | density 0.002, breaks at impact 8, 500 pts |
| ice | density 0.001, breaks at 4, 300 pts |
| stone | density 0.005, breaks at 15, 800 pts |
| tnt | explodes on impact > 2, radius 150, 1000 pts |
| blob (pig) | dies at impact > 5 or off-world, 5000 pts |
| shots per turn | 3, unused shot bonus 10,000 |
| launch speed | 6 + power × 16 |

## Not done yet (plan P3/P4)
- Slow-motion replay of the last 3 s.
- Custom bird from abdurub10's polygon.
- Live Repair (`repair` event).
- Session leaderboard.
