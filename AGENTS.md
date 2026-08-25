## Working conventions

- Use `rg` for text search and `lit` to parse supported documents.
- When creating a branch, use a short change-based name with no prefix.
- Write user-facing responses in plain language, following ISO 24495-1:2023.

## JPEG work

For JPEG operational or data work, read `~/git/jpeg/jpeg-alex/docs` before choosing a workflow. Use the document that matches the task:

- Infrastructure, logs, restarts, or investigations: `AWS.md`, `Sentry.md`, and `How To/`.
- Database access, schemas, orders, or algorithm parameters: `DB - *.md`.
- Other JPEG work: inspect the relevant documentation in that directory.
- Google Sheets: read `How To/How to access Google Sheets with Python.md` before accessing a sheet in an agent or code.

## Guardrails

Use `@aliou/pi-guardrails` as the authority for privileged or destructive commands. When it asks for confirmation, explain why the command is needed and request approval; in non-interactive work, treat a blocked command as unavailable. Keep secret environment files protected, including `.env`, `.env.local`, `.env.production`, `.env.prod`, and `.dev.vars`.
