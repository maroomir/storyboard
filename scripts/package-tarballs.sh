#!/usr/bin/env bash
# Packages the bot and CLI release tarballs from already-built dist/ directories.
#
#   scripts/package-tarballs.sh <version> [out-dir]     (out-dir defaults to ./release)
#
# Each tarball carries the bundle under dist/ and, at its root, the runtime manifest the build
# wrote to dist/package.json (only the bundle's externals as dependencies), so `npm install` in the
# unpacked directory resolves. The source package.json is never shipped.
set -euo pipefail

version="${1:?usage: package-tarballs.sh <version> [out-dir]}"
out_dir="${2:-release}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

stage_app() {
  local app_dir="$1" stage="$2"
  shift 2
  [ -f "$app_dir/dist/package.json" ] || fail "$app_dir/dist/package.json is missing — build the app first."
  cp -R "$app_dir/dist" "$stage/dist"
  mv "$stage/dist/package.json" "$stage/package.json"
  for extra in "$@"; do
    cp -R "$app_dir/$extra" "$stage/$extra"
  done
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out_dir"

mkdir -p "$work/bot"
stage_app "$repo_root/apps/bot" "$work/bot" README.md config.example.json assets
tar -czf "$out_dir/storyboard-bot-${version}.tar.gz" -C "$work/bot" .

mkdir -p "$work/cli"
stage_app "$repo_root/apps/cli" "$work/cli"
tar -czf "$out_dir/storyboard-cli-${version}.tar.gz" -C "$work/cli" .

printf 'Packaged storyboard-bot-%s.tar.gz and storyboard-cli-%s.tar.gz into %s\n' "$version" "$version" "$out_dir"
