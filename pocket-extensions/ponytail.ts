/**
 * Ponytail for Pi Pocket: puts the Ponytail ruleset in Pi's system prompt, with a /ponytail-mode command per session.
 *
 * Port of the Pi CLI extension in ~/.pi/agent/extensions/ponytail. It reuses that extension's hooks (config and
 * instruction builder), so the default mode comes from ~/.config/ponytail/config.json or PONYTAIL_DEFAULT_MODE, and the
 * rules come from ~/.pi/agent/skills/ponytail/SKILL.md. The /skill:ponytail-* skills work as they are.
 */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineDoc, defineExtension, section } from "@earendil-works/pi-durable";
import type { Web } from "./_pocket.d.ts";

export const pocketApi = 2;

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const hooks = createRequire(join(AGENT_DIR, "extensions", "ponytail", "hooks", "x.js"));
const { RUNTIME_MODES, getDefaultMode, normalizeMode, writeDefaultMode } = hooks("./ponytail-config.js");
const { getPonytailInstructions } = hooks("./ponytail-instructions.js");

/** A session's mode, as /ponytail-mode set it. Without one, the configured default applies. */
const PonytailMode = defineDoc<{ mode?: string }>({
    kind: "x.ponytail.mode",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({}),
});

// The CLI's "stop ponytail" phrase needs an input hook that Pocket does not have; point at the command instead.
const SWITCH_LINE = /^Active for the whole session.*$/m;
const SWITCH_TEXT = "Active for the whole session. Switch level or turn off: `/ponytail-mode lite|full|ultra|off`.";

const rules = section("ponytail", async (input, context) => {
    const mode = (await input.read.snapshot(PonytailMode, input.conversationId, context))?.mode ?? getDefaultMode();
    if (mode === "off") return undefined;
    return String(getPonytailInstructions(mode)).replace(SWITCH_LINE, SWITCH_TEXT);
});

export default function createPonytail(_host: unknown, web: Web) {
    web.command("ponytail-mode", {
        description: "Ponytail: show the mode, set it for this session, or set the default",
        args: `[${RUNTIME_MODES.join("|")}|default <mode>]`,
        scope: "conversation",
        handler: async (args, ctx) => {
            const [first = "", second] = args.trim().toLowerCase().split(/\s+/);
            const current = async () =>
                (await ctx.snapshot(PonytailMode, ctx.conversationId, ctx.context))?.mode ?? getDefaultMode();

            if (first === "" || first === "status") {
                return { type: "toast", level: "info", message: `Ponytail: ${await current()} (default ${getDefaultMode()})` };
            }

            if (first === "default") {
                // The default file is shared by the whole machine, so only the owner changes it.
                if (ctx.user.role !== "owner") throw web.error(403, "Only the owner can change the default.");
                const written = normalizeMode(second) && writeDefaultMode(second);
                if (!written) throw web.error(400, `Use one of: ${RUNTIME_MODES.join(", ")}.`);
                return { type: "toast", level: "info", message: `Default Ponytail mode: ${getDefaultMode()}.` };
            }

            const mode = normalizeMode(first);
            if (!mode) throw web.error(400, `Use one of: ${RUNTIME_MODES.join(", ")}, status, default <mode>.`);
            await ctx.commit(async (tx) => {
                (await tx.doc(PonytailMode, ctx.conversationId)).mode = mode;
            });
            return { type: "toast", level: "info", message: `Ponytail mode set to ${mode}.` };
        },
    });

    return defineExtension({ name: "ponytail", sections: [rules] });
}
