# tannedpy — pi adapter

## Install

pi auto-discovers extensions from `~/.pi/agent/extensions/*/index.ts` (global)
or `.pi/extensions/*/index.ts` (project-local) — subdirectory form, since this
adapter's `index.ts` needs to find `shared/patterns.json` via a relative path.
Symlink the whole `pi` directory (not just the file) so that relative path
stays intact:

    ln -s /path/to/tannedpy/adapters/pi ~/.pi/agent/extensions/tannedpy  # dir symlink keeps relative paths intact

Project-local extensions only load once the project is trusted by pi.
Extensions in auto-discovered locations support hot-reload via `/reload`.

## API note

Handler registration verified against the official docs at
`https://pi.dev/docs/latest/extensions` on 2026-07-03, and cross-checked
against the upstream source doc
`https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md`
(same date). Both sources agree:

- **Entry point:** an extension is a TypeScript module (loaded directly via
  `jiti`, no build step) whose default export is a factory function
  `(pi: ExtensionAPI) => void | Promise<void>` — sync or async.
- **Event name:** `tool_call` (not `beforeToolCall`). It fires after
  `tool_execution_start` and before the tool actually runs, so a handler can
  still block it.
- **Handler signature:** `pi.on("tool_call", async (event, ctx) => {...})`.
  The tool's arguments live at `event.input` (e.g. `event.input.command` for
  the shell tool), not `event.args` as earlier third-party research assumed.
- **Block-return shape:** `{ block: true, reason?: string }`. Returning
  `undefined` (or omitting `block`) allows the call through.
- **Shell tool name:** `"bash"`, lowercase — matches `event.toolName`.
- **Install locations:** `~/.pi/agent/extensions/*.ts` or
  `~/.pi/agent/extensions/*/index.ts` (global); `.pi/extensions/*.ts` or
  `.pi/extensions/*/index.ts` (project-local). Additional paths can be added
  via the `extensions` array in `settings.json`.

This adapter's registration code (`adapters/pi/index.ts`) reflects the
confirmed shape above, not the brief's original placeholder guess.

## Skills

pi consumes Agent Skills (SKILL.md) natively. Point pi at tannedpy's `skills/`
directory per pi's skills config, or symlink the two skill folders into your
pi skills location.

## Alternative: PizzaPi

The PizzaPi fork maps Claude Code plugins directly (PreToolUse → tool_call).
If you run PizzaPi, install tannedpy as a Claude Code plugin instead of using
this adapter.

## Verify

Ask pi to run `python3 -c "print(1)"` — expect the tannedpy block reason and a
`uv run` retry. `python3 --version` should pass.
