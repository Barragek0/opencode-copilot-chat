**Status:** ✅ Solved

# Blank Code Boxes During Subagent Runs — Force Think-Tag Stripping

**Topic:** streaming / think-tags / subagents / tool-calls
**Updated:** 2026-08-21
**Tags:** #streaming #think-tags #subagents #tool-calls
**Related:** PR [#164](https://github.com/ltmoerdani/opencode-copilot-chat/pull/164) · `src/transports/thinkTags.ts` · `src/core/transport.ts`

---

## Symptom

While a subagent (or any tool-calling invocation) was running, the chat UI flooded with **blank code boxes**. The cause: `<think>` tags embedded in streamed content were rendered as literal markdown code fences by the chat UI instead of being filtered out.

## Root Cause

Think-tag stripping was opt-in per model family (only models known to emit think tags had the filter applied). Subagent/tool-call requests (`options.tools.length > 0`) can route the same conversation through code paths where the filter was not enabled, so raw `<think>` content leaked through.

## Fix

Force think-tag stripping whenever **tools are present in the request** (`options.tools.length > 0`). The trigger is tool-call detection, not model-specific. `ThinkTagFilter` remains a no-op for models that don't emit think tags, so this is safe for all models.

### Files changed

| File                               | Change                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| `src/core/transport.ts`            | Propagate force-strip flag through the transport contract  |
| `src/provider/OpenCodeProvider.ts` | Pass `forceStripThinkTags` when `options.tools.length > 0` |
| `src/transports/thinkTags.ts`      | Accept force flag; strip unconditionally when set          |
| `src/transports/*.ts`              | Thread the flag through all four transports                |

## Verification

- Contributor live-tested with **MiMo v2.5**; blank code boxes no longer appear during subagent runs.
- `npm run lint` / `npm test` green at merge (merge commit `7bf4223`, 2026-08-18).
