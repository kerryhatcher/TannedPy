# tannedpy: uv-first Python

- Use uv for all Python. Never bare `python`, `python3`, `pip`, or `virtualenv`.
- Standalone/ad-hoc/temp scripts: `#!/usr/bin/env -S uv run --script` shebang + PEP 723 `# /// script` block (requires-python, dependencies), `chmod a+x`, run directly.
- Projects: `uv init` / `uv add` / `uv sync` / `uv run <cmd>` / `uv python pin`. Tools: `uvx <tool>`.
- One-liners: `uv run python -c '...'` (add deps with `--with <pkg>`).
- System python only when the user explicitly asks; mark the command with `# tannedpy: allow`.
