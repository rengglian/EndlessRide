#!/usr/bin/env bash
# Stop Hook: Verifies that project is in a clean, valid state before allowing agent completion.
# Must read stdin and return `{"decision": "allow"}` or `{"decision": "continue", "reason": "..."}`.

set -euo pipefail

if [ -t 0 ]; then
  PAYLOAD="{}"
else
  PAYLOAD=$(cat 2>/dev/null || echo "{}")
fi

ERRORS=""

# Check worker thread safety
if [ -f ".agents/scripts/check-worker-bundles.sh" ]; then
  if ! bash .agents/scripts/check-worker-bundles.sh >/dev/null 2>&1; then
    ERRORS="Worker thread safety check failed. Please check worker scripts for illegal DOM/window references."
  fi
fi

# Check TypeScript build if tsconfig exists
if [ -f "tsconfig.json" ] && [ -d "node_modules" ]; then
  if ! npx tsc --noEmit >/dev/null 2>&1; then
    ERRORS="${ERRORS} TypeScript compilation errors detected. Please run tsc and resolve type issues."
  fi
fi

if [ -n "$ERRORS" ]; then
  # Instruct the agent to continue and fix the issues
  cat <<EOF
{
  "decision": "continue",
  "reason": "$ERRORS"
}
EOF
else
  # Allow stop
  echo '{"decision": "allow"}'
fi

exit 0
