# NOTES: abdurub10 (Vision agent)

Owner of `src/vision/` and `public/fixtures/`. Branch: `vision`.

## Handoff API (for @Ahmeds-abbas)

```js
import { parseFort, ready } from './src/vision/index.js';

await ready();                                  // loads OpenCV.js (~1-2 s the first time)
const { level, debugCanvas, page, pageToWorld, warnings } = await parseFort(dataUrlOrImageOrCanvas);
// level passes validateLevel(); debugCanvas = flattened page with detections drawn on it
// page = the clean flattened drawing (canvas); pageToWorld = { sx, sy, ox, oy }:
//   worldX = ox + pageX * sx, worldY = oy + pageY * sy  (for cropping real pen strokes as textures)
// Visual check: /fixtures/page-check.html
// debug.masks.{black,blue,grey,red,green} (canvases, white = counted) + debug.overlay (labelled detections);
// failed scans carry the same on err.debug (and err.debugCanvas). The display D key shows them.
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
| P1 | Fixtures page + synthetic fixtures (flat, tilted, dim, no pig, 3 birds): **7/7 pass** | ✅ |
| P1 | 8 real test photos + expected JSON | ⏳ abdurub is drawing them |
| P2 | Real `parseFort` on branch `vision`, ready for @Ahmeds-abbas to merge | ✅ |
| P3 | Snap near-flat blocks (within 6°) | ✅ (in geometry.js) |
| P3 | Calibration screen (`/src/vision/calibrate.html`): load photo, tap a stroke to sample a colour, HSV sliders, live mask, saved to localStorage | ✅ |
| P4 | Bonus: `parseBird()` → `{ polygon, area, pointiness }` for @fatgoat032 | ✅ |
| P5 | Real-photo pass rate in README | ⏳ |

## Bird API (P4, for @fatgoat032)

```js
import { parseBird } from './src/vision/index.js';
const { bird, debugCanvas } = await parseBird(dataUrlOrImage);
// bird.area        0-1 share of the page covered      -> bigger = heavier
// bird.pointiness  0 round … ~0.4 triangle … 0.75 star -> pointier = faster, smaller hitbox
// bird.polygon     [{x,y}] centred on 0,0, farthest point at radius 1 (y down, <= 24 vertices)
//                  scale by the bird radius for Matter.Bodies.fromVertices
```
Any marker colour works for the bird. Measured: round blob 0.013, triangle 0.395, star 0.759.

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

## Drawn-forts fix (Ahmed's brief, 16:40)

| Step | Status |
|---|---|
| 1 Debug overlay: masks per colour as canvases in `result.debug.masks.*` + `debug.overlay` (also `err.debug`); D on the display shows them | ✅ |
| 2 Lighting normalised (divide by a blurred paper-only background) | ✅ (since P1) |
| 3 RED: two hue ranges OR'ed (H 165-180 and 0-12), S ≥ 70, V ≥ 60 | ✅ |
| 4 BLUE H 90-135 S ≥ 60; colours classified BEFORE black; black only if V < 80 AND S < 80, never next to blue/red/green | ✅ |
| 5 GREY: S < 45, V 80-228 on a slightly blurred page (grainy pencil), CLOSE with 1.5% page-width kernel; thickness = max(rect, 2 × max distance transform), never shrunk | ✅ |
| 6 Calibration swatches row | ⏳ not done (calibration screen exists instead) |
| 7 Fixtures with red, blue, wide grey + thickness check | ✅ synthetic: `ipad-marker-pencil`, `real-markers` (real phone photo still needed) |

Saving the last scan to `public/fixtures/last-scan/` needs a file write, which the browser can't do: use D on the display (photo + masks) and save the photo by hand.

## Team Fix #2: hybrid OpenCV + Claude (17:10 brief, A2 + A4)

- `findShapes(cv, imageData, settings)` (findShapes.js): one ink mask, close 1.5%, external contours (drop < 0.3%), approxPolyDP 1%, rect if it fills >= 85% of its rotated rect else poly, meanColour of its own ink, annotated page with big numbers, clean page.
- `parseFort(img, { detector: 'hybrid' })`: findShapes, then POST /api/classify (or /api/layout for 0 or >60 shapes), Claude's colour if confidence >= 0.5 else our HSV guess, green = pig (min enclosing circle), meta.detector hybrid|claude. Any failure falls back to the OpenCV detector.
- **Default is still the per-colour OpenCV detector (`meta.detector = "opencv"`).** Reason: one ink mask merges touching blocks of different colours (black pillars + blue beam + red TNT become ONE shape), so real forts came out worse. Evidence: /fixtures/hybrid-check.html. Switching the default is one line in parseFort.js once shapes come from per-colour masks.

## Known limits

- A diagonal block touching another block of the same colour can be lost when the blob is split into bars.
- Pencil (stone) is the weakest colour: draw it dark and filled in.
- Teal/turquoise markers sit between blue (ice) and green (pig): use clearly blue and clearly green.
