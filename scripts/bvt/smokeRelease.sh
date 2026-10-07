#!/usr/bin/env bash
# Local form of the release smoke: packages the VSIX, the CLI tarball and install.sh into a scratch
# directory exactly as the release workflow does, then installs and runs them (scripts/bvt/smoke.sh).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="$(node -p "require('$repo_root/package.json').version")"
out_dir="$(mktemp -d)"
trap 'rm -rf "$out_dir"' EXIT

"$repo_root/scripts/package-release.sh" "$version" "$out_dir"
(cd "$out_dir" && shasum -a 256 storyboard-* install.sh > SHA256SUMS)
"$repo_root/scripts/bvt/smoke.sh" "$out_dir" "$version"
