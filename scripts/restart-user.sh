#!/usr/bin/env bash
# Restart the installed launcher as the desktop user, detached from this terminal.
set -euo pipefail
[[ $EUID -ne 0 ]] || { echo 'Run this as the TV desktop user, without sudo.' >&2; exit 1; }
export DISPLAY="${DISPLAY:-:0}"
binary=/opt/sofa-launcher/sofa-launcher
pattern='^/opt/sofa-launcher/sofa-launcher$'
"$binary" --quit
for attempt in {1..50}; do
  pgrep -u "$(id -u)" -f "$pattern" >/dev/null || break
  sleep .2
done
if pgrep -u "$(id -u)" -f "$pattern" >/dev/null; then
  echo 'Sofa is still closing; restart stopped safely.' >&2
  exit 1
fi
log_dir="${XDG_STATE_HOME:-$HOME/.local/state}/sofa-launcher"
mkdir -p -- "$log_dir"
chmod 700 -- "$log_dir"
# A new session survives a terminal closing after installation; nohup alone can
# still leave the process in the terminal session which KDE cleans up on exit.
umask 077
setsid -f "$binary" >"$log_dir/launcher.log" 2>&1 </dev/null
for attempt in {1..50}; do
  if pgrep -u "$(id -u)" -f "$pattern" >/dev/null; then
    sleep 2
    if pgrep -u "$(id -u)" -f "$pattern" >/dev/null; then
      echo 'Sofa Launcher is running independently of this terminal.'
      exit 0
    fi
  fi
  sleep .2
done
echo "Sofa did not stay running. Check $log_dir/launcher.log" >&2
exit 1
