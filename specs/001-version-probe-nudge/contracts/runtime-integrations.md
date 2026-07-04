# Contract: Runtime Integrations (note delivery)

**Feature**: `001-version-probe-nudge` | **Date**: 2026-07-03

How each runtime maps the three-state decision to its extension API. The decision and the
note text are identical everywhere (see decision-engine.md); only the delivery vehicle is
runtime-specific. The delivery-timing divergence (pre- vs post-execution) is documented
in research.md and is an accepted, tested divergence under Constitution III.

## 1. Claude Code (reference) — `hooks/scripts/tannedpy_guard.py`

PreToolUse hook, stdout JSON, always exit 0 (fail-open unchanged).

| Decision | stdout |
|----------|--------|
| Deny | `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": <reason>}}` (unchanged) |
| Allow-with-note | `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "defer", "additionalContext": <note>}}` |
| No opinion | no output (unchanged) |

Constraints:
- `"defer"` is REQUIRED on the note path — never `"allow"`. `defer` keeps the normal
  permission flow (documented as "same as exiting 0 with no decision") so the guard
  gains no approval authority; the note rides `additionalContext`, the only
  model-facing field (`permissionDecisionReason` never reaches the model).
- Timing: the note is injected **pre-execution**, beside the tool call/result.
- Non-Bash tools and malformed input: unchanged behavior (silent, fail-open).

## 2. opencode — `adapters/opencode/tannedpy.ts`

Verified against sst/opencode `dev` (2026-07-03): `tool.execute.before` has no allow-path
channel (return value ignored; levers are arg mutation or throw); `tool.execute.after`
receives the result object **by reference** and its post-mutation `output.output` string
is what the model reads and what persists to session history.

```text
state: pendingNotes = Map<callID, note>            // module-level, one-shot entries

"tool.execute.before"(input {tool, sessionID, callID}, output {args}):
  if input.tool !== "bash": return
  {deny, note} = evaluate(output.args.command ?? "")
  if deny: throw new Error(deny)                   // unchanged deny path
  if note: pendingNotes.set(input.callID, note)

"tool.execute.after"(input {tool, sessionID, callID, args}, output {title, output, metadata}):
  note = pendingNotes.get(input.callID)
  if note !== undefined:
    pendingNotes.delete(input.callID)
    output.output += "\n\n" + note                 // appended to the tool result the model reads
```

Constraints:
- Stash MUST be keyed by `callID` and deleted on read (no leakage across calls; bounded
  memory even if `after` never fires for a call — acceptable residue is one string).
- Timing: note lands **post-execution**, inside the tool result (accepted divergence).
- patterns.json load failure: adapter stays inert (unchanged fail-open posture).

## 3. pi — `adapters/pi/index.ts`

Verified against pi.dev extension docs + `badlogic/pi-mono` types (2026-07-03):
`ToolCallEventResult` is `{block?, reason?}` only; `tool_result` handlers may return a
partial patch whose `content` becomes the tool result in LLM context.

```text
state: pendingNotes = Map<toolCallId, note>

pi.on("tool_call", (event {toolName, toolCallId, input}) => {
  if event.toolName !== "bash": return undefined
  {deny, note} = evaluate(String(event.input.command ?? ""))
  if deny: return {block: true, reason: deny}      // unchanged deny path
  if note: pendingNotes.set(event.toolCallId, note)
  return undefined
})

pi.on("tool_result", (event) => {
  note = pendingNotes.get(event.toolCallId)
  if note === undefined: return undefined
  pendingNotes.delete(event.toolCallId)
  return {content: [...event.content, {type: "text", text: note}]}
})
```

Constraints:
- Same one-shot `toolCallId`-keyed stash rules as opencode.
- Timing: note lands **post-execution**, appended as a text content block on the tool
  result (accepted divergence).
- Fallback (only if `tool_result` proves unavailable for bash in practice):
  `pi.sendMessage({...}, {deliverAs: "steer"})` — documented in research.md R3; not the
  primary design.

## 4. Cross-runtime acceptance

- The note string delivered by all three runtimes MUST be byte-identical
  (`messages.version_probe_note` verbatim; adapters may prepend only whitespace/newlines
  needed by their append mechanics).
- Deny behavior, message routing, and fail-open posture are UNCHANGED in all runtimes.
- Each adapter gets a delivery test (hook wiring level): a recognized probe results in a
  tool result carrying the note; a denied command results in block/throw with no note;
  a non-probe allowed command results in an untouched tool result.
