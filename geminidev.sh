#!/bin/bash
# Local dev launcher for gemini-cli
# Usage: geminidev [args...]
GEMINI_CLI_ROOT="/home/abhidaas/Core/Workspace/GeminiCLI/ClaudeOnboarding/gemini-cli"
NODE_OPTIONS="--max-old-space-size=8192" exec node "$GEMINI_CLI_ROOT/packages/cli/dist/index.js" "$@"
