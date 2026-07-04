# Implementation Plan: Version-Probe Allow-with-Nudge

**Branch**: `001-version-probe-nudge` | **Date**: 2026-07-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-version-probe-nudge/spec.md`

## Summary

Fix false positive F12 (`python3 --version 2>&1` wrongly denied) by making version-probe
recognition tolerant of trailing shell redirection tokens, and turn the silent allowance
into an allow-with-nudge: when the overall command is allowed and contains a recognized
python/pip version probe, deliver a terse agent-facing advisory note steering toward uv.
The probe definition (version flags + redirection-token pattern) and the note text live in
`shared/patterns.json` (single source of truth); the Python guard is the reference
implementation and the opencode/pi adapters mirror its decision engine, verified by a
differential parity test that exercises the **actual** Python guard.

**Technical approach**: extend the decision engine's version-args check from strict list
equality (`args in version_args`, `tannedpy_guard.py:128`) to "first arg is exactly
`--version`/`-V`, every remaining token matches the shared redirection-token pattern".
Change `evaluate()`'s return contract from `str | None` (deny reason or nothing) to a
three-state decision — deny(reason) / allow-with-note(note) / no-opinion — and map that
per runtime: Claude Code emits `hookSpecificOutput.additionalContext` JSON (model-facing
channel, confirmed), opencode and pi deliver via the advisory channels confirmed in
Phase 0 research (opencode: in-place output mutation in `tool.execute.after`; pi:
`tool_result` content append), preserving the allow/deny + note parity FR-007/SC-005 require.

## Technical Context

**Language/Version**: Python ≥3.10 (guard: stdlib-only PEP 723 uv script) + TypeScript (adapters, executed/tested under Bun)

**Primary Dependencies**: none at runtime (Python stdlib `json`/`re`/`shlex`; adapters use `node:fs`/`node:path`). Dev: pytest, ruff (via uv), `bun:test`

**Storage**: `shared/patterns.json` — the enforcement contract; gains the version-probe redirection-token pattern and the advisory note text

**Testing**: `uv run pytest` (guard suite, `tests/test_guard.py`), `bun test adapters/tests/` (adapter + differential parity), `uv run ruff check .`

**Target Platform**: developer machines (Linux/macOS) running Claude Code (primary), opencode, and pi

**Project Type**: single repo — Claude Code plugin (PreToolUse hook) + runtime adapters + shared JSON contract

**Performance Goals**: hook runs on every Bash tool call — per-invocation overhead must stay negligible (single-pass segment scan; one extra regex per trailing token; no new I/O)

**Constraints**:
- Guard stays fail-open (every code path exits 0) and stdlib-only
- The redirection-token pattern must be a **shared** regex valid in both Python `re` and JS `RegExp` (no lookbehind quirks, no `re`-only syntax)
- Claude Code allow path must remain "no permission decision" — the note rides `additionalContext` without emitting `permissionDecision: "allow"`, so the guard never widens permissions (verified in research.md R1)
- Advisory note must be terse (FR-004)

**Scale/Scope**: 3 implementation files (`hooks/scripts/tannedpy_guard.py`, `adapters/opencode/tannedpy.ts`, `adapters/pi/index.ts`) + `shared/patterns.json` + 2 test files + doc sync (README, `rules/tannedpy.md`, `ISSUES.yaml` F12)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate | Status |
|---|-----------|------|--------|
| I | uv-First, Always | All Python runs via `uv run`; guard keeps its PEP 723/uv shebang; no new system-python usage; ruff passes pre-commit | ✅ PASS — no toolchain change |
| II | Single Source of Truth | Version-probe definition (flags + redirection pattern) and note text are added to `shared/patterns.json`; guard and adapters read them from there; nothing hardcoded per-runtime | ✅ PASS — design places all new rules in patterns.json (see data-model.md) |
| III | Cross-Runtime Parity (NON-NEGOTIABLE) | Adapters must return the same deny/allow+note decision as the reference guard, verified against the **actual** Python guard, not a hand-maintained table | ✅ PASS — plan adds a differential parity test that spawns the real guard (FR-007). Note-*delivery* channels are runtime-specific; any runtime lacking an allow-path advisory channel is a documented, tested divergence per the principle's escape clause (research.md R2/R3) |
| IV | Test-Backed Behavior | Regression test for `python3 --version 2>&1` in the same change; note-emission tests; full gate (`uv run pytest`, `bun test`, `ruff`) green; `ISSUES.yaml` F12 → `fixed` in the same change | ✅ PASS — quickstart.md defines the verification gate |
| V | Advisory Guardrail, Honestly Documented | Docs must describe actual behavior: note is advisory, wrapper-bypassed probes (`timeout python3 --version`) get no note, adapter delivery differences stated honestly | ✅ PASS — doc-sync step included; no security-boundary claims added |

**Initial gate result**: PASS — no violations, Complexity Tracking not required.

**Post-design re-check (after Phase 1)**: PASS — data-model.md keeps every new rule in
`patterns.json` (II); contracts/decision-engine.md defines one decision contract all three
runtimes implement, with the differential test as the parity oracle (III); the opencode/pi
note-delivery divergences are documented in contracts/runtime-integrations.md and carried
as explicit spec-level divergence notes rather than silently absorbed (V).

## Project Structure

### Documentation (this feature)

```text
specs/001-version-probe-nudge/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── decision-engine.md        # evaluate() three-state contract + patterns.json schema delta
│   └── runtime-integrations.md   # per-runtime delivery: Claude Code hook JSON, opencode, pi
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
shared/
└── patterns.json                 # + version_probe redirection pattern, + advisory note text

hooks/
├── hooks.json                    # unchanged (PreToolUse wiring)
└── scripts/
    └── tannedpy_guard.py         # evaluate() → three-state decision; main() emits additionalContext JSON on allow-with-note

adapters/
├── opencode/
│   └── tannedpy.ts               # mirrored decision engine + opencode delivery path (per research R2)
├── pi/
│   └── index.ts                  # mirrored decision engine + pi delivery path (per research R3)
└── tests/
    └── parity.test.ts            # + version-probe table; + differential mode spawning the real Python guard

tests/
└── test_guard.py                 # + version-probe recognition/regression/note tests

ISSUES.yaml                       # F12 status → fixed (same change)
README.md, rules/tannedpy.md      # doc sync: version-probe behavior + note semantics
```

**Structure Decision**: Existing single-repo plugin layout is retained unchanged — this
feature only touches the shared contract (`shared/patterns.json`), the reference guard,
the two adapters, and their test suites. No new directories or projects are introduced.

## Complexity Tracking

> No Constitution Check violations — table intentionally empty.
