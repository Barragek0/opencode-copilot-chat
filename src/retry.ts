/**
 * Runtime retry with degraded parameters for HTTP 400 errors.
 *
 * When the upstream API rejects a parameter (e.g. thinking.type "disabled",
 * invalid temperature, unsupported reasoning_effort), this module:
 * 1. Parses the error message to identify the problematic parameter
 * 2. Removes or adjusts it in the request body
 * 3. Returns the patched body for a single retry
 *
 * CONTRACT:
 * - Pure functions only — no vscode import, no side effects.
 * - Only handles recoverable 400 errors. Auth (401/403), rate limit (429),
 *   and server errors (5xx) are NOT retried.
 * - At most ONE retry per request to avoid infinite loops.
 */

/** Result of attempting to patch a request body for retry. */
export interface RetryPatch {
  /** The patched request body, or undefined if no patch was possible. */
  body: Record<string, unknown> | undefined;
  /** Human-readable description of what was changed (for logging). */
  reason: string;
}

/**
 * Patterns that indicate a recoverable 400 error caused by an unsupported
 * parameter value. Each pattern has a regex to match the error message and
 * a function to patch the request body.
 *
 * Order matters: more specific patterns should come first.
 */
const RECOVERABLE_ERROR_PATTERNS: Array<{
  pattern: RegExp;
  patch: (body: Record<string, unknown>, match?: RegExpMatchArray) => Record<string, unknown>;
  describe: (match: RegExpMatchArray) => string;
}> = [
  // --- Thinking errors ---
  // "invalid thinking: only type=enabled is allowed for this model"
  {
    pattern: /invalid thinking[:\s]+only type=enabled/i,
    patch: (body) => {
      const next = { ...body };
      if (next.thinking && typeof next.thinking === "object") {
        next.thinking = { ...(next.thinking as Record<string, unknown>), type: "enabled" };
      }
      return next;
    },
    describe: () => "forced thinking.type='enabled'",
  },
  // "invalid thinking: only type=disabled is allowed"
  {
    pattern: /invalid thinking[:\s]+only type=disabled/i,
    patch: (body) => {
      const next = { ...body };
      delete next.thinking;
      return next;
    },
    describe: () => "removed thinking field (model requires disabled)",
  },
  // Generic "invalid thinking" — strip the field entirely
  {
    pattern: /invalid thinking/i,
    patch: (body) => {
      const next = { ...body };
      delete next.thinking;
      return next;
    },
    describe: () => "removed thinking field",
  },

  // --- Thinking tag errors ---
  // "Extra inputs are not permitted, field: 'enable_thinking'"
  {
    pattern: /extra inputs are not permitted.*enable_thinking/i,
    patch: (body) => {
      const next = { ...body };
      delete next.enable_thinking;
      return next;
    },
    describe: () => "removed enable_thinking (not accepted by this model)",
  },

  // --- Temperature errors ---
  // "invalid temperature: only 1 is allowed for this model"
  {
    pattern: /invalid temperature[:\s]+only \d+(\.\d+)? is allowed/i,
    patch: (body) => {
      const next = { ...body };
      delete next.temperature;
      return next;
    },
    describe: () => "removed temperature (model has fixed value)",
  },
  // Generic "invalid temperature"
  {
    pattern: /invalid temperature/i,
    patch: (body) => {
      const next = { ...body };
      delete next.temperature;
      return next;
    },
    describe: () => "removed temperature",
  },

  // --- Reasoning effort errors ---
  // "MiniMax M2 only accepts string reasoning_effort values"
  {
    pattern: /reasoning_effort|reasoning_effort.*(?:string|only accepts|invalid|unsupported)|(?:string|only accepts|invalid|unsupported).*reasoning_effort/i,
    patch: (body) => {
      const next = { ...body };
      delete next.reasoning_effort;
      return next;
    },
    describe: () => "removed reasoning_effort (unsupported value)",
  },
  // "Extra inputs are not permitted, field: 'reasoning_effort'"
  {
    pattern: /extra inputs are not permitted.*reasoning_effort/i,
    patch: (body) => {
      const next = { ...body };
      delete next.reasoning_effort;
      return next;
    },
    describe: () => "removed reasoning_effort (not accepted by this model)",
  },

  // --- Thinking budget errors ---
  {
    pattern: /extra inputs are not permitted.*thinking_budget/i,
    patch: (body) => {
      const next = { ...body };
      delete next.thinking_budget;
      return next;
    },
    describe: () => "removed thinking_budget (not accepted by this model)",
  },
  // budget_tokens — used by Mimo thinking payload to cap reasoning tokens
  {
    pattern: /extra inputs are not permitted.*budget_tokens/i,
    patch: (body) => {
      const next = { ...body };
      delete next.budget_tokens;
      return next;
    },
    describe: () => "removed budget_tokens (not accepted by this model)",
  },

  // --- Generic extra inputs ---
  // "Extra inputs are not permitted, field: '<field>'"
  {
    pattern: /extra inputs are not permitted.*field:\s*'([^']+)'/i,
    patch: (body, match) => {
      const fieldName = match?.[1];
      if (!fieldName) return body;
      const next = { ...body };
      delete next[fieldName];
      return next;
    },
    describe: (match) => `removed field '${match?.[1]}' (not accepted by this model)`,
  },
];

/**
 * Check if an HTTP 400 error is recoverable by patching the request body.
 * Returns a RetryPatch if the error is recoverable, undefined otherwise.
 *
 * @param errorMessage The error message from the API response body
 * @param body The original request body (will not be mutated)
 * @returns RetryPatch if recoverable, undefined otherwise
 */
export function analyzeHttp400ForRetry(
  errorMessage: string,
  body: Record<string, unknown>,
): RetryPatch | undefined {
  for (const { pattern, patch, describe } of RECOVERABLE_ERROR_PATTERNS) {
    const match = errorMessage.match(pattern);
    if (match) {
      const patchedBody = patch(body, match);
      // Verify the patch actually changed something
      if (JSON.stringify(patchedBody) !== JSON.stringify(body)) {
        return {
          body: patchedBody,
          reason: describe(match),
        };
      }
    }
  }
  return undefined;
}
