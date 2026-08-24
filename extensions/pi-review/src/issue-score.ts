/**
 * Optional Claude Phase 4 style: parallel per-issue confidence scorers.
 * Used for blocker/major (or all) after the aggregating gate LLM pass.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";

import { buildGateArgs } from "./args.js";
import { mapConcurrent } from "./parallel.js";
import { readIssueScorePromptBody } from "./paths.js";
import { createRuntimeDir, runSubagent } from "./spawn.js";
import type { Issue, ScorePerIssueMode } from "./types.js";

const MAX_TASK_ARG_CHARS = 24_000;

export const IssueScoreSchema = Type.Object(
	{
		confidence: Type.Integer({ minimum: 1, maximum: 10 }),
		reason: Type.String({ minLength: 1, maxLength: 280 }),
	},
	{ additionalProperties: false },
);

function materializeIssueScoreSystemPrompt(): string {
	const dir = join(tmpdir(), `pi-review-score-sys-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "issue-score-system.md");
	writeFileSync(path, readIssueScorePromptBody(), "utf-8");
	return path;
}

function materializeTaskArg(text: string): string {
	if (text.length <= MAX_TASK_ARG_CHARS) return text;
	const dir = join(tmpdir(), `pi-review-score-task-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "task.md");
	writeFileSync(path, text, "utf-8");
	return `@${path}`;
}

export function selectIssuesForScoring(
	issues: Issue[],
	mode: ScorePerIssueMode,
): Issue[] {
	if (mode === "off") return [];
	if (mode === "all") return [...issues];
	return issues.filter((i) => i.severity === "blocker" || i.severity === "major");
}

function issueIdentity(issue: Issue): string {
	return `${issue.file}\0${issue.line ?? "-"}\0${issue.category}\0${issue.evidence}`;
}

function renderScoreTask(gateContext: string, issue: Issue, index: number): string {
	return [
		"# pi-review — single-issue confidence score",
		"",
		`## Candidate issue #${index + 1}`,
		"",
		"```json",
		JSON.stringify(issue, null, 2),
		"```",
		"",
		"## Review context (metadata only — no embedded diff)",
		"",
		gateContext,
		"",
		"Re-score this issue only from the issue evidence and context. Call structured_output once.",
	].join("\n");
}

export interface RunIssueScorersInput {
	issues: Issue[];
	mode: ScorePerIssueMode;
	gateContext: string;
	model: string;
	thinking?: string;
	cwd: string;
	concurrency: number;
	timeoutMs?: number;
}

/**
 * Score selected issues in parallel. Failed scorers keep the prior confidence.
 */
export async function runIssueScorers(
	input: RunIssueScorersInput,
): Promise<Issue[]> {
	const targets = selectIssuesForScoring(input.issues, input.mode);
	if (targets.length === 0) return input.issues;

	const systemPromptFile = materializeIssueScoreSystemPrompt();
	const targetKeys = new Set(targets.map(issueIdentity));

	const scoredList = await mapConcurrent(
		targets,
		input.concurrency,
		async (issue, index) => {
			const runtime = createRuntimeDir(`pi-review-score-${index}-`);
			const taskText = materializeTaskArg(
				renderScoreTask(input.gateContext, issue, index),
			);
			const args = buildGateArgs({
				model: input.model,
				thinking: input.thinking,
				promptFile: systemPromptFile,
				schemaPath: runtime.schemaPath,
				outputPath: runtime.outputPath,
				taskText,
			});
			args.env.PI_REVIEW_ISSUE_SCORE = "1";
			delete args.env.PI_REVIEW_GATE;

			const result = await runSubagent({
				args: args.args,
				env: args.env,
				cwd: input.cwd,
				timeoutMs: input.timeoutMs ?? 120_000,
				schema: IssueScoreSchema,
				schemaPath: runtime.schemaPath,
				outputPath: runtime.outputPath,
			});

			if (!result.ok || !result.value) {
				return issue;
			}
			const scored = result.value as { confidence: number; reason: string };
			return {
				...issue,
				confidence: scored.confidence,
			} satisfies Issue;
		},
	);

	const scoredByKey = new Map<string, Issue>();
	for (let i = 0; i < targets.length; i++) {
		scoredByKey.set(issueIdentity(targets[i]!), scoredList[i]!);
	}

	return input.issues.map((issue) => {
		const key = issueIdentity(issue);
		if (!targetKeys.has(key)) return issue;
		return scoredByKey.get(key) ?? issue;
	});
}
