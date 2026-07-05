#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

resolve_node_binary() {
  if [[ -n "${NODE_BINARY:-}" && -x "${NODE_BINARY}" ]]; then
    printf '%s\n' "${NODE_BINARY}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local detected=""
  detected="$(
    /bin/bash -lc '
      set -euo pipefail
      if [[ -f "'"$ROOT_DIR"'/ios/.xcode.env" ]]; then
        source "'"$ROOT_DIR"'/ios/.xcode.env"
      fi
      if [[ -f "'"$ROOT_DIR"'/ios/.xcode.env.local" ]]; then
        source "'"$ROOT_DIR"'/ios/.xcode.env.local"
      fi
      printf "%s" "${NODE_BINARY:-}"
    ' 2>/dev/null || true
  )"
  if [[ -n "${detected}" && -x "${detected}" ]]; then
    printf '%s\n' "${detected}"
    return 0
  fi

  return 1
}

NODE_CMD="$(resolve_node_binary || true)"
if [[ -z "${NODE_CMD}" ]]; then
  echo "Node binary not found. Install Node or set NODE_BINARY before running Cloud Sync preflight." >&2
  exit 1
fi

WEMEMO_ROOT_DIR="${ROOT_DIR}" \
  exec "${NODE_CMD}" \
    --experimental-strip-types \
    --experimental-specifier-resolution=node \
    "${ROOT_DIR}/scripts/cloud-sync-preflight.ts" \
    "$@"
