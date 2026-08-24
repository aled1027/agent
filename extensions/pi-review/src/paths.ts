/**
 * Package path helpers — resolve bundled agents, gate prompt, and the
 * structured-output capture extension used by child `pi` processes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** npm package root (parent of `src/`). */
export function packageRoot(): string {
	return dirname(SRC_DIR);
}

/** Child-process extension that registers the `structured_output` tool. */
export function structuredOutputCaptureExtensionPath(): string {
	return join(SRC_DIR, "structured-output-capture.ts");
}

/** Bundled reviewer prompt: `agents/<id>.md`. */
export function resolveAgentPromptPath(id: string): string {
	return join(packageRoot(), "agents", `${id}.md`);
}

/** Gate system prompt: `prompts/gate.md`. */
export function resolveGatePromptPath(): string {
	return join(packageRoot(), "prompts", "gate.md");
}

/** Per-issue scorer system prompt: `prompts/issue-score.md`. */
export function resolveIssueScorePromptPath(): string {
	return join(packageRoot(), "prompts", "issue-score.md");
}

/** Read agent markdown body (YAML frontmatter stripped). */
export function readAgentPromptBody(id: string): string {
	const path = resolveAgentPromptPath(id);
	if (!existsSync(path)) {
		throw new Error(`missing agent prompt: ${path}`);
	}
	return stripFrontmatter(readFileSync(path, "utf-8"));
}

/** Read gate markdown body (YAML frontmatter stripped). */
export function readGatePromptBody(): string {
	const path = resolveGatePromptPath();
	return stripFrontmatter(readFileSync(path, "utf-8"));
}

/** Read issue-score markdown body (YAML frontmatter stripped). */
export function readIssueScorePromptBody(): string {
	const path = resolveIssueScorePromptPath();
	return stripFrontmatter(readFileSync(path, "utf-8"));
}

/** Tool name registered by structured-output-capture.ts. */
export const STRUCTURED_OUTPUT_TOOL = "structured_output";

export function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown;
	const end = markdown.indexOf("\n---\n", 4);
	if (end === -1) return markdown;
	return markdown.slice(end + 5).trimStart();
}

/** Ensure structured_output is included for child subagents. */
export function withStructuredOutputTool(tools: string[] | undefined): string[] {
	const set = new Set(tools ?? []);
	set.add(STRUCTURED_OUTPUT_TOOL);
	return [...set];
}
