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

## Host-only skills

`hosts/<host>/skills/` holds skills for one machine. Pi does not load them by default; that host's own
`settings.json` adds the folder. See `hosts/pi-01/README.md`.

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
- `pi-review` — `/review`: parallel reviewers plus a gate, run through the `subagent` CLI
- `subagent` — [pi-subagent](https://github.com/badlogic/pi-subagent): tmux-backed subagents via the `subagent` CLI (`bin/subagent` symlink) and `/subagent`. Not tracked in this repo. Local changes: when the parent runs in Terms, children open as background Terms child tabs under the parent's tab (`shared.ts`, `launchInTerms`), and `/subagent` selects that tab. It is committed locally in that clone; update with `git -C extensions/subagent pull --rebase`.

## Pi Pocket extensions

Pi Pocket does not load Pi CLI extensions from `extensions/`. Its extensions live in `pocket-extensions/`, one `.ts` file each.

- `pi-review` — the `pi_review` tool: the same review as the CLI `pi-review`, but reviewers and the gate run as Pi Pocket subagents (the built-in `subagent` tool) instead of the `subagent` CLI and tmux. It reuses the CLI extension's reviewer roles (`extensions/pi-review/agents/`), diff script, and argument parser, and reads `pi-review.json`. Run files go to `/tmp/pi-review/<run>/`, not the repo. `/review` (`prompts/review.md`) calls it in Pi Pocket; in the CLI the extension's own `/review` command wins.
- `ponytail` — puts the Ponytail ruleset in the system prompt, as the CLI extension does. It reuses `extensions/ponytail/hooks/` and `skills/ponytail/SKILL.md`. `/ponytail-mode [off|lite|full|ultra|status|default <mode>]` sets the mode for one session (Pocket commands need a `-`, so not `/ponytail`). Saying "stop ponytail" does not turn it off here; use `/ponytail-mode off`. The `/skill:ponytail-*` skills work as they are.
- `linear` — the `linear_tools` and `linear_call` tools: Linear's MCP server (`https://mcp.linear.app/mcp`), authenticated with a Linear personal API key from `LINEAR_API_KEY` or `~/.config/linear/api-key` (not in this repo). It connects at the first call.

To install on a machine with Pi Pocket:

```bash
~/.pi/agent/pocket-extensions/install.sh
```

This links each module into `~/.pi-pocket/extensions/`, and links Pi Pocket's packages into `pocket-extensions/node_modules`. Then turn each module on in Pi Pocket: Menu → Extensions. Pi Pocket does not see edits through the link: after an edit, turn the module off and on again.

## Inactive extensions

- `ignore-extensions/pi-codex-subagents` — templates and run history from the replaced `@ogulcancelik/pi-codex-subagents` package

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
