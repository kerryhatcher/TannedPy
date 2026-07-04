# Feature Specification: Version-Probe Allow-with-Nudge

**Feature Branch**: `001-version-probe-nudge`

**Created**: 2026-07-03

**Status**: Draft

**Input**: User description: "Version-probe allow-with-nudge: when an agent runs a system-python version check (e.g. `python3 --version`, `python3 -V`, tolerant of trailing shell redirections like `2>&1`), the TannedPy guard should ALLOW the command to run (not deny it) but inject an advisory note into the agent's context reminding that this project standardizes on uv, and that if the version check was a prelude to executing/installing with system python/pip, the agent should use uv instead."

## Clarifications

### Session 2026-07-03

- Q: When a version probe shares one command line with a segment that must still be denied (overall decision = DENY), is the advisory note still delivered? → A: Deny only, no note — the note fires only when the whole command is allowed; a denied segment yields just the deny message (which already redirects to uv).
- Q: Which version-flag vocabulary counts as a recognized probe? → A: Keep exactly `--version` and `-V` (no other flag vocabulary); only add tolerance for trailing redirections.
- Q: What counts as a tolerated trailing redirection after the version flag? → A: Any shell redirection operator and its target (`2>&1`, `>`, `>>`, `<`, `2>`, `&>`, `N>file`, etc.), matched by pattern.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Version probes are no longer wrongly blocked (Priority: P1)

An AI coding agent needs to know whether system Python exists or which version is
present, so it runs a routine probe such as `python3 --version 2>&1` (the `2>&1`
is common because version banners sometimes print to stderr). Today the guard
allows the bare `python3 --version` but **denies** the same probe once a redirection
is appended, blocking a harmless, everyday command and returning a redirect-to-uv
message instead of the version.

**Why this priority**: This is the core defect (false positive F12). It fires on
ordinary, non-adversarial commands and erodes trust in the guard's correctness.
Fixing it alone delivers standalone value even without the nudge.

**Independent Test**: Run a set of version probes with and without trailing
redirections through the guard and confirm every one is allowed to execute
(no deny), while a real work command like `python3 script.py` is still denied.

**Acceptance Scenarios**:

1. **Given** the guard is active, **When** the agent runs `python3 --version 2>&1`, **Then** the command is allowed to run and no denial message is returned.
2. **Given** the guard is active, **When** the agent runs `python3 -V`, **Then** the command is allowed to run.
3. **Given** the guard is active, **When** the agent runs `python3 script.py` (real work), **Then** the command is still denied with the uv redirect message.

---

### User Story 2 - Agent is gently steered toward uv on a version probe (Priority: P2)

When the agent runs an allowed system-python/pip version probe, it receives a
short advisory note in its own context: this project standardizes on uv, and if
the probe was a prelude to running or installing with system python/pip, it should
use uv instead. The note is agent-facing (it informs the agent's next turn); it is
not the human permission dialog.

**Why this priority**: Turns a silent allowance into a teaching moment, steering
the agent *before* it bumps into the hard denial on the follow-up work command —
saving a wasted turn. It builds on P1 (a probe must first be recognized and allowed
before it can be annotated) but is separable: P1 is valuable without it.

**Independent Test**: Run an allowed version probe and confirm the advisory note is
delivered to the agent; run a non-probe command and a non-python command and confirm
no note is delivered.

**Acceptance Scenarios**:

1. **Given** the agent runs `python3 --version`, **When** the guard allows it, **Then** the agent receives a terse note that uv is the project standard and to prefer uv if the probe preceded real python use.
2. **Given** the agent runs `pip --version`, **When** the guard allows it, **Then** the same class of advisory note is delivered.
3. **Given** the agent runs `node --version`, **When** the command is evaluated, **Then** no uv note is delivered (out of scope for the note).

---

### User Story 3 - Consistent behavior across runtimes (Priority: P3)

A developer using the guard through opencode or pi (not just Claude Code) gets the
same decision for the same command: version probes are allowed and carry the same
advisory note, and real work is still denied — matching the reference guard exactly.

**Why this priority**: Parity is a project principle (Constitution III). Divergence
here would mean the same probe is allowed in one runtime and denied in another.
Lower priority than P1/P2 only because most usage is through Claude Code.

**Independent Test**: Run the version-probe test set through each adapter and assert
each adapter's allow/deny + note decision matches the reference Python guard.

**Acceptance Scenarios**:

1. **Given** an identical version probe, **When** evaluated by the opencode adapter and by the reference guard, **Then** both allow it and both carry the advisory note.
2. **Given** an identical version probe, **When** evaluated by the pi adapter and by the reference guard, **Then** the decisions match.

---

### Edge Cases

- **Trailing redirection to a file**: `python3 --version > /tmp/v.txt` — treated as a
  version probe (allowed + note), same as `2>&1`.
- **Version probe combined with real work**: `python3 --version && python3 train.py`
  — the `train.py` segment forces an overall deny, so the whole command is denied and
  **no advisory note is delivered** (the deny message already redirects to uv). The note
  is delivered only when the overall command decision is allow.
- **Extra non-redirection arguments**: `python3 --version --unknown-flag foo` — the
  presence of arguments that are *not* version flags or redirections means this is
  NOT a pure version probe; it is treated as a normal (denied) invocation and receives
  no note.
- **Already-passing forms unchanged**: `python3 --version` and `python3 -V` (no
  redirection) continue to be allowed exactly as before.
- **Non-python probe**: `node --version`, `ruby -v` — never in scope for the guard;
  no change, no note.
- **Probe behind an unrecognized wrapper**: `timeout python3 --version` already
  bypasses the guard entirely (unrelated wrapper gap); this feature does not change
  that and does not add a note there.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The guard MUST recognize a system-python/pip version probe even when trailing shell redirection tokens are appended, in addition to the currently-recognized bare `--version` / `-V` forms. The recognized version-flag vocabulary is exactly `--version` and `-V` (no other equivalents). A tolerated trailing token is any shell redirection operator and its target — `2>&1`, `>`, `>>`, `<`, `2>`, `&>`, `N>file`, etc. — matched by pattern rather than an enumerated list. Pipes are not trailing tokens: `|` is a segment separator, so a piped follow-on command is evaluated as its own segment (FR-006).
- **FR-002**: The guard MUST allow a recognized version probe to execute — it MUST NOT return a denial for it.
- **FR-003**: When the **overall** command decision is allow and it contains a recognized version probe, the guard MUST deliver a short advisory note to the **agent's** context (distinct from the human-facing permission message) stating that the project standardizes on uv and that, if the probe was a prelude to executing or installing with system python/pip, the agent should use uv instead. The note rides the allow-path advisory channel only.
- **FR-004**: The advisory note MUST be terse (a brief reminder, not a wall of text) to avoid desensitizing the agent to advisory notes.
- **FR-005**: Version-probe recognition and the advisory note MUST be scoped to system python/pip invocations; non-python commands MUST NOT trigger recognition or the note.
- **FR-006**: A command segment that performs actual work (script execution, package install, arbitrary `-c`, etc.) MUST still be denied. Evaluation remains per-segment. When any segment forces an overall deny, the guard MUST emit only the deny message and MUST NOT deliver the advisory note — the deny message already redirects to uv, and the note is an allow-path-only signal (per FR-003).
- **FR-007**: The allow-and-note behavior MUST be identical across the reference Python guard and the opencode and pi adapters, and this parity MUST be verifiable against the reference guard (not against a separately hand-maintained expectation list).
- **FR-008**: The version-probe allowance MUST be covered by regression tests, explicitly including the `python3 --version 2>&1` case that currently regresses.
- **FR-009**: The already-passing exempted forms (`--version`, `-V` with no redirection) MUST continue to produce the same allow outcome (no regression), now additionally carrying the advisory note.

### Key Concepts

- **Version probe**: A python/pip invocation matched by the guard's deny pattern whose only meaningful arguments are a version flag (exactly `--version` or `-V`) optionally followed by shell redirection tokens (any redirection operator and target). It requests information and performs no work. (`pip --version` / `pip -V` use these same flags.)
- **Advisory note**: A short, agent-facing reminder delivered alongside an allow decision, steering the agent toward uv. It is separate from the human-facing permission message and does not block the command.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0% of system-python/pip version probes are wrongly denied — including every probe with trailing redirections (currently `python3 --version 2>&1` is denied; a piped probe like `python3 --version | head` is covered because the pipe splits it into segments and the probe segment is allowed).
- **SC-002**: 100% of recognized python/pip version probes deliver the uv advisory note to the agent.
- **SC-003**: 0 regressions — all previously-passing guard tests and adapter parity tests still pass.
- **SC-004**: 0 false notes — no non-python command and no real-work python command receives the version-probe note.
- **SC-005**: 100% parity — the opencode and pi adapters produce identical allow/deny + note decisions to the reference guard across the version-probe test set.

## Assumptions

- A "version probe" is defined as a python/pip word matched by the guard's deny pattern whose only non-empty arguments are a version flag (exactly `--version` or `-V`; `pip --version` / `pip -V` use the same flags) optionally followed by shell redirection tokens (any redirection operator and target). Any other trailing argument disqualifies it from the exemption. Pipes are segment separators, not trailing tokens.
- The advisory note fires on every recognized probe whose overall command decision is allow (a co-located denied segment suppresses the note per FR-006). The guard evaluates each command invocation independently and holds no cross-invocation state, so there is no per-session deduplication; terseness (FR-004) is the nag-fatigue mitigation rather than frequency limiting.
- Existing deny-pattern case sensitivity and wrapper handling are unchanged by this feature. A version probe behind an unrecognized wrapper (e.g. `timeout python3 --version`) already bypasses the guard entirely and is outside this feature's scope.
- The agent-facing advisory channel exists and can be combined with an allow decision in every targeted runtime (verified for Claude Code; assumed reachable for opencode and pi per their extension APIs — to be confirmed at plan time).

## Dependencies

- Implements recommendation **R2** (tolerant recognition of version-check arguments) from the multi-model review; this feature subsumes that fix.
- Fixes / closes **F12** in `ISSUES.yaml` (the `--version 2>&1` false positive).
- Relies on `shared/patterns.json` as the single source of truth for the version-probe definition and the note text (Constitution II).

## Out of Scope

- Extending the allow-with-nudge pattern to the `# tannedpy: allow` escape hatch. This is a separate decision, deliberately deferred (flagged for a future spec).
- Fixing unrelated guard gaps surfaced in the review: unrecognized wrappers (F8), case sensitivity (F9), command substitution (F2/F1), and others. These remain tracked independently in `ISSUES.yaml`.
- Any per-session deduplication or rate-limiting of advisory notes.
