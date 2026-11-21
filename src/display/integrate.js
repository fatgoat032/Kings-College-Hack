// Glue between the socket flow, vision (abdurub10) and the game (fatgoat032).
//   fort:image -> parseFort -> game.loadLevel -> level:ready
//   aim / launch / ability -> game
//   game shotDone -> shot:done
// Vision and game are loaded with import.meta.glob, so this file builds and runs
// before their branches are merged; missing modules fall back to stubs.
import { EVENTS } from '../shared/events.js';
import { sampleLevels, validateLevel } from '../shared/level.js';
import { createScanDebug } from './scanDebug.js';

const gameModules = import.meta.glob('../game/index.js');
const visionModules = import.meta.glob('../vision/parseFort.js');

async function loadGame(canvas) {
  const load = gameModules['../game/index.js'];
  if (!load) return null;
  const { createGame } = await load();
  return createGame(canvas, { localInput: false });
}

async function loadVision() {
  const load = visionModules['../vision/parseFort.js'];
  if (!load) {
    // stub until the vision branch lands: every photo becomes sample level 1
    return async () => ({ level: structuredClone(sampleLevels[0]), debugCanvas: null, stub: true });
  }
  const mod = await load();
  await mod.ready?.();
  return mod.parseFort;
}

export function integrate({ net, ui, canvas }) {
  let phase = 'lobby';
  let game = null;
  let parseFort = null;
  let sampleIdx = 0;
  let parsing = 0; // id of the newest parse, so a slow old one can't win
  let levelLoaded = false;
  const scanDebug = createScanDebug(); // D toggles the vision debug overlay

  const gameReady = loadGame(canvas)
    .then((g) => {
      game = g;
      if (!g) return;
      g.on('shotDone', ({ pigsLeft, birdsUsed, score }) => {
        if (phase === 'fling') net.send(EVENTS.SHOT_DONE, { pigsLeft, birdsUsed, score });
      });
      g.on('levelError', ({ errors }) => showFortError(errors?.[0] || 'That fort could not be built.'));
    })
    .catch((err) => console.error('game failed to load', err));
  const visionReady = loadVision()
    .then((fn) => (parseFort = fn))
    .catch((err) => console.error('vision failed to load', err));

  /** Load a level into the game and tell the server it is ready. */
  async function startLevel(level, extras = {}) {
    const check = validateLevel(level);
    if (!check.ok) return showFortError(check.errors[0]);
    if (!level.pigs.length) return showFortError('Draw at least one green pig');
    await gameReady;
    if (game) {
      // extras: { photo, page } so the game can texture blocks with the real pen strokes
      const res = game.loadLevel(level, extras);
      if (res && res.ok === false) return; // levelError handler shows the message
    }
    levelLoaded = true;
    ui.hideCard();
    net.send(EVENTS.LEVEL_READY, { blocks: level.blocks.length, pigs: level.pigs.length });
  }

  function useSample() {
    // the game ships taller demo forts; fall back to the shared samples
    const pool = game?.sampleLevels?.length ? game.sampleLevels : sampleLevels;
    const level = structuredClone(pool[sampleIdx % pool.length]);
    sampleIdx++;
    startLevel(level);
  }

  /** debugCanvas (from vision) shows the drawers what was detected. */
  function showFortError(message, debugCanvas) {
    const msg = String(message).replace(/[.\s]+$/, '');
    ui.card('Fort not ready', `${msg}. Scan again from a phone, or use a sample fort.`, [
      { label: 'Use sample fort', onClick: useSample },
    ], debugCanvas);
  }

  net.on(EVENTS.FORT_IMAGE, async ({ dataUrl } = {}) => {
    if (phase !== 'draw' && phase !== 'scan' && !(phase === 'fling' && !levelLoaded)) return;
    const id = ++parsing;
    ui.card('Scanning fort…', 'Turning your drawing into a level', []);
    try {
      await visionReady;
      // the phone's JPEG data URL goes to vision unchanged (no re-encode, no resize)
      const result = await parseFort(dataUrl);
      scanDebug.record({ photo: dataUrl, result });
      if (id !== parsing) return;
      const { level, page, pageToWorld } = result;
      await startLevel(level, { photo: dataUrl, page, pageToWorld });
    } catch (err) {
      scanDebug.record({ photo: dataUrl, error: err });
      if (id !== parsing) return;
      showFortError(err?.message || String(err), err?.debugCanvas);
    }
  });

  net.on(EVENTS.AIM, (a) => phase === 'fling' && game?.aim(a));
  net.on(EVENTS.LAUNCH, (l) => phase === 'fling' && game?.launch(l));
  net.on(EVENTS.ABILITY, () => phase === 'fling' && game?.ability?.());

  // keyboard shortcuts for the operator: S = sample fort, N = next
  window.addEventListener('keydown', (e) => {
    if ((e.key === 's' || e.key === 'S') && (phase === 'draw' || phase === 'scan' || (phase === 'fling' && !levelLoaded))) useSample();
    if (e.key === 'n' || e.key === 'N') net.send(EVENTS.NEXT, {});
  });

  return {
    onPhase(p, state) {
      phase = p;
      const { attacker, defender } = state.turn;
      if (p !== 'fling') levelLoaded = false;
      game?.setTeam?.(p === 'fling' ? attacker : null); // "TEAM A FLINGING" tag
      if (p === 'draw') {
        game?.reset?.();
        ui.card(`Team ${defender}: draw a fort!`, 'Black = wood · blue = ice · grey = stone · red = TNT · green blobs = pigs. On paper, tap “Scan fort” on a phone. On an iPad, draw on a white page, save it, then tap “Upload drawing”.', [
          { label: 'Use sample fort', onClick: useSample },
        ]);
      } else if (p === 'scan') {
        ui.card('Waiting for the photo…', `Team ${defender}, tap “Scan fort” or “Upload drawing” on a phone.`, [
          { label: 'Use sample fort', onClick: useSample },
        ]);
      } else if (p === 'fling') {
        if (!levelLoaded) {
          // the display was reloaded mid-attack: the fort is gone, so rebuild it
          ui.card('Fort lost', 'The screen was reloaded. Load a fort to restart this attack.', [
            { label: 'Use sample fort', onClick: useSample },
          ]);
        } else if (!game) {
          ui.card('Fling!', `Team ${attacker} is attacking. (Game module not merged yet.)`, []);
        } else {
          ui.hideCard();
        }
      }
    },
    // Turn summary and winner are drawn by the game in the canvas when it supports them;
    // otherwise a marker-style card. Scores are blobs knocked out (tie = fewer birds).
    onResult(r) {
      const next = () => net.send(EVENTS.NEXT, {});
      const blobs = r.blobs || r.scores;
      const t = r.turn;
      if (r.roundDone && game?.showWinner) {
        ui.hideCard();
        return game.showWinner({ winner: r.winner, blobs, birds: r.birds }, next);
      }
      if (!r.roundDone && t && game?.showTurnSummary) {
        ui.hideCard();
        return game.showTurnSummary({ team: t.team, blobs: t.blobs, birds: t.birds });
      }
      const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
      if (r.roundDone) {
        ui.card(r.winner ? `Team ${r.winner} wins!` : 'It’s a draw!',
          `Team A knocked out ${plural(blobs.A, 'blob')} · Team B knocked out ${plural(blobs.B, 'blob')}`,
          [{ label: 'Play again', onClick: next }]);
      } else {
        ui.card(`Team ${t?.team ?? ''} knocked out ${plural(t?.blobs ?? 0, 'blob')}!`,
          `with ${plural(t?.birds ?? 0, 'bird')}. Now swap: the other team attacks.`,
          [{ label: 'Swap teams', onClick: next }]);
      }
    },
  };
}
