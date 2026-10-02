import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Image } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { execFileSync } from "node:child_process";
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

      // Inside tmux, inline images don't render. Terms watches this pane option
      // and opens the image in its right panel.
      const pane = process.env.TMUX_PANE;
      if (pane && !absolutePath.includes("\n")) {
        try {
          execFileSync("tmux", ["set-option", "-p", "-t", pane, "@schmuck-show-image", absolutePath], { stdio: "ignore", timeout: 500 });
        } catch {}
      }

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
        { fallbackColor: (s: string) => theme.fg("muted", s) },
        { maxWidthCells: 80, maxHeightCells: 24 },
      );
    },
  });
}
