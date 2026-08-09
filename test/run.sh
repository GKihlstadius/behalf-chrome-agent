#!/bin/zsh
# Test suite. Installs behalf into a temporary prefix, drives it against a local
# fixture, and cleans up. Touches neither your real install nor your browser
# profile, so it is safe to run while you are working.
#
#   test/run.sh            run everything
#   KEEP=1 test/run.sh     leave the temp prefix in place for inspection
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(dirname "$HERE")"

T=$(mktemp -d)
export BEHALF_DIR="$T/state"
export BEHALF_PROFILE="$T/chrome-profile"
while :; do
  PORT=$(( 20000 + RANDOM % 20000 ))
  lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break
done
B="$T/prefix/behalf"

pass=0; fail=0
ok   () { pass=$((pass+1)); print -r -- "  ok    $1" }
bad  () { fail=$((fail+1)); print -r -- "  FAIL  $1"; [ -n "${2:-}" ] && print -r -- "        got: $2" }
is   () { [ "$2" = "$3" ] && ok "$1" || bad "$1" "$2  (wanted: $3)" }
has  () { case "$2" in (*$3*) ok "$1";; (*) bad "$1" "$2  (wanted to contain: $3)";; esac }

cleanup () {
  "$B" stop --force >/dev/null 2>&1
  [ -n "${SRV:-}" ] && kill $SRV 2>/dev/null
  [ -z "${KEEP:-}" ] && rm -rf "$T" || print -r -- "kept: $T"
}
trap cleanup EXIT INT TERM

print -r -- "behalf test suite"
print -r -- "  prefix   $T"
print -r -- "  fixture  http://127.0.0.1:$PORT"
print

# --- install ---------------------------------------------------------------
mkdir -p "$T/prefix" "$T/src"
cp -R "$PKG"/* "$T/src/" 2>/dev/null
export BEHALF_BIN="$T/prefix"
if sh "$T/src/install.sh" >"$T/install.log" 2>&1; then ok "install.sh exits 0"; else bad "install.sh exits 0" "$(tail -3 "$T/install.log")"; fi
[ -x "$B" ] && ok "command is linked and executable" || bad "command is linked and executable"
has "install runs doctor" "$(cat "$T/install.log")" "Chrome"
has "install reports the platform" "$(cat "$T/install.log")" "macOS"

# --- lease, before any browser --------------------------------------------
is "lease list is empty at first" "$("$B" lease list)" "no active leases"
"$B" lease claim alpha >/dev/null
has "lease claim then list" "$("$B" lease list)" "alpha"
"$B" lease release alpha >/dev/null
is "lease release" "$("$B" lease list)" "no active leases"

# --- errors before start ---------------------------------------------------
out=$("$B" status 2>&1); code=$?
is "status fails when not running" "$code" "1"
has "status says how to start" "$out" "behalf start"
has "doctor works without a browser" "$("$B" doctor)" "Port file"

# --- fixture server --------------------------------------------------------
python3 -m http.server $PORT --directory "$HERE/fixture" >/dev/null 2>&1 &
SRV=$!
up=0
for _ in $(seq 1 20); do
  sleep 0.3
  curl -sf --max-time 2 "http://127.0.0.1:$PORT/index.html" >/dev/null 2>&1 && { up=1; break }
done
[ $up -eq 1 ] && ok "fixture server is up" || { bad "fixture server is up" "port $PORT never answered"; print -r -- "  aborting, the rest of the suite depends on it"; exit 1 }

# --- lifecycle -------------------------------------------------------------
has "start reports loopback only" "$("$B" start)" "127.0.0.1 only"
has "start is idempotent" "$("$B" start)" "Already running"
has "doctor sees the browser" "$("$B" doctor)" "loopback only"
has "port file is 0600" "$(stat -f '%Lp' "$BEHALF_DIR/.port")" "600"

out=$("$B" open "http://127.0.0.1:1/nothing" 3000); code=$?
is "open on a dead host exits 1" "$code" "1"
has "open on a dead host explains why" "$out" "could not open"

has "open reports the landing url" "$("$B" open "http://127.0.0.1:$PORT/index.html" 2500)" "127.0.0.1:$PORT"

# --- reading ---------------------------------------------------------------
r=$("$B" read 400)
has "read sees the page" "$r" "Fixture"
has "read drills into shadow DOM" "$r" "Hidden inside shadow DOM"
has "frames lists the same-origin frame" "$("$B" frames)" "chars of text"
has "tabs lists the fixture" "$("$B" tabs)" "127.0.0.1"

# --- wait ------------------------------------------------------------------
has "wait finds text that appears late" "$("$B" wait 'Receipt 0000000')" "found after"
has "wait --gone sees removal" "$("$B" wait 'Loading please wait' --gone)" "gone after"
out=$("$B" wait 'text that never appears' --timeout 1500); code=$?
is "wait times out with exit 1" "$code" "1"
has "wait says it timed out" "$out" "TIMEOUT"

# --- clicking --------------------------------------------------------------
"$B" click "Save now" >/dev/null
is "DOM click in the top document" "$("$B" eval "document.getElementById('dom').textContent")" "DOM CLICK OK"
"$B" click "Shadow button" >/dev/null
is "click reaches into shadow DOM" "$("$B" eval "document.title")" "SHADOW CLICK OK"

LOG='(() => { for (const f of document.querySelectorAll("iframe")) { const d=f.contentDocument; if (d) return d.getElementById("log").textContent; } })()'
"$B" click "Transfer amount" --frame '*' --mouse >/dev/null
is "real mouse click lands inside an iframe" "$("$B" eval "$LOG")" "FRAME MOUSE OK"
"$B" click "Other action" --frame '*' >/dev/null
is "DOM click lands inside an iframe" "$("$B" eval "$LOG")" "FRAME DOM OK"

# Regression: Chrome drops synthetic mouse input into an unfocused page after a
# navigation. Two navigations then a mouse click is the shape that exposed it.
"$B" open "http://127.0.0.1:$PORT/index.html" 2000 >/dev/null
"$B" open "http://127.0.0.1:$PORT/index.html" 2000 >/dev/null
"$B" click "Save now" --mouse >/dev/null
is "mouse click still works after repeated navigation" "$("$B" eval "document.getElementById('dom').textContent")" "DOM CLICK OK"
"$B" click "Transfer amount" --frame '*' --mouse >/dev/null
is "mouse click into a frame after repeated navigation" "$("$B" eval "$LOG")" "FRAME MOUSE OK"

out=$("$B" click "no such button"); code=$?
is "click on a missing element exits 1" "$code" "1"
has "click on a missing element says so" "$out" "not found"

# --- forms -----------------------------------------------------------------
has "fields lists inputs in a frame" "$("$B" fields --frame '*')" "amount"
"$B" fill amount 4200 --frame '*' >/dev/null
is "fill sets the value" "$("$B" eval "document.querySelector('iframe').contentDocument.querySelector('[name=amount]').value")" "4200"
"$B" fill note "line one" --frame '*' >/dev/null
is "fill works on a textarea" "$("$B" eval "document.querySelector('iframe').contentDocument.querySelector('[name=note]').value")" "line one"
out=$("$B" fill nosuchfield x --frame '*'); code=$?
is "fill on a missing field exits 1" "$code" "1"
has "fill suggests --frame" "$out" "frame"

# --- upload ----------------------------------------------------------------
print "x" > "$T/report.se"
( cd "$T" && "$B" upload ledger report.se --frame '*' >/dev/null )
is "upload attaches a relative path" "$("$B" eval "document.querySelector('iframe').contentDocument.querySelector('[type=file]').files[0].name")" "report.se"

# --- capture ---------------------------------------------------------------
"$B" shot "$T/shot.png" >/dev/null
[ -s "$T/shot.png" ] && ok "shot writes a png" || bad "shot writes a png"
"$B" pdf "$T/out.pdf" >/dev/null
[ -s "$T/out.pdf" ] && ok "pdf writes a file" || bad "pdf writes a file"

# A screenshot of a signed-in page is as sensitive as the session. It must not
# land in a world readable directory, and it must not be world readable itself.
utfil=$("$B" shot)
case "$utfil" in (/tmp/*) bad "shot defaults outside /tmp" "$utfil";; (*) ok "shot defaults outside /tmp";; esac
is "shot output is 0600" "$(stat -f '%Lp' "$utfil")" "600"
is "port file is not world readable" "$(stat -f '%Lp' "$BEHALF_DIR/.port")" "600"

# A lease name becomes a filename
out=$("$B" lease claim "../escape"); code=$?
is "lease rejects path traversal" "$code" "0"
[ -f "$BEHALF_DIR/../escape" ] && bad "lease cannot write outside its directory" || ok "lease cannot write outside its directory"
"$B" lease release escape >/dev/null 2>&1

# --- lease protects a shared browser ---------------------------------------
"$B" lease claim other >/dev/null
out=$("$B" stop); code=$?
is "stop refuses while another session holds a lease" "$code" "1"
has "stop names the other session" "$out" "other"
has "stop --force overrides" "$("$B" stop --force)" "Chrome closed"

# --- after stop ------------------------------------------------------------
"$B" status >/dev/null 2>&1
is "status fails again after stop" "$?" "1"
[ -f "$BEHALF_DIR/.port" ] && bad "stop removes the port file" || ok "stop removes the port file"

# --- the safety timer ------------------------------------------------------
# The promise is that a forgotten port closes itself. Worth testing, since it is
# the difference between a tool and an open door.
has "start schedules the shutdown" "$("$B" start 0.05)" "Closes automatically"
[ -f "$BEHALF_DIR/.autostop" ] && ok "autostop watcher is recorded" || bad "autostop watcher is recorded"
sleep 9
[ -f "$BEHALF_DIR/.port" ] && bad "the port closes itself when time runs out" "port file still there" \
                           || ok "the port closes itself when time runs out"
"$B" status >/dev/null 2>&1
is "nothing answers after the timer" "$?" "1"

print
print -r -- "  $pass passed, $fail failed"
[ $fail -eq 0 ] || exit 1
