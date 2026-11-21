# NOTES: ahmeds-abbas (network, controller, integration)

## Run
- `npm i && npm run dev` starts Vite on :5173 (LAN) and the socket server on :3000. Vite proxies `/socket.io` and `/api`, so phones only need `http://<laptop-ip>:5173`.
- Pages: `/display.html` (big screen, makes a room code), `/controller.html?room=XXXX` (phone), `/src/net/fake-display.html?room=XXXX` (logs events, fakes level:ready/shot:done), `/src/game/dev.html` (game alone, once merged).
- `npm test` runs the end-to-end socket flow test (needs the server running on :3000).
- Display keys: S = use a sample fort, N = next, L = event log.

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
