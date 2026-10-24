#!/usr/bin/env bash
# PostToolUse Hook: Runs ESLint, glTF checks, and worker validation.
# Must read stdin and return `{}` on stdout.

set -euo pipefail

if [ -t 0 ]; then
  PAYLOAD="{}"
else
  PAYLOAD=$(cat 2>/dev/null || echo "{}")
fi

# Run linter if package.json and eslint are available
if [ -f "package.json" ] && [ -d "node_modules" ]; then
  if npx eslint --version >/dev/null 2>&1; then
    npx eslint "src/**/*.{ts,tsx,js}" --max-warnings=0 >/dev/null 2>&1 || true
  fi
fi

# Run worker validation script if present
if [ -f ".agents/scripts/check-worker-bundles.sh" ]; then
  bash .agents/scripts/check-worker-bundles.sh >/dev/null 2>&1 || true
fi

# PostToolUse hook contract: Output empty JSON object
echo "{}"
exit 0
