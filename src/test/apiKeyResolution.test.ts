import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveResponseApiKey } from "../apiKeyResolution.js";

void describe("resolveResponseApiKey", () => {
  void it("prefers the request's native BYOK configuration", () => {
    assert.equal(resolveResponseApiKey("configured", "registered", "stored"), "configured");
  });

  void it("uses the key captured while registering the selected model", () => {
    assert.equal(resolveResponseApiKey(undefined, "registered", "stored"), "registered");
  });

  void it("falls back to SecretStorage after an extension-host cold start", () => {
    assert.equal(resolveResponseApiKey(undefined, undefined, "stored"), "stored");
  });
});
