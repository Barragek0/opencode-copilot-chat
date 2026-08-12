import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// ── vscode stub ─────────────────────────────────────────────────────────────
// chatParts.ts instantiates vscode.LanguageModelDataPart; redirect require
// ("vscode") to a tiny stub like the other vscode-dependent tests do.

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-opencode-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
class LanguageModelDataPart {
  constructor(data, mimeType) {
    this.data = data;
    this.mimeType = mimeType;
  }
}
module.exports = { LanguageModelDataPart };
`,
  "utf-8",
);

type ResolveFilename = (request: string, parent: unknown, ...args: unknown[]) => string;
const moduleResolver = Module as unknown as { _resolveFilename: ResolveFilename };
const originalResolveFilename = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function (request: string, parent: unknown, ...args: unknown[]): string {
  if (request === "vscode") {
    return vscodeMockPath;
  }
  return originalResolveFilename.call(this, request, parent, ...args);
};

let createReasoningMarkerPart: (reasoning: string) => { data: Uint8Array; mimeType: string };
let isReasoningMarkerPart: (part: { data: Uint8Array; mimeType: string }) => boolean;
let readReasoningMarker: (part: { data: Uint8Array; mimeType: string }) => string | undefined;

describe("chatParts reasoning marker", () => {
  before(async () => {
    const mod = await import("../chatParts.js");
    createReasoningMarkerPart = mod.createReasoningMarkerPart;
    isReasoningMarkerPart = mod.isReasoningMarkerPart;
    readReasoningMarker = mod.readReasoningMarker;
  });

  it("round-trips the reasoning text through the marker part", () => {
    const part = createReasoningMarkerPart("step 1\nstep 2");
    assert.equal(part.mimeType, "application/vnd.opencode.reasoning+json");
    assert.equal(isReasoningMarkerPart(part), true);
    assert.equal(readReasoningMarker(part), "step 1\nstep 2");
  });

  it("is not mistaken for other internal data parts", () => {
    const part = createReasoningMarkerPart("x");
    const usageLike = { mimeType: "application/vnd.opencode.usage+json", data: new Uint8Array() };
    assert.equal(isReasoningMarkerPart(usageLike), false);
    assert.equal(part.mimeType === usageLike.mimeType, false);
  });

  it("returns undefined for malformed or foreign marker payloads", () => {
    const malformed = { data: new TextEncoder().encode("not json"), mimeType: "application/vnd.opencode.reasoning+json" };
    assert.equal(readReasoningMarker(malformed), undefined);
    const wrongShape = {
      data: new TextEncoder().encode(JSON.stringify({ other: 1 })),
      mimeType: "application/vnd.opencode.reasoning+json",
    };
    assert.equal(readReasoningMarker(wrongShape), undefined);
  });
});
