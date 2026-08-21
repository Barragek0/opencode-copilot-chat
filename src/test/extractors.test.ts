import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Tests for the Responses extractor truncated → original tool name round-trip
 * (PR #168 review). Muse Spark truncates tool names >64 chars at request
 * build time; the extractor must reverse-lookup before emitting
 * LanguageModelToolCallPart so VS Code resolves the original tool.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-extractors-")), "index.js");
fs.writeFileSync(
    vscodeMockPath,
    `"use strict";
class LanguageModelTextPart { constructor(value) { this.value = value; } }
class LanguageModelThinkingPart { constructor(text) { this.text = text; } }
class LanguageModelToolCallPart {
  constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; }
}
class LanguageModelToolResultPart { constructor(callId, content) { this.callId = callId; this.content = content; } }
module.exports = { LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolResultPart };
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

let OpenAiResponseExtractor: typeof import("../transports/extractors.js").OpenAiResponseExtractor;
let truncateToolName: typeof import("../request/openai.js").truncateToolName;

describe("OpenAiResponseExtractor — truncated tool name round-trip", () => {
    before(async () => {
        const extractors = await import("../transports/extractors.js");
        OpenAiResponseExtractor = extractors.OpenAiResponseExtractor;
        const openai = await import("../request/openai.js");
        truncateToolName = openai.truncateToolName;
    });

    function makeExtractor(toolNameMap?: ReadonlyMap<string, string>) {
        // Constructor: onReasoningContent, onReasoningDebug, thinkFilter, progress, localRequestId, output, treatReasoningAsContent, toolNameMap
        return new OpenAiResponseExtractor(undefined, undefined, undefined, undefined, undefined, undefined, false, toolNameMap);
    }

    function toolCallDelta(name: string, args: string, index = 0, id = "call_1") {
        return {
            choices: [
                {
                    index: 0,
                    delta: {
                        tool_calls: [{ index, id, type: "function", function: { name, arguments: args } }],
                    },
                    finish_reason: null,
                },
            ],
        };
    }

    function finishReasonChunk(reason: string) {
        return {
            choices: [{ index: 0, delta: {}, finish_reason: reason }],
        };
    }

    it("emits original name when model returned truncated name", () => {
        const longName = "a".repeat(72);
        const truncated = truncateToolName(longName);
        assert.notEqual(truncated, longName);
        const map = new Map<string, string>([[truncated, longName]]);
        const extractor = makeExtractor(map);

        extractor.extractStreamParts(toolCallDelta(truncated, '{"q":"x"}'));
        const parts = extractor.extractStreamParts(finishReasonChunk("tool_calls")) as { name: string }[];
        assert.equal(parts.length, 1);
        assert.equal(parts[0].name, longName);
    });

    it("passes through name unchanged when no map entry", () => {
        const extractor = makeExtractor(new Map());
        extractor.extractStreamParts(toolCallDelta("read_file", '{"path":"/x"}'));
        const parts = extractor.extractStreamParts(finishReasonChunk("tool_calls")) as { name: string }[];
        assert.equal(parts[0].name, "read_file");
    });

    it("passes through name unchanged when no map provided", () => {
        const extractor = makeExtractor(undefined);
        extractor.extractStreamParts(toolCallDelta("grep_search", '{"query":"foo"}'));
        const parts = extractor.extractStreamParts(finishReasonChunk("tool_calls")) as { name: string }[];
        assert.equal(parts[0].name, "grep_search");
    });

    it("flushRemainingToolCalls also reverse-maps truncated names", () => {
        const longName = "b".repeat(72);
        const truncated = truncateToolName(longName);
        const map = new Map<string, string>([[truncated, longName]]);
        const extractor = makeExtractor(map);
        // Minimal progress stub — extractor reports via reportProgressPart
        const emitted: unknown[] = [];
        const progress: import("vscode").Progress<import("vscode").LanguageModelResponsePart2> = {
            report: (part) => {
                emitted.push(part);
            },
        };
        extractor.extractStreamParts(toolCallDelta(truncated, '{"q":"y"}'));
        // No finish_reason flush; use end-of-stream flush (gateway omits finish_reason)
        // flushRemainingToolCalls takes (progress, localRequestId)
        extractor.flushRemainingToolCalls(progress, undefined);
        // When progress is provided, flushRemainingToolCalls reports via progress, not return
        assert.equal(emitted.length, 1);
        assert.equal((emitted[0] as { name: string }).name, longName);
    });
});
