# AGENTS.md — TannedPy

Instructions for AI agents working in this repository. (Read by Claude Code, Codex,
Cursor, and other agent tools.)

## What this project is

TannedPy is a Claude Code plugin whose `PreToolUse` guard
(`hooks/scripts/tannedpy_guard.py`) blocks system `python`/`pip` invocations and
nudges toward `uv`. TypeScript adapters mirror the guard for opencode and pi.

## Toolchain (non-negotiable)

- Use `uv`, never system `python`/`python3`. Prefix commands with `uv run`; manage
  deps with `uv add` / `uv add --dev` / `uv remove`.
- Lint with `ruff` before committing.
- Tests: `uv run pytest` (Python guard, ~60 cases) and `bun test` (TS adapter parity).

## ISSUES.yaml — the source of truth for known issues

`ISSUES.yaml` at the repo root is the machine-readable tracker of all known defects,
their verdicts, severities, priority ranking, and the recommendations that fix them.
It was generated from `docs/reviews/2026-07-03-multi-model-code-review.md` and is
kept in sync by hand thereafter.

**Why it exists (read before editing):** the underlying review is prose — easy for
humans, hard for agents. YAML makes the same facts queryable and diffable: you can
filter by `severity`, `exploit` direction, or `[everyday]` tag; follow the
`issues[].fixes` ↔ `recommendations[].fixes` cross-references; and track `status`
per issue without re-reading a 200-line report. It is the canonical to-do list for
hardening the guard.

### When you MUST use it

- **Before fixing anything in the guard/adapters/docs:** check `ISSUES.yaml` first.
  The issue is probably already catalogued with evidence, a `priority_rank`, and a
  linked recommendation (`R1`–`R7`). Work the ranking (rank 1 = highest real-world
  risk) unless the user directs otherwise.
- **After fixing an issue:** update its `status` from `open` to `fixed` (or `wontfix`
  with a reason). Do not delete the entry — the evidence and history stay useful.
- **When you discover a NEW issue:** add an entry. Use the next free `Fnn` id, follow
  the schema documented in the file header, and link it to a recommendation (add a
  new `Rnn` if none fits). Keep the `meta.stats` counts accurate.
- **When you change behavior a doc describes** (e.g. the escape hatch, fail-open):
  check whether a documentation issue (F21, F22, F25...) is now resolved and flip its
  `status`.

### Rules for editing ISSUES.yaml

- Preserve the schema and enum values exactly as documented in the file's header
  comment (`verdict`, `exploit`, `severity`, `category`, `status`). Invalid enums
  break the queries the file exists to enable.
- Keep cross-references bidirectional: every `issues[].fixes` id must exist in
  `recommendations[]`, and vice-versa.
- After any edit, validate parse + refs:

  ```bash
  uv run --with pyyaml python - <<'PY'
  import yaml
  d = yaml.safe_load(open("ISSUES.yaml"))
  ids = {i["id"] for i in d["issues"]}
  recs = {r["id"] for r in d["recommendations"]}
  assert all(f in recs for i in d["issues"] for f in i.get("fixes", [])), "dangling issue->fix"
  assert all(f in ids for r in d["recommendations"] for f in r.get("fixes", [])), "dangling rec->issue"
  print(f"OK: {len(ids)} issues, {len(recs)} recommendations")
  PY
  ```

- `meta_review` and per-issue `reviewer_note` fields capture nuance beyond the raw
  finding (e.g. F21's shebang wrinkle). Preserve them; add to them when you learn
  something the raw evidence misses.

## Design posture (important context for fixes)

A `PreToolUse` hook is **inherently advisory** — an agent can append the escape-hatch
marker or simply comply differently, so this layer cannot stop a determined or
jailbroken model. Treat the guard as a guardrail-for-the-well-behaved. Prioritize the
`[everyday]` issues (things that break or wrongly block normal use *today*); pursue a
real shell parser or allow-list (`R6`) only if the project is to be marketed as a
security control rather than a workflow nudge. See `ISSUES.yaml` `meta.thesis`.
