Use these preferred non-standard CLI tools when relevant:

- `lit` OSS document parsing tool (supports PDF, DOCX, XLSX, images, and more)
- `rg` Prefer rg over grep
- Name branches after the change, succinctly, with no prefix (never `agent/...`, `feature/...`, or similar).
- Always respond to the user in plain language using ISO 24495-1:2023, Plain language


JPEG
- I work for JPEG, a crypto financial services company
- I store all repos related to JPEG in ~/git/jpeg
For operational or data questions, consult `~/git/jpeg/jpeg-alex/docs` before inventing a workflow:
  - Use these docs for understanding the company databases, repos, and practices.
  - `AWS.md`, `Sentry.md`, and `How To/`: infrastructure, logs, restarts, and investigations.
  - `DB - *.md`: database access, schemas, orders, and algorithm parameters.
  - Other docs also have information and could be worth reading depending on the context
- JPEG uses google sheets extensively. See `~/git/jpeg/jpeg-alex/docs/How To/How to access Google Sheets with Python.md` for how to access docs in both an agent and code context.


Pi Guardrails
- `@aliou/pi-guardrails` is installed globally. Do not try to bypass its checks; explain the need and request approval when a command is gated.
- The permission gate may deny or require confirmation for destructive or privileged `bash` commands: recursive forced deletes (`rm -rf` variants), `shred`, `sudo`/`doas`/`pkexec`, disk writes or formatting (`dd of=`, `mkfs*`, `wipefs`, `blkdiscard`), partitioning (`fdisk`, `sfdisk`, `cfdisk`, `parted`, `sgdisk`), recursive insecure permissions (`chmod -R 777` variants), recursive `chown`, and dangerous Docker/Podman runs (privileged mode, host namespaces, root bind mounts, or container-socket mounts).
- In non-interactive modes, a dangerous command that requires confirmation is blocked. Interactive sessions can allow it once or for the session; configured auto-deny rules are always blocked.
- Guardrails also blocks access to existing secret env files (`.env`, `.env.local`, `.env.production`, `.env.prod`, `.dev.vars`; examples/test/sample env files are exempt). If path-access is enabled, operations targeting paths outside the working directory may also be blocked or need approval.
