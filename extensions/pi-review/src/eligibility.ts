/**
 * Phase 0 — eligibility checks before spawning reviewers.
 *
 * v0.4: agent-driven — eligible with PR ref / --diff / git repo without a
 * pre-fetched diff body. Trivial lockfile skip only when a short local probe
 * is available.
 */
import type { ReviewTarget } from "./types.js";

export interface EligibilityInput {
	target: ReviewTarget | null;
	/** User passed `--diff` or a PR ref. */
	hasExplicitInput: boolean;
	/** cwd is inside a git repository. */
	isGitRepo: boolean;
	/**
	 * Optional short local diff probe (only when cheaply available). When set
	 * and trivial, skip. When absent, do not require non-empty content.
	 */
	probedDiff?: string | null;
}

export type EligibilityResult =
	| { eligible: true }
	| { eligible: false; reason: string };

const LOCKFILE_ONLY = /^(?:.*\/)?(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock(?:\.bun)?|Cargo\.lock|Gemfile\.lock|poetry\.lock)(?:\n|$)/;

/** Run eligibility checks. Returns `{ eligible: false, reason }` to skip review. */
export function checkEligibility(input: EligibilityInput): EligibilityResult {
	if (!input.target) {
		if (!input.isGitRepo && !input.hasExplicitInput) {
			return {
				eligible: false,
				reason: "Not a git repository. Pass a PR URL/number, use --diff @file.diff, or run inside a git repo.",
			};
		}
		return {
			eligible: false,
			reason: "Nothing to review (could not resolve a PR, diff file, or local git target).",
		};
	}

	if (input.probedDiff != null && input.probedDiff.trim().length > 0 && isTrivialDiff(input.probedDiff)) {
		return {
			eligible: false,
			reason: "Diff is trivial (lockfile-only or fewer than 3 changed lines).",
		};
	}

	return { eligible: true };
}

/** Re-check before render (Claude phase 6 lite). */
export function recheckBeforeOutput(target: ReviewTarget | null): EligibilityResult {
	if (!target) {
		return { eligible: false, reason: "Review target disappeared before output." };
	}
	return { eligible: true };
}

/**
 * Heuristic trivial diff detection.
 * - Fewer than 3 non-header diff lines
 * - Only lockfile paths in diff headers
 */
export function isTrivialDiff(content: string): boolean {
	const trimmed = content.trim();
	if (trimmed.length === 0) return true;

	const lines = trimmed.split("\n");
	const bodyLines = lines.filter(
		(l) => l.startsWith("+") || l.startsWith("-"),
	).filter((l) => !l.startsWith("+++") && !l.startsWith("---"));
	if (bodyLines.length < 3) return true;

	const fileHeaders = lines.filter((l) => l.startsWith("diff --git ") || l.startsWith("+++ b/"));
	if (fileHeaders.length > 0) {
		const onlyLockfiles = fileHeaders.every((h) => {
			const m = h.match(/(?:^diff --git a\/(.+?) b\/|^\+{3} b\/)(.+)$/);
			const file = m?.[1] ?? m?.[2] ?? "";
			return LOCKFILE_ONLY.test(file);
		});
		if (onlyLockfiles && bodyLines.length < 20) return true;
	}

	return false;
}
