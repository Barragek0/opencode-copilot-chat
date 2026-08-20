import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Tests covering one of the fixes for #165: The Responses API rejects tool names longer than 64 characters, and Muse Spark tool names can be arbitrarily long. The truncation strategy is to keep the first 55 characters, append an underscore, and then append an 8-character hash of the original name. This ensures that the truncated name is unique and deterministic.
 * The truncation is deterministic and includes a hash suffix to avoid collisions.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-openai-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
class LanguageModelChatToolMode { static Required = "required"; }
module.exports = { LanguageModelChatToolMode };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildResponsesRequestBody: (...args: any[]) => Record<string, unknown>;

describe("buildResponsesRequestBody — Muse Spark tool name truncation", () => {
  before(async () => {
    const mod = await import("../request/openai.js");
    buildResponsesRequestBody = mod.buildResponsesRequestBody;
  });

  const longToolName = "a".repeat(72);
  const shortToolName = "read_file";
  const exactly64 = "b".repeat(64);

  const makeTool = (name: string) => ({
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
  });

  const baseArgs = {
    messages: [{ role: "user", content: "hello" }],
    settings: { temperature: 0.2, thinking: {} },
    metadata: {},
    limits: { maxOutputTokens: 4096 },
  };

  it("truncates long tool names for Muse Spark", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      { tools: [makeTool(longToolName)] },
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.ok(tool.name.length <= 64, `expected ≤64 chars, got ${tool.name.length}`);
    assert.ok(tool.name !== longToolName, "name should have been truncated");
    assert.ok(tool.name.includes("_"), "truncated name should contain underscore separator");
  });

  it("truncates long tool names for Muse Spark free variant", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor-free",
      baseArgs.messages,
      { tools: [makeTool(longToolName)] },
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.ok(tool.name.length <= 64, `expected ≤64 chars, got ${tool.name.length}`);
  });

  it("does NOT truncate tool names for non-Muse models", () => {
    const body = buildResponsesRequestBody(
      "gpt-5.6-luna",
      baseArgs.messages,
      { tools: [makeTool(longToolName)] },
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.equal(tool.name, longToolName, "non-Muse models should pass names through unchanged");
  });

  it("does NOT truncate short tool names even for Muse Spark", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      { tools: [makeTool(shortToolName)] },
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.equal(tool.name, shortToolName, "short names should pass through unchanged");
  });

  it("does NOT truncate names that are exactly 64 characters", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      { tools: [makeTool(exactly64)] },
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.equal(tool.name, exactly64, "exactly-64-char names should not be truncated");
  });

  it("produces deterministic truncation", () => {
    const make = () =>
      buildResponsesRequestBody(
        "muse-spark-1.2-contributor",
        baseArgs.messages,
        { tools: [makeTool(longToolName)] },
        baseArgs.settings,
        baseArgs.metadata,
        baseArgs.limits,
      );
    const name1 = (make().tools as { name: string }[])[0].name;
    const name2 = (make().tools as { name: string }[])[0].name;
    assert.equal(name1, name2, "same input should produce same output");
  });

  it("produces unique names for different long tool names", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      { tools: [makeTool("a".repeat(72)), makeTool("b".repeat(72))] },
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tools = body.tools as { name: string }[];
    assert.equal(tools.length, 2);
    assert.notEqual(tools[0].name, tools[1].name, "different long names should produce different truncated names");
  });
});
