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

Agent guidance for framing and spatial placement:
- Treat camera placement as scene-relative. Before choosing `pos`/`lookAt`, inspect the actual object layout and coordinate system in the target route, then compose the shot from that spatial context.
- Account for camera optics and material behavior. `fov` materially changes perceived distance/scale, and translucent/non-opaque materials can occlude, wash out, or visually hide geometry behind them depending on blend order and angle.
- Interpret relative spatial directives in camera space (e.g., “in front of,” “behind,” “next to,” “beside,” “above,” “below,” “left of,” “right of”), not as world-axis shorthand. Resolve placement from the active camera/view direction so the requested relationship is visually true in-frame.
- Respect object extents, not just pivot points. Use the referenced object’s approximate radius/bounds when positioning “in front of” so the subject is clearly in front of the visible surface, not merely in front of the object origin.

## Setup prompt (copy/paste)
Use this prompt when you want the agent to install the view-debug helper into a project and wire it to a Three.js scene:

```text
Set up canvas-screenshot view debug support in this repo.

Please do the following:
1) Read the codebase and identify routes/scenes that are likely Three.js candidates for screenshot automation (e.g. uses of `THREE`, `three`, `@react-three/fiber`, canvas scene bootstraps, or route-level scene setup).
2) Present the candidate route list to me and ask which route(s) I want to enable. If I already specified route(s), confirm and proceed.
3) Copy `~/.pi/agent/skills/canvas-screenshot/scripts/view-debug.ts` into this project under `src/lib/three/view-debug.ts` (or the closest existing TypeScript utilities folder if that path does not fit this repo).
4) For each selected route, find the main Three.js scene setup file and import `ViewDebug` from that copied file.
5) Instantiate it during scene setup with `new ViewDebug(scene, camera, controls?)`.
6) Dispose it during teardown/unmount by calling `.dispose()`.
7) Keep changes minimal and aligned with existing project patterns.
8) At the end, tell me exactly which files were changed and show the final import + setup + teardown snippets for each route.

Goal: enable URL query params `angle`, `pos`, `lookAt`, `zoom`, and `markers` so canvas-screenshot can drive deterministic camera/debug marker state.
```

In the Pi TUI, you can run the same template via:
- `/canvas-screenshot-setup`
