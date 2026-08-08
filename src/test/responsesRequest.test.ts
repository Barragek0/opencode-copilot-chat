import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildResponsesRequestEnvelope, responsesInputItemsFromMessage } from "../responsesRequest.js";

void describe("buildResponsesRequestEnvelope", () => {
  void it("enables server-side input truncation for long Responses sessions", () => {
    const body = buildResponsesRequestEnvelope({
      model: "gpt-5.6-luna",
      input: [{ role: "user", content: "hello" }],
      maxOutputTokens: 4096,
    });

    assert.equal(body.truncation, "auto");
    assert.equal(body.max_output_tokens, 4096);
  });

  void it("does not force an unsupported text verbosity option", () => {
    const body = buildResponsesRequestEnvelope({
      model: "gpt-5.6-luna",
      input: [],
      maxOutputTokens: 1024,
    });

    assert.ok(!("text" in body));
  });

  void it("only includes optional temperature and tool fields when provided", () => {
    const body = buildResponsesRequestEnvelope({
      model: "gpt-5.6-luna",
      input: [],
      maxOutputTokens: 1024,
      temperature: 0.2,
      thinkingPayload: { reasoning: { effort: "high" } },
      tools: [{ type: "function", name: "read_file" }],
      toolChoice: "auto",
    });

    assert.equal(body.temperature, 0.2);
    assert.deepEqual(body.reasoning, { effort: "high" });
    assert.deepEqual(body.tools, [{ type: "function", name: "read_file" }]);
    assert.equal(body.tool_choice, "auto");
  });
});

void describe("responsesInputItemsFromMessage", () => {
  void it("emits user image as input_image with image_url as a plain STRING", () => {
    // Regression: the Responses API expects `input_image.image_url` to be a
    // string (URL or base64 data URL), NOT the `{ url }` object shape used by
    // Chat Completions. The nested object made the gateway reject the request
    // with `invalid_prompt` (HTTP 400) for gpt-5.6-luna with an image.
    const items = responsesInputItemsFromMessage({
      role: "user",
      content: [
        { type: "text", text: "what is in this image?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });

    assert.equal(items.length, 1);
    const content = (items[0] as { content: Record<string, unknown>[] }).content;
    assert.deepEqual(content, [
      { type: "input_text", text: "what is in this image?" },
      { type: "input_image", image_url: "data:image/png;base64,AAAA" },
    ]);
  });

  void it("drops an empty string user message", () => {
    const items = responsesInputItemsFromMessage({ role: "user", content: "" });
    assert.deepEqual(items, []);
  });

  void it("emits assistant text as output_text and tool calls as function_call", () => {
    const items = responsesInputItemsFromMessage({
      role: "assistant",
      content: [{ type: "text", text: "let me check" }],
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        },
      ],
    });

    assert.deepEqual(items, [
      { role: "assistant", content: [{ type: "output_text", text: "let me check" }] },
      {
        type: "function_call",
        id: "call_1",
        call_id: "call_1",
        name: "read_file",
        arguments: '{"path":"a.ts"}',
      },
    ]);
  });

  void it("degrades tool results with images to a text note", () => {
    const items = responsesInputItemsFromMessage({
      role: "tool",
      tool_call_id: "call_1",
      content: [
        { type: "text", text: "screenshot taken" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });

    assert.equal(items.length, 1);
    const output = (items[0] as { output: string }).output;
    assert.match(output, /screenshot taken/);
    assert.match(output, /Responses API does not support images in tool output/);
  });

  void it("returns no items for unsupported roles", () => {
    const items = responsesInputItemsFromMessage({
      role: "system",
      content: "be helpful",
    });
    assert.deepEqual(items, []);
  });
});
