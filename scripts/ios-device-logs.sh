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

BUNDLE_ID="${BUNDLE_ID:-com.anonymous.WeMemo}"

if [[ "${1:-}" == "--detect-device" ]]; then
  echo "$DEVICE_ID"
  exit 0
fi

echo "Launching $BUNDLE_ID on device: $DEVICE_ID"
echo "The current app instance will be restarted and its console will stream below."
xcrun devicectl device process launch \
  --device "$DEVICE_ID" \
  --terminate-existing \
  --console \
  "$BUNDLE_ID"
