# NOTES: abdurub10 (Vision agent)

Owner of `src/vision/` and `public/fixtures/`. Branch: `vision`.

## Handoff API (for @Ahmeds-abbas)

```js
import { parseFort, ready } from './src/vision/index.js';

await ready();                                  // OpenCV loaded (instant for the stub)
const { level, debugCanvas } = await parseFort(dataUrlOrImageOrCanvas);
// level passes validateLevel(); debugCanvas shows what was detected (may be null in the stub)
```

- Accepts an `<img>`, `<canvas>`, `ImageBitmap` or a **data URL string** (the `fort:image` payload's `dataUrl`).
- On a bad drawing it **rejects** with `err.code === 'VISION_ERROR'` and a player-friendly `err.message`
  (e.g. "Draw at least one green pig"). Show the message and let the team rescan.

## Status

| Phase | Task | Status |
|---|---|---|
| P0 | Stub `parseFort()` returning sample level 1 | ✅ done |
| P1 | OpenCV.js served locally + `ready()` | ⏳ |
| P1 | 8 real test photos + expected JSON in `public/fixtures/` | ⏳ needs photos from abdurub |
| P1 | Paper detection + perspective warp | ⏳ |
| P1 | HSV colour masks + morphological close | ⏳ |
| P1 | Blocks (minAreaRect), pigs (minEnclosingCircle) | ⏳ |
| P1 | Page → fort zone mapping, validateLevel, zero-pig error | ⏳ |
| P2 | Real `parseFort` handed over | ⏳ |
| P3 | Calibration screen, snap near-flat blocks | ⏳ |
| P4 | Bonus: draw-your-own-bird polygon | ⏳ |
| P5 | Fixture pass rate in README | ⏳ |

## Stubbed / known issues

- `parseFort` is a stub: ignores the image, returns `sampleLevels[0]` with `meta.source = "stub"`.
