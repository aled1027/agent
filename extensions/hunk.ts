import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const HUNK_FEEDBACK_PROMPT = "Check my hunk comments and apply feedback";

export default function hunkExtension(pi: ExtensionAPI) {
	pi.registerCommand("hunk", {
		description: "Check Hunk comments and apply feedback",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			pi.sendUserMessage(HUNK_FEEDBACK_PROMPT);
		},
	});
}
