import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { parseServerSentEvent, isStreamTruncated } from "../transports/sse.js";

// Recording extractor factory: returns no parts but counts invocations so we can
// assert [DONE] is skipped (extractParts must NOT be called for the [DONE] line).
const makeExtractor = (counter: { calls: number }) => (): vscode.LanguageModelResponsePart[] => {
  counter.calls += 1;
  return [];
};

describe("parseServerSentEvent — [DONE] handling", () => {
  it("invokes onDone and skips extractParts for [DONE]", () => {
    let doneCalls = 0;
    const counter = { calls: 0 };
    parseServerSentEvent(
      'data: {"content":"hello"}\n\ndata: [DONE]\n\n',
      makeExtractor(counter),
      () => {},
      () => {
        doneCalls += 1;
      },
    );
    assert.equal(doneCalls, 1);
    assert.equal(counter.calls, 1);
  });

  it("does not invoke onDone when [DONE] is absent", () => {
    let doneCalls = 0;
    const counter = { calls: 0 };
    parseServerSentEvent(
      'data: {"content":"hi"}\n\n',
      makeExtractor(counter),
      () => {},
      () => {
        doneCalls += 1;
      },
    );
    assert.equal(doneCalls, 0);
    assert.equal(counter.calls, 1);
  });

  it("invokes onDone once even when [DONE] appears among multiple events", () => {
    let doneCalls = 0;
    const counter = { calls: 0 };
    parseServerSentEvent(
      'data: {"content":"a"}\n\ndata: {"content":"b"}\n\ndata: [DONE]\n\n',
      makeExtractor(counter),
      () => {},
      () => {
        doneCalls += 1;
      },
    );
    assert.equal(doneCalls, 1);
    assert.equal(counter.calls, 2);
  });
});

describe("isStreamTruncated", () => {
  it("flags a closed stream that carried content but no [DONE]/finish_reason", () => {
    assert.equal(isStreamTruncated({ sawDone: false, finishReason: undefined, extractedPartCount: 5, totalBytes: 100 }), true);
  });

  it("does not flag a stream that saw [DONE]", () => {
    assert.equal(isStreamTruncated({ sawDone: true, finishReason: undefined, extractedPartCount: 5, totalBytes: 100 }), false);
  });

  it("does not flag a stream that captured a finish_reason", () => {
    assert.equal(isStreamTruncated({ sawDone: false, finishReason: "stop", extractedPartCount: 5, totalBytes: 100 }), false);
  });

  it("does not flag an empty stream (no content extracted)", () => {
    assert.equal(isStreamTruncated({ sawDone: false, finishReason: undefined, extractedPartCount: 0, totalBytes: 100 }), false);
  });

  it("does not flag a stream with no bytes", () => {
    assert.equal(isStreamTruncated({ sawDone: false, finishReason: undefined, extractedPartCount: 5, totalBytes: 0 }), false);
  });
});
