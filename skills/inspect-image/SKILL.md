---
name: inspect-image
description: Call OpenRouter's google/gemini-3.1-pro-preview image model with a prompt and one or more local images. Use when you want scripted image analysis from the terminal as a replacement path for the secondary image model extension.
---

# inspect-image

Use this skill when you want to send one or more local images plus a prompt to a vision-capable model from this repo. Each image is analyzed in its own separate conversation, so passing multiple images creates multiple independent model requests rather than one combined comparison request. The CLI dispatches those per-image requests concurrently.

This skill is implemented in JavaScript and is configured specifically for OpenRouter, defaulting to `google/gemini-3.1-pro-preview` via OpenRouter's `/chat/completions` API.

## When to use
- Analyze screenshots, diagrams, photos, rendered frames, or contact sheets.
- Save inspect-image outputs into reusable workspace artifacts.
- Prototype a local replacement path for the current secondary image model extension.
- Run repeatable image prompts outside the built-in image-analysis tool.

## Requirements
Set the API key before use:

```bash
export OPENROUTER_API_KEY=...
```

Defaults built into the CLI:
- model: `google/gemini-3.1-pro-preview`
- timeout: `60000ms` (60s)

## How to use
Use the local wrapper in this skill directory:

```bash
./inspect-image --help
```

Common commands:

```bash
# Single image
./inspect-image analyze ./workspace/example/frame.jpg \
  --prompt "Describe the player's body position and paddle contact point."

# Multiple images as separate conversations
./inspect-image analyze \
  ./workspace/example/frame-01.jpg \
  ./workspace/example/frame-02.jpg \
  --prompt "Describe the player's body position in this frame."

# Output contains one result object per image
./inspect-image analyze \
  ./workspace/example/frame-01.jpg \
  ./workspace/example/frame-02.jpg \
  --prompt "Describe this frame independently." \
  --output ./workspace/example/inspect-image-responses.json

# Save structured output to the workspace
./inspect-image analyze ./workspace/example/contact-sheet.jpg \
  --prompt-file ./workspace/example/prompt.txt \
  --output ./workspace/example/inspect-image-response.json
```

## Debugging

Enable verbose debug logging to stderr with `DEBUG=1`:

```bash
DEBUG=1 ./inspect-image analyze ./workspace/example/frame.jpg \
  --prompt "What is in this image?"
```

Debug output goes to stderr so it doesn't interfere with piped stdout.

## Timeout

The CLI has a global timeout (default 60s) that kills the process if any request hangs. Override with `--timeout`:

```bash
./inspect-image analyze ./workspace/example/frame.jpg \
  --prompt "Analyze this image in detail." \
  --timeout 120000
```

On timeout, in-flight requests are aborted via `AbortController` and the process exits with a clear `✗` error message.

## Practical guidance
- Relative image and output paths are resolved from the caller's current working directory.
- Prefer writing outputs under `./workspace/...` rather than temporary directories.
- Use contact sheets when you want one image file to summarize many video moments in a single per-image request.
- If you pass multiple image paths, the CLI sends one distinct chat completion request per image, dispatches them concurrently, and returns one result per image.
- Keep prompts concrete: ask for exact objects, actions, timestamps, comparisons, or uncertainties.
- If OpenRouter rejects the request, first verify `OPENROUTER_API_KEY` and model name.
- Use `DEBUG=1` to trace request flow when troubleshooting failures.

## Files
- `./inspect-image` — shell wrapper that runs the Node CLI
- `./main.js` — CLI entry point (argument parsing, orchestration, output)
- `./api.js` — OpenRouter API client (shared module, analogous to web-browser's `cdp.js`)
- `./README.md` — local notes and examples
- `./package.json` — package metadata for the skill
