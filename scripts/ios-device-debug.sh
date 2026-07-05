#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
WORKSPACE="Temis.xcworkspace"
SCHEME="Temis"
DERIVED_DATA_PATH="$IOS_DIR/build"

if [[ ! -d "$IOS_DIR/$WORKSPACE" ]]; then
  echo "Workspace not found: $IOS_DIR/$WORKSPACE" >&2
  exit 1
fi

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
  echo "No connected physical iPhone detected. Connect device and trust this Mac." >&2
  exit 1
fi

if [[ "${1:-}" == "--detect-device" ]]; then
  echo "$DEVICE_ID"
  exit 0
fi

echo "Using device: $DEVICE_ID"
echo "Building Debug app..."

pushd "$IOS_DIR" >/dev/null
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  build
popd >/dev/null

APP_PATH="$IOS_DIR/build/Build/Products/Debug-iphoneos/Temis.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Built app not found: $APP_PATH" >&2
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
if [[ -z "${BUNDLE_ID:-}" ]]; then
  echo "Failed to read bundle identifier from built app." >&2
  exit 1
fi

echo "Installing app: $APP_PATH"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"

echo "Launching app: $BUNDLE_ID"
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"

echo "Done."
