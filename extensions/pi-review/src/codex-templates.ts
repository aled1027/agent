/**
 * Install pi-review's bundled roles as pi-codex-subagents templates.
 *
 * pi-codex-subagents deliberately discovers templates only from the user's
 * agent directory, not from extension packages. Templates are created once
 * and never overwritten so users can safely customize their copies.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REVIEWER_IDS = [
	"claude-md-compliance",
	"bugbot",
	"history-context",
	"security-review",
	"code-comments",
	"conventions",
	"gate",
	"lite-review",
] as const;

type ReviewerId = (typeof REVIEWER_IDS)[number];

const TEMPLATE_DIR = join(homedir(), ".pi", "agent", "pi-codex-subagents", "agents");
const AGENT_DIR = new URL("../agents/", import.meta.url);

export function codexAgentType(id: string): string {
	return `pi-review-${id}`;
}

function readAgentBody(id: ReviewerId): string {
	const source = readFileSync(new URL(`${id}.md`, AGENT_DIR), "utf8");
	if (!source.startsWith("---\n")) return source.trim();
	const frontmatterEnd = source.indexOf("\n---", 4);
	return (frontmatterEnd === -1 ? source : source.slice(frontmatterEnd + 4)).trim();
}

function frontmatterValue(id: ReviewerId, key: "description" | "tools"): string | undefined {
	const source = readFileSync(new URL(`${id}.md`, AGENT_DIR), "utf8");
	const match = source.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
	return match?.[1]?.trim();
}

/** Create missing Codex templates and return the paths created on this run. */
export function ensureCodexTemplates(): string[] {
	mkdirSync(TEMPLATE_DIR, { recursive: true });
	const created: string[] = [];
	for (const id of REVIEWER_IDS) {
		const path = join(TEMPLATE_DIR, `${codexAgentType(id)}.md`);
		if (existsSync(path)) continue;
		const description = frontmatterValue(id, "description") ?? `pi-review ${id} role`;
		const tools = frontmatterValue(id, "tools") ?? "read,grep,find,ls,bash";
		const template = [
			"---",
			`name: ${codexAgentType(id)}`,
			`description: ${description}`,
			`tools: ${tools}`,
			"---",
			"",
			readAgentBody(id),
			"",
		].join("\n");
		try {
			writeFileSync(path, template, { encoding: "utf8", flag: "wx", mode: 0o600 });
			created.push(path);
		} catch (error: any) {
			if (error?.code !== "EEXIST") throw error;
		}
	}
	return created;
}
