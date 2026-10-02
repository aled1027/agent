---
name: terms-http
description: Control Terms (formerly Schmuck), the native macOS tmux frontend, through its local HTTP API. Use when asked to create Terms groups or tabs, select a terminal or group overview, or launch an agent in a chosen directory.
---

# Terms HTTP control

Use the debug app's HTTP API at `http://127.0.0.1:19827`. It is unauthenticated and runs commands as the current macOS user. Use it only for work the user requested.

Terms was renamed from Schmuck. Stored identifiers keep the old name: the tmux session `schmuck-native`, pane options `@schmuck-*`, and bundle ID `com.alexledger.schmuck`.

## Workflow

1. Read `GET /health` and `GET /state`. If unavailable, ask the user to launch a debug build; build and relaunch instructions are in [Terms' README](/Users/alexledger/git/aled1027/monorepo/terms/README.md). Relaunch replaces the installed app.
2. Resolve the requested directory to an existing absolute path. Resolve the chosen agent executable to an absolute executable path, and check that agent's documented CLI arguments. Keep permission prompts enabled.
3. Create a group with `POST /groups` and `{"name":"Research"}`. Save `createdGroupID`; names need not be unique.
4. Create each tab with `POST /terminals`. Supply the saved `groupID` and the chosen `directory`. For agent work, also supply `executable` and an `arguments` array containing the agent's flags and prompt. Save each `createdTerminalID`.
5. Select the requested tab with `POST /select` and `{"id":"@123"}`, or open a group's overview with `{"groupID":"UUID"}`. Read `/state` to verify group membership and selection.
6. Report the created IDs and what was launched. A successful response confirms terminal creation, not successful agent startup or completed work. The API returns metadata only, not output or agent status. Arrange a task-specific result file when the user needs results back.

A tab and a terminal are the same thing: one tmux window, with an ID like `@123`. For three tabs with work in the first, create the first with the agent executable and arguments, create two without them, then select the first. There is no API for sending input to an existing terminal; start work in a new tab.

## Requests

| Request | Body / result |
| --- | --- |
| `GET /health` | `status` and `port` |
| `GET /state` | `selected`, `error`, `terminals` (`id`, `name`, `active`), `groups` (`id`, `name`, `terminalIDs`) |
| `POST /groups` | `name` (nonblank, no control characters); returns state plus `createdGroupID` |
| `POST /terminals` | Optional `groupID`, `directory`, `executable`, `arguments`; returns state plus `createdTerminalID` |
| `POST /select` | Exactly one of `id` (select a tab) or `groupID` (open that group's overview); returns state |
| `POST /refresh` | Refresh tmux metadata; returns state |
| `POST /quit` | Quit the app; tmux terminals keep running |

An empty `{}` creates a shell in the selected terminal's group (or the default group), in that group's default directory (`~` for new groups). `arguments` requires `executable`. Unknown fields, nulls, wrong types, invalid paths, and unknown groups return `400` without creating anything. Arguments are passed literally, not interpreted as shell syntax. Use absolute paths: `~` and shell variables are not expanded. Launching a short-lived command can close its tab when the command exits.

Use a JSON encoder for prompts containing quotes or newlines. For example, after resolving `group_id`, `directory`, `executable`, and the agent-specific `arguments`:

```python
import json
from urllib.request import Request, urlopen

body = {
    "groupID": group_id,
    "directory": directory,
    "executable": executable,
    "arguments": arguments,
}
request = Request(
    "http://127.0.0.1:19827/terminals",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urlopen(request, timeout=10) as response:
    terminal_id = json.load(response)["createdTerminalID"]
```

## App features outside the API

These are user-facing; the API cannot drive them, but you can point the user to them:

- **Split panes:** a tab can hold several tmux panes. `/state` lists tabs, not panes.
- **Group overview:** `POST /select` with `groupID` shows live cards for each tab in the group; cards waiting for input get a red border.
- **Pi status:** with the Pi status extension installed, the sidebar shows whether Pi is running, blocked, or done. This status is not in `/state`.
- **Right panel:** Command-Shift-R opens the Review tab (Git diff with inline comments). A program in a pane can show an image there by setting that pane's `@schmuck-show-image` option to an absolute file path.
- **Worktrees:** File → New Worktree creates a branch, worktree, and terminal from the selected terminal's repository.

## Safety and failures

- **Local access only:** The API is debug-only, bound to loopback, and rejects browser `Origin`, `Sec-Fetch-Site`, and `Sec-Fetch-Mode` headers. Keep it off proxies and public interfaces.
- **Validate before retrying:** A `400` means invalid input or creation failure. Inspect `/state` after a timeout before retrying; creation requests are not idempotent.
- **Preserve existing work:** Keep existing terminals and processes intact. Closing a terminal stops its process. `POST /quit` exits the app but preserves tmux processes; use it only when requested or following the documented development workflow.
- **Protect secrets:** Keep credentials out of prompts and arguments. The API provides no terminal-content capture, input injection, or agent-completion endpoint.
