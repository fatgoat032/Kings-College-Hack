# NOTES: ahmeds-abbas (network, controller, integration)

## Built (P0)
- Vite multi-page project: `index.html`, `display.html`, `controller.html`. `npm run dev` starts Vite (:5173, LAN) and the socket server (:3000); Vite proxies `/socket.io` to the server, so phones only need :5173.
- `src/shared/level.js`: `WORLD`, `MATERIALS`, `PIG_R`, `validateLevel()`, `clampPigR()`, `sampleLevels` (3, same forts as the game branch's local copy).
- `src/shared/events.js`: `EVENTS`, `ROLES`, `PHASES`, `AIM_RATE`, `FORT_IMAGE_MAX_W`.
- `server/index.js`: join rooms, relay `fort:image` / `aim` / `launch` to the room's display, log `level:ready` / `shot:done`.
- `src/net/socket.js`: `connect({room, role, name})` returns `{ send, on, off, socket }`, rejoins on reconnect, throttles aim.

## Stubbed
- display.html and controller.html are placeholders (event log, test-launch button).
- No teams, turn order or phase machine yet (P1).

## Known issues
- none yet
