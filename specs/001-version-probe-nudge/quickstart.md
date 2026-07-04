# Quickstart: Validating Version-Probe Allow-with-Nudge

**Feature**: `001-version-probe-nudge` | **Date**: 2026-07-03

Runnable scenarios proving the feature end-to-end. Expected decisions come from the
[decision-engine contract](contracts/decision-engine.md) conformance table; delivery
shapes from the [runtime-integrations contract](contracts/runtime-integrations.md).

## Prerequisites

- `uv` installed (guard and tests run through it — Constitution I)
- `bun` installed (adapter tests)
- Repo root: `/home/kwhatcher/projects/TannedPy`; a healthy `.venv` via `uv sync`

## 1. Full gate (must be green before merge)

```bash
uv run ruff check .
uv run pytest
bun test adapters/tests/
```

Expected: all pass, including the new version-probe cases and the differential parity
suite. Baseline before this feature: 60 Python + 82 TS tests — the new suites only add.

## 2. F12 regression — the probe that used to be denied (User Story 1 / SC-001)

Feed the guard a real PreToolUse event on stdin:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"python3 --version 2>&1"}}' \
  | uv run hooks/scripts/tannedpy_guard.py
```

Expected stdout: one JSON object with `"permissionDecision": "defer"` and
`"additionalContext"` equal to `messages.version_probe_note` from
`shared/patterns.json`. **No** `"deny"` anywhere. Exit code 0.

## 3. Nudge on the already-passing form (User Story 2 / FR-009, SC-002)

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"python3 --version"}}' \
  | uv run hooks/scripts/tannedpy_guard.py
```

Expected: same `defer` + note JSON as scenario 2 (previously this printed nothing).

## 4. Real work still denied, and deny suppresses the note (FR-006, SC-004)

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"python3 script.py"}}' \
  | uv run hooks/scripts/tannedpy_guard.py
echo '{"tool_name":"Bash","tool_input":{"command":"python3 --version && python3 train.py"}}' \
  | uv run hooks/scripts/tannedpy_guard.py
```

Expected: both print `"permissionDecision": "deny"` with the uv redirect message;
neither output contains `additionalContext`.

## 5. No false notes (FR-005, SC-004)

```bash
for c in 'node --version' 'which python3' 'uv run python --version' \
         'python3 --version --unknown-flag foo'; do
  echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$c\"}}" \
    | uv run hooks/scripts/tannedpy_guard.py
done
```

Expected: `node --version`, `which python3`, `uv run python --version` → **no output**
(no opinion, unchanged). `python3 --version --unknown-flag foo` → deny JSON (not a pure
probe), no note.

## 6. Cross-runtime parity (User Story 3 / FR-007, SC-005)

```bash
bun test adapters/tests/
```

Expected: the differential suite spawns the actual Python guard per table command and
asserts each TS adapter's `evaluate()` returns the identical `(deny, note)`
classification and byte-identical note text. Zero divergences.

## 7. Live smoke in Claude Code (optional, manual)

In a session with the TannedPy plugin active, ask the agent to run
`python3 --version 2>&1`. Expected: the command executes and prints the version; the
agent's context for that turn contains the uv advisory note; a follow-up
`python3 script.py` is still denied with the redirect message.

## 8. Issue and doc hygiene (Constitution IV/V)

```bash
grep -A3 'id: F12' ISSUES.yaml | grep status    # expected: status: fixed
grep -rn 'version' README.md rules/tannedpy.md  # docs describe allow-with-nudge behavior
```

Expected: F12 flipped to `fixed` in the same change; README and `rules/tannedpy.md`
describe the actual behavior (probe allowed + agent-facing note; wrapper-bypassed probes
like `timeout python3 --version` receive no note — stated honestly).
