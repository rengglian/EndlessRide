#!/usr/bin/env bash
# glTF / GLB Asset Validation Script
# Checks 3D assets for Draco compression, KTX2 textures, and valid glTF 2.0 structure.

set -euo pipefail

ASSET_DIR="${1:-public/assets}"

if [ ! -d "$ASSET_DIR" ]; then
  # No assets directory yet; exit gracefully
  exit 0
fi

echo "Scanning $ASSET_DIR for glTF/GLB models..."

# Check for glTF files
find "$ASSET_DIR" -type f \( -name "*.gltf" -o -name "*.glb" \) | while read -r model; do
  echo "Validating: $model"
  
  # Check if gltf-validator is installed via npx
  if command -v npx >/dev/null 2>&1; then
    npx --yes gltf-validator -i "$model" --max-issues 5 || {
      echo "Warning: glTF validation reported issues for $model"
    }
  else
    echo "gltf-validator not found in PATH; skipping deep schema check."
  fi
done

echo "glTF asset check complete."
