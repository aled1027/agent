import { readFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { extname, resolve } from "node:path";
import { complete, type ImageContent, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const DEFAULT_IMAGE_MODEL = process.env.PI_IMAGE_MODEL?.trim() || "openai-codex/gpt-5.1";
const CONFIG_ENTRY_TYPE = "image-secondary-model-config";
const STATUS_KEY = "image-secondary-model";

const MIME_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

interface ConfigState {
	modelSpec: string;
}

interface AnalyzeDetails {
	model: string;
	imageCount: number;
	sources: string[];
	stopReason?: string;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		costTotal: number;
	};
}

function parseModelSpec(spec: string): { provider: string; id: string } {
	const trimmed = spec.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) {
		throw new Error(`Invalid model spec \"${spec}\". Use provider/model, e.g. openai/gpt-4o-mini.`);
	}
	return {
		provider: trimmed.slice(0, slash),
		id: trimmed.slice(slash + 1),
	};
}

function getSavedModelSpec(ctx: ExtensionContext): string | undefined {
	let modelSpec: string | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === CONFIG_ENTRY_TYPE) {
			const data = entry.data as ConfigState | undefined;
			if (data?.modelSpec?.trim()) modelSpec = data.modelSpec.trim();
		}
	}
	return modelSpec;
}

function getConfiguredModelSpec(ctx: ExtensionContext): string {
	return getSavedModelSpec(ctx) ?? DEFAULT_IMAGE_MODEL;
}

function updateStatus(ctx: ExtensionContext) {
	ctx.ui.setStatus(STATUS_KEY, `vision:${getConfiguredModelSpec(ctx)}`);
}

function normalizePath(input: string): string {
	return input.startsWith("@") ? input.slice(1) : input;
}

function inferMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	const mimeType = MIME_TYPES[ext];
	if (!mimeType) {
		throw new Error(
			`Unsupported image extension for ${filePath}. Supported: ${Object.keys(MIME_TYPES).join(", ")}`,
		);
	}
	return mimeType;
}

async function loadImageFromPath(cwd: string, inputPath: string): Promise<{ image: ImageContent; source: string }> {
	const resolvedPath = resolve(cwd, normalizePath(inputPath));
	accessSync(resolvedPath, constants.R_OK);
	const data = await readFile(resolvedPath);
	return {
		image: {
			type: "image",
			data: data.toString("base64"),
			mimeType: inferMimeType(resolvedPath),
		},
		source: resolvedPath,
	};
}

function isUserMessageEntry(entry: SessionEntry): entry is SessionEntry & {
	type: "message";
	message: UserMessage;
} {
	return entry.type === "message" && entry.message.role === "user";
}

function getMostRecentAttachedImages(ctx: ExtensionContext): { images: ImageContent[]; source: string } | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!isUserMessageEntry(entry) || !Array.isArray(entry.message.content)) continue;
		const images = entry.message.content.filter((item): item is ImageContent => item.type === "image");
		if (images.length > 0) {
			return { images, source: "latest user-attached image(s)" };
		}
	}
	return undefined;
}

async function runImageAnalysis(
	ctx: ExtensionContext,
	question: string,
	modelSpec: string,
	paths?: string[],
	useRecentImages?: boolean,
	onUpdate?: (partial: { content: { type: "text"; text: string }[]; details: AnalyzeDetails }) => void,
): Promise<{ text: string; details: AnalyzeDetails }> {
	const { provider, id } = parseModelSpec(modelSpec);
	const model = ctx.modelRegistry.find(provider, id);
	if (!model) throw new Error(`Model not found: ${modelSpec}`);
	if (!model.input.includes("image")) throw new Error(`Model does not support image input: ${modelSpec}`);

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(auth.ok ? `No API key configured for ${modelSpec}` : auth.error);
	}

	const images: ImageContent[] = [];
	const sources: string[] = [];

	for (const inputPath of paths ?? []) {
		const loaded = await loadImageFromPath(ctx.cwd, inputPath);
		images.push(loaded.image);
		sources.push(loaded.source);
	}

	if (useRecentImages) {
		const recent = getMostRecentAttachedImages(ctx);
		if (recent) {
			images.push(...recent.images);
			sources.push(recent.source);
		}
	}

	if (images.length === 0) {
		throw new Error(
			"No images found. Pass paths or attach an image in the latest user message so the tool can reuse it.",
		);
	}

	const detailsBase: AnalyzeDetails = {
		model: modelSpec,
		imageCount: images.length,
		sources,
	};
	onUpdate?.({
		content: [{ type: "text", text: `Analyzing ${images.length} image(s) with ${modelSpec}...` }],
		details: detailsBase,
	});

	const userMessage: UserMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text: [
					"You are a secondary vision model helping another coding agent.",
					"Answer the user's question using only the provided image data.",
					"If something is unclear, say so plainly.",
					"Be concise but specific.",
					"",
					`Question: ${question.trim()}`,
				].join("\n"),
			},
			...images,
		],
		timestamp: Date.now(),
	};

	const response = await complete(
		model,
		{
			systemPrompt:
				"You are an expert image-analysis assistant used as a secondary model inside a coding harness. Focus on visual evidence, mention uncertainty when needed, and do not invent details.",
			messages: [userMessage],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
	);

	if (response.stopReason === "aborted") throw new Error("Image analysis aborted.");
	if (response.stopReason === "error") throw new Error(response.errorMessage || "Image analysis failed.");

	const text = response.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text)
		.join("\n")
		.trim();

	if (!text) throw new Error(`No text response returned from ${modelSpec}.`);

	return {
		text,
		details: {
			...detailsBase,
			stopReason: response.stopReason,
			usage: {
				input: response.usage.input,
				output: response.usage.output,
				cacheRead: response.usage.cacheRead,
				cacheWrite: response.usage.cacheWrite,
				totalTokens: response.usage.totalTokens,
				costTotal: response.usage.cost.total,
			},
		},
	};
}

export default function imageSecondaryModelExtension(pi: ExtensionAPI) {
	pi.registerCommand("image-model", {
		description: "Show or set the secondary vision model (provider/model)",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input) {
				ctx.ui.notify(`Secondary vision model: ${getConfiguredModelSpec(ctx)}`, "info");
				return;
			}

			if (input === "reset") {
				pi.appendEntry<ConfigState>(CONFIG_ENTRY_TYPE, { modelSpec: DEFAULT_IMAGE_MODEL });
				updateStatus(ctx);
				ctx.ui.notify(`Secondary vision model reset to ${DEFAULT_IMAGE_MODEL}`, "info");
				return;
			}

			const { provider, id } = parseModelSpec(input);
			const model = ctx.modelRegistry.find(provider, id);
			if (!model) {
				ctx.ui.notify(`Model not found: ${input}`, "error");
				return;
			}
			if (!model.input.includes("image")) {
				ctx.ui.notify(`Model does not support image input: ${input}`, "error");
				return;
			}

			pi.appendEntry<ConfigState>(CONFIG_ENTRY_TYPE, { modelSpec: input });
			updateStatus(ctx);
			ctx.ui.notify(`Secondary vision model set to ${input}`, "info");
		},
	});

	pi.registerTool({
		name: "analyze_with_secondary_vision_model",
		label: "Secondary Vision Model",
		description:
			"Analyze images with a separate vision-capable model while the main harness stays on its current model.",
		promptSnippet: "Delegate screenshot/image/frame analysis to the configured secondary vision model.",
		promptGuidelines: [
			"Use this tool when the user asks about screenshots, frames, photos, diagrams, or any other visual input and you want the secondary vision model to inspect them.",
			"If the latest user message already attached images, you can omit paths and let the tool reuse those recent images.",
			"Pass a concrete question describing exactly what you want extracted or verified from the image.",
		],
		parameters: Type.Object({
			question: Type.String({
				description: "What to ask the secondary vision model about the provided image(s)",
			}),
			paths: Type.Optional(
				Type.Array(Type.String({ description: "Path to an image file" }), {
					description: "Optional image paths on disk",
				}),
			),
			useRecentImages: Type.Optional(
				Type.Boolean({
					description:
						"Also include the most recent user-attached images from the conversation. Defaults to true when no paths are provided.",
					default: true,
				}),
			),
			model: Type.Optional(
				Type.String({
					description: "Optional per-call override in provider/model format, e.g. openai/gpt-4o-mini",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const useRecentImages = params.useRecentImages ?? !(params.paths && params.paths.length > 0);
			const modelSpec = params.model?.trim() || getConfiguredModelSpec(ctx);
			const result = await runImageAnalysis(
				ctx,
				params.question,
				modelSpec,
				params.paths,
				useRecentImages,
				onUpdate,
			);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},
	});

	pi.registerCommand("ask-image-model", {
		description: "Manually analyze the latest attached image(s) with the secondary vision model",
		handler: async (args, ctx) => {
			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /ask-image-model <question>", "warning");
				return;
			}

			try {
				const result = await runImageAnalysis(ctx, question, getConfiguredModelSpec(ctx), undefined, true);
				pi.sendMessage({
					customType: "secondary-vision-result",
					content: result.text,
					details: result.details,
					display: true,
				});
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerMessageRenderer("secondary-vision-result", (message, options, theme) => {
		const details = message.details as AnalyzeDetails | undefined;
		let text = theme.fg("toolTitle", theme.bold("secondary vision "));
		if (details) {
			text += theme.fg("accent", details.model);
			text += theme.fg("muted", ` (${details.imageCount} image${details.imageCount === 1 ? "" : "s"})`);
		}
		text += `\n${message.content}`;
		if (options.expanded && details) {
			text += `\n\n${theme.fg("muted", "Sources:")}`;
			for (const source of details.sources) text += `\n- ${theme.fg("dim", source)}`;
			if (details.usage) {
				text += `\n\n${theme.fg("muted", "Usage:")}`;
				text += `\n- ${theme.fg("dim", `input ${details.usage.input}, output ${details.usage.output}, total ${details.usage.totalTokens}`)}`;
			}
		}
		return new Text(text, 0, 0);
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		updateStatus(ctx);
	});
}
