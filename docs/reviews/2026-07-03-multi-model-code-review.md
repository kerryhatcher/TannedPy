# TannedPy — Verification, Ranking & Recommendations

> **Provenance (2026-07-03).** Produced by a three-stage multi-model review pipeline:
> four parallel Sonnet reviewers (guard logic, adapters/parity, plugin structure,
> security/docs) → an Opus compiler that merged and deduplicated their findings into
> 26 entries (F1–F26) → this Fable verification stage, which independently reproduced
> each finding against the live code, ranked by real-world risk, and recommended fixes.
> Result: 22 confirmed, 3 partially confirmed, 1 mischaracterization corrected (F20), 0 disproven.

Final stage of the multi-model review. Every finding below was checked against the current code in
`/home/kwhatcher/projects/TannedPy`; bypasses were reproduced by importing `evaluate()` directly and
running a case table (repro driver: `scratchpad/repro.py`, passes `ruff check`). TypeScript adapter
findings were verified by close reading only (no `package.json`/bun runtime exists — that is F17), and
are flagged as such.

## 1. Executive summary

Of 26 findings: **22 CONFIRMED, 3 PARTIALLY CONFIRMED (F13, F23, F26), 1 adjudicated as MISCHARACTERIZED
(F20 — the "stale cruft" reading is disproven; the manifest is deliberate but under-documented). Zero
findings were fully disproven** — the review was accurate. The single most important takeaway: the guard's
core design (regex on the *first token* of each `;`/`|`/`&&`-split segment) is blind to the most common
ways a command actually launches python — `timeout python3 …`, `bash -c "python3 …"`, `$(python3 …)` — so
several bypasses fire on **everyday, non-adversarial** commands, while two false positives (`--version 2>&1`,
heredoc bodies) wrongly *block* harmless ones. Both failure directions stem from the same shallow tokenizer.

## 2. Verification results (verdict + evidence per finding)

Repro legend: `ALLOW` = guard emitted no deny (bypass); `DENY` = guard blocked. Controls `python3 foo.py`,
`pip install requests`, `sudo python3 x.py` all correctly `DENY`.

### Theme A — Guard bypasses

| ID | Verdict | Evidence |
|----|---------|----------|
| **F1** lone `&` | **CONFIRMED** | `echo hi & pip install evil` → ALLOW. `split_segments` (line 53/58) splits on `&&`/`||`/`;`/`|`/`\n` only; a lone `&` stays in the buffer, whole thing is one segment, `word="echo"` → allowed. |
| **F2** `$()`/backtick/`<()` | **CONFIRMED** | All ALLOW: `echo $(python3 foo.py)`, `x=$(python3 -c 'print(1)')`, `` echo `python3 foo.py` ``, `cat <(python3 foo.py)`, bare `` `python3 evil.py` ``. Splitter never descends into substitutions; `shlex` treats `$(`/backtick as ordinary chars. |
| **F3** `sh -c`/`bash -c`/`eval`/`ssh`/`find -exec` | **CONFIRMED** | All ALLOW: `bash -c "python3 evil.py"`, `sh -c "pip install malicious"`, `eval "pip install evil"`, `ssh host 'python3 foo.py'`, `find . -name "*.py" -exec python3 {} \;`. `extract_invocation` returns the literal first word, never recurses into a string arg. This is the canonical technique the guard claims to stop. |
| **F4** `command` builtin | **CONFIRMED** | `command python3 foo.py` and `command pip install evil` → ALLOW. `patterns.json:4` lists `command` in `lookup_commands`; `evaluate()` line 125 `continue`s on any lookup with no arg inspection. Unlike `which`/`type`, bash `command` without `-v` *executes* its arg. |
| **F5** absolute-path wrappers | **CONFIRMED** | `/usr/bin/env python3 evil.py` and `/usr/bin/sudo python3 evil.py` → ALLOW. Asymmetry: wrapper match at line 88 is exact (`tok in wrappers`), but basename-strip (line 100) applies only to the final word. `/usr/bin/env ∉ wrappers` → loop breaks at idx 0 → `word="env"` (basename) not denied. |
| **F6** escape-hatch substring | **CONFIRMED** | `echo '# tannedpy: allow' && pip install malicious && python3 exploit.py` → ALLOW; `pip install malware && python3 backdoor.py  # tannedpy: allow` → ALLOW. Line 116 runs `patterns["escape_hatch"] in command` on the raw pre-split string, so the marker *anywhere* (even inside an unrelated quoted echo) whitelists the whole line. Prompt-injection + accidental-disable vector. |
| **F7** bundled sudo flags | **CONFIRMED** | `sudo -Eu root python3 evil.py` → ALLOW. `-Eu` ∉ `wrapper_value_flags["sudo"]`, hits `else: idx+=1`, then `root` breaks the loop, `word="root"` not denied, python3 never seen. |
| **F8** omitted wrappers (timeout/doas/setsid…) | **CONFIRMED** | `timeout 30 python3 foo.py`, `doas python3 foo.py`, `setsid python3 foo.py` → all ALLOW. `timeout` is an *everyday* idiom, not adversarial. Same root cause as F3/F4 (word-only inspection). |
| **F9** case-sensitive pattern | **CONFIRMED** | `Python3 foo.py`, `PIP install evil` → ALLOW. No `re.IGNORECASE` at line 118. Low real-world impact on Linux (case-sensitive filesystem), true hardening gap. |
| **F10** `match`+`$` vs `fullmatch`/`\Z` | **CONFIRMED (low, no allow-exploit)** | Verified: `deny_re.match("python3\n")` → True but `fullmatch` → False. Real behavioral difference, but it makes the guard *more* likely to deny, not allow — no bypass demonstrated. Cosmetic/hardening only. |

### Theme B — False positives

| ID | Verdict | Evidence |
|----|---------|----------|
| **F11** heredoc body | **CONFIRMED** | `cat <<'EOF'\npip is great\nEOF` → **DENY**. `split_segments` splits unconditionally on unquoted `\n` with no heredoc awareness; `pip is great` becomes a segment, `word="pip"` denied. Realistic: commit-message heredocs (per global CLAUDE.md) containing `pip`/`python` as prose get blocked. |
| **F12** `version_args` exact-list | **CONFIRMED** | `python3 --version 2>&1` → **DENY**. Line 128 `if args in version_args` needs exact `["--version"]`; the `2>&1` token makes `args=["--version","2>&1"]`, exemption misses, command denied. Extremely common "does python exist" idiom. |

### Theme C — Robustness / DoS

| ID | Verdict | Evidence |
|----|---------|----------|
| **F13** quadratic `shlex` DoS | **PARTIALLY CONFIRMED** | Superlinear scaling reproduced: `shlex.split` on 20k/40k/80k/160k `a`s → 0.009/0.026/0.082/0.276s (≈O(n^1.6)). Real, and `hooks/hooks.json` sets **no `timeout`** (confirmed) so Claude Code's 600s default governs. Downgraded to PARTIAL because the "hours / hung 2m+" figure is an extrapolation; a large embedded arg (base64/JSON blob) causing a multi-second-to-minute stall of every Bash call is the accurate, still-serious claim. |
| **F14** silent fail-open on malformed `tool_input` | **CONFIRMED** | e2e verified: `{"command":123}` → stderr `internal error, failing open: argument of type 'int' is not iterable`, exit 0, no deny; `{"tool_input":"notadict"}` and bare `[1,2,3]` likewise. Always exits 0, so stderr is invisible in normal (non-debug) operation. README documents only the "no uv" fail-open. |

### Theme D — Adapter parity & test integrity (verified by reading)

| ID | Verdict | Evidence |
|----|---------|----------|
| **F15** parity drift on unterminated quote | **CONFIRMED** | Python: `python3 'unterminated` → ALLOW (shlex raises → `extract_invocation` returns `(None,[])` → segment skipped). TS `tokens()` (opencode line 78 / pi line 79) pushes the trailing `cur` on unclosed quote → toks `["python3","unterminated"]` → `denyRe.test("python3")` → DENY. Same input, **opposite decision**, despite header comments claiming the adapters mirror the guard. (The comment even admits the divergence but asserts it "never flips a deny into an allow" — here it flips an *allow into a deny*, i.e. the guard is the lax one.) |
| **F16** "parity" test tests no parity | **CONFIRMED** | `adapters/tests/parity.test.ts` imports only `evaluate` from the two TS files and checks a hardcoded DENY/ALLOW list; it never invokes `hooks/scripts/tannedpy_guard.py` (contrast `tests/test_guard.py:155-198` which does via `subprocess`). Two identically-wrong TS impls pass 100% — exactly the F15 situation. README:56 repeats the overclaim. |
| **F17** no test scaffolding / CI | **CONFIRMED** | No `package.json`, `bunfig.toml`, `tsconfig.json`, JS lockfile; no `.github/workflows`. `bun test` per README has no automated home. (`uv.lock` present is Python-only.) |
| **F18** thin permission fallback | **CONFIRMED** | `opencode-permissions.json` denies only `python*/python2/python3/python3.*/pip/pip3/virtualenv` globs — no wrappers (`sudo`,`env`,`nice`…), no `-m pip`/`-m venv`, no `pip2`/`easy_install`, no `python2.*`. So `sudo python3 evil.py`, `python2.7 -m pip …`, `nice -n 10 pip …` sail through the one path that guards subagents (opencode #5894). (Minor reviewer nit: file *does* have `python3.*`, just not `python2.*` — asymmetry confirmed.) |
| **F19** adapters load patterns once | **CONFIRMED** | Both TS files parse `patterns.json` at module top-level (opencode 11-17 / pi 12-18); on failure `patterns` stays null and `evaluate()` returns null for the process lifetime (line 116/117). Python `main()` calls `load_patterns()` every invocation (line 139) and self-heals. Larger blast radius for a transient bad file on the TS side. |
| **F23** pi symlink may break relative path | **PARTIALLY CONFIRMED / runtime-dependent** | `index.ts:8` does `here = dirname(fileURLToPath(import.meta.url))` then joins `../../shared/patterns.json` lexically. If pi's `jiti` loader doesn't realpath the symlink, `here` is the symlink location → resolves to `~/.pi/agent/shared/patterns.json` (wrong) → permanent-inert (F19). Notably the **opencode README explicitly warns "a symlink breaks the relative path"** and recommends direct reference, yet the **pi README claims "dir symlink keeps relative paths intact"** — the two adapters give contradictory advice for the same mechanism. Can't execute pi to settle it; concern is real and untested. |
| **F24** opencode API usage uncited | **CONFIRMED** | pi README has a dated "API note" cross-checking two sources; opencode's `tool.execute.before` with `(input:{tool}, output:{args})` and throw-to-block (tannedpy.ts:129-140) has no equivalent verification — still the design-doc guess. Low. |

### Theme E/F — Structure & documentation

| ID | Verdict | Evidence |
|----|---------|----------|
| **F20** duplicate `.plugin/plugin.json` | **ADJUDICATED — deliberate, under-documented (plugin-structure correct; "stale cruft" DISPROVEN)** | `git show 54f835f` message states verbatim: *"'rules' is not a Claude Code field — kept in the generic .plugin/plugin.json for open-plugins conformance, dropped from the vendor manifest."* The commit intentionally diverged the two files. Both are git-tracked, both `version 0.1.0` (no mismatch). security-docs's "dead/drifted cruft" reading is wrong; the genuine defect is only that the intent is nowhere documented (no in-file comment, no README row), so a reader can't distinguish it from cruft. Severity: low (documentation). |
| **F21** README "fail-open by design" false | **CONFIRMED** | README:11-12 says "no uv on the machine → tannedpy goes inert." Guard has **no uv-presence check** (verified: `command -v uv`/`shutil.which` absent; the 3 "uv" hits are message text). Only `session-context.sh:3` checks uv, gating the banner. On a uv-less machine the guard still denies every python/pip call, redirecting to a tool that isn't installed. Directly contradicts the doc. |
| **F22** escape-hatch doc scoping mismatch | **CONFIRMED** | README:43-45 ("That exact marker"), `rules/tannedpy.md:7` ("mark the command"), `skills/uv-projects/SKILL.md` ("The `# tannedpy: allow` suffix bypasses it") all describe per-command scoping; F6 proves it's a whole-string substring kill-switch. Doc/behavior disagree. |
| **F25** README references missing `research/` | **CONFIRMED** | README:58-60 cites grimoire `research/` topics; `research/` does not exist (only `docs/superpowers/{plans,specs}`). Dead reference. Low. |
| **F26** two differing descriptions | **PARTIALLY CONFIRMED** | `marketplace.json:9` ("uv-first enforcement: blocks system python/pip, teaches uv shebang scripts") vs `plugin.json:4` (longer prose). They differ, but a short marketplace blurb vs a full manifest description is conventional; "inconsistency" is a stretch. Cosmetic. |

## 3. Ranked priority list (highest real-world risk first)

Risk = impact × likelihood in normal use × ease of exploit. `[EVERYDAY]` = fires on common non-adversarial
commands (highest priority); `[ADVERSARIAL]` = needs crafted input.

1. **F8 — omitted wrappers, esp. `timeout`** `[EVERYDAY]`. `timeout 30 python3 …` is a routine idiom; silently unguarded. Highest because it breaks enforcement on commands agents genuinely emit.
2. **F3 — `bash -c` / `sh -c` / `eval` / `ssh` / `find -exec`** `[EVERYDAY→ADVERSARIAL]`. `bash -c "python3 …"` is common and is *the* textbook wrap; full bypass.
3. **F12 — `--version 2>&1` false-positive DENY** `[EVERYDAY]`. Wrongly blocks a ubiquitous probe; erodes user trust in the guard's correctness.
4. **F11 — heredoc false-positive DENY** `[EVERYDAY]`. Wrongly blocks harmless commit-message/heredoc prose containing `pip`/`python`; directly collides with the global CLAUDE.md commit workflow.
5. **F6 — escape-hatch substring kill-switch** `[EVERYDAY + injection]`. Any line containing the marker anywhere disables the guard for the whole line; both an accidental footgun and a prompt-injection lever.
6. **F2 / F1 — command substitution & lone `&`** `[MODERATE]`. `$(python3 …)`, backticks, `<()`, `a & b` all bypass whenever an agent uses substitution/backgrounding.
7. **F4 — `command python3 …`** `[MODERATE]`. Bash builtin executes its arg; misclassified as a pure lookup.
8. **F14 — silent fail-open on malformed `tool_input`** `[MODERATE]`. Whole classes of payloads disable enforcement with zero visible signal.
9. **F13 — `shlex` superlinear DoS, no hook timeout** `[MODERATE]`. A large embedded arg can stall every Bash call for seconds-to-minutes.
10. **F5 — absolute-path wrappers** `[ADVERSARIAL]`. `/usr/bin/env python3 …` bypasses; less common in agent output.
11. **F7 — bundled sudo flags** `[ADVERSARIAL]`. `sudo -Eu root python3 …` desyncs arg-skipping.
12. **F9 / F10 — case sensitivity & anchoring** `[LOW hardening]`. No known real bypass; cheap to fix.

Adapter/test integrity (matters for opencode/pi users, not Claude Code):

13. **F16 — parity test tests nothing against the Python guard** (lets F15-style drift ship silently).
14. **F15 — Python allows what the TS adapters deny** (unterminated quote); the guard is the lax side.
15. **F18 — subagent permission fallback far thinner than the guard** (wrappers/`-m` forms bypass).
16. **F19 — TS adapters go permanently inert on a bad `patterns.json`.**
17. **F17 — no CI/test scaffolding for the adapter suite.**
18. **F23 — pi symlink install may silently break the patterns path** (runtime-dependent).

Documentation/structure (trust, not enforcement):

19. **F21 — "fail-open by design" is false** (guard denies on uv-less machines).
20. **F22 — escape-hatch docs describe scoping the code doesn't honor** (pairs with F6).
21. **F20 — undocumented deliberate duplicate manifest** / **F24** uncited opencode API / **F25** dead `research/` ref / **F26** description drift. All low/cosmetic.

## 4. Recommendations (ordered to match the ranking)

Most bypasses share **one root cause**: `extract_invocation` inspects only the first non-wrapper token of
each segment and never (a) recurses into arguments that are themselves commands, or (b) sees shell
constructs the splitter didn't tokenize. Fix the root cause once rather than adding N wrapper names.

**R1 — Recurse into command-valued arguments and expand the separator/construct set (fixes F1, F2, F3, F4, F8, F5, F7 together).**
Where: `hooks/scripts/tannedpy_guard.py` (`split_segments` + `extract_invocation`) and the mirrored TS
`splitSegments`/`extractInvocation`.
- After extracting the leading word, if it is a shell-invoking command (`sh`,`bash`,`zsh`,`eval`,`env` in
  `-c`/exec position, `timeout`,`doas`,`setsid`,`nice`,`ssh`,`xargs`, `find … -exec …`, `command`), take the
  string argument that is itself a command and re-run `evaluate()` on it recursively.
- Extend `split_segments` to also break on a lone `&` and to *descend into* `$(…)`, `` `…` `` and `<(…)`
  by recursively evaluating their inner text.
- For `command`, only treat it as a lookup when `-v`/`-V` is present; otherwise inspect its argument.
- Trade-off: recursion + more separators raises false-positive risk (e.g. denying a python reference inside
  a genuinely inert string) and adds complexity. Acceptable because the whole point is to *catch* nested
  invocations; pair with generous `# tannedpy: allow` guidance.
- Honest caveat: even done well this is **whack-a-mole** on a hand-rolled parser. The durable fix is R6.

**R2 — Make the `version_args` and heredoc handling tolerant (fixes F12, F11).** Quick wins, high UX payoff.
- F12: treat a command as a version check if the *first* arg is `--version`/`-V` and the rest are only
  redirections/pipes — or simpler, strip trailing redirection tokens (`2>&1`, `>…`) before the exact-match.
  `patterns.json:16` + `evaluate()` line 128.
- F11: teach `split_segments` heredoc awareness — when it sees `<<['"]?WORD`, swallow lines until the
  terminator instead of splitting/scanning the body. Trade-off: heredoc parsing is fiddly; a cheaper
  interim is to not scan any segment that is clearly heredoc-body text, accepting it may miss a real
  `python` *inside* a heredoc (rare, and body text usually isn't executed as a command anyway).

**R3 — Scope the escape hatch to the segment, and align the docs (fixes F6, F22).**
Move the `escape_hatch in command` check (line 116) to *inside* the per-segment loop so the marker only
whitelists the segment it trails, and require it as a trailing `#` comment rather than an anywhere-substring.
Trade-off: multi-segment "allow this whole line" usage would need the marker per segment — but that matches
what the docs already promise ("this exact command"), so it's a correctness alignment, not a regression.

**R4 — Fail *closed-ish* and *loud* on malformed input (fixes F14, partially F13).**
- Normalize `tool_input` defensively in `main()`: if `command` isn't a string, treat as empty and return
  (allow) — but emit a structured `permissionDecisionReason`-free note only in debug, OR better, deny with a
  clear "couldn't parse command" message for genuinely malformed Bash payloads. Trade-off: deny-on-unparseable
  risks false positives on exotic-but-valid input; given the hook is advisory, a *logged* fail-open is the
  safer default — but the log must be visible (see below).
- F13: add an input-length cap in `main()` (e.g. skip parsing beyond ~100 KB, treat as allow) and add a
  `"timeout"` to both entries in `hooks/hooks.json`. Cheap, removes the hang.

**R5 — Fix the adapter test to actually assert parity, then the drift surfaces (fixes F16, and exposes F15).**
Where: `adapters/tests/parity.test.ts`. Shell out to `hooks/scripts/tannedpy_guard.py` (as
`tests/test_guard.py` already does) and assert the TS `evaluate()` matches the Python decision for every
case, including `python3 'unterminated`. Add `package.json`/`tsconfig.json` and a CI workflow that runs both
`uv run pytest` and `bun test` (fixes F17). Then decide F15's direction deliberately — make the Python guard
deny unterminated-quote segments too (deny-leaning) so both sides agree. Also thicken
`opencode-permissions.json` to mirror `wrapper_commands` + `-m pip`/`-m venv` (F18), and have the TS adapters
reload patterns per-call or watch the file (F19).

**R6 — (Strategic) Replace the tokenizer with a real shell parser OR flip to allow-list.**
The regex-on-first-token core cannot be made robust by patching. Two durable options:
- **Parse properly:** use a shell AST (e.g. `bashlex` in Python) to enumerate *every* command node —
  including inside `$(…)`, `-c` strings, and pipelines — and test each command word. Highest fidelity;
  cost is a dependency and edge-case handling of unparseable input.
- **Deny-by-default allow-list:** invert the logic — allow only a known-safe set of leading tokens
  (`uv`, `uvx`, and vetted non-python tools) and flag everything that reaches a python/pip token anywhere.
  Fewer bypasses, but many more false positives and a larger allow-list to maintain.

**R7 — Documentation truth-up (fixes F21, F20, F24, F25, F26).** Quick edits: reword README:11-12 to
describe the *actual* behavior (guard always denies; the *SessionStart banner* is what goes inert without
uv) or add the uv-presence check to the guard if "inert without uv" is the intended design; add a one-line
comment in `.plugin/plugin.json` and a README row explaining the open-plugins duplicate; add the opencode
API verification note; drop or create the `research/` reference; reconcile the two descriptions.

## 5. Overall architecture assessment

**The guard is a useful *nudge* for a cooperative agent, but its current architecture — a hand-rolled
segment splitter feeding a regex on the first token — is not salvageable into robust enforcement by patching
alone.** Every Theme-A bypass traces to two shallow assumptions (only the first token matters; the splitter
sees all the ways a command starts), and both false positives trace to the same splitter being too naive
about heredocs and redirection. R1–R4 will close the *everyday* holes and stop the *everyday* false denials
— which is where the real user value is — but exotic vectors will keep appearing until R6 (a real parser or
an allow-list) is adopted.

Crucially, a `PreToolUse` hook is **inherently advisory**: an agent can be told to append `# tannedpy: allow`,
or simply comply differently, and nothing at this layer can stop a determined adversary or a jailbroken model.
So completeness has sharply diminishing returns. **Recommended posture:** treat the guard as a
guardrail-for-the-well-behaved. Invest heavily in R1–R4 (they fix things that break normal use *today*),
do R5/R7 to make the adapters and docs honest, and only pursue R6 if the project wants to market this as a
security control rather than a workflow nudge. Marketing it as "fail-open by design / security enforcement"
while it both mis-blocks `--version 2>&1` and waves through `timeout python3` is the current worst-of-both-worlds
that R2 + R1 + R7 should resolve first.
