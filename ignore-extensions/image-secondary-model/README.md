# image-secondary-model

Pi extension that keeps your main agent on one model while delegating image analysis to a separate vision-capable model.

## What it adds

- Tool: `analyze_with_secondary_vision_model`
- Command: `/image-model` selector or `/image-model [provider/model|reset]`
- Command: `/ask-image-model <question>`

## Default model

The extension uses:

- `PI_IMAGE_MODEL` env var, if set
- otherwise `openai-codex/gpt-5.1`

Examples:

```bash
export PI_IMAGE_MODEL=openai-codex/gpt-5.1
pi
```

Inside pi:

```text
/image-model
/image-model openai-codex/gpt-5.1
/image-model reset
```

`/image-model` now opens a searchable selector with a text cursor above the list, so it behaves more like `/model` and the todo picker. It also supports searchable slash-argument completions and only shows vision models with configured auth.

## Usage patterns

### Automatic tool use by the main agent

Ask pi about an attached image or screenshot. The main model can call the tool and route analysis through the secondary model.

### Manual check of the latest attached image

```text
/ask-image-model What error message is visible in this screenshot?
```

### Analyze an image file on disk

The tool also accepts file paths, so the main agent can point it at extracted frames or screenshots saved in the repo.

## Notes

- The selected secondary model must support image input.
- The extension reuses the most recent user-attached image(s) when no paths are provided.
- Put the extension under `.pi/extensions/` so `/reload` picks it up.
