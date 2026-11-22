#!/usr/bin/env bash
# Manual end-to-end check of the remote's Back and Home in every app, on a real desktop with the
# running Sofa and its signed-in apps (not for CI). It presses what the Flirc sends, through a
# virtual keyboard (remote.py, uinput), so the whole path is tested: Sofa's shortcuts, its key for
# each app, the browser extension, the app. Only Back and Home are pressed: no OK or arrows, so
# nothing is chosen or played. Hands off the keyboard and mouse while it runs.
#
#   tests/e2e-remote/run.sh                        # every app below
#   APPS="netflix youtube" tests/e2e-remote/run.sh
#   HOME_KEY=home tests/e2e-remote/run.sh          # a machine whose [buttons] home is the Home key
#
# Needs: X11 tools (xdotool, ImageMagick import), python3-evdev, and write access to /dev/uinput
# (the input group). Screenshots and summary.txt go to $OUT (default: a new folder in /tmp).
set -u
here=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$(mktemp -d /tmp/sofa-e2e-remote.XXXXXX)}
APPS=${APPS:-"netflix prime youtube audible fountain tidal jellyfin homeassistant nodie"}
HOME_KEY=${HOME_KEY:-home-remote}
# The trial copy (run from source) logs to a file; an installed Sofa logs to the user journal.
TRIAL_LOG=~/.local/state/sofa-launcher/trial.log
SOFA=${SOFA:-$(command -v sofa-launcher-trial || command -v sofa-launcher)}
since() { if [ -f "$TRIAL_LOG" ]; then wc -l < "$TRIAL_LOG"; else date '+%Y-%m-%d %H:%M:%S'; fi; }
log_after() { if [ -f "$TRIAL_LOG" ]; then tail -n +$(($1 + 1)) "$TRIAL_LOG"; else journalctl --user --since "$1" -o cat --no-pager; fi; }
remote() { python3 -I "$here/remote.py" "$1"; }
active() { local w; w=$(xdotool getactivewindow 2>/dev/null) || { echo "(not an X11 window)"; return; }; xdotool getwindowname "$w" 2>/dev/null || echo "?"; }
at_home() { [ "$(active)" = "Sofa Launcher" ]; }
shot() { local w; w=$(xdotool getactivewindow 2>/dev/null) && import -window "$w" "$OUT/$1.png" 2>/dev/null; }
open_app() {
  "$SOFA" open "$1" >/dev/null 2>&1
  for _ in $(seq 1 40); do sleep 0.5; at_home || { sleep 5; return 0; }; done
  return 1
}
"$SOFA" >/dev/null 2>&1; sleep 2   # Sofa's Home in front to start
summary="$OUT/summary.txt"; : > "$summary"
for app in $APPS; do
  mark=$(since)
  if ! open_app "$app"; then echo "$app | did not come to the front (an app shown inside Sofa, such as a camera, is not covered)" >> "$summary"; continue; fi
  shot "$app-0-open"; opened=$(active)
  result="still in the app after 4 Backs"
  for n in 1 2 3 4; do
    remote back; sleep 3; shot "$app-$n-back"
    if at_home; then result="Sofa Home after $n Back(s)"; break; fi
  done
  if at_home; then open_app "$app" || true; fi
  remote "$HOME_KEY"; sleep 2.5
  if at_home; then home="Home → Sofa Home"; else home="Home → still '$(active | cut -c1-30)'"; fi
  sent=$(log_after "$mark" | grep '^Back:' | sed 's/, window [0-9]*//' | sort | uniq -c | sed 's/^ *//' | paste -sd ';')
  echo "$app | opened '$(cut -c1-30 <<<"$opened")' | $result | $home | log: $sent" >> "$summary"
done
cat "$summary"
echo "Screenshots: $OUT"
