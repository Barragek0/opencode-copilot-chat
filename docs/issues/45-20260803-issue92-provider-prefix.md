**Status:** Implemented on `fix/open-issues-87-92-94`

# Optional Provider Prefixes (#92)

Model names in the picker now respect the `opencodego.showProviderPrefix`
setting. It defaults to `true`, preserving names such as
`OpenCode Go / DeepSeek V4 Flash`; setting it to `false` displays only the
formatted model name. Changing the setting refreshes Go, Zen, and agent-host
model registrations without requiring a reload.
