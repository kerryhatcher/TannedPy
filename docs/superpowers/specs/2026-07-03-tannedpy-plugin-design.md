# TannedPy — uv-First Enforcement Plugin: Design Spec

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Research base:** `/mnt/storage/grimoire/research/` — `uv-single-file-scripts`, `open-plugins-spec`, `pi-agent-harness`, `opencode-plugins`, `claude-code-hooks` (commit `e3a6b6c`)

## Problem

AI coding agents routinely write ad-hoc Python to accomplish tasks, but system python makes this painful: no dependency isolation, version drift, and env management the agent can't do safely. On a system with `uv` installed, none of that is necessary — a script with the shebang `#!/usr/bin/env -S uv run --script` and a PEP 723 `# /// script` metadata block carries its own Python version and dependencies, runs in a cached ephemeral venv, and never touches system python.

TannedPy makes agents do this by default:

1. **Ad-hoc/temp scripts** → self-contained uv-shebang PEP 723 scripts, `chmod a+x`, run directly.
2. **Project work** → `uv init` / `uv add` / `uv sync` / `uv run` / `uv python pin`, never `pip` or manual venvs.

No prior plugin does this; existing uv-enforcement lives in scattered gists (see prior-art research note).

## Goals and non-goals

**Goals**

- Block bare `python` / `pip` / `virtualenv` invocations in the agent's shell tool and redirect with an actionable message.
- Teach the uv-script and uv-project workflows via portable skills.
- Provide delegate agents for script authoring and project migration.
- Work in Claude Code natively; work in opencode and pi via thin adapters sharing one pattern source of truth.
- Fail open: a broken or uv-less environment must never brick the agent's shell.

**Non-goals (v1)**

- Not a sandbox: no attempt to defeat deliberate evasion (`sh -c 'python …'` string nesting, base64 tricks). TannedPy corrects habit; it is not a security boundary.
- No interception of the Write/Edit tools (e.g. warning on `.py` files lacking PEP 723). Possible future addition.
- No Windows support.
- No registry publication (personal use first; the open-plugins layout keeps that door open).

## Architecture

One repo (`tannedpy`) laid out per the open-plugins spec (vercel-labs/open-plugin-spec), with vendor adapters for harnesses that need code instead of config. Approach chosen over (B) Claude-Code-only and (C) three native packages: best coverage-to-effort, one source of truth, publish-ready shape.

```
tannedpy/
├── .plugin/plugin.json           # generic open-plugins manifest
├── .claude-plugin/plugin.json    # vendor manifest (Claude Code prefers this path)
├── skills/
│   ├── uv-scripting/SKILL.md     # self-contained scripts: shebang, PEP 723, chmod, temp workflow
│   └── uv-projects/SKILL.md      # project work: uv init/add/sync/run, pip migration
├── agents/
│   ├── uv-scripter.md
│   └── uv-migrator.md
├── hooks/
│   ├── hooks.json                # PreToolUse(Bash) → guard; SessionStart → context
│   └── scripts/
│       ├── tannedpy-guard.py      # enforcement engine; uv-shebang PEP 723, stdlib-only
│       └── session-context.sh    # emits uv-first context iff uv on PATH
├── rules/tannedpy.md              # always-on rules fragment for rules-consuming harnesses
├── shared/patterns.json          # SINGLE SOURCE OF TRUTH: deny/allow patterns + messages
├── adapters/
│   ├── opencode/                 # TS plugin (tool.execute.before) + opencode.json snippet
│   └── pi/                       # TS extension (beforeToolCall)
├── tests/test_guard.py
├── pyproject.toml                # dev tooling only (pytest, ruff), managed with uv
└── README.md                     # per-harness install instructions
```

### Harness compatibility (from research)

| Component | Claude Code | opencode | pi |
|---|---|---|---|
| Skills (SKILL.md) | native | reads Claude-format skills | native (Agent Skills standard) |
| Enforcement hook | `hooks.json` shell hook | TS adapter (`tool.execute.before`) | TS adapter (`beforeToolCall`); PizzaPi can map Claude hooks |
| Agents (markdown) | native | similar format | partial |
| Install | `/plugin` from git/marketplace | npm/git + `opencode.json` | npm/git pi package |

## Component design

### 1. `shared/patterns.json` — the source of truth

Machine-readable rules consumed by the Python guard and both TS adapters:

- `deny_commands`: command words to block — `python`, `python2`, `python3`, `python3.X` (regex), `pip`, `pip3`, `pip3.X`, `virtualenv`, `easy_install`.
- `deny_module_flags`: `python -m venv`, `python -m pip` (denied even if a future rule would allow the bare word).
- `allow_exceptions`:
  - introspection: sole argument `--version` or `-V`;
  - lookup wrappers: command word `which`, `command`, `type`, `whereis`;
  - `uv` as command word (covers `uv run python`, `uv pip`, everything uv);
  - escape-hatch marker: literal `# tannedpy: allow` anywhere in the command.
- `messages`: the deny/redirect text, with variants for script-run (`python foo.py`) vs install (`pip install x`) vs venv creation. Each message contains the concrete replacement recipe, e.g.:
  > Blocked by tannedpy: use uv instead of system python. Run a script: `uv run foo.py` (or give it a `#!/usr/bin/env -S uv run --script` shebang + PEP 723 block and execute directly). Add a dependency: `uv add x` (project) or `uv add --script foo.py x` (script). Need system python because the user explicitly asked? Append `# tannedpy: allow` to the command.

### 2. `hooks/scripts/tannedpy-guard.py` — enforcement engine

- **Form:** executable, `#!/usr/bin/env -S uv run --script`, PEP 723 block with `requires-python = ">=3.10"` and `dependencies = []` (stdlib-only → first run needs no network). Dogfoods the exact pattern it enforces.
- **Input:** Claude Code PreToolUse JSON on stdin; acts only when `tool_name == "Bash"`; reads `tool_input.command`.
- **Detection:** split the command into segments at unquoted `&&`, `||`, `;`, `|`, and newlines (light quote-aware scanner; `shlex` for tokenizing each segment, with graceful fallback on parse errors). Judge only each segment's command word (skipping env-var prefixes like `FOO=bar` and wrappers `env`, `nohup`, `time`, `xargs`). This kills the prior-art false positives: `grep python file.txt`, `echo "python3 is old"` pass; `cd /tmp && python3 foo.py` is caught.
- **Decision output:** on match, print JSON and exit 0:
  ```json
  {"hookSpecificOutput": {"hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "<message from patterns.json>"}}
  ```
  JSON-deny is used instead of exit-code-2 to avoid two documented Claude Code issues found in research: model stalling after exit-2 blocks, and "hook error" labels accumulating in the transcript.
- **Failure policy — fail open:** entire main wrapped in try/except → on any internal error, warning to stderr, exit 0 with no output. If uv is absent, the shebang fails with a non-blocking exit code and Claude Code treats it as a non-decision: tannedpy goes inert rather than breaking every Bash call.

### 3. `hooks/hooks.json`

- `PreToolUse`, matcher `Bash` → `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/tannedpy-guard.py`.
- `SessionStart` → `session-context.sh`: if `command -v uv` succeeds, emit one line of context ("tannedpy active: use uv for all Python — self-contained scripts get `#!/usr/bin/env -S uv run --script` + PEP 723; projects use uv init/add/run"). Prevention beats blocking: agents reach for uv first and denials stay rare. If uv is absent, emit nothing.

### 4. Skills (portable layer)

**`skills/uv-scripting/SKILL.md`** — description targets "writing any standalone, ad-hoc, temporary, or self-contained Python script". Content: the full recipe (shebang, PEP 723 block with `requires-python` + `dependencies`, `chmod a+x`, run directly); temp scripts go in the session scratchpad or `/tmp`; `uv init --script` / `uv add --script` workflows; the `--script`-flag recursion trap on non-`.py` files; `--exclude-newer` for reproducibility; lock with `uv lock --script` when a script graduates to durable tooling.

**`skills/uv-projects/SKILL.md`** — description targets "working on a Python project (dependencies, venvs, versions, running code/tests)". Content: detect uv (`uv.lock`, `command -v uv`); `uv add`/`uv remove`/`uv sync`/`uv run <cmd>` instead of pip/activate; `uv init` for new projects; `uv python pin`; migrating `requirements.txt` → `uv add -r requirements.txt`; escape-hatch etiquette (`# tannedpy: allow` only when the user explicitly requested system python).

### 5. Agents

**`agents/uv-scripter.md`** — delegate for "write a tool/script that does X": authors the self-contained script per the uv-scripting skill, makes it executable, runs it to verify, returns path + usage summary. Keeps throwaway-script iteration off the main context.

**`agents/uv-migrator.md`** — delegate for "convert this to uv": audit first (find pip installs, venv activation in CI/docs/Makefiles, bare python shebangs), report findings, then convert (`uv init` integration, deps into `pyproject.toml`, shebangs onto loose scripts) and verify via `uv run` on the test suite. Report-before-modify so destructive changes are visible.

### 6. Adapters

**`adapters/opencode/`** — TS plugin implementing `tool.execute.before`: load `patterns.json`, apply the same segment/command-word logic, throw an Error carrying the redirect message to block. Ships with:
- `opencode.json` permission snippet (`"python*": "deny"`, `"pip*": "deny"`, `"uv *": "allow"`) as defense-in-depth — required because opencode plugin hooks do not fire for subagent tool calls (open issue found in research);
- an AGENTS.md fragment mirroring `rules/tannedpy.md`.

**`adapters/pi/`** — TS extension using `beforeToolCall`, returning `{ block: true, reason }` from the same patterns. Distributed as a git-installable pi package. README notes PizzaPi users can instead consume the Claude Code hooks via its adapter.

Both adapters port one small pure function (~40 lines); pattern data and messages are never duplicated.

## Error handling summary

| Failure | Behavior |
|---|---|
| Guard crashes (bad input, parse error) | stderr warning, exit 0 — fail open |
| uv not installed | shebang fails non-blocking; SessionStart emits nothing; plugin inert |
| `patterns.json` missing/corrupt | fail open (guard), console warning (adapters) |
| Legitimate need for system python | `# tannedpy: allow` marker, documented in skills as user-request-only |

## Testing

- **`tests/test_guard.py`** (`uv run pytest`), table-driven from the prior-art pitfall catalog:
  - denied: `python3 foo.py`; `pip install requests`; `cd /tmp && python x.py`; `python -m venv .venv`; `virtualenv env`
  - allowed: `uv run python`; `python --version`; `which python3`; `grep python file.txt`; `echo "python3 rocks"`; `FOO=1 uv run x.py`; `python3 x.py # tannedpy: allow`
  - fail-open: empty stdin; malformed JSON; non-Bash tool_name → exit 0, no deny
- **Live smoke test** in Claude Code: install plugin locally, verify a `python3 -c` Bash call is denied with the redirect message and that SessionStart context appears.
- **Lint:** `uv run ruff check` on guard + tests before every commit.

## Milestones

1. Repo scaffold: manifests, `patterns.json`, guard + hooks.json, tests green.
2. Skills + rules fragment.
3. Agents.
4. Live smoke test in Claude Code; fix-ups.
5. opencode adapter (+ snippet docs).
6. pi adapter.
7. README with per-harness install instructions.

Each milestone is a conventional commit; the plugin is usable for personal Claude Code work from milestone 4.
