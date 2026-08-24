/**
 * Shared type definitions for pi-review.
 *
 * ReviewerSpec, Issue, and PiReviewConfig are the data backbone for
 * configuration, structured I/O between the parent and subagent processes,
 * and the final report shape.
 */

/** Final verdict produced by the gate subagent. */
export type Verdict = "approve" | "request_changes" | "comment";

/**
 * Optional Claude Phase 4 style per-issue scoring after the aggregating gate.
 * - off: gate LLM + code enforce only
 * - blocker-major: parallel scorers for blocker/major only (default)
 * - all: score every surviving candidate issue
 */
export type ScorePerIssueMode = "off" | "blocker-major" | "all";

/** Issue severity bucket. */
export type IssueSeverity = "blocker" | "major" | "minor" | "nit";

/** Issue category — informs routing and which reviewer surfaced it. */
export type IssueCategory =
	| "compliance"
	| "bug"
	| "convention"
	| "history"
	| "security"
	| "performance"
	| "docs"
	| "other";

/** A single finding reported by a reviewer (or surfaced by the gate). */
export interface Issue {
	/** Repo-relative path, or "global" for cross-cutting findings. */
	file: string;
	/** 1-indexed line in the file. Omit for findings that span ranges or are file-wide. */
	line?: number;
	category: IssueCategory;
	severity: IssueSeverity;
	/** 1-10 confidence score (calibrated like Claude's code-review plugin). */
	confidence: number;
	/** Short evidence quote or paraphrase. Max 280 chars. */
	evidence: string;
}

/** Structured payload a reviewer subagent must produce. */
export interface ReviewerOutput {
	issues: Issue[];
	summary: string;
}

/** Definition of a single reviewer, loaded from config + bundled prompt. */
export interface ReviewerSpec {
	id: string;
	label: string;
	enabled: boolean;
	/** "inherit" resolves to the parent session model at run time. */
	model: string | "inherit";
	thinking?: string;
	tools?: string[];
	/**
	 * Optional override path (relative to the package) to the reviewer prompt
	 * markdown. When omitted, the runner derives `agents/<id>.md` from `id`.
	 */
	promptPath?: string;
	timeoutMs?: number;
}

/** Per-run outcome of a single reviewer subagent. */
export interface ReviewerRunResult {
	id: string;
	label: string;
	/** Resolved model id (post-"inherit" substitution). */
	model: string;
	ok: boolean;
	output?: ReviewerOutput;
	error?: string;
	/** Process exit code. null = killed by timeout or signal. undefined = never started. */
	exitCode?: number | null;
	durationMs: number;
}

/** Aggregated verdict produced by the gate subagent. */
export interface GateVerdict {
	verdict: Verdict;
	/** Deduped + threshold-filtered issues from the reviewer pool. */
	issues: Issue[];
	/** One-sentence rationale, max 500 chars. */
	reason: string;
}

/** Per-run outcome of the gate subagent. */
export interface GateRunResult {
	ok: boolean;
	verdict?: GateVerdict;
	error?: string;
	/** Process exit code. null = killed by timeout or signal. undefined = never started. */
	exitCode?: number | null;
	durationMs: number;
	model: string;
}

/** Top-level user-editable config. */
export interface PiReviewConfig {
	schemaVersion: 1;
	gate: {
		/** "inherit" → parent session model at run time. */
		model: string | "inherit";
		thinking?: string;
		/** When false, gate is always skipped (same as --no-gate). */
		enabled: boolean;
		/** Default confidence floor for the gate (issues with confidence < threshold are dropped). */
		threshold: number;
		/**
		 * Parallel per-issue confidence scorers after the gate LLM pass.
		 * Default `blocker-major` — light Claude Phase 4 alignment.
		 */
		scorePerIssue: ScorePerIssueMode;
	};
	/** Max reviewers running in parallel. Hard cap 4. */
	concurrency: number;
	reviewers: Record<string, Omit<ReviewerSpec, "promptPath"> & { promptPath?: string }>;
	inheritance: {
		/** Default tool list when a reviewer does not specify one. */
		toolsDefault: string[];
		inheritProjectContext: boolean;
		inheritSkills: boolean;
	};
	/**
	 * Optional budgets for the foreground directive path (pi-subagents).
	 * turnBudget.maxTurns defaults to 20 (cap 48).
	 */
	budgets?: {
		turnBudget?: { maxTurns?: number; graceTurns?: number };
	};
}

/**
 * What to review — agent-driven (v0.4). The plugin does **not** embed a full
 * diff; reviewers obtain the change themselves via gh/git/read.
 */
export type ReviewTargetKind = "pr" | "diff-file" | "local-git";

export interface ReviewTarget {
	kind: ReviewTargetKind;
	/** Short human label for the report header. */
	label: string;
	/** CC-style freeform user context (PR URL, instructions, etc.). */
	userContext?: string;
	/** Parsed PR URL or number when kind === "pr". */
	prRef?: string;
	/** Absolute path to an explicit `--diff` file when kind === "diff-file". */
	diffPath?: string;
	/** Hint for local-git: dirty working tree vs base...HEAD. */
	hint?: string;
	/**
	 * Optional short probe note for dry-run (e.g. gh too_large). Never a hard
	 * failure — agents still fetch.
	 */
	probeNote?: string;
}

/** @deprecated Use ReviewTarget. Kept for tests that still synthesize local diffs. */
export type InputSource =
	| { kind: "path"; path: string }
	| { kind: "pr"; ref: string }
	| { kind: "uncommitted" }
	| { kind: "vs-default-branch"; base: string };

/** @deprecated Prefer ReviewTarget; used only by resolveDefaultDiff probes. */
export interface ResolvedInput {
	content: string;
	source: InputSource;
	label: string;
	userContext?: string;
}

/** Prep metadata attached to a run (Claude steps 2–3). */
export interface PrepMetadata {
	rulePaths: string[];
	summary: string;
}

/** Top-level run report. */
export interface ReviewReport {
	startedAt: number;
	durationMs: number;
	input: ReviewTarget;
	prep?: PrepMetadata;
	reviewers: ReviewerRunResult[];
	gate: GateRunResult | null;
	totals: {
		issues: number;
		bySeverity: Record<IssueSeverity, number>;
	};
	verdict: Verdict | "no-gate" | "error";
}
