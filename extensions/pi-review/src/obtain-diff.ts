/**
 * Shell snippets for Step 1 — obtain an accurate review diff.
 *
 * Common failure mode: comparing against a stale local main/master without
 * `git fetch`, so the three-dot range includes unrelated upstream commits
 * (or misses them). Always prefer `origin/<base>` after a quiet fetch.
 */

export const DIFF_META_REL = ".pi/pi-review/diff-meta.txt";

export interface ObtainDiffScriptInput {
	cwd: string;
	diffPath: string;
	filesPath: string;
	kindPath: string;
	metaPath: string;
	/** When set, PR path (gh pr diff + git fallback). */
	prRef?: string;
}

function q(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Shared: write changed-files.txt + change-kind.txt from the diff file. */
function appendCompanionFiles(lines: string[], filesPath: string, kindPath: string, diffPath: string): void {
	lines.push(`# File list (paths only)`);
	lines.push(
		`(git diff --name-only HEAD 2>/dev/null || true; grep -E '^diff --git ' ${q(diffPath)} | sed -E 's/^diff --git a\\/([^ ]+) b\\/.*/\\1/' ) | sort -u | grep -v '^$' > ${q(filesPath)}`,
	);
	lines.push(`# change-kind: docs if every path looks like docs/skills/markdown, else code`);
	lines.push(
		`if grep -Eiv '\\.(md|mdx|txt|rst)$|/docs/|/\\.agents/|/\\.claude/|CHANGELOG|LICENSE|README' ${q(filesPath)} >/dev/null 2>&1; then echo code > ${q(kindPath)}; else echo docs > ${q(kindPath)}; fi`,
	);
}

/**
 * Resolve remote-tracking default branch ref (origin/main etc.).
 * Fetch first so the three-dot base is not a stale local tip.
 */
function appendResolveFreshBase(lines: string[]): void {
	lines.push(`# Resolve default branch; prefer origin/<base> after fetch (avoids stale local main)`);
	lines.push(`BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')`);
	lines.push(`if [ -z "$BASE" ]; then`);
	lines.push(`  if git rev-parse --verify refs/heads/main >/dev/null 2>&1; then BASE=main`);
	lines.push(`  elif git rev-parse --verify refs/heads/master >/dev/null 2>&1; then BASE=master`);
	lines.push(`  else BASE=$(git symbolic-ref --short HEAD 2>/dev/null || echo HEAD); fi`);
	lines.push(`fi`);
	lines.push(`git fetch origin "$BASE" --quiet 2>/dev/null || git fetch origin --quiet 2>/dev/null || true`);
	lines.push(`if git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then COMP="origin/$BASE"`);
	lines.push(`elif git rev-parse --verify "$BASE" >/dev/null 2>&1; then COMP="$BASE"`);
	lines.push(`else COMP=HEAD; fi`);
}

/** Build the Step 1 bash block (no surrounding ```). */
export function buildObtainDiffScript(input: ObtainDiffScriptInput): string {
	const { diffPath, filesPath, kindPath, metaPath, prRef } = input;
	const lines: string[] = [];
	lines.push(`mkdir -p ${q(`${input.cwd}/.pi/pi-review`)}`);
	lines.push(`META=${q(metaPath)}`);

	if (prRef) {
		const ref = q(prRef);
		lines.push(`# Prefer GitHub's PR diff (exact merge-base as on GitHub)`);
		lines.push(`if gh pr diff ${ref} > ${q(diffPath)} 2>/tmp/pi-review-gh-pr-diff.err \\`);
		lines.push(`  && test -s ${q(diffPath)}; then`);
		lines.push(`  echo "mode=gh-pr-diff" > "$META"`);
		lines.push(`  echo "pr=${prRef.replace(/'/g, "")}" >> "$META"`);
		lines.push(`else`);
		lines.push(`  # Fallback: fetch PR base + head, three-dot against origin/<base>`);
		lines.push(`  PR_JSON=$(gh pr view ${ref} --json number,baseRefName,headRefOid,baseRefOid 2>/dev/null || true)`);
		lines.push(`  PR_NUM=$(printf '%s' "$PR_JSON" | sed -n 's/.*"number":[ ]*\\([0-9][0-9]*\\).*/\\1/p' | head -1)`);
		lines.push(`  PR_BASE=$(printf '%s' "$PR_JSON" | sed -n 's/.*"baseRefName":[ ]*"\\([^"]*\\)".*/\\1/p' | head -1)`);
		lines.push(`  PR_BASE=\${PR_BASE:-main}`);
		lines.push(`  git fetch origin "$PR_BASE" --quiet 2>/dev/null || git fetch origin --quiet 2>/dev/null || true`);
		lines.push(`  if [ -n "$PR_NUM" ]; then`);
		lines.push(`    git fetch origin "pull/$PR_NUM/head:refs/pi-review/pr-head" --force --quiet 2>/dev/null \\`);
		lines.push(`      || git fetch origin "pull/$PR_NUM/head" --quiet 2>/dev/null || true`);
		lines.push(`  fi`);
		lines.push(`  if git rev-parse --verify "origin/$PR_BASE" >/dev/null 2>&1; then COMP="origin/$PR_BASE"; else COMP="$PR_BASE"; fi`);
		lines.push(`  if git rev-parse --verify refs/pi-review/pr-head >/dev/null 2>&1; then HEADREF=refs/pi-review/pr-head; else HEADREF=HEAD; fi`);
		lines.push(`  git diff "$COMP...$HEADREF" > ${q(diffPath)}`);
		lines.push(`  echo "mode=git-pr-fallback" > "$META"`);
		lines.push(`  echo "base=$COMP" >> "$META"`);
		lines.push(`  echo "head=$HEADREF" >> "$META"`);
		lines.push(`  echo "base_sha=$(git rev-parse "$COMP" 2>/dev/null || true)" >> "$META"`);
		lines.push(`  echo "head_sha=$(git rev-parse "$HEADREF" 2>/dev/null || true)" >> "$META"`);
		lines.push(`fi`);
	} else {
		lines.push(`# Dirty working tree → review uncommitted work (no base fetch needed)`);
		lines.push(`if [ -n "$(git status --porcelain 2>/dev/null)" ]; then`);
		lines.push(`  # Staged + unstaged vs HEAD (does not invent untracked file patches)`);
		lines.push(`  git diff HEAD > ${q(diffPath)}`);
		lines.push(`  echo "mode=uncommitted" > "$META"`);
		lines.push(`  echo "head_sha=$(git rev-parse HEAD 2>/dev/null || true)" >> "$META"`);
		lines.push(`else`);
		appendResolveFreshBase(lines);
		lines.push(`  git diff "$COMP...HEAD" > ${q(diffPath)}`);
		lines.push(`  echo "mode=vs-default" > "$META"`);
		lines.push(`  echo "base=$COMP" >> "$META"`);
		lines.push(`  echo "base_sha=$(git rev-parse "$COMP" 2>/dev/null || true)" >> "$META"`);
		lines.push(`  echo "head_sha=$(git rev-parse HEAD 2>/dev/null || true)" >> "$META"`);
		lines.push(`  echo "merge_base=$(git merge-base "$COMP" HEAD 2>/dev/null || true)" >> "$META"`);
		lines.push(`fi`);
	}

	lines.push(`test -s ${q(diffPath)}`);
	appendCompanionFiles(lines, filesPath, kindPath, diffPath);
	return lines.join("\n");
}
