import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Spacer, Text } from "@mariozechner/pi-tui";
import { InteractiveMode } from "/Users/alexledger/.vite-plus/packages/@mariozechner/pi-coding-agent/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js";
import { DynamicBorder } from "/Users/alexledger/.vite-plus/packages/@mariozechner/pi-coding-agent/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/dynamic-border.js";
import { theme } from "/Users/alexledger/.vite-plus/packages/@mariozechner/pi-coding-agent/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const VP_COMMAND = "Run: vp install -g @mariozechner/pi-coding-agent";

let patched = false;

export default function vpUpdateInstructionExtension(_pi: ExtensionAPI) {
	if (patched) return;
	patched = true;

	InteractiveMode.prototype.showNewVersionNotification = function (newVersion: string) {
		const action = theme.fg("accent", VP_COMMAND);
		const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. `) + action;
		const changelogUrl = theme.fg(
			"accent",
			"https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md",
		);
		const changelogLine = theme.fg("muted", "Changelog: ") + changelogUrl;

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text: string) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new Text(
				`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}\n${changelogLine}`,
				1,
				0,
			),
		);
		this.chatContainer.addChild(new DynamicBorder((text: string) => theme.fg("warning", text)));
		this.ui.requestRender();
	};
}
