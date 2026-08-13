import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompletionWindow, DEFAULT_PREFIX_LINES, DEFAULT_SUFFIX_CHARS } from "../autocomplete/context";
import { buildCompletionPrompt, completionFamily, COMPLETION_SYSTEM_PROMPT } from "../autocomplete/prompt";
import { cleanCompletion, extractChatCompletionText, parseSseData } from "../autocomplete/engine";
import { Debouncer } from "../autocomplete/throttle";

describe("autocomplete — completionFamily", () => {
  it("classifies qwen and deepseek families", () => {
    assert.equal(completionFamily("qwen3.5-plus"), "qwen");
    assert.equal(completionFamily("qwen3.7-max"), "qwen");
    assert.equal(completionFamily("deepseek-v4-flash"), "deepseek");
    assert.equal(completionFamily("glm-5"), "unknown");
  });
});

describe("autocomplete — buildCompletionPrompt", () => {
  it("wraps prefix/suffix in FIM tokens for qwen", () => {
    const p = buildCompletionPrompt("function add(", "{\n}", "qwen3.5-plus");
    assert.equal(p.messages[1].content, "<|fim_prefix|>function add(<|fim_suffix|>{\n}<|fim_middle|>");
    assert.deepEqual(p.extra, { enable_thinking: false });
    assert.equal(p.messages[0].content, COMPLETION_SYSTEM_PROMPT);
  });

  it("forces thinking off only for the qwen family", () => {
    const deepseek = buildCompletionPrompt("a", "b", "deepseek-v4-flash");
    assert.deepEqual(deepseek.extra, {});
    const unknown = buildCompletionPrompt("a", "b", "glm-5");
    assert.deepEqual(unknown.extra, {});
  });
});

describe("autocomplete — buildCompletionWindow", () => {
  const doc = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");

  it("bounded prefix lines and short suffix", () => {
    const w = buildCompletionWindow(doc, doc.length, { prefixLines: 5 });
    const lines = w.prefix.split("\n").length;
    assert.ok(lines <= 6, `prefix spans at most 5 lines + partial, got ${lines}`);
    assert.equal(w.suffix, "");
  });

  it("cuts the suffix at the next line boundary", () => {
    const text = "abc\nrest of line\nmore";
    const w = buildCompletionWindow(text, 2);
    assert.equal(w.prefix, "ab");
    assert.equal(w.suffix, "c\n");
  });

  it("empty suffix beyond EOF", () => {
    const w = buildCompletionWindow("abc", 3);
    assert.equal(w.prefix, "abc");
    assert.equal(w.suffix, "");
  });

  it("defaults match the constants", () => {
    const w = buildCompletionWindow("x\ny", 2, {});
    assert.equal(w.prefix, "x\n");
    assert.equal(w.suffix, "y");
    void DEFAULT_PREFIX_LINES;
    void DEFAULT_SUFFIX_CHARS;
  });

  it("honors custom prefix/suffix window options", () => {
    const doc = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const w = buildCompletionWindow(doc, doc.length, { prefixLines: 2, suffixChars: 0 });
    assert.equal(w.prefix.split("\n").length, 2, "exactly prefixLines lines, including the cursor line");
    assert.equal(w.suffix, "");
  });

  it("zero suffix chars disables the suffix entirely", () => {
    const w = buildCompletionWindow("abc\nrest", 1, { suffixChars: 0 });
    assert.equal(w.prefix, "a");
    assert.equal(w.suffix, "");
  });
});

describe("autocomplete — engine parsing", () => {
  it("parseSseData extracts complete payloads and skips [DONE]", () => {
    assert.deepEqual(parseSseData('data: {"a":1}'), { a: 1 });
    assert.equal(parseSseData("data: [DONE]"), undefined);
    assert.equal(parseSseData("data: {broken"), undefined);
    assert.equal(parseSseData("event: foo"), undefined);
  });

  it("extractChatCompletionText reads content and reasoning deltas", () => {
    assert.equal(extractChatCompletionText({ choices: [{ delta: { content: "hi" } }] }).content, "hi");
    assert.equal(extractChatCompletionText({ choices: [{ delta: { reasoning_content: "think" } }] }).reasoning, "think");
    assert.equal(extractChatCompletionText({}).content, "");
    assert.equal(extractChatCompletionText({ choices: [] }).content, "");
  });

  it("cleanCompletion strips fences and surrounding whitespace", () => {
    assert.equal(cleanCompletion("```ts\nconst x = 1;\n```"), "const x = 1;");
    // leading spaces are stripped, the leading newline is kept
    assert.equal(cleanCompletion("  \nconst y = 2;\n  "), "\nconst y = 2;");
  });

  it("cleanCompletion strips leading spaces/tabs but keeps leading newlines", () => {
    // A completion continuing on a new (nested) line must keep its line break.
    assert.equal(cleanCompletion("  return true;"), "return true;");
    assert.equal(cleanCompletion("\n    return inner;\n  }"), "\n    return inner;\n  }");
  });
});

describe("autocomplete — Debouncer", () => {
  it("honors a custom delay", async () => {
    const d = new Debouncer(120);
    let runs = 0;
    d.debounce(() => {
      runs += 1;
    });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(runs, 0, "should not run before the custom delay elapses");
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(runs, 1);
    d.dispose();
  });

  it("debounces and only runs after the delay", async () => {
    const d = new Debouncer(50);
    let runs = 0;
    const sig = d.debounce(() => {
      runs += 1;
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(runs, 1);
    assert.equal(sig.aborted, false);
    d.dispose();
  });

  it("latest call cancels the previous one", async () => {
    const d = new Debouncer(50);
    let runs = 0;
    const first = d.debounce(() => {
      runs += 1;
    });
    const second = d.debounce(() => {
      runs += 1;
    });
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(runs, 1, "only the latest debounced run executes");
    assert.equal(first.aborted, true, "superseded run is aborted");
    assert.equal(second.aborted, false);
    d.dispose();
  });

  it("delayMs is mutable so config changes apply live", async () => {
    const d = new Debouncer(120);
    let runs = 0;
    d.debounce(() => {
      runs += 1;
    });
    d.delayMs = 20;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(runs, 1, "run fires on the updated (shorter) window");
    d.dispose();
  });
});
