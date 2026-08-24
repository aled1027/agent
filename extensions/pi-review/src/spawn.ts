/**
 * Subagent process spawn + structured-output read.
 *
 * This is retained for the legacy direct-process path.
 *
 * The caller passes pre-built CLI args + env (see src/args.ts). We spawn
 * `pi` with stdio piped, wait for exit (with a hard timeout), then read the
 * structured-output JSON file the child should have written, and validate it.
 *
 * Tests inject a fake `spawnImpl` so we never actually start a real `pi`
 * process during unit tests.
 */
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TSchema } from "typebox";
import { toJsonSchema } from "./schema.js";

/** Shape of the result returned by `runSubagent`. */
export interface SpawnResult {
	ok: boolean;
	/** Validated JSON payload from the child's structured output. */
	value?: unknown;
	/** Reason for failure: timeout, non-zero exit, missing/invalid output, etc. */
	error?: string;
	exitCode?: number | null;
	durationMs: number;
	/** Last N bytes of stderr for diagnostics. */
	stderrTail?: string;
}

/** Options passed to `runSubagent`. */
export interface SpawnOptions {
	/** Pre-built CLI args (positional task text is the last element). */
	args: string[];
	/** Extra env vars to add to the child environment. */
	env: Record<string, string>;
	/** Working directory. */
	cwd: string;
	/** Hard timeout in ms. Defaults to 180_000 (3 min). */
	timeoutMs?: number;
	/** JSON schema the child is expected to write to outputPath. */
	schema: TSchema;
	/** Path the child should write its structured output to. */
	outputPath: string;
	/** Path to the JSON-Schema file the child reads to know what to write. */
	schemaPath: string;
}

/** Minimal ChildProcess surface the spawn impl needs. */
export type SpawnHandle = {
	stdout: ChildProcess["stdout"];
	stderr: ChildProcess["stderr"];
	pid?: number;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): SpawnHandle;
	on(event: "error", listener: (err: Error) => void): SpawnHandle;
	on(event: string, listener: (...args: unknown[]) => void): SpawnHandle;
	kill(signal?: NodeJS.Signals): boolean;
};

/** A swappable implementation of child_process.spawn. */
export type SpawnImpl = (
	cmd: string,
	args: string[],
	opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: StdioOptions },
) => SpawnHandle;

let _spawnImpl: SpawnImpl = (cmd, args, opts) =>
	spawn(cmd, args, opts) as unknown as SpawnHandle;

/** Override the spawn implementation. Tests use this. */
export function setSpawnImpl(impl: SpawnImpl): void {
	_spawnImpl = impl;
}

/** Reset the spawn implementation to the real child_process.spawn. */
export function resetSpawnImpl(): void {
	_spawnImpl = (cmd, args, opts) => spawn(cmd, args, opts) as unknown as SpawnHandle;
}

/**
 * Create a tmp dir for a schema + output pair. The caller owns the lifetime;
 * we just return the paths.
 */
export function createRuntimeDir(prefix = "pi-review-structured-"): { dir: string; schemaPath: string; outputPath: string } {
	const dir = join(tmpdir(), `${prefix}${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	const schemaPath = join(dir, "schema.json");
	const outputPath = join(dir, "output.json");
	return { dir, schemaPath, outputPath };
}

/**
 * Validate a value against a TypeBox schema. TypeBox schemas are themselves
 * JSON Schema compatible, so we walk the JSON shape directly. We avoid
 * `TypeCompiler` to keep startup cost minimal.
 */
export function validateValue(schema: TSchema, value: unknown): { ok: true; value: unknown } | { ok: false; errors: string[] } {
	const json = schema as unknown as Record<string, unknown>;
	const errors = checkAgainstJsonSchema(value, json);
	return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

function checkAgainstJsonSchema(value: unknown, schema: Record<string, unknown>, path = "$"): string[] {
	const errors: string[] = [];
	const t = schema.type;

	// Handle anyOf/oneOf — accept if at least one branch fully matches.
	if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
		const branches = ((schema.anyOf ?? schema.oneOf) as Record<string, unknown>[]);
		let matched = false;
		const allBranchErrors: string[] = [];
		for (const branch of branches) {
			const branchErrors = checkAgainstJsonSchema(value, branch, path);
			if (branchErrors.length === 0) {
				matched = true;
				break;
			}
			allBranchErrors.push(...branchErrors);
		}
		if (!matched) errors.push(...allBranchErrors);
		return errors;
	}

	// Handle const (Type.Literal — "approve" / "request_changes" / category enums).
	if ("const" in schema) {
		if (value !== schema.const) {
			errors.push(`${path}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
		}
		return errors;
	}

	// Handle enum (older JSON Schema style some TypeBox versions use).
	if (Array.isArray(schema.enum)) {
		const allowed = schema.enum as unknown[];
		if (!allowed.includes(value)) {
			errors.push(`${path}: expected one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}, got ${JSON.stringify(value)}`);
		}
		return errors;
	}

	if (t === "object") {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			errors.push(`${path}: expected object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`);
			return errors;
		}
		const obj = value as Record<string, unknown>;
		const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
		const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
		const additional = (schema.additionalProperties ?? true) as boolean;
		for (const key of required) {
			if (!(key in obj)) errors.push(`${path}.${key}: required`);
		}
		if (additional === false) {
			for (const key of Object.keys(obj)) {
				if (!(key in properties)) {
					errors.push(`${path}.${key}: not allowed (additionalProperties=false)`);
				}
			}
		}
		for (const [key, propSchema] of Object.entries(properties)) {
			if (key in obj) {
				errors.push(...checkAgainstJsonSchema(obj[key], propSchema, `${path}.${key}`));
			}
		}
	} else if (t === "array") {
		if (!Array.isArray(value)) {
			errors.push(`${path}: expected array, got ${typeof value}`);
			return errors;
		}
		const items = schema.items as Record<string, unknown> | undefined;
		const max = typeof schema.maxItems === "number" ? (schema.maxItems as number) : undefined;
		if (max !== undefined && value.length > max) {
			errors.push(`${path}: array length ${value.length} > maxItems ${max}`);
		}
		if (items) {
			value.forEach((item, i) => {
				errors.push(...checkAgainstJsonSchema(item, items, `${path}[${i}]`));
			});
		}
	} else if (t === "string") {
		if (typeof value !== "string") {
			errors.push(`${path}: expected string, got ${typeof value}`);
			return errors;
		}
		const min = typeof schema.minLength === "number" ? (schema.minLength as number) : undefined;
		const max = typeof schema.maxLength === "number" ? (schema.maxLength as number) : undefined;
		if (min !== undefined && value.length < min) errors.push(`${path}: string too short (<${min})`);
		if (max !== undefined && value.length > max) errors.push(`${path}: string too long (>${max})`);
	} else if (t === "integer" || t === "number") {
		if (typeof value !== "number" || Number.isNaN(value)) {
			errors.push(`${path}: expected ${t}, got ${typeof value}`);
			return errors;
		}
		const min = typeof schema.minimum === "number" ? (schema.minimum as number) : undefined;
		const max = typeof schema.maximum === "number" ? (schema.maximum as number) : undefined;
		if (t === "integer" && !Number.isInteger(value)) errors.push(`${path}: not an integer`);
		if (min !== undefined && value < min) errors.push(`${path}: ${value} < minimum ${min}`);
		if (max !== undefined && value > max) errors.push(`${path}: ${value} > maximum ${max}`);
	}
	return errors;
}

/**
 * Spawn a subagent, wait for it, then validate its structured output.
 *
 * Resolution semantics:
 *   - ok=true: value is the validated JSON payload.
 *   - ok=false: error describes what went wrong; exitCode and stderrTail are
 *     populated when available.
 */
export async function runSubagent(opts: SpawnOptions): Promise<SpawnResult> {
	const timeoutMs = opts.timeoutMs ?? 180_000;
	const started = Date.now();

	// Write the schema file the child will read.
	writeFileSync(opts.schemaPath, JSON.stringify(toJsonSchema(opts.schema), null, 2), "utf-8");

	// Prepend PI_CODING_AGENT_DIR-style env so the child picks up the parent's
	// agent dir (extensions, settings, etc.). We intentionally do NOT pass
	// PI_SUBAGENT_STRUCTURED_OUTPUT_* in this base — those are caller-supplied.
	const childEnv: NodeJS.ProcessEnv = { ...process.env, ...opts.env };

	// Build the final command. The task text is the last positional arg.
	const child = _spawnImpl("pi", opts.args, {
		cwd: opts.cwd,
		env: childEnv,
		stdio: ["ignore", "pipe", "pipe"],
	});

	// Drain stdout so a chatty child cannot fill the pipe and deadlock.
	const stdout = child.stdout;
	if (stdout) {
		stdout.resume();
	}

	// Capture stderr tail for diagnostics.
	let stderrBuf = "";
	const stderr = child.stderr;
	if (stderr) {
		stderr.setEncoding("utf-8");
		stderr.on("data", (chunk: string) => {
			stderrBuf += chunk;
			if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
		});
	}

	return new Promise<SpawnResult>((resolve) => {
		let settled = false;
		const settle = (r: SpawnResult): void => {
			if (settled) return;
			settled = true;
			resolve(r);
		};

		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// Ignore — child may have already exited.
			}
			settle({
				ok: false,
				error: `timeout after ${timeoutMs}ms`,
				exitCode: null,
				durationMs: Date.now() - started,
				stderrTail: stderrBuf.slice(-512),
			});
		}, timeoutMs);

		child.on("exit", (code: number | null) => {
			clearTimeout(timer);
			const durationMs = Date.now() - started;

			let raw: string;
			try {
				raw = readFileSync(opts.outputPath, "utf-8");
			} catch (err) {
				settle({
					ok: false,
					error: `missing output file: ${err instanceof Error ? err.message : String(err)}`,
					exitCode: code,
					durationMs,
					stderrTail: stderrBuf.slice(-512),
				});
				return;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch (err) {
				settle({
					ok: false,
					error: `output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
					exitCode: code,
					durationMs,
					stderrTail: stderrBuf.slice(-512),
				});
				return;
			}

			const validation = validateValue(opts.schema, parsed);
			if (validation.ok === false) {
				settle({
					ok: false,
					error: `schema validation failed: ${validation.errors.join("; ")}`,
					exitCode: code,
					durationMs,
					stderrTail: stderrBuf.slice(-512),
				});
				return;
			}

			if (code !== 0 && code !== null) {
				settle({
					ok: false,
					error: `non-zero exit ${code} (structured output was present but process failed)`,
					exitCode: code,
					durationMs,
					stderrTail: stderrBuf.slice(-512),
				});
				return;
			}

			settle({
				ok: true,
				value: validation.value,
				exitCode: code,
				durationMs,
				stderrTail: stderrBuf.slice(-512),
			});
		});

		child.on("error", (err: Error) => {
			clearTimeout(timer);
			settle({
				ok: false,
				error: `spawn error: ${err.message}`,
				durationMs: Date.now() - started,
				stderrTail: stderrBuf.slice(-512),
			});
		});
	});
}
