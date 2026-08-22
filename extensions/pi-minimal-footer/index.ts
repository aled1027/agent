/**
 * Minimal footer with repository, model, thinking-level, and context details.
 *
 * This customized version intentionally does not fetch or render provider/model
 * subscription quotas.
 */

import { buildSessionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";

interface GitCache {
  branch: string | null;
  dirty: boolean;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

let gitCache: GitCache | null = null;

function parseGitStatus(output: string): GitCache {
  let branch: string | null = null;
  let dirty = false;
  for (const line of output.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      branch = head && head !== "(detached)" ? head : null;
      continue;
    }

    if (!line.startsWith("# ")) dirty = true;
  }

  return { branch, dirty };
}

function sameGitCache(a: GitCache | null, b: GitCache | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.branch === b.branch && a.dirty === b.dirty;
}

function refreshGitCache(): boolean {
  let next: GitCache | null = null;

  try {
    const status = execSync("git status --porcelain=v2 --branch 2>/dev/null", {
      encoding: "utf8",
      timeout: 1000,
    });
    next = parseGitStatus(status.trimEnd());
  } catch {
    next = null;
  }

  const changed = !sameGitCache(gitCache, next);
  gitCache = next;
  return changed;
}

export default function (pi: ExtensionAPI) {
  const CTX_GAUGE_WIDTH = 12;
  const FOOTER_BOTTOM_PADDING_LINES = 2;
  const BAR_FILLED = "━";
  const BAR_EMPTY = "─";
  const showCwd = parseBooleanEnv(process.env.PI_MINIMAL_FOOTER_SHOW_CWD, true);
  const showBranch = parseBooleanEnv(process.env.PI_MINIMAL_FOOTER_SHOW_BRANCH, true);
  let tuiRef: { requestRender: () => void } | null = null;

  function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) {
      const millions = tokens / 1_000_000;
      return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return `${tokens}`;
  }

  function fitFooterSegment(width: number, variants: string[]): string {
    const safeWidth = Math.max(1, width);
    for (const variant of variants) {
      if (visibleWidth(variant) <= safeWidth) return variant;
    }
    return truncateToWidth(variants.at(-1) ?? "", safeWidth);
  }

  function wrapFooterSegments(segments: string[], width: number, separator: string): string[] {
    const safeWidth = Math.max(1, width);
    const lines: string[] = [];
    let current = "";

    for (const segment of segments.filter(Boolean)) {
      const fitted = truncateToWidth(segment, safeWidth);
      if (!current) {
        current = fitted;
        continue;
      }

      const candidate = current + separator + fitted;
      if (visibleWidth(candidate) <= safeWidth) {
        current = candidate;
      } else {
        lines.push(truncateToWidth(current, safeWidth));
        current = fitted;
      }
    }

    if (current) lines.push(truncateToWidth(current, safeWidth));
    return lines;
  }

  function renderContextGauge(
    percentage: number,
    theme: any,
    used?: number,
    total?: number,
    options?: { barWidth?: number; includeCounts?: boolean }
  ): string {
    const barWidth = Math.max(4, options?.barWidth ?? CTX_GAUGE_WIDTH);
    const clamped = Math.max(0, Math.min(100, percentage));
    const filled = Math.round((clamped / 100) * barWidth);
    const empty = barWidth - filled;

    const bar = theme.fg("success", BAR_FILLED.repeat(filled)) + theme.fg("dim", BAR_EMPTY.repeat(empty));
    const counts = options?.includeCounts === false || used === undefined || !total ? "" : ` ${formatTokenCount(used)}/${formatTokenCount(total)}`;

    return theme.fg("dim", "ctx ") + bar + " " + theme.fg("dim", `${Math.round(clamped)}%${counts}`);
  }

  function getThinkingLevel(ctx: any): string {
    const context = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
    return context.thinkingLevel || "off";
  }

  function getContextInfo(ctx: any): { percentage: number; used: number; total: number } {
    const contextWindow = ctx.model?.contextWindow ?? 0;
    if (!contextWindow) return { percentage: 0, used: 0, total: 0 };

    const context = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
    const lastAssistant = context.messages
      .slice()
      .reverse()
      .find((message: any) => message.role === "assistant" && message.stopReason !== "aborted") as any;
    const usage = lastAssistant?.usage;
    if (!usage) return { percentage: 0, used: 0, total: contextWindow };

    const used = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    return { percentage: (used / contextWindow) * 100, used, total: contextWindow };
  }

  function refreshGitFooter(): void {
    if (refreshGitCache()) tuiRef?.requestRender();
  }

  pi.on("session_start", async (_event, ctx) => {
    refreshGitCache();
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      tuiRef = tui;
      const unsubscribe = footerData.onBranchChange(refreshGitFooter);

      return {
        dispose: () => {
          unsubscribe();
          tuiRef = null;
        },
        invalidate() {},
        render(width: number): string[] {
          const { percentage, used, total } = getContextInfo(ctx);
          const home = process.env.HOME || process.env.USERPROFILE;
          const cwd = home && ctx.cwd.startsWith(home) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;
          const separator = " " + theme.fg("dim", ">") + " ";

          let branch = "";
          if (showBranch && gitCache?.branch) {
            branch = theme.fg("muted", gitCache.branch);
          }

          const modelName = ctx.model?.id?.split("/").pop() || "no-model";
          const plainModel = theme.fg("muted", modelName);
          const thinkingLevel = ctx.model?.reasoning ? getThinkingLevel(ctx) : "off";
          const model = thinkingLevel === "off" ? plainModel : `${plainModel}${separator}${theme.fg("muted", thinkingLevel)}`;

          const cwdText = showCwd ? theme.fg("muted", cwd) : "";
          const locationVariants = [
            cwdText && branch ? cwdText + separator + branch : "",
            cwdText,
            branch,
          ].filter(Boolean) as string[];
          const location = locationVariants.length ? fitFooterSegment(width, locationVariants) : "";

          const contextGauge = fitFooterSegment(width, [
            renderContextGauge(percentage, theme, used, total, { barWidth: CTX_GAUGE_WIDTH, includeCounts: true }),
            renderContextGauge(percentage, theme, used, total, { barWidth: 10, includeCounts: false }),
            renderContextGauge(percentage, theme, used, total, { barWidth: 8, includeCounts: false }),
            renderContextGauge(percentage, theme, used, total, { barWidth: 6, includeCounts: false }),
            renderContextGauge(percentage, theme, used, total, { barWidth: 4, includeCounts: false }),
          ]);

          const footerLines = wrapFooterSegments([
            location,
            fitFooterSegment(width, model === plainModel ? [plainModel] : [model, plainModel]),
            contextGauge,
          ], width, separator).map((line) => truncateToWidth(line, width));

          return [...footerLines, ...Array(FOOTER_BOTTOM_PADDING_LINES).fill("")];
        },
      };
    });
  });

  pi.on("turn_end", refreshGitFooter);
  pi.on("model_select", () => tuiRef?.requestRender());
}
