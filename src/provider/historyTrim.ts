import type * as vscode from "vscode";
import type { ApiMessage } from "../request/types";
import { estimatePromptTokenCount } from "../tokenEstimate";

/**
 * Trim the oldest conversation messages so the request payload fits the model's
 * input context window.
 *
 * Long multi-turn conversations (or many repeated turns without running Compact
 * Conversation) can grow past the model's context limit. The upstream then
 * rejects the oversized request (HTTP 400) or returns an empty stream, which
 * VS Code surfaces as "No response came". This bounds the text history the same
 * way image trimming bounds image weight.
 *
 * CONTRACT:
 *   - Never drops the first message (system/anchor context) or the last message
 *     (the current prompt turn).
 *   - Never splits a tool-call group: an assistant message carrying `tool_calls`
 *     and its following `tool` results are kept together, so trimming stops
 *     before the first tool group rather than orphaning a tool reference.
 *   - Mutates the input array in place (safe: the caller does not reuse it).
 *   - Returns the number of messages removed (for diagnostics).
 *
 * @param messages ApiMessage[] (chronological, oldest first). Mutated in place.
 * @param budgetTokens Maximum input tokens the trimmed history may occupy.
 * @param tools Tools passed to the request (included in the size estimate).
 * @returns Number of messages removed.
 */
export function trimOldMessagesToFitContext(
  messages: ApiMessage[],
  budgetTokens: number,
  tools?: readonly vscode.LanguageModelChatTool[],
): number {
  const lastIndex = messages.length - 1;
  // Need at least the anchor (index 0) and the current prompt (last index).
  if (lastIndex < 2) {
    return 0;
  }
  if (estimatePromptTokenCount(messages, tools) <= budgetTokens) {
    return 0;
  }

  // Map each tool_call id to the index of its owning assistant message so we can
  // detect when a candidate drop would orphan a tool reference.
  const toolCallOwner = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const toolCalls = messages[i].tool_calls;
    if (messages[i].role === "assistant" && Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        toolCallOwner.set(tc.id, i);
      }
    }
  }

  let dropEnd = 0;
  for (let i = 1; i < lastIndex; i++) {
    const message = messages[i];
    let isToolGroupMessage = message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (!isToolGroupMessage && message.role === "tool" && message.tool_call_id !== undefined) {
      const owner = toolCallOwner.get(message.tool_call_id);
      // A tool result whose parent assistant is at index >= 1 is part of a tool
      // group we might otherwise trim into — treat it as a group boundary.
      isToolGroupMessage = owner !== undefined && owner >= 1;
    }
    if (isToolGroupMessage) {
      // Stop before the first tool group — dropping it would orphan a tool
      // reference and 400 the request.
      break;
    }
    const remaining = [messages[0], ...messages.slice(i + 1)];
    if (estimatePromptTokenCount(remaining, tools) <= budgetTokens) {
      dropEnd = i;
      break;
    }
    dropEnd = i;
  }

  if (dropEnd >= 1) {
    messages.splice(1, dropEnd);
    return dropEnd;
  }
  return 0;
}
