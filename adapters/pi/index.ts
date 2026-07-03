// tannedpy pi adapter — denies system python, redirects to uv.
// Mirrors hooks/scripts/tannedpy_guard.py and adapters/opencode/tannedpy.ts;
// rules come from shared/patterns.json.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const patterns = JSON.parse(
  readFileSync(join(here, "..", "..", "shared", "patterns.json"), "utf8"),
)

const denyRe = new RegExp(patterns.deny_command_pattern)
const wrappers = new Set<string>(patterns.wrapper_commands)
const wrapperValueFlags: Record<string, string[]> = patterns.wrapper_value_flags ?? {}
const lookups = new Set<string>(patterns.lookup_commands)
const versionArgs: string[][] = patterns.version_args

function splitSegments(command: string): string[] {
  const segments: string[] = []
  let buf = ""
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        buf += command.slice(i, i + 2); i++; continue
      }
      if (ch === quote) quote = null
      buf += ch; continue
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue }
    if (ch === "\\" && i + 1 < command.length) { buf += command.slice(i, i + 2); i++; continue }
    if (command.slice(i, i + 2) === "&&" || command.slice(i, i + 2) === "||") {
      segments.push(buf); buf = ""; i++; continue
    }
    if (ch === ";" || ch === "|" || ch === "\n") { segments.push(buf); buf = ""; continue }
    buf += ch
  }
  segments.push(buf)
  return segments.map((s) => s.trim()).filter(Boolean)
}

function tokens(segment: string): string[] {
  // Character-walking tokenizer mirroring shlex posix semantics: adjacent
  // quoted/unquoted pieces join into one token (pyt"hon3" -> python3),
  // quotes are stripped, and backslash escapes are resolved.
  const out: string[] = []
  let cur = ""
  let started = false
  let quote: string | null = null
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (quote) {
      if (quote === '"' && ch === "\\" && i + 1 < segment.length) { cur += segment[i + 1]; i++; continue }
      if (ch === quote) { quote = null; continue }
      cur += ch
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue }
    if (ch === "\\" && i + 1 < segment.length) { cur += segment[i + 1]; i++; started = true; continue }
    if (/\s/.test(ch)) {
      if (started) { out.push(cur); cur = ""; started = false }
      continue
    }
    cur += ch
    started = true
  }
  if (started) out.push(cur)
  return out
}

function extractInvocation(segment: string): [string | null, string[]] {
  const toks = tokens(segment)
  let idx = 0
  while (idx < toks.length) {
    const tok = toks[idx]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) { idx++; continue }
    if (wrappers.has(tok)) {
      const valueFlags = wrapperValueFlags[tok] ?? []
      idx++
      while (idx < toks.length && toks[idx].startsWith("-")) {
        if (valueFlags.includes(toks[idx])) {
          idx += 2
        } else {
          idx++
        }
      }
      continue
    }
    break
  }
  if (idx >= toks.length) return [null, []]
  const word = toks[idx].split("/").pop() ?? toks[idx]
  return [word, toks.slice(idx + 1)]
}

function pickMessage(word: string, args: string[]): string {
  const m = patterns.messages
  if (word.startsWith("pip") || word === "easy_install") return m.install
  if (word === "virtualenv" || (args[0] === "-m" && args[1] === "venv")) return m.venv
  if (args[0] === "-m" && args[1] === "pip") return m.install
  return m.run
}

export function evaluate(command: string): string | null {
  if (command.includes(patterns.escape_hatch)) return null
  for (const segment of splitSegments(command)) {
    const [word, args] = extractInvocation(segment)
    if (word === null || word === "uv" || lookups.has(word)) continue
    if (denyRe.test(word)) {
      if (versionArgs.some((v) => v.length === args.length && v.every((x, i) => x === args[i]))) continue
      return pickMessage(word, args)
    }
  }
  return null
}

// Registration — verified against https://pi.dev/docs/latest/extensions on
// 2026-07-03 (see README.md "API note" for details). Extensions export a
// default factory function receiving ExtensionAPI; the `tool_call` event
// fires before execution and can block by returning `{ block: true, reason }`.
interface ToolCallEvent {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}

interface ExtensionAPI {
  on: (
    event: "tool_call",
    handler: (
      event: ToolCallEvent,
      ctx: { signal?: AbortSignal },
    ) => { block: true; reason?: string } | undefined | Promise<{ block: true; reason?: string } | undefined>,
  ) => void
}

export default function tannedpy(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return undefined
    const reason = evaluate(String(event.input.command ?? ""))
    if (reason) return { block: true, reason }
    return undefined
  })
}
