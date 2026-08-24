/**
 * Phase 1 — prep context before content reviewers run.
 *
 * Mirrors Claude code-review steps 2–3 (rule file paths + change summary).
 * v0.4: metadata-only summary; no full diff embed.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import type { ReviewTarget } from "./types.js";

export interface PrepContext {
	/** Repo-relative or absolute paths to rule files (paths only, like Claude step 2). */
	rulePaths: string[];
	/** Short human summary of the change (metadata only). */
	summary: string;
}

const RULE_CANDIDATES = [
	"AGENTS.md",
	"CLAUDE.md",
	"CONVENTIONS.md",
	".pi/conventions.md",
] as const;

/**
 * Discover rule files at repo root and under `.pi/rules/`.
 * Returns paths relative to `cwd` when possible.
 */
export function discoverRulePaths(cwd: string): string[] {
	const found: string[] = [];
	for (const name of RULE_CANDIDATES) {
		const abs = join(cwd, name);
		if (existsSync(abs)) {
			found.push(relative(cwd, abs) || name);
		}
	}
	const rulesDir = join(cwd, ".pi", "rules");
	if (existsSync(rulesDir)) {
		try {
			for (const entry of readdirSync(rulesDir)) {
				if (typeof entry === "string" && entry.endsWith(".md")) {
					found.push(relative(cwd, join(rulesDir, entry)) || join(".pi/rules", entry));
				}
			}
		} catch {
			// ignore unreadable rules dir
		}
	}
	const agentsRules = join(cwd, ".agents", "rules");
	if (existsSync(agentsRules)) {
		try {
			for (const entry of readdirSync(agentsRules)) {
				if (typeof entry === "string" && entry.endsWith(".md")) {
					found.push(relative(cwd, join(agentsRules, entry)) || join(".agents/rules", entry));
				}
			}
		} catch {
			// ignore
		}
	}
	return [...new Set(found)];
}

/** Build a short summary from diff text (files, hunks, line counts). */
export function summarizeDiff(diff: string): string {
	const files = new Set<string>();
	let hunks = 0;
	let additions = 0;
	let deletions = 0;

	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ b/")) {
			files.add(line.slice("+++ b/".length).trim());
		} else if (line.startsWith("@@")) {
			hunks++;
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			additions++;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			deletions++;
		}
	}

	const fileList = [...files].slice(0, 8);
	const more = files.size > 8 ? ` (+${files.size - 8} more)` : "";
	const filesPart = fileList.length > 0 ? fileList.join(", ") + more : "unknown files";

	return `${files.size} file(s) [${filesPart}]; ${hunks} hunk(s); +${additions}/-${deletions} lines.`;
}

/** Build prep metadata for a cwd + optional metadata summary. */
export function prepareContext(cwd: string, summary?: string): PrepContext {
	return {
		rulePaths: discoverRulePaths(cwd),
		summary: summary?.trim() || "Agents will discover the change (no pre-embedded diff).",
	};
}

export function obtainChangePlaybook(target: ReviewTarget): string {
	const lines: string[] = [
		"### How to obtain the change",
		"",
		"You must obtain the change yourself with tools. **No full diff is embedded in this prompt.**",
		"",
	];

	if (target.kind === "pr" && target.prRef) {
		lines.push(
			`- PR ref: \`${target.prRef}\``,
			`- Start with \`gh pr view ${target.prRef}\` and try \`gh pr diff ${target.prRef}\``,
			"- If HTTP 406 / too_large / empty: do **not** stop — use `git fetch` / ensure the PR head is available, then `git diff <base>...HEAD`, or path-scoped diffs / read changed files selectively",
			"- Prefer reviewing the PR's introduced lines; avoid dumping an entire monorepo into one tool call",
			"",
		);
	} else if (target.kind === "diff-file" && target.diffPath) {
		lines.push(
			`- Explicit diff file: \`${target.diffPath}\``,
			`- Use the \`read\` tool on that path (or \`@${target.diffPath}\` if supported)`,
			"- Then review only lines introduced in that diff",
			"",
		);
	} else {
		lines.push(
			"- Local git review (no PR URL given)",
			"- Run `git status`",
			"- If dirty: `git diff HEAD` (and handle untracked files)",
			"- If clean: `git diff <default-branch>...HEAD` (probe origin/HEAD → main → master)",
			"",
		);
	}

	if (target.hint) {
		lines.push(`Hint: ${target.hint}`, "");
	}
	if (target.probeNote) {
		lines.push(`Probe note: ${target.probeNote}`, "");
	}

	lines.push(
		"Review only lines introduced by this change. Do not flag pre-existing issues elsewhere.",
		"",
	);
	return lines.join("\n");
}

/** Format prep block + obtain-change playbook for reviewers (no full diff embed). */
export function formatReviewTask(prep: PrepContext, target: ReviewTarget): string {
	const rules =
		prep.rulePaths.length > 0
			? prep.rulePaths.map((p) => `- ${p}`).join("\n")
			: "- (no AGENTS.md / CLAUDE.md / .pi rules found at repo root)";

	const blocks = [
		"# Review task",
		"",
		"## Context",
		"",
	];

	if (target.userContext?.trim()) {
		blocks.push("### User request", "", target.userContext.trim(), "");
	}

	blocks.push(obtainChangePlaybook(target));

	blocks.push(
		"### Rule files (paths only — read as needed)",
		rules,
		"",
		"### Change summary (metadata only)",
		prep.summary,
		"",
		"## Output",
		"",
		"Call the `structured_output` tool exactly once with JSON matching the schema from your instructions. Do not reply in prose.",
	);

	return blocks.join("\n");
}

/** Short context block for gate / issue scorers (no full diff). */
export function formatGateContext(prep: PrepContext, target: ReviewTarget): string {
	const parts = [
		`Target: ${target.label}`,
		`Kind: ${target.kind}`,
	];
	if (target.prRef) parts.push(`PR: ${target.prRef}`);
	if (target.diffPath) parts.push(`Diff file: ${target.diffPath}`);
	if (target.userContext?.trim()) parts.push(`User request: ${target.userContext.trim()}`);
	parts.push(`Summary: ${prep.summary}`);
	if (prep.rulePaths.length > 0) {
		parts.push(`Rules: ${prep.rulePaths.join(", ")}`);
	}
	if (target.probeNote) parts.push(`Note: ${target.probeNote}`);
	return parts.join("\n");
}
