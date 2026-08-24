/**
 * Build the review directive injected into the main agent (hidden, via
 * `sendMessage` with `display:false` + `triggerTurn:true` — see index.ts).
 *
 * v0.6.0: pi-subagents ≥0.41 removed top-level `subagent({ tasks: [...] })`;
 * fan-out now runs through one `subagent({ workflowScript, async:false })`.
 * The script fans out lean reviewers via `runs.all([...])` (each child carries
 * its own toolBudget/turnBudget), then feeds inlined reviewer JSON to the gate
 * via `runs.run("gate", ...)`. Reviewers return JSON as their final reply.
 */
import { join } from "node:path";
import {
	FALSE_POSITIVE_GUIDANCE,
	LEAN_GATE_AGENT,
	leanAgentName,
	resolveLeanBudgets,
	toolBudgetForReviewer,
	withThinkingSuffix,
	type LeanBudgetSpec,
} from "./lean-agents.js";
import { buildObtainDiffScript, DIFF_META_REL } from "./obtain-diff.js";
import type { ReviewerSpec, ReviewTarget } from "./types.js";

export interface ReviewDirectiveInput {
	target: ReviewTarget;
	reviewers: ReviewerSpec[];
	/** Resolved gate model id (from config.gate.model or --gate-model). */
	gateModel: string;
	/** Optional gate thinking from config (appended as model:thinking). */
	gateThinking?: string;
	threshold: number;
	lite: boolean;
	cwd: string;
	/** Optional turnBudget override from config.budgets. */
	budgets?: LeanBudgetSpec;
}

export const DIFF_REL_PATH = join(".pi", "pi-review", "change.diff");
export const FILES_REL_PATH = join(".pi", "pi-review", "changed-files.txt");
export const KIND_REL_PATH = join(".pi", "pi-review", "change-kind.txt");
export { DIFF_META_REL };

export function diffFilePath(cwd: string): string {
	return join(cwd, DIFF_REL_PATH);
}

export function filesListPath(cwd: string): string {
	return join(cwd, FILES_REL_PATH);
}

export function kindFilePath(cwd: string): string {
	return join(cwd, KIND_REL_PATH);
}

export function metaFilePath(cwd: string): string {
	return join(cwd, DIFF_META_REL);
}

export function buildReviewDirective(input: ReviewDirectiveInput): string {
	const { target, reviewers, gateModel, gateThinking, threshold, lite, cwd } = input;
	const budgets = input.budgets ?? resolveLeanBudgets();
	const diffPath = diffFilePath(cwd);
	const filesPath = filesListPath(cwd);
	const kindPath = kindFilePath(cwd);
	const gateModelWithThinking = withThinkingSuffix(gateModel, gateThinking);
	const blocks: string[] = [];

	blocks.push("# Code review (token-lean)");
	blocks.push("");
	if (target.userContext?.trim()) {
		blocks.push(`**User request:** ${target.userContext.trim()}`);
		blocks.push("");
	}
	blocks.push(
		`Review the change (${target.label}). Obtain the diff once, run one workflowScript (fan out ${reviewers.length} lean reviewer${reviewers.length === 1 ? "" : "s"}${lite ? " (lite)" : ""}${lite ? "" : " + inline gate"}), then write the report.`,
	);
	blocks.push("");
	blocks.push("## Hard rules (do not violate)");
	blocks.push("");
	blocks.push(
		"- Call `subagent` **exactly one** time in this whole review: the Step 2 workflowScript call.",
	);
	blocks.push(
		lite
			? "- Step 2 must be a **single** `subagent({ workflowScript, async:false, ... })` that fans out the lite-reviewer via `runs.all([...])` — never more than one call."
			: "- Step 2 must be a **single** `subagent({ workflowScript, async:false, ... })` that fans out **all** reviewers via `runs.all([...])` and runs the inline gate via `runs.run(\"gate\", ...)` — never one call per reviewer, never serial waves.",
	);
	blocks.push(
		"- **Do not retry** or re-spawn if a reviewer times out, hits its turnBudget, returns partial output, or fails — `runs.all` collects failures as `{ ok:false }`; the script continues and you mark failures in the report.",
	);
	blocks.push(
		"- **Do not** call `subagent` for obtaining the diff, verification, re-review, or rewriting the report.",
	);
	blocks.push(
		"- Use the exact `pi-review.*` agents below — do not substitute builtin `reviewer`. Keep per-child `toolBudget` / `turnBudget` and the top-level `async:false` / `context:\"fresh\"` / `timeoutMs`.",
	);
	blocks.push("- Reviewer models **inherit** the parent session (omit per-child `model` unless the reviewer config sets an explicit model).");
	blocks.push("");
	blocks.push(`**Skip these false positives:** ${FALSE_POSITIVE_GUIDANCE}.`);
	blocks.push("");

	blocks.push(
		"First, post the workflow as a markdown checklist into chat, then work through it — flip each `- [ ]` to `- [x]` as you finish.",
	);
	blocks.push("");
	const todoSteps = [
		`Obtain diff + file list → ${DIFF_REL_PATH} (write only)`,
		lite
			? "Run one workflowScript: the lite-reviewer (one subagent call)"
			: `Run one workflowScript: ${reviewers.length} parallel reviewers + inline gate (one subagent call)`,
		"Write the report from the workflow return value",
	];
	for (const s of todoSteps) blocks.push(`- [ ] ${s}`);
	blocks.push("");

	// Step 1 — unchanged: obtain the diff.
	blocks.push("## Step 1 — Obtain the change (you, the main agent)");
	blocks.push("");
	blocks.push(
		`Create \`${join(cwd, ".pi", "pi-review")}\`, write the diff (+ file list + change-kind + diff-meta). **Do not read, cat, or summarize the diff body.**`,
	);
	blocks.push("");
	blocks.push(
		"**Accuracy:** for a clean tree, **fetch the remote default branch first** and compare against `origin/<base>` (not a stale local `main`/`master`). For PRs, prefer `gh pr diff`; if that fails, fetch `pull/<n>/head` + base and three-dot. Write `diff-meta.txt` so the base/head SHAs are auditable.",
	);
	blocks.push("");
	blocks.push("```bash");
	blocks.push(
		buildObtainDiffScript({
			cwd,
			diffPath,
			filesPath,
			kindPath,
			metaPath: metaFilePath(cwd),
			prRef: target.kind === "pr" && target.prRef ? target.prRef : undefined,
		}),
	);
	blocks.push("```");
	blocks.push("");

	// Step 2 — single workflowScript call (fan-out + inline gate).
	const script = buildWorkflowScript({
		reviewers,
		diffPath,
		filesPath,
		kindPath,
		userContext: target.userContext,
		target,
		threshold,
		gateModelWithThinking,
		budgets,
		lite,
	});
	blocks.push("## Step 2 — Run the review (exactly one subagent workflowScript call)");
	blocks.push("");
	blocks.push(
		lite
			? "The script fans out the single lite-reviewer. Reviewers return JSON as their final reply; the script captures it."
			: "The script fans out the lean reviewers in parallel, then feeds their inlined JSON findings to the gate. Reviewers return JSON as their final reply; the script captures each `result.output`.",
	);
	blocks.push("");
	blocks.push("```js");
	blocks.push("subagent({");
	blocks.push(`  workflowScript: ${JSON.stringify(script)},`);
	blocks.push(`  async: false,`);
	blocks.push(`  context: "fresh",`);
	blocks.push(`  timeoutMs: ${budgets.timeoutMs},`);
	blocks.push(`  chatProgress: "milestones",`);
	blocks.push("})");
	blocks.push("```");
	blocks.push("");
	blocks.push(
		"The return value is a JSON object: `{ reviewers: [{ key, ok, output }], gate: { ok, output } | null }`. Each `output` is the child's final reply text (JSON) — parse it to write the report. Mark any `ok:false` reviewer as failed.",
	);
	blocks.push("");

	// Step 3 — Report.
	blocks.push("## Step 3 — Report");
	blocks.push("");
	blocks.push(
		"Read the **workflow return value** from Step 2 (the `Return:` object). **Do not re-read the full diff.** Write markdown into chat:",
	);
	blocks.push("");
	blocks.push("- **Verdict**: `request_changes` if any blocker OR ≥3 major; `approve` if no blocker and no major; otherwise `comment`.");
	blocks.push("- Group findings by reviewer; format `[SEVERITY · category · conf N] file:line — evidence`.");
	blocks.push(
		lite
			? "- Lite mode skips the gate — apply the verdict rule directly."
			: "- Short gate summary: verdict, reason, surviving issue count.",
	);
	blocks.push("- Cite `file:line`. Skip pre-existing issues, nitpicks, and CI/linter noise.");
	blocks.push("- For any `ok:false` child, list it as failed with the error from `output`.");
	blocks.push("");

	return blocks.join("\n");
}

/**
 * Build the inline workflowScript string. Runs all reviewers in parallel via
 * `runs.all([...])` (each child carries its own toolBudget/turnBudget), then —
 * unless lite — feeds inlined reviewer JSON to the gate via `runs.run("gate")`.
 *
 * Task strings are injected as JSON-stringified JS string literals at the head
 * of the script (`const TASK_<id> = "...";`). JSON string literals are valid
 * JS string literals, so quoting/escaping is always correct regardless of the
 * task text content.
 */
export function buildWorkflowScript(input: {
	reviewers: ReviewerSpec[];
	diffPath: string;
	filesPath: string;
	kindPath: string;
	userContext?: string;
	target: ReviewTarget;
	threshold: number;
	gateModelWithThinking: string;
	budgets: LeanBudgetSpec;
	lite: boolean;
}): string {
	const { reviewers, diffPath, filesPath, kindPath, userContext, target, threshold, gateModelWithThinking, budgets, lite } = input;

	// Stable identifier for a reviewer id (e.g. "history-context" → "history_context").
	const ident = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, "_");

	const lines: string[] = [];

	// Pre-declare each reviewer task as a JSON-stringified JS string literal.
	for (const r of reviewers) {
		const task = buildReviewerTask(r.id, diffPath, filesPath, kindPath, userContext);
		lines.push(`const TASK_${ident(r.id)} = ${JSON.stringify(task)};`);
	}

	// Parallel reviewers — each child carries its own toolBudget/turnBudget.
	lines.push("const reviews = await runs.all([");
	for (const r of reviewers) {
		const tb = toolBudgetForReviewer(r.id);
		const modelLine =
			r.model && r.model !== "inherit" ? `\n      model: ${JSON.stringify(r.model)},` : "";
		lines.push("    {");
		lines.push(`      key: ${JSON.stringify(r.id)},`);
		lines.push(`      agent: ${JSON.stringify(leanAgentName(r.id))},`);
		lines.push(`      task: TASK_${ident(r.id)},`);
		lines.push(`      toolBudget: { soft: ${tb.soft}, hard: ${tb.hard} },`);
		lines.push(`      turnBudget: { maxTurns: ${budgets.turnBudget.maxTurns}, graceTurns: ${budgets.turnBudget.graceTurns} },${modelLine}`);
		lines.push("    },");
	}
	lines.push("]);");
	lines.push("");

	// Inline gate (skipped in lite mode).
	if (!lite) {
		const gateTask = buildGateTask(target.label, threshold);
		lines.push(`const TASK_gate = ${JSON.stringify(gateTask)};`);
		// Build the inlined reviewer-findings block from each child result.
		// NOTE: this line is a plain single-quoted string so the inner `${...}`
		// reaches the workflow script as the script's own template-literal syntax
		// (a directive.ts template literal here would interpolate it prematurely).
		lines.push(
			'const gateInput = reviews.map(r => `## ${r.key} (${r.ok ? "ok" : "FAILED"})\\n${r.ok ? r.output : (r.error ?? r.output)}`).join("\\n\\n");',
		);
		lines.push('const gate = await runs.run("gate", {');
		lines.push(`  agent: ${JSON.stringify(LEAN_GATE_AGENT)},`);
		lines.push('  task: TASK_gate + "\\n\\n## Reviewer findings (inline)\\n" + gateInput,');
		lines.push(`  model: ${JSON.stringify(gateModelWithThinking)},`);
		lines.push(`  toolBudget: { soft: ${budgets.gateToolBudget.soft}, hard: ${budgets.gateToolBudget.hard} },`);
		lines.push(`  turnBudget: { maxTurns: ${budgets.gateTurnBudget.maxTurns}, graceTurns: ${budgets.gateTurnBudget.graceTurns} },`);
		lines.push("});");
		lines.push("");
		lines.push("return {");
		lines.push("  reviewers: reviews.map(r => ({ key: r.key, ok: r.ok, output: r.output })),");
		lines.push("  gate: { ok: gate.ok, output: gate.output },");
		lines.push("};");
	} else {
		lines.push("return {");
		lines.push("  reviewers: reviews.map(r => ({ key: r.key, ok: r.ok, output: r.output })),");
		lines.push("  gate: null,");
		lines.push("};");
	}

	return lines.join("\n");
}

/** Build the static gate task briefing (reviewer findings are appended inline by the script). */
function buildGateTask(changeLabel: string, threshold: number): string {
	return [
		`Synthesize reviewer findings for change ${changeLabel}.`,
		`Threshold: ${threshold} (drop issues with confidence < ${threshold}).`,
		`Reviewer findings are inlined below as JSON text (one block per reviewer). Parse each block's JSON.`,
		`If a block fails to parse or the reviewer is FAILED, skip it and note it.`,
		`Dedupe by (file, line, category), re-score 1-10, return surviving issues + verdict.`,
		`Skip false positives: ${FALSE_POSITIVE_GUIDANCE}.`,
		`Output JSON: {"verdict":"approve|request_changes|comment","issues":[...],"reason":"..."}`,
	].join(" ");
}

function buildReviewerTask(
	id: string,
	diffPath: string,
	filesPath: string,
	kindPath: string,
	userContext?: string,
): string {
	const parts = [
		`Read ${diffPath} as the change (only diff source — do not re-fetch via gh/git for the patch itself).`,
		`Also read ${filesPath} (changed paths) and ${kindPath} (docs|code).`,
		"Follow your system instructions. Stay within budgets; return your findings as JSON in your final reply and stop.",
		"Do not read plan.md, progress.md, .pi-subagents transcripts, or node_modules.",
		"Prefer Read/Grep. If you use bash, only simple allowlisted commands (no &&/||/; compounds).",
	];
	if (id === "bugbot" || id === "security-review") {
		parts.push(
			"If change-kind is docs: return empty issues after skimming the diff — no per-file reads. Otherwise prefer diff-only; at most 3 extra file reads; optional git show/log/blame only when a symbol needs clarification.",
		);
	}
	if (id === "history-context") {
		parts.push(
			"Take ≤5 paths from the file list. Run ONE bash: git log -n 5 --oneline -- <file1> <file2> ... (multiple paths, one command). Optional git blame -L on one suspicious hunk. No per-file separate bash turns.",
		);
	}
	if (id === "claude-md-compliance") {
		parts.push(
			"Only audit written project rules (AGENTS.md / CLAUDE.md / .pi rules). If none exist, empty issues.",
		);
	}
	if (userContext?.trim()) {
		parts.push(`User request: ${userContext.trim()}`);
	}
	return parts.join(" ");
}
