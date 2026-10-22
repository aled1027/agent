/**
 * pi-review for Pi Pocket: a `pi_review` tool that fans out reviewer subagents with Pocket's `subagent` tool, then a gate.
 *
 * Port of the Pi CLI extension in ~/.pi/agent/extensions/pi-review. It reuses that extension's reviewer roles
 * (agents/*.md), diff script, and argument parser, and reads the same config (~/.pi/agent/pi-review.json). The CLI
 * version drives the `subagent` CLI through tmux; this one tells Pi to use Pocket's built-in `subagent` tool.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

export const pocketApi = 2;

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const CLI_DIR = join(AGENT_DIR, "extensions", "pi-review");
const CONFIG_PATH = join(AGENT_DIR, "pi-review.json");

// Helpers shared with the CLI extension. They have no imports of their own, so Node can load them as they are.
const cli = (file: string) => import(pathToFileURL(join(CLI_DIR, "src", file)).href);
const { buildObtainDiffScript, q } = await cli("obtain-diff.ts");
const { extractPrRef } = await cli("pr-ref.ts");
const { parseReviewArgs } = await cli("cli-args.ts");

type Reviewer = { id: string; label: string; enabled: boolean; model?: string; thinking?: string; tools?: string[] };
type Config = {
    gate: { model: string; thinking?: string; enabled: boolean; threshold: number };
    reviewers: Record<string, Reviewer>;
    inheritance: { toolsDefault: string[] };
};

const DEFAULT_REVIEWERS = ["claude-md-compliance", "bugbot", "history-context", "security-review", "code-comments"];

function loadConfig(): Config {
    const config: Config = {
        gate: { model: "inherit", thinking: "low", enabled: true, threshold: 8 },
        reviewers: Object.fromEntries(DEFAULT_REVIEWERS.map((id) => [id, { id, label: id, enabled: true, model: "inherit" }])),
        inheritance: { toolsDefault: ["read", "bash"] },
    };
    if (!existsSync(CONFIG_PATH)) return config;
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (raw.gate) Object.assign(config.gate, raw.gate);
    if (raw.reviewers) config.reviewers = raw.reviewers;
    if (raw.inheritance?.toolsDefault) config.inheritance.toolsDefault = raw.inheritance.toolsDefault;
    return config;
}

/** Pocket has no grep, find, or ls tool: bash covers them. */
function pocketTools(tools: string[]): string[] {
    return [...new Set(tools.map((t) => (t === "read" ? "read" : "bash")))];
}

/** A role's instructions without the frontmatter. */
function roleBody(id: string): string {
    const source = readFileSync(join(CLI_DIR, "agents", `${id}.md`), "utf8");
    if (!source.startsWith("---\n")) return source.trim();
    const end = source.indexOf("\n---", 4);
    return (end === -1 ? source : source.slice(end + 4)).trim();
}

const FALSE_POSITIVES =
    "Pre-existing issues on lines the author did not modify; pedantic nitpicks a senior engineer would not call out; " +
    "issues a linter, typechecker, or CI would catch; generic quality (missing tests/docs) unless a project rule " +
    "requires it; something that looks like a bug but is intentional given the change";

function inGitRepo(dir: string): boolean {
    for (let d = dir; ; d = dirname(d)) {
        if (existsSync(join(d, ".git"))) return true;
        if (dirname(d) === d) return false;
    }
}

type Plan = { directive: string } | { message: string };

function plan(args: string, sessionCwd: string, runKey: string, allowedModels: readonly string[]): Plan {
    const parsed = parseReviewArgs(args);
    const cwd = parsed.repo ? resolve(sessionCwd, parsed.repo) : sessionCwd;
    if (!existsSync(cwd)) return { message: `--repo path not found: ${cwd}` };
    const prRef: string | null = parsed.input ? extractPrRef(parsed.input) : null;
    if (!prRef && !inGitRepo(cwd)) {
        return { message: `${cwd} is not in a git repo and no PR was given. Use --repo <path>.` };
    }

    const config = loadConfig();
    const reviewers: Reviewer[] = parsed.lite
        ? [{ id: "lite-review", label: "Lite Review", enabled: true, thinking: "medium", tools: ["read", "bash"] }]
        : Object.values(config.reviewers).filter((r) => r.enabled);
    if (reviewers.length === 0) return { message: `No enabled reviewers in ${CONFIG_PATH}.` };
    const gate = !parsed.lite && config.gate.enabled;

    const run = createHash("sha256").update(runKey).digest("hex").slice(0, 6);
    const dir = join(tmpdir(), "pi-review", run);
    mkdirSync(dir, { recursive: true });
    const diff = join(dir, "change.diff");
    const files = join(dir, "changed-files.txt");
    const kind = join(dir, "change-kind.txt");
    const findings = join(dir, "reviewer-findings.md");
    const context = parsed.input?.trim();
    const notes: string[] = [];

    /** The spawn arguments for one child, as JSON for the `subagent` tool. */
    const spawn = (name: string, file: string, tools: string[], model?: string, thinking?: string) => {
        const call: Record<string, unknown> = {
            action: "spawn",
            name,
            message: `Read ${file} and follow it exactly. Your final reply must be only the JSON it asks for.`,
            tools: pocketTools(tools),
        };
        if (model && model !== "inherit") {
            if (allowedModels.includes(model)) call.model = model;
            else notes.push(`${name}: ${model} is not allowed for subagents, so it runs on this session's model.`);
        }
        if (thinking) call.thinking = thinking;
        return JSON.stringify(call);
    };

    const reviewerCalls = reviewers.map((r) => {
        const file = join(dir, `${r.id}.md`);
        const task = [
            roleBody(r.id),
            "",
            "## Assigned task",
            `Read ${diff} as the change (the only diff source: do not re-fetch it with gh or git).`,
            `Also read ${files} (changed paths) and ${kind} (docs|code). The repository is ${cwd}.`,
            "Stay within the role's scope. Return your findings as JSON in your final reply and stop.",
            "Do not read node_modules or other agents' transcripts. Do not change any file.",
            ...(context ? [`User request: ${context}`] : []),
        ];
        writeFileSync(file, `${task.join("\n")}\n`);
        return spawn(`review-${r.id}-${run}`, file, r.tools ?? config.inheritance.toolsDefault, r.model, r.thinking);
    });

    const gateFile = join(dir, "gate.md");
    if (gate) {
        const threshold = config.gate.threshold;
        const task = [
            roleBody("gate"),
            "",
            "## Assigned task",
            `Synthesize reviewer findings for the change in ${cwd}${prRef ? ` (PR ${prRef})` : ""}.`,
            `Threshold: ${threshold} (drop issues with confidence < ${threshold}).`,
            `Reviewer findings are in ${findings} (one section per reviewer). Parse each section's JSON.`,
            "If a block fails to parse or the reviewer is FAILED, skip it and note it.",
            "Dedupe by (file, line, category), re-score 1–10, and return surviving issues + verdict.",
            `Skip false positives: ${FALSE_POSITIVES}.`,
        ];
        writeFileSync(gateFile, `${task.join("\n")}\n`);
    }

    const script = buildObtainDiffScript({ cwd, diffPath: diff, filesPath: files, kindPath: kind, metaPath: join(dir, "diff-meta.txt"), prRef: prRef ?? undefined })
        // The CLI keeps run files in the repo; here they live in the run folder, so the repo stays clean.
        .replace(`mkdir -p ${q(`${cwd}/.pi/pi-review`)}\n`, "")
        .concat(`\ntest -s ${q(diff)} || { echo "EMPTY DIFF: nothing to review"; exit 1; }`);
    const names = reviewers.map((r) => `review-${r.id}-${run}`);
    const b: string[] = [];
    b.push(`# Code review (${prRef ? `PR ${prRef}` : `local changes in ${cwd}`})`, "");
    if (context) b.push(`**User request:** ${context}`, "");
    b.push(`Obtain the diff once, fan out ${reviewers.length} reviewer subagent(s)${gate ? ", then run one gate" : ""}, then write the report.`, "");
    if (notes.length) b.push(...notes.map((n) => `Note: ${n}`), "");
    b.push("## Hard rules", "");
    b.push("- Orchestrate reviewers only with the `subagent` tool, with the exact arguments below. Do not edit the prompt files.");
    b.push("- Spawn every reviewer once, all together (parallel tool calls, or one codemode script with Promise.allSettled), before you wait.");
    b.push("- Do not poll with `status`. Each answer arrives as a \"[subagent <name> answered\" message at your next pause. If you have nothing else to do, end your turn with \"Waiting for reviewers.\"");
    b.push("- Do not retry or re-spawn a failed reviewer: report it as failed.");
    b.push("- Do not read or summarize the diff body yourself.");
    b.push("", `**Skip these false positives:** ${FALSE_POSITIVES}.`, "");
    b.push("First, post this checklist in chat, and tick each item as you finish it:", "");
    b.push("- [ ] Obtain the diff", `- [ ] Spawn and collect ${reviewers.length} reviewer(s)`);
    if (gate) b.push("- [ ] Run the gate");
    b.push("- [ ] Write the report", "");
    b.push("## Step 1: Obtain the change", "", "Run this with bash. If it prints EMPTY DIFF, tell the user there is nothing to review and stop.", "```bash", script, "```", "");
    b.push("## Step 2: Spawn and collect reviewers", "", "Call the `subagent` tool with each of these argument sets:", "```json", ...reviewerCalls, "```");
    b.push(`Then wait for the answers from: ${names.join(", ")}. Treat each answer as that reviewer's JSON.`, "");
    if (gate) {
        b.push("## Step 3: Gate", "");
        b.push(`Write the reviewer answers verbatim to \`${findings}\`, one \`## <reviewer id>\` section each (\`FAILED: <error>\` for failed reviewers). Then call \`subagent\` with:`);
        b.push("```json", spawn(`review-gate-${run}`, gateFile, ["read"], config.gate.model, config.gate.thinking), "```");
        b.push("Wait for its answer. If the gate fails or its JSON is malformed, report the reviewer findings without a gate verdict.", "");
    }
    b.push(`## Step ${gate ? 4 : 3}: Report`, "");
    b.push("Use only the answers collected above. Write markdown in chat:", "");
    b.push("- **Verdict**: `request_changes` if any blocker or 3 or more major; `approve` if no blocker and no major; otherwise `comment`.");
    b.push("- Group findings by reviewer: `[SEVERITY · category · conf N] file:line — evidence`.");
    b.push(gate ? "- Add a short gate summary: verdict, reason, surviving issue count." : "- Lite mode has no gate: apply the verdict rule directly.");
    b.push("- For a failed reviewer, give its error instead of findings.", `- Run files are in \`${dir}\`.`);
    const directive = b.join("\n");
    return { directive: parsed.noSpawn ? `DRY RUN: show this plan to the user and do not run it.\n\n${directive}` : directive };
}

export default function createPiReview(host: { subagentModels(): readonly string[] }) {
    const review = defineTool({
        name: "pi_review",
        description:
            "Start a pi-review code review of local git changes or a GitHub PR. Returns step-by-step instructions you must then carry out: get the diff, fan out reviewer subagents with the subagent tool, run the gate, and report. Use it only when the user asks for a code review: a full review is slow and costly.",
        parameters: Type.Object({
            args: Type.Optional(
                Type.String({
                    description:
                        "Optional: a PR URL or number, review focus text, --lite for one fast reviewer and no gate, --repo <path> to review another git repo, --no-spawn for a dry run. Empty reviews local git changes.",
                }),
            ),
        }),
        // It only writes prompt files under a key fixed for this call, so a second run writes the same files.
        replay: "safe",
        execute: async (args, api, context) => {
            const { cwd } = await api.agent(context);
            const result = plan(args.args ?? "", cwd, `${api.taskId}:${api.callId}`, host.subagentModels());
            if ("message" in result) throw new Error(result.message);
            return { output: [{ type: "text" as const, text: result.directive }] };
        },
    });

    return defineExtension({ name: "pi-review", tools: [review] });
}
