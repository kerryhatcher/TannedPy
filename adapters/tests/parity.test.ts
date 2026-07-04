// Parity smoke suite — runs the same command table against both TS adapters
// (opencode and pi) to guarantee they agree with each other and with the
// Python guard's behavior (see tests/test_guard.py for the canonical suite).
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { evaluate as evaluateOpencode } from "../opencode/tannedpy.ts"
import { evaluate as evaluatePi } from "../pi/index.ts"

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, "..", "..")
const GUARD_PATH = join(REPO_ROOT, "hooks", "scripts", "tannedpy_guard.py")

const DENY: string[] = [
  "python3 foo.py",
  "python foo.py",
  "python3.12 foo.py",
  "/usr/bin/python3 foo.py",
  "pip install requests",
  "pip3 install requests",
  "cd /tmp && python3 foo.py",
  "ls; python x.py",
  "python -m venv .venv",
  "python3 -m pip install x",
  "virtualenv env",
  "easy_install thing",
  "sudo python3 x.py",
  "FOO=1 python x.py",
  "sudo -u root python3 evil.py",
  "nice -n 10 python3 evil.py",
  "xargs -n 1 python3",
  'pyt"hon3" evil.py',
  'pi"p" install x',
  '"python3" x.py',
]

const ALLOW: string[] = [
  "uv run python foo.py",
  "uv run python -c 'print(1)'",
  "uv add requests",
  "uvx ruff check",
  "which python3",
  "command -v python",
  "type python3",
  "grep python file.txt",
  "echo 'python3 is old'",
  'echo "python3 is old"',
  "cat requirements.txt",
  "git commit -m 'fix python handling'",
  "sudo -u root uv run x.py",
  "",
]

const ADAPTERS: Array<[string, (command: string) => { deny: string | null; note: string | null }]> = [
  ["opencode", evaluateOpencode],
  ["pi", evaluatePi],
]

for (const [name, evaluate] of ADAPTERS) {
  describe(`${name} adapter`, () => {
    describe("deny", () => {
      for (const command of DENY) {
        test(`denies: ${JSON.stringify(command)}`, () => {
          expect(evaluate(command).deny).toBeTruthy()
        })
      }
    })

    describe("allow", () => {
      for (const command of ALLOW) {
        test(`allows: ${JSON.stringify(command)}`, () => {
          expect(evaluate(command).deny).toBeNull()
        })
      }
    })

    describe("message routing", () => {
      test("pip install routes to `uv add`", () => {
        expect(evaluate("pip install requests").deny).toContain("uv add")
      })

      test("manual venv routes to `uv init` or `uv sync`", () => {
        const { deny } = evaluate("python -m venv .venv")
        expect(deny).toBeTruthy()
        expect(deny?.includes("uv init") || deny?.includes("uv sync")).toBe(true)
      })

      test("bare python routes to `uv run`", () => {
        expect(evaluate("python3 foo.py").deny).toContain("uv run")
      })
    })
  })
}

// --- Differential parity: version-probe conformance table (US3, FR-007) ----
//
// The Python guard is the oracle. For each command below we spawn the actual
// guard and assert both TS adapters return the identical (deny, note)
// classification and byte-identical note text — never a hand-maintained
// expectations list (Constitution III).

const VERSION_PROBE_TABLE: string[] = [
  "python3 --version 2>&1",
  "python3 --version",
  "python3 -V",
  "pip --version",
  "pip3 -V 2>&1",
  "python3 --version > /tmp/v.txt",
  "python3 --version >> log 2>&1",
  "python3 --version | grep 3",
  "sudo python3 --version 2>&1",
  "python3 --version && python3 train.py",
  "python3 --version --unknown-flag foo",
  "python3 script.py",
  "python3",
  "node --version",
  "ruby -v",
  "which python3",
  "uv run python --version",
  "python3 x.py  # tannedpy: allow",
  "timeout python3 --version",
]

function runPythonGuard(command: string): { deny: string | null; note: string | null } {
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    hook_event_name: "PreToolUse",
  })
  const result = spawnSync("uv", ["run", GUARD_PATH], {
    input: payload,
    encoding: "utf8",
    cwd: REPO_ROOT,
  })
  const stdout = (result.stdout ?? "").trim()
  if (!stdout) return { deny: null, note: null }
  const parsed = JSON.parse(stdout)
  const hso = parsed.hookSpecificOutput
  if (hso.permissionDecision === "deny") {
    return { deny: hso.permissionDecisionReason, note: null }
  }
  if (hso.permissionDecision === "defer" && hso.additionalContext) {
    return { deny: null, note: hso.additionalContext }
  }
  return { deny: null, note: null }
}

describe("differential parity: version-probe table vs actual Python guard", () => {
  for (const command of VERSION_PROBE_TABLE) {
    test(`oracle matches both adapters: ${JSON.stringify(command)}`, () => {
      const oracle = runPythonGuard(command)
      for (const [name, evaluate] of ADAPTERS) {
        const actual = evaluate(command)
        expect([name, actual.deny]).toEqual([name, oracle.deny])
        expect([name, actual.note]).toEqual([name, oracle.note])
      }
    })
  }
})
