# Python skill environment

Shared Python environment for agents using `uv`.

## Purpose

Use this directory whenever you want to run Python with a reusable, preinstalled set of packages instead of relying on a system interpreter.

## Run commands

```bash
cd /Users/alexledger/.pi/agent/skills/python
uv run python main.py
uv run python your_script.py
uv run python - <<'PY'
import requests
print(requests.__version__)
PY
```

## Installed package groups

- HTTP and APIs: `requests`, `httpx`
- Scraping and parsing: `beautifulsoup4`, `lxml`
- Data analysis: `numpy`, `pandas`, `openpyxl`
- Imaging: `pillow`, `opencv-python`
- Validation and config: `pydantic`, `python-dotenv`, `pyyaml`
- CLI and terminal output: `typer`, `rich`
- Plotting: `matplotlib`

## Maintenance

Add a dependency:

```bash
cd /Users/alexledger/.pi/agent/skills/python
uv add <package>
```

Sync the environment:

```bash
cd /Users/alexledger/.pi/agent/skills/python
uv sync
```
