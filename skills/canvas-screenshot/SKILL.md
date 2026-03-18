---
name: canvas-screenshot
description: Deterministic canvas/Three.js screenshots via Chrome CDP. Use for route-level visual captures with camera query params (`angle`, `pos`, `lookAt`, `zoom`) and debug markers.
---

# canvas-screenshot

Use this skill when you need deterministic screenshots of a Three.js/canvas route for docs, visual checks, or design reviews.

## When to use
- Capture a canvas or full-page screenshot from a local dev route.
- Set camera state via URL params (`angle`, `pos`, `lookAt`, `zoom`).
- Add one or more debug markers for spatial verification.

## How to use
Run:

```bash
npx tsx ~/.pi/agent/skills/canvas-screenshot/scripts/canvas-screenshot.ts [options]
```

Common options:
- `--out <file>` output png path
- `--port <number>` dev server port (default `5173`)
- `--route <path>` route to open (default `/demos/agent-loop`)
- `--selector <css>` canvas selector for clipped capture
- `--full-page` capture the full page instead of canvas clip
- `--angle`, `--pos`, `--look-at`, `--zoom` camera params
- `--marker "x,y,z,color,size"` repeatable; or multiple via `;`
- `--cdp-port <number>` Chrome debug port (default `9222`)
- `--chrome-path <path>` optional Chrome executable
- `--headless` applies only if the script auto-launches Chrome

Notes:
- The script first tries an existing Chrome CDP endpoint, then auto-launches Chrome if needed.
- Wire `scripts/view-debug.ts` into route lifecycle: instantiate `new ViewDebug(scene, camera, controls?)` at scene setup and dispose on teardown. That is what enables `angle/pos/lookAt/zoom/markers` query-param control.
- The target route must support the query params mentioned above to control camera/markers.
