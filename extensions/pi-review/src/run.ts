/**
 * `/review` pipeline orchestration (v0.4 agent-driven).
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { ParsedReviewArgs } from "./cli-args.js";
import { loadConfig, resolveModel, clampThreshold } from "./config.js";
import { checkEligibility, recheckBeforeOutput } from "./eligibility.js";
import {
	fetchPrMetadata,
	isGitRepo,
	resolveDefaultDiff,
	resolveReviewTarget,
} from "./git-input.js";
import { extractPrRef } from "./pr-ref.js";
import { runGate } from "./gate.js";
import { formatGateContext, formatReviewTask, prepareContext } from "./prep.js";
import { buildReport, renderReport } from "./report.js";
import { runReviewers } from "./review.js";
import type { PiReviewConfig, PrepMetadata, ReviewerSpec, ReviewTarget } from "./types.js";

/** Minimal command context required by the review pipeline (test-friendly). */
export interface ReviewPipelineContext {
	cwd: string;
	hasUI: boolean;
	model?: { provider: string; id: string } | null;
	ui: {
		notify: ExtensionCommandContext["ui"]["notify"];
	};
}

export interface RunPipelineOptions {
	args: ParsedReviewArgs;
	ctx: ReviewPipelineContext;
	onStatus?: (text: string | undefined) => void;
}

export type PipelineResult =
	| { kind: "skipped"; reason: string }
	| { kind: "dry-run"; plan: string }
	| { kind: "report"; markdown: string; report: ReturnType<typeof buildReport> };

function parentModelId(ctx: ReviewPipelineContext): string | undefined {
	const m = ctx.model;
	if (!m) return undefined;
	return `${m.provider}/${m.id}`;
}

function selectReviewers(config: PiReviewConfig, filterIds: string[]): ReviewerSpec[] {
	const all = Object.values(config.reviewers).filter((r) => r.enabled);
	if (filterIds.length === 0) return all;
	const set = new Set(filterIds);
	return all.filter((r) => set.has(r.id));
}

export function resolveReviewers(config: PiReviewConfig, filterIds: string[], parentModel: string | undefined): ReviewerSpec[] {
	return selectReviewers(config, filterIds).map((r) => ({
		...r,
		model: resolveModel(r.model, parentModel),
	}));
}

/**
 * Synthetic reviewer used by `--lite` mode — one agent covering all dimensions,
 * no fan-out, no gate. Its id resolves to the bundled `agents/lite-review.md`.
 */
export function liteReviewer(parentModel: string | undefined): ReviewerSpec {
	return {
		id: "lite-review",
		label: "Lite Review",
		enabled: true,
		model: resolveModel("inherit", parentModel),
		thinking: "medium",
		tools: ["read", "grep", "find", "ls", "bash"],
	};
}

async function buildSummary(cwd: string, target: ReviewTarget): Promise<{ summary: string; probeNote?: string }> {
	if (target.kind === "pr" && target.prRef) {
		const meta = await fetchPrMetadata(cwd, target.prRef);
		if (meta?.summary) {
			return { summary: meta.summary, probeNote: meta.probeNote ?? target.probeNote };
		}
		return {
			summary: `PR ${target.prRef} (agent-fetch).`,
			probeNote: target.probeNote,
		};
	}
	if (target.kind === "diff-file" && target.diffPath) {
		return {
			summary: `Explicit diff file at ${target.diffPath} (agents will read it; not embedded).`,
		};
	}
	return { summary: target.hint ?? "Local git changes — agents will discover via git." };
}

export async function runReviewPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
	const { args, ctx, onStatus } = options;
	const cwd = ctx.cwd;
	const parentModel = parentModelId(ctx);
	const { config, errors: configErrors } = loadConfig();

	if (configErrors.length > 0 && ctx.hasUI) {
		ctx.ui.notify(`pi-review config warnings: ${configErrors.join("; ")}`, "warning");
	}

	const git = await isGitRepo(cwd);
	let target: ReviewTarget | null = null;
	try {
		target = await resolveReviewTarget(cwd, {
			input: args.input,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "skipped", reason: message };
	}

	const hasExplicitInput = Boolean(args.input && extractPrRef(args.input));

	// Cheap trivial probe only for local-git without explicit PR/--diff.
	let probedDiff: string | null = null;
	if (target?.kind === "local-git" && !hasExplicitInput) {
		const probed = await resolveDefaultDiff(cwd);
		probedDiff = probed?.content ?? null;
	}

	const eligibility = checkEligibility({
		target,
		hasExplicitInput,
		isGitRepo: git,
		probedDiff,
	});
	if (!eligibility.eligible) {
		return { kind: "skipped", reason: eligibility.reason };
	}

	const input = target!;
	const { summary, probeNote } = await buildSummary(cwd, input);
	if (probeNote) input.probeNote = probeNote;
	const prep = prepareContext(cwd, probeNote ? `${summary} ${probeNote}.` : summary);
	const prepMeta: PrepMetadata = { rulePaths: prep.rulePaths, summary: prep.summary };
	const taskBody = formatReviewTask(prep, input);
	const gateContext = formatGateContext(prep, input);

	const threshold = clampThreshold(config.gate.threshold);
	const reviewers = args.lite
		? [liteReviewer(parentModel)]
		: resolveReviewers(config, [], parentModel);
	const gateModel = resolveModel(config.gate.model, parentModel);
	const runGateStep = !args.lite && config.gate.enabled;
	const scorePerIssue = config.gate.scorePerIssue;

	if (args.noSpawn) {
		const lines = [
			"pi-review dry run",
			`input: ${input.label}`,
			`mode: ${args.lite ? "lite (single agent, no gate)" : `agent-fetch (${input.kind})`}`,
			`threshold: ${threshold}`,
			`scorePerIssue: ${scorePerIssue}`,
			`reviewers (${reviewers.length}): ${reviewers.map((r) => `${r.id} (${r.model})`).join(", ")}`,
			`gate: ${runGateStep ? `yes (${gateModel})` : "no"}`,
			`prep rules: ${prep.rulePaths.join(", ") || "(none)"}`,
			`summary: ${prep.summary}`,
		];
		if (input.probeNote) lines.push(`probe: ${input.probeNote}`);
		return { kind: "dry-run", plan: lines.join("\n") };
	}

	if (reviewers.length === 0) {
		return { kind: "skipped", reason: "No enabled reviewers match the requested filter." };
	}

	const startedAt = Date.now();
	onStatus?.(`starting · ${input.label}`);

	let doneCount = 0;
	onStatus?.(`reviewers 0/${reviewers.length}`);

	const reviewerResults = await runReviewers({
		reviewers,
		promptBody: taskBody,
		cwd,
		config,
		onReviewerDone: (result) => {
			doneCount += 1;
			const mark = result.ok ? "ok" : "fail";
			onStatus?.(`reviewers ${doneCount}/${reviewers.length} · ${result.id} ${mark}`);
		},
	});

	onStatus?.(runGateStep ? "gate · aggregating" : undefined);

	let gateResult = null;
	if (runGateStep) {
		gateResult = await runGate({
			reviewers: reviewerResults,
			gateContext,
			gateModel,
			gateThinking: config.gate.thinking,
			threshold,
			cwd,
			config,
			scorePerIssue,
		});
	}

	const recheck = recheckBeforeOutput(input);
	if (!recheck.eligible) {
		return { kind: "skipped", reason: recheck.reason };
	}

	const report = buildReport({
		startedAt,
		reviewers: reviewerResults,
		gate: gateResult,
		input,
		prep: prepMeta,
	});

	onStatus?.(undefined);
	return { kind: "report", markdown: renderReport(report), report };
}
