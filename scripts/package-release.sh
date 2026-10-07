#!/usr/bin/env bash
# Packages what a release ships from this checkout: the VSIX, the CLI tarball and install.sh.
#
#   scripts/package-release.sh <version> [out-dir]     (out-dir defaults to ./release)
#
# The release workflow runs it twice — once in the `bvt` job, whose smoke installs and runs what it
# made, and once in `publish`, which uploads — so both see the same bytes from the same steps. The
# desktop installers are not here: they are built on their own platforms.
set -euo pipefail

version="${1:?usage: package-release.sh <version> [out-dir]}"
out_dir="${2:-release}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

cd "$repo_root"
npm run package:vsix --workspace storyboard-vscode -- --out "$out_dir/storyboard-vscode-${version}.vsix"
npm run build --workspace @storyboard/cli
scripts/package-tarballs.sh "$version" "$out_dir"
cp scripts/install.sh "$out_dir/install.sh"

printf 'Packaged the release %s into %s\n' "$version" "$out_dir"
