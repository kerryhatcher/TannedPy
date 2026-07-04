<!--
SYNC IMPACT REPORT
==================
Version change: (unratified template) → 1.0.0
Bump rationale: Initial ratification — first concrete constitution replacing the
  placeholder template. MAJOR baseline established.

Principles defined (all new):
  I.   uv-First, Always
  II.  Single Source of Truth for Rules
  III. Cross-Runtime Parity (NON-NEGOTIABLE)
  IV.  Test-Backed Behavior
  V.   Advisory Guardrail, Honestly Documented

Sections defined:
  - Technology & Compatibility Constraints (was [SECTION_2_NAME])
  - Development Workflow & Quality Gates (was [SECTION_3_NAME])
  - Governance

Templates reviewed for consistency:
  ✅ .specify/templates/plan-template.md — "Constitution Check" gate (line 39) is
     generic ("[Gates determined based on constitution file]"); resolves to these
     principles at plan time. No edit required.
  ✅ .specify/templates/spec-template.md — no hardcoded principle references. No edit.
  ✅ .specify/templates/tasks-template.md — no hardcoded principle references. No edit.
  ✅ AGENTS.md — runtime guidance; already aligned (uv-first, ISSUES.yaml sync,
     advisory-hook posture). No edit required.

Deferred / follow-up TODOs: none.
-->

# TannedPy Constitution

TannedPy forces AI coding agents onto `uv` for all Python and denies bare
`python`/`pip`/`virtualenv` with a teaching redirect. It ships one enforcement
engine (the Claude Code PreToolUse guard) plus runtime adapters (opencode, pi),
all driven by a single shared ruleset. These principles govern how the project
is built and changed.

## Core Principles

### I. uv-First, Always

The project MUST practice what it enforces. All Python in this repository — the
guard, tests, tooling, and any ad-hoc script — runs through `uv`: `uv run` for
execution, `uv add`/`uv add --dev`/`uv remove` for dependencies, and the
`#!/usr/bin/env -S uv run --script` + PEP 723 recipe for standalone scripts. No
system `python`/`python3`, no `pip`, no hand-rolled virtualenvs anywhere in the
codebase or its CI. `ruff` MUST pass before every commit.

Rationale: a tool that mandates a discipline it does not follow itself is not
credible, and dogfooding surfaces the same friction real users hit.

### II. Single Source of Truth for Rules

`shared/patterns.json` is the ONE place deny/allow patterns, wrapper handling,
version-check exemptions, the escape-hatch marker, and redirect messages are
defined. The guard and every adapter MUST read their rules from it. Duplicating
or hardcoding a rule in a guard/adapter is prohibited; changes to enforcement
behavior are changes to `patterns.json`.

Rationale: multiple runtimes only stay consistent if they share one contract;
duplicated rules drift silently and produce different decisions for the same
command.

### III. Cross-Runtime Parity (NON-NEGOTIABLE)

The Python guard (`hooks/scripts/tannedpy_guard.py`) is the reference
implementation. Every adapter (opencode, pi) MUST produce the same allow/deny
decision as the guard for the same input. Parity MUST be verified by a test that
exercises adapters against the **actual** Python guard's decisions — never
against a hand-maintained expectations list that can be wrong in the same way as
the adapter. Any intentional divergence MUST be documented, justified, and
covered by a test asserting the specific difference.

Rationale: a "parity" suite that two identically-wrong implementations both pass
gives false confidence; only differential testing against the reference catches
real drift.

### IV. Test-Backed Behavior

Every deny/allow rule and every bugfix MUST have a test. A discovered bypass or
false positive MUST gain a regression test in the same change that fixes it. The
full gate — `uv run pytest` (guard suite), `bun test` (adapter parity), and
`uv run ruff check .` — MUST pass before merge. Known-but-unfixed issues are
tracked in `ISSUES.yaml` with a `status`, and MUST NOT be silently dropped.

Rationale: an enforcement tool whose own behavior is untested cannot be trusted
to enforce anything; regressions in a guard are silent until they let something
through.

### V. Advisory Guardrail, Honestly Documented

The guard is an advisory nudge for cooperative agents, NOT a security boundary —
a determined or jailbroken agent can bypass any PreToolUse hook. Documentation
MUST describe the guard's **actual** behavior: real fail-open conditions, the
true scope of the escape-hatch marker, and the actual coverage of wrappers and
edge cases. Aspirational or inaccurate claims (e.g. describing enforcement the
code does not perform) are defects to be fixed, not marketing. Completeness of
enforcement has diminishing returns; correctness of the everyday path and of the
docs comes first.

Rationale: users calibrate trust from the docs; a guard that mis-describes when
it goes inert or how the escape hatch scopes is worse than one that is modest and
accurate.

## Technology & Compatibility Constraints

- **Toolchain**: Python managed exclusively by `uv`; linting by `ruff`. Adapter
  tests run under `bun`.
- **Runtimes**: Claude Code (Python guard + hooks) is primary; opencode
  (`tool.execute.before`) and pi (`tool_call`) adapters are first-class and MUST
  track the guard (Principle III).
- **Contract**: `shared/patterns.json` is the enforcement contract (Principle
  II). Schema-affecting changes MUST be reflected in the guard, all adapters, and
  their tests together.
- **Issue tracking**: `ISSUES.yaml` at the repo root is the machine-readable
  registry of known defects, verdicts, severities, priority ranking, and fixes;
  it MUST be kept in sync per `AGENTS.md`. Work its priority ranking (rank 1 =
  highest real-world risk) unless directed otherwise.

## Development Workflow & Quality Gates

- **Commits**: Conventional Commits; commit after each task/story/phase rather
  than letting changes pile up.
- **Gates before merge**: `uv run ruff check .`, `uv run pytest`, and
  `bun test adapters/tests/` all pass. New behavior ships with tests
  (Principle IV).
- **Issue hygiene**: fixing a defect flips its `ISSUES.yaml` `status` to `fixed`
  (or `wontfix` with a reason) in the same change; newly found defects are added
  with the next free id and linked to a recommendation.
- **Clarify over guess**: when requirements are ambiguous, ask a focused
  clarifying question (multiple-choice when possible) rather than assuming.
- **Docs track code**: any change to guard behavior triggers a check of the docs
  it affects (README, `rules/tannedpy.md`, skills) per Principle V.

## Governance

This constitution supersedes ad-hoc practice for the TannedPy project. Amendments
MUST be made by editing this file, MUST document what changed, and MUST bump the
version below per semantic versioning:

- **MAJOR**: removing or redefining a principle in a backward-incompatible way.
- **MINOR**: adding a principle or materially expanding guidance.
- **PATCH**: clarifications, wording, and non-semantic refinements.

Compliance is expected of every change: reviews and plans SHOULD verify that work
aligns with these principles, and any added complexity MUST be justified against
the project's scope as an advisory guardrail (Principle V) — not gold-plated
toward security-boundary completeness. `AGENTS.md` provides runtime development
guidance for agents working in this repo and MUST stay consistent with this
constitution.

**Version**: 1.0.0 | **Ratified**: 2026-07-03 | **Last Amended**: 2026-07-03
