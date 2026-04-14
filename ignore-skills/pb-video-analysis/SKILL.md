---
name: pb-video-analysis
description: Determine pickleball rally start/end intervals from video using a chunk-based ffprobe/ffmpeg workflow with coarse contact sheets, targeted high-FPS refinement, and player-behavior cues.
---

# Pickleball Video Analysis

Determine when pickleball rallies start and end.

Use the same strategy for short and long videos:
1. inspect metadata
2. divide the video into time chunks
3. do a coarse pass on every chunk
4. mark candidate rally windows
5. refine only those windows at higher FPS
6. split ambiguous windows into smaller subchunks
7. verify boundaries locally

Do **not** scan the full video frame-by-frame unless the user explicitly asks for that.

## Defaults

Use these defaults unless the user specifies otherwise:

- Rally start: first struck ball of the point
- Rally end: point is over and players reset, retrieve, walk, or reposition
- Precision: nearest `0.5s`
- Chunk size: `30s`
- Coarse pass: `1 fps`
- Candidate refinement: `8 fps`
- Boundary verification: `10–15 fps`
- Ambiguous subchunks: `5–10s`
- Faults/lets/aborted points: exclude unless requested

## What to look for

Prefer player behavior over precise ball tracking.

### Rally cues
- ready stance
- serve/return setup
- reactive movement
- exchange posture
- coordinated footwork

### Between-rally cues
- relaxed walking
- ball retrieval
- turning away from play
- talking to partner
- returning to serve/receive positions
- brief stop, then restart

Important:
- do not assume one active-looking block is one rally
- sparse sampling can hide short resets between nearby points
- opening sequences are especially easy to over-merge

## Step 1: Inspect metadata

Use `ffprobe` first.

```bash
ffprobe -v error -show_entries format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate -of json <video>
```

Record:
- duration
- frame rate
- resolution

## Step 2: Divide into chunks

Use a chunk-based workflow for all video lengths.

Default:
- `30s` chunks

Adjust only for efficiency:
- `20s` for dense point sequences
- `45–60s` for very long videos if needed

The method does not change.

## Step 3: Coarse pass on every chunk

Generate a timestamped contact sheet for each chunk.

Default:
- `1 fps`

Example:
```bash
ffmpeg -y -ss <start> -t <duration> -i <video> \
  -vf "fps=1,scale=320:-1,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='%{pts\\:hms}':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=0x00000099,tile=4x8" \
  -frames:v 1 <sheet.jpg>
```

Classify each chunk or sub-window as:
- dead time
- possible rally
- definite rally
- ambiguous / maybe multiple rallies

## Step 4: Refine candidate windows

Only refine candidate windows.

Default refine FPS:
- `8 fps`

Use:
- `4–6 fps` for easy long rallies
- `8–12 fps` for normal review
- `12–20 fps` for short rallies or disputed boundaries

Example:
```bash
ffmpeg -y -ss <start> -t <duration> -i <video> \
  -vf "fps=8,scale=280:-1,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='%{pts\\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=0x00000099,tile=4x10" \
  -frames:v 1 <refined.jpg>
```

## Step 5: Split ambiguous windows

If a candidate window may contain more than one rally, split it into smaller subchunks.

Default subchunk sizes:
- `5s`
- `8s`
- `10s`

Do this when:
- there is a brief reset inside the window
- players stop reacting, then restart
- a short early rally may be followed by another point
- a supposed long rally looks too long for the exchange pattern
- the user says a rally was merged or missed

Preferred action:
- split first
- then inspect subchunks at `8–15 fps`

## Step 6: Set rally boundaries

Mark provisional boundaries from behavior changes.

### Start cues
- first obvious struck ball
- server/receiver move from waiting into live play
- immediate reactive movement begins

### End cues
- players stop reacting
- point outcome is clear
- walking begins
- ball retrieval starts
- players reset for the next point

## Step 7: Verify boundaries locally

Before finalizing, inspect a small window around each boundary.

Default:
- `±1–2s`
- `10–15 fps`

Use higher FPS only if needed.

Example:
```bash
ffmpeg -y -ss <boundary-minus> -t <window> -i <video> \
  -vf "fps=12,scale=280:-1,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='%{pts\\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=0x00000099,tile=4x8" \
  -frames:v 1 <boundary_check.jpg>
```

## Report format

Use the requested format. Default:

- Rally 1: `MM:SS.s → MM:SS.s`
- Rally 2: `MM:SS.s → MM:SS.s`
- ...

Optional:
- total rally count
- confidence notes
- uncertain intervals

## Decision rules

### Increase FPS when
- the rally is short
- the reset is brief
- the start/end is disputed
- the ball is hard to see but posture changes quickly
- opening points may have been merged

### Split a window when
- there is any visible reset inside it
- players disengage, then restart
- one long block may hide two rallies

### Stop refining when
- the requested precision is reached

## Avoid

- full-video frame-by-frame review by default
- relying on OCR or scene-change heuristics for rally detection
- trying to track the ball precisely when posture is enough
- assuming sparse-sampled action is one rally
- refining the whole video uniformly instead of only candidate windows

## Minimal prompt

```text
Analyze `<video-file>` and determine when pickleball rallies start and end.

Defaults:
- Rally start = first struck ball of the point
- Rally end = point is over and players reset / retrieve / reposition
- Precision = nearest 0.5s
- Exclude faults/lets/aborted points unless requested

Method:
- Use ffprobe for metadata.
- Divide the video into time chunks.
- Create coarse timestamped contact sheets for every chunk.
- Mark candidate rally windows.
- Refine only candidate windows at higher FPS.
- Split ambiguous windows into smaller subchunks.
- Verify final boundaries locally.

Return:
- Rally 1: MM:SS.s → MM:SS.s
- Rally 2: MM:SS.s → MM:SS.s
- ...
```

## Quick checklist

1. Run `ffprobe`
2. Split into chunks
3. Make coarse contact sheets
4. Mark candidate windows
5. Refine candidates
6. Split ambiguous windows
7. Verify boundaries
8. Return intervals
