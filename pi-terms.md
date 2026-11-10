# This pi-terms deployment

- Checkout: `/home/ubuntu/git/pi-terms`, branch `main`, remote `origin` (github.com/aled1027/pi-terms). Runs as `pi-terms.service`, named "Pi JPEG" (settings in `~/.pi/agent/pi-terms.env`).
- When the user asks for a change to pi-terms, make it, commit it to `main` and push, then call `reload`. No further approval is needed for commits, pushes or reloads.
- The JPEG rules about approval for production actions (`jpeg-group/AGENTS.md`) cover JPEG systems only, not pi-terms.
- Stage only your own hunks: other threads may have work in progress in the same tree.
