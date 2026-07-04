# Data Model: Version-Probe Allow-with-Nudge

**Feature**: `001-version-probe-nudge` | **Date**: 2026-07-03

There is no persistent storage in this feature. The "data model" is (1) the schema delta
to the shared rules contract `shared/patterns.json` and (2) the in-memory decision value
the engine produces. Both are governed by Constitution II (patterns.json is the single
source of truth) and III (all three runtimes derive behavior from the same contract).

## 1. `shared/patterns.json` schema delta

### New object: `version_probe`

Replaces the current `version_args` array (`[["--version"], ["-V"]]`). Keeping both would
create two sources for the same vocabulary, violating Constitution II, so `version_args`
is **removed** in the same change and every consumer (guard, both adapters, tests) moves
to `version_probe` together.

| Field | Type | Value | Meaning |
|-------|------|-------|---------|
| `version_probe.flags` | `string[]` | `["--version", "-V"]` | Exact version-flag vocabulary (spec clarification: exactly these two, no additions) |
| `version_probe.redirection_pattern` | `string` (regex source) | `^(&>>?|[0-9]*>&|[0-9]*>>?|[0-9]*<|<&|<<<?)` | Prefix-match pattern for a shell redirection token, valid in both Python `re` and JS `RegExp` (validated in research.md R4) |

### New message: `messages.version_probe_note`

| Field | Type | Meaning |
|-------|------|---------|
| `messages.version_probe_note` | `string` | The terse agent-facing advisory note (FR-003/FR-004). Draft text: `tannedpy: version probe allowed. This project standardizes on uv — if this check precedes running or installing with system python/pip, use uv instead (uv run / uv add / uvx).` |

**Validation rules** (enforced by tests, since JSON has no schema file here):

- `version_probe.flags` is a non-empty array of non-empty strings.
- `version_probe.redirection_pattern` compiles in both Python `re` and JS `RegExp`
  (the differential parity test exercises it in both engines by construction).
- `messages.version_probe_note` is non-empty and short (test asserts a length ceiling,
  e.g. ≤ 300 chars, as the FR-004 terseness backstop).

## 2. Decision value (in-memory)

`evaluate()` currently returns `str | None` (deny reason, or nothing). It becomes a
**three-state decision**, identical in shape across all three implementations:

| State | Python | TypeScript | Trigger |
|-------|--------|------------|---------|
| Deny | `(reason, None)` | `{ deny: reason, note: null }` | Any segment matches the deny pattern and is not exempt (unchanged logic) |
| Allow-with-note | `(None, note)` | `{ deny: null, note: note }` | No segment denied AND ≥1 segment was a recognized version probe |
| No opinion | `(None, None)` | `{ deny: null, note: null }` | No segment denied, no probe seen (unchanged: guard stays silent) |

Concrete carrier: Python returns a 2-tuple `(deny_reason, note)`; TypeScript returns
`{ deny, note }`. The two fields are never both non-null — deny wins and suppresses the
note (FR-006).

### Entity: Version probe (recognition rule)

A segment is a **version probe** when, after wrapper/assignment stripping (existing
`extract_invocation` logic, unchanged):

1. the command word matches `deny_command_pattern` (i.e. it *would* be denied), AND
2. `args[0]` is an exact member of `version_probe.flags`, AND
3. every remaining token is consumed by the redirection rule:
   - token must prefix-match `redirection_pattern`, else the segment is **not** a probe
     (falls through to normal deny — covers `--version --unknown-flag foo`);
   - if the match consumes the **entire** token (bare operator like `>`, `2>`, `&>`,
     `>&`), the **next** token is consumed as the redirection target (any content);
   - otherwise (target attached, like `2>&1`, `>/tmp/v.txt`) only that token is consumed.

Empty-args (`args == []`) is not a probe (bare `python3` opens a REPL — still denied,
unchanged).

### State transitions (per command evaluation)

```text
for each segment (existing split at unquoted && || ; | \n):
    word, args = extract_invocation(segment)          # unchanged
    skip if word is None / "uv" / lookup               # unchanged, no note from these
    if word matches deny pattern:
        if is_version_probe(args):  probe_seen = true; continue
        else:                        return DENY(message)   # first deny wins, note suppressed
end
return probe_seen ? ALLOW_WITH_NOTE : NO_OPINION
```

- **Escape hatch precedence** (unchanged): if the command contains `# tannedpy: allow`,
  `evaluate()` returns No-opinion immediately — no note. Rationale: the user explicitly
  authorized system python; nudging then is noise. Extending the nudge to the escape
  hatch is explicitly out of scope per the spec.
- **Pipes**: `|` remains a segment separator; a piped follow-on command is its own
  segment (FR-001). `python3 --version | grep 3` → probe segment + `grep` segment →
  Allow-with-note.
- **Multiple probes** in one command produce **one** note (the note is command-level,
  not per-segment).

## 3. Relationships

```text
shared/patterns.json ──read──▶ hooks/scripts/tannedpy_guard.py (reference)
        │                            └── main(): decision → Claude Code hook JSON
        ├──read──▶ adapters/opencode/tannedpy.ts (mirror) → opencode delivery
        └──read──▶ adapters/pi/index.ts (mirror) → pi delivery (tool_call + tool_result)

tests/test_guard.py ──imports──▶ guard evaluate()          (unit + regression)
adapters/tests/parity.test.ts ──spawns──▶ actual Python guard  (differential oracle, FR-007)
                              ──imports──▶ both adapters' evaluate()
```
