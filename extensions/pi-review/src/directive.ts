/**
 * Build the review directive injected into the main agent (hidden, via
 * `sendMessage` with `display:false` + `triggerTurn:true` — see index.ts).
 *
 * Reviewers run through pi-codex-subagents. The main agent fans them out with
 * `spawn_agent`, collects their final replies with `wait_all_agents`, and
 * starts one gate child after all reviewer outputs are available.
 */
import { join } from "node:path";
import { codexAgentType } from "./codex-templates.js";
import { buildObtainDiffScript, DIFF_META_REL } from "./obtain-diff.js";
import type { ReviewerSpec, ReviewTarget } from "./types.js";

export interface ReviewDirectiveInput {
	target: ReviewTarget;
	reviewers: ReviewerSpec[];
	/** Resolved gate model id (from config.gate.model or --gate-model). */
	gateModel: string;
	/** Optional gate thinking from config. */
	gateThinking?: string;
	threshold: number;
	lite: boolean;
	cwd: string;
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

interface ReviewerTask {
	id: string;
	taskName: string;
	message: string;
}

const FALSE_POSITIVE_GUIDANCE = [
	"Pre-existing issues on lines the author did not modify",
	"Pedantic nitpicks a senior engineer would not call out",
	"Issues a linter, typechecker, or CI would catch",
	"Generic quality (missing tests/docs) unless a project rule explicitly requires it",
	"Something that looks like a bug but is intentional given the change",
].join("; ");

function reviewRunName(): string {
	// pi-codex-subagents task names are unique within a parent session, so a
	// second /review in the same conversation needs a distinct namespace.
	return `pi-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildReviewDirective(input: ReviewDirectiveInput): string {
	const { target, reviewers, gateModel, gateThinking, threshold, lite, cwd } = input;
	const diffPath = diffFilePath(cwd);
	const filesPath = filesListPath(cwd);
	const kindPath = kindFilePath(cwd);
	const runName = reviewRunName();
	const reviewerTasks: ReviewerTask[] = reviewers.map((reviewer) => ({
		id: reviewer.id,
		taskName: `${runName}/${reviewer.id}`,
		message: buildReviewerTask(reviewer.id, diffPath, filesPath, kindPath, target.userContext),
	}));
	const blocks: string[] = [];

	blocks.push("# Code review (token-lean)");
	blocks.push("");
	if (target.userContext?.trim()) {
		blocks.push(`**User request:** ${target.userContext.trim()}`);
		blocks.push("");
	}
	blocks.push(
		`Review the change (${target.label}). Obtain the diff once, fan out ${reviewers.length} isolated pi-codex-subagents reviewer${reviewers.length === 1 ? "" : "s"}${lite ? " (lite)" : " and then run one gate"}, then write the report.`,
	);
	blocks.push("");
	blocks.push("## Hard rules (do not violate)");
	blocks.push("");
	blocks.push("- For reviewer orchestration, use **only** the pi-codex-subagents tools: `spawn_agent`, `wait_all_agents`, and (for a non-lite review) `wait_agent`. You may use bash yourself in Step 1 to obtain the change.");
	blocks.push("- Spawn every reviewer **once and in parallel**: issue all reviewer `spawn_agent` calls in one assistant tool-call batch, then immediately call `wait_all_agents` for exactly those task names.");
	blocks.push("- Do not retry or re-spawn a failed reviewer. Preserve it as failed in the report.");
	blocks.push("- Do not use `spawn_agent` for obtaining the diff, verification, re-review, or report writing.");
	blocks.push("- Pass each listed reviewer `agent_type` and `message` verbatim. The matching pi-review template supplies the reviewer role instructions. For the gate, use its listed base message and append the collected reviewer findings exactly as Step 3 specifies.");
	blocks.push("- `spawn_agent` children inherit the parent model unless a local pi-codex-subagents template or its configured model routing overrides it. Only pass a `model` when that tool's schema offers the configured value.");
	blocks.push("");
	blocks.push(`**Skip these false positives:** ${FALSE_POSITIVE_GUIDANCE}.`);
	blocks.push("");

	blocks.push("First, post the workflow as a markdown checklist into chat, then work through it — flip each `- [ ]` to `- [x]` as you finish.");
	blocks.push("");
	const todoSteps = [
		`Obtain diff + file list → ${DIFF_REL_PATH} (write only)`,
		lite ? "Spawn and collect the lite reviewer" : `Spawn and collect ${reviewers.length} parallel reviewers, then run the gate`,
		"Write the report from the child final replies",
	];
	for (const step of todoSteps) blocks.push(`- [ ] ${step}`);
	blocks.push("");

	blocks.push("## Step 1 — Obtain the change (you, the main agent)");
	blocks.push("");
	blocks.push(`Create \`${join(cwd, ".pi", "pi-review")}\`, write the diff (+ file list + change-kind + diff-meta). **Do not read, cat, or summarize the diff body.**`);
	blocks.push("");
	blocks.push("**Accuracy:** for a clean tree, **fetch the remote default branch first** and compare against `origin/<base>` (not a stale local `main`/`master`). For PRs, prefer `gh pr diff`; if that fails, fetch `pull/<n>/head` + base and three-dot. Write `diff-meta.txt` so the base/head SHAs are auditable.");
	blocks.push("");
	blocks.push("```bash");
	blocks.push(buildObtainDiffScript({
		cwd,
		diffPath,
		filesPath,
		kindPath,
		metaPath: metaFilePath(cwd),
		prRef: target.kind === "pr" && target.prRef ? target.prRef : undefined,
	}));
	blocks.push("```");
	blocks.push("");

	blocks.push("## Step 2 — Spawn and collect reviewers");
	blocks.push("");
	blocks.push("Make one parallel batch of `spawn_agent` calls with these exact arguments:");
	for (const reviewer of reviewerTasks) {
		blocks.push("");
		blocks.push(`### ${reviewer.id}`);
		blocks.push("```text");
		blocks.push(`task_name: ${reviewer.taskName}`);
		blocks.push(`agent_type: ${codexAgentType(reviewer.id)}`);
		blocks.push("message:");
		blocks.push(reviewer.message);
		blocks.push("```");
	}
	blocks.push("");
	blocks.push("After all spawn calls return, collect their final replies:");
	blocks.push("```js");
	blocks.push(`wait_all_agents({ targets: ${JSON.stringify(reviewerTasks.map((task) => task.taskName))} })`);
	blocks.push("```");
	blocks.push("Treat each returned final response as that reviewer's JSON. Keep failures and malformed JSON as failed reviewers; do not re-read the diff yourself.");
	blocks.push("");

	if (!lite) {
		blocks.push("## Step 3 — Gate the collected findings");
		blocks.push("");
		blocks.push("After `wait_all_agents` returns, concatenate the reviewer final replies (including a FAILED marker for failed children) and append them verbatim after `## Reviewer findings (inline)` in this gate message.");
		blocks.push(`If the installed \`spawn_agent\` schema offers model \`${gateModel}\`, pass it on the gate spawn; otherwise omit \`model\`. ${gateThinking ? `If it also offers \`thinking\`, pass \`${gateThinking}\`.` : ""}`);
		blocks.push("```text");
		blocks.push(`task_name: ${runName}/gate`);
		blocks.push(`agent_type: ${codexAgentType("gate")}`);
		blocks.push("message:");
		blocks.push(buildGateTask(target.label, threshold));
		blocks.push("```");
		blocks.push("Call `spawn_agent` once for that gate, then collect it with:");
		blocks.push("```js");
		blocks.push(`wait_agent({ targets: [${JSON.stringify(`${runName}/gate`)}] })`);
		blocks.push("```");
		blocks.push("The gate final response is JSON. If it fails or is malformed, report the reviewer findings without a gate verdict.");
		blocks.push("");
	}

	blocks.push(`## Step ${lite ? "3" : "4"} — Report`);
	blocks.push("");
	blocks.push("Use only the final replies collected above. Do not re-read the full diff. Write markdown into chat:");
	blocks.push("");
	blocks.push("- **Verdict**: `request_changes` if any blocker OR ≥3 major; `approve` if no blocker and no major; otherwise `comment`.");
	blocks.push("- Group findings by reviewer; format `[SEVERITY · category · conf N] file:line — evidence`.");
	blocks.push(lite ? "- Lite mode has no gate — apply the verdict rule directly." : "- Include a short gate summary: verdict, reason, surviving issue count.");
	blocks.push("- Cite `file:line`. Skip pre-existing issues, nitpicks, and CI/linter noise.");
	blocks.push("- For any failed child, list its failure/error instead of inventing findings.");
	blocks.push("");

	return blocks.join("\n");
}

/** Build the static gate task briefing; reviewer outputs are appended by the main agent. */
function buildGateTask(changeLabel: string, threshold: number): string {
	return [
		"## Assigned task",
		`Synthesize reviewer findings for change ${changeLabel}.`,
		`Threshold: ${threshold} (drop issues with confidence < ${threshold}).`,
		"Reviewer findings are inlined below as JSON text (one block per reviewer). Parse each block's JSON.",
		"If a block fails to parse or the reviewer is FAILED, skip it and note it.",
		"Dedupe by (file, line, category), re-score 1–10, and return surviving issues + verdict.",
		`Skip false positives: ${FALSE_POSITIVE_GUIDANCE}.`,
		"Output JSON: {\"verdict\":\"approve|request_changes|comment\",\"issues\":[...],\"reason\":\"...\"}",
	].join("\n");
}

function buildReviewerTask(id: string, diffPath: string, filesPath: string, kindPath: string, userContext?: string): string {
	const parts = [
		"## Assigned task",
		`Read ${diffPath} as the change (only diff source — do not re-fetch via gh/git for the patch itself).`,
		`Also read ${filesPath} (changed paths) and ${kindPath} (docs|code).`,
		"Stay within the role's scope. Return your findings as JSON in your final reply and stop.",
		"Do not read plan.md, progress.md, subagent transcripts, or node_modules.",
		"Prefer Read/Grep. If you use bash, only simple allowlisted commands (no &&/||/; compounds).",
	];
	if (userContext?.trim()) parts.push(`User request: ${userContext.trim()}`);
	return parts.join("\n");
}
