/**
 * Fan-out execution of N reviewer subagents in parallel.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildReviewerArgs, type BuiltArgs } from "./args.js";
import { mapConcurrent } from "./parallel.js";
import {
	packageRoot,
	readAgentPromptBody,
	resolveAgentPromptPath,
	stripFrontmatter,
} from "./paths.js";
import { ReviewerOutputSchema } from "./schema.js";
import { createRuntimeDir, runSubagent } from "./spawn.js";
import type { PiReviewConfig, ReviewerOutput, ReviewerRunResult, ReviewerSpec } from "./types.js";

const MAX_TASK_ARG_CHARS = 24_000;

/** Options for runReviewers. */
export interface RunReviewersInput {
	reviewers: ReviewerSpec[];
	/** Prep + obtain-change task body for reviewers. */
	promptBody: string;
	cwd: string;
	config: PiReviewConfig;
	/** Fired when each reviewer finishes (for UI progress). */
	onReviewerDone?: (result: ReviewerRunResult) => void;
}

function materializeSystemPromptFile(reviewer: ReviewerSpec): string {
	const dir = join(tmpdir(), `pi-review-sys-${reviewer.id}-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "system.md");
	let body: string;
	if (reviewer.promptPath) {
		const raw = readFileSync(join(packageRoot(), reviewer.promptPath), "utf-8");
		body = stripFrontmatter(raw);
	} else {
		body = readAgentPromptBody(reviewer.id);
	}
	writeFileSync(path, body, "utf-8");
	return path;
}

function materializeTaskArg(text: string): string {
	if (text.length <= MAX_TASK_ARG_CHARS) return text;
	const dir = join(tmpdir(), `pi-review-task-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "task.md");
	writeFileSync(path, text, "utf-8");
	return `@${path}`;
}

/** Run every reviewer in parallel, returning one result per input. */
export async function runReviewers(input: RunReviewersInput): Promise<ReviewerRunResult[]> {
	if (input.reviewers.length === 0) return [];

	const taskText = materializeTaskArg(input.promptBody);

	return mapConcurrent(input.reviewers, input.config.concurrency, async (reviewer) => {
		const runtime = createRuntimeDir(`pi-review-${reviewer.id}-`);
		const promptFile = materializeSystemPromptFile(reviewer);
		const tools = reviewer.tools ?? input.config.inheritance.toolsDefault;
		const resolvedModel = reviewer.model as string;

		// Ensure bundled prompt exists before spawn.
		if (!reviewer.promptPath) {
			resolveAgentPromptPath(reviewer.id);
		}

		const args: BuiltArgs = buildReviewerArgs({
			model: resolvedModel,
			thinking: reviewer.thinking,
			tools,
			promptFile,
			schemaPath: runtime.schemaPath,
			outputPath: runtime.outputPath,
			reviewerId: reviewer.id,
			taskText,
			inheritProjectContext: input.config.inheritance.inheritProjectContext,
			inheritSkills: input.config.inheritance.inheritSkills,
		});

		const result = await runSubagent({
			args: args.args,
			env: args.env,
			cwd: input.cwd,
			timeoutMs: reviewer.timeoutMs,
			schema: ReviewerOutputSchema,
			schemaPath: runtime.schemaPath,
			outputPath: runtime.outputPath,
		});

		let runResult: ReviewerRunResult;
		if (!result.ok) {
			runResult = {
				id: reviewer.id,
				label: reviewer.label,
				model: resolvedModel,
				ok: false,
				error: result.error,
				exitCode: result.exitCode ?? undefined,
				durationMs: result.durationMs,
			};
		} else {
			const output = result.value as ReviewerOutput;
			runResult = {
				id: reviewer.id,
				label: reviewer.label,
				model: resolvedModel,
				ok: true,
				output,
				durationMs: result.durationMs,
			};
		}
		input.onReviewerDone?.(runResult);
		return runResult;
	});
}
