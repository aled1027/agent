/**
 * Deterministic gate post-process (Claude Phase 5 equivalent).
 *
 * LLM gate may re-score / suggest verdict; these functions always enforce
 * threshold, dedupe, and verdict rules in code.
 */
import type { GateVerdict, Issue, IssueSeverity, Verdict } from "./types.js";

const SEVERITY_RANK: Record<IssueSeverity, number> = {
	blocker: 4,
	major: 3,
	minor: 2,
	nit: 1,
};

export function severityRank(s: IssueSeverity): number {
	return SEVERITY_RANK[s] ?? 0;
}

function dedupeKey(issue: Issue): string {
	const line = issue.line === undefined ? "-" : String(issue.line);
	return `${issue.file}\0${line}\0${issue.category}`;
}

/** Keep highest confidence; tie-break: higher severity, then longer evidence. */
export function dedupeIssues(issues: Issue[]): Issue[] {
	const best = new Map<string, Issue>();
	for (const issue of issues) {
		const key = dedupeKey(issue);
		const prev = best.get(key);
		if (!prev) {
			best.set(key, issue);
			continue;
		}
		if (issue.confidence > prev.confidence) {
			best.set(key, issue);
			continue;
		}
		if (issue.confidence < prev.confidence) continue;
		if (severityRank(issue.severity) > severityRank(prev.severity)) {
			best.set(key, issue);
			continue;
		}
		if (
			severityRank(issue.severity) === severityRank(prev.severity) &&
			issue.evidence.length > prev.evidence.length
		) {
			best.set(key, issue);
		}
	}
	return [...best.values()];
}

export function filterByThreshold(issues: Issue[], threshold: number): Issue[] {
	const floor = Math.max(0, Math.min(10, Math.floor(threshold)));
	return issues.filter((i) => i.confidence >= floor);
}

/**
 * Verdict rules (same as prompts/gate.md):
 * 1. request_changes if any blocker, or ≥3 major
 * 2. approve if no blocker and no major
 * 3. comment otherwise (only minor/nit)
 * Empty → approve
 */
export function computeVerdict(issues: Issue[]): Verdict {
	if (issues.length === 0) return "approve";
	const blockers = issues.filter((i) => i.severity === "blocker").length;
	const majors = issues.filter((i) => i.severity === "major").length;
	if (blockers > 0 || majors >= 3) return "request_changes";
	if (majors === 0) return "approve";
	return "comment";
}

export function defaultApproveReason(issues: Issue[]): string {
	if (issues.length === 0) {
		return "No high-confidence findings after dedupe + threshold.";
	}
	return "No blockers or major issues remain after filtering.";
}

/**
 * Apply code-side gate enforcement on raw LLM (or pre-scored) output.
 * Always recomputes verdict from filtered issues; LLM verdict is ignored.
 */
export function enforceGateOutput(
	raw: { issues: Issue[]; reason?: string },
	threshold: number,
): GateVerdict {
	const deduped = dedupeIssues(raw.issues ?? []);
	const issues = filterByThreshold(deduped, threshold);
	const verdict = computeVerdict(issues);
	let reason = (raw.reason ?? "").trim();
	if (!reason) {
		reason =
			verdict === "approve"
				? defaultApproveReason(issues)
				: `Enforced verdict from ${issues.length} issue(s) after threshold ${threshold}.`;
	}
	if (reason.length > 500) reason = reason.slice(0, 500);
	return { verdict, issues, reason };
}
