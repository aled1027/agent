import { readFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { extname, resolve } from "node:path";
import { completeSimple, type ImageContent, type UserMessage } from "@mariozechner/pi-ai";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Theme, type SessionEntry } from "@mariozechner/pi-coding-agent";
import {
	Container,
	type Focusable,
	fuzzyMatch,
	getKeybindings,
	Input,
	Text,
	type TUI,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const DEFAULT_IMAGE_MODEL = process.env.PI_IMAGE_MODEL?.trim() || "openai-codex/gpt-5.1";
const CONFIG_ENTRY_TYPE = "image-secondary-model-config";

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
	question: string;
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

function truncateSingleLine(text: string, maxLength = 120): string {
	const singleLine = text.replace(/\s+/g, " ").trim();
	if (singleLine.length <= maxLength) return singleLine;
	return `${singleLine.slice(0, Math.max(0, maxLength - 3))}...`;
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

function clearStatus(ctx: ExtensionContext) {
	ctx.ui.setStatus("image-secondary-model", undefined);
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

interface ImageModelItem {
	value: string;
	label: string;
	description?: string;
	searchText: string;
}

function filterImageModelItems(items: ImageModelItem[], query: string): ImageModelItem[] {
	const trimmed = query.trim();
	if (!trimmed) return items;
	const tokens = trimmed
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
	if (tokens.length === 0) return items;

	return items
		.map((item) => {
			let score = 0;
			for (const token of tokens) {
				const result = fuzzyMatch(token, item.searchText);
				if (!result.matches) return null;
				score += result.score;
			}
			return { item, score };
		})
		.filter((entry): entry is { item: ImageModelItem; score: number } => Boolean(entry))
		.sort((a, b) => a.score - b.score)
		.map((entry) => entry.item);
}

class ImageModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;
	private listContainer: Container;
	private allItems: ImageModelItem[];
	private filteredItems: ImageModelItem[];
	private selectedIndex = 0;
	private headerText: Text;
	private hintText: Text;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		private tui: TUI,
		private theme: Theme,
		items: ImageModelItem[],
		private currentModelSpec: string,
		private onSelectCallback: (value: string) => void,
		private onCancelCallback: () => void,
	) {
		super();
		this.allItems = items;
		this.filteredItems = items;

		this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		this.headerText = new Text("", 1, 0);
		this.addChild(this.headerText);
		this.searchInput = new Input();
		this.searchInput.onSubmit = () => {
			const selected = this.filteredItems[this.selectedIndex];
			if (selected) this.onSelectCallback(selected.value);
		};
		this.addChild(this.searchInput);
		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.hintText = new Text("", 1, 0);
		this.addChild(this.hintText);
		this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

		this.updateHeader();
		this.hintText.setText(theme.fg("dim", "Type to search • ↑↓ select • Enter choose • Esc cancel"));
		this.applyFilter("");
	}

	private updateHeader() {
		this.headerText.setText(
			this.theme.fg("accent", this.theme.bold("Vision Model")) +
				this.theme.fg("muted", `  current: ${this.currentModelSpec}`),
		);
	}

	private applyFilter(query: string) {
		this.filteredItems = filterImageModelItems(this.allItems, query);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
	}

	private updateList() {
		this.listContainer.clear();
		if (this.filteredItems.length === 0) {
			this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching vision models"), 0, 0));
			return;
		}
		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredItems.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredItems.length);
		for (let i = startIndex; i < endIndex; i += 1) {
			const item = this.filteredItems[i];
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? this.theme.fg("accent", "→ ") : "  ";
			const label = isSelected ? this.theme.fg("accent", item.label) : this.theme.fg("text", item.label);
			const description = item.description ? this.theme.fg("muted", ` — ${item.description}`) : "";
			this.listContainer.addChild(new Text(prefix + label + description, 0, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "tui.select.confirm")) {
			const selected = this.filteredItems[this.selectedIndex];
			if (selected) this.onSelectCallback(selected.value);
			return;
		}
		if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
			return;
		}
		this.searchInput.handleInput(keyData);
		this.applyFilter(this.searchInput.getValue());
		this.tui.requestRender();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateHeader();
		this.updateList();
	}
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
		question: question.trim(),
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

	const response = await completeSimple(
		model,
		{
			systemPrompt:
				"You are an expert image-analysis assistant used as a secondary model inside a coding harness. Focus on visual evidence, mention uncertainty when needed, and do not invent details.",
			messages: [userMessage],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			signal: ctx.signal,
			...(model.reasoning ? { reasoning: "minimal" as const } : {}),
		},
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
	let latestCtx: ExtensionContext | undefined;

	function setConfiguredModelSpec(modelSpec: string, ctx: ExtensionContext, mode: "set" | "reset" = "set") {
		pi.appendEntry<ConfigState>(CONFIG_ENTRY_TYPE, { modelSpec });
		clearStatus(ctx);
		ctx.ui.notify(
			mode === "reset" ? `Secondary vision model reset to ${modelSpec}` : `Secondary vision model set to ${modelSpec}`,
			"info",
		);
	}

	function getImageModelCompletions(ctx: ExtensionContext): ImageModelItem[] {
		const currentModelSpec = getConfiguredModelSpec(ctx);
		const items: ImageModelItem[] = [
			{
				value: "reset",
				label: "reset",
				description: `Reset to default (${DEFAULT_IMAGE_MODEL})`,
				searchText: `reset default ${DEFAULT_IMAGE_MODEL}`.toLowerCase(),
			},
		];
		const seen = new Set<string>();
		for (const model of ctx.modelRegistry.getAll()) {
			if (!model.input.includes("image")) continue;
			if (!ctx.modelRegistry.hasConfiguredAuth(model)) continue;
			const modelSpec = `${model.provider}/${model.id}`;
			if (seen.has(modelSpec)) continue;
			seen.add(modelSpec);
			const tags: string[] = [];
			if (modelSpec === currentModelSpec) tags.push("current");
			if (modelSpec === DEFAULT_IMAGE_MODEL) tags.push("default");
			tags.push("ready");
			const description = tags.join(" • ");
			items.push({
				value: modelSpec,
				label: modelSpec,
				description,
				searchText: `${modelSpec} ${model.id} ${model.provider} ${description}`.toLowerCase(),
			});
		}
		return items;
	}

	async function showImageModelSelector(ctx: ExtensionContext) {
		const currentModelSpec = getConfiguredModelSpec(ctx);
		const items = getImageModelCompletions(ctx).map((item) => {
			if (item.value === "reset") {
				return {
					...item,
					value: DEFAULT_IMAGE_MODEL,
					label:
						DEFAULT_IMAGE_MODEL === currentModelSpec
							? `${DEFAULT_IMAGE_MODEL} (default, current)`
							: `${DEFAULT_IMAGE_MODEL} (default)`,
					searchText: `${item.searchText} ${currentModelSpec === DEFAULT_IMAGE_MODEL ? "current" : "default"}`,
				};
			}
			return item;
		});

		const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) =>
			new ImageModelSelectorComponent(tui, theme, items, currentModelSpec, (value) => done(value), () => done(null)),
		);

		if (!result || result === currentModelSpec) return;
		setConfiguredModelSpec(result, ctx, result === DEFAULT_IMAGE_MODEL ? "reset" : "set");
	}

	pi.registerCommand("image-model", {
		description: "Show or set the secondary vision model (provider/model)",
		getArgumentCompletions: async (argumentPrefix) => {
			const ctx = latestCtx;
			if (!ctx) return null;
			const query = argumentPrefix.trim().toLowerCase();
			const items = getImageModelCompletions(ctx);
			if (!query) return items;
			return items.filter(
				(item) =>
					item.value.toLowerCase().includes(query) ||
					item.label.toLowerCase().includes(query) ||
					item.description?.toLowerCase().includes(query),
			);
		},
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input) {
				await showImageModelSelector(ctx);
				return;
			}

			if (input === "reset") {
				setConfiguredModelSpec(DEFAULT_IMAGE_MODEL, ctx, "reset");
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

			setConfiguredModelSpec(input, ctx);
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
		renderCall(args, theme) {
			const question = truncateSingleLine(args.question || "", 140) || "(no question)";
			let text = theme.fg("toolTitle", theme.bold("secondary vision ")) + theme.fg("muted", question);
			const meta: string[] = [];
			if (Array.isArray(args.paths) && args.paths.length > 0) {
				meta.push(`${args.paths.length} path${args.paths.length === 1 ? "" : "s"}`);
			}
			if (args.useRecentImages !== false) meta.push("recent images");
			if (args.model) meta.push(args.model);
			if (meta.length > 0) text += `\n${theme.fg("dim", meta.join(" • "))}`;
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as AnalyzeDetails | undefined;
			if (isPartial) {
				const pendingQuestion = details?.question ? truncateSingleLine(details.question, 140) : "Analyzing images...";
				return new Text(theme.fg("warning", pendingQuestion), 0, 0);
			}

			const content = result.content.find((item): item is { type: "text"; text: string } => item.type === "text");
			let text = theme.fg("toolTitle", theme.bold("secondary vision "));
			if (details) {
				text += theme.fg("accent", details.model);
				text += theme.fg("muted", ` (${details.imageCount} image${details.imageCount === 1 ? "" : "s"})`);
				text += `\n${theme.fg("muted", `Prompt: ${details.question}`)}`;
			}
			if (content?.text) text += `\n${content.text}`;
			if (expanded && details) {
				text += `\n\n${theme.fg("muted", "Sources:")}`;
				for (const source of details.sources) text += `\n- ${theme.fg("dim", source)}`;
				if (details.usage) {
					text += `\n\n${theme.fg("muted", "Usage:")}`;
					text += `\n- ${theme.fg("dim", `input ${details.usage.input}, output ${details.usage.output}, total ${details.usage.totalTokens}`)}`;
				}
			}
			return new Text(text, 0, 0);
		},
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
			text += `\n${theme.fg("muted", `Prompt: ${details.question}`)}`;
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
		latestCtx = ctx;
		clearStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		latestCtx = ctx;
		clearStatus(ctx);
	});
}
