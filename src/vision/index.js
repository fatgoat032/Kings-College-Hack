// Public entry point for the vision module. Import from here:
//   import { parseFort, ready } from './src/vision/index.js';
export { parseFort, ready, visionError } from './parseFort.js';
// P4 bonus: draw-your-own-bird -> { bird: { polygon, area, pointiness }, debugCanvas }
export { parseBird } from './parseBird.js';
