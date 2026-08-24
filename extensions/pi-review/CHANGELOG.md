# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.1] - 2026-08-08

### Fixed
- **Agent permission blocks removed:** pi-subagents ≥0.42 rejects the legacy nested `permission:` frontmatter (`bash:` sub-maps, `"*": ask` wildcard) with `permissions must be an object mapping tool names to allow, ask, or deny`. The new model gates bash via pi-guard and only accepts flat `tool → allow|ask|deny` (no `*` wildcard, no `bash` key). All 8 bundled agents now rely on their `tools:` allowlist (the primary constraint) and omit `permission:` entirely.

[0.6.1]: https://github.com/GeorgeDong32/pi-review/compare/v0.6.0...v0.6.1

## [0.6.0] - 2026-08-07

### Breaking
- **workflowScript migration:** fan-out now runs through one `subagent({ workflowScript, async:false })` instead of the removed top-level `subagent({ tasks:[...] })` (pi-subagents ≥0.41 dropped legacy `tasks`/`chain`/`concurrency`). Step 2 and the gate merge into a single tool call: the script fans out reviewers via `runs.all([...])`, then feeds their inlined JSON findings to `runs.run("gate", ...)`.
- **Peer deps:** `@mariozechner/*` → `@earendil-works/*`; added `pi-subagents >=0.41.0` (provides the `workflowScript` API). Source imports (`index.ts`, `src/run.ts`, `src/structured-output-capture.ts`) and devDependencies migrated to `@earendil-works/pi-coding-agent` as well; peer floor raised to `>=0.74.0` (lowest version published under the new scope).
- **Removed directive params:** `reads: false`, `acceptance: false`, top-level `outputMode: "file-only"`, and `concurrency` — `reads` is not a valid top-level `subagent` field and would fail schema validation. Reviewers now return JSON as their final reply; the script captures `result.output`.

### Changed
- **Inline gate:** the gate task receives reviewer JSON inlined as text (no file-only indirection). Per-child `toolBudget`/`turnBudget` are injected onto each `runs.all` / `runs.run` item.
- **Reviewer prompts:** all `agents/*.md` now say "return JSON as your final reply" (the `structured_output` fallback is kept for the legacy spawn path).
- **Tests:** `tests/directive.test.ts` rewritten for the workflowScript shape (legacy-input `doesNotMatch` guards added).

[0.6.0]: https://github.com/GeorgeDong32/pi-review/compare/v0.5.3...v0.6.0

## [0.5.3] - 2026-07-31

### Fixed
- **Stale base diffs:** Step 1 now `git fetch`es the remote default branch and compares against `origin/<base>` (not a stale local `main`/`master`). PR path still prefers `gh pr diff`, with a fetch `pull/<n>/head` + three-dot fallback. Writes `.pi/pi-review/diff-meta.txt` (mode / base / SHAs / merge-base) for audit.
- Allowlist adds `git fetch` / `git merge-base` / `git ls-files` for the obtain-diff path.

## [0.5.2] - 2026-07-30

### Changed
- **Single-wave hard rules:** at most 2 `subagent` calls (1 fan-out + 1 gate); no per-reviewer serial calls; no retries on timeout/partial.
- **turnBudget** default **20** (config `budgets.turnBudget`, up to 24/48); toolBudget soft/hard raised slightly.
- **Reviewer thinking inherits** the parent session (no forced medium/low on lean agents). Gate uses `config.gate.model` + `config.gate.thinking` as `model:thinking`.
- **Diff companion files:** write `.pi/pi-review/changed-files.txt` + `change-kind.txt` (`docs`|`code`); docs-only → bugbot/security empty early-exit.
- **Shallow prompts:** diff-first; history one multi-path `git log`; bugbot/security may use allowlisted `git show|log|blame` when needed.

### Added
- **CC-aligned permission allowlist** (`src/review-permissions.ts`): Claude `/code-review` 7× `Bash(gh …:*)` plus history/obtain git + `Read`/`Grep`. `/review` merges them into `.pi/projects/<id>/permissions.local.json` (permission-modes) so headless children are not blocked.

[0.5.3]: https://github.com/GeorgeDong32/pi-review/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/GeorgeDong32/pi-review/compare/v0.5.1...v0.5.2

## [0.5.1] - 2026-07-28

### Changed
- **Token-lean subagent fan-out:** the directive now pins every reviewer to a lean `pi-review.*` package agent (not the builtin fat `reviewer`), with explicit `turnBudget` / `toolBudget`, `reads: false`, `outputMode: "file-only"`, and `acceptance: false`.
- **Shared diff under cwd:** write to `.pi/pi-review/change.diff` (not `/tmp/...`) so children can read it without outside-cwd blocks. Main agent must **write-only** — no read/summarize of the full diff; report from file-only outputs only.
- **Lean agent prompts:** short CC-style briefs; `inheritProjectContext: false`; no obtain-change playbook; history capped at ≤5 files / `git log -n 5`.
- Package agents registered via `pi.subagents.agents: ["./agents"]` (runtime names like `pi-review.bugbot`, `pi-review.gate`).
- Default `inheritance.inheritProjectContext` is now `false`; reviewer tool lists narrowed.

### Fixed
- Directive path previously ignored pi-review config `tools` / `thinking` / inherit flags because the main agent fell through to builtin `reviewer` (`thinking: high`, edit/write/intercom, project context on).

[0.5.1]: https://github.com/GeorgeDong32/pi-review/compare/v0.5.0...v0.5.1

## [0.5.0] - 2026-07-27

### Changed
- **Foreground review**: `/review` now delegates to the main agent via a hidden directive (`sendMessage` with `display:false` + `triggerTurn:true`); the main agent fans out reviewers + gate with the pi-subagents `subagent` tool. The whole review streams in chat — no more silent background spawn. **Requires the pi-subagents extension.**
- **Main agent owns the diff**: the directive has the main agent obtain the diff once into `/tmp/pi-review-change.diff`; reviewers read that file instead of each fetching separately.
- **Hidden directive, visible echo**: only a short `/review <prompt>` line shows in chat; the full directive is hidden.
- **Top-level config**: moved to `~/.pi/agent/pi-review.json` (mirrors pi-permission-modes); added `setConfigPath` for tests.
- **Gate model** defaults to a cheap tier (`anthropic/claude-haiku-4-5`); override via config or the restored `--gate-model` flag.
- **per-issue scorer** default `off` (was `blocker-major`).
- **CLI slimmed**: `/review` surface reduced to `--lite` + freeform prompt; removed flags are accepted-but-ignored (their capabilities moved to config).

### Added
- **`--lite` mode**: single-agent fast review (`agents/lite-review.md`), no fan-out/gate.
- **Workflow checklist**: the directive has the main agent post a markdown checklist of the steps first, then work through it (pi has no native todo tool).
- `getArgumentCompletions` for `--lite` / `--gate-model`.

### Removed
- Code-enforced verdict — now instructed to the main agent (LLM follows the rule, but no longer a hard guarantee). The background spawn path is kept as a fallback.

[0.5.0]: https://github.com/GeorgeDong32/pi-review/compare/v0.4.1...v0.5.0

## [0.4.1] - 2026-07-26

### Fixed
- **UI feedback during `/review`:** immediate notify + footer status; per-reviewer progress; errors surface via notify + message.
- Stop calling `gh pr diff` during target resolve (was blocking the TUI with no output while the backend worked). Oversized hint comes from `gh pr view` metadata instead.

[0.4.1]: https://github.com/GeorgeDong32/pi-review/compare/v0.4.0...v0.4.1

## [0.4.0] - 2026-07-26

### Changed
- **Agent-driven change acquisition (CC-aligned):** the plugin no longer pre-fetches or embeds a full diff. Reviewers obtain the change via `gh` / `git` / `read` using an obtain-change playbook in the task prompt.
- Oversized PRs (`gh pr diff` HTTP 406 / too_large) no longer abort the pipeline; agents fall back to git / path-scoped reads.
- Gate and per-issue scorers receive metadata + reviewer JSON only (no full `<diff>` embed).
- All content reviewers include `bash` so they can run `gh`/`git`.

### Added
- `ReviewTarget` + `resolveReviewTarget` (`pr` | `diff-file` | `local-git`).
- Optional `gh pr view` metadata prep and `probeNote` for dry-run.

[0.4.0]: https://github.com/GeorgeDong32/pi-review/compare/v0.3.1...v0.4.0

## [0.3.1] - 2026-07-26

### Changed
- **CC-aligned `/review` args:** positional text is **user context** (PR URL/number, instructions), not a filesystem path. Fixes `ENOENT` when passing GitHub PR links.
- PR URLs/numbers resolve via `gh pr diff`; explicit diff files use `--diff @file.diff`.

### Added
- `src/pr-ref.ts` — extract PR refs from freeform input (handles CJK punctuation like `，review`).

[0.3.1]: https://github.com/GeorgeDong32/pi-review/compare/v0.3.0...v0.3.1

## [0.3.0] - 2026-07-26

### Added
- **Code-side gate enforce** (`src/gate-enforce.ts`): deterministic dedupe + threshold filter + verdict rules after the gate LLM (Claude Phase 5 equivalent).
- **Full diff to gate**: gate task includes the complete review body inside `<diff>` (no 2KB slice).
- **Optional per-issue scorers** (`gate.scorePerIssue`, default `blocker-major`): Claude Phase 4–style parallel confidence scoring for high-severity findings (`prompts/issue-score.md`).
- CLI: `--score-per-issue off|blocker-major|all`; `--threshold` is clamped to 0–10.

### Fixed
- Spawn: drain stdout to avoid pipe deadlock; reject non-zero child exit even when `output.json` exists.
- Report: list final gate issues in markdown; mark unfiltered totals when gate is missing/failed.
- ESM: replace `require()` in `paths.ts` / `prep.ts` / `git-input.ts` so `tsx --test` works under pure ESM.

[0.3.0]: https://github.com/GeorgeDong32/pi-review/compare/v0.2.0...v0.3.0

## [0.2.0] - 2026-07-19

### Added
- `index.ts` — registers `/review`, `/review-config`, `/review-agents`.
- Claude-shaped pipeline: **eligibility → prep → reviewers → gate → report** (`src/eligibility.ts`, `src/prep.ts`, `src/run.ts`).
- `src/structured-output-capture.ts` — child extension for `structured_output` tool; loaded via `-e` on subagent spawns.
- `src/cli-args.ts` — flag parsing for `/review`.
- New reviewers: `bugbot` (replaces `bug-detector`), `security-review`, `code-comments`.
- `reference/` docs (Claude flow, Cursor skills, roadmap, v0.2 plan).
- Tests: eligibility, prep, cli-args (+104 total).

### Changed
- Default gate threshold **3 → 8** (maps to Claude 80/100).
- Bundled `agents/*.md` and `prompts/gate.md` wired as subagent system prompts.
- Gate prompt embeds Claude confidence rubric (1–10 re-score).
- `conventions` reviewer default **disabled**.
- `@sinclair/typebox` moved to `dependencies` (capture extension runtime).

### Removed
- `agents/bug-detector.md` (renamed to `bugbot.md`).

## [0.1.0] - 2026-07-02

### Added
- `/review [path]` slash command — fans the diff out to four parallel reviewer subagents (`claude-md-compliance`, `bug-detector`, `conventions`, `history-context`) and aggregates their structured output through a single cheap-model gate.
- `/review-config` — opens `~/.pi/agent/extensions/pi-review/config.json` in `$EDITOR` and re-validates on close.
- `/review-agents` — lists the bundled reviewers with their resolved model, thinking, and tool lists.
- Smart default diff source: dirty working tree → `git diff HEAD`; clean tree → `git diff <default-branch>...HEAD`. Probes `origin/HEAD` → `main` → `master` → current branch.
- Per-reviewer model / thinking / tool overrides via `~/.pi/agent/extensions/pi-review/config.json`. `"inherit"` resolves to the parent session's model at run time.
- Flags: `--threshold N`, `--reviewer id...` (repeatable), `--no-gate`, `--gate-model id`, `--no-spawn` (dry run).
- TUI output: full report rendered as an `assistant` text block. Machine-readable copy written via `pi.appendEntry("pi-review", ...)` for future collapse-aware consumers.
- Structured output via TypeBox schemas. Subagents receive the JSON Schema via `PI_SUBAGENT_STRUCTURED_OUTPUT_SCHEMA` and write the validated payload to `PI_SUBAGENT_STRUCTURED_OUTPUT_CAPTURE`. Parent re-validates with `validateValue`.

### Changed
- Each reviewer / gate runs as a fresh, isolated `pi` subprocess (`--no-session --no-extensions --no-skills`) — mirrors the pattern from `pi-subagents`.
- Hard cap of 4 concurrent reviewers, regardless of `concurrency` in config.
- The gate is spawned with no tools — pure reasoning on the aggregated prompt.

### Out of scope (deferred)
- Retry loop for failed reviewers.
- Worktree-per-reviewer isolation.
- GitHub / `gh` integration (PR comment posting).
- Inline fix suggestions / auto-apply.
- Multi-PR batch mode.
- Web UI for configuration.
