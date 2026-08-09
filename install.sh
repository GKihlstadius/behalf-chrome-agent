#!/bin/sh
# Convenience wrapper. The real installer is install.mjs and works on
# macOS, Linux and Windows alike.
exec node "$(cd "$(dirname "$0")" && pwd)/install.mjs" "$@"
