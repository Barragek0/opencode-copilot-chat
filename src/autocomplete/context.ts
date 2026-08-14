/**
 * Build the completion context (prefix/suffix windows) from a document and
 * cursor position.
 *
 * The window bounds keep request payloads tiny (autocomplete must be fast):
 * a bounded number of lines before the cursor and a short suffix after it.
 * Pure and unit-tested.
 */

import { DEFAULT_INLINE_PREFIX_LINES, DEFAULT_INLINE_SUFFIX_CHARS } from "../config";

export {
  DEFAULT_INLINE_PREFIX_LINES as DEFAULT_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS as DEFAULT_SUFFIX_CHARS,
  DEFAULT_INLINE_MAX_TOKENS as DEFAULT_MAX_TOKENS,
} from "../config";

/**
 * VS Code exposes the Copilot Chat prompt box as a virtual editor document
 * with one of these schemes (see `chatInputSchemes` in the VS Code source:
 * `workbench/contrib/chat/common/constants.ts`). Inline-completion providers
 * registered on `"**"` are asked for suggestions there too — ghost text must
 * never appear while the user is typing a prompt.
 */
export const CHAT_INPUT_SCHEMES = new Set(["chatSessionInput", "sessions-chat"]);

/** Whether a document is a chat/interactive prompt box (no completions there). */
export function isChatInputDocument(uri: { scheme: string }): boolean {
  return CHAT_INPUT_SCHEMES.has(uri.scheme);
}

/**
 * Document schemes that are real editable code surfaces. Inline completions
 * are only offered there. An ALLOWLIST (instead of only blocking known chat
 * schemes) means any new interactive surface VS Code introduces in the
 * future — chat prompt variants, webviews, output, custom editors — is
 * excluded automatically without a manual update; genuinely new CODE
 * surfaces are rare.
 */
export const CODE_EDITOR_SCHEMES = new Set(["file", "untitled", "git", "vscode-userdata", "vscode-notebook-cell"]);

/** Whether a document is a normal editable code surface. */
export function isCompletionDocument(uri: { scheme: string }): boolean {
  return CODE_EDITOR_SCHEMES.has(uri.scheme);
}

export interface CompletionWindowOptions {
  prefixLines?: number;
  suffixChars?: number;
}

export interface CompletionWindow {
  prefix: string;
  suffix: string;
}

export function buildCompletionWindow(text: string, offset: number, options: CompletionWindowOptions = {}): CompletionWindow {
  const prefixLines = options.prefixLines ?? DEFAULT_INLINE_PREFIX_LINES;
  const suffixChars = options.suffixChars ?? DEFAULT_INLINE_SUFFIX_CHARS;

  const prefixStart = Math.max(0, offset - 1);
  const beforeCursor = text.slice(0, prefixStart + 1);
  const afterCursor = text.slice(offset);

  // Prefix: bounded line count. Start at the beginning of the (prefixLines)
  // line before the cursor so multi-line context is retained.
  let lineStart = 0;
  let linesSeen = 0;
  for (let i = beforeCursor.length - 1; i >= 0; i--) {
    if (beforeCursor[i] === "\n") {
      linesSeen += 1;
      if (linesSeen >= prefixLines) {
        lineStart = i + 1;
        break;
      }
    }
  }
  const prefix = beforeCursor.slice(lineStart);

  // Suffix: bounded characters after the cursor, cut at a line boundary when
  // possible so the model isn't asked to continue a half-typed line twice.
  let suffix = afterCursor.slice(0, suffixChars);
  const newlineIdx = suffix.indexOf("\n");
  if (newlineIdx >= 0) {
    suffix = suffix.slice(0, newlineIdx + 1);
  }

  return { prefix, suffix };
}
