import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildResponsesRequestEnvelope } from "../responsesRequest.js";

describe("buildResponsesRequestEnvelope", () => {
  it("enables server-side input truncation for long Responses sessions", () => {
    const body = buildResponsesRequestEnvelope({
      model: "gpt-5.6-luna",
      input: [{ role: "user", content: "hello" }],
      maxOutputTokens: 4096,
    });

    assert.equal(body.truncation, "auto");
    assert.equal(body.max_output_tokens, 4096);
  });

  it("does not force an unsupported text verbosity option", () => {
    const body = buildResponsesRequestEnvelope({
      model: "gpt-5.6-luna",
      input: [],
      maxOutputTokens: 1024,
    });

    assert.ok(!("text" in body));
  });

  it("only includes optional temperature and tool fields when provided", () => {
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
