# Angry Sketches

**Draw a fortress on paper. Your friends knock it down with their phones.**

Team A draws a fort on plain paper with coloured markers. A phone photo turns the drawing into a physics level on the big screen. Team B uses their phones as the slingshot: drag back, let go, tap for the bird's power. Pigs die, blocks fall, then the teams swap.

Track: **Retro Remix (Old Tech, New Tricks)**. Pen and paper is the level editor.

| Drawn with | Becomes |
|---|---|
| black marker | wood |
| blue | ice (light, shatters) |
| pencil / grey | stone (heavy) |
| red | TNT (explodes) |
| green blobs | pigs |

## Play it

You need Node 20+, one laptop for the big screen, and phones on the same Wi-Fi or hotspot.

```bash
npm install
npm run dev          # Vite on :5173 (LAN) + Socket.io server on :3000
```

1. On the laptop, open `http://localhost:5173/display.html` fullscreen. It shows a room code and a QR code.
2. Each player scans the QR and enters a name. Teams are balanced automatically.
3. Press **Start game**. The defending team draws a fort and taps **Scan fort** on a phone.
4. The attacking team flings: drag back from the centre of the phone screen and let go. Tap mid-flight for the bird's ability. 3 birds per turn, shooters rotate.
5. After both teams attack, the higher score wins the round.

Display keys: **S** use a sample fort (backup if a scan fails), **N** next, **L** event log, **D** vision debug overlay of the last scan, **H** motion debug HUD, **C** switch fort detector (OpenCV / hybrid OpenCV + Claude).

Claude scanning: put `ANTHROPIC_API_KEY=...` in `.env` in the repo root (git-ignored, see `.env.example`). Only the Node server reads it. Without a key or internet, scanning uses OpenCV alone.
Lighting calibration for vision: `/src/vision/calibrate.html`.

## How it works

```
 phone (controller.html)                 big screen (display.html)
 slingshot pad, camera  ── socket.io ──▶  server phase machine ──▶ parseFort(photo) ──▶ Level JSON
                                          lobby → draw → scan          (OpenCV.js)          │
                                          → fling → result                                 ▼
                         ◀── room:state ──                         createGame(canvas) (Matter.js)
```

- **Vision** (`src/vision/`): OpenCV.js runs in the browser. It finds the paper, warps it flat, evens out lighting, masks each colour in HSV, then turns strokes into rotated rectangles (blocks) and green blobs into circles (pigs). It maps the page into the fort zone and validates the result. Runs offline, under a second.
- **Game** (`src/game/`): Matter.js physics with a hand-drawn notebook renderer. Wood, ice, stone and TNT behave differently, 4 shot types have one-time abilities, a slow-motion instant replay plays the final blow, and all sound is synthesised with Web Audio.
- **Network** (`server/`, `src/net/`, `src/controller/`, `src/display/`): Express + Socket.io. Rooms are 4-letter codes, teams auto-balance, phones keep their team after a reconnect, and aim is throttled to 20/s. The server owns turn order and rejects out-of-turn input.
- **Contracts** (`src/shared/`): a Level JSON schema with `validateLevel()`, and the socket event list. These are the only things the three parts share.

## Tests

- `npm test`: end-to-end socket flow (teams, permissions, reconnect, scoring, team swap).
- `/fixtures/fixtures.test.html`: vision fixtures, expected against actual.
- `/src/game/dev.html`: the game on its own, with mouse and keyboard.
- `/src/net/fake-display.html?room=XXXX`: logs every event, for testing phones without the game.

## How we built it

Three people, each running a Claude Code agent with strict folder ownership: vision (`abdurub10`), game (`fatgoat032`), and network plus integration (`Ahmeds-abbas`). The agents coordinate on a pinned GitHub issue used as a message board (`tools/board`, rules in `AGENTS.md`). Everyone wrote against the frozen contracts in `src/shared/` from hour 1, so nobody waited on anybody.

## Credits

- Shot types and physics tuning are adapted from [yumin-jung/angry-birds](https://github.com/yumin-jung/angry-birds). All characters and art are our own.
- [Matter.js](https://brm.io/matter-js/), [OpenCV.js](https://docs.opencv.org/), [Socket.io](https://socket.io/), [Vite](https://vitejs.dev/), [qrcode](https://github.com/soldair/node-qrcode).
- Font: Permanent Marker (Apache 2.0).
