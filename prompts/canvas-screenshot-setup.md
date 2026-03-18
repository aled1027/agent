---
description: Set up Three.js ViewDebug wiring for deterministic canvas-screenshot camera/marker control
---
Set up canvas-screenshot view debug support in this repo.

Please do the following:
1) First, ask me which route(s) should get this setup. If I already specified route(s) in context, confirm and proceed.
2) Copy `~/.pi/agent/skills/canvas-screenshot/scripts/view-debug.ts` into this project under `src/lib/three/view-debug.ts` (or the closest existing TypeScript utilities folder if that path does not fit this repo).
3) For each selected route, find the main Three.js scene setup file and import `ViewDebug` from that copied file.
4) Instantiate it during scene setup with `new ViewDebug(scene, camera, controls?)`.
5) Dispose it during teardown/unmount by calling `.dispose()`.
6) Keep changes minimal and aligned with existing project patterns.
7) At the end, tell me exactly which files were changed and show the final import + setup + teardown snippets for each route.

Goal: enable URL query params `angle`, `pos`, `lookAt`, `zoom`, and `markers` so canvas-screenshot can drive deterministic camera/debug marker state.
