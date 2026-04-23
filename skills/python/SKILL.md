---
name: python
description: Reusable Python environment for agents. Use whenever you want to run Python for scripting, data analysis, scraping, file processing, image work, plotting, or quick automation in a prebuilt uv-managed virtual environment.
---

# Python

Use this skill whenever a task is easier, faster, or safer to solve with Python.

## What this provides

A shared Python 3.14 environment in this directory, managed with `uv`, with common packages already installed for:

- HTTP/API work: `requests`, `httpx`
- HTML parsing and scraping: `beautifulsoup4`, `lxml`
- Data work: `numpy`, `pandas`, `openpyxl`
- Images and CV: `pillow`, `opencv-python`
- Validation/config: `pydantic`, `python-dotenv`, `pyyaml`
- CLI/output: `typer`, `rich`
- Plotting: `matplotlib`

## Preferred usage

Run Python from this skill directory so the environment and dependencies are used consistently.

```bash
cd /Users/alexledger/.pi/agent/skills/python && uv run python your_script.py
```

For inline code:

```bash
cd /Users/alexledger/.pi/agent/skills/python && uv run python - <<'PY'
print('hello from the shared python skill')
PY
```

To run the included smoke test:

```bash
cd /Users/alexledger/.pi/agent/skills/python && uv run python main.py
```

## Notes

- Prefer `uv run python ...` over a system `python` command when you want the packages from this environment.
- If a task needs an extra dependency, add it here with `uv add <package>` so future agents can reuse it.
- After changing dependencies, commit both `pyproject.toml` and `uv.lock`.
