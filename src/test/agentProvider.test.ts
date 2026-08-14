import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { providerVariant } from "../agentProvider.js";

describe("providerVariant", () => {
  it("preserves configured endpoints and marks the provider as an agent variant", () => {
    const base = {
      vendor: "opencodego",
      displayName: "OpenCode Go",
      baseUrl: "https://example.test/custom/v1",
      modelsUrl: "https://example.test/custom/v1/models",
      chatCompletionsUrl: "https://example.test/custom/v1/chat/completions",
      messagesUrl: "https://example.test/custom/v1/messages",
      responsesUrl: "https://example.test/custom/v1/responses",
    };

    const agent = providerVariant(base, "opencodego-agent", "OpenCode Go (Agents)", "opencodego");

    assert.equal(agent.isAgentVariant, true);
    assert.equal(agent.baseVendor, "opencodego");
    assert.equal(agent.vendor, "opencodego-agent");
    assert.equal(agent.modelsUrl, base.modelsUrl);
    assert.equal(agent.chatCompletionsUrl, base.chatCompletionsUrl);
    assert.equal(agent.messagesUrl, base.messagesUrl);
    assert.equal(agent.responsesUrl, base.responsesUrl);
  });
});
