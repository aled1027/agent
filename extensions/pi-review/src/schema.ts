/**
 * Structured-output schemas for reviewer and gate subagents.
 *
 * These schemas are retained for the legacy direct-process path and are used
 * two ways:
 *   1. Serialized to JSON Schema and written to a tmp file the child reads
 *      via the PI_SUBAGENT_STRUCTURED_OUTPUT_SCHEMA env var.
 *   2. Compiled via TypeBox and used by the parent to validate the JSON the
 *      child wrote to PI_SUBAGENT_STRUCTURED_OUTPUT_CAPTURE.
 */
import { Type, type TSchema } from "typebox";
import type { IssueSeverity, IssueCategory, Verdict } from "./types.js";

/** A single finding reported by a reviewer. */
export const IssueSchema = Type.Object(
	{
		file: Type.String({ minLength: 1, maxLength: 500 }),
		line: Type.Optional(Type.Integer({ minimum: 1 })),
		category: Type.Union([
			Type.Literal<IssueCategory>("compliance"),
			Type.Literal<IssueCategory>("bug"),
			Type.Literal<IssueCategory>("convention"),
			Type.Literal<IssueCategory>("history"),
			Type.Literal<IssueCategory>("security"),
			Type.Literal<IssueCategory>("performance"),
			Type.Literal<IssueCategory>("docs"),
			Type.Literal<IssueCategory>("other"),
		]),
		severity: Type.Union([
			Type.Literal<IssueSeverity>("blocker"),
			Type.Literal<IssueSeverity>("major"),
			Type.Literal<IssueSeverity>("minor"),
			Type.Literal<IssueSeverity>("nit"),
		]),
		confidence: Type.Integer({ minimum: 1, maximum: 10 }),
		evidence: Type.String({ minLength: 1, maxLength: 280 }),
	},
	{ additionalProperties: false },
);

/** Payload a reviewer subagent must produce. */
export const ReviewerOutputSchema = Type.Object(
	{
		issues: Type.Array(IssueSchema, { maxItems: 200 }),
		summary: Type.String({ minLength: 1, maxLength: 2000 }),
	},
	{ additionalProperties: false },
);

/** Payload the gate subagent produces. */
export const GateOutputSchema = Type.Object(
	{
		verdict: Type.Union([
			Type.Literal<Verdict>("approve"),
			Type.Literal<Verdict>("request_changes"),
			Type.Literal<Verdict>("comment"),
		]),
		issues: Type.Array(IssueSchema, { maxItems: 500 }),
		reason: Type.String({ minLength: 1, maxLength: 500 }),
	},
	{ additionalProperties: false },
);

/**
 * Convert a TypeBox schema to a plain JSON Schema object. TypeBox schemas are
 * themselves JSON-Schema compatible; the type brand is only on the TS side
 * (phantom property symbols), not on the serialized output.
 */
export function toJsonSchema(schema: TSchema): Record<string, unknown> {
	return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}
