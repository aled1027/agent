import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

const PREFIX = "› ";
const PREFIX_WIDTH = 2;
const PADDING = 1;
const BORDER = /^(?:─+|─* ([↑↓]) (\d+) more ─*)$/;
const withoutAnsi = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

class PromptGlyphEditor extends CustomEditor {
  private renderedPrefixWidth = PREFIX_WIDTH;
  private hiddenAbove = 0;
  private hiddenBelow = 0;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private glyphColor: (text: string) => string,
    private lineBackground: (text: string) => string,
  ) {
    super(tui, theme, keybindings);
  }

  render(width: number): string[] {
    const paddedWidth = Math.max(1, width - PADDING * 2);
    this.renderedPrefixWidth = paddedWidth > 1 ? Math.min(PREFIX_WIDTH, paddedWidth - 1) : 0;
    const innerWidth = Math.max(1, paddedWidth - this.renderedPrefixWidth);
    const rendered = super.render(innerWidth);
    const topMatch = BORDER.exec(withoutAnsi(rendered[0] ?? ""));
    this.hiddenAbove = topMatch?.[1] === "↑" ? Number(topMatch[2]) : 0;

    const lines = rendered.slice(1);
    this.hiddenBelow = 0;
    const bottomBorder = lines.findIndex((line) => {
      const match = BORDER.exec(withoutAnsi(line));
      if (match?.[1] === "↓") this.hiddenBelow = Number(match[2]);
      return match !== null;
    });
    const promptLines = lines.slice(0, bottomBorder);
    const autocompleteLines = lines.slice(bottomBorder + 1);
    const horizontalPadding = " ".repeat(PADDING);
    const blankBackgroundLine = this.lineBackground(" ".repeat(width));

    return [
      "",
      blankBackgroundLine,
      ...promptLines.map((line, index) => {
        const marker = index === 0 && this.hiddenAbove ? "›↑" : index === promptLines.length - 1 && this.hiddenBelow ? "›↓" : PREFIX;
        return this.lineBackground(
          horizontalPadding + this.glyphColor(marker.slice(0, this.renderedPrefixWidth)) + line + horizontalPadding,
        );
      }),
      blankBackgroundLine,
      ...autocompleteLines.map(
        (line) => " ".repeat(PADDING + this.renderedPrefixWidth) + line + horizontalPadding,
      ),
      "",
    ];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return super.handleMouse({
      ...event,
      x: event.x - PADDING - this.renderedPrefixWidth,
      y: event.y - 1,
      width: Math.max(1, event.width - PADDING * 2 - this.renderedPrefixWidth),
    });
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.setEditorComponent((tui, theme, keybindings) =>
        new PromptGlyphEditor(
          tui,
          theme,
          keybindings,
          (text) => ctx.ui.theme.fg("muted", text),
          (text) => {
            const background = ctx.ui.theme.getBgAnsi("userMessageBg");
            return background + text.replaceAll("\x1b[0m", `\x1b[0m${background}`) + "\x1b[0m";
          },
        ),
      );
    }
  });
}
