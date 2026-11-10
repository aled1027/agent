## Working conventions

- Use `rg` for text search and `lit` to parse supported documents.
- When creating a branch, use a short change-based name with no prefix.
- When the user only asks to open a URL, open it in their existing Google Chrome session with `open -a "Google Chrome" "<url>"`. Use browser automation when interaction is requested.
- Write user-facing responses in plain language, following ISO 24495-1:2023 - Plain language.
- If you are ever asked to use plain language, follow ISO 24495-1:2023 - Plain language.
- Only send to, stop, or otherwise manage subagents you spawned in the current session. Other sessions' subagents belong to them; leave them alone even if the user's request seems to include them, and ask instead.

## Read only what you need

Every tool result stays in the conversation and is re-read on every later turn, so large output costs more than it looks.

- Find, then read. Locate the lines with `rg -n`, then read just that part, with `read` and an offset and limit, or `sed -n 'a,bp'`. Read a whole file, doc or diff only when it's shorter than about 200 lines or you need all of it.
- Read each file once per thread. Reuse what you already read.
- Ask for results, not raw data. Use `| head`, add `LIMIT` and aggregate in SQL, or filter in codemode before returning results.
- For diffs, start with `git diff --stat`, then read one file at a time. Skip lock and generated files.

## JPEG work

For JPEG operational or data work, read `~/git/jpeg-group/jpeg-alex/docs` before choosing a workflow. Use the document that matches the task:

- Infrastructure, logs, restarts, or investigations: `AWS.md`, `Sentry.md`, and `How To/`.
- Database access, schemas, orders, or algorithm parameters: `DB - *.md`.
- Other JPEG work: inspect the relevant documentation in that directory.
- Google Sheets: read `How To/How to access Google Sheets with Python.md` before accessing a sheet in an agent or code.
- If a ticket is mentioned, it's likely a Linear ticket. You can access linear using MCP.
- Don't put Linear ticket IDs or links in code, comments, commit messages, PR titles or descriptions, or branch names.

## Guardrails

Use `@aliou/pi-guardrails` as the authority for privileged or destructive commands. When it asks for confirmation, explain why the command is needed and request approval; in non-interactive work, treat a blocked command as unavailable.

If a guarded command is denied or blocked, don't retry it. Either reach the goal with a command that doesn't need approval, or add a TODO that names the exact command and why it's needed so the user can run it later. Then continue with the rest of the task. Keep secret environment files protected, including `.env`, `.env.local`, `.env.production`, `.env.prod`, and `.dev.vars`.
