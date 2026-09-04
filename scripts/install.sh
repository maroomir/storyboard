#!/usr/bin/env bash
# Installs the Storyboard CLI from a GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh | bash
#
# The tarball holds a bundled Node script, not a native binary, so it is platform independent and
# needs Node 20 or newer on the machine.
set -euo pipefail

REPO="${STORYBOARD_REPO:-maroomir/storyboard}"
VERSION="${STORYBOARD_VERSION:-latest}"
PREFIX="${STORYBOARD_PREFIX:-$HOME/.local}"
LIB_DIR="$PREFIX/share/storyboard"
BIN_DIR="$PREFIX/bin"

fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required but was not found on PATH."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 20 ] || fail "Node.js 20+ is required (found $(node -v))."
command -v curl >/dev/null 2>&1 || fail "curl is required."

if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).tag_name;if(!t){process.exit(1)}process.stdout.write(t)})')" \
    || fail "Could not resolve the latest release."
fi

VERSION="${VERSION#v}"
ARCHIVE="storyboard-cli-${VERSION}.tar.gz"
BASE="https://github.com/$REPO/releases/download/v${VERSION}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

printf 'Downloading storyboard %s\n' "$VERSION"
curl -fsSL "$BASE/$ARCHIVE" -o "$WORK/$ARCHIVE" || fail "Download failed: $BASE/$ARCHIVE"

# The checksum file covers every asset; verifying is not optional when we pipe a script to a shell.
if curl -fsSL "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS"; then
  expected="$(grep " $ARCHIVE\$" "$WORK/SHA256SUMS" | awk '{print $1}')"
  [ -n "$expected" ] || fail "No checksum entry for $ARCHIVE."
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$WORK/$ARCHIVE" | awk '{print $1}')"
  else
    actual="$(sha256sum "$WORK/$ARCHIVE" | awk '{print $1}')"
  fi
  [ "$expected" = "$actual" ] || fail "Checksum mismatch for $ARCHIVE."
else
  fail "Could not download SHA256SUMS."
fi

rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR" "$BIN_DIR"
tar -xzf "$WORK/$ARCHIVE" -C "$LIB_DIR"
ln -sf "$LIB_DIR/dist/index.mjs" "$BIN_DIR/storyboard"
chmod +x "$LIB_DIR/dist/index.mjs"

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
