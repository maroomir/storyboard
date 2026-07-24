#!/usr/bin/env bash
# Installs storygram as a per-user launchd agent so it starts at login and restarts on crash.
# Usage:  ./scripts/install-launchd.sh            (install / reinstall)
#         ./scripts/install-launchd.sh --uninstall
set -euo pipefail

LABEL="com.maroomir.storygram"
PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/storygram"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST"
  echo "uninstalled ${LABEL}"
  exit 0
fi

BOT_ENTRY="${PACKAGE_ROOT}/dist/index.js"
if [[ ! -f "$BOT_ENTRY" ]]; then
  echo "error: ${BOT_ENTRY} not found — run 'npm run bot:build' from the repo root first." >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${BOT_ENTRY}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/storygram.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/storygram.err.log</string>
  <key>WorkingDirectory</key><string>${PACKAGE_ROOT}</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "installed ${LABEL}"
echo "  plist: ${PLIST}"
echo "  logs:  ${LOG_DIR}/storygram.log"
echo "  stop:  launchctl bootout gui/$(id -u)/${LABEL}"
