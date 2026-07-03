// Parity smoke suite — runs the same command table against both TS adapters
// (opencode and pi) to guarantee they agree with each other and with the
// Python guard's behavior (see tests/test_guard.py for the canonical suite).
import { describe, expect, test } from "bun:test"
import { evaluate as evaluateOpencode } from "../opencode/tannedpy.ts"
import { evaluate as evaluatePi } from "../pi/index.ts"

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
  "python --version",
  "python3 -V",
  "which python3",
  "command -v python",
  "type python3",
  "grep python file.txt",
  "echo 'python3 is old'",
  'echo "python3 is old"',
  "cat requirements.txt",
  "python3 x.py  # tannedpy: allow",
  "pip install x  # tannedpy: allow",
  "git commit -m 'fix python handling'",
  "sudo -u root uv run x.py",
  "",
]

const ADAPTERS: Array<[string, (command: string) => string | null]> = [
  ["opencode", evaluateOpencode],
  ["pi", evaluatePi],
]

for (const [name, evaluate] of ADAPTERS) {
  describe(`${name} adapter`, () => {
    describe("deny", () => {
      for (const command of DENY) {
        test(`denies: ${JSON.stringify(command)}`, () => {
          expect(evaluate(command)).toBeTruthy()
        })
      }
    })

    describe("allow", () => {
      for (const command of ALLOW) {
        test(`allows: ${JSON.stringify(command)}`, () => {
          expect(evaluate(command)).toBeNull()
        })
      }
    })

    describe("message routing", () => {
      test("pip install routes to `uv add`", () => {
        expect(evaluate("pip install requests")).toContain("uv add")
      })

      test("manual venv routes to `uv init` or `uv sync`", () => {
        const reason = evaluate("python -m venv .venv")
        expect(reason).toBeTruthy()
        expect(reason?.includes("uv init") || reason?.includes("uv sync")).toBe(true)
      })

      test("bare python routes to `uv run`", () => {
        expect(evaluate("python3 foo.py")).toContain("uv run")
      })
    })
  })
}
