#!/usr/bin/env bash
set -euo pipefail

detect_device_id() {
  xcrun xctrace list devices \
    | sed -n '/^== Devices ==$/,/^== Devices Offline ==$/p' \
    | grep -Ev 'MacBook|Simulator' \
    | grep -Eo '\([0-9A-F-]{10,}\)$' \
    | head -n 1 \
    | tr -d '()'
}

DEVICE_ID="${DEVICE_ID:-$(detect_device_id)}"
if [[ -z "${DEVICE_ID:-}" ]]; then
  echo "No connected physical iPhone detected." >&2
  exit 1
fi

if [[ "${1:-}" == "--detect-device" ]]; then
  echo "$DEVICE_ID"
  exit 0
fi

echo "Streaming logs from device: $DEVICE_ID"
xcrun devicectl device log stream --device "$DEVICE_ID"
