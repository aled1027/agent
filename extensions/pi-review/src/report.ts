/**
 * Build and render the final ReviewReport as a markdown block.
 *
 * Rendered as a single `assistant` text block via ctx.sendMessage so it
 * appears natively in every pi mode (TUI, RPC, print). The same data is
 * also written via pi.appendEntry("custom", ...) so a future TUI renderer
 * can collapse sections without re-running the review.
 */
import type {
	GateRunResult,
	IssueSeverity,
	ReviewReport,
	ReviewerRunResult,
	Verdict,
} from "./types.js";

const EMPTY_SEVERITY_TOTALS: Record<IssueSeverity, number> = {
	blocker: 0,
	major: 0,
	minor: 0,
	nit: 0,
};

/** Aggregate a list of ReviewerRunResults + optional GateRunResult into a report. */
export function buildReport(input: {
	startedAt: number;
	reviewers: ReviewerRunResult[];
	gate: GateRunResult | null;
	input: ReviewReport["input"];
	prep?: ReviewReport["prep"];
}): ReviewReport {
	const reviewers = input.reviewers;
	const gate = input.gate;
	const durationMs = Date.now() - input.startedAt;
	const totals = computeTotals(reviewers, gate);
	let verdict: Verdict | "no-gate" | "error";
	if (reviewers.length > 0 && reviewers.every((r) => !r.ok)) {
		verdict = "error";
	} else if (!gate || !gate.ok) {
		verdict = "no-gate";
	} else {
		verdict = gate.verdict?.verdict ?? "no-gate";
	}
	return {
		startedAt: input.startedAt,
		durationMs,
		input: input.input,
		prep: input.prep,
		reviewers,
		gate,
		totals,
		verdict,
	};
}

function computeTotals(reviewers: ReviewerRunResult[], gate: GateRunResult | null): ReviewReport["totals"] {
	const bySeverity = { ...EMPTY_SEVERITY_TOTALS };
	let issues = 0;
	// Prefer gate's deduped issue set when present, otherwise sum reviewer outputs.
	const source = gate?.ok && gate.verdict ? gate.verdict.issues : reviewers.flatMap((r) => r.output?.issues ?? []);
	for (const issue of source) {
		bySeverity[issue.severity]++;
		issues++;
	}
	return { issues, bySeverity };
}

/** Render the full report as a single markdown string. */
export function renderReport(report: ReviewReport): string {
	const lines: string[] = [];
	lines.push(`## pi-review — ${report.input.label}`);
	lines.push("");
	lines.push(renderVerdictLine(report));
	lines.push(renderSummaryLine(report));
	if (report.input.userContext?.trim()) {
		lines.push("");
		lines.push(`_Request: ${report.input.userContext.trim()}_`);
	}
	if (report.prep) {
		lines.push("");
		lines.push(`_Rules: ${report.prep.rulePaths.join(", ") || "none"} · ${report.prep.summary}_`);
	}
	lines.push("");

	for (const r of report.reviewers) {
		lines.push(renderReviewerSection(r));
	}

	if (report.gate) {
		lines.push(renderGateSection(report.gate));
	}

	return lines.join("\n");
}

function renderVerdictLine(report: ReviewReport): string {
	const v = report.verdict;
	const label = v === "no-gate" ? "NO GATE" : v === "error" ? "ERROR" : v.toUpperCase();
	const t = report.totals.bySeverity;
	const counts = `${t.blocker} blockers · ${t.major} major · ${t.minor} minor · ${t.nit} nit`;
	const unfiltered =
		(!report.gate || !report.gate.ok) && report.verdict !== "error"
			? " · unfiltered reviewer totals"
			: "";
	return `**Verdict: ${label}** (${counts}${unfiltered})`;
}

function renderSummaryLine(report: ReviewReport): string {
	const dur = (report.durationMs / 1000).toFixed(1);
	const reviewerCount = report.reviewers.length;
	const gateCount = report.gate ? 1 : 0;
	return `Reviewed in ${dur}s · ${reviewerCount} reviewer${reviewerCount === 1 ? "" : "s"} · ${gateCount} gate`;
}

function renderReviewerSection(r: ReviewerRunResult): string {
	const status = r.ok ? "ok" : "failed";
	const model = r.model;
	const dur = (r.durationMs / 1000).toFixed(1);
	const head = `### ${r.id} (${model}) — ${status} · ${dur}s`;
	if (!r.ok) {
		const errMsg = r.error ?? "unknown error";
		const exit = r.exitCode !== undefined ? ` (exit ${r.exitCode})` : "";
		return [head, "", `- ${errMsg}${exit}`, ""].join("\n");
	}
	const issues = r.output?.issues ?? [];
	const summary = r.output?.summary ?? "";
	const body: string[] = [head, "", `- ${issues.length} issue${issues.length === 1 ? "" : "s"}`];
	if (summary) body.push(`- ${summary}`);
	for (const issue of issues) {
		const loc = issue.line !== undefined ? `${issue.file}:${issue.line}` : issue.file;
		body.push(`- [${issue.severity.toUpperCase()} · ${issue.category} · conf ${issue.confidence}] \`${loc}\` — ${issue.evidence}`);
	}
	body.push("");
	return body.join("\n");
}

function renderGateSection(g: GateRunResult): string {
	if (!g.ok) {
		const exit = g.exitCode !== undefined ? ` (exit ${g.exitCode})` : "";
		return [`### gate (${g.model}) — failed · ${(g.durationMs / 1000).toFixed(1)}s`, "", `- ${g.error ?? "unknown error"}${exit}`, ""].join("\n");
	}
	const v = g.verdict;
	if (!v) {
		return [`### gate (${g.model}) — ok · no verdict`, ""].join("\n");
	}
	const issues = v.issues;
	const noHighConfidence =
		v.verdict === "approve" && issues.length === 0 && v.reason.toLowerCase().includes("no high-confidence");
	const lines = [
		`### gate (${g.model}) — ok · ${(g.durationMs / 1000).toFixed(1)}s`,
		"",
		`- verdict: ${v.verdict}`,
		`- reason: ${v.reason}`,
		noHighConfidence
			? "- no high-confidence issues after dedupe + threshold"
			: `- ${issues.length} issue${issues.length === 1 ? "" : "s"} after dedupe + threshold`,
	];
	for (const issue of issues) {
		const loc = issue.line !== undefined ? `${issue.file}:${issue.line}` : issue.file;
		lines.push(
			`- [${issue.severity.toUpperCase()} · ${issue.category} · conf ${issue.confidence}] \`${loc}\` — ${issue.evidence}`,
		);
	}
	lines.push("");
	return lines.join("\n");
}
