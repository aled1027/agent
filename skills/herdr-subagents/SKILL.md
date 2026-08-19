---
name: herdr-subagents
description: Use an orchestrator agent, the caller, to manage focused subagents in Herdr in order to achieve the user's task.
---

# Herdr subagents

The caller is the **orchestrator**: it understands the user's request, chooses
whether delegation helps, gives subagents bounded work, checks their evidence,
and delivers one useful answer. Subagents are collaborators, not competitors.
Do not optimize for, or report on, which model, tool, or agent did best unless
the user specifically asks for that comparison.

Use Herdr when the user explicitly asks to use Herdr, to delegate work, to run
subagents, or to inspect/control an existing Herdr agent. Prefer delegation
when a focused investigation, independent verification, or background work
will materially help complete the user's task.

## Safety and operating rules

1. **Verify Herdr first.** Do not use Herdr controls unless this succeeds:

   ```bash
   test "${HERDR_ENV:-}" = 1
   ```

   If it fails, explain that this session is not Herdr-managed and stop.

2. Read the installed CLI help before issuing control commands:

   ```bash
   herdr --help
   herdr agent --help
   herdr pane --help
   ```

   Before using tab controls, also read `herdr tab --help` and the help for
   the intended tab subcommand.

3. Keep the user in the current pane. Create background panes with `--no-focus`.
   Use `--current` or an explicit pane ID; never act on an implicitly focused
   user pane.
4. Treat panes as shared filesystem access. Default subagents to read-only.
   Do not run parallel writing agents in the same checkout. Use separate
   worktrees only when the user explicitly asks for parallel implementation.
5. Do not close, move, kill, or otherwise disrupt panes you did not create.
   Do not stop the Herdr server.
6. Use unique, descriptive agent names, such as `sentry-investigator` or
   `release-reviewer`.
7. After delivering the result, list the panes/tabs created for the task and
   ask whether the user wants them closed. Until they answer, leave them open;
   close only panes/tabs the orchestrator created.

## Plan delegation around the task

Before spawning an agent, the orchestrator should decide what work is needed
and what it will do with the result.

- **Single specialist:** one bounded investigation or implementation task.
- **Parallel fan-out:** independent parts of a larger task. Give each agent a
  distinct question or scope, then synthesize the answers.
- **Sequential handoff:** use an early agent to locate facts, then provide its
  relevant evidence to the next agent that needs it.
- **Verification:** use a second agent only to check a consequential finding,
  ambiguity, or risky change—not as a default comparison exercise.

A subagent prompt must state:

- the narrowly scoped objective and relevant time range;
- required sources/tools and any forbidden alternatives;
- whether it may modify files (default: no);
- a bounded plan or retry limit;
- required evidence, such as commands, query parameters, timestamps, IDs, or
  file paths/lines;
- the desired concise output format; and
- relevant confidence or caveat requirements.

Example:

```text
Read @docs/Sentry.md first. Investigate errors affecting <component> in the
last 30 minutes using only the Sentry CLI. Do not modify files. Use bounded,
structured queries and check pagination/completeness. Retry a failed request
once. Return a ranked list of findings with exact commands, timestamps, record
IDs, impact, confidence, and the best next action. Distinguish no forwarded
errors from healthy.
```

## Create and start agents

Inspect the current context and layout. The skill does not prescribe a fixed
workspace, tab, or pane.

- For **one or two** background agents, create sibling panes in the caller's
  current tab.
- For **three or more** agents, prefer a dedicated, unfocused background tab
  in the current workspace so the caller's pane remains usable. Use the
  current tab only if the user asks to keep every agent visible beside it or a
  background tab is unavailable.

```bash
printf 'ws=%s tab=%s pane=%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
herdr pane layout --current

# One or two agents: create a background sibling without taking focus.
herdr pane split --current --direction down --cwd "$PWD" --no-focus
# Read the new pane ID from the JSON response.

# Three or more agents: after reading `herdr tab --help` and
# `herdr tab create --help`, create a dedicated background tab.
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" \
  --label "agents-<task>" --no-focus
# Read the new tab ID from the JSON response, locate its initial shell pane,
# and split only panes in that new tab with --no-focus.

# Start a Pi subagent in each idle shell pane.
herdr agent start sentry-investigator --kind pi --pane <new-pane-id>
```

Choose the split direction based on available geometry. Start only the agent
kind the user requested; otherwise, use the normal Pi agent. `agent start`
requires an idle interactive shell pane.

## Prompt, monitor, and recover

Prompt the agent with its complete contract. For independent agents, prompt all
of them before waiting so their work overlaps.

```bash
herdr agent prompt sentry-investigator "<bounded task contract>"
herdr agent wait sentry-investigator --timeout 300000
herdr agent get sentry-investigator
herdr agent read sentry-investigator --source recent-unwrapped --lines 240
```

The orchestrator monitors agents it creates and reports the completed outcome
back to the user. If an agent is blocked or times out, inspect it with `agent
get` and `agent read`; retry or redirect it only when that helps the task. If
alternate-screen output cannot be recovered, ask the agent to write its full
report to a temporary Markdown file and reply only with that path, then read
the file.

## Review and synthesize

Do not merely relay a subagent's conclusion. The orchestrator must check:

1. **Evidence:** direct source, reproducible commands/queries, timestamps,
   identifiers, and samples.
2. **Scope:** the requested systems, time range, and fault modes were covered.
3. **Completeness:** pagination, limits, failed calls, retries, and known blind
   spots are disclosed.
4. **Interpretation:** distinguish observations from hypotheses and avoid
   unsupported causal claims.
5. **Actionability:** convert evidence into the next useful action for the
   user's task.

When agents disagree, resolve the disagreement using the strongest direct
evidence. State what remains uncertain rather than presenting a false
consensus. Mention a subagent's role only when it clarifies provenance, a
material disagreement, or a limitation.

## Final report template

Report the outcome requested by the user, not an evaluation of agent methods.
Adapt the structure to the task.

```markdown
## Result
- **Conclusion:** …
- **Recommended next action:** …

## Evidence
- …
- …

## Coverage and caveats
- **Sources and time range:** …
- **Completeness:** …
- **Uncertainty / limitations:** …
```

Include tool/model metrics, a scorecard, or a comparison only if the user asks
for them or they materially affect confidence, completeness, cost, or the
recommended action.
