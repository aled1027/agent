# Pi Agent

## Skills

- `canvas-screenshot` — deterministic canvas/Three.js screenshots
- `cli-preferences` — preferred CLI tools and conventions
- `context7` — fetch up-to-date library/framework docs
- `inspect-image` — analyze local images with a vision model
- `python` — reusable Python environment for scripting/analysis
- `rodney` — Chrome browser automation via CLI
- `slidev` — build developer slide decks with Slidev
- `tufte` — data-dense D3 visualizations with Tufte-style principles
- `web-browser` — browser automation via Chrome DevTools Protocol

## Extensions

- `answer` — extracts unanswered questions from the last assistant message into an interactive Q&A flow
- `block-large-images` — blocks reading image files directly and points the agent to the image-inspection workflow
- `review` — adds PR/branch/commit/folder review flows with an interactive code review command
- `todos` — adds file-based todo management plus an interactive todo manager
- `toolwatch` — audits tool calls/results and can enforce local or remote tool policies
- `usage-bar` — shows provider usage quotas, reset timers, and service status
- `vp-update-instruction` — customizes the update notice to use `vp install -g @mariozechner/pi-coding-agent`

## Inactive extensions

- `image-secondary-model` — routes image analysis to a separate vision model via commands/tools

## Bash aliases in Pi

Pi's `bash` tool typically runs a **non-interactive, non-login** Bash shell. That means aliases defined in files like `~/.bashrc` or `~/.zshrc` are often **not loaded**.

Because of that, alias-based commands such as:

```bash
alias python=python3
```

may work in a normal terminal but fail when Pi runs a Bash command.

## Recommended fix

Prefer a real executable on `PATH` instead of relying on an alias.

Example wrapper:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/python <<'EOF'
#!/usr/bin/env bash
exec python3 "$@"
EOF
chmod +x ~/.local/bin/python
```

Make sure `~/.local/bin` is on `PATH`.

## If you still want aliases

For non-interactive Bash, use `BASH_ENV` and enable alias expansion:

```bash
export BASH_ENV="$HOME/.bash_env"
```

Then in `~/.bash_env`:

```bash
shopt -s expand_aliases
alias python=python3
```

`shopt -s expand_aliases` tells Bash to expand aliases in non-interactive shells too.

## Recommendation summary

- Best for automation: wrapper script or symlink on `PATH`
- Bash-only fallback: `BASH_ENV` + `shopt -s expand_aliases`
- Least reliable: aliases defined only in interactive shell config files
