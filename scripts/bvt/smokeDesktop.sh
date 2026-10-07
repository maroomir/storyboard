#!/usr/bin/env bash
# Starts the desktop app in smoke mode and expects it to render its first screen and exit 0.
#
#   scripts/bvt/smokeDesktop.sh mac     the packaged app under apps/desktop/release (macOS runner)
#   scripts/bvt/smokeDesktop.sh win     the unpacked app under apps/desktop/release (Windows runner)
#   scripts/bvt/smokeDesktop.sh dev     the built but unpackaged app (apps/desktop/dist) through the
#                                       electron package — `npm run build --workspace @storyboard/desktop` first
#
# STORYBOARD_DESKTOP_SMOKE=1 makes main (apps/desktop/src/main/index.ts) exit 0 once the renderer
# has mounted and 1 on a load failure, a crash or the time limit. The home is a scratch directory,
# so the run reads no settings and leaves no recent-work entry behind.
set -euo pipefail

target="${1:?usage: smokeDesktop.sh <mac|win|dev>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
desktop="$repo_root/apps/desktop"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export STORYBOARD_HOME="$scratch/home"
export STORYBOARD_DESKTOP_SMOKE=1
mkdir -p "$STORYBOARD_HOME"

case "$target" in
  mac)
    app="$(ls -d "$desktop"/release/mac*/Storyboard.app 2>/dev/null | head -n 1 || true)"
    [ -n "$app" ] || { echo "No packaged app under apps/desktop/release; run npm run package:mac first." >&2; exit 1; }
    command=("$app/Contents/MacOS/Storyboard")
    ;;
  win)
    exe="$desktop/release/win-unpacked/Storyboard.exe"
    [ -f "$exe" ] || { echo "No $exe; run npm run package:win first." >&2; exit 1; }
    command=("$exe")
    ;;
  dev)
    [ -f "$desktop/dist/main/index.cjs" ] || { echo "No apps/desktop/dist; run npm run build --workspace @storyboard/desktop first." >&2; exit 1; }
    command=(npx --prefix "$repo_root" electron "$desktop/dist")
    ;;
  *)
    echo "usage: smokeDesktop.sh <mac|win|dev>" >&2
    exit 2
    ;;
esac

echo "Smoke: desktop ($target)"
if "${command[@]}"; then
  echo "  ✓ the desktop app rendered its first screen and exited"
else
  code=$?
  echo "  ✗ the desktop app exited $code" >&2
  exit 1
fi
