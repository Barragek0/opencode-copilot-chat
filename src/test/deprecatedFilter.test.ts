import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

// Install vscode mock before any extension imports (same pattern as goUsageTestUtils)
const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-deprecated-")), "index.js");
fs.mkdirSync(path.dirname(vscodeMockPath), { recursive: true });
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";\nmodule.exports = { workspace: { getConfiguration: () => ({ get: () => undefined }) } };`,
  "utf-8",
);
const originalResolveFilename = (Module as unknown as { _resolveFilename: (req: string, parent: unknown, ...args: unknown[]) => string })
  ._resolveFilename;
(Module as unknown as { _resolveFilename: (req: string, parent: unknown, ...args: unknown[]) => string })._resolveFilename = function (
  req: string,
  parent: unknown,
  ...args: unknown[]
): string {
  return req === "vscode" ? vscodeMockPath : originalResolveFilename.call(this, req, parent, ...args);
};

let shouldHideDeprecatedModel: typeof import("../provider/settings.js").shouldHideDeprecatedModel;
let GO_VENDOR: string;
let ZEN_VENDOR: string;
let AGENT_ZEN_VENDOR: string;
type CachedModelMetadataSnapshot = import("../models/metadata.js").CachedModelMetadataSnapshot;

before(async () => {
  const settings = await import("../provider/settings.js");
  shouldHideDeprecatedModel = settings.shouldHideDeprecatedModel;
  const types = await import("../providerTypes.js");
  GO_VENDOR = types.GO_VENDOR;
  ZEN_VENDOR = types.ZEN_VENDOR;
  AGENT_ZEN_VENDOR = types.AGENT_ZEN_VENDOR;
});

function snapshotWithStatus(modelId: string, status: string | undefined): CachedModelMetadataSnapshot {
  return {
    fetchedAt: Date.now(),
    providers: {
      opencodego: undefined,
      opencodezen: {
        [modelId]: { status },
      },
    },
  };
}

describe("shouldHideDeprecatedModel", () => {
  it("returns false for non-Zen vendors", () => {
    const snap = snapshotWithStatus("deepseek-v4-flash-free", "deprecated");
    assert.equal(shouldHideDeprecatedModel("deepseek-v4-flash-free", GO_VENDOR as never, snap), false);
  });

  it("returns false when status is not deprecated", () => {
    const snap = snapshotWithStatus("deepseek-v4-flash-free", "beta");
    assert.equal(shouldHideDeprecatedModel("deepseek-v4-flash-free", ZEN_VENDOR as never, snap), false);
  });

  it("returns false when status is absent", () => {
    const snap = snapshotWithStatus("deepseek-v4-flash-free", undefined);
    assert.equal(shouldHideDeprecatedModel("deepseek-v4-flash-free", ZEN_VENDOR as never, snap), false);
  });

  it("returns false when no live data (offline/fallback) — fail open", () => {
    const snap = snapshotWithStatus("deepseek-v4-flash-free", "deprecated");
    assert.equal(shouldHideDeprecatedModel("deepseek-v4-flash-free", ZEN_VENDOR as never, snap, undefined), false);
  });

  it("returns false when gateway still serves the model (stale models.dev)", () => {
    const snap = snapshotWithStatus("deepseek-v4-flash-free", "deprecated");
    const liveIds = new Set(["deepseek-v4-flash-free", "mimo-v2.5-free"]);
    assert.equal(shouldHideDeprecatedModel("deepseek-v4-flash-free", ZEN_VENDOR as never, snap, liveIds), false);
  });

  it("returns true when deprecated and gateway confirms model is absent", () => {
    const snap = snapshotWithStatus("ring-2.6-1t-free", "deprecated");
    const liveIds = new Set(["deepseek-v4-flash-free", "mimo-v2.5-free"]);
    assert.equal(shouldHideDeprecatedModel("ring-2.6-1t-free", ZEN_VENDOR as never, snap, liveIds), true);
  });

  it("resolves agent-variant vendor to base vendor", () => {
    const snap = snapshotWithStatus("deepseek-v4-flash-free", "deprecated");
    const liveIds = new Set(["deepseek-v4-flash-free"]);
    assert.equal(shouldHideDeprecatedModel("deepseek-v4-flash-free", AGENT_ZEN_VENDOR as never, snap, liveIds), false);
  });

  it("hides when live set is empty (gateway returned no models)", () => {
    const snap = snapshotWithStatus("deepseek-v4-flash-free", "deprecated");
    const liveIds = new Set<string>();
    assert.equal(shouldHideDeprecatedModel("deepseek-v4-flash-free", ZEN_VENDOR as never, snap, liveIds), true);
  });
});
