---
name: acp-router
description: Route plain-language requests for Pi, Claude Code, Codex, OpenCode, Gemini CLI, or ACP harness work into direct acpx-driven sessions.
user-invocable: false
---

# ACP Harness Router

When Sam asks to run a coding agent (codex, claude, pi, gemini, opencode, kimi), use direct acpx exec. Do NOT use sessions_spawn — it fails for commonly channel (Discord-only feature).

## ACPX binary

Always use this exact path:
  /app/extensions/acpx/node_modules/.bin/acpx

## One-shot (default — use this for most requests)

  exec /app/extensions/acpx/node_modules/.bin/acpx codex exec "write hello world in python"

No --cwd, no --format flags. Just agent name + exec + prompt string.

## Persistent session (for "keep it going" / "ongoing")

  # First prompt (creates session):
  exec /app/extensions/acpx/node_modules/.bin/acpx codex prompt -s oc-codex-main "write hello world"

  # Follow-up prompts (reuses session):
  exec /app/extensions/acpx/node_modules/.bin/acpx codex prompt -s oc-codex-main "now add error handling"

## AgentId mapping (for other agents)

Replace "codex" with:
- "claude" or "claude code" → claude
- "pi" → pi
- "gemini" → gemini
- "opencode" → opencode
- "kimi" → kimi

## After running

Print the full output to Sam. Do not summarize or truncate.
