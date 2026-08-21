import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeResponsesStreamEvent } from "../core/routing.js";

describe("normalizeResponsesStreamEvent — finish_reason mapping", () => {
  it("maps an unrecognized-but-valid stop_reason (max_tool_calls) to 'stop'", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.completed", response: { stop_reason: "max_tool_calls" } }) as {
      choices: { finish_reason: string | null }[];
    };
    assert.equal(result.choices[0]?.finish_reason, "stop");
  });

  it("keeps recognized values mapped (completed → stop)", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.completed", response: { stop_reason: "completed" } }) as {
      choices: { finish_reason: string | null }[];
    };
    assert.equal(result.choices[0]?.finish_reason, "stop");
  });

  it("returns null finish_reason when no stop_reason is present", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.completed", response: {} }) as {
      choices: { finish_reason: string | null }[];
    };
    assert.equal(result.choices[0]?.finish_reason, null);
  });
});
