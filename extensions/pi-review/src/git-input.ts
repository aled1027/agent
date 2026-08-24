/**
 * Resolve what to review (v0.4 agent-driven).
 *
 * The plugin records a ReviewTarget (PR ref / --diff path / local-git hint).
 * It does **not** require a successful `gh pr diff` — oversized PRs are left
 * for reviewer agents to fetch via git.
 */
import { join } from "node:path";
import { extractPrRef } from "./pr-ref.js";
import type { ResolvedInput, ReviewTarget } from "./types.js";

export interface ResolveReviewTargetOptions {
	/** CC-style freeform user context (PR url, review focus, instructions). */
	input?: string;
}

/** Minimal git invocation. Tests inject a fake. */
export type RunGit = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

let _runGit: RunGit = defaultRunGit;

export function setRunGit(fn: RunGit): void {
	_runGit = fn;
}

export function resetRunGit(): void {
	_runGit = defaultRunGit;
}

async function defaultRunGit(args: string[], opts: { cwd: string }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		try {
			const child = spawn("git", args, {
				cwd: opts.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.setEncoding("utf-8");
			child.stderr?.setEncoding("utf-8");
			child.stdout?.on("data", (d: string) => (stdout += d));
			child.stderr?.on("data", (d: string) => (stderr += d));
			child.on("error", () => resolve({ stdout, stderr, exitCode: 1 }));
			child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
		} catch {
			resolve({ stdout: "", stderr: "", exitCode: 1 });
		}
	});
}

export type ReadFile = (path: string) => Promise<string>;

let _readFile: ReadFile = async (path) => {
	const { readFile } = await import("node:fs/promises");
	return readFile(path, "utf-8");
};

export function setReadFile(fn: ReadFile): void {
	_readFile = fn;
}

export function resetReadFile(): void {
	_readFile = async (path) => {
		const { readFile } = await import("node:fs/promises");
		return readFile(path, "utf-8");
	};
}

export type RunGh = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

let _runGh: RunGh = defaultRunGh;

export function setRunGh(fn: RunGh): void {
	_runGh = fn;
}

export function resetRunGh(): void {
	_runGh = defaultRunGh;
}

async function defaultRunGh(args: string[], opts: { cwd: string }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		try {
			const child = spawn("gh", args, {
				cwd: opts.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.setEncoding("utf-8");
			child.stderr?.setEncoding("utf-8");
			child.stdout?.on("data", (d: string) => (stdout += d));
			child.stderr?.on("data", (d: string) => (stderr += d));
			child.on("error", () => resolve({ stdout, stderr, exitCode: 1 }));
			child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
		} catch {
			resolve({ stdout: "", stderr: "", exitCode: 1 });
		}
	});
}

/** True when `cwd` is inside a git work tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
	const r = await _runGit(["rev-parse", "--git-dir"], { cwd });
	return r.exitCode === 0;
}

/**
 * Detect the default branch. Tries, in order:
 *   1. `git symbolic-ref refs/remotes/origin/HEAD`
 *   2. Probe `main`, then `master`
 *   3. Return whatever HEAD is
 */
export async function detectDefaultBranch(cwd: string): Promise<string | null> {
	const sym = await _runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd });
	if (sym.exitCode === 0) {
		const v = sym.stdout.trim();
		return v.startsWith("origin/") ? v.slice("origin/".length) : v;
	}
	for (const candidate of ["main", "master"]) {
		const probe = await _runGit(["rev-parse", "--verify", `refs/heads/${candidate}`], { cwd });
		if (probe.exitCode === 0) return candidate;
	}
	const head = await _runGit(["symbolic-ref", "--short", "HEAD"], { cwd });
	if (head.exitCode === 0) return head.stdout.trim();
	return null;
}

/**
 * Optional probe: fetch full local default diff (tests / trivial check).
 * Not used as a hard gate for agent-driven review.
 */
export async function resolveDefaultDiff(cwd: string): Promise<ResolvedInput | null> {
	const status = await _runGit(["status", "--porcelain"], { cwd });
	if (status.exitCode !== 0) {
		return null;
	}

	if (status.stdout.trim().length > 0) {
		const diff = await _runGit(["diff", "HEAD"], { cwd });
		if (diff.exitCode === 0 && diff.stdout.trim().length > 0) {
			return {
				content: diff.stdout,
				source: { kind: "uncommitted" },
				label: "uncommitted changes",
			};
		}
		const diff2 = await _runGit(["diff"], { cwd });
		if (diff2.exitCode === 0 && diff2.stdout.trim().length > 0) {
			return {
				content: diff2.stdout,
				source: { kind: "uncommitted" },
				label: "unstaged changes",
			};
		}
		const untracked = await _runGit(["ls-files", "--others", "--exclude-standard"], { cwd });
		if (untracked.exitCode === 0 && untracked.stdout.trim().length > 0) {
			const files = untracked.stdout.trim().split("\n");
			const parts: string[] = [];
			for (const f of files) {
				try {
					const content = await _readFile(join(cwd, f));
					parts.push(
						`diff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1,${content.split("\n").length} @@\n${content
							.split("\n")
							.map((l) => `+${l}`)
							.join("\n")}\n`,
					);
				} catch {
					// Skip unreadable files.
				}
			}
			if (parts.length > 0) {
				return {
					content: parts.join("\n"),
					source: { kind: "uncommitted" },
					label: "untracked files",
				};
			}
		}
		return null;
	}

	const base = await detectDefaultBranch(cwd);
	if (!base) return null;
	// Refresh remote tip so we do not three-dot against a stale local main/master.
	await _runGit(["fetch", "origin", base, "--quiet"], { cwd });
	const originBase = `origin/${base}`;
	const hasOrigin = await _runGit(["rev-parse", "--verify", originBase], { cwd });
	const compare = hasOrigin.exitCode === 0 ? originBase : base;
	const diff = await _runGit(["diff", `${compare}...HEAD`], { cwd });
	if (diff.exitCode !== 0) return null;
	if (diff.stdout.trim().length === 0) return null;
	return {
		content: diff.stdout,
		source: { kind: "vs-default-branch", base: compare },
		label: `vs ${compare}`,
	};
}

/** Lightweight PR metadata via `gh pr view` (never pulls the full diff body). */
export async function fetchPrMetadata(
	cwd: string,
	prRef: string,
): Promise<{ summary: string; probeNote?: string; additions?: number; changedFiles?: number } | null> {
	const view = await _runGh(
		["pr", "view", prRef, "--json", "title,additions,deletions,changedFiles,state"],
		{ cwd },
	);
	if (view.exitCode !== 0 || !view.stdout.trim()) {
		return null;
	}
	try {
		const data = JSON.parse(view.stdout) as {
			title?: string;
			additions?: number;
			deletions?: number;
			changedFiles?: number;
			state?: string;
		};
		const title = data.title ?? "(untitled)";
		const files = data.changedFiles ?? "?";
		const add = data.additions ?? "?";
		const del = data.deletions ?? "?";
		const state = data.state ?? "?";
		const additions = typeof data.additions === "number" ? data.additions : undefined;
		const changedFiles = typeof data.changedFiles === "number" ? data.changedFiles : undefined;
		// GitHub rejects `gh pr diff` above ~20k lines — warn agents without calling it.
		const likelyTooLarge =
			(additions !== undefined && additions >= 15_000) ||
			(changedFiles !== undefined && changedFiles >= 150);
		return {
			summary: `PR ${prRef}: "${title}" [${state}] · ${files} file(s) · +${add}/-${del} (metadata only; agents fetch the change).`,
			probeNote: likelyTooLarge
				? "PR likely exceeds gh pr diff limits — reviewers should use git / path-scoped diffs"
				: undefined,
			additions,
			changedFiles,
		};
	} catch {
		return null;
	}
}

/** Optional: note whether `gh pr diff` would fail (too_large) without blocking. */
export async function probeGhPrDiff(cwd: string, prRef: string): Promise<string | undefined> {
	const diff = await _runGh(["pr", "diff", prRef], { cwd });
	const combined = `${diff.stdout}\n${diff.stderr}`;
	if (/too_large|exceeded the maximum number of lines|HTTP 406/i.test(combined)) {
		return "gh pr diff too_large — reviewers should use git / path-scoped diffs";
	}
	if (diff.exitCode !== 0 || diff.stdout.trim().length === 0) {
		return "gh pr diff unavailable — reviewers should use git fetch / local branch";
	}
	return undefined;
}

function summarizeUserContext(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > 72 ? `${oneLine.slice(0, 69)}...` : oneLine;
}

function prLabel(prRef: string): string {
	const n = prRef.match(/pull\/(\d+)/i)?.[1] ?? prRef.replace(/^#/, "");
	return `PR ${n} (agent-fetch)`;
}

/**
 * Resolve a ReviewTarget (CC-aligned, agent-driven):
 * - `--diff` → path only (agents read the file)
 * - PR ref in user input → pr target (agents use gh/git)
 * - otherwise → local-git hint
 */
export async function resolveReviewTarget(
	cwd: string,
	opts: ResolveReviewTargetOptions,
): Promise<ReviewTarget | null> {
	const userContext = opts.input?.trim() || undefined;

	const prRef = userContext ? extractPrRef(userContext) : null;
	if (prRef) {
		return {
			kind: "pr",
			label: prLabel(prRef),
			userContext,
			prRef,
			hint: `Obtain PR ${prRef} yourself via gh and/or git. If \`gh pr diff\` hits too_large / HTTP 406, fall back to git / path-scoped diffs — do not stop.`,
		};
	}

	const git = await isGitRepo(cwd);
	if (!git) {
		return null;
	}

	const status = await _runGit(["status", "--porcelain"], { cwd });
	const dirty = status.exitCode === 0 && status.stdout.trim().length > 0;
	if (dirty) {
		return {
			kind: "local-git",
			label: userContext
				? `uncommitted · ${summarizeUserContext(userContext)}`
				: "uncommitted changes (agent-fetch)",
			userContext,
			hint: "Working tree is dirty. Use `git status` then `git diff HEAD` (and untracked files as needed).",
		};
	}

	const base = await detectDefaultBranch(cwd);
	const baseHint = base ?? "main";
	return {
		kind: "local-git",
		label: userContext
			? `vs ${baseHint} · ${summarizeUserContext(userContext)}`
			: `vs ${baseHint} (agent-fetch)`,
		userContext,
		hint: `Working tree is clean. Use \`git diff ${baseHint}...HEAD\` (or detect the default branch yourself).`,
	};
}

/** @deprecated Use resolveReviewTarget. */
export async function resolveReviewInput(
	cwd: string,
	opts: ResolveReviewTargetOptions,
): Promise<ResolvedInput | null> {
	const target = await resolveReviewTarget(cwd, opts);
	if (!target) return null;
	if (target.kind === "diff-file" && target.diffPath) {
		const content = await _readFile(target.diffPath);
		return {
			content,
			source: { kind: "path", path: target.diffPath },
			label: target.label,
			userContext: target.userContext,
		};
	}
	if (target.kind === "pr" && target.prRef) {
		return {
			content: "",
			source: { kind: "pr", ref: target.prRef },
			label: target.label,
			userContext: target.userContext,
		};
	}
	const probed = await resolveDefaultDiff(cwd);
	if (probed) {
		return { ...probed, userContext: target.userContext, label: target.label };
	}
	return {
		content: "",
		source: { kind: "uncommitted" },
		label: target.label,
		userContext: target.userContext,
	};
}
