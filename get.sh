#!/bin/sh
# One command that leaves you with a working behalf, whatever you start from.
#
#   curl -fsSL https://raw.githubusercontent.com/GKihlstadius/behalf-chrome-agent/main/get.sh | sh
#
# It needs Node 22 or newer. If you do not have it, this fetches an official
# Node build into ~/.behalf/node and uses it from there. Nothing is installed
# system wide, nothing needs sudo, and removing ~/.behalf removes all of it.
set -eu

REPO="https://github.com/GKihlstadius/behalf-chrome-agent"
DEST="${BEHALF_DIR:-$HOME/.behalf}"
NODE_VER="v22.20.0"

say  () { printf '%s\n' "$*"; }
dead () { printf '\n%s\n' "$*" >&2; exit 1; }

say "behalf"
say ""

# --- 1. a good enough node -------------------------------------------------
node_ok () {
  command -v "$1" >/dev/null 2>&1 || return 1
  v=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "${v:-0}" -ge 22 ] 2>/dev/null
}

NODE=""
if node_ok node; then
  NODE="$(command -v node)"
  say "  node        $("$NODE" -v), already here"
elif node_ok "$DEST/node/bin/node"; then
  NODE="$DEST/node/bin/node"
  say "  node        $("$NODE" -v), from a previous run"
else
  case "$(uname -s)" in
    Darwin) OS=darwin ;;
    Linux)  OS=linux ;;
    *)      dead "This installer covers macOS and Linux. On Windows, install Node 22+ and run: node install.mjs" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64)  ARCH=x64 ;;
    *)             dead "Unknown architecture $(uname -m). Install Node 22+ yourself, then rerun." ;;
  esac
  TAR="node-$NODE_VER-$OS-$ARCH.tar.gz"
  say "  node        missing, fetching $NODE_VER into $DEST/node"
  say "              (nothing system wide, no sudo, delete $DEST to undo)"
  mkdir -p "$DEST/node"
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/$TAR" -o "$tmp/node.tar.gz" \
    || dead "Could not download Node. Check your connection, or install Node 22+ yourself."
  tar -xzf "$tmp/node.tar.gz" -C "$tmp"
  cp -R "$tmp/node-$NODE_VER-$OS-$ARCH/." "$DEST/node/"
  rm -rf "$tmp"
  NODE="$DEST/node/bin/node"
  node_ok "$NODE" || dead "The downloaded Node does not run on this machine."
  say "              $("$NODE" -v) ready"
fi

# --- 2. chrome --------------------------------------------------------------
CHROME_FOUND=no
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /usr/bin/google-chrome /usr/bin/google-chrome-stable /opt/google/chrome/chrome \
  /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium
do
  [ -x "$c" ] && { CHROME_FOUND=yes; say "  chrome      found"; break; }
done
if [ "$CHROME_FOUND" = no ]; then
  say "  chrome      NOT FOUND"
  say "              Install Google Chrome, or set BEHALF_CHROME to the binary."
  say "              https://www.google.com/chrome/"
fi

# --- 3. the tool ------------------------------------------------------------
say "  source      fetching"
SRC=$(mktemp -d)
if command -v git >/dev/null 2>&1; then
  git clone -q --depth 1 "$REPO" "$SRC/behalf" || dead "Could not clone $REPO"
else
  curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" -o "$SRC/behalf.tar.gz" \
    || dead "Could not download the source. Install git, or download the zip from $REPO"
  mkdir -p "$SRC/behalf"
  tar -xzf "$SRC/behalf.tar.gz" -C "$SRC/behalf" --strip-components=1
fi

say ""
"$NODE" "$SRC/behalf/install.mjs"
rm -rf "$SRC"

# The launcher prefers node from PATH and falls back to the one it was installed
# with, so a downloaded Node keeps working without touching your shell profile.
say ""
say "Try it:"
say "  behalf start 90"
say "  behalf open example.com"
say "  behalf read"
say "  behalf stop"
