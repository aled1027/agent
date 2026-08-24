/**
 * Minimal pi extension for reviewer/gate child processes.
 *
 * Loaded via: `pi --no-extensions -e ./src/structured-output-capture.ts`
 *
 * Env (set by parent in src/args.ts):
 *   PI_SUBAGENT_STRUCTURED_OUTPUT_SCHEMA — JSON Schema path (informational for the model via parent system prompt)
 *   PI_SUBAGENT_STRUCTURED_OUTPUT_CAPTURE — write validated payload here as JSON
 */
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const capturePath = process.env.PI_SUBAGENT_STRUCTURED_OUTPUT_CAPTURE;

export default function (pi: ExtensionAPI) {
	if (!capturePath) {
		return;
	}

	pi.registerTool({
		name: "structured_output",
		label: "Structured Output",
		description:
			"Emit the final structured JSON result matching the schema described in your system prompt. Call exactly once as your last action.",
		parameters: Type.Object({}, { additionalProperties: true }),
		async execute(_toolCallId, params) {
			writeFileSync(capturePath, `${JSON.stringify(params, null, 2)}\n`, "utf-8");
			return {
				content: [{ type: "text", text: "Structured output captured." }],
				details: {},
				terminate: true,
			};
		},
	});
}
