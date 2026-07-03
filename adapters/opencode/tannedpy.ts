// tannedpy opencode adapter — denies system python, redirects to uv.
// Mirrors hooks/scripts/tannedpy_guard.py; rules come from shared/patterns.json.
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
  // Light tokenizer: strip quotes, split on whitespace. Parity with shlex
  // is not required — only the command word position matters here.
  const out: string[] = []
  const re = /'([^']*)'|"((?:\\.|[^"])*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3])
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

export const TannedPyPlugin = async () => {
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args: { command?: string } },
    ) => {
      if (input.tool !== "bash") return
      const reason = evaluate(output.args.command ?? "")
      if (reason) throw new Error(reason)
    },
  }
}
