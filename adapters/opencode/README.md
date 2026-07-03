# tannedpy — opencode adapter

## Install

1. Clone the tannedpy repo (the adapter reads `shared/patterns.json` from it).
2. Symlink the plugin into your opencode plugin dir:
   `ln -s /path/to/tannedpy/adapters/opencode/tannedpy.ts ~/.config/opencode/plugin/tannedpy.ts`
   — NOTE: a symlink breaks the relative path to shared/patterns.json; instead
   reference the file directly in `opencode.json`:
   `{ "plugin": ["/path/to/tannedpy/adapters/opencode/tannedpy.ts"] }`
3. Defense-in-depth (recommended — plugin hooks do NOT fire for subagent tool
   calls, opencode issue #5894): merge `opencode-permissions.json` into your
   `opencode.json`.
4. Skills: opencode reads Claude-format skills from `~/.claude/skills/`. Symlink
   them: `ln -s /path/to/tannedpy/skills/uv-scripting ~/.claude/skills/` (and
   uv-projects), or install tannedpy as a Claude Code plugin on the same machine.
5. Rules: append `rules/tannedpy.md` to your global or project `AGENTS.md`.

## Verify

Run opencode, ask it to execute `python3 -c "print(1)"` — expect the tannedpy
deny message and a `uv run` retry. `python3 --version` should pass.
