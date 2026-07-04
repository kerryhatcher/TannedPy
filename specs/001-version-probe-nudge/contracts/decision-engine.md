# Contract: Decision Engine (`evaluate`)

**Feature**: `001-version-probe-nudge` | **Date**: 2026-07-03

This is the cross-runtime contract every implementation MUST satisfy: the reference
Python guard (`hooks/scripts/tannedpy_guard.py`) defines behavior; the opencode and pi
adapters mirror it. The differential parity test treats the Python guard as the oracle.

## 1. `shared/patterns.json` delta

```jsonc
{
  // REMOVED: "version_args": [["--version"], ["-V"]],
  "version_probe": {
    "flags": ["--version", "-V"],
    "redirection_pattern": "^(&>>?|[0-9]*>&|[0-9]*>>?|[0-9]*<|<&|<<<?)"
  },
  "messages": {
    // ...existing run/install/venv messages unchanged...
    "version_probe_note": "tannedpy: version probe allowed. This project standardizes on uv — if this check precedes running or installing with system python/pip, use uv instead (uv run / uv add / uvx)."
  }
}
```

Consumers MUST read flags, pattern, and note text from these fields — no hardcoding
(Constitution II). Removing `version_args` is a schema-affecting change: guard, both
adapters, and all tests move in the same commit (Technology & Compatibility Constraints).

## 2. Signature

| Runtime | Before | After |
|---------|--------|-------|
| Python (reference) | `evaluate(command, patterns) -> str \| None` | `evaluate(command, patterns) -> tuple[str \| None, str \| None]` — `(deny_reason, note)` |
| TypeScript (both adapters) | `evaluate(command) => string \| null` | `evaluate(command) => { deny: string \| null, note: string \| null }` |

Invariant: `deny` and `note` are never both non-null. `note`, when non-null, is exactly
`messages.version_probe_note` (byte-identical across runtimes).

## 3. Semantics

Given a command string:

1. **Escape hatch** (unchanged, evaluated first): command contains `escape_hatch` →
   `(None, None)`. No note on escape-hatched commands (explicit user override; nudge
   deliberately out of scope).
2. **Segmentation** (unchanged): split at unquoted `&&`, `||`, `;`, `|`, newline.
3. **Per segment** (unchanged extraction): skip env assignments and wrappers; skip when
   word is `None`, `uv`, or a lookup command. These skipped segments never produce a note.
4. **Denied word** (`deny_command_pattern` match):
   - if `is_version_probe(args)` → remember `probe_seen = true`, continue to next segment;
   - else → return `(message, None)` immediately (first deny wins; note suppressed per
     FR-006 — the deny message already redirects to uv).
5. **End of segments**: return `(None, note)` if `probe_seen` else `(None, None)`.
   Multiple probe segments still yield a single note.

### `is_version_probe(args)`

```text
false if args is empty
false if args[0] is not an exact member of version_probe.flags
i = 1
while i < len(args):
    m = prefix-match(redirection_pattern, args[i])
    if no match:            return false        # e.g. "--unknown-flag", "foo"
    if m covers whole token: i += 2              # bare operator: next token is the target
    else:                    i += 1              # attached target, e.g. "2>&1"
return true                                      # trailing target-token overrun is fine:
                                                 # "…> " with no target still probes true
```

Notes:
- Flags match **exactly** (case-sensitive, no prefixes): `--version`/`-V` only.
- The rule applies identically to `python*`, `pip*`, `virtualenv`, `easy_install` words —
  anything the deny pattern matches. (`virtualenv --version` is information-only too.)
- Pipes never reach `args`: they were split in step 2 (FR-001).

## 4. Conformance table (differential-test seed)

| Command | deny | note |
|---------|------|------|
| `python3 --version 2>&1` | null | ✔ (F12 regression) |
| `python3 --version` | null | ✔ (FR-009: allow preserved, note added) |
| `python3 -V` | null | ✔ |
| `pip --version` | null | ✔ |
| `pip3 -V 2>&1` | null | ✔ |
| `python3 --version > /tmp/v.txt` | null | ✔ |
| `python3 --version >> log 2>&1` | null | ✔ |
| `python3 --version \| grep 3` | null | ✔ (pipe = segment; `grep` segment skipped) |
| `sudo python3 --version 2>&1` | null | ✔ (wrapper stripping unchanged) |
| `python3 --version && python3 train.py` | run-message | null (deny suppresses note, FR-006) |
| `python3 --version --unknown-flag foo` | run-message | null (not a pure probe) |
| `python3 script.py` | run-message | null |
| `python3` | run-message | null (bare REPL, unchanged) |
| `node --version` | null | null (FR-005: out of scope) |
| `ruby -v` | null | null |
| `which python3` | null | null (lookup, unchanged) |
| `uv run python --version` | null | null (uv path never annotated) |
| `python3 x.py  # tannedpy: allow` | null | null (escape hatch, no note) |
| `timeout python3 --version` | null | null (unrecognized wrapper — pre-existing bypass, unchanged, no note) |

## 5. Parity verification (FR-007, Constitution III)

`adapters/tests/parity.test.ts` MUST gain a differential mode: for every command in the
shared table it spawns the **actual** Python guard (`uv run hooks/scripts/tannedpy_guard.py`
with a synthesized PreToolUse JSON on stdin), parses the guard's stdout into
`(deny, note)`, and asserts both TS adapters' `evaluate()` return the same classification
and the same note text. The hand-maintained expectation column above is a readability
aid; the oracle is the guard's live output. Any intentional divergence (there are none in
the decision engine) would require its own documented test.
