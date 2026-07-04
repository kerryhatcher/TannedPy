// Delivery-mechanics tests (US3, contracts/runtime-integrations.md §2-4): a
// recognized probe's note must land in the tool result the model reads; a
// denied command must still throw/block with no note; a non-probe allowed
// command must leave the tool result untouched; the stash must be one-shot.
import { describe, expect, test } from "bun:test"
import { TannedPyPlugin } from "../opencode/tannedpy.ts"
import tannedpy from "../pi/index.ts"

describe("opencode adapter delivery", () => {
  test("probe: note is appended to the tool result after execution", async () => {
    const plugin = await TannedPyPlugin()
    const before = plugin["tool.execute.before"]
    const after = plugin["tool.execute.after"]
    const callID = "call-probe-1"
    await before({ tool: "bash", sessionID: "s1", callID }, { args: { command: "python3 --version" } })
    const output = { title: "python3 --version", output: "Python 3.11.0", metadata: {} }
    await after({ tool: "bash", sessionID: "s1", callID, args: { command: "python3 --version" } }, output)
    expect(output.output).toContain("Python 3.11.0")
    expect(output.output).toContain("uv")
  })

  test("deny: before hook throws and no note is stashed", async () => {
    const plugin = await TannedPyPlugin()
    const before = plugin["tool.execute.before"]
    const after = plugin["tool.execute.after"]
    const callID = "call-deny-1"
    await expect(
      before({ tool: "bash", sessionID: "s1", callID }, { args: { command: "python3 script.py" } }),
    ).rejects.toThrow()
    const output = { title: "python3 script.py", output: "", metadata: {} }
    await after({ tool: "bash", sessionID: "s1", callID, args: { command: "python3 script.py" } }, output)
    expect(output.output).toBe("")
  })

  test("non-probe allow: tool result is left untouched", async () => {
    const plugin = await TannedPyPlugin()
    const before = plugin["tool.execute.before"]
    const after = plugin["tool.execute.after"]
    const callID = "call-plain-1"
    await before({ tool: "bash", sessionID: "s1", callID }, { args: { command: "node --version" } })
    const output = { title: "node --version", output: "v20.0.0", metadata: {} }
    await after({ tool: "bash", sessionID: "s1", callID, args: { command: "node --version" } }, output)
    expect(output.output).toBe("v20.0.0")
  })

  test("stash is one-shot: a second after-call for the same callID appends nothing more", async () => {
    const plugin = await TannedPyPlugin()
    const before = plugin["tool.execute.before"]
    const after = plugin["tool.execute.after"]
    const callID = "call-probe-2"
    await before({ tool: "bash", sessionID: "s1", callID }, { args: { command: "pip --version" } })
    const output = { title: "pip --version", output: "pip 24.0", metadata: {} }
    await after({ tool: "bash", sessionID: "s1", callID, args: { command: "pip --version" } }, output)
    const firstLength = output.output.length
    await after({ tool: "bash", sessionID: "s1", callID, args: { command: "pip --version" } }, output)
    expect(output.output.length).toBe(firstLength)
  })
})

function makeFakePi() {
  const handlers: Record<string, Array<(event: unknown) => unknown>> = {}
  return {
    on: (event: string, handler: (event: unknown) => unknown) => {
      ;(handlers[event] ??= []).push(handler)
    },
    handlers,
  }
}

describe("pi adapter delivery", () => {
  test("probe: tool_result appends a text content block with the note", () => {
    const fakePi = makeFakePi()
    // biome-ignore lint: test double, shape matches ExtensionAPI at call sites used
    tannedpy(fakePi as never)
    const toolCall = fakePi.handlers["tool_call"][0]
    const toolResult = fakePi.handlers["tool_result"][0]

    const callRes = toolCall({ toolName: "bash", toolCallId: "id-1", input: { command: "python3 --version" } })
    expect(callRes).toBeUndefined()

    const resultRes = toolResult({
      toolCallId: "id-1",
      content: [{ type: "text", text: "Python 3.11.0" }],
    }) as { content: Array<{ type: string; text: string }> } | undefined
    expect(resultRes).toBeDefined()
    expect(resultRes?.content).toHaveLength(2)
    expect(resultRes?.content[1].text).toContain("uv")
  })

  test("deny: tool_call blocks and tool_result carries no note", () => {
    const fakePi = makeFakePi()
    tannedpy(fakePi as never)
    const toolCall = fakePi.handlers["tool_call"][0]
    const toolResult = fakePi.handlers["tool_result"][0]

    const callRes = toolCall({ toolName: "bash", toolCallId: "id-2", input: { command: "python3 script.py" } }) as
      | { block: true; reason?: string }
      | undefined
    expect(callRes?.block).toBe(true)

    const resultRes = toolResult({ toolCallId: "id-2", content: [] })
    expect(resultRes).toBeUndefined()
  })

  test("non-probe allow: tool_result returns undefined (untouched)", () => {
    const fakePi = makeFakePi()
    tannedpy(fakePi as never)
    const toolCall = fakePi.handlers["tool_call"][0]
    const toolResult = fakePi.handlers["tool_result"][0]

    toolCall({ toolName: "bash", toolCallId: "id-3", input: { command: "node --version" } })
    const resultRes = toolResult({ toolCallId: "id-3", content: [{ type: "text", text: "v20" }] })
    expect(resultRes).toBeUndefined()
  })

  test("stash is one-shot: a second tool_result for the same callId returns undefined", () => {
    const fakePi = makeFakePi()
    tannedpy(fakePi as never)
    const toolCall = fakePi.handlers["tool_call"][0]
    const toolResult = fakePi.handlers["tool_result"][0]

    toolCall({ toolName: "bash", toolCallId: "id-4", input: { command: "python3 -V" } })
    const first = toolResult({ toolCallId: "id-4", content: [] })
    expect(first).toBeDefined()
    const second = toolResult({ toolCallId: "id-4", content: [] })
    expect(second).toBeUndefined()
  })
})
