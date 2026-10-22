/**
 * Linear for Pi Pocket: Linear's MCP server (issues, projects, comments, cycles) through two tools.
 *
 * It connects to https://mcp.linear.app/mcp with a Linear personal API key, read from `LINEAR_API_KEY` or
 * `~/.config/linear/api-key`. The key stays on the server: it never goes into a prompt or a tool result.
 * It connects at the first call, not while it loads, so a missing key or a slow network does not hold up the server.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { McpClient, StreamableHttpTransport, toLlmContent } from "@earendil-works/pi-mcp";

export const pocketApi = 2;

const URL = "https://mcp.linear.app/mcp";
const KEY_FILE = join(homedir(), ".config", "linear", "api-key");

async function apiKey(): Promise<string> {
    const env = process.env.LINEAR_API_KEY?.trim();
    if (env) return env;
    try {
        const key = (await readFile(KEY_FILE, "utf8")).trim();
        if (key) return key;
    } catch {}
    throw new Error(`No Linear API key. Tell the user to put a Linear personal API key in ${KEY_FILE} (Linear: Settings → Security & access → Personal API keys).`);
}

export default function createLinear(_host: unknown, web: { onDispose(run: () => unknown): void }) {
    // A connection cache, not state: a reload or restart only connects again.
    let client: Promise<McpClient> | undefined;

    const connect = () => {
        client ??= (async () => {
            const key = await apiKey();
            const c = new McpClient({ name: "pi-pocket-linear", version: "1.0.0" });
            c.onClose(() => (client = undefined));
            await c.connect(new StreamableHttpTransport({ url: URL, headers: { Authorization: `Bearer ${key}` } }));
            return c;
        })().catch((error) => {
            client = undefined;
            throw error;
        });
        return client;
    };

    web.onDispose(async () => (await client?.catch(() => undefined))?.close());

    const listTools = Object.assign(
        defineTool({
            name: "linear_tools",
            description:
                "List the tools of the user's Linear workspace (Linear's MCP server): names, descriptions, and input schemas. Call it once before linear_call.",
            parameters: Type.Object({}),
            replay: "safe",
            execute: async (_args, api) => {
                const tools = await (await connect()).listTools({ signal: api.signal });
                const text = tools
                    .map((t) => `## ${t.name}\n${t.description ?? ""}\nInput: ${JSON.stringify(t.inputSchema)}`)
                    .join("\n\n");
                return { output: [{ type: "text" as const, text }] };
            },
        }),
        { annotations: { readOnlyHint: true } },
    );

    const call = defineTool({
        name: "linear_call",
        description:
            "Call one tool of the user's Linear workspace (Linear's MCP server), for example to find, read, create, or update issues. Get the names and input schemas from linear_tools first. Ask the user before you create, change, or delete anything in Linear.",
        parameters: Type.Object({
            tool: Type.String({ description: "The Linear tool's name, from linear_tools" }),
            arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Its input, matching its schema" })),
        }),
        // Not replayed: a call can create or change issues.
        execute: async (args, api) => {
            const result = await (await connect()).callTool(args.tool, args.arguments ?? {}, { signal: api.signal });
            const output = toLlmContent(result);
            if (result.isError === true) {
                throw new Error(output.map((c) => (c.type === "text" ? c.text : "")).join("\n") || "Linear returned an error.");
            }
            return { output };
        },
    });

    return defineExtension({ name: "linear", tools: [listTools, call] });
}
