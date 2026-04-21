/**
 * Block Large Images Extension
 *
 * Blocks the `read` tool when it targets image files (jpg, jpeg, png, gif, webp, bmp, svg).
 * Forces the LLM to use the inspect-image skill instead, which sends images to a
 * separate vision model and returns text — keeping the main conversation context lean.
 *
 * Image files loaded via `read` get base64-encoded into the conversation and re-sent
 * on every subsequent API call, causing massive token usage and cost.
 *

 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".tif", ".ico", ".avif"]);
const BLOCK_ALL = true;

function isImagePath(path: string): boolean {
	const ext = path.toLowerCase().split(".").pop() ?? "";
	return IMAGE_EXTENSIONS.has(`.${ext}`);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, _ctx) => {
		if (event.toolName !== "read") return undefined;

		const path = event.input?.path as string | undefined;
		if (!path || !isImagePath(path)) return undefined;

		return {
			block: true,
			reason: `Reading image "${path}" is blocked. Use the inspect-image skill to analyze images — it sends them to a separate vision model and keeps conversation context lean.`,
		};
	});
}
