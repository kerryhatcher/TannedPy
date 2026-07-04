# Phase 0 Research: Version-Probe Allow-with-Nudge

**Feature**: `001-version-probe-nudge` | **Date**: 2026-07-03

Four unknowns were carried into planning: the Claude Code advisory channel's exact
semantics (R1), whether opencode (R2) and pi (R3) expose an agent-facing advisory channel
on an *allowed* tool call — flagged in the spec's Assumptions as "to be confirmed at plan
time" — and a redirection-token pattern portable across Python `re` and JS `RegExp` (R4).
All four are resolved; no NEEDS CLARIFICATION remain.

## R1 — Claude Code: advisory channel and permission semantics

**Decision**: On allow-with-note, the guard emits
`{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "defer", "additionalContext": "<note>"}}`
to stdout. Deny output is unchanged. No-opinion remains "exit 0, no output".

**Rationale**:
- `additionalContext` is the only model-facing field; `permissionDecisionReason` is
  human-facing only and never reaches the agent (confirmed against the hooks
  documentation during F12 investigation).
- The official docs' only `additionalContext` example pairs it with
  `permissionDecision: "defer"`, and define `"defer"` as "let the normal permission flow
  apply (same as exiting 0 with no decision)". `defer` + `additionalContext` is therefore
  the *documented* combination that carries the note **without changing permission
  semantics**: today an allowed probe is "no decision", and it stays that way. This
  matters for Constitution V — the guard must not quietly escalate from "advisory
  denier" to "permission granter".
- `permissionDecision: "allow"` was considered and rejected: it would bypass the user's
  permission system for that call (auto-approve), widening the guard's authority as a
  side effect of delivering a note. An earlier session note recommended `"allow"`; the
  docs' `defer` semantics supersede that — `defer` carries the note with zero authority
  change. Whether `additionalContext` with *no* decision field at all is honored is
  undocumented, so the documented `defer` pairing is used rather than relying on
  unspecified behavior.

**Alternatives considered**: `permissionDecision: "allow"` + `additionalContext`
(rejected: silently auto-approves, authority escalation); `additionalContext` with no
decision field (rejected: undocumented, may be dropped); stderr text on exit 0 (rejected:
not delivered to the model on success).

## R2 — opencode: advisory channel on the allow path

**Decision**: Two-hook pattern. `tool.execute.before` runs the decision engine: on deny it
throws (unchanged); on allow-with-note it stashes the note keyed by `input.callID`. A new
`tool.execute.after` hook pops the stash and appends the note to `output.output` (the
tool result string the model reads).

**Rationale** (verified against sst/opencode `dev` source, 2026-07-03):
- `tool.execute.before` has **no** allow-path channel: its signature is
  `(input: {tool, sessionID, callID}, output: {args}) => Promise<void>` — the return
  value is ignored; the only levers are mutating `output.args` or throwing to block.
- `tool.execute.after` receives `output: {title, output, metadata}` **by reference**, and
  the post-mutation `output.output` string *is* the tool result returned to the model and
  persisted to session history (confirmed in `packages/opencode/src/session/tools.ts`).
  Appending the note there puts it in the agent's context attached to the exact tool call.
- Keying by `callID` (present in both hooks) makes the stash race-free and one-shot.

**Alternatives considered**: `experimental.chat.messages.transform` (rejected:
experimental, fires on every request, needs dedup, unkeyed to the tool call);
`client.session.prompt` (rejected: injects a visible user turn and triggers a new
generation — wrong shape); prepending `echo` to `args.command` (rejected: mutates the
user's command, observable side effects).

## R3 — pi: advisory channel on the allow path

**Decision**: Two-event pattern, same shape as R2. The `tool_call` handler runs the
decision engine: on deny it returns `{block: true, reason}` (unchanged); on
allow-with-note it stashes the note keyed by `event.toolCallId`. A new `tool_result`
handler pops the stash and returns
`{content: [...event.content, {type: "text", text: note}]}` — appending the note to the
tool result the model sees.

**Rationale** (verified against pi.dev extension docs and `badlogic/pi-mono`
`packages/coding-agent/src/core/extensions/types.ts`, 2026-07-03):
- `ToolCallEventResult` is `{block?: boolean, reason?: string}` — extra fields are
  ignored, so there is no allow-side note field on `tool_call` itself.
- `tool_result` handlers chain like middleware and may return a partial patch whose
  `content` becomes what enters the LLM context; the docs name this as the supported way
  to modify tool results.

**Alternatives considered**: `pi.sendMessage(..., {deliverAs: "steer"})` (viable — a
standalone message before the next LLM call — but heavier than needed and detached from
the tool call; kept as fallback); `pi.appendEntry` (rejected: TUI-only, never reaches the
LLM); mutating `event.input.command` to prepend an echo (rejected: same objection as R2).

## R2/R3 corollary — delivery-timing divergence (Constitution III)

The decision engine's output (allow + identical note text from `patterns.json`) is
identical across all three runtimes — that is what the differential parity test asserts.
The **delivery timing** necessarily differs: Claude Code injects the note *pre-execution*
(`additionalContext` beside the upcoming tool result); opencode and pi append it to the
tool result *post-execution*. Both land in the agent's context in the same turn, before
its next reasoning step, so the nudge is functionally equivalent. Per Constitution III
this is an intentional, documented divergence: it is recorded in
`contracts/runtime-integrations.md` and each adapter's delivery path gets its own test
asserting the note is attached to the tool result.

## R4 — Shared redirection-token pattern (Python `re` ∩ JS `RegExp`)

**Decision**: Store in `patterns.json` as
`version_probe.redirection_pattern = "^(&>>?|[0-9]*>&|[0-9]*>>?|[0-9]*<|<&|<<<?)"`,
applied as a **prefix match** per token, with one shared consumption rule: if the match
consumes the entire token (bare operator: `>`, `>>`, `2>`, `&>`, `>&`, `<`), the next
token is consumed as the redirection target; otherwise (attached target: `2>&1`,
`>/tmp/v.txt`, `2>err.log`) only that token is consumed. Any non-matching trailing token
disqualifies the probe (falls through to the normal deny).

**Rationale**:
- All three tokenizers (Python `shlex.split(posix=True)`, both adapters' `tokens()`)
  treat `>`/`&` as ordinary characters, so redirections arrive either as one token
  (`2>&1`) or as operator + target tokens (`>`, `/tmp/v.txt`) — the pattern plus the
  two-branch consumption rule covers both shapes.
- Empirically validated 2026-07-03 in **both** engines with an identical 12–14 case table
  (all pass): `2>&1`, bare `--version`/`-V`, `> /tmp/v.txt`, `>/tmp/v.txt`, `2> err.log`,
  `&> all.log`, `>> log 2>&1`, `>& out.txt`, plus negative cases `--unknown-flag foo`,
  `--version foo`, `script.py`. The alternation orders longer operators first
  (`[0-9]*>&` before `[0-9]*>>?`) so `2>&1` binds as `2>&` + attached `1`.
- Uses only alternation, character classes, and greedy quantifiers — no lookbehind, no
  named groups, no engine-specific syntax; the same source string compiles in `re` and
  `RegExp`.

**Alternatives considered**: enumerated token list in `patterns.json` (rejected: the spec
clarification explicitly chose pattern-matching over enumeration — `N>file` forms are
unbounded); stripping redirections with a full shell parser (rejected: out of proportion
for an advisory guard, Constitution V); two separate per-language regexes (rejected:
violates Constitution II single-source rule).

## R5 — Probe recognition placement (consolidating the root cause)

**Decision**: Replace the strict `args in version_args` equality
(`tannedpy_guard.py:128` and the equivalent adapter checks) with
`is_version_probe(args)` per the algorithm in `data-model.md`, and replace the
`version_args` field with the `version_probe` object in `patterns.json` (one vocabulary,
one place). `evaluate()`'s contract widens from `str | None` to the three-state decision
(deny / allow-with-note / no-opinion) so the note can ride the allow path.

**Rationale**: the root cause of F12 is exactly the strict equality — `['--version',
'2>&1']` never equals `['--version']`. The probe check must also *mark* the command as
probe-containing so the note fires only when the overall decision is allow (FR-003/FR-006:
any denied segment suppresses the note). Keeping `version_args` alongside `version_probe`
would leave two competing definitions of the same exemption.

**Alternatives considered**: keep `version_args` and add a separate strip-redirections
preprocessing step (rejected: two fields describing one rule); extend `version_args` with
enumerated redirection variants (rejected: unbounded enumeration, same objection as R4).
