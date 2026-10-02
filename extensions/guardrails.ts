// Slim fork of @aliou/pi-guardrails 0.19.0, default config only:
// - asks before dangerous bash commands (auto-denies after 30s)
// - blocks access to secret files (.env and friends) when they exist
import { globSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { parse } from "@aliou/sh";
import {
	type ExtensionAPI,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";

const TIMEOUT_MS = 30_000;

const NOT_APPROVED =
	"Not approved: the user denied this command or didn't respond within 30 seconds. " +
	"Don't retry it. Either reach the goal with a command that doesn't need approval, " +
	"or add a TODO naming the exact command and why it's needed so the user can run it later. " +
	"Then continue with the rest of the task.";

// ---------- AST helpers ----------

type Part = { type: string; value?: string; parts?: Part[] };
type Word = { parts: Part[] };
type AstNode = {
	type?: string;
	words?: Word[];
	op?: string;
	fd?: string;
	target?: Word;
};

// Unresolvable expansions ($VAR, $(...)) become "\0".
const partText = (p: Part): string =>
	p.type === "Literal" || p.type === "SglQuoted"
		? (p.value ?? "")
		: p.type === "DblQuoted"
			? (p.parts ?? []).map(partText).join("")
			: "\0";
const wordText = (w: Word) => w.parts.map(partText).join("");

// Generic walk also reaches commands nested in $(...), subshells, loops, etc.
function* walk(n: unknown): Generator<AstNode> {
	if (Array.isArray(n)) for (const x of n) yield* walk(x);
	else if (n && typeof n === "object") {
		yield n as AstNode;
		for (const v of Object.values(n)) yield* walk(v);
	}
}

function tryParse(command: string) {
	try {
		return [...walk(parse(command).ast)];
	} catch {
		return null;
	}
}

// ---------- Dangerous commands ----------

const shortFlag = (w: string[], f: string) =>
	w.some((x) => x.startsWith("-") && !x.startsWith("--") && x.includes(f));
const longFlag = (w: string[], f: string) => w.includes(`--${f}`);
const recursive = (w: string[]) =>
	shortFlag(w, "R") || longFlag(w, "recursive");

const BY_NAME: Record<string, string> = {
	sudo: "superuser command",
	doas: "privileged command execution",
	pkexec: "privileged command execution",
	shred: "secure file overwrite",
	wipefs: "filesystem signature wipe",
	blkdiscard: "block device discard",
	fdisk: "disk partitioning",
	sfdisk: "disk partitioning",
	cfdisk: "disk partitioning",
	parted: "disk partitioning",
	sgdisk: "disk partitioning",
};

const CONTAINER_FLAGS: Array<[(w: string) => boolean, string]> = [
	[(w) => w.startsWith("--privileged"), "privileged mode"],
	[(w) => /^--(pid|network|userns|uts|ipc)=host/.test(w), "host namespace"],
	[
		(w) => /^(-v\/:|--volume=\/:|--mount=type=bind,source=\/,)/.test(w),
		"root filesystem mount",
	],
	[(w) => /\/(docker|podman)\.sock/.test(w), "docker socket access"],
];

function matchWords(w: string[]): string | undefined {
	const cmd = basename(w[0] ?? "");
	if (BY_NAME[cmd]) return BY_NAME[cmd];
	if (cmd === "rm") {
		const r = shortFlag(w, "r") || recursive(w) || longFlag(w, "dir");
		const f = shortFlag(w, "f") || longFlag(w, "force");
		return r && f ? "recursive force delete" : undefined;
	}
	if (cmd === "dd" && w.some((x) => x.startsWith("of=")))
		return "disk write operation";
	if (cmd === "mkfs" || cmd.startsWith("mkfs.")) return "filesystem format";
	if (
		cmd === "chmod" &&
		recursive(w) &&
		w.some((x) => ["777", "0777", "1777", "7777", "a+rwx", "ugo+rwx"].includes(x))
	)
		return "insecure recursive permissions";
	if (cmd === "chown" && recursive(w)) return "recursive ownership change";
	if ((cmd === "docker" || cmd === "podman") && ["run", "create"].includes(w[1])) {
		for (const [test, what] of CONTAINER_FLAGS)
			if (w.some(test)) return `container with ${what}`;
	}
	return undefined;
}

// Used only when the shell parser fails.
const FALLBACK = [
	"rm -rf", "sudo", "dd of=", "mkfs.", "chmod -R 777", "chown -R", "doas",
	"pkexec", "shred", "wipefs", "blkdiscard", "fdisk", "parted",
	"docker run --privileged",
];

export function dangerReason(command: string): string | undefined {
	const nodes = tryParse(command);
	if (!nodes) {
		const hit = FALLBACK.find((p) => command.includes(p));
		return hit && `matches "${hit}"`;
	}
	for (const n of nodes) {
		if (n.type !== "SimpleCommand") continue;
		const reason = matchWords((n.words ?? []).map(wordText));
		if (reason) return reason;
	}
	return undefined;
}

// ---------- Secret files ----------

const SECRET_NAMES = new Set([
	".env", ".env.local", ".env.production", ".env.prod", ".dev.vars",
]);
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const NO_FILE_ARGS = new Set(["echo", "printf", "tr"]);

const expandHome = (p: string) =>
	p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p;

function exists(p: string, cwd: string) {
	try {
		statSync(resolve(cwd, expandHome(p)));
		return true;
	} catch {
		return false;
	}
}

function globbed(p: string, cwd: string): string[] {
	if (!/[*?[]/.test(p)) return [p];
	try {
		const hits = globSync(expandHome(p), { cwd });
		return hits.length ? hits : [p];
	} catch {
		return [p];
	}
}

/** Returns a protected path the tool call would touch, if any. */
export function secretTarget(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
): string | undefined {
	const candidates: string[] = [];
	if (PATH_TOOLS.has(toolName)) {
		candidates.push(String(input.file_path ?? input.path ?? "").trim());
	} else if (toolName === "bash") {
		const command = String(input.command ?? "");
		const nodes = tryParse(command);
		if (!nodes) {
			candidates.push(...command.split(/[\s"'`<>|;&()]+/));
		} else {
			for (const n of nodes) {
				if (n.type === "SimpleCommand" && n.words?.length) {
					if (!NO_FILE_ARGS.has(basename(wordText(n.words[0]))))
						candidates.push(...n.words.slice(1).map(wordText));
				} else if (n.type === "Redirect" && n.target) {
					const t = wordText(n.target);
					const fdDup = n.op === "<&" || (n.op === ">&" && (n.fd !== undefined || /^(-|\d+)$/.test(t)));
					const heredoc = n.op === "<<" || n.op === "<<-" || n.op === "<<<";
					if (!fdDup && !heredoc) candidates.push(t);
				}
			}
		}
	}
	for (const c of candidates) {
		if (!c || c.startsWith("-")) continue;
		const unresolved = c.includes("\0");
		for (const p of unresolved ? [c] : globbed(c, cwd)) {
			if (!SECRET_NAMES.has(basename(p))) continue;
			// Unresolved paths can't be proven missing, so block them.
			if (unresolved || exists(p, cwd)) return p.replaceAll("\0", "$…");
		}
	}
	return undefined;
}

// ---------- Extension ----------

export default function guardrails(pi: ExtensionAPI) {
	const allowedThisSession = new Set<string>();

	pi.on("tool_call", async (event, ctx) => {
		const secret = secretTarget(
			event.toolName,
			event.input as Record<string, unknown>,
			ctx.cwd,
		);
		if (secret) {
			return {
				block: true,
				reason:
					`Accessing ${secret} is not allowed. This file contains secrets. ` +
					"Explain to the user why you want to access this file, and if changes are needed ask the user to make them.",
			};
		}

		if (!isToolCallEventType("bash", event)) return;
		const command = event.input.command;
		if (allowedThisSession.has(command)) return;
		const danger = dangerReason(command);
		if (!danger) return;
		const notApproved =
			danger === "recursive force delete"
				? `${NOT_APPROVED} To delete files, use \`trash <paths>\` instead. It moves them to the macOS Trash so they can be recovered, and it doesn't need approval. For temporary files under /tmp, plain \`rm\` without -rf is fine.`
				: NOT_APPROVED;
		if (!ctx.hasUI) return { block: true, reason: `${danger}. ${notApproved}` };

		pi.events.emit("herdr:blocked", {
			active: true,
			label: "Guardrails approval required",
		});
		let choice: string | undefined;
		try {
			choice = await ctx.ui.select(
				`Dangerous command (${danger}):\n\n${command}`,
				["Allow once", "Allow for session", "Deny", "Deny and stop"],
				{ timeout: TIMEOUT_MS },
			);
		} finally {
			pi.events.emit("herdr:blocked", { active: false });
		}

		if (choice === "Allow once") return;
		if (choice === "Allow for session") {
			allowedThisSession.add(command);
			return;
		}
		if (choice === "Deny and stop") {
			ctx.abort();
			return { block: true, reason: "User denied and stopped the dangerous command." };
		}
		return { block: true, reason: notApproved };
	});
}
