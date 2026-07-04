# Tasks: Version-Probe Allow-with-Nudge

**Input**: Design documents from `/specs/001-version-probe-nudge/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/decision-engine.md, contracts/runtime-integrations.md, quickstart.md

**Tests**: INCLUDED — the spec mandates regression coverage (FR-008), differential parity verification (FR-007), and Constitution IV requires test-backed behavior. Tests are written first within each story and must fail before implementation.

**Organization**: Tasks are grouped by user story (US1 = P1 recognition fix, US2 = P2 nudge delivery, US3 = P3 cross-runtime parity).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single-repo Claude Code plugin layout (per plan.md): `shared/patterns.json` (contract), `hooks/scripts/tannedpy_guard.py` (reference guard), `adapters/opencode/tannedpy.ts` + `adapters/pi/index.ts` (mirrors), `tests/test_guard.py` (Python suite), `adapters/tests/` (Bun suite).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm a healthy baseline before touching the enforcement contract

- [X] T001 Verify baseline gate is green before any changes: run `uv run ruff check .`, `uv run pytest`, and `bun test adapters/tests/` from the repo root and confirm the pre-feature baseline (60 Python + 82 TS tests) passes (quickstart.md §1)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Land the `shared/patterns.json` schema delta — the single source of truth all three runtimes read (Constitution II)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Removing `version_args` intentionally breaks guard and adapters until they migrate (T005–T007, T014–T015); the whole feature lands as ONE commit per the contract's compatibility constraint — treat phase checkpoints as validation points, not commit points.

- [X] T002 Update `shared/patterns.json`: add `version_probe` object with `flags: ["--version", "-V"]` and `redirection_pattern: "^(&>>?|[0-9]*>&|[0-9]*>>?|[0-9]*<|<&|<<<?)"`; add `messages.version_probe_note` with the terse advisory text from contracts/decision-engine.md §1; REMOVE the `version_args` array (Constitution II — one vocabulary, one place)
- [X] T003 Add patterns.json contract-validation tests in `tests/test_guard.py`: `version_probe.flags` is a non-empty array of non-empty strings; `version_probe.redirection_pattern` compiles under Python `re`; `messages.version_probe_note` is non-empty and ≤ 300 chars (FR-004 terseness backstop); `version_args` key is absent (data-model.md §1 validation rules)

**Checkpoint**: patterns.json carries the new contract — user story implementation can begin

---

## Phase 3: User Story 1 - Version probes are no longer wrongly blocked (Priority: P1) 🎯 MVP

**Goal**: Fix false positive F12 — recognize python/pip version probes even with trailing shell redirections and allow them, while real work stays denied.

**Independent Test**: Feed the guard version probes with and without trailing redirections via stdin PreToolUse JSON and confirm every one is allowed (no deny output), while `python3 script.py` is still denied (quickstart.md §2, §4).

### Tests for User Story 1 (write first, confirm they FAIL)

- [X] T004 [US1] Add failing recognition and regression tests in `tests/test_guard.py` covering the conformance table (contracts/decision-engine.md §4): allowed probes — `python3 --version 2>&1` (F12 regression, FR-008), `python3 --version`, `python3 -V`, `pip3 -V 2>&1`, `python3 --version > /tmp/v.txt`, `python3 --version >> log 2>&1`, `sudo python3 --version 2>&1`, `python3 --version | grep 3`; still denied — `python3 script.py`, bare `python3`, `python3 --version --unknown-flag foo`, `python3 --version && python3 train.py`

### Implementation for User Story 1

- [X] T005 [US1] Implement `is_version_probe(args)` in `hooks/scripts/tannedpy_guard.py` per the contracts/decision-engine.md §3 algorithm: `args[0]` must exactly match a `version_probe.flags` member; each remaining token must prefix-match `redirection_pattern` (whole-token match consumes the NEXT token as redirection target; attached-target match like `2>&1` consumes only itself); any non-matching token disqualifies the probe; empty args is not a probe
- [X] T006 [US1] Widen `evaluate()` in `hooks/scripts/tannedpy_guard.py` to the three-state contract `tuple[str | None, str | None]` = `(deny_reason, note)`: replace the strict `args in version_args` equality (currently line 128) with `is_version_probe()`; track `probe_seen` across segments; first deny wins and suppresses the note (FR-006); escape hatch returns `(None, None)` with no note; skipped/lookup/uv segments never produce a note (data-model.md §2)
- [X] T007 [US1] Update `main()` and all existing `evaluate()` call sites plus existing tests in `tests/test_guard.py` to the tuple contract (deny path behavior unchanged; `main()` may ignore the note component until US2)
- [X] T008 [US1] Run `uv run pytest` and confirm all US1 tests pass with zero regressions in the pre-existing suite (SC-001, SC-003)

**Checkpoint**: `python3 --version 2>&1` is allowed, real work is still denied — F12 is functionally fixed

---

## Phase 4: User Story 2 - Agent is gently steered toward uv on a version probe (Priority: P2)

**Goal**: On an allowed command containing a recognized probe, deliver the terse uv advisory note to the agent's context via the Claude Code hook JSON.

**Independent Test**: Pipe probe and non-probe PreToolUse events into the guard and confirm probes emit `defer` + `additionalContext` with the note, non-probes emit nothing, and denies never carry the note (quickstart.md §3, §5).

### Tests for User Story 2 (write first, confirm they FAIL)

- [X] T009 [US2] Add failing note-delivery tests in `tests/test_guard.py`: `python3 --version` and `pip --version` produce stdout JSON with `"permissionDecision": "defer"` (NEVER `"allow"`) and `additionalContext` byte-equal to `messages.version_probe_note`; `node --version`, `which python3`, `uv run python --version` produce no output (FR-005, SC-004); deny outputs contain no `additionalContext`; a command with multiple probe segments yields exactly one note; every code path exits 0 (fail-open)

### Implementation for User Story 2

- [X] T010 [US2] Implement allow-with-note emission in `main()` of `hooks/scripts/tannedpy_guard.py`: on `(None, note)` print `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "defer", "additionalContext": <note>}}`; deny and no-opinion outputs unchanged; non-Bash tools and malformed input stay silent and fail-open (contracts/runtime-integrations.md §1)
- [X] T011 [US2] Validate manually via quickstart.md scenarios 2–5 (stdin `echo` pipelines) and confirm expected JSON for probe, plain-probe, deny-suppresses-note, and no-false-note cases; run `uv run pytest` green

**Checkpoint**: Claude Code path complete — probes allowed AND nudged; US1 remains independently intact

---

## Phase 5: User Story 3 - Consistent behavior across runtimes (Priority: P3)

**Goal**: opencode and pi adapters produce identical allow/deny + note decisions to the reference guard, verified differentially against the actual Python guard, with per-runtime note delivery.

**Independent Test**: `bun test adapters/tests/` — the differential suite spawns the real Python guard per table command and asserts each adapter's `evaluate()` matches its `(deny, note)` classification with byte-identical note text (quickstart.md §6).

**Note**: The differential oracle is the live guard, so this phase depends on US1+US2 being complete (not just Foundational).

### Tests for User Story 3 (write first, confirm they FAIL)

- [X] T012 [P] [US3] Extend `adapters/tests/parity.test.ts` with the 19-row version-probe conformance table (contracts/decision-engine.md §4) and a differential mode that spawns the actual Python guard (`uv run hooks/scripts/tannedpy_guard.py` with synthesized PreToolUse JSON on stdin), parses its stdout into `(deny, note)`, and asserts both adapters' `evaluate()` return the same classification and byte-identical note text (FR-007, SC-005)
- [X] T013 [P] [US3] Add adapter delivery tests in `adapters/tests/` (new delivery test file or extended per-adapter suites): a recognized probe results in a tool result carrying the appended note; a denied command throws/blocks with no note; a non-probe allowed command leaves the tool result untouched; stash entries are one-shot and keyed by call id (contracts/runtime-integrations.md §4)

### Implementation for User Story 3

- [X] T014 [P] [US3] Update `adapters/opencode/tannedpy.ts`: mirror the three-state `evaluate() => { deny, note }` and `is_version_probe()` reading `version_probe` + `messages.version_probe_note` from `shared/patterns.json`; keep deny-throw in `tool.execute.before`; stash note in a module-level `pendingNotes` Map keyed by `input.callID`; add `tool.execute.after` hook that pops the stash and appends the note to `output.output` (contracts/runtime-integrations.md §2)
- [X] T015 [P] [US3] Update `adapters/pi/index.ts`: mirror `evaluate()`/`is_version_probe()`; keep `{block: true, reason}` deny path in the `tool_call` handler; stash note keyed by `event.toolCallId`; add a `tool_result` handler returning `{content: [...event.content, {type: "text", text: note}]}` with one-shot stash semantics (contracts/runtime-integrations.md §3)
- [X] T016 [US3] Run `bun test adapters/tests/` and confirm the differential parity suite is green with zero divergences and all pre-existing adapter tests still pass (SC-003, SC-005)

**Checkpoint**: All three runtimes return identical decisions with the note delivered per-runtime

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Doc honesty, issue hygiene, and the full merge gate (Constitution IV/V)

- [X] T017 [P] Update `README.md` and `rules/tannedpy.md` to describe the actual allow-with-nudge behavior: probe definition (exactly `--version`/`-V` + trailing redirections), agent-facing note semantics, the pre- vs post-execution delivery-timing divergence across runtimes, and the honest caveat that wrapper-bypassed probes (`timeout python3 --version`) receive no note (Constitution V; quickstart.md §8)
- [X] T018 [P] Flip issue F12 to `status: fixed` in `ISSUES.yaml` with a resolution note referencing feature 001-version-probe-nudge (Constitution IV — same change as the fix)
- [X] T019 Run the full merge gate from the repo root: `uv run ruff check .`, `uv run pytest`, `bun test adapters/tests/` — all green, zero regressions against the 60 Python + 82 TS baseline (quickstart.md §1, SC-003)
- [X] T020 Execute quickstart.md scenarios 2–6 and 8 end-to-end, then commit the entire feature as a single Conventional Commit (schema delta + guard + both adapters + tests + docs + ISSUES.yaml move together, per the contract's compatibility constraint)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (every runtime reads the new `patterns.json` fields)
- **US1 (Phase 3)**: Depends on Foundational
- **US2 (Phase 4)**: Depends on US1 (the note rides the three-state `evaluate()` introduced in T006)
- **US3 (Phase 5)**: Depends on US1 + US2 — the differential parity test uses the finished Python guard as its oracle
- **Polish (Phase 6)**: Depends on all user stories

### Task-Level Dependencies

- T002 → T003 (tests validate the new schema)
- T004 → T005 → T006 → T007 → T008 (tests first; `evaluate()` builds on `is_version_probe()`)
- T009 → T010 → T011
- T012, T013 → T014, T015 → T016 (adapter tests first, then mirrored implementations)
- T017, T018 → T019 → T020

### ⚠️ Commit Strategy (overrides the usual per-phase commit)

Removing `version_args` in T002 leaves the guard and adapters intermediately broken until T006/T007 and T014/T015 land. Per contracts/decision-engine.md §1, guard, both adapters, and all tests MUST move in the same commit — validate at each checkpoint, but commit once at T020.

### Parallel Opportunities

- **Phase 5**: T012 ∥ T013 (different test files), then T014 ∥ T015 (opencode vs pi adapters — different files, no shared state)
- **Phase 6**: T017 ∥ T018 (docs vs ISSUES.yaml)
- US1 and US2 tasks touch the same two files (`tannedpy_guard.py`, `tests/test_guard.py`) and are intentionally sequential

## Parallel Example: User Story 3

```bash
# After US1+US2 complete, launch adapter test authoring together:
Task: "Extend adapters/tests/parity.test.ts with differential mode spawning the real guard"
Task: "Add adapter delivery tests in adapters/tests/"

# Then launch both adapter mirrors together:
Task: "Update adapters/opencode/tannedpy.ts (three-state evaluate + after-hook delivery)"
Task: "Update adapters/pi/index.ts (three-state evaluate + tool_result delivery)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (baseline) + Phase 2 (patterns.json delta)
2. Complete Phase 3: US1 — `python3 --version 2>&1` allowed, real work denied
3. **VALIDATE**: quickstart.md §2 and §4 pass; `uv run pytest` green
4. Note: because the schema delta breaks the adapters until US3, the MVP is a within-branch checkpoint — the branch merges only after T020's single commit gate

### Incremental Delivery

1. Setup + Foundational → contract ready
2. US1 → F12 fixed (functional MVP checkpoint)
3. US2 → nudge delivered in Claude Code
4. US3 → parity restored across opencode and pi
5. Polish → docs honest, F12 closed, full gate green, single commit

---

## Notes

- [P] tasks = different files, no dependencies
- Verify each story's tests FAIL before implementing (Constitution IV)
- Total: 20 tasks — Setup 1, Foundational 2, US1 5, US2 3, US3 5, Polish 4
- The note text must remain byte-identical across all three runtimes (`messages.version_probe_note` verbatim; adapters may prepend only append-mechanics whitespace)
