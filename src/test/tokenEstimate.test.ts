import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimatePromptTokenCount, estimateTokenCount } from "../tokenEstimate.js";

describe("token estimates", () => {
  it("returns zero for empty content", () => {
    assert.equal(estimateTokenCount(""), 0);
    assert.equal(estimateTokenCount("   \n\t"), 0);
  });

  it("includes tool schemas in the prompt estimate", () => {
    const messages = [{ role: "user", content: "inspect the workspace" }];
    const withoutTools = estimatePromptTokenCount(messages);
    const withTools = estimatePromptTokenCount(messages, [
      {
        name: "read_file",
        description: "Read a file from the workspace",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute file path" },
          },
          required: ["path"],
        },
      },
    ]);

    assert.ok(withTools > withoutTools);
  });
});
