# TannedPy 🔥

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

## Version checks

`python3 --version`, `pip -V`, and the same with trailing shell redirections
(`python3 --version 2>&1`, `>> log`, piped to `| grep`, etc.) are **allowed**,
not denied — checking whether python/pip exists doesn't run or install
anything. The command still executes normally; the agent additionally
receives a terse, one-time advisory note nudging it toward `uv run` / `uv add`
/ `uvx` if that check was in service of running or installing with system
python. Any other flag alongside `--version`/`-V` (e.g. `--version --foo`)
is **not** treated as a pure version probe and is denied as usual. The note
is advisory only — it never changes the allow/deny decision, and a probe
wrapped in a command tannedpy doesn't recognize (e.g. `timeout python3
--version`) executes without a note, same as before this behavior existed.

Delivery differs slightly by runtime: Claude Code attaches the note to the
tool call before it runs (`additionalContext`); opencode and pi append it to
the tool result after it runs. Both land in the agent's context within the
same turn.

## Escape hatch

When the user explicitly asks for system python, agents append `# tannedpy: allow`
to the command. That exact marker bypasses the guard — by policy, only on
explicit user request.

## Development

```bash
uv run pytest        # guard engine test suite
uv run ruff check .  # lint
```

## Testing

`bun test adapters/tests/` runs the opencode/pi adapter parity suite against the Python guard's behavior.

Design docs: `docs/superpowers/specs/`. Research: grimoire `research/` topics
`uv-single-file-scripts`, `open-plugins-spec`, `pi-agent-harness`,
`opencode-plugins`, `claude-code-hooks`.
