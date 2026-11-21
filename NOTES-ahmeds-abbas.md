# NOTES: ahmeds-abbas (network, controller, integration)

## Run
- `npm i && npm run dev` starts Vite on :5173 (LAN) and the socket server on :3000. Vite proxies `/socket.io` and `/api`, so phones only need `http://<laptop-ip>:5173`.
- Pages: `/display.html` (big screen, makes a room code), `/controller.html?room=XXXX` (phone), `/src/net/fake-display.html?room=XXXX` (logs events, fakes level:ready/shot:done), `/src/game/dev.html` (game alone, once merged).
- `npm test` runs the end-to-end socket flow test (needs the server running on :3000).
- Display keys: S = use a sample fort, N = next, L = event log, D = vision debug overlay of the last scan (photo, every debug canvas parseFort returns, blocks per material, thicknesses, detector, Claude ms), H = motion debug HUD (angle, power, source, grip, msgs/s, phone sensor Hz, webcam power sent, last scan), C = cycle the fort detector auto / hybrid / claude / opencv (remembered; M is the game mute).
- Claude: `.env` with ANTHROPIC_API_KEY (optional CLAUDE_MODEL, default claude-sonnet-5-5). The server prints "Claude scanning on/off" at startup; `curl localhost:3000/api/claude/status`.

## Motion slingshot (HTTPS)
Phones only give motion sensors to HTTPS pages, so the tilt-and-swing slingshot needs `npm run dev:https`
(Vite with @vitejs/plugin-basic-ssl, a self-signed cert). On plain `npm run dev` (http) phones use the drag pad automatically.

How it plays (hold the phone upright, portrait): hold anywhere = grip (click + buzz), and the aim starts at 45°.
Turn the phone like a steering wheel: left = higher, right = flatter (0-85°, ±3° dead zone). "Flip aim" swaps the
direction. Pull: with the webcam tracking your hand on the big screen, pull your hand back. Otherwise tip the top of
the phone back towards you (35° = full power). The phone buzzes harder as power fills. Lift your thumb = launch;
under 8% power cancels ("PULL BACK!"). Tap during flight = ability. "Pull: auto/webcam/tilt" forces the source.
Lobby "🎯 Test aim" shows the live angle and pull before playing; press H on the display to compare the numbers.
"Use drag instead" switches modes (remembered per phone). If no sensor data arrives within ~2 s it falls back to drag.

Accepting the self-signed cert (do the laptop first, then each phone, with the same URL the QR shows):
- **Laptop**: open `https://localhost:5173/display.html` → "Your connection is not private" → Advanced → Proceed.
- **Android (Chrome)**: scan the QR (https://<laptop-ip>:5173/…) → "Your connection is not private" → Advanced →
  "Proceed to <ip> (unsafe)". The page then loads; tap "🎯 Enable motion" if it shows.
- **iPhone/iPad (Safari)**: scan the QR → "This Connection Is Not Private" → Show Details → "visit this website" →
  Visit Website (passcode may be asked). Then on the fling screen tap "🎯 Enable motion" → Allow.
  iPhones have no vibration, so the screen flashes LAUNCHED! and a twang plays instead.
- If the warning won't go away or motion is denied: "Use drag instead" always works, or run plain `npm run dev`.

## Built
- P0: Vite multi-page scaffold, `src/shared/level.js`, `src/shared/events.js`.
- CONTRACT 2: `ability`, `next`, optional `join.pid`, optional `shot:done.score`.
- P1 `server/room.js`: auto-balanced teams A/B, shooter rotates per bird among connected attackers, phases lobby → draw → scan → fling → result → draw (swap). One "round" = both teams attack once; the winner is decided at the end of the round. If a team has no players, anyone can act for it (solo testing).
- P1 `src/net/socket.js`: `connect({room, role, name})` returns `{ pid, send, on, off, socket }`. pid lives in sessionStorage (one per tab).
- P1 phone (`src/controller/`): join form (name in localStorage), phase screens, slingshot pad (`pad.js`), tap for ability while in flight, camera to a 1280 px JPEG (`camera.js`).
- P1 display (`src/display/main.js`): code + QR (LAN IP from `/api/info`), rosters, HUD, cards.
- P2 glue (`src/display/integrate.js`): game/vision are loaded via `import.meta.glob`; when missing, the game is skipped and vision is stubbed to sample level 1. Errors show a card with "Use sample fort".

## Waiting on
- `game` branch merge to main (fatgoat032 to open/merge PR). Trial merge has no conflicts and passes a headless e2e test.
- `src/vision/parseFort.js` from abdurub10: `parseFort(img) -> Promise<{ level, debugCanvas }>`, optional `ready()`.

## Known issues / todo
- Not yet tested on real phones over the hotspot (P3).
- A team that switches players mid-game keeps the old pid's slot (offline players stay listed, greyed).
