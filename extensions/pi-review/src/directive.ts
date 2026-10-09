/**
 * Build the review directive injected into the main agent (hidden, via
 * `sendMessage` with `display:false` + `triggerTurn:true` — see index.ts).
 *
 * Reviewers run through the `subagent` CLI (pi-subagent). Each child's full
 * prompt (role + task) is written to `.pi/pi-review/prompts/<id>.md`; the main
 * agent spawns them with `subagent spawn --file`, collects replies with
 * `subagent wait`, runs one gate child, then stops every child.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildObtainDiffScript, DIFF_META_REL, q } from "./obtain-diff.js";
import type { ReviewerSpec, ReviewTarget } from "./types.js";

export interface ReviewDirectiveInput {
	target: ReviewTarget;
	reviewers: ReviewerSpec[];
	/** Resolved gate model id (from config.gate.model or --gate-model). */
	gateModel: string;
	/** Optional gate thinking from config. */
	gateThinking?: string;
	/** Parent session model (`provider/id`); children inherit it unless a different model is configured. */
	parentModel?: string;
	/** Default reviewer tools and whether children see project context files and skills. */
	inheritance?: { toolsDefault: string[]; inheritProjectContext: boolean; inheritSkills: boolean };
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

const PROMPTS_REL = join(".pi", "pi-review", "prompts");
const AGENT_DIR = new URL("../agents/", import.meta.url);

const FALSE_POSITIVE_GUIDANCE = [
	"Pre-existing issues on lines the author did not modify",
	"Pedantic nitpicks a senior engineer would not call out",
	"Issues a linter, typechecker, or CI would catch",
	"Generic quality (missing tests/docs) unless a project rule explicitly requires it",
	"Something that looks like a bug but is intentional given the change",
].join("; ");

/** Bundled role instructions without frontmatter. */
function roleBody(id: string): string {
	const source = readFileSync(new URL(`${id}.md`, AGENT_DIR), "utf8");
	if (!source.startsWith("---\n")) return source.trim();
	const end = source.indexOf("\n---", 4);
	return (end === -1 ? source : source.slice(end + 4)).trim();
}

function writePrompt(cwd: string, id: string, task: string): string {
	const dir = join(cwd, PROMPTS_REL);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${id}.md`);
	writeFileSync(path, `${roleBody(id)}\n\n${task}\n`, "utf8");
	return path;
}

/** `subagent spawn` command. Model flags are added only when they differ from the parent session. */
function spawnCommand(opts: {
	name: string;
	tools: string[];
	model?: string;
	thinking?: string;
	parentModel?: string;
	isolation: string[];
	files: string[];
}): string {
	const parts = ["subagent spawn", "--name", q(opts.name), "--tools", q(opts.tools.join(",")), ...opts.isolation];
	if (opts.model && opts.model !== opts.parentModel && opts.model.includes("/")) {
		const slash = opts.model.indexOf("/");
		parts.push("--provider", q(opts.model.slice(0, slash)), "--model", q(opts.model.slice(slash + 1)));
	}
	if (opts.thinking) parts.push("--thinking", q(opts.thinking));
	for (const file of opts.files) parts.push("--file", q(file));
	return parts.join(" ");
}

export function buildReviewDirective(input: ReviewDirectiveInput): string {
	const { target, reviewers, gateModel, gateThinking, parentModel, threshold, lite, cwd } = input;
	const toolsDefault = input.inheritance?.toolsDefault ?? ["read", "grep", "find", "ls", "bash"];
	const isolation = [
		...(input.inheritance?.inheritSkills ? [] : ["--no-skills"]),
		...(input.inheritance?.inheritProjectContext ? [] : ["--no-context-files"]),
	];
	const diffPath = diffFilePath(cwd);
	const filesPath = filesListPath(cwd);
	const kindPath = kindFilePath(cwd);
	const findingsPath = join(cwd, ".pi", "pi-review", "reviewer-findings.md");
	const reviewerCommands = reviewers.map((reviewer) =>
		spawnCommand({
			name: `review-${reviewer.id}`,
			tools: reviewer.tools ?? toolsDefault,
			model: reviewer.model,
			thinking: reviewer.thinking,
			parentModel,
			isolation,
			files: [writePrompt(cwd, reviewer.id, buildReviewerTask(diffPath, filesPath, kindPath, target.userContext))],
		}),
	);
	const blocks: string[] = [];

	blocks.push("# Code review (token-lean)");
	blocks.push("");
	if (target.userContext?.trim()) {
		blocks.push(`**User request:** ${target.userContext.trim()}`);
		blocks.push("");
	}
	blocks.push(
		`Review the change (${target.label}). Obtain the diff once, fan out ${reviewers.length} isolated reviewer subagent${reviewers.length === 1 ? "" : "s"}${lite ? " (lite)" : " and then run one gate"}, then write the report.`,
	);
	blocks.push("");
	blocks.push("## Hard rules (do not violate)");
	blocks.push("");
	blocks.push("- Orchestrate reviewers **only** with the `subagent` CLI via bash (`subagent spawn`, `subagent wait`, `subagent stop`), using the exact commands below. You may use bash yourself in Step 1 to obtain the change.");
	blocks.push("- Spawn every reviewer **once**, all in a single bash call, before waiting on any of them. Note each handle from the `Spawned <name> (<handle>)` lines.");
	blocks.push("- Do not retry or re-spawn a failed reviewer. Preserve it as failed in the report.");
	blocks.push("- Do not spawn subagents for obtaining the diff, verification, re-review, or report writing.");
	blocks.push("- Each prompt file already contains the role instructions and task. Do not edit them.");
	blocks.push("- Give every bash call that runs `subagent wait` a timeout of at least 1900 seconds.");
	blocks.push("- Stop every subagent you spawned before writing the report, including failed ones.");
	blocks.push("");
	blocks.push(`**Skip these false positives:** ${FALSE_POSITIVE_GUIDANCE}.`);
	blocks.push("");

	blocks.push("First, post the workflow as a markdown checklist into chat, then work through it — flip each `- [ ]` to `- [x]` as you finish.");
	blocks.push("");
	const todoSteps = [
		`Obtain diff + file list → ${DIFF_REL_PATH} (write only)`,
		lite ? "Spawn and collect the lite reviewer" : `Spawn and collect ${reviewers.length} parallel reviewers, then run the gate`,
		"Stop all review subagents",
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
	blocks.push("Run all of these in **one** bash call:");
	blocks.push("```bash");
	for (const command of reviewerCommands) blocks.push(command);
	blocks.push("```");
	blocks.push("Then collect every reviewer in **one** bash call (they run in parallel, so sequential waits are fine). Run the commands directly — no pipes or redirects — and keep going if one fails:");
	blocks.push("```bash");
	blocks.push("subagent wait <handle>; subagent wait <handle>; …");
	blocks.push("```");
	blocks.push("Treat each `<handle> finished` reply as that reviewer's JSON. Keep errors, timeouts, and malformed JSON as failed reviewers; do not re-read the diff yourself.");
	blocks.push("");

	if (!lite) {
		const gateCommand = spawnCommand({
			name: "review-gate",
			tools: ["read"],
			model: gateModel,
			thinking: gateThinking,
			parentModel,
			isolation,
			files: [writePrompt(cwd, "gate", buildGateTask(target.label, threshold)), findingsPath],
		});
		blocks.push("## Step 3 — Gate the collected findings");
		blocks.push("");
		blocks.push(`Write the reviewer final replies verbatim to \`${findingsPath}\`, one \`## <reviewer id>\` section each (use \`FAILED: <error>\` for failed reviewers). Then run:`);
		blocks.push("```bash");
		blocks.push(gateCommand);
		blocks.push("```");
		blocks.push("Then `subagent wait <gate handle>` in its own bash call. The gate reply is JSON. If the gate fails or is malformed, report the reviewer findings without a gate verdict.");
		blocks.push("");
	}

	blocks.push(`## Step ${lite ? "3" : "4"} — Stop subagents`);
	blocks.push("");
	blocks.push("Run `subagent stop <handle>` for every reviewer" + (lite ? "" : " and the gate") + " in one bash call.");
	blocks.push("");

	blocks.push(`## Step ${lite ? "4" : "5"} — Report`);
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
		"Reviewer findings are in the attached reviewer-findings.md (one section per reviewer). Parse each section's JSON.",
		"If a block fails to parse or the reviewer is FAILED, skip it and note it.",
		"Dedupe by (file, line, category), re-score 1–10, and return surviving issues + verdict.",
		`Skip false positives: ${FALSE_POSITIVE_GUIDANCE}.`,
		"Output JSON: {\"verdict\":\"approve|request_changes|comment\",\"issues\":[...],\"reason\":\"...\"}",
	].join("\n");
}

function buildReviewerTask(diffPath: string, filesPath: string, kindPath: string, userContext?: string): string {
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
