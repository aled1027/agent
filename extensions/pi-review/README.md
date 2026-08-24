# pi-review

Pi extension for code review that runs **in the foreground**: `/review` hands a directive to the main agent, which fans out isolated reviewers with pi-codex-subagents and then runs a gate over their collected final replies. The whole review streams in chat — no silent background work.

Requires the **pi-codex-subagents** extension (`pi install npm:@ogulcancelik/pi-codex-subagents`, ≥0.3.4) — it provides the `spawn_agent` and collection tools used to fan out.

Pattern ported from the Claude code-review plugin. See [reference/](./reference/) for upstream flow notes and the version roadmap.

## Commands

```text
/review [any prompt] [--lite] [--gate-model <id>]
/review-config
/review-agents
```

### `/review`

**CC-aligned:** text after `/review` is **user context**. The main agent obtains the diff once into `.pi/pi-review/change.diff`; isolated `pi-review-<id>` Codex templates review that file (same orchestration idea as Claude `/code-review`).

When called with no arguments, `/review` targets **local git** and tells the main agent to:

1. If the working tree is dirty → `git diff HEAD` into `.pi/pi-review/change.diff`.
2. If clean → **`git fetch origin <default-branch>`**, then `git diff origin/<default-branch>...HEAD` (avoids a stale local `main`/`master`).
3. Also writes `changed-files.txt`, `change-kind.txt` (`docs`|`code`), and `diff-meta.txt` (base/head SHAs).
3. Outside a git repo with no PR → notify and exit.

**PR review:** pass a GitHub PR URL or number. The main agent tries `gh pr diff`; if the diff is too large (GitHub 20k-line limit) or unavailable, it fetches `pull/<n>/head` + the PR base ref and runs a three-dot git diff. Oversized PRs no longer fail in the plugin layer.

```text
/review https://github.com/org/repo/pull/17206
/review 17206
/review focus on backup restore — PR 17206
```

**Lite mode:** add `--lite` for a fast single-agent pass — one reviewer covers all dimensions (bugs / security / compliance / code-comments / history), no fan-out, no gate. Lower latency and cost; ideal for a quick gut-check.

```text
/review --lite
/review --lite focus on concurrency and secret handling
```

### Flags

The surface is intentionally minimal. Removed knobs (`--threshold` / `--reviewer` / `--no-gate` / `--score-per-issue` / `--diff`) are accepted-but-ignored so old invocations do not break; their capabilities now live in `config.json` via `/review-config`.

| Flag | Effect |
|---|---|
| `--lite` | Single-agent fast mode: one reviewer, no gate. |
| `--gate-model <id>` | Request a gate model for this run. It is passed only when pi-codex-subagents exposes that model in the `spawn_agent` schema. |
| `--no-spawn` | Dry run — print the directive that would be injected, and exit. |

### Removed flags → config

| Old flag | config.json key |
|---|---|
| `--threshold N` | `gate.threshold` |
| `--reviewer id` | `reviewers.<id>.enabled` |
| `--no-gate` | `gate.enabled` |
| `--score-per-issue MODE` | `gate.scorePerIssue` |
| `--diff path` | *(removed — pass a PR url or run in a dirty repo instead)* |

## Bundled reviewers

Reviewers are isolated pi-codex-subagents. Each run uses unique task names such as `pi-review-<run>/bugbot`; the bundled `agents/*.md` role instructions are installed as local Codex templates on the first `/review` and are never overwritten.

| ID | Purpose | Default | Tools |
|---|---|---|---|
| `claude-md-compliance` | Project rules (AGENTS.md / CLAUDE.md / .pi/) | enabled | read, grep, ls |
| `bugbot` | Obvious bugs in introduced lines only | enabled | read, grep, bash |
| `history-context` | Light git blame / log (≤5 files, `log -n 5`) | enabled | read, bash |
| `security-review` | Security issues introduced by the change | enabled | read, grep, bash |
| `code-comments` | Inline comment / TODO guidance in changed files | enabled | read, grep |
| `conventions` | De-facto style pass | **disabled** | read, grep, ls |
| `gate` | Dedupe + re-score + verdict | (always) | read |
| `lite-review` | Single-agent all-dimensions (`--lite`) | on demand | read, grep, bash |

## Pipeline

`/review` runs in the foreground: the handler builds a directive and injects it **hidden** into the main agent. The main agent obtains the diff once, then uses **pi-codex-subagents** to fan out isolated reviewers and collect their final replies before starting the gate:

```text
Step 1  obtain → .pi/pi-review/change.diff + changed-files.txt + change-kind.txt
Step 2  spawn_agent × N (one parallel batch) → wait_all_agents
Step 3  spawn_agent gate (with inline findings) → wait_agent
Step 4  report from the collected final replies (do not re-read the diff)
```

Subagent task names contain a unique per-review run id, so multiple `/review` invocations can safely occur in one parent session.

**Permissions:** on each `/review`, CC-aligned allow rules (7× `gh` + read-only `git` + Read/Grep) are merged into `.pi/projects/<id>/permissions.local.json` so headless reviewers are not blocked by permission-modes (no ask UI in children).

**Cost:** dominated by N × tool turns. Prefer `--lite` for a cheap pass. Subagents inherit the parent model and thinking level by default. To route a reviewer or gate differently, edit the generated templates in `~/.pi/agent/pi-codex-subagents/agents/` or configure pi-codex-subagents model routing. There is no equivalent per-child turn, tool, or timeout budget.

## Configuration

Per-user config lives at:

```text
~/.pi/agent/pi-review.json
```

Run `/review-config` to open it in `$EDITOR`. The file is loaded, merged with the built-in defaults, and validated on every `/review` call. Unknown reviewer ids are added as new reviewers; known ids are patched in place.

```jsonc
{
  "schemaVersion": 1,
  "gate": {
    // Cheap tier by default (pure de-noise reasoning). "inherit" follows the parent session.
    // Override to a specific id; non-anthropic providers must set this explicitly.
    "model": "anthropic/claude-haiku-4-5",
    "thinking": "low",
    "enabled": true,
    // Issues with confidence < threshold are dropped (code-enforced).
    "threshold": 8,
    // Per-issue scorers: "off" (default) | "blocker-major" | "all"
    "scorePerIssue": "off"
  },
  "concurrency": 4,
  "reviewers": {
    "claude-md-compliance": {
      "model": "anthropic/claude-opus-4-6",
      "thinking": "high",
      "enabled": true
    },
    "bugbot": {
      "model": "inherit",
      "thinking": "medium"
      // tools inherit from inheritance.toolsDefault
    }
  },
  "inheritance": {
    "toolsDefault": ["read", "grep", "find", "ls", "bash"],
    "inheritProjectContext": false,
    "inheritSkills": false
  }
}
```

`reviewers.*.enabled` and `gate.threshold` control the foreground workflow. Reviewer model/thinking settings are superseded by the selected Codex template; `gate.model` and `--gate-model` are requested only when the installed `spawn_agent` schema allows that model. The first `/review` creates missing `pi-review-*.md` templates in `~/.pi/agent/pi-codex-subagents/agents/`; existing templates are never overwritten.

## TUI output

The main agent writes the report directly into chat. Shape (illustrative):

```text
## pi-review — uncommitted changes

**Verdict: REQUEST_CHANGES** (1 blockers · 1 major · 0 minor · 0 nit)
Reviewed in 42.1s · 4 reviewers · 1 gate

### claude-md-compliance (anthropic/claude-opus-4-6) — ok · 12.0s
- 1 issue
- [BLOCKER · compliance · conf 9] `src/auth.ts:42` — rule "no raw token logging" violated

### bug-detector (anthropic/claude-sonnet-4-6) — ok · 8.1s
- 1 issue
- [MAJOR · bug · conf 8] `src/auth.ts:42` — race: missing await on fetchUser

### conventions (anthropic/claude-sonnet-4-6) — ok · 6.2s
- 0 issues
- all naming/imports match surrounding files

### history-context (anthropic/claude-haiku-4-5) — ok · 4.8s
- 0 issues
- touched files have stable history, no recent reverts

### gate (anthropic/claude-haiku-4-5) — ok · 5.4s
- verdict: request_changes
- reason: One auth.ts blocker + one race condition in worker.ts; safe to merge after fixes.
- 2 issues after dedupe + threshold
```

A machine-readable copy is also written via `pi.appendEntry("pi-review", { ... })` for future TUI consumers.

## Install

```bash
pi install npm:@georgedong32/pi-review
```

Verify:

```bash
pi list
```

## Local development

```bash
bun install
bun run check     # tsc --noEmit
bun test          # node:test + tsx
```

## Repo structure

```text
index.ts                  Pi extension entry; registers /review + /review-config + /review-agents
src/types.ts              Shared interfaces (Issue, ReviewerSpec, PiReviewConfig, ReviewReport)
src/config.ts             loadConfig / mergeWithDefaults / validateConfig / writeConfig
src/codex-templates.ts    Installs missing pi-review-* Codex templates without overwriting customizations
src/directive.ts          Builds the spawn → wait-all → gate → wait workflow directive
src/spawn.ts              runSubagent (child_process.spawn + structured-output read)
src/schema.ts             TypeBox schemas for reviewer + gate outputs
src/parallel.ts           mapConcurrent (hard cap 4)
src/review.ts             runReviewers — fan-out + per-reviewer spawn
src/gate.ts               runGate — single spawn with aggregated prompt
src/git-input.ts          resolveDefaultDiff (status / vs default branch)
src/report.ts             buildReport + renderReport
agents/*.md               Bundled reviewer prompts copied into Codex templates on first use
prompts/gate.md           Gate subagent prompt
tests/*.test.ts           node:test suites
```

## Limitations (v1)

- No retry: a failed reviewer is recorded as failed and the rest of the run continues. The gate still runs.
- No worktree isolation: all reviewers share the parent's cwd.
- GitHub: agents use `gh`/`git` to obtain PRs; oversized diffs fall back to git. PR comments are not posted.
- No web config UI: only `$EDITOR`.

## License

Apache-2.0
