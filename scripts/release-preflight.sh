#!/usr/bin/env bash
# Everything a release tag would set off, run here before the tag exists — so a tag that fails on
# GitHub is the exception, not the way we find out. Only the upload is left to the workflow.
#
#   npm run release:preflight              on the version commit, before `git tag`
#   npm run release:preflight -- --package also package the desktop app for this platform and smoke it
#
# Steps: the tree is committed and on main; the version is synced and not yet tagged; both
# changelogs carry a dated, non-empty section for it; lint; tests; the BVT (diff contracts, impact
# map, golden workspaces, CLI/VSIX smoke); the built desktop app in smoke mode; and with --package
# the packaged app too. The Windows app can only be smoked on Windows, which the workflow does.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

with_package=0
for arg in "$@"; do
  case "$arg" in
    --package) with_package=1 ;;
    *) echo "usage: release-preflight.sh [--package]" >&2; exit 2 ;;
  esac
done

version="$(node -p "require('./package.json').version")"
tag="v$version"

step() { printf '\n== %s\n' "$1"; }
fail() { printf '\npreflight failed: %s\n' "$1" >&2; exit 1; }

# The same extraction the publish job uses for the release notes.
changelog_section() {
  awk -v ver="$version" '
    $0 == "## [" ver "]" || index($0, "## [" ver "] ") == 1 { inside = 1; next }
    inside && /^## \[/ { exit }
    inside { print }
  ' "$1"
}

step "Working tree"
[ -z "$(git status --porcelain)" ] || fail "작업 트리에 커밋되지 않은 변경이 있습니다. 버전 커밋을 먼저 만드세요."
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || fail "main 이 아니라 $branch 에 있습니다."
echo "clean, on main"

step "Version $version"
node scripts/sync-version.mjs --check
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  fail "태그 $tag 가 이미 있습니다. 루트 package.json 의 버전을 올리고 버전 커밋을 만드세요."
fi
echo "$tag is free"

step "Changelog sections"
for changelog in CHANGELOG.md CHANGELOG.en.md; do
  grep -qE "^## \[$version\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" "$changelog" \
    || fail "$changelog 에 '## [$version] - YYYY-MM-DD' 절이 없습니다."
  [ -n "$(changelog_section "$changelog" | tr -d '[:space:]')" ] \
    || fail "$changelog 의 [$version] 절이 비어 있습니다."
  echo "$changelog: [$version] section present"
done

step "Lint"
npm run lint

step "Test"
npm test

step "Build verification test"
npm run bvt

step "Desktop smoke (built app)"
if [ ! -f node_modules/electron/path.txt ]; then
  echo "Electron binary is not installed; downloading it once."
  node node_modules/electron/install.js
fi
npm run bvt:smoke:desktop

if [ "$with_package" -eq 1 ]; then
  step "Desktop smoke (packaged app)"
  case "$(uname -s)" in
    Darwin)
      CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac --workspace @storyboard/desktop
      scripts/bvt/smokeDesktop.sh mac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      npm run package:win --workspace @storyboard/desktop
      scripts/bvt/smokeDesktop.sh win
      ;;
    *)
      echo "No desktop installer is built for $(uname -s); skipped."
      ;;
  esac
fi

printf '\nPreflight passed for %s. Tag it:\n  git tag %s\n  git push origin main %s\n' "$tag" "$tag" "$tag"
