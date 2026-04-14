---
name: pb-video-analysis
description: Analyze pickleball videos to determine rally start/end intervals using coarse-to-fine ffprobe/ffmpeg frame sampling and player behavior cues.
---

# Pickleball Video Analysis

Use this skill to analyze a pickleball video and determine when rallies start and end.

## When to use
- The user wants rally intervals from a video file.
- The user cares about timing precision but does not need full frame-by-frame inspection of the entire video.
- The video contains visible player posture, reset behavior, and court movement that can be used to infer active pickleball play.

## Workflow
1. Clarify the task if needed:
   - required precision
   - rally start definition
   - rally end definition
   - whether faults/lets/aborted points count
   - whether to return only intervals or also notes/reasoning
2. Use `ffprobe` to inspect duration and stream metadata.
3. Create a coarse timestamped contact sheet or sparse frame sample over the full clip with `ffmpeg`.
4. Identify candidate rally windows from player posture, court movement, and reset behavior.
5. Re-export only candidate windows at higher FPS with timestamps.
6. Tighten rally boundaries from behavioral transitions:
   - ready/serve/exchange posture
   - active movement during play
   - relaxed walking
   - ball retrieval
   - repositioning between points
7. Return the rally intervals in the requested format and precision.

## Method guidance
- Prefer coarse-to-fine inspection over scanning the entire video frame-by-frame.
- Prefer player body language and reset behavior over exact ball tracking unless necessary.
- For longer videos, do a very coarse pass first, then refine only likely rally clusters.
- For near frame-accurate timing, inspect only local boundary windows at higher FPS.

## Recommended precision strategy
- Rough intervals: sample every 2–5 seconds.
- Good rally timing: refine candidate windows at 4–10 FPS.
- Near frame-accurate boundaries: inspect only boundary windows at 10–30 FPS.

## Prompt template

```text
Analyze `<video-file>`.

Task:
Determine when rallies start and end.

Definitions:
- A rally starts at `<definition of start>`.
- A rally ends when `<definition of end>`.
- Between rallies, players may reset, retrieve the ball, walk, or reposition.

Requirements:
- Desired precision: `<e.g. nearest 0.5s | nearest 0.1s | frame-accurate if possible>`
- Output only the rally intervals: `<yes/no>`
- Include brief confidence notes: `<yes/no>`
- Include reasoning: `<yes/no>`
- Count faults/lets/aborted points as rallies: `<yes/no>`

Method preferences:
- Use `ffprobe` for duration/metadata.
- Use `ffmpeg` to create coarse timestamped contact sheets first.
- Refine only candidate windows at higher FPS.
- Prefer player body language and reset behavior over precise ball tracking unless necessary.

Output format:
- Rally 1: `MM:SS.s` → `MM:SS.s`
- Rally 2: `MM:SS.s` → `MM:SS.s`
- ...

Optional summary:
- Total rallies: `<n>`
- Notes: `<short note>`
```

## Minimal version

```text
Analyze `<video-file>` and determine when rallies start and end.
A rally starts with `<start definition>` and ends with `<end definition>`.
Use coarse-to-fine timestamped frame sampling with `ffmpeg`/`ffprobe`.
Prefer player reset behavior and posture over exact ball tracking.
Return rally intervals at `<desired precision>`.
```
