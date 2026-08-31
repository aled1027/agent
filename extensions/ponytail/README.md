# Static Ponytail extension

This directory is a local, static copy of Ponytail's Pi extension. Pi loads it from `~/.pi/agent/extensions/ponytail/`. It does not clone or update the upstream repository at startup.

## Original source

- Repository: <https://github.com/DietrichGebert/ponytail>
- Copied version: `4.9.0`
- Copied commit: `2ed6c52c9d7e5e56942508591085fd45dea277d3`

The original Pi package provided six skills and one extension. The skills are stored separately in `~/.pi/agent/skills/`:

- `ponytail`
- `ponytail-audit`
- `ponytail-debt`
- `ponytail-gain`
- `ponytail-help`
- `ponytail-review`

## Contents

- `index.js` registers Ponytail commands, persistent mode, the status indicator, and prompt injection.
- `hooks/ponytail-config.js` reads and writes Ponytail settings.
- `hooks/ponytail-instructions.js` loads the static core skill.
- `package.json` and `hooks/package.json` preserve the JavaScript module formats required by the extension.

The extension reads its mode settings from `~/.config/ponytail/config.json` unless an environment variable overrides them. It supports `PONYTAIL_DEFAULT_MODE`, `PONYTAIL_QUIET_STARTUP`, and `PONYTAIL_HIDE_STATUS`.

## Update procedure

1. Review the upstream release and compare its Pi extension, hooks, and `skills/` directories with these local copies.
2. Update all six static skill directories in `~/.pi/agent/skills/` if the upstream skills changed.
3. Update `index.js`, `hooks/ponytail-config.js`, and `hooks/ponytail-instructions.js` if their upstream versions changed.
4. Keep these local adaptations after replacing source files:
   - `index.js` imports helpers from `./hooks/`, not `../hooks/`.
   - `hooks/ponytail-instructions.js` reads `../../../skills/ponytail/SKILL.md`.
   - Keep both local `package.json` files.
5. Restart Pi or run `/reload`.

Do not add `git:github.com/DietrichGebert/ponytail` back to `~/.pi/agent/settings.json`. That would restore startup cloning and package-managed updates.
