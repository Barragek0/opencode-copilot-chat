import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trimOldMessagesToFitContext } from "../provider/historyTrim.js";
import type { ApiMessage } from "../request/types.js";

function textMessage(role: ApiMessage["role"], text: string): ApiMessage {
  return { role, content: text };
}

/** Effectively disables the byte-cap constraint so a test can focus on tokens. */
const NO_BYTE_CAP = Number.MAX_SAFE_INTEGER;

describe("trimOldMessagesToFitContext", () => {
  it("removes nothing when the history already fits the budget", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "system context"),
      textMessage("user", "hello"),
      textMessage("assistant", "hi there"),
    ];
    const result = trimOldMessagesToFitContext(messages, 10_000, NO_BYTE_CAP);
    assert.equal(result.removed, 0);
    assert.equal(messages.length, 3);
  });

  it("drops oldest messages until the payload fits, keeping anchor + last", () => {
    const messages: ApiMessage[] = [];
    messages.push(textMessage("user", "anchor system prompt that is fairly long to count as context"));
    for (let i = 0; i < 12; i++) {
      messages.push(textMessage("user", `repeated turn number ${i} with some padding text to grow the token estimate`));
      messages.push(textMessage("assistant", `response for turn ${i} with padding text to grow the token estimate`));
    }
    messages.push(textMessage("user", "latest prompt that must be preserved at all costs"));
    const before = messages.length;
    const result = trimOldMessagesToFitContext(messages, 200, NO_BYTE_CAP);
    assert.ok(result.removed > 0, "should have trimmed");
    assert.equal(messages.length, before - result.removed);
    // anchor (index 0) and last (current prompt) preserved
    assert.equal(messages[0].content, "anchor system prompt that is fairly long to count as context");
    assert.equal(messages[messages.length - 1].content, "latest prompt that must be preserved at all costs");
  });

  it("drops a complete tool-call group as one unit (never orphans a reference)", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "anchor"),
      textMessage("user", "old turn A padding padding padding padding padding padding padding"),
      textMessage("user", "old turn B padding padding padding padding padding padding padding"),
      {
        role: "assistant",
        content: "let me call a tool",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "fs", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "tool result text" },
      textMessage("user", "current prompt"),
    ];
    const result = trimOldMessagesToFitContext(messages, 50, NO_BYTE_CAP);
    // The whole tool group (assistant + its tool result) is dropped together,
    // so no tool reference is orphaned.
    assert.ok(result.removed >= 0);
    const hasToolCall = messages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
    const hasToolResult = messages.some((m) => m.role === "tool");
    assert.equal(hasToolCall, hasToolResult, "tool group must stay intact (both present or both gone)");
  });

  it("does not trim when only anchor + last remain", () => {
    const messages: ApiMessage[] = [textMessage("user", "anchor"), textMessage("user", "only prompt")];
    const result = trimOldMessagesToFitContext(messages, 1, NO_BYTE_CAP);
    assert.equal(result.removed, 0);
    assert.equal(messages.length, 2);
  });

  it("enforces a hard byte cap even when the token budget is generous", () => {
    const messages: ApiMessage[] = [];
    messages.push(textMessage("user", "anchor system prompt that is fairly long to count as context"));
    for (let i = 0; i < 20; i++) {
      messages.push(textMessage("user", `repeated turn number ${i} with some padding text to grow the payload size substantially`));
      messages.push(textMessage("assistant", `response for turn ${i} with padding text to grow the payload size substantially`));
    }
    messages.push(textMessage("user", "latest prompt that must be preserved at all costs"));
    const before = messages.length;
    // Token budget is huge, but the byte cap is tiny → must still trim.
    const result = trimOldMessagesToFitContext(messages, 10_000_000, 400);
    assert.ok(result.removed > 0, "byte cap should have trimmed");
    assert.equal(messages.length, before - result.removed);
    assert.equal(messages[0].content, "anchor system prompt that is fairly long to count as context");
    assert.equal(messages[messages.length - 1].content, "latest prompt that must be preserved at all costs");
    // The actual wire payload (no tools in this test) must be under the cap.
    assert.ok(JSON.stringify({ messages }).length <= 400, "payload must be under the byte cap");
  });

  it("returns the final token and byte estimates", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "anchor"),
      textMessage("user", "old turn padding padding padding padding padding padding padding padding padding padding"),
      textMessage("user", "current prompt"),
    ];
    const result = trimOldMessagesToFitContext(messages, 10, NO_BYTE_CAP);
    assert.ok(result.finalTokens > 0);
    assert.ok(result.finalBytes > 0);
    assert.equal(result.removed, 1);
  });

  it("never drops the anchor or the current prompt turn", () => {
    const messages: ApiMessage[] = [];
    messages.push(textMessage("user", "ANCHOR-CONTEXT"));
    for (let i = 0; i < 30; i++) {
      messages.push(textMessage("user", `middle turn ${i} padding padding padding padding padding padding padding padding`));
    }
    messages.push(textMessage("user", "CURRENT-PROMPT"));
    const result = trimOldMessagesToFitContext(messages, 5, 200);
    assert.equal(messages[0].content, "ANCHOR-CONTEXT");
    assert.equal(messages[messages.length - 1].content, "CURRENT-PROMPT");
    assert.ok(result.removed > 0);
  });
});
