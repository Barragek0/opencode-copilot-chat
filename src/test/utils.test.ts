import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compactErrorCode,
  escapeHtml,
  firstString,
  formatCount,
  formatRelativeTime,
  formatTokenCount,
  formatUsd,
  getErrorMessage,
  isRecord,
  parseJsonSafe,
  positiveNumber,
  sleep,
  sleepWithCancellation,
  toFiniteNumber,
  type LikeCancellationToken,
} from "../utils.js";

describe("utils — isRecord", () => {
  it("accepts plain objects and rejects everything else", () => {
    assert.ok(isRecord({}));
    assert.ok(isRecord({ a: 1 }));
    assert.ok(!isRecord(null));
    assert.ok(!isRecord(undefined));
    assert.ok(!isRecord("x"));
    assert.ok(!isRecord(42));
    // NOTE: arrays intentionally pass isRecord — this matches the historical
    // helper used across the codebase (typeof object && !== null).
    assert.ok(isRecord([]));
    assert.ok(!isRecord(() => undefined));
  });
});

describe("utils — firstString", () => {
  it("returns the first defined, non-empty, trimmed string", () => {
    assert.equal(firstString(undefined, null, 42, "  hi  "), "hi");
    assert.equal(firstString("", "  ", "x"), "x");
    assert.equal(firstString("a", "b"), "a");
    assert.equal(firstString(undefined), undefined);
  });
});

describe("utils — compactErrorCode", () => {
  it("lowercases and strips non-alphanumeric characters", () => {
    assert.equal(compactErrorCode("Router.Unavailable"), "routerunavailable");
    assert.equal(compactErrorCode("GoSubscription: Monthly-Limit Exceeded!"), "gosubscriptionmonthlylimitexceeded");
    assert.equal(compactErrorCode("HTTP 429 — rate_limit"), "http429ratelimit");
  });
});

describe("utils — positiveNumber", () => {
  it("returns floored positive finite numbers only", () => {
    assert.equal(positiveNumber(12.7), 12);
    assert.equal(positiveNumber(1), 1);
    assert.equal(positiveNumber(0), undefined);
    assert.equal(positiveNumber(-5), undefined);
    assert.equal(positiveNumber(Number.NaN), undefined);
    assert.equal(positiveNumber(Number.POSITIVE_INFINITY), undefined);
    assert.equal(positiveNumber("12"), undefined);
    assert.equal(positiveNumber(undefined), undefined);
  });
});

describe("utils — toFiniteNumber", () => {
  it("clamps numeric values into [min, max]", () => {
    assert.equal(toFiniteNumber(0.2, 0.2), 0.2);
    assert.equal(toFiniteNumber(-1, 0.2, 0, 2), 0);
    assert.equal(toFiniteNumber(99, 0.2, 0, 2), 2);
    assert.equal(toFiniteNumber("0.5", 0.2), 0.2);
    assert.equal(toFiniteNumber(Number.NaN, 5), 5);
    assert.equal(toFiniteNumber(undefined, 5), 5);
  });
});

describe("utils — getErrorMessage", () => {
  it("extracts message from Error and stringifies anything else", () => {
    assert.equal(getErrorMessage(new Error("boom")), "boom");
    assert.equal(getErrorMessage("raw string"), "raw string");
    assert.equal(getErrorMessage(42), "42");
    assert.equal(getErrorMessage(null), "null");
  });
});

describe("utils — parseJsonSafe", () => {
  it("parses valid JSON and returns undefined on garbage", () => {
    assert.deepEqual(parseJsonSafe('{"a":1}'), { a: 1 });
    assert.equal(parseJsonSafe("not json"), undefined);
    assert.equal(parseJsonSafe(""), undefined);
  });
});

describe("utils — formatUsd", () => {
  it("formats two-decimal dollars", () => {
    assert.equal(formatUsd(12.3), "$12.30");
    assert.equal(formatUsd(0), "$0.00");
    assert.equal(formatUsd(1.005), "$1.00");
  });

  it("keeps sub-cent spend visible", () => {
    assert.equal(formatUsd(0.005), "$0.0050");
    assert.equal(formatUsd(0.0002), "$0.0002");
  });

  it("compacts large amounts", () => {
    assert.equal(formatUsd(1_500), "$1.50K");
    assert.equal(formatUsd(1_234_567), "$1.23M");
  });
});

describe("utils — formatTokenCount", () => {
  it("formats compact token counts", () => {
    assert.equal(formatTokenCount(0), "0");
    assert.equal(formatTokenCount(999), "999");
    assert.equal(formatTokenCount(1_234), "1.2k");
    assert.equal(formatTokenCount(12_345), "12k");
    assert.equal(formatTokenCount(1_234_567), "1.2M");
  });

  it("handles billions and trillions", () => {
    assert.equal(formatTokenCount(1_234_567_890), "1.2B");
    assert.equal(formatTokenCount(2_000_000_000_000), "2.0T");
  });

  it("formatCount compacts request-style counts", () => {
    assert.equal(formatCount(999), "999");
    assert.equal(formatCount(1_715), "1.7k");
    assert.equal(formatCount(12_345), "12k");
    assert.equal(formatCount(1_234_567), "1.2M");
  });

  it("escalates units when rounding would overflow", () => {
    assert.equal(formatTokenCount(999_500), "1.0M");
    assert.equal(formatTokenCount(999_999_500), "1.0B");
    assert.equal(formatTokenCount(999_999_999_500), "1.0T");
  });
});

describe("utils — formatRelativeTime", () => {
  it("renders compact relative times", () => {
    const from = new Date(1_000_000_000_000);
    assert.equal(formatRelativeTime(new Date(from.getTime() - 5_000), from), "now");
    assert.equal(formatRelativeTime(new Date(from.getTime() + 30_000), from), "1m");
    assert.equal(formatRelativeTime(new Date(from.getTime() + 5 * 60_000), from), "5m");
    assert.equal(formatRelativeTime(new Date(from.getTime() + 60 * 60_000), from), "1h");
    assert.equal(formatRelativeTime(new Date(from.getTime() + 2 * 60 * 60_000 + 20 * 60_000), from), "2h 20m");
    assert.equal(formatRelativeTime(new Date(from.getTime() + 26 * 60 * 60_000), from), "1d 2h");
  });
});

describe("utils — escapeHtml", () => {
  it("escapes the four HTML-significant characters", () => {
    assert.equal(escapeHtml(`<a href="x&y">`), "&lt;a href=&quot;x&amp;y&quot;&gt;");
    assert.equal(escapeHtml("plain"), "plain");
  });
});

describe("utils — sleep / sleepWithCancellation", () => {
  const cancelledToken: LikeCancellationToken = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  };

  it("sleep resolves after the delay", async () => {
    const started = Date.now();
    await sleep(15);
    assert.ok(Date.now() - started >= 10);
  });

  it("sleep rejects with AbortError when already cancelled", async () => {
    await assert.rejects(sleep(50, cancelledToken), { name: "AbortError" });
  });

  it("sleepWithCancellation resolves immediately when already cancelled", async () => {
    await sleepWithCancellation(5_000, cancelledToken);
  });

  it("sleepWithCancellation resolves after the delay", async () => {
    const started = Date.now();
    await sleepWithCancellation(15, { ...cancelledToken, isCancellationRequested: false });
    assert.ok(Date.now() - started >= 10);
  });
});
