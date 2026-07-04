---
name: uv-projects
description: Use when working on a Python project — managing dependencies, virtual environments, Python versions, or running code, tests, and tools. Replaces pip, venv, pyenv, and pipx workflows with uv.
---

# Python Projects with uv

If `uv` is installed (`command -v uv`), it manages everything: dependencies, venvs, Python versions, tool execution. Never call pip, venv, virtualenv, or system python directly.

| Instead of | Use |
|---|---|
| `pip install x` | `uv add x` (dev tools: `uv add --dev x`) |
| `pip uninstall x` | `uv remove x` |
| `pip install -r requirements.txt` | `uv add -r requirements.txt` |
| `python -m venv && source activate` | nothing — `uv run` handles it |
| `python script.py` / `pytest` / `ruff` | `uv run script.py` / `uv run pytest` / `uv run ruff` |
| `pipx run tool` | `uvx tool` |
| `pyenv install 3.13` | `uv python install 3.13`; pin with `uv python pin 3.13` |

## Workflows

- **New project:** `uv init` (creates pyproject.toml, .python-version, git-ready layout).
- **Existing uv project** (has `uv.lock`): `uv sync` to materialize the env, `uv run <cmd>` for everything.
- **Migrating a pip project:** `uv init` (or hand-write `[project]` in pyproject.toml), then `uv add -r requirements.txt`, verify with `uv run pytest`, then delete requirements.txt and venv activation from docs/CI. The uv-migrator agent automates this.
- **Standalone scripts** that shouldn't join the project env: give them inline PEP 723 metadata instead — see the uv-scripting skill.

## Escape hatch etiquette

The tannedpy guard blocks bare python/pip. The `# tannedpy: allow` suffix bypasses it — use it ONLY when the user has explicitly asked for system python/pip, never merely because a command was denied.
