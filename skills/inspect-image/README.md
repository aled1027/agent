# inspect-image

JavaScript CLI for sending one or more local images plus a text prompt to OpenRouter, defaulting to `google/gemini-3.1-pro-preview`.

When multiple images are provided, the CLI sends one separate chat completion request per image. If you pass 5 images, it creates 5 distinct conversations, dispatches them concurrently, and returns 5 separate results.

## Environment

Required variable:

- `OPENROUTER_API_KEY`

Optional:

- `DEBUG=1` — enable debug logging to stderr

Built-in defaults:

- model: `google/gemini-3.1-pro-preview`
- timeout: `60000ms` (60s)

## Examples

```bash
./inspect-image analyze ./workspace/demo/frame.jpg \
  --prompt "Summarize what is happening in this frame."
```

```bash
./inspect-image analyze ./workspace/demo/contact-sheet.jpg \
  --prompt-file ./workspace/demo/prompt.txt \
  --output ./workspace/demo/response.json
```

```bash
./inspect-image analyze \
  ./workspace/demo/frame-01.jpg \
  ./workspace/demo/frame-02.jpg \
  --prompt "Describe each frame separately." \
  --output ./workspace/demo/responses.json
```

```bash
DEBUG=1 ./inspect-image analyze ./workspace/demo/frame.jpg \
  --prompt "What is in this image?"
```

```bash
./inspect-image analyze ./workspace/demo/frame.jpg \
  --prompt "Analyze in detail." \
  --timeout 120000
```

## Output format

When `--output` is provided, the CLI writes compact JSON by default and does **not** include the raw API response. This avoids accidentally writing base64 image data into workspace artifacts.

If you explicitly need the raw response for debugging, pass `--include-raw`. Any embedded `data:image/...` URLs are sanitized to `"[omitted data URL]"` before being written.

Default JSON looks like:

```json
{
  "model": "google/gemini-3.1-pro-preview",
  "createdAt": "2026-04-21T12:34:56.000Z",
  "prompt": "Summarize what is happening in this frame.",
  "mode": "separate-conversations-per-image",
  "images": ["/abs/path/to/frame.jpg"],
  "results": [
    {
      "index": 0,
      "image": "/abs/path/to/frame.jpg",
      "response": "...model output..."
    }
  ]
}
```

## Architecture

- `api.js` — OpenRouter API client (`OpenRouterClient` class), shared utilities (`resolveImagePath`, `readPromptFile`, `mimeTypeFor`)
- `main.js` — CLI entry point: argument parsing, orchestration, output formatting
- `inspect-image` — shell wrapper that invokes `main.js`
