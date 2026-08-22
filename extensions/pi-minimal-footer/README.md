# pi-minimal-footer

A compact custom footer for [pi](https://github.com/earendil-works/pi). This local version shows working-directory and git state, the selected model and thinking level, plus the current context-window gauge.

It intentionally does **not** fetch or display subscription, provider, or model quotas.

## Features

- **Context gauge** — context-window usage and token counts
- **Model and thinking level** — the active model and reasoning setting
- **Git integration** — branch name
- **Responsive layout** — wraps cleanly in narrow terminals

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `PI_MINIMAL_FOOTER_SHOW_CWD` | Show the current working directory | `1` |
| `PI_MINIMAL_FOOTER_SHOW_BRANCH` | Show git branch | `1` |

Accepted false values: `0`, `false`, `no`, and `off` (case-insensitive).

## Notes

- Replaces the default Pi footer via `ctx.ui.setFooter()`.
- Git state refreshes at startup, when Pi reports a branch change, and after each turn.
- No auth tokens are read and no quota API requests are made.
