---
description: Set up Three.js ViewDebug wiring for deterministic canvas-screenshot camera/marker control
---
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
