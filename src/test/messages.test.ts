import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trimOldMessagesToFitContext } from "../provider/historyTrim.js";
import type { ApiMessage } from "../request/types.js";

function textMessage(role: ApiMessage["role"], text: string): ApiMessage {
  return { role, content: text };
}

describe("trimOldMessagesToFitContext", () => {
  it("removes nothing when the history already fits the budget", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "system context"),
      textMessage("user", "hello"),
      textMessage("assistant", "hi there"),
    ];
    const removed = trimOldMessagesToFitContext(messages, 10_000);
    assert.equal(removed, 0);
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
    const removed = trimOldMessagesToFitContext(messages, 200);
    assert.ok(removed > 0, "should have trimmed");
    assert.equal(messages.length, before - removed);
    // anchor (index 0) and last (current prompt) preserved
    assert.equal(messages[0].content, "anchor system prompt that is fairly long to count as context");
    assert.equal(messages[messages.length - 1].content, "latest prompt that must be preserved at all costs");
  });

  it("never splits a tool-call group (stops before the first tool group)", () => {
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
    const removed = trimOldMessagesToFitContext(messages, 50);
    // Trimming may drop the two old user turns, but must stop at the tool group
    // so no tool reference is orphaned.
    assert.ok(removed >= 0);
    const hasToolCall = messages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
    const hasToolResult = messages.some((m) => m.role === "tool");
    assert.equal(hasToolCall, hasToolResult, "tool group must stay intact");
  });

  it("does not trim when only anchor + last remain", () => {
    const messages: ApiMessage[] = [textMessage("user", "anchor"), textMessage("user", "only prompt")];
    const removed = trimOldMessagesToFitContext(messages, 1);
    assert.equal(removed, 0);
    assert.equal(messages.length, 2);
  });
});
