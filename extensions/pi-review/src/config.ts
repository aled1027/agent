/**
 * Configuration loading, validation, and atomic persistence.
 *
 * The user-editable config lives at:
 *   ~/.pi/agent/extensions/pi-review/config.json
 *
 * We never touch the top-level settings.json — that file is managed by pi
 * itself.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PiReviewConfig, ReviewerSpec, ScorePerIssueMode } from "./types.js";

/**
 * Cheap model used by default for the gate (dedupe + re-score + verdict).
 * The gate is pure de-noise reasoning, so it defaults to a cheap tier;
 * reviewers stay on "inherit" to follow the parent session's stronger model.
 * This is requested only when pi-codex-subagents exposes it in spawn_agent's
 * allowed model schema; otherwise the gate inherits the parent model.
 */
export const DEFAULT_GATE_MODEL = "anthropic/claude-haiku-4-5";

/** Default reviewer and gate config shipped with the package. */
export const DEFAULT_CONFIG: PiReviewConfig = {
	schemaVersion: 1,
	gate: {
		// Cheap tier by default — the gate only dedupes + re-scores + verdicts,
		// so cost matters more than raw strength. Reviewers stay on "inherit".
		model: DEFAULT_GATE_MODEL,
		thinking: "low",
		enabled: true,
		threshold: 8,
		// Off by default — the gate's single re-score pass is enough (roadmap
		// principle #5: "one cheap spawn"). Opt in via config for deep mode.
		scorePerIssue: "off",
	},
	concurrency: 4,
	reviewers: {
		"claude-md-compliance": {
			id: "claude-md-compliance",
			label: "Claude-MD Compliance",
			enabled: true,
			model: "inherit",
			tools: ["read", "grep", "ls"],
		},
		"bugbot": {
			id: "bugbot",
			label: "Bugbot",
			enabled: true,
			model: "inherit",
			tools: ["read", "grep", "bash"],
		},
		"history-context": {
			id: "history-context",
			label: "History Context",
			enabled: true,
			model: "inherit",
			tools: ["read", "bash"],
		},
		"security-review": {
			id: "security-review",
			label: "Security Review",
			enabled: true,
			model: "inherit",
			tools: ["read", "grep", "bash"],
		},
		"code-comments": {
			id: "code-comments",
			label: "Code Comments",
			enabled: true,
			model: "inherit",
			tools: ["read", "grep"],
		},
		"conventions": {
			id: "conventions",
			label: "Conventions",
			enabled: false,
			model: "inherit",
			tools: ["read", "grep", "ls"],
		},
	},
	inheritance: {
		toolsDefault: ["read", "grep", "find", "ls", "bash"],
		inheritProjectContext: false,
		inheritSkills: false,
	},
	budgets: {
		turnBudget: { maxTurns: 20, graceTurns: 2 },
	},
};

/** Hard upper bound on parallel reviewers, regardless of user config. */
export const MAX_PARALLEL_CONCURRENCY = 4;

/**
 * Canonical config file path — top-level beside `permission-modes.json`,
 * `settings.json`, etc. (mirrors pi-permission-modes), so it is easy to find.
 * Tests override it via `setConfigPath` to point at a sandbox.
 */
const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-review.json");
let _configPath = DEFAULT_CONFIG_PATH;

export function configPath(): string {
	return _configPath;
}

/** Override the config path (used by tests). Pass nothing to reset to default. */
export function setConfigPath(p?: string): void {
	_configPath = p ?? DEFAULT_CONFIG_PATH;
}

/**
 * Read raw config from disk. Returns an empty object when the file is
 * missing, unreadable, or corrupt — the caller is expected to fall through
 * to mergeWithDefaults().
 */
export function loadRawConfig(): Record<string, unknown> {
	const path = configPath();
	if (!existsSync(path)) return {};
	try {
		const text = readFileSync(path, "utf-8");
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Deep-merge a raw user config over DEFAULT_CONFIG. We deliberately re-build
 * nested objects rather than mutating so the merge is pure.
 */
export function mergeWithDefaults(raw: unknown): PiReviewConfig {
	const base: PiReviewConfig = structuredClone(DEFAULT_CONFIG);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
	const r = raw as Record<string, unknown>;

	// schemaVersion: pass through whatever the user wrote so validateConfig
	// can flag unsupported versions. We never silently coerce — unknown
	// future versions should not pretend to be loadable.
	if (typeof r.schemaVersion === "number") {
		base.schemaVersion = r.schemaVersion as 1;
	}

	// Gate block.
	if (r.gate && typeof r.gate === "object" && !Array.isArray(r.gate)) {
		const g = r.gate as Record<string, unknown>;
		if (typeof g.model === "string") base.gate.model = g.model;
		if (typeof g.thinking === "string") base.gate.thinking = g.thinking;
		if (typeof g.enabled === "boolean") base.gate.enabled = g.enabled;
		if (typeof g.threshold === "number" && Number.isFinite(g.threshold)) {
			base.gate.threshold = clampThreshold(g.threshold);
		}
		if (typeof g.scorePerIssue === "string") {
			const mode = parseScorePerIssueMode(g.scorePerIssue);
			if (mode) base.gate.scorePerIssue = mode;
		}
	}

	// Top-level concurrency (clamped to [1, MAX_PARALLEL_CONCURRENCY]).
	if (typeof r.concurrency === "number" && Number.isFinite(r.concurrency)) {
		base.concurrency = Math.max(1, Math.min(MAX_PARALLEL_CONCURRENCY, Math.floor(r.concurrency)));
	}

	// Reviewer overrides — keyed by id; the user can add, disable, or change
	// model/thinking/tools. They cannot redefine id or label.
	if (r.reviewers && typeof r.reviewers === "object" && !Array.isArray(r.reviewers)) {
		const reviewers = r.reviewers as Record<string, unknown>;
		for (const [id, raw] of Object.entries(reviewers)) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
			const ov = raw as Record<string, unknown>;
			const existing = base.reviewers[id];
			const merged: ReviewerSpec = existing
				? { ...existing, id, label: existing.label }
				: { id, label: id, enabled: true, model: "inherit" };
			if (typeof ov.label === "string") merged.label = ov.label;
			if (typeof ov.enabled === "boolean") merged.enabled = ov.enabled;
			if (typeof ov.model === "string") merged.model = ov.model;
			if (typeof ov.thinking === "string") merged.thinking = ov.thinking;
			if (Array.isArray(ov.tools)) {
				merged.tools = ov.tools.filter((t): t is string => typeof t === "string");
			}
			if (typeof ov.promptPath === "string") merged.promptPath = ov.promptPath;
			if (typeof ov.timeoutMs === "number" && Number.isFinite(ov.timeoutMs)) {
				merged.timeoutMs = Math.max(1000, Math.floor(ov.timeoutMs));
			}
			base.reviewers[id] = merged;
		}
	}

	// Inheritance block.
	if (r.inheritance && typeof r.inheritance === "object" && !Array.isArray(r.inheritance)) {
		const inh = r.inheritance as Record<string, unknown>;
		if (Array.isArray(inh.toolsDefault)) {
			base.inheritance.toolsDefault = inh.toolsDefault.filter((t): t is string => typeof t === "string");
		}
		if (typeof inh.inheritProjectContext === "boolean") {
			base.inheritance.inheritProjectContext = inh.inheritProjectContext;
		}
		if (typeof inh.inheritSkills === "boolean") {
			base.inheritance.inheritSkills = inh.inheritSkills;
		}
	}

	// Legacy budgets (ignored by the foreground Codex directive).
	if (r.budgets && typeof r.budgets === "object" && !Array.isArray(r.budgets)) {
		const b = r.budgets as Record<string, unknown>;
		base.budgets = base.budgets ?? { turnBudget: { maxTurns: 20, graceTurns: 2 } };
		if (b.turnBudget && typeof b.turnBudget === "object" && !Array.isArray(b.turnBudget)) {
			const tb = b.turnBudget as Record<string, unknown>;
			base.budgets.turnBudget = {
				...base.budgets.turnBudget,
				...(typeof tb.maxTurns === "number" && Number.isFinite(tb.maxTurns)
					? { maxTurns: Math.max(1, Math.min(48, Math.floor(tb.maxTurns))) }
					: {}),
				...(typeof tb.graceTurns === "number" && Number.isFinite(tb.graceTurns)
					? { graceTurns: Math.max(0, Math.floor(tb.graceTurns)) }
					: {}),
			};
		}
	}

	return base;
}

/** Threshold is 0-10 inclusive; values outside are clamped. NaN falls back to 8 (default). */
export function clampThreshold(n: number): number {
	if (Number.isNaN(n)) return 8;
	if (n === Infinity) return 10;
	if (n === -Infinity) return 0;
	if (!Number.isFinite(n)) return 8;
	return Math.max(0, Math.min(10, Math.floor(n)));
}

export function parseScorePerIssueMode(raw: string): ScorePerIssueMode | null {
	const v = raw.trim().toLowerCase();
	if (v === "off" || v === "false" || v === "0" || v === "no") return "off";
	if (v === "blocker-major" || v === "blocker_major" || v === "major") {
		return "blocker-major";
	}
	if (v === "all" || v === "true" || v === "1" || v === "yes") return "all";
	return null;
}

/**
 * Validate a merged config. Returns ok=false with a list of human-readable
 * errors when something is wrong. Used by /review-config to surface bad edits.
 */
export function validateConfig(cfg: PiReviewConfig): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	if (cfg.schemaVersion !== 1) {
		errors.push(`schemaVersion must be 1 (got ${String(cfg.schemaVersion)})`);
	}
	if (cfg.gate.model !== "inherit" && typeof cfg.gate.model !== "string") {
		errors.push("gate.model must be a string or 'inherit'");
	}
	if (cfg.gate.model === "") {
		errors.push("gate.model cannot be an empty string");
	}
	if (cfg.gate.threshold < 0 || cfg.gate.threshold > 10) {
		errors.push("gate.threshold must be between 0 and 10");
	}
	if (
		cfg.gate.scorePerIssue !== "off" &&
		cfg.gate.scorePerIssue !== "blocker-major" &&
		cfg.gate.scorePerIssue !== "all"
	) {
		errors.push("gate.scorePerIssue must be off | blocker-major | all");
	}
	if (cfg.concurrency < 1 || cfg.concurrency > MAX_PARALLEL_CONCURRENCY) {
		errors.push(`concurrency must be between 1 and ${MAX_PARALLEL_CONCURRENCY}`);
	}
	for (const [id, r] of Object.entries(cfg.reviewers)) {
		if (r.model !== "inherit" && typeof r.model !== "string") {
			errors.push(`reviewers.${id}.model must be a string or 'inherit'`);
		}
		if (r.model === "") {
			errors.push(`reviewers.${id}.model cannot be an empty string`);
		}
	}
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Atomic write: tmp file + rename. Mirrors pi-effort/effort.ts:201-218. */
export function writeConfig(cfg: PiReviewConfig): void {
	const path = configPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
	try {
		writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
		renameSync(tmp, path);
	} catch (err) {
		try {
			// Best-effort cleanup of the temp file on failure.
			unlinkSync(tmp);
		} catch {
			// Ignore secondary errors during cleanup.
		}
		throw err;
	}
}

/**
 * Read → merge → validate in one call. Returns the effective config plus any
 * validation issues. When validation fails, the function still returns the
 * merged config (best-effort) so the caller can decide whether to proceed.
 */
export function loadConfig(): { config: PiReviewConfig; errors: string[] } {
	const raw = loadRawConfig();
	const config = mergeWithDefaults(raw);
	const validation = validateConfig(config);
	return { config, errors: validation.ok === true ? [] : validation.errors };
}

/**
 * Resolve the "inherit" sentinel against a real model id. Falls back to a
 * sensible default when the parent session has no model (e.g. RPC mode).
 */
export function resolveModel(value: string | "inherit", parentModelId: string | undefined): string {
	if (value === "inherit") {
		return parentModelId && parentModelId.length > 0
			? parentModelId
			: DEFAULT_GATE_MODEL;
	}
	return value;
}
