/**
 * CLI argument + env builder for spawning `pi` as a subagent.
 *
 * Pattern ported from pi-subagents/src/runs/shared/pi-args.ts. Each spawned
 * subagent gets a fresh, stateless `pi` process with:
 *   - explicit --model (with optional :thinking suffix)
 *   - --tools whitelist (or omitted for the gate, which is pure reasoning)
 *   - --system-prompt <file> pointing at a temp file we materialize
 *   - --no-session / --no-extensions / --no-skills for clean isolation
 *   - env vars PI_SUBAGENT_STRUCTURED_OUTPUT_* pointing at the schema/output files
 *   - PI_REVIEW_* markers so the child can identify which role it is playing
 */

import { structuredOutputCaptureExtensionPath, withStructuredOutputTool } from "./paths.js";

export interface ReviewerArgsInput {
	model: string;
	thinking?: string;
	tools?: string[];
	promptFile: string;
	schemaPath: string;
	outputPath: string;
	reviewerId: string;
	/** Extra task text appended after the system prompt (the diff / prompt body). */
	taskText: string;
	inheritProjectContext?: boolean;
	inheritSkills?: boolean;
}

export interface BuiltArgs {
	args: string[];
	env: Record<string, string>;
}

/**
 * Append a thinking-level suffix to a model id (e.g. "claude-sonnet-4-6:high").
 * Returns the input unchanged if thinking is missing or "off".
 *
 * Mirrors pi-subagents/src/runs/shared/pi-args.ts:76-81 (applyThinkingSuffix).
 */
export function applyThinkingSuffix(model: string, thinking: string | undefined): string {
	if (!thinking || thinking === "off") return model;
	return `${model}:${thinking}`;
}

/** Build the CLI arg list and env map for spawning a reviewer. */
export function buildReviewerArgs(input: ReviewerArgsInput): BuiltArgs {
	const args: string[] = [
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"-e",
		structuredOutputCaptureExtensionPath(),
	];
	args.push("--model", applyThinkingSuffix(input.model, input.thinking));
	const tools = withStructuredOutputTool(input.tools);
	if (tools.length > 0) {
		args.push("--tools", tools.join(","));
	}
	if (input.inheritProjectContext === false) {
		args.push("--no-project-context");
	}
	if (input.inheritSkills === true) {
		args.push("--skills");
	}
	args.push("--system-prompt", input.promptFile);
	// The task text becomes the final positional argument. If it is very long,
	// we let the child read it from a file via @-syntax — caller decides.
	args.push(input.taskText);
	const env: Record<string, string> = {
		PI_SUBAGENT_STRUCTURED_OUTPUT_SCHEMA: input.schemaPath,
		PI_SUBAGENT_STRUCTURED_OUTPUT_CAPTURE: input.outputPath,
		PI_REVIEW_REVIEWER_ID: input.reviewerId,
	};
	return { args, env };
}

export interface GateArgsInput {
	model: string;
	thinking?: string;
	promptFile: string;
	schemaPath: string;
	outputPath: string;
	taskText: string;
}

/** Build the CLI arg list and env map for spawning the gate. */
export function buildGateArgs(input: GateArgsInput): BuiltArgs {
	const args: string[] = [
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"-e",
		structuredOutputCaptureExtensionPath(),
	];
	args.push("--model", applyThinkingSuffix(input.model, input.thinking));
	args.push("--tools", "structured_output");
	args.push("--system-prompt", input.promptFile);
	args.push(input.taskText);
	const env: Record<string, string> = {
		PI_SUBAGENT_STRUCTURED_OUTPUT_SCHEMA: input.schemaPath,
		PI_SUBAGENT_STRUCTURED_OUTPUT_CAPTURE: input.outputPath,
		PI_REVIEW_GATE: "1",
	};
	return { args, env };
}
