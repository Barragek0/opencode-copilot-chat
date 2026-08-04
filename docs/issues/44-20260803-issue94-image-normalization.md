**Status:** Implemented on `fix/open-issues-87-92-94`

# Image Attachment Normalization (#94)

OpenCode Go rejected some image attachments even though the same model and
image worked in the OpenCode CLI. The extension sent the original bytes as an
OpenAI `image_url` data URI, while the CLI normalizes images before sending.

The request path now normalizes image data URLs with the same practical limits
used by OpenCode: a maximum `2000x2000` image size and a `5 MB` base64 payload.
It tries PNG first, then JPEG quality levels. If decoding or the optional
normalizer fails, the original data URI is preserved and the final base64 guard
decides whether it is still safe to send.

Top-level images are normalized before the final `5 MB` base64 guard, so an
image larger than the old `2 MB` raw-byte threshold can still be sent when it
can be reduced successfully. The separate `1 MB` raw-byte guard for tool
results remains in place to bound cumulative MCP screenshot history.
