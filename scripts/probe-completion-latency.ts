#!/usr/bin/env node
// Latency probe for the inline-completion engine decision (issue #49).
//
// Measures time-to-first-token and total latency for tiny chat-completions
// requests with thinking OFF, per candidate model family, plus whether the
// gateway tolerates a `suffix` field (FIM emulation).
//
// Usage:
//   OPENCODE_KEY=sk-... tsx scripts/probe-completion-latency.ts [--stream]
//
// The key is read from the environment only and never printed or logged.

import { spawnSync } from "node:child_process";

const KEY = process.env.OPENCODE_KEY;
const URL = "https://opencode.ai/zen/go/v1/chat/completions";
const MAX_TOKENS = 32;

if (!KEY) {
  console.error("OPENCODE_KEY is required");
  process.exit(1);
}

interface ProbeConfig {
  label: string;
  body: Record<string, unknown>;
}

const SYSTEM = "Return only the missing code. No explanations.";
const PREFIX = "function add(a, b) {\n  // sum two numbers\n  return ";
const SUFFIX = ";\n}";

const probes: ProbeConfig[] = [
  {
    label: "deepseek-v4-flash (thinking off, no reasoning_effort)",
    body: {
      model: "deepseek-v4-flash",
      stream: true,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `<|fim_prefix|>${PREFIX}<|fim_suffix|>${SUFFIX}<|fim_middle|>` },
      ],
    },
  },
  {
    label: "qwen3.5-plus (enable_thinking=false)",
    body: {
      model: "qwen3.5-plus",
      stream: true,
      max_tokens: MAX_TOKENS,
      enable_thinking: false,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `<|fim_prefix|>${PREFIX}<|fim_suffix|>${SUFFIX}<|fim_middle|>` },
      ],
    },
  },
  {
    label: "qwen3.5-plus + suffix field (gateway tolerance)",
    body: {
      model: "qwen3.5-plus",
      stream: true,
      max_tokens: MAX_TOKENS,
      enable_thinking: false,
      prompt: PREFIX,
      suffix: SUFFIX,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: PREFIX },
      ],
    },
  },
];

function probe(config: ProbeConfig): void {
  const started = Date.now();
  let status: number | null = null;
  let error = "";

  try {
    const res = spawnSync(
      "node",
      [
        "-e",
        `
        const KEY = process.env.OPENCODE_KEY;
        const body = JSON.parse(process.env.PROBE_BODY);
        const started = Number(process.env.PROBE_STARTED);
        fetch("${URL}", {
          method: "POST",
          headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (r) => {
          process.stdout.write("HTTP " + r.status + "\\n");
          if (!r.ok) {
            process.stdout.write((await r.text()).slice(0, 300) + "\\n");
            return;
          }
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let first = true;
          let reasoning = 0, text = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const events = buf.split("\\n\\n");
            buf = events.pop() ?? "";
            for (const ev of events) {
              for (const line of ev.split("\\n")) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                  const json = JSON.parse(payload);
                  const delta = json.choices?.[0]?.delta;
                  const rc = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
                  const tc = typeof delta?.content === "string" ? delta.content : "";
                  if (rc) reasoning += rc.length;
                  if (tc) text += tc.length;
                  if ((rc || tc) && first) {
                    process.stdout.write("TTFB " + (Date.now() - started) + "ms\\n");
                    first = false;
                  }
                } catch { /* partial line */ }
              }
            }
          }
          process.stdout.write("TOTAL " + (Date.now() - started) + "ms reasoningChars=" + reasoning + " textChars=" + text + "\\n");
        }).catch((e) => {
          process.stdout.write("ERROR " + String(e) + "\\n");
        });
        `,
      ],
      {
        env: {
          ...process.env,
          OPENCODE_KEY: KEY,
          PROBE_BODY: JSON.stringify(config.body),
          PROBE_STARTED: String(started),
        },
        encoding: "utf8",
      },
    );
    status = res.status;
    if (res.status !== 0) {
      error = res.stderr;
    }
    process.stdout.write(res.stdout);
  } catch (e) {
    error = String(e);
  }
  const statusText = status === null ? "n/a" : String(status);
  console.log(`\n[${config.label}] status=${statusText}${error ? " error=" + error : ""}`);
}

for (const p of probes) {
  probe(p);
}
