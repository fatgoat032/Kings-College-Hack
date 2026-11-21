# NOTES: abdurub10 (Vision agent)

Owner of `src/vision/` and `public/fixtures/`. Branch: `vision`.

## Handoff API (for @Ahmeds-abbas)

```js
import { parseFort, ready } from './src/vision/index.js';

await ready();                                  // loads OpenCV.js (~1-2 s the first time)
const { level, debugCanvas, warnings } = await parseFort(dataUrlOrImageOrCanvas);
// level passes validateLevel(); debugCanvas = flattened page with detections drawn on it
```

- Accepts an `<img>`, `<canvas>`, `ImageBitmap` or a **data URL string** (the `fort:image` payload's `dataUrl`).
- On a bad drawing it **rejects** with `err.code === 'VISION_ERROR'` and a player-friendly `err.message`
  (e.g. "Draw at least one green pig"). Show the message and let the team rescan.

## Status

| Phase | Task | Status |
|---|---|---|
| P0 | Stub `parseFort()` returning sample level 1 | ✅ done (replaced by the real one) |
| P1 | OpenCV.js 4.10.0 served locally (`src/vision/vendor/opencv.js`) + `ready()` | ✅ |
| P1 | Paper detection (largest bright quad) + perspective warp | ✅ |
| P1 | Lighting flattening, HSV masks, morphological close | ✅ |
| P1 | Blocks (minAreaRect), touching same-colour blocks split into bars | ✅ |
| P1 | Pigs (minEnclosingCircle), page → fort zone mapping, validateLevel, zero-pig error | ✅ |
| P1 | Fixtures page + 4 synthetic fixtures (flat, tilted, dim, no pig): **4/4 pass** | ✅ |
| P1 | 8 real test photos + expected JSON | ⏳ abdurub is drawing them |
| P2 | Real `parseFort` on branch `vision`, ready for @Ahmeds-abbas to merge | ✅ |
| P3 | Snap near-flat blocks (within 6°) | ✅ (in geometry.js) |
| P3 | Calibration screen | ⏳ |
| P4 | Bonus: draw-your-own-bird polygon | ⏳ |
| P5 | Real-photo pass rate in README | ⏳ |

## How to test

- Unit tests (pure maths, no OpenCV): `node --test src/vision/test/`
- Browser fixtures: `npm run dev`, open `http://localhost:5173/fixtures/fixtures.test.html`
- Regenerate synthetic fixtures: `node src/vision/tools/make-synthetic-fixtures.js`

## Files

- `parseFort.js`: public API (image → ImageData → detect → buildLevel → checks)
- `pipeline.js`: OpenCV steps (paper, warp, lighting, masks, blobs, bar splitting, debug drawing)
- `geometry.js`: pure maths (page px → world units, snapping, min thickness, clamps)
- `settings.js`: HSV ranges and thresholds (+ localStorage overrides from calibration)
- `compare.js`: fixture comparison (centre within 45 units for blocks / 35 for pigs, same material)

## Known limits

- A diagonal block touching another block of the same colour can be lost when the blob is split into bars.
- Pencil (stone) is the weakest colour: draw it dark and filled in.
- Teal/turquoise markers sit between blue (ice) and green (pig): use clearly blue and clearly green.
