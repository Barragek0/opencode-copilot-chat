**Status:** 🟢 Active

# Provider Adapter Architecture — Multi-Vendor / Multi-Model Structure

**Topic:** architecture / provider / streaming / routing / maintainability / refactor
**Updated:** 2026-08-15
**Tags:** #architecture #provider #streaming #routing #refactor #adapter-pattern #strangler-fig #anti-regression
**Supersedes:** —

---

## Overview

This document captures the analysis and internet research performed on 2026-08-09 to answer one question: **what architecture and folder structure should this project use now that it must accommodate an ever-growing number of vendors and AI models, each with its own standards and behavior?**

The project already has god files. This document:

1. Diagnoses the current state with evidence from the codebase.
2. Summarizes research from authoritative sources (VS Code official docs, Vercel AI SDK, Continue, Cline, refactoring.guru, Martin Fowler).
3. Recommends a **Ports & Adapters + data-driven registry** architecture.
4. Proposes a **target folder structure** that stays lean.
5. Defines an **anti-regression contract** for adding new vendors/models.
6. Lays out a **phased Strangler Fig migration plan**.

Status: 🟢 Active — living reference. The proposal has been **implemented** via PR [#155](https://github.com/ltmoerdani/opencode-copilot-chat/pull/155) (merged 2026-08-14, merge commit `a95565f`). This doc now records the plan, what landed, and the remaining future work. The full folder map + registry table live in feature doc [`17-20260814-data-driven-model-registry.md`](../features/17-20260814-data-driven-model-registry.md) and the repo-root `ARCHITECTURE-MAP.md`.

---

## 1. Current State Diagnosis (Evidence from Codebase)

> **Updated 2026-08-15:** this section documents the **pre-#155** state that motivated the refactor. As of PR #155 the god files are split (see "Post-#155 state" at the end of this section). The numbers below are kept for historical reference.

The project was not flat-modular across the board. It had **three god files** that mixed multiple concerns. Every other file (25 files, mostly <300 lines) was already lean and correctly flat-modular.

| File                    | Lines     | Mixed Concerns                                                                                                                                                       |
| ----------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`      | **4,112** | Provider class (~1,083 lines), model-list fetch, constants, status bar, usage webview, tooltip SVG builder, commands, secret key handling, per-model thinking config |
| `src/streaming.ts`      | **1,686** | 4 transport streaming functions + 2 response extractors + think-tag filter + SSE parsing                                                                             |
| `src/goUsageTracker.ts` | **1,069** | Tracker core (~573 lines) + model pricing + SQLite history reader + UI formatting + quickpick builder                                                                |

### Why this is a problem

- **High blast radius**: adding or fixing one model family can touch `streaming.ts`, `routing.ts`, and `extension.ts` at the same time, increasing regression risk (visible across the `docs/issues/` history).
- **Not unit-testable at the seams**: VS Code officially recommends modular design so the deterministic parts (message conversion, chunk parsing, token estimation) can be unit-tested without a live model. God files make this hard.
- **Vendor onboarding friction**: every new transport/behavior becomes a diff inside already-huge files instead of a self-contained addition.

The core problem is **not** "flat vs folders" — it is that these 3 files mix too many domains. The fix must separate domains, not merely reorganize folders.

### Post-#155 state (2026-08-14)

The Strangler Fig split (PR #155) is executed. The god files are gone:

| Pre-#155                      | Post-#155                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` 4,653      | thin entry ~415 lines (activation + command wiring); provider class → `src/provider/OpenCodeProvider.ts`, commands → `src/commands/`                             |
| `src/streaming.ts` 1,620      | `src/transports/` (one file per transport + `engine` / `sse` / `extractors` / `extract` / `streamParts` / `thinkTags`); contract types → `src/core/transport.ts` |
| `src/goUsageTracker.ts` 1,510 | `src/usage/` (`tracker` / `history` / `pricing` / `formatting` / `dashboard` + moved `usage` / `usageProfile` / `goUsageSync`)                                   |

Also landed: `src/thinking/` (per-provider strategy classes), `src/models/` (metadata domain), `src/request/` (per-endpoint body builders), and the data-driven `src/core/registry.ts`. Verified behavior-preserving — 310 unit tests + retry E2E 7/7 + lint green (see issue doc [`67-20260814-pr155-split-god-files-review-merge.md`](../issues/67-20260814-pr155-split-god-files-review-merge.md)).

---

## 2. Research Findings (Authoritative Sources)

### 2.1 VS Code Official Docs — "Extension Anatomy" & "Language Model API"

- The entry file must stay **thin**: `activate`/`deactivate` should only do **wiring** (register commands, push disposables), not contain business logic.
- VS Code explicitly recommends: _"consider designing your extension code in a modular way to enable you to unit test the specific parts that can be tested."_ Because model interaction is nondeterministic, only the **deterministic parts** (message conversion, chunk parsing, token estimation) are testable — so those must be isolated as pure functions, separate from the streaming I/O wrappers.
- Takeaway for us: `extension.ts` should target <300 lines. Provider internals, model-list fetch, status bar, and webview belong in their own domains.

### 2.2 Vercel AI SDK — "Unified Provider Architecture" (most relevant reference)

The AI SDK solves **exactly our problem**: one core API, many providers with different wire formats (OpenAI, Anthropic, Google, etc.).

- **Single contract interface** `LanguageModelV4` with `doGenerate()` / `doStream()`.
- **One package per provider**: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc. Each implements three things:
  1. **Input mapping** — `convertToProviderMessages(prompt)` → provider-specific format.
  2. **Output mapping** — `createTransformer()` → SSE chunks converted to typed stream parts (text, reasoning, tool-call, finish, error).
  3. **Error standardization** — `APICallError`, `TooManyRequestsError` (with `isRetryable`) so client code never depends on which provider is in use.
- **`providerOptions`** — a mechanism for per-provider features without breaking the standard interface. This maps directly to our per-model thinking config (DeepSeek `max`, Qwen `thinking_budget`, MiniMax `on/off`, MiMo `low/med/high`).
- Takeaway for us: our `streaming.ts` already contains 4 transports + extractors, but in one file with shared internal state. The AI SDK pattern is **one adapter file per transport** with a common stream-part contract → `streaming.ts` shrinks from ~1,686 lines to ~4×300 independent, testable files.

### 2.3 Continue (open-source VS Code multi-provider extension) — real-world evidence

Actual structure under `core/llm/`:

```text
core/llm/
  llms/                  ← ONE FILE PER PROVIDER (anthropic.ts, openai.ts, gemini.ts, ...)
  countTokens.ts         ← shared helper
  fetchModels.ts         ← "unified dynamic model fetching for all providers"
  messages.ts            ← message conversion
  streamChat.ts          ← streaming core
  toolSupport.ts         ← tool schema
  openaiTypeConverters.ts
```

Confirms the proven pattern in the VS Code extension ecosystem: **shared helpers at the top level + one file per provider in a subfolder**.

### 2.4 Cline — `src/api/providers/`

Cline uses `src/api/providers/` with one file per provider, all implementing the same `ApiHandler` interface (`streamChat`, `getModels`, etc.). Client code talks to the interface, never to a concrete provider.

### 2.5 Design Patterns — Adapter (refactoring.guru) + Strangler Fig (Martin Fowler)

- **Adapter**: Single Responsibility + Open/Closed — "introduce new types of adapters without breaking existing client code." Exactly right for "add a new vendor without touching working code."
- **Strangler Fig**: do not big-bang rewrite. **Extract gradually per small component**, create _seams_ first, let old and new systems coexist. This is important because `streaming.ts` and `extension.ts` are sensitive areas with a long regression history.

---

## 3. Recommended Architecture: Ports & Adapters + Data-Driven Registry

Core principles (combining all findings, staying lean):

1. **Single contract (Port)** — one `ModelTransport` interface describing "one model call": `stream(request) → stream parts`, plus `buildRequest` and `parseChunk` as **pure functions**.
2. **One Adapter per transport** — chat-completions, responses, anthropic messages, google. Fully independent of each other.
3. **Data-driven registry** — routing is not scattered if-else but **one table**: `modelId → { transport, thinking config, context limit, capabilities }`. Adding a model = adding one row of data, not editing logic.
4. **Thin entry file** — `extension.ts` only does wiring + DI.
5. **Consistent error taxonomy** — all adapters throw errors from the existing `errors.ts` (`OpenCodeRequestError`) uniformly.
6. **Pure functions separated from I/O** — chunk parsers, message conversion, token estimation are pure and unit-testable (per VS Code's recommendation).

```mermaid
flowchart TD
    subgraph "Entry (thin)"
        EXT[extension.ts<br/>activate/deactivate + wiring]
    end

    subgraph "Providers"
        PR[provider class<br/>provideLanguageModelChatInformation]
    end

    subgraph "Core / Domain"
        REG[registry.ts<br/>modelId → transport + config]
        MD[models/ · metadata · limits · thinking]
    end

    subgraph "Transports (adapters)"
        TC[chatCompletions.ts]
        RS[responses.ts]
        AN[anthropic.ts]
        GO[google.ts]
        SSE[sse.ts · shared parser]
    end

    subgraph "Usage / UI"
        US[usage/ · tracker + statusbar + webview]
        CM[commands/ · diagnostics · pickers]
    end

    EXT --> PR
    PR --> REG
    REG --> MD
    REG --> TC & RS & AN & GO
    TC & RS & AN & GO --> SSE
    EXT --> US
    EXT --> CM
    US --> PR
```

---

## 4. Target Folder Structure (Lean — max 2 subfolder depth)

> **Updated 2026-08-15:** this target is **achieved** as of PR #155, with a few name differences vs the original sketch (actual in parentheses). Principle: _"do not move what is healthy."_

```text
src/
  extension.ts                    # wiring only ✓ (~415 lines; target <300 — close)
  core/
    transport.ts                  # contract types (was: ModelTransport interface — types landed; interface still future) ✓
    registry.ts                   # MODEL_REGISTRY — data-driven transport + thinking family ✓
  transports/
    chatCompletions.ts            # OpenAI chat adapter ✓
    responses.ts                  # OpenAI Responses adapter ✓
    anthropic.ts                  # Anthropic messages adapter ✓
    google.ts                     # Gemini adapter ✓
    engine.ts                     # shared HTTP+SSE streaming engine + retry/backoff (added)
    sse.ts                        # pure SSE parser ✓
    extractors.ts / extract.ts    # response extractors (added)
    streamParts.ts                # emit thinking/progress/text → vscode parts ✓
    thinkTags.ts                  # inline <think> tag stripper (added)
  models/
    metadata.ts / metadataFetcher.ts   # live fetch + fallback snapshot ✓
    modelLimits.ts / modelCapabilities.ts / modelNames.ts / pricing.ts   # per-model config ✓
  provider/
    OpenCodeProvider.ts           # provider class (was: inside extension.ts) ✓
    definitions.ts / settings.ts / messages.ts / tokens.ts / visionProxy.ts
  thinking/
    provider.ts + per-family strategies (deepseek/glm/kimi/minimax/openai/qwen/mimo/fallback)  # added
  request/
    openai.ts / anthropic.ts / google.ts / types.ts / schema.ts / shared.ts / headers.ts  # added
  usage/
    tracker.ts                    # core tracker ✓
    history.ts                    # SQLite read ✓
    pricing.ts / formatting.ts    # cost + status bar / tooltip / quickpick ✓
    dashboard.ts                  # usage webview + tooltip SVG (target: webview.ts — still one file) ⚠️
    usage.ts / usageProfile.ts / goUsageSync.ts
  commands/
    diagnostics.ts / thinkingPicker.ts / agentsWindow.ts / providers.ts  ✓
  openCodeAuth.ts               # key resolution + BYOK (stayed at root — fine, <300 lines)
  contextWindowHook.ts          # stayed at root (fine, small)
  errors.ts / retry.ts / tokenEstimate.ts / chatParts.ts / utils.ts / apiKeyResolution.ts  # stayed at root
  toolCallAccumulator.ts / imageNormalizer.ts
```

**Not everything moved** — small flat files (<300 lines) stayed at the root (`openCodeAuth.ts`, `contextWindowHook.ts`, `errors.ts`, `retry.ts`, `utils.ts`, …). That matches the original principle.

## 5. Anti-Regression Contract — Checklist for Adding a New Vendor/Model

After refactoring, this is the SOP so model additions have minimal risk:

1. Add one new transport adapter in `transports/` (implements `ModelTransport`).
2. Add one config row in `core/registry.ts` (`modelId → transport`, thinking config, limits, capabilities).
3. Add metadata in `models/metadata.ts` (live fetch + fallback snapshot — never remove the fallback).
4. Do **not** touch `extension.ts` for any of the above — only wire a new command if one is introduced.
5. Errors use the `errors.ts` taxonomy (`OpenCodeRequestError`), never raw throws.
6. Unit-test the pure parts of the adapter (parse chunk, convert message) without needing a `vscode` runtime.

---

## 6. Migration Strategy (Strangler Fig — recommended)

Extract in phases, lowest risk first, respecting our issue history. Never big-bang.

| Phase | Extraction                                                                                         | Risk         | Rationale                                                             |
| ----- | -------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------- |
| 1     | `goUsageTracker.ts` → `usage/tracker.ts` + `history.ts` + `formatting.ts`                          | Low          | No streaming/routing touch; mechanical refactor only (cut-paste-edit) |
| 2     | `extension.ts` → split status bar + webview + tooltip → `usage/webview.ts` + `usage/formatting.ts` | Low–Med      | UI separated from provider logic                                      |
| 3     | `streaming.ts` → `transports/*` (1 file per transport) + `sse.ts`                                  | **Med–High** | Sensitive area; do per-transport, test 1 model family each step       |
| 4     | `extension.ts` → split model-list fetch & constants → `models/` + `core/registry.ts`               | Med          | Registry becomes data-driven                                          |
| 5     | `extension.ts` → only wiring remains                                                               | Low          | Thin entry achieved                                                   |

Each phase gate: `npm run compile` must pass + a targeted test with at least 1 model family touched by the change.

---

## 7. Conclusion

- The core problem was not "missing folders" — it was that **3 files mixed multiple domains**, causing a large blast radius on every model addition.
- The industry-proven pattern (AI SDK, Continue, Cline) is **one adapter per transport + a single contract interface + a data-driven registry + a thin entry file** — this answers both "simple and lean" and "minimal regression".
- **Executed (2026-08-14, PR #155):** Strangler Fig phase-by-phase from the lowest-risk area (`goUsageTracker.ts` split) upward. All 5 phases landed, behavior-preserving (310 tests + E2E 7/7 + lint green).
- **Remaining future work:** full `ModelTransport` port interface, usage webview HTML → own file (see issue doc 67).

---

## Timeline

| Date       | Status    | Change                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-09 | 🟢 Active | Initial research + analysis document created. Proposal only; no code changed.                                                                                                                                                                                                                                                                                                                    |
| 2026-08-14 | ✅ Done   | God-file split executed on `refactor/split-god-files` (usage/ · transports/ · provider/ · models/ · core/ · commands/); `extension.ts` 4653 → ~414 lines. See CHANGELOG `[Unreleased]`.                                                                                                                                                                                                          |
| 2026-08-14 | ✅ Done   | **Data-driven registry implemented** (`src/core/registry.ts`). `resolveModelRouting()` (transport) and `thinkingFamily()` both read the `MODEL_REGISTRY` table; `ModelEndpointKind` type moved to the registry. Scope note: context limits/capabilities stay metadata-driven (live models.dev) — not duplicated as a static table. The full `ModelTransport` port interface remains future work. |
| 2026-08-14 | ✅ Done   | **PR #155 merged** (merge commit `a95565f`, not squash) — all phases 1–5 landed, contributor history preserved. Independent verification: 310 unit tests + retry E2E 7/7 + lint green; routing/thinking/SSE verified behavior-identical. See issue doc [`67-20260814-pr155-split-god-files-review-merge.md`](../issues/67-20260814-pr155-split-god-files-review-merge.md).                       |
| 2026-08-15 | 🟢 Active | Post-merge: docs updated (this doc, feature doc 17, devlog, issue 131). Remaining future work: full `ModelTransport` port interface; usage webview HTML → own file; Zen API key one-time migration before release.                                                                                                                                                                               |

---

## References

- VS Code — Extension Anatomy: <https://code.visualstudio.com/api/get-started/extension-anatomy>
- VS Code — Language Model API (Testing your extension / modularity): <https://code.visualstudio.com/api/extension-guides/language-model>
- Vercel AI SDK — Unified Provider Architecture: <https://ai-sdk.dev/docs/foundations/providers-and-models>
- Vercel AI SDK — Writing a Custom Provider (Language Model Specification V4): <https://ai-sdk.dev/providers/community-providers/custom-providers>
- Continue — `core/llm/` structure: <https://github.com/continuedev/continue/tree/main/core/llm>
- Cline — `src/api/providers/`: <https://github.com/cline/cline>
- refactoring.guru — Adapter: <https://refactoring.guru/design-patterns/adapter>
- Martin Fowler — Strangler Fig: <https://martinfowler.com/bliki/StranglerFigApplication.html>
