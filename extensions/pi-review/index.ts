/**
 * @georgedong32/pi-review — fan-out code review for Pi.
 *
 * Pipeline: eligibility → prep → parallel reviewers → gate → report.
 * See reference/pi-review-roadmap.md and reference/v0.2-plan.md.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "typebox";

import { parseReviewArgs } from "./src/cli-args.js";
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

function parentModelId(ctx: ExtensionContext): string | undefined {
	const m = ctx.model;
	if (!m) return undefined;
	return `${m.provider}/${m.id}`;
}

type Notify = (msg: string, level?: "info" | "warning" | "error") => void;
type Prepared =
	| { directive: string; input?: string; noSpawn: boolean }
	| { message: string; level: "info" | "warning" };

/** Shared by the /review command and the review tool: parse args, resolve target and reviewers, build the directive. */
async function prepareReview(args: string, ctx: ExtensionContext, notify: Notify): Promise<Prepared> {
	const parsed = parseReviewArgs(args);
	const { config } = loadConfig();
	const parentModel = parentModelId(ctx);
	const cwd = parsed.repo ? resolve(ctx.cwd, parsed.repo) : ctx.cwd;
	if (!existsSync(cwd)) {
		return { message: `--repo path not found: ${cwd}`, level: "warning" };
	}

	let target: ReviewTarget | null = null;
	try {
		target = await resolveReviewTarget(cwd, { input: parsed.input });
	} catch (err) {
		return { message: err instanceof Error ? err.message : String(err), level: "warning" };
	}
	if (!target) {
		return {
			message: `${cwd} is not a git repo and no PR/url given — nothing to review. Use --repo <path> to pick a repo.`,
			level: "info",
		};
	}

	const eligibility = checkEligibility({
		target,
		hasExplicitInput: Boolean(parsed.input && extractPrRef(parsed.input)),
		isGitRepo: true,
		probedDiff: null,
	});
	if (eligibility.eligible === false) {
		return { message: eligibility.reason, level: "info" };
	}

	const reviewers = parsed.lite ? [liteReviewer(parentModel)] : resolveReviewers(config, [], parentModel);
	if (reviewers.length === 0) {
		return { message: "No enabled reviewers. Edit config via /review-config.", level: "warning" };
	}
	const gateModel = resolveModel(parsed.gateModel ?? config.gate.model, parentModel);

	// Merge CC-aligned allow rules so headless reviewers are not blocked.
	try {
		const perm = ensureReviewPermissions(cwd);
		if (perm.added.length > 0) {
			notify(`pi-review: added ${perm.added.length} permission allow rule(s) for review tools.`, "info");
		}
	} catch (err) {
		notify(
			`pi-review: could not update permissions.local.json (${err instanceof Error ? err.message : String(err)})`,
			"warning",
		);
	}

	const directive = buildReviewDirective({
		target,
		reviewers,
		gateModel,
		gateThinking: config.gate.thinking,
		parentModel,
		inheritance: config.inheritance,
		threshold: config.gate.threshold,
		lite: parsed.lite,
		cwd,
	});
	return { directive, input: parsed.input, noSpawn: parsed.noSpawn };
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("review", {
		description: "Foreground code review with pi-subagent. --lite = single-agent.",
		getArgumentCompletions: (prefix: string) => {
			const trimmed = prefix.trimStart();
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const last = tokens[tokens.length - 1] ?? "";
			if (last.startsWith("--")) {
				return [
					{ value: "--lite", label: "--lite", description: "Fast single-agent review (no gate)" },
					{ value: "--repo", label: "--repo", description: "Review the git repo at this path" },
					{ value: "--gate-model", label: "--gate-model", description: "Run the gate on this model (provider/id)" },
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
				const prepared = await prepareReview(args, ctx, notify);
				if ("message" in prepared) {
					notify(prepared.message, prepared.level);
					return;
				}
				const { directive, input } = prepared;

				// Dry-run: show the directive instead of injecting it.
				if (prepared.noSpawn) {
					pi.sendMessage({ customType: "pi-review", content: directive, display: true });
					return;
				}

				// a) Visible echo of the user's command. Extension commands don't
				//    otherwise appear in chat, so surface it as a one-liner. This
				//    does NOT trigger a turn — it just shows `/review <prompt>`.
				pi.sendMessage({
					customType: "pi-review",
					content: input ? `/review ${input}` : "/review",
					display: true,
				});
				// b) Hidden directive — the main agent executes it as a user turn
				//    (display:false hides the full text; triggerTurn starts it).
				//    The main agent fans out reviewers with the `subagent` CLI.
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

	pi.registerTool({
		name: "review",
		label: "Review",
		description:
			"Start a pi-review code review (same as the /review command). Returns step-by-step instructions you must then carry out: get the diff, fan out reviewer subagents, run the gate, and report findings.",
		promptSnippet: "Run a code review of local changes or a PR (same as /review)",
		promptGuidelines: [
			"Use the review tool only when the user asks for a code review; full reviews are slow and costly.",
		],
		parameters: Type.Object({
			args: Type.Optional(
				Type.String({
					description:
						"Same as /review arguments: optional PR URL or number, review focus text, --lite for a fast single-reviewer pass, and --repo <path> to review a git repo other than the session cwd. Empty reviews local git changes.",
				}),
			),
		}),
		async execute(_id, { args }, _signal, _update, ctx) {
			const notify: Notify = (msg, level = "info") => {
				if (ctx.hasUI) ctx.ui.notify(msg, level);
			};
			const prepared = await prepareReview(args ?? "", ctx, notify);
			if ("message" in prepared) throw new Error(prepared.message);
			return { content: [{ type: "text", text: prepared.directive }], details: {} };
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
