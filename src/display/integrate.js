// Glue between the socket flow, vision (abdurub10) and the game (fatgoat032).
//   fort:image -> parseFort -> game.loadLevel -> level:ready
//   aim / launch / ability -> game
//   game shotDone -> shot:done
// Vision and game are loaded with import.meta.glob, so this file builds and runs
// before their branches are merged; missing modules fall back to stubs.
import { EVENTS } from '../shared/events.js';
import { sampleLevels, validateLevel } from '../shared/level.js';

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

function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode the photo'));
    img.src = dataUrl;
  });
}

export function integrate({ net, ui, canvas }) {
  let phase = 'lobby';
  let game = null;
  let parseFort = null;
  let sampleIdx = 0;
  let parsing = 0; // id of the newest parse, so a slow old one can't win
  let levelLoaded = false;

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
  async function startLevel(level) {
    const check = validateLevel(level);
    if (!check.ok) return showFortError(check.errors[0]);
    if (!level.pigs.length) return showFortError('Draw at least one green pig');
    await gameReady;
    if (game) {
      const res = game.loadLevel(level);
      if (res && res.ok === false) return; // levelError handler shows the message
    }
    levelLoaded = true;
    ui.hideCard();
    net.send(EVENTS.LEVEL_READY, { blocks: level.blocks.length, pigs: level.pigs.length });
  }

  function useSample() {
    const level = structuredClone(sampleLevels[sampleIdx % sampleLevels.length]);
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
      const img = await dataUrlToImage(dataUrl);
      const { level } = await parseFort(img);
      if (id !== parsing) return;
      await startLevel(level);
    } catch (err) {
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
      if (p === 'draw') {
        game?.reset?.();
        ui.card(`Team ${defender}: draw a fort!`, 'Black = wood · blue = ice · grey = stone · red = TNT · green blobs = pigs. Then tap “Scan fort” on your phone.', [
          { label: 'Use sample fort', onClick: useSample },
        ]);
      } else if (p === 'scan') {
        ui.card('Waiting for the photo…', `Team ${defender}, tap “Scan fort” on a phone.`, [
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
    onResult(r) {
      const { A, B } = r.scores;
      const title = r.roundDone ? (r.winner ? `Team ${r.winner} wins!` : 'It’s a tie!') : 'Turn over';
      ui.card(title, `Team A ${A.toLocaleString()} · Team B ${B.toLocaleString()}`, [
        { label: r.roundDone ? 'Next round' : 'Swap teams', onClick: () => net.send(EVENTS.NEXT, {}) },
      ]);
    },
  };
}
