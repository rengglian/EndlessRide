#!/usr/bin/env bash
# Web Worker Bundle & Thread Safety Check
# Verifies that worker scripts do not import DOM/window primitives or non-transferable global state.

set -euo pipefail

SEARCH_DIR="${1:-src}"

if [ ! -d "$SEARCH_DIR" ]; then
  exit 0
fi

echo "Checking worker scripts in $SEARCH_DIR for thread safety..."

# Search for forbidden window/document/DOM references in worker code
FORBIDDEN_REFS="window\.|document\.|HTMLCanvasElement|WebGLRenderer|requestAnimationFrame"

FOUND_ISSUES=0

while IFS= read -r worker_file; do
  [ -z "$worker_file" ] && continue
  if grep -E "$FORBIDDEN_REFS" "$worker_file" >/dev/null 2>&1; then
    echo "ERROR: Forbidden DOM/main-thread reference found in worker: $worker_file"
    grep -nE "$FORBIDDEN_REFS" "$worker_file" || true
    FOUND_ISSUES=1
  fi
done < <(find "$SEARCH_DIR" -type f \( -name "*.worker.ts" -o -name "*.worker.js" \) 2>/dev/null || true)

if [ "$FOUND_ISSUES" -ne 0 ]; then
  echo "Worker thread safety validation failed."
  exit 1
fi

echo "All worker scripts verified thread-safe."
exit 0
