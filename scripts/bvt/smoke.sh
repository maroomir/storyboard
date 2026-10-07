#!/usr/bin/env bash
# Installs and runs what the release ships, from the packaged files rather than the source tree.
#
#   scripts/bvt/smoke.sh <release-dir> <version>
#
# <release-dir> holds storyboard-cli-<version>.tar.gz, storyboard-vscode-<version>.vsix and
# install.sh (scripts/package-release.sh writes them). The CLI is installed with the real
# install.sh into a scratch prefix and driven through a work with the mock provider; the VSIX is
# opened and its manifest, bundle and changelog checked. Nothing outside the scratch directory is
# touched: the home is a scratch directory and the shell rc files are left alone.
set -euo pipefail

release_dir="${1:?usage: smoke.sh <release-dir> <version>}"
version="${2:?usage: smoke.sh <release-dir> <version>}"
release_dir="$(cd "$release_dir" && pwd)"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export STORYBOARD_HOME="$scratch/home"
export NO_COLOR=1
export TERM=dumb
mkdir -p "$STORYBOARD_HOME"

failures=0
pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1" >&2; failures=$((failures + 1)); }
check() { # check <label> <command...>
  local label="$1"; shift
  if "$@" >"$scratch/check.out" 2>"$scratch/check.err"; then
    pass "$label"
  else
    fail "$label"
    sed 's/^/      /' "$scratch/check.err" >&2
  fi
}
expect_json_ok() { # expect_json_ok <label> <command...>  — stdout must be one JSON object with ok:true
  local label="$1"; shift
  if "$@" >"$scratch/check.out" 2>"$scratch/check.err" \
    && node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (r.ok!==true) process.exit(1)' "$scratch/check.out"; then
    pass "$label"
  else
    fail "$label (stdout was not a JSON result with ok:true)"
    head -c 400 "$scratch/check.out" >&2; echo >&2
    sed 's/^/      /' "$scratch/check.err" >&2
  fi
}

echo "Smoke: CLI tarball"
if [ -f "$release_dir/SHA256SUMS" ]; then
  check "SHA256SUMS verifies every asset" bash -c "cd '$release_dir' && shasum -a 256 -c SHA256SUMS"
fi
# SHELL=/bin/sh keeps install.sh from registering completion in a real rc file.
check "install.sh installs from the tarball" env SHELL=/bin/sh STORYBOARD_PREFIX="$scratch/prefix" bash "$release_dir/install.sh" --from "$release_dir"
cli="$scratch/prefix/bin/storyboard"
if [ -x "$cli" ]; then
  installed="$("$cli" --version)"
  if [ "$installed" = "$version" ]; then pass "storyboard --version prints $version"; else fail "storyboard --version printed '$installed', expected $version"; fi

  work="$scratch/work"
  mkdir -p "$work"
  cd "$work"
  check "init makes a work" "$cli" init --title "연기 시험" --genre 미스터리 --chapters 1 --scenes-per-chapter 1 --yes
  check "setup picks the mock provider without a terminal" "$cli" setup --provider mock
  check "doctor passes on the new work" "$cli" doctor
  expect_json_ok "novel generate runs the whole pipeline" "$cli" novel generate --json
  expect_json_ok "scene list --json" "$cli" scene list --json
  stem="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(r.data.scenes[0]?.stem ?? "")' "$scratch/check.out")"
  if [ -n "$stem" ]; then pass "the pipeline left a scene ($stem)"; else fail "the pipeline left no scene"; fi
  expect_json_ok "draft show --json" "$cli" draft show "$stem" --json
  expect_json_ok "scene create" "$cli" scene create --name "덧붙인 장면" --json
  expect_json_ok "status --json" "$cli" status --json
  check "manuscript export writes a file" "$cli" manuscript export --out "$scratch/manuscript.md"
  check "help prints" "$cli" help --all
  check "completion zsh prints a script" "$cli" completion zsh
  cd "$scratch"
fi

echo "Smoke: VSIX"
vsix="$release_dir/storyboard-vscode-${version}.vsix"
if [ -f "$vsix" ]; then
  mkdir -p "$scratch/vsix"
  check "the VSIX unzips" unzip -q -o "$vsix" -d "$scratch/vsix"
  manifest="$scratch/vsix/extension/package.json"
  for file in extension/package.json extension/out/extension.js extension/out/webview-ui/index.html extension/changelog.md; do
    if [ -f "$scratch/vsix/$file" ]; then pass "carries $file"; else fail "missing $file"; fi
  done
  if [ -f "$manifest" ]; then
    vsix_version="$(node -p "require('$manifest').version")"
    if [ "$vsix_version" = "$version" ]; then pass "manifest version is $version"; else fail "manifest version is $vsix_version, expected $version"; fi
    main_file="$(node -p "require('$manifest').main")"
    if [ -f "$scratch/vsix/extension/$main_file" ]; then pass "manifest main ($main_file) exists"; else fail "manifest main ($main_file) is missing"; fi
    check "the extension bundle parses" node --check "$scratch/vsix/extension/out/extension.js"
  fi
else
  fail "no $vsix"
fi

if [ "$failures" -gt 0 ]; then
  printf '\n%d smoke check(s) failed.\n' "$failures" >&2
  exit 1
fi
printf '\nSmoke passed for %s.\n' "$version"
