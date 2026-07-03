# TannedPy Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tannedpy plugin: portable skills/agents plus per-harness hooks that force AI agents to use uv (shebang `#!/usr/bin/env -S uv run --script` + PEP 723) instead of system python.

**Architecture:** One repo laid out per the open-plugins spec. A stdlib-only Python guard script (itself uv-shebanged) denies bare python/pip in Claude Code's PreToolUse hook with a redirect message; `shared/patterns.json` is the single source of truth also consumed by thin TypeScript adapters for opencode and pi. Skills and agents are portable markdown.

**Tech Stack:** uv, Python ≥3.10 (stdlib only in the guard), pytest + ruff (dev only), TypeScript (adapters, no build step), Claude Code plugin format (plugin.json / hooks.json / SKILL.md).

**Spec:** `docs/superpowers/specs/2026-07-03-tannedpy-plugin-design.md`

## Global Constraints

- All Python runs through uv: `uv run pytest`, `uv run ruff check .` — never `python`/`pip`.
- The guard script is **stdlib-only**: PEP 723 block has `requires-python = ">=3.10"`, `dependencies = []`.
- Escape hatch marker is the exact string `# tannedpy: allow`.
- Fail open: the guard must exit 0 in every code path, including crashes.
- Deny via JSON `permissionDecision`, never via exit code 2.
- Conventional commits; run `uv run ruff check .` before every commit.
- One deviation from the spec, locked in here: the guard file is `tannedpy_guard.py` (underscore, not hyphen) so tests can import it as a module.

## File Structure

```
tannedpy/
├── .plugin/plugin.json               # Task 3 — generic open-plugins manifest
├── .claude-plugin/
│   ├── plugin.json                   # Task 3 — Claude Code vendor manifest
│   └── marketplace.json              # Task 3 — enables local /plugin install
├── shared/patterns.json              # Task 1 — deny/allow rules + messages
├── hooks/
│   ├── hooks.json                    # Task 3
│   └── scripts/
│       ├── tannedpy_guard.py          # Tasks 1-2 — enforcement engine
│       └── session-context.sh        # Task 3
├── skills/
│   ├── uv-scripting/SKILL.md         # Task 4
│   └── uv-projects/SKILL.md          # Task 4
├── rules/tannedpy.md                  # Task 4
├── agents/
│   ├── uv-scripter.md                # Task 5
│   └── uv-migrator.md                # Task 5
├── adapters/
│   ├── opencode/
│   │   ├── tannedpy.ts                # Task 7
│   │   ├── opencode-permissions.json # Task 7
│   │   └── README.md                 # Task 7
│   └── pi/
│       ├── index.ts                  # Task 8
│       └── README.md                 # Task 8
├── tests/test_guard.py               # Tasks 1-2
├── pyproject.toml                    # Task 1 (modify existing scaffold)
├── main.py                           # Task 1 (delete — uv init scaffold)
└── README.md                         # Task 9 (replace empty scaffold file)
```

---

### Task 1: Pattern rules + guard decision engine (pure logic)

**Files:**
- Create: `shared/patterns.json`
- Create: `hooks/scripts/tannedpy_guard.py`
- Test: `tests/test_guard.py`
- Modify: `pyproject.toml` (dev deps via uv)
- Delete: `main.py` (uv init scaffold)

**Interfaces:**
- Produces: `split_segments(command: str) -> list[str]`; `extract_invocation(segment: str, wrappers: frozenset[str]) -> tuple[str | None, list[str]]`; `evaluate(command: str, patterns: dict) -> str | None` (deny reason, or None to allow); `load_patterns() -> dict` reading `shared/patterns.json` relative to the script. Task 2's `main()` and Task 7/8 adapters rely on these semantics and on the patterns.json schema below.

- [ ] **Step 1: Set up dev tooling and remove scaffold**

```bash
cd /home/kwhatcher/projects/tannedpy
rm main.py
uv add --dev pytest ruff
```

Expected: `pyproject.toml` gains a `[dependency-groups]` dev section; `uv.lock` created.

- [ ] **Step 2: Write `shared/patterns.json`**

```json
{
  "escape_hatch": "# tannedpy: allow",
  "deny_command_pattern": "^(python(\\d(\\.\\d+)*)?|pip(\\d(\\.\\d+)*)?|virtualenv|easy_install)$",
  "lookup_commands": ["which", "type", "whereis", "command", "hash"],
  "wrapper_commands": ["env", "nohup", "time", "sudo", "xargs", "exec", "nice", "stdbuf"],
  "version_args": [["--version"], ["-V"]],
  "messages": {
    "run": "tannedpy: system python is blocked. Use uv instead — run an existing script with `uv run <script.py>`; for a new ad-hoc script, give it a `#!/usr/bin/env -S uv run --script` shebang plus a PEP 723 `# /// script` block declaring requires-python and dependencies (see the uv-scripting skill), `chmod a+x` it, and execute it directly. One-liners: `uv run python -c '...'`. If the user explicitly asked for system python, re-run this exact command with `# tannedpy: allow` appended.",
    "install": "tannedpy: pip is blocked. Use uv instead — in a project: `uv add <package>` (dev: `uv add --dev`); for a self-contained script: `uv add --script <script.py> <package>`; to run a tool once: `uvx <tool>`. If the user explicitly asked for pip, re-run this exact command with `# tannedpy: allow` appended.",
    "venv": "tannedpy: manual venv management is blocked. uv manages environments automatically — in a project use `uv init` / `uv sync` and run things with `uv run <cmd>`; self-contained scripts with PEP 723 metadata get ephemeral environments from `uv run --script`. If the user explicitly asked for a manual venv, re-run this exact command with `# tannedpy: allow` appended."
  }
}
```

- [ ] **Step 3: Write the failing unit tests**

Create `tests/test_guard.py`:

```python
"""Tests for the tannedpy guard decision engine."""

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
GUARD_PATH = REPO / "hooks" / "scripts" / "tannedpy_guard.py"

_spec = importlib.util.spec_from_file_location("tannedpy_guard", GUARD_PATH)
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

PATTERNS = json.loads((REPO / "shared" / "patterns.json").read_text())


# --- split_segments -------------------------------------------------------

@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("python3 foo.py", ["python3 foo.py"]),
        ("cd /tmp && python3 foo.py", ["cd /tmp", "python3 foo.py"]),
        ("a; b | c || d", ["a", "b", "c", "d"]),
        ("echo 'a && b'", ["echo 'a && b'"]),
        ('echo "x; y"', ['echo "x; y"']),
        ("line1\nline2", ["line1", "line2"]),
    ],
)
def test_split_segments(command, expected):
    assert guard.split_segments(command) == expected


# --- extract_invocation ----------------------------------------------------

WRAPPERS = frozenset(PATTERNS["wrapper_commands"])


@pytest.mark.parametrize(
    ("segment", "word", "args"),
    [
        ("python3 foo.py", "python3", ["foo.py"]),
        ("/usr/bin/python3 foo.py", "python3", ["foo.py"]),
        ("FOO=1 BAR=2 python x.py", "python", ["x.py"]),
        ("sudo python3 x.py", "python3", ["x.py"]),
        ("env python x.py", "python", ["x.py"]),
        ("grep python file.txt", "grep", ["python", "file.txt"]),
        ("", None, []),
    ],
)
def test_extract_invocation(segment, word, args):
    assert guard.extract_invocation(segment, WRAPPERS) == (word, args)


def test_extract_invocation_unparseable_returns_none():
    # Unclosed quote makes shlex raise; we must not crash.
    assert guard.extract_invocation("echo 'unclosed", WRAPPERS) == (None, [])


# --- evaluate: denials -----------------------------------------------------

@pytest.mark.parametrize(
    "command",
    [
        "python3 foo.py",
        "python foo.py",
        "python3.12 foo.py",
        "/usr/bin/python3 foo.py",
        "pip install requests",
        "pip3 install requests",
        "cd /tmp && python3 foo.py",
        "ls; python x.py",
        "python -m venv .venv",
        "python3 -m pip install x",
        "virtualenv env",
        "easy_install thing",
        "sudo python3 x.py",
        "FOO=1 python x.py",
    ],
)
def test_denied(command):
    assert guard.evaluate(command, PATTERNS) is not None


# --- evaluate: allowed -----------------------------------------------------

@pytest.mark.parametrize(
    "command",
    [
        "uv run python foo.py",
        "uv run python -c 'print(1)'",
        "uv add requests",
        "uvx ruff check",
        "python --version",
        "python3 -V",
        "which python3",
        "command -v python",
        "type python3",
        "grep python file.txt",
        "echo 'python3 is old'",
        'echo "run: pip install x"',
        "cat requirements.txt",
        "python3 x.py  # tannedpy: allow",
        "pip install x  # tannedpy: allow",
        "git commit -m 'fix python handling'",
        "",
    ],
)
def test_allowed(command):
    assert guard.evaluate(command, PATTERNS) is None


# --- evaluate: message selection -------------------------------------------

def test_pip_gets_install_message():
    reason = guard.evaluate("pip install requests", PATTERNS)
    assert "uv add" in reason


def test_venv_gets_venv_message():
    reason = guard.evaluate("python -m venv .venv", PATTERNS)
    assert "uv init" in reason or "uv sync" in reason


def test_python_m_pip_gets_install_message():
    reason = guard.evaluate("python3 -m pip install x", PATTERNS)
    assert "uv add" in reason


def test_plain_python_gets_run_message():
    reason = guard.evaluate("python3 foo.py", PATTERNS)
    assert "uv run" in reason and "--script" in reason
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `uv run pytest tests/test_guard.py -v`
Expected: FAIL at module load — `FileNotFoundError` for `hooks/scripts/tannedpy_guard.py`.

- [ ] **Step 5: Write the guard's pure logic**

Create `hooks/scripts/tannedpy_guard.py` (executable):

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""tannedpy guard — PreToolUse hook that denies system python and redirects to uv.

Reads Claude Code PreToolUse JSON on stdin. On a bare python/pip/virtualenv
invocation, prints a JSON permissionDecision "deny" with a redirect message.
Fails open: every code path exits 0.
"""

import json
import re
import shlex
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def load_patterns() -> dict:
    return json.loads((SCRIPT_DIR.parent.parent / "shared" / "patterns.json").read_text())


def split_segments(command: str) -> list[str]:
    """Split a shell command at unquoted &&, ||, ;, | and newlines."""
    segments: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i, n = 0, len(command)
    while i < n:
        ch = command[i]
        if quote:
            if ch == "\\" and quote == '"' and i + 1 < n:
                buf.append(command[i : i + 2])
                i += 2
                continue
            if ch == quote:
                quote = None
            buf.append(ch)
            i += 1
            continue
        if ch in "'\"":
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            buf.append(command[i : i + 2])
            i += 2
            continue
        if command[i : i + 2] in ("&&", "||"):
            segments.append("".join(buf))
            buf = []
            i += 2
            continue
        if ch in ";|\n":
            segments.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    segments.append("".join(buf))
    return [s.strip() for s in segments if s.strip()]


_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def extract_invocation(segment: str, wrappers: frozenset[str]) -> tuple[str | None, list[str]]:
    """Return (command word basename, args), skipping env assignments and wrappers."""
    try:
        tokens = shlex.split(segment, posix=True)
    except ValueError:
        return None, []
    idx = 0
    while idx < len(tokens):
        tok = tokens[idx]
        if _ASSIGNMENT.match(tok):
            idx += 1
            continue
        if tok in wrappers:
            idx += 1
            while idx < len(tokens) and tokens[idx].startswith("-"):
                idx += 1
            continue
        break
    if idx >= len(tokens):
        return None, []
    word = tokens[idx].rsplit("/", 1)[-1]
    return word, tokens[idx + 1 :]


def _pick_message(word: str, args: list[str], messages: dict) -> str:
    if word.startswith("pip") or word == "easy_install":
        return messages["install"]
    if word == "virtualenv" or args[:2] == ["-m", "venv"]:
        return messages["venv"]
    if args[:2] == ["-m", "pip"]:
        return messages["install"]
    return messages["run"]


def evaluate(command: str, patterns: dict) -> str | None:
    """Return a deny reason, or None if the command is allowed."""
    if patterns["escape_hatch"] in command:
        return None
    deny_re = re.compile(patterns["deny_command_pattern"])
    wrappers = frozenset(patterns["wrapper_commands"])
    lookups = frozenset(patterns["lookup_commands"])
    version_args = [list(v) for v in patterns["version_args"]]
    for segment in split_segments(command):
        word, args = extract_invocation(segment, wrappers)
        if word is None or word == "uv" or word in lookups:
            continue
        if deny_re.match(word):
            if args in version_args:
                continue
            return _pick_message(word, args, patterns["messages"])
    return None
```

(`main()` comes in Task 2 — module loads fine without it.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_guard.py -v`
Expected: all PASS.

- [ ] **Step 7: Lint and commit**

```bash
uv run ruff check .
git add shared/patterns.json hooks/scripts/tannedpy_guard.py tests/test_guard.py pyproject.toml uv.lock main.py .python-version
git commit -m "feat(guard): pattern rules and pure decision engine"
```

---

### Task 2: Guard stdin/stdout plumbing + fail-open (end-to-end)

**Files:**
- Modify: `hooks/scripts/tannedpy_guard.py` (append `main()`)
- Test: `tests/test_guard.py` (append end-to-end tests)

**Interfaces:**
- Consumes: `evaluate`, `load_patterns` from Task 1.
- Produces: an executable hook. Stdin: PreToolUse JSON (`{"tool_name": "Bash", "tool_input": {"command": "..."}}`). Stdout on deny: `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "<msg>"}}`. Exit code always 0.

- [ ] **Step 1: Write the failing end-to-end tests**

Append to `tests/test_guard.py`:

```python
# --- end-to-end: run the hook as Claude Code would --------------------------

import subprocess


def run_guard(stdin_text: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(GUARD_PATH)], input=stdin_text, capture_output=True, text=True, timeout=60
    )


def payload(command: str) -> str:
    return json.dumps(
        {"tool_name": "Bash", "tool_input": {"command": command}, "hook_event_name": "PreToolUse"}
    )


def test_e2e_deny_emits_json_and_exits_zero():
    result = run_guard(payload("python3 foo.py"))
    assert result.returncode == 0
    out = json.loads(result.stdout)
    hso = out["hookSpecificOutput"]
    assert hso["hookEventName"] == "PreToolUse"
    assert hso["permissionDecision"] == "deny"
    assert "uv run" in hso["permissionDecisionReason"]


def test_e2e_allow_emits_nothing():
    result = run_guard(payload("uv run pytest"))
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_e2e_non_bash_tool_ignored():
    result = run_guard(json.dumps({"tool_name": "Write", "tool_input": {"file_path": "python"}}))
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_e2e_malformed_input_fails_open():
    result = run_guard("this is not json {{{")
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_e2e_empty_input_fails_open():
    result = run_guard("")
    assert result.returncode == 0
    assert result.stdout.strip() == ""
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `uv run pytest tests/test_guard.py -v -k e2e`
Expected: FAIL — `PermissionError` or empty output (no `main()` yet; script does nothing when executed).

- [ ] **Step 3: Implement `main()` and make the file executable**

Append to `hooks/scripts/tannedpy_guard.py`:

```python
def main() -> None:
    data = json.loads(sys.stdin.read())
    if data.get("tool_name") != "Bash":
        return
    command = (data.get("tool_input") or {}).get("command") or ""
    reason = evaluate(command, load_patterns())
    if reason:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    }
                }
            )
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # fail open: never break the agent's shell
        print(f"tannedpy-guard: internal error, failing open: {exc}", file=sys.stderr)
    sys.exit(0)
```

Then:

```bash
chmod a+x hooks/scripts/tannedpy_guard.py
```

- [ ] **Step 4: Run the full suite**

Run: `uv run pytest tests/test_guard.py -v`
Expected: all PASS (e2e tests exercise the real uv shebang — uv is installed here).

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check .
git add hooks/scripts/tannedpy_guard.py tests/test_guard.py
git commit -m "feat(guard): stdin/stdout hook plumbing with fail-open"
```

---

### Task 3: Manifests, hooks.json, SessionStart context

**Files:**
- Create: `.plugin/plugin.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `hooks/hooks.json`
- Create: `hooks/scripts/session-context.sh`

**Interfaces:**
- Consumes: `hooks/scripts/tannedpy_guard.py` (Task 2).
- Produces: an installable Claude Code plugin; `session-context.sh` prints context text to stdout iff `uv` is on PATH, else nothing, exit 0 either way.

- [ ] **Step 1: Write both plugin manifests**

`.plugin/plugin.json` and `.claude-plugin/plugin.json` — identical content:

```json
{
  "name": "tannedpy",
  "version": "0.1.0",
  "description": "Forces AI agents to use uv for all Python: self-contained PEP 723 scripts with '#!/usr/bin/env -S uv run --script' shebangs, and uv init/add/run for projects. Blocks bare python/pip with redirect guidance.",
  "author": {"name": "Kerry Hatcher"},
  "license": "MIT",
  "keywords": ["uv", "python", "pep723", "hooks", "enforcement"],
  "hooks": "./hooks/hooks.json",
  "skills": "./skills/",
  "agents": "./agents/",
  "rules": "./rules/"
}
```

- [ ] **Step 2: Write the local marketplace manifest**

`.claude-plugin/marketplace.json` (enables `/plugin marketplace add <repo path>` for local install):

```json
{
  "name": "tannedpy",
  "owner": {"name": "Kerry Hatcher"},
  "plugins": [
    {
      "name": "tannedpy",
      "source": "./",
      "description": "uv-first enforcement: blocks system python/pip, teaches uv shebang scripts"
    }
  ]
}
```

- [ ] **Step 3: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/tannedpy_guard.py"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-context.sh"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Write `hooks/scripts/session-context.sh`**

```sh
#!/bin/sh
# tannedpy: inject uv-first context at session start — only when uv exists.
command -v uv >/dev/null 2>&1 || exit 0
cat <<'EOF'
tannedpy is active: use uv for ALL Python work. Ad-hoc/temp scripts: create a .py file starting with `#!/usr/bin/env -S uv run --script` plus a PEP 723 `# /// script` block (requires-python + dependencies), chmod a+x, run it directly (see the uv-scripting skill). Projects: uv init / uv add / uv sync / uv run (see the uv-projects skill). Bare python/pip commands are blocked.
EOF
exit 0
```

Then: `chmod a+x hooks/scripts/session-context.sh`

- [ ] **Step 5: Verify the pieces by hand**

```bash
sh hooks/scripts/session-context.sh            # expect the context paragraph
uv run --script - <<'EOF'
# /// script
# dependencies = []
# ///
import json, pathlib
for p in [".plugin/plugin.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "hooks/hooks.json"]:
    json.loads(pathlib.Path(p).read_text())
    print("ok", p)
EOF
```

Expected: context paragraph, then `ok <path>` × 4.

- [ ] **Step 6: Commit**

```bash
git add .plugin .claude-plugin hooks/hooks.json hooks/scripts/session-context.sh
git commit -m "feat(plugin): manifests, hooks wiring, session context injection"
```

---

### Task 4: Skills + rules fragment

**Files:**
- Create: `skills/uv-scripting/SKILL.md`
- Create: `skills/uv-projects/SKILL.md`
- Create: `rules/tannedpy.md`

**Interfaces:**
- Produces: portable Agent Skills consumed as-is by Claude Code, opencode, and pi. The deny messages in `patterns.json` reference "the uv-scripting skill" — the skill name below must stay `uv-scripting`.

- [ ] **Step 1: Write `skills/uv-scripting/SKILL.md`**

````markdown
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
````

- [ ] **Step 2: Write `skills/uv-projects/SKILL.md`**

````markdown
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
````

- [ ] **Step 3: Write `rules/tannedpy.md`**

```markdown
# tannedpy: uv-first Python

- Use uv for all Python. Never bare `python`, `python3`, `pip`, or `virtualenv`.
- Standalone/ad-hoc/temp scripts: `#!/usr/bin/env -S uv run --script` shebang + PEP 723 `# /// script` block (requires-python, dependencies), `chmod a+x`, run directly.
- Projects: `uv init` / `uv add` / `uv sync` / `uv run <cmd>` / `uv python pin`. Tools: `uvx <tool>`.
- One-liners: `uv run python -c '...'` (add deps with `--with <pkg>`).
- System python only when the user explicitly asks; mark the command with `# tannedpy: allow`.
```

- [ ] **Step 4: Verify frontmatter parses**

```bash
uv run --script - <<'EOF'
# /// script
# dependencies = []
# ///
from pathlib import Path
for p in ["skills/uv-scripting/SKILL.md", "skills/uv-projects/SKILL.md"]:
    text = Path(p).read_text()
    assert text.startswith("---"), p
    fm = text.split("---")[1]
    assert "name:" in fm and "description:" in fm, p
    print("ok", p)
EOF
```

Expected: `ok` × 2.

- [ ] **Step 5: Commit**

```bash
git add skills rules
git commit -m "feat(skills): uv-scripting and uv-projects skills plus rules fragment"
```

---

### Task 5: Agents

**Files:**
- Create: `agents/uv-scripter.md`
- Create: `agents/uv-migrator.md`

**Interfaces:**
- Consumes: the uv-scripting / uv-projects skills by name (referenced in agent prompts).
- Produces: two Claude Code subagent definitions (markdown + YAML frontmatter: `name`, `description`, `tools`, `model`).

- [ ] **Step 1: Write `agents/uv-scripter.md`**

```markdown
---
name: uv-scripter
description: Use when the user or main agent needs a standalone Python script/tool written — "write a script that does X", quick data munging, one-off automation. Authors a self-contained uv-shebang PEP 723 script, verifies it runs, and returns the path. Keeps throwaway-script iteration out of the main context.
tools: Bash, Read, Write, Edit, Glob, Grep
model: inherit
---

You are a Python script author. You write SELF-CONTAINED scripts using uv.

Every script you produce:
1. Starts with `#!/usr/bin/env -S uv run --script`.
2. Has a PEP 723 block: `# /// script`, `# requires-python = ">=3.12"` (or as needed), `# dependencies = [...]` (empty list if none), `# ///`.
3. Is `chmod a+x`'d.
4. Is RUN by you at least once to prove it works (`./script.py` or `uv run script.py`). Fix failures before returning.

Never use bare python/pip. Add dependencies with `uv add --script <path> <pkg>` or by editing the block.

Location: temp/task scripts go in the scratchpad or /tmp; deliverables go where the user asked (default: current project, named descriptively).

Return: the script's absolute path, a one-line usage example, and a summary of the verification run (command + observed output).
```

- [ ] **Step 2: Write `agents/uv-migrator.md`**

```markdown
---
name: uv-migrator
description: Use when converting existing Python code to uv — "migrate this repo to uv", modernizing requirements.txt/pip/venv setups, or adding uv shebangs to loose script collections. Audits first, reports, then converts and verifies.
tools: Bash, Read, Write, Edit, Glob, Grep
model: inherit
---

You migrate Python code to uv. ALWAYS audit and report BEFORE modifying anything.

Phase 1 — Audit (read-only). Find and list:
- dependency sources: requirements*.txt, setup.py, setup.cfg, Pipfile, environment.yml
- venv usage: activate calls in Makefiles, CI configs, docs, shell scripts
- interpreter calls: bare `python`/`pip` in scripts, CI, docs; `#!/usr/bin/python` shebangs
- existing pyproject.toml / uv.lock state
Report the findings and the planned conversion as a checklist. Wait for confirmation if invoked interactively; proceed if the caller already approved.

Phase 2 — Convert:
- Project: `uv init` if no pyproject.toml (preserve existing metadata), `uv add -r requirements.txt` (dev groups via `uv add --dev`), `uv python pin` to match the documented version.
- Loose standalone scripts: add `#!/usr/bin/env -S uv run --script` + PEP 723 block with each script's actual imports as dependencies; chmod a+x.
- Replace `python`/`pip` invocations in Makefiles/CI/docs with `uv run` / `uv add` / `uvx` equivalents.

Phase 3 — Verify: `uv sync`, then `uv run pytest` (or the project's test command). Report pass/fail with output. Do NOT delete requirements.txt or old configs unless verification passed and the caller asked for cleanup.

Return: audit summary, list of changes made, verification results, and any leftovers needing human decisions.
```

- [ ] **Step 3: Verify frontmatter parses**

```bash
uv run --script - <<'EOF'
# /// script
# dependencies = []
# ///
from pathlib import Path
for p in ["agents/uv-scripter.md", "agents/uv-migrator.md"]:
    text = Path(p).read_text()
    fm = text.split("---")[1]
    for key in ("name:", "description:", "tools:", "model:"):
        assert key in fm, f"{p} missing {key}"
    print("ok", p)
EOF
```

Expected: `ok` × 2.

- [ ] **Step 4: Commit**

```bash
git add agents
git commit -m "feat(agents): uv-scripter and uv-migrator subagents"
```

---

### Task 6: Live smoke test in Claude Code

**Files:**
- None created; fixes go to whichever file misbehaves.

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: verified plugin behavior in a real Claude Code session. The plugin is usable for daily work after this task.

- [ ] **Step 1: Install the plugin locally**

In a Claude Code session (any directory):

```
/plugin marketplace add /home/kwhatcher/projects/tannedpy
/plugin install tannedpy@tannedpy
```

Then restart the session so hooks load.

- [ ] **Step 2: Verify SessionStart context**

Start a new session; confirm the "tannedpy is active" line appears in context (ask the agent "is tannedpy active?" — it should reference the injected context).

- [ ] **Step 3: Verify the deny + redirect**

Ask the agent to run `python3 -c "print('hi')"` verbatim. Expected: the Bash call is denied, the transcript shows the tannedpy redirect message, and the agent retries with `uv run python -c "print('hi')"` successfully.

- [ ] **Step 4: Verify allowed paths**

Ask the agent to run `python3 --version` and `which python3`. Expected: both execute without interference.

- [ ] **Step 5: Verify the escape hatch**

Ask the agent to run `python3 -c "print('hi')"  # tannedpy: allow` verbatim. Expected: executes.

- [ ] **Step 6: Fix anything that failed, re-test, commit**

```bash
uv run pytest && uv run ruff check .
git add -u
git commit -m "fix(plugin): smoke-test fixes for live Claude Code behavior"
```

(Skip the commit if nothing needed fixing.)

---

### Task 7: opencode adapter

**Files:**
- Create: `adapters/opencode/tannedpy.ts`
- Create: `adapters/opencode/opencode-permissions.json`
- Create: `adapters/opencode/README.md`

**Interfaces:**
- Consumes: `shared/patterns.json` schema from Task 1 (`escape_hatch`, `deny_command_pattern`, `lookup_commands`, `wrapper_commands`, `version_args`, `messages`).
- Produces: an opencode plugin exporting `TannedPyPlugin` implementing `tool.execute.before`.

- [ ] **Step 1: Write `adapters/opencode/tannedpy.ts`**

```typescript
// tannedpy opencode adapter — denies system python, redirects to uv.
// Mirrors hooks/scripts/tannedpy_guard.py; rules come from shared/patterns.json.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const patterns = JSON.parse(
  readFileSync(join(here, "..", "..", "shared", "patterns.json"), "utf8"),
)

const denyRe = new RegExp(patterns.deny_command_pattern)
const wrappers = new Set<string>(patterns.wrapper_commands)
const lookups = new Set<string>(patterns.lookup_commands)
const versionArgs: string[][] = patterns.version_args

function splitSegments(command: string): string[] {
  const segments: string[] = []
  let buf = ""
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        buf += command.slice(i, i + 2); i++; continue
      }
      if (ch === quote) quote = null
      buf += ch; continue
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue }
    if (ch === "\\" && i + 1 < command.length) { buf += command.slice(i, i + 2); i++; continue }
    if (command.slice(i, i + 2) === "&&" || command.slice(i, i + 2) === "||") {
      segments.push(buf); buf = ""; i++; continue
    }
    if (ch === ";" || ch === "|" || ch === "\n") { segments.push(buf); buf = ""; continue }
    buf += ch
  }
  segments.push(buf)
  return segments.map((s) => s.trim()).filter(Boolean)
}

function tokens(segment: string): string[] {
  // Light tokenizer: strip quotes, split on whitespace. Parity with shlex
  // is not required — only the command word position matters here.
  const out: string[] = []
  const re = /'([^']*)'|"((?:\\.|[^"])*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function extractInvocation(segment: string): [string | null, string[]] {
  const toks = tokens(segment)
  let idx = 0
  while (idx < toks.length) {
    const tok = toks[idx]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) { idx++; continue }
    if (wrappers.has(tok)) {
      idx++
      while (idx < toks.length && toks[idx].startsWith("-")) idx++
      continue
    }
    break
  }
  if (idx >= toks.length) return [null, []]
  const word = toks[idx].split("/").pop() ?? toks[idx]
  return [word, toks.slice(idx + 1)]
}

function pickMessage(word: string, args: string[]): string {
  const m = patterns.messages
  if (word.startsWith("pip") || word === "easy_install") return m.install
  if (word === "virtualenv" || (args[0] === "-m" && args[1] === "venv")) return m.venv
  if (args[0] === "-m" && args[1] === "pip") return m.install
  return m.run
}

export function evaluate(command: string): string | null {
  if (command.includes(patterns.escape_hatch)) return null
  for (const segment of splitSegments(command)) {
    const [word, args] = extractInvocation(segment)
    if (word === null || word === "uv" || lookups.has(word)) continue
    if (denyRe.test(word)) {
      if (versionArgs.some((v) => v.length === args.length && v.every((x, i) => x === args[i]))) continue
      return pickMessage(word, args)
    }
  }
  return null
}

export const TannedPyPlugin = async () => {
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args: { command?: string } },
    ) => {
      if (input.tool !== "bash") return
      const reason = evaluate(output.args.command ?? "")
      if (reason) throw new Error(reason)
    },
  }
}
```

- [ ] **Step 2: Write `adapters/opencode/opencode-permissions.json`**

Defense-in-depth snippet (opencode plugin hooks don't fire for subagent tool calls):

```json
{
  "permission": {
    "bash": {
      "*": "allow",
      "python *": "deny",
      "python2 *": "deny",
      "python3 *": "deny",
      "python3.* *": "deny",
      "pip *": "deny",
      "pip3 *": "deny",
      "virtualenv *": "deny",
      "uv *": "allow",
      "uvx *": "allow"
    }
  }
}
```

- [ ] **Step 3: Write `adapters/opencode/README.md`**

```markdown
# tannedpy — opencode adapter

## Install

1. Clone the tannedpy repo (the adapter reads `shared/patterns.json` from it).
2. Symlink the plugin into your opencode plugin dir:
   `ln -s /path/to/tannedpy/adapters/opencode/tannedpy.ts ~/.config/opencode/plugin/tannedpy.ts`
   — NOTE: a symlink breaks the relative path to shared/patterns.json; instead
   reference the file directly in `opencode.json`:
   `{ "plugin": ["/path/to/tannedpy/adapters/opencode/tannedpy.ts"] }`
3. Defense-in-depth (recommended — plugin hooks do NOT fire for subagent tool
   calls, opencode issue #5894): merge `opencode-permissions.json` into your
   `opencode.json`.
4. Skills: opencode reads Claude-format skills from `~/.claude/skills/`. Symlink
   them: `ln -s /path/to/tannedpy/skills/uv-scripting ~/.claude/skills/` (and
   uv-projects), or install tannedpy as a Claude Code plugin on the same machine.
5. Rules: append `rules/tannedpy.md` to your global or project `AGENTS.md`.

## Verify

Run opencode, ask it to execute `python3 -c "print(1)"` — expect the tannedpy
deny message and a `uv run` retry. `python3 --version` should pass.
```

- [ ] **Step 4: Type-check / smoke the evaluate logic**

If `bun` is available: create a throwaway check (do not commit):

```bash
bun -e 'const { evaluate } = await import("./adapters/opencode/tannedpy.ts");
const cases = [["python3 x.py", true], ["uv run python x.py", false], ["python --version", false], ["pip install x", true], ["grep python f", false]];
for (const [cmd, deny] of cases) { const r = evaluate(cmd) !== null; if (r !== deny) throw new Error(`MISMATCH ${cmd}`); console.log("ok", cmd) }'
```

Expected: `ok` × 5. If bun is not installed, note it in the commit message and rely on Task 6-style live verification later.

- [ ] **Step 5: Commit**

```bash
git add adapters/opencode
git commit -m "feat(adapters): opencode tool.execute.before adapter with permission fallback"
```

---

### Task 8: pi adapter

**Files:**
- Create: `adapters/pi/index.ts`
- Create: `adapters/pi/README.md`

**Interfaces:**
- Consumes: `shared/patterns.json` schema (Task 1); same segment/command-word semantics.
- Produces: a pi extension registering a `tool_call` handler that returns `{ block: true, reason }`.

**NOTE:** pi's extension API surface in our research came partly from third-party docs (deepwiki, community posts) and is marked _(unverified)_ in places. Before writing code, fetch https://pi.dev/docs/latest/ extension/hook pages and confirm: registration entry point, event name (`tool_call` vs `beforeToolCall`), and block-return shape. Adjust the code below to match reality — the shared logic stays identical.

- [ ] **Step 1: Verify pi's current extension API against official docs**

Fetch pi.dev docs for extensions/hooks. Record the confirmed entry point and event names in `adapters/pi/README.md`.

- [ ] **Step 2: Write `adapters/pi/index.ts`**

Shape per research (adjust names per Step 1 findings):

```typescript
// tannedpy pi adapter — denies system python, redirects to uv.
// Shares shared/patterns.json with the Python guard and opencode adapter.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const patterns = JSON.parse(
  readFileSync(join(here, "..", "..", "shared", "patterns.json"), "utf8"),
)

const denyRe = new RegExp(patterns.deny_command_pattern)
const wrappers = new Set<string>(patterns.wrapper_commands)
const lookups = new Set<string>(patterns.lookup_commands)
const versionArgs: string[][] = patterns.version_args

function splitSegments(command: string): string[] {
  const segments: string[] = []
  let buf = ""
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        buf += command.slice(i, i + 2); i++; continue
      }
      if (ch === quote) quote = null
      buf += ch; continue
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue }
    if (ch === "\\" && i + 1 < command.length) { buf += command.slice(i, i + 2); i++; continue }
    if (command.slice(i, i + 2) === "&&" || command.slice(i, i + 2) === "||") {
      segments.push(buf); buf = ""; i++; continue
    }
    if (ch === ";" || ch === "|" || ch === "\n") { segments.push(buf); buf = ""; continue }
    buf += ch
  }
  segments.push(buf)
  return segments.map((s) => s.trim()).filter(Boolean)
}

function tokens(segment: string): string[] {
  const out: string[] = []
  const re = /'([^']*)'|"((?:\\.|[^"])*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function extractInvocation(segment: string): [string | null, string[]] {
  const toks = tokens(segment)
  let idx = 0
  while (idx < toks.length) {
    const tok = toks[idx]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) { idx++; continue }
    if (wrappers.has(tok)) {
      idx++
      while (idx < toks.length && toks[idx].startsWith("-")) idx++
      continue
    }
    break
  }
  if (idx >= toks.length) return [null, []]
  const word = toks[idx].split("/").pop() ?? toks[idx]
  return [word, toks.slice(idx + 1)]
}

function pickMessage(word: string, args: string[]): string {
  const m = patterns.messages
  if (word.startsWith("pip") || word === "easy_install") return m.install
  if (word === "virtualenv" || (args[0] === "-m" && args[1] === "venv")) return m.venv
  if (args[0] === "-m" && args[1] === "pip") return m.install
  return m.run
}

export function evaluate(command: string): string | null {
  if (command.includes(patterns.escape_hatch)) return null
  for (const segment of splitSegments(command)) {
    const [word, args] = extractInvocation(segment)
    if (word === null || word === "uv" || lookups.has(word)) continue
    if (denyRe.test(word)) {
      if (versionArgs.some((v) => v.length === args.length && v.every((x, i) => x === args[i]))) continue
      return pickMessage(word, args)
    }
  }
  return null
}

// Registration — confirm exact API in Step 1. Research shape:
export default function tannedpy(pi: {
  on: (event: string, handler: (ctx: { toolName: string; args: Record<string, unknown> }) =>
    { block: true; reason: string } | undefined) => void
}) {
  pi.on("tool_call", ({ toolName, args }) => {
    if (toolName !== "bash") return undefined
    const reason = evaluate(String(args.command ?? ""))
    if (reason) return { block: true, reason }
    return undefined
  })
}
```

- [ ] **Step 3: Write `adapters/pi/README.md`**

```markdown
# tannedpy — pi adapter

## Install

pi extensions load from `~/.pi/agent/extensions/` (global) or `.pi/extensions/`
(project) — confirm against your pi version's docs. Reference this file's real
path so it can find `shared/patterns.json`:

    ln -s /path/to/tannedpy/adapters/pi ~/.pi/agent/extensions/tannedpy  # dir symlink keeps relative paths intact

## API note

Handler registration verified against pi docs on <DATE FILLED IN AT TASK 8 STEP 1>:
event `<confirmed event name>`, block shape `<confirmed shape>`.

## Skills

pi consumes Agent Skills (SKILL.md) natively. Point pi at tannedpy's `skills/`
directory per pi's skills config, or symlink the two skill folders into your
pi skills location.

## Alternative: PizzaPi

The PizzaPi fork maps Claude Code plugins directly (PreToolUse → tool_call).
If you run PizzaPi, install tannedpy as a Claude Code plugin instead of using
this adapter.

## Verify

Ask pi to run `python3 -c "print(1)"` — expect the tannedpy block reason and a
`uv run` retry. `python3 --version` should pass.
```

- [ ] **Step 4: Smoke the evaluate logic (if bun available)**

```bash
bun -e 'const { evaluate } = await import("./adapters/pi/index.ts");
const cases = [["python3 x.py", true], ["uv run python x.py", false], ["python --version", false]];
for (const [cmd, deny] of cases) { const r = evaluate(cmd) !== null; if (r !== deny) throw new Error(`MISMATCH ${cmd}`); console.log("ok", cmd) }'
```

Expected: `ok` × 3.

- [ ] **Step 5: Commit**

```bash
git add adapters/pi
git commit -m "feat(adapters): pi tool_call extension"
```

---

### Task 9: README + final verification

**Files:**
- Modify: `README.md` (currently empty scaffold)

**Interfaces:**
- Consumes: everything.
- Produces: install/usage documentation for all three harnesses.

- [ ] **Step 1: Write `README.md`**

````markdown
# tannedpy 🔥

Forces AI coding agents to use [uv](https://docs.astral.sh/uv/) for all Python —
no system python, no pip, no manual venvs.

- **Ad-hoc scripts** become self-contained: `#!/usr/bin/env -S uv run --script`
  shebang + [PEP 723](https://peps.python.org/pep-0723/) inline metadata means
  any Python version and any dependencies, per script, with zero setup.
- **Projects** run through `uv init` / `uv add` / `uv sync` / `uv run`.
- Bare `python` / `pip` / `virtualenv` calls are **denied with a redirect
  message** that teaches the agent the uv equivalent. Fail-open by design: no
  uv on the machine → tannedpy goes inert.

## What's inside

| Component | Purpose |
|---|---|
| `skills/uv-scripting` | The self-contained script recipe (portable Agent Skill) |
| `skills/uv-projects` | uv project workflows + pip migration (portable Agent Skill) |
| `agents/uv-scripter` | Delegate that writes & verifies standalone uv scripts |
| `agents/uv-migrator` | Delegate that audits & converts repos to uv |
| `hooks/` | Claude Code PreToolUse guard + SessionStart context |
| `shared/patterns.json` | Single source of truth for deny/allow rules & messages |
| `adapters/opencode` | opencode `tool.execute.before` plugin + permission snippet |
| `adapters/pi` | pi `tool_call` extension |
| `rules/tannedpy.md` | Rules fragment for AGENTS.md-style harnesses |

## Install

### Claude Code

```
/plugin marketplace add /path/to/tannedpy   # or the git URL
/plugin install tannedpy@tannedpy
```

### opencode / pi

See `adapters/opencode/README.md` and `adapters/pi/README.md`.

## Escape hatch

When the user explicitly asks for system python, agents append `# tannedpy: allow`
to the command. That exact marker bypasses the guard — by policy, only on
explicit user request.

## Development

```bash
uv run pytest        # guard engine test suite
uv run ruff check .  # lint
```

Design docs: `docs/superpowers/specs/`. Research: grimoire `research/` topics
`uv-single-file-scripts`, `open-plugins-spec`, `pi-agent-harness`,
`opencode-plugins`, `claude-code-hooks`.
````

- [ ] **Step 2: Full verification pass**

```bash
uv run pytest -v
uv run ruff check .
sh hooks/scripts/session-context.sh
```

Expected: all tests pass, no lint errors, context paragraph prints.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with per-harness install and usage"
```

---

## Self-Review Notes

- **Spec coverage:** patterns.json (Task 1), guard engine + fail-open (Tasks 1–2), hooks.json + SessionStart (Task 3), both manifests (Task 3), both skills + rules (Task 4), both agents (Task 5), live smoke test (Task 6), opencode adapter + permission snippet (Task 7), pi adapter + PizzaPi note (Task 8), README (Task 9). Spec's `tannedpy-guard.py` is `tannedpy_guard.py` here — deliberate, documented in Global Constraints.
- **Types:** `evaluate(command, patterns) -> str | None` consistent across tests and both TS ports (`evaluate(command: string): string | null` with patterns closed over at module scope — the TS files load patterns.json once at import).
- **Known risk, accepted:** pi's extension API is partially unverified; Task 8 Step 1 re-verifies against official docs before coding.
