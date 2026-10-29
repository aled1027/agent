# pi-01

Things only the pi-01 server (pi-terms) uses. Other machines don't load anything in `hosts/`.

On pi-01, `~/.pi/agent` is a local directory, not this repo:

- `~/.pi/agent/skills` links to this repo's `skills/` (shared skills).
- `~/.pi/agent/settings.json` is local and adds `hosts/pi-01/skills` with `"skills": ["~/git/agent/hosts/pi-01/skills"]`.
- This repo's `AGENTS.md`, `settings.json`, extensions and prompts are **not** used on pi-01. pi-terms has its own system prompt and does not load pi extensions.
- Secrets stay in `~/.pi/agent` on pi-01 and are not in git (`calendar.json`, `calendar-sent.jsonl`).

## Skills

- `proton-calendar`: read Alex's Proton Calendar and send invites from Gmail. Run `npm install` in its folder after cloning.
