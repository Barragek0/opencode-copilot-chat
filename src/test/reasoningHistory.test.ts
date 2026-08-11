import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldEchoThinkingHistory, thinkingTextFromValue } from "../reasoningHistory";

void test("thinkingTextFromValue — passes plain strings through", () => {
  assert.equal(thinkingTextFromValue("hello"), "hello");
});

void test("thinkingTextFromValue — joins string chunk arrays", () => {
  assert.equal(thinkingTextFromValue(["think ", "step", " 1"]), "think \nstep\n 1");
});

void test("thinkingTextFromValue — drops non-string chunks", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(thinkingTextFromValue(["a", 42 as any, "b"]), "a\nb");
});

void test("thinkingTextFromValue — empty inputs", () => {
  assert.equal(thinkingTextFromValue(""), "");
  assert.equal(thinkingTextFromValue([]), "");
});

void test("shouldEchoThinkingHistory — undefined model id is never echoed", () => {
  assert.equal(shouldEchoThinkingHistory(undefined), false);
});

void test("shouldEchoThinkingHistory — OpenAI-compatible reasoning families require the echo", () => {
  assert.equal(shouldEchoThinkingHistory("deepseek-v4-flash"), true);
  assert.equal(shouldEchoThinkingHistory("deepseek-v4-pro"), true);
  assert.equal(shouldEchoThinkingHistory("kimi-k2.6"), true);
  assert.equal(shouldEchoThinkingHistory("glm-5.2"), true);
  assert.equal(shouldEchoThinkingHistory("qwen3.6-plus"), true);
  assert.equal(shouldEchoThinkingHistory("minimax-m2.7"), true);
});

void test("shouldEchoThinkingHistory — Gemini needs the echo for thought parts", () => {
  assert.equal(shouldEchoThinkingHistory("gemini-3.5-pro"), true);
});

void test("shouldEchoThinkingHistory — families that reject or ignore the field", () => {
  assert.equal(shouldEchoThinkingHistory("mimo-v2.5"), false);
  assert.equal(shouldEchoThinkingHistory("gpt-5.6"), false);
  assert.equal(shouldEchoThinkingHistory("claude-sonnet-4.6"), false);
});

void test("shouldEchoThinkingHistory — unknown families are left untouched", () => {
  assert.equal(shouldEchoThinkingHistory("some-future-model"), false);
});
