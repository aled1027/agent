/**
 * CC-aligned review permission allowlist + merge into permission-modes local rules.
 *
 * Source of truth for gh rules: Claude `/code-review` command frontmatter
 * (`Bash(gh …:*)`). Git/Read extras are required for pi headless children
 * (no ask UI) — see plan v0.5.2.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A. Exact Claude code-review command allowed-tools (gh only). */
export const CC_GH_ALLOW: readonly string[] = [
	"Bash(gh issue view:*)",
	"Bash(gh search:*)",
	"Bash(gh issue list:*)",
	"Bash(gh pr comment:*)",
	"Bash(gh pr diff:*)",
	"Bash(gh pr view:*)",
	"Bash(gh pr list:*)",
];

/** B. Implied by CC history agent (git blame/log) — not in CC frontmatter. */
export const REVIEW_GIT_HISTORY_ALLOW: readonly string[] = [
	"Bash(git blame:*)",
	"Bash(git log:*)",
	"Bash(git show:*)",
];

/** C. pi-review obtain-diff path (local / oversized PR fallback). */
export const REVIEW_GIT_OBTAIN_ALLOW: readonly string[] = [
	"Bash(git diff:*)",
	"Bash(git status:*)",
	"Bash(git rev-parse:*)",
	"Bash(git symbolic-ref:*)",
	"Bash(git fetch:*)",
	"Bash(git merge-base:*)",
	"Bash(git ls-files:*)",
];

/** D. Non-bash tools used by lean reviewers. */
export const REVIEW_TOOL_ALLOW: readonly string[] = ["Read", "Grep"];

/** Full allow list merged into permission-modes. */
export const REVIEW_PERMISSION_ALLOW: readonly string[] = [
	...CC_GH_ALLOW,
	...REVIEW_GIT_HISTORY_ALLOW,
	...REVIEW_GIT_OBTAIN_ALLOW,
	...REVIEW_TOOL_ALLOW,
];

/**
 * Nested YAML for agent `permission:` frontmatter (gotgenes / future paths).
 * Mirrors A–D as allow; default ask for everything else.
 */
export const REVIEW_AGENT_PERMISSION_YAML = `"*": ask
read: allow
grep: allow
bash:
  "*": ask
  "gh issue view*": allow
  "gh search*": allow
  "gh issue list*": allow
  "gh pr comment*": allow
  "gh pr diff*": allow
  "gh pr view*": allow
  "gh pr list*": allow
  "git blame*": allow
  "git log*": allow
  "git show*": allow
  "git diff*": allow
  "git status*": allow
  "git rev-parse*": allow
  "git symbolic-ref*": allow
  "git fetch*": allow
  "git merge-base*": allow
  "git ls-files*": allow`;

function hashPath(p: string): string {
	return createHash("sha256").update(p).digest("hex").slice(0, 8);
}

/** Match permission-modes getProjectId fallback (+ reuse existing projects dir). */
export function resolveProjectId(cwd: string): string {
	const projectsDir = join(cwd, ".pi", "projects");
	try {
		if (existsSync(projectsDir)) {
			const entries = readdirSync(projectsDir).filter((e) => !e.startsWith("."));
			if (entries.length === 1) return entries[0]!;
			const hashed = hashPath(cwd);
			if (entries.includes(hashed)) return hashed;
		}
	} catch {
		/* fall through */
	}
	return hashPath(cwd);
}

export function projectPermissionsLocalPath(cwd: string): string {
	return join(cwd, ".pi", "projects", resolveProjectId(cwd), "permissions.local.json");
}

interface PermissionsFile {
	permissions?: {
		allow?: string[];
		deny?: string[];
		ask?: string[];
	};
}

/**
 * Merge REVIEW_PERMISSION_ALLOW into project-local permission-modes rules.
 * Only adds missing allow entries; never touches deny/ask.
 */
export function ensureReviewPermissions(cwd: string): {
	path: string;
	added: string[];
	alreadyPresent: number;
} {
	const filePath = projectPermissionsLocalPath(cwd);
	mkdirSync(join(filePath, ".."), { recursive: true });

	let existing: PermissionsFile = {};
	if (existsSync(filePath)) {
		try {
			existing = JSON.parse(readFileSync(filePath, "utf-8")) as PermissionsFile;
		} catch {
			existing = {};
		}
	}

	const allow = new Set(existing.permissions?.allow ?? []);
	const added: string[] = [];
	for (const rule of REVIEW_PERMISSION_ALLOW) {
		if (!allow.has(rule)) {
			allow.add(rule);
			added.push(rule);
		}
	}

	if (added.length > 0) {
		const next: PermissionsFile = {
			...existing,
			permissions: {
				...existing.permissions,
				allow: [...allow].sort(),
				deny: existing.permissions?.deny,
				ask: existing.permissions?.ask,
			},
		};
		writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	}

	return {
		path: filePath,
		added,
		alreadyPresent: REVIEW_PERMISSION_ALLOW.length - added.length,
	};
}

/** Optional: also merge into global permission-modes.json (used by tests / opt-in). */
export function ensureReviewPermissionsGlobal(
	configPath = join(homedir(), ".pi", "agent", "permission-modes.json"),
): { path: string; added: string[] } {
	let existing: PermissionsFile & Record<string, unknown> = {};
	if (existsSync(configPath)) {
		try {
			existing = JSON.parse(readFileSync(configPath, "utf-8")) as PermissionsFile &
				Record<string, unknown>;
		} catch {
			existing = {};
		}
	}
	const allow = new Set(
		(existing.permissions?.allow ?? []) as string[],
	);
	const added: string[] = [];
	for (const rule of REVIEW_PERMISSION_ALLOW) {
		if (!allow.has(rule)) {
			allow.add(rule);
			added.push(rule);
		}
	}
	if (added.length > 0) {
		mkdirSync(join(configPath, ".."), { recursive: true });
		const next = {
			...existing,
			permissions: {
				...existing.permissions,
				allow: [...allow].sort(),
				deny: existing.permissions?.deny,
				ask: existing.permissions?.ask,
			},
		};
		writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	}
	return { path: configPath, added };
}
