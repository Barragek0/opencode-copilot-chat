/**
 * Build the completion context (prefix/suffix windows) from a document and
 * cursor position.
 *
 * The window bounds keep request payloads tiny (autocomplete must be fast):
 * a bounded number of lines before the cursor and a short suffix after it.
 * Pure and unit-tested.
 */

export const DEFAULT_PREFIX_LINES = 10;
export const DEFAULT_SUFFIX_CHARS = 300;
export const DEFAULT_MAX_TOKENS = 128;

export interface CompletionWindowOptions {
  prefixLines?: number;
  suffixChars?: number;
}

export interface CompletionWindow {
  prefix: string;
  suffix: string;
}

export function buildCompletionWindow(text: string, offset: number, options: CompletionWindowOptions = {}): CompletionWindow {
  const prefixLines = options.prefixLines ?? DEFAULT_PREFIX_LINES;
  const suffixChars = options.suffixChars ?? DEFAULT_SUFFIX_CHARS;

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
