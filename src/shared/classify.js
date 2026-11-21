// CONTRACT: Claude image endpoints on our Node server (vision -> server). Same rules as level.js.
// The Anthropic API key lives only on the server (.env ANTHROPIC_API_KEY); browsers never see it.
// Both endpoints answer within about 10 s. On any failure they answer 200 with { error }, and
// vision falls back to its OpenCV colour masks, so a missing key or no internet never blocks a game.
//
// POST /api/classify   (findShapes found 1-CLASSIFY_MAX_SHAPES shapes)
//   request:  { annotated: dataUrl, clean: dataUrl, count: n }
//             annotated = warped page with each contour outlined and numbered 1..n
//             clean     = the same warped page without marks
//   response: { shapes: [ { n, colour, kind, confidence } ], ms, model }  |  { error, ms? }
//             colour: CLAUDE_COLOURS, kind: CLAUDE_KINDS, confidence 0-1
//
// POST /api/layout     (fallback when OpenCV found 0 or more than CLASSIFY_MAX_SHAPES shapes)
//   request:  { clean: dataUrl }
//   response: { blocks: [ { colour, x, y, w, h, angle } ], pigs: [ { x, y, r } ], ms, model }  |  { error, ms? }
//             Page coordinates 0-1: x and w are fractions of the page width, y and h of the
//             page height, r of the page width. x, y are centres; angle is in radians.
//             Vision maps these to world units.
//
// GET /api/claude/status -> { enabled, model }   (is a key configured on the server?)

export const CLAUDE_COLOURS = Object.freeze(['black', 'blue', 'grey', 'red', 'green', 'other']);
export const CLAUDE_KINDS = Object.freeze(['block', 'pig', 'ignore']);

/** Colour -> material for blocks (green pigs become pigs, "other" is dropped). */
export const COLOUR_MATERIAL = Object.freeze({ black: 'wood', blue: 'ice', grey: 'stone', red: 'tnt' });

/** Shape counts outside 1..CLASSIFY_MAX_SHAPES use /api/layout instead of /api/classify. */
export const CLASSIFY_MAX_SHAPES = 60;

/** Below this confidence, vision uses its own meanColour HSV guess instead of Claude's colour. */
export const MIN_CONFIDENCE = 0.5;
