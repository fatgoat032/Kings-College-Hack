
## ahmeds-abbas -> abdurub10: auto-pick on every scan (user brief "run Claude-only layout on EVERY scan")
In src/vision/parseFort.js, parseFort(dataUrl, { detector }) with detector 'auto' (new default) | 'hybrid' | 'claude' | 'opencv':
- auto: start HYBRID (per-colour shapes + /api/classify) and CLAUDE-ONLY (/api/layout + your clean-up: snap angles within 8°, settle blocks onto ground/blocks below, drop pigs onto surfaces) in parallel with Promise.allSettled, sharing ONE 10 s timeout.
- Pick: HYBRID if classify answered every shape, average confidence >= 0.7 and hybrid block count within ±30% of CLAUDE-ONLY's; else CLAUDE-ONLY. Only one succeeded -> that one. Both failed -> OPENCV.
- level.meta.detector = the one used ('hybrid' | 'claude' | 'opencv').
- Return, besides level/page/pageToWorld/debug/timings:
  result.candidates = { hybrid?, claude?, opencv? }, each { ok, level?, error?, ms, avgConfidence?, complete?, overlay? (canvas) }
  result.pick = { chose: 'hybrid'|'claude'|'opencv', reason: 'string for the D overlay' }
The display (mine) adds the M toggle (auto/hybrid/claude/opencv -> options.detector), the on-screen "read by Claude"/"hybrid" tag and the side-by-side D overlay built from result.candidates.
