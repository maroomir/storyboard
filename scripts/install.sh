#!/usr/bin/env bash
# Installs the Storyboard CLI from a GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/webfic/storyboard/main/install.sh | bash
#
# Or, with the release tarball already on disk (a private repository, an offline machine):
#
#   ./install.sh --from ~/Downloads
#
# The directory must hold storyboard-cli-<version>.tar.gz; a SHA256SUMS next to it is verified
# when present.
#
# The tarball holds a bundled Node script, not a native binary, so it is platform independent and
# needs Node 20 or newer on the machine.
set -euo pipefail

REPO="${STORYBOARD_REPO:-webfic/storyboard}"
VERSION="${STORYBOARD_VERSION:-latest}"
PREFIX="${STORYBOARD_PREFIX:-$HOME/.local}"
CLI_LIB_DIR="$PREFIX/share/storyboard"
BIN_DIR="$PREFIX/bin"

fail() { printf 'error: %s\n' "$1" >&2; exit 1; }
usage() {
  printf 'usage: install.sh [--from <dir>]\n  --from <dir>  install from the release tarball in <dir> instead of downloading\n'
}

SOURCE_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) [ $# -ge 2 ] || fail "--from needs a directory."; SOURCE_DIR="$2"; shift 2 ;;
    --from=*) SOURCE_DIR="${1#--from=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "Unknown argument: $1" ;;
  esac
done

command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required but was not found on PATH."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 20 ] || fail "Node.js 20+ is required (found $(node -v))."

if [ -n "$SOURCE_DIR" ]; then
  [ -d "$SOURCE_DIR" ] || fail "Not a directory: $SOURCE_DIR"
  SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
  if [ "$VERSION" = "latest" ]; then
    # Without a pinned version the directory must hold exactly one CLI tarball to name it.
    found=""
    for f in "$SOURCE_DIR"/storyboard-cli-*.tar.gz; do
      [ -f "$f" ] || continue
      [ -z "$found" ] || fail "Several storyboard-cli-*.tar.gz in $SOURCE_DIR; pick one with STORYBOARD_VERSION=<version>."
      found="$f"
    done
    [ -n "$found" ] || fail "No storyboard-cli-<version>.tar.gz in $SOURCE_DIR."
    VERSION="$(basename "$found" .tar.gz)"
    VERSION="${VERSION#storyboard-cli-}"
  fi
else
  command -v curl >/dev/null 2>&1 || fail "curl is required."
  if [ "$VERSION" = "latest" ]; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).tag_name;if(!t){process.exit(1)}process.stdout.write(t)})')" \
      || fail "Could not resolve the latest release."
  fi
fi

VERSION="${VERSION#v}"
CLI_ARCHIVE="storyboard-cli-${VERSION}.tar.gz"
BASE="https://github.com/$REPO/releases/download/v${VERSION}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The checksum file covers every asset; verifying is not optional when we pipe a script to a shell.
# A local tarball was put there by the user, so a missing SHA256SUMS only downgrades to a warning.
HAS_CHECKSUMS=1
if [ -n "$SOURCE_DIR" ]; then
  if [ -f "$SOURCE_DIR/SHA256SUMS" ]; then
    cp "$SOURCE_DIR/SHA256SUMS" "$WORK/SHA256SUMS"
  else
    HAS_CHECKSUMS=0
    printf 'warning: no SHA256SUMS in %s; skipping checksum verification.\n' "$SOURCE_DIR" >&2
  fi
else
  curl -fsSL "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS" || fail "Could not download SHA256SUMS."
fi

acquire_verified() {
  local archive="$1" expected actual
  if [ -n "$SOURCE_DIR" ]; then
    [ -f "$SOURCE_DIR/$archive" ] || fail "Missing $SOURCE_DIR/$archive"
    cp "$SOURCE_DIR/$archive" "$WORK/$archive"
  else
    curl -fsSL "$BASE/$archive" -o "$WORK/$archive" || fail "Download failed: $BASE/$archive"
  fi
  [ "$HAS_CHECKSUMS" -eq 1 ] || return 0
  expected="$(grep " $archive\$" "$WORK/SHA256SUMS" | awk '{print $1}')"
  [ -n "$expected" ] || fail "No checksum entry for $archive."
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$WORK/$archive" | awk '{print $1}')"
  else
    actual="$(sha256sum "$WORK/$archive" | awk '{print $1}')"
  fi
  [ "$expected" = "$actual" ] || fail "Checksum mismatch for $archive."
}

if [ -n "$SOURCE_DIR" ]; then
  printf 'Installing storyboard %s from %s\n' "$VERSION" "$SOURCE_DIR"
else
  printf 'Downloading storyboard %s\n' "$VERSION"
fi
acquire_verified "$CLI_ARCHIVE"

mkdir -p "$BIN_DIR"

rm -rf "$CLI_LIB_DIR"
mkdir -p "$CLI_LIB_DIR"
tar -xzf "$WORK/$CLI_ARCHIVE" -C "$CLI_LIB_DIR"
chmod +x "$CLI_LIB_DIR/dist/index.mjs"
ln -sf "$CLI_LIB_DIR/dist/index.mjs" "$BIN_DIR/storyboard"

printf 'Installed storyboard %s to %s\n' "$VERSION" "$BIN_DIR/storyboard"

# Tab completion: one line in the shell's rc file, guarded by a marker so a reinstall never adds
# a second copy. Only the shell that is running the install is touched.
MARKER="# storyboard completion"
register_completion() {
  local rc="$1" line="$2"
  if [ -f "$rc" ] && grep -qF "$MARKER" "$rc"; then
    return
  fi
  mkdir -p "$(dirname "$rc")"
  printf '\n%s\n%s\n' "$MARKER" "$line" >> "$rc"
  printf 'Registered tab completion in %s\n' "$rc"
}
case "$(basename "${SHELL:-}")" in
  zsh) register_completion "${ZDOTDIR:-$HOME}/.zshrc" 'eval "$(storyboard completion zsh)"' ;;
  bash) register_completion "$HOME/.bashrc" 'eval "$(storyboard completion bash)"' ;;
  fish) register_completion "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/storyboard.fish" 'storyboard completion fish | source' ;;
  *) printf 'Tab completion: run  storyboard completion <zsh|bash|fish>  and follow the comment at the top.\n' ;;
esac
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add it to your PATH:\n  export PATH="%s:$PATH"\n' "$BIN_DIR" ;;
esac
