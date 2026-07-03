---
name: uv-scripting
description: Use when writing ANY standalone, ad-hoc, temporary, or self-contained Python script — including quick scripts to accomplish a task. Creates uv-shebang PEP 723 scripts that carry their own Python version and dependencies, with no system python and no manual venv.
---

# Self-Contained Python Scripts with uv

Every standalone Python script gets this shape — no exceptions:

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests", "rich"]
# ///
import requests
from rich import print
...
```

Then make it executable and run it directly:

```bash
chmod a+x script.py
./script.py
```

uv resolves the PEP 723 block into a cached, isolated environment on first run. No venv activation, no pip, no system python — any Python version and any libraries, per script.

## Rules

1. **Shebang is exactly** `#!/usr/bin/env -S uv run --script`. The `-S` splits the line into separate argv entries; `--script` prevents recursion on non-.py files and isolates the script from any surrounding project.
2. **No dependencies?** Still include the block with `dependencies = []` — it keeps the script self-describing and project-isolated.
3. **Temp scripts** go in your scratchpad/tmp directory, not the user's project, unless they're a deliverable.
4. **Add a dep to an existing script:** `uv add --script script.py <package>` (edits the PEP 723 block for you).
5. **Start from a template:** `uv init --script script.py --python 3.13`.
6. **One-liners** don't need a file: `uv run python -c '...'` or with deps: `uv run --with requests python -c '...'`.
7. **Reproducibility** (durable tools only): `uv lock --script script.py` creates a lockfile; `# exclude-newer = "2026-07-03T00:00:00Z"` in the block pins resolution in time. Skip for throwaway scripts.
8. **Inside a project** the script's inline metadata wins — project dependencies are intentionally ignored. If you want the project env instead, that's `uv run <script>` *without* inline metadata (see the uv-projects skill).

## Traps

- Omitting `--script` on a file without a `.py` extension can cause infinite recursion (uv re-invoking itself). Always include it.
- The shebang needs `env -S`: present on macOS (FreeBSD-derived) and Linux coreutils ≥ 8.30 (2018). BusyBox `env` lacks it — inside minimal containers run `uv run --script script.py` explicitly.
- If system python was explicitly requested by the user, append `# tannedpy: allow` to the command to pass the guard — never use it just because a command was blocked.
