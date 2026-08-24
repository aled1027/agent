/**
 * @georgedong32/pi-review — fan-out code review for Pi.
 *
 * Pipeline: eligibility → prep → parallel reviewers → gate → report.
 * See reference/pi-review-roadmap.md and reference/v0.2-plan.md.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";

import { parseReviewArgs } from "./src/cli-args.js";
import { ensureCodexTemplates } from "./src/codex-templates.js";
import { buildReviewDirective } from "./src/directive.js";
import { checkEligibility } from "./src/eligibility.js";
import { resolveReviewTarget } from "./src/git-input.js";
import { extractPrRef } from "./src/pr-ref.js";
import { ensureReviewPermissions } from "./src/review-permissions.js";
import { liteReviewer, resolveReviewers } from "./src/run.js";
import {
	configPath,
	DEFAULT_CONFIG,
	loadConfig,
	mergeWithDefaults,
	resolveModel,
	validateConfig,
	writeConfig,
} from "./src/config.js";
import type { ReviewTarget } from "./src/types.js";

function parentModelId(ctx: ExtensionCommandContext): string | undefined {
	const m = ctx.model;
	if (!m) return undefined;
	return `${m.provider}/${m.id}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("review", {
		description: "Foreground code review with pi-codex-subagents. --lite = single-agent.",
		getArgumentCompletions: (prefix: string) => {
			const trimmed = prefix.trimStart();
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const last = tokens[tokens.length - 1] ?? "";
			if (last.startsWith("--")) {
				return [
					{ value: "--lite", label: "--lite", description: "Fast single-agent review (no gate)" },
					{ value: "--gate-model", label: "--gate-model", description: "Request a gate model when Codex routing allows it" },
				].filter((o) => o.value.startsWith(last));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const notify = (msg: string, level: "info" | "warning" | "error" = "info") => {
				if (ctx.hasUI) ctx.ui.notify(msg, level);
				else console.log(`pi-review: ${msg}`);
			};

			try {
				const parsed = parseReviewArgs(args);
				const { config } = loadConfig();
				const parentModel = parentModelId(ctx);

				let target: ReviewTarget | null = null;
				try {
					target = await resolveReviewTarget(ctx.cwd, { input: parsed.input });
				} catch (err) {
					notify(err instanceof Error ? err.message : String(err), "warning");
					return;
				}
				if (!target) {
					notify("Not in a git repo and no PR/url given — nothing to review.", "info");
					return;
				}

				const eligibility = checkEligibility({
					target,
					hasExplicitInput: Boolean(parsed.input && extractPrRef(parsed.input)),
					isGitRepo: true,
					probedDiff: null,
				});
				if (eligibility.eligible === false) {
					notify(eligibility.reason, "info");
					return;
				}

				const reviewers = parsed.lite
					? [liteReviewer(parentModel)]
					: resolveReviewers(config, [], parentModel);
				if (reviewers.length === 0) {
					notify("No enabled reviewers. Edit config via /review-config.", "warning");
					return;
				}
				const gateModel = resolveModel(parsed.gateModel ?? config.gate.model, parentModel);

				// Merge CC-aligned allow rules so headless reviewers are not blocked.
				try {
					const perm = ensureReviewPermissions(ctx.cwd);
					if (perm.added.length > 0) {
						notify(`pi-review: added ${perm.added.length} permission allow rule(s) for review tools.`, "info");
					}
				} catch (err) {
					notify(
						`pi-review: could not update permissions.local.json (${err instanceof Error ? err.message : String(err)})`,
						"warning",
					);
				}

				const createdTemplates = ensureCodexTemplates();
				if (createdTemplates.length > 0) {
					notify(`pi-review: installed ${createdTemplates.length} pi-codex-subagents template(s).`, "info");
				}

				const directive = buildReviewDirective({
					target,
					reviewers,
					gateModel,
					gateThinking: config.gate.thinking,
					threshold: config.gate.threshold,
					lite: parsed.lite,
					cwd: ctx.cwd,
				});

				// Dry-run: show the directive instead of injecting it.
				if (parsed.noSpawn) {
					pi.sendMessage({ customType: "pi-review", content: directive, display: true });
					return;
				}

				// a) Visible echo of the user's command. Extension commands don't
				//    otherwise appear in chat, so surface it as a one-liner. This
				//    does NOT trigger a turn — it just shows `/review <prompt>`.
				pi.sendMessage({
					customType: "pi-review",
					content: parsed.input ? `/review ${parsed.input}` : "/review",
					display: true,
				});
				// b) Hidden directive — the main agent executes it as a user turn
				//    (display:false hides the full text; triggerTurn starts it).
				//    The main agent fans out reviewers with pi-codex-subagents.
				pi.sendMessage(
					{ customType: "pi-review-directive", content: directive, display: false },
					{ triggerTurn: true },
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				notify(`pi-review failed: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("review-config", {
		description: "Edit pi-review config (~/.pi/agent/pi-review.json)",
		handler: async (_args, ctx) => {
			const path = configPath();
			if (!existsSync(path)) {
				writeConfig(DEFAULT_CONFIG);
			}

			let raw: string;
			if (ctx.hasUI) {
				const current = readFileSync(path, "utf-8");
				const edited = await ctx.ui.editor("Edit pi-review config (JSON)", current);
				if (edited === undefined) {
					ctx.ui.notify("Config edit cancelled.", "info");
					return;
				}
				raw = edited;
			} else {
				const editor = process.env.VISUAL ?? process.env.EDITOR;
				if (!editor) {
					ctx.ui.notify(`Set $EDITOR or use TUI. Config path: ${path}`, "warning");
					return;
				}
				await pi.exec(editor, [path], { cwd: ctx.cwd });
				raw = readFileSync(path, "utf-8");
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				ctx.ui.notify("Invalid JSON — config not saved.", "error");
				return;
			}

			const merged = mergeWithDefaults(parsed);
			const validation = validateConfig(merged);
			if (validation.ok === false) {
				ctx.ui.notify(`Config errors: ${validation.errors.join("; ")}`, "error");
				return;
			}
			writeConfig(merged);
			ctx.ui.notify("pi-review config saved.", "info");
		},
	});

	pi.registerCommand("review-agents", {
		description: "List bundled reviewers and resolved models",
		handler: async (_args, ctx) => {
			const { config } = loadConfig();
			const parent = parentModelId(ctx);
			const lines: string[] = ["## pi-review agents", ""];
			for (const r of Object.values(config.reviewers)) {
				const model = resolveModel(r.model, parent);
				const tools = (r.tools ?? config.inheritance.toolsDefault).join(", ");
				const status = r.enabled ? "enabled" : "disabled";
				lines.push(`- **${r.id}** (${r.label}) — ${status}`);
				lines.push(`  - model: ${model}`);
				lines.push(`  - thinking: ${r.thinking ?? "default"}`);
				lines.push(`  - tools: ${tools}`);
			}
			lines.push("");
			lines.push(`Gate: ${resolveModel(config.gate.model, parent)} · threshold ${config.gate.threshold}`);
			const body = lines.join("\n");
			pi.sendMessage({ customType: "pi-review-agents", content: body, display: true });
		},
	});
}
