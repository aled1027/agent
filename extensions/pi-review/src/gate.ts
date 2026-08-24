/**
 * Gate subagent — aggregating re-score + code-side enforce (+ optional per-issue scorers).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildGateArgs, type BuiltArgs } from "./args.js";
import { dedupeIssues, enforceGateOutput } from "./gate-enforce.js";
import { runIssueScorers } from "./issue-score.js";
import { readGatePromptBody } from "./paths.js";
import { GateOutputSchema } from "./schema.js";
import { createRuntimeDir, runSubagent } from "./spawn.js";
import type {
	GateRunResult,
	GateVerdict,
	PiReviewConfig,
	ReviewerOutput,
	ReviewerRunResult,
	ScorePerIssueMode,
} from "./types.js";

const MAX_TASK_ARG_CHARS = 24_000;

export interface RunGateInput {
	reviewers: ReviewerRunResult[];
	/** Lightweight context (user request / summary) — no full diff embed. */
	gateContext: string;
	gateModel: string;
	gateThinking?: string;
	threshold: number;
	cwd: string;
	config: PiReviewConfig;
	scorePerIssue?: ScorePerIssueMode;
}

function materializeGateSystemPrompt(): string {
	const dir = join(tmpdir(), `pi-review-gate-sys-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "gate-system.md");
	writeFileSync(path, readGatePromptBody(), "utf-8");
	return path;
}

function materializeTaskArg(text: string): string {
	if (text.length <= MAX_TASK_ARG_CHARS) return text;
	const dir = join(tmpdir(), `pi-review-gate-task-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "task.md");
	writeFileSync(path, text, "utf-8");
	return `@${path}`;
}

/** Render the gate task prompt: metadata context + reviewer JSON + threshold (no full diff). */
export function renderGatePrompt(input: RunGateInput): string {
	const blocks: string[] = [];
	blocks.push("# pi-review — gate input");
	blocks.push("");
	blocks.push("## Review context (metadata only — no embedded diff)");
	blocks.push("");
	blocks.push(input.gateContext);
	blocks.push("");
	blocks.push(
		`## Threshold: ${input.threshold} (on 1–10 scale; keep issues with confidence >= threshold)`,
	);
	blocks.push("");
	blocks.push("## Reviewer outputs");
	blocks.push("");

	for (const r of input.reviewers) {
		if (!r.ok || !r.output) {
			blocks.push(`### Reviewer: ${r.id}`);
			blocks.push("");
			blocks.push(`(failed: ${r.error ?? "unknown error"})`);
			blocks.push("");
			continue;
		}
		const output: ReviewerOutput = r.output;
		blocks.push(`### Reviewer: ${r.id}`);
		blocks.push("");
		blocks.push("```json");
		blocks.push(JSON.stringify(output, null, 2));
		blocks.push("```");
		blocks.push("");
	}

	blocks.push("## Instructions");
	blocks.push("");
	blocks.push(
		"Dedupe by (file, line, category). Re-score each issue 1–10 using the rubric in your system prompt. Prefer dropping false positives. You do not have the full diff — judge from reviewer evidence and context. Call structured_output once. The parent will re-apply threshold + verdict rules in code.",
	);

	return blocks.join("\n");
}

export async function runGate(input: RunGateInput): Promise<GateRunResult> {
	const runtime = createRuntimeDir("pi-review-gate-");
	const systemPromptFile = materializeGateSystemPrompt();
	const promptBody = renderGatePrompt(input);
	const taskText = materializeTaskArg(promptBody);
	const scoreMode =
		input.scorePerIssue ?? input.config.gate.scorePerIssue ?? "off";

	const args: BuiltArgs = buildGateArgs({
		model: input.gateModel,
		thinking: input.gateThinking,
		promptFile: systemPromptFile,
		schemaPath: runtime.schemaPath,
		outputPath: runtime.outputPath,
		taskText,
	});

	const started = Date.now();
	const result = await runSubagent({
		args: args.args,
		env: args.env,
		cwd: input.cwd,
		timeoutMs: 300_000,
		schema: GateOutputSchema,
		schemaPath: runtime.schemaPath,
		outputPath: runtime.outputPath,
	});

	if (!result.ok) {
		return {
			ok: false,
			error: result.error,
			exitCode: result.exitCode ?? undefined,
			durationMs: result.durationMs,
			model: input.gateModel,
		};
	}

	const raw = result.value as GateVerdict;
	// Soft-dedupe before optional per-issue scoring so we don't score duplicates.
	let candidates = dedupeIssues(raw.issues ?? []);

	if (scoreMode !== "off" && candidates.length > 0) {
		candidates = await runIssueScorers({
			issues: candidates,
			mode: scoreMode,
			gateContext: input.gateContext,
			model: input.gateModel,
			thinking: input.gateThinking,
			cwd: input.cwd,
			concurrency: input.config.concurrency,
		});
	}

	const verdict = enforceGateOutput(
		{ issues: candidates, reason: raw.reason },
		input.threshold,
	);

	return {
		ok: true,
		verdict,
		durationMs: Date.now() - started,
		model: input.gateModel,
	};
}
