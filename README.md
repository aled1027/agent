# Pi Agent

## Personal Codex subscription

`pi` uses the work Codex subscription. `pipersonal` uses the personal subscription:

```zsh
pipersonal() {
  PI_CODING_AGENT_DIR="$HOME/.pi/codex-personal" \
  PI_CODING_AGENT_SESSION_DIR="$HOME/.pi/codex-personal/sessions" \
  command pi "$@"
}
```

The function lives in `~/.zshrc`. Its profile keeps a separate `auth.json`, session directory, and model cache. Configuration paths in `~/.pi/codex-personal` are symlinks to this directory, so both accounts share settings, skills, extensions, prompts, MCP configuration, keybindings, and agent instructions. Changes to shared configuration affect both accounts.

To sign in, run `pipersonal` and use `/login`. Run `pi` for the work subscription.

## AGENTS.md

The AGENTS.md file is loaded into every pi session. Right now, I just put in non-standard CLI tools that the harness otherwise wouldn't know about.

## Skills

- `canvas-screenshot` — deterministic canvas/Three.js screenshots
- `context7` — fetch up-to-date library/framework docs
- `inspect-image` — analyze local images with a vision model
- `python` — reusable Python environment for scripting/analysis
- `rodney` — Chrome browser automation via CLI
- `slidev` — build developer slide decks with Slidev
- `tufte` — data-dense D3 visualizations with Tufte-style principles
- `web-browser` — browser automation via Chrome DevTools Protocol

## Ignored skills

- `make-interfaces-feel-better` — design engineering principles for polished UI details and interactions
- `pb-video-analysis` — determine pickleball rally start/end intervals from video

## Extensions

- `answer` — extracts unanswered questions from the last assistant message into an interactive Q&A flow
- `block-large-images` — blocks reading image files directly and points the agent to the image-inspection workflow
- `review` — adds PR/branch/commit/folder review flows with an interactive code review command
- `todos` — adds file-based todo management plus an interactive todo manager
- `toolwatch` — audits tool calls/results and can enforce local or remote tool policies
- `usage-bar` — shows provider usage quotas, reset timers, and service status
- `vp-update-instruction` — customizes the update notice to use `vp install -g @mariozechner/pi-coding-agent`

## Inactive extensions

None

## The Python Bash Alias Wasn't WOrking

Pi runs `bash` in a non-interactive shell, so aliases from `~/.bashrc` or `~/.zshrc` usually are not loaded. In practice, commands like `python` can work in your terminal but fail when Pi executes them.

I put a `python` wrapper script in the `PATH` that just calls python3 to make it so pi can use `python`.

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/python <<'EOF'
#!/usr/bin/env bash
exec python3 "$@"
EOF
chmod +x ~/.local/bin/python
```
