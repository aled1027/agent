import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Image } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "show_image",
    label: "Show Image",
    description: "Display a local PNG, JPEG, GIF, or WebP image in the Pi terminal",
    promptSnippet: "Display a local image in the terminal",
    promptGuidelines: [
      "Use show_image when the user asks to view a local image in the terminal.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the local image file" }),
    }),

    async execute(_id, { path }, _signal, _update, ctx) {
      const absolutePath = resolve(ctx.cwd, path.replace(/^@/, ""));
      const mediaType = MIME[extname(absolutePath).toLowerCase()];

      if (!mediaType) throw new Error("Supported formats: PNG, JPEG, GIF, WebP");
      readFileSync(absolutePath);

      return {
        content: [{ type: "text", text: `Displayed ${absolutePath}` }],
        details: { absolutePath, mediaType },
      };
    },

    renderResult(result, _options, theme, context) {
      if (context.lastComponent) return context.lastComponent;

      const { absolutePath, mediaType } = result.details as {
        absolutePath: string;
        mediaType: string;
      };

      return new Image(
        readFileSync(absolutePath).toString("base64"),
        mediaType,
        theme,
        { maxWidthCells: 80, maxHeightCells: 24 },
      );
    },
  });
}
