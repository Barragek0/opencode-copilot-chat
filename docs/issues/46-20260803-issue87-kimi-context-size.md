**Status:** ✅ Solved — merged via [PR #102](https://github.com/ltmoerdani/opencode-copilot-chat/pull/102) (commit `e43c01b`). Shipped in 0.5.0.

# Kimi Context Size Picker (#87)

The model configuration schema now exposes `256K` and the full context window
for Kimi models whose resolved metadata advertises more than `256K` (for
example, Kimi K3). The `256K` choice is the default/cheaper tier. Explicit
context tiers from `models.dev` still take precedence, and fixed-size Kimi
models do not receive a redundant selector.
