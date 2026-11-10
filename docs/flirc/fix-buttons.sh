#!/usr/bin/env bash
# Re-record only the U1 buttons that clashed on the first run (2026-11-08):
# Home and OK sent the same IR code, CH up/down sent the same codes as
# Up/Down, and Record/E sent nothing. Fix those buttons in the SofaBaton app
# first (give each its own code), then run this with the Flirc app CLOSED:
#
#   bash docs/flirc/fix-buttons.sh
#
# It deletes the stored Home (Ctrl+Alt+Shift+H), Nod.ie talk
# (Ctrl+Alt+Shift+N, on Record), Up and Down entries, then records them again
# together with OK, CH up/down, Record and E. "-" is left as it is. If the Flirc reports
# "button already exists", that button still shares a code with another.
set -euo pipefail
cd "$(dirname "$0")"
MODS=7

if pgrep -x Flirc >/dev/null; then echo "Please close the Flirc app first."; exit 1; fi

# Delete matching entries, highest index first so the other indexes don't shift.
indexes=$(flirc_util settings | awk '
  /altH *$|altN *$/ || $NF == "up" || $NF == "down" { print $1 }' | sort -rn)
for i in $indexes; do
  echo "Deleting stored entry $i"
  flirc_util delete_index "$i"
done

BUTTONS=(
  "HOME (house)|api|$MODS 11|Ctrl+Alt+Shift+H"
  "OK (centre)|key|return|Enter"
  "UP (top of the ring)|key|up|Up"
  "DOWN (bottom of the ring)|key|down|Down"
  "CHANNEL UP (^ top right of ring)|key|pageup|Page Up"
  "CHANNEL DOWN (v right of ring)|key|pagedown|Page Down"
  "RECORD (round dot)|api|$MODS 17|Ctrl+Alt+Shift+N: Nod.ie talk"
  "E (next to 9)|api|$MODS 8|Ctrl+Alt+Shift+E"
)
total=${#BUTTONS[@]}
skipped=(); clashed=()
START=1
for ((i = START; i <= total; i++)); do
  IFS='|' read -r label how value desc <<<"${BUTTONS[i-1]}"
  echo
  echo "[$i/$total]  Press  >>> $label <<<   ($desc)   (15 s, or it's skipped)"
  if [[ $how == key ]]; then
    out=$(timeout 15 flirc_util record "$value" 2>&1) || true
  else
    # shellcheck disable=SC2086  # "mods hid" must split into two arguments
    out=$(timeout 15 flirc_util record_api $value 2>&1) || true
  fi
  if grep -q "already exists" <<<"$out"; then
    echo "  ✗ shares a code with another button"; clashed+=("$label")
  elif grep -qi "Succesfully recorded\|Successfully recorded" <<<"$out"; then
    echo "  ✓ recorded"
  else
    echo "  – no signal: skipped"; skipped+=("$label")
  fi
done

flirc_util saveconfig flirc-sofa-launcher >/dev/null # flirc_util adds .fcfg
echo
echo "Saved docs/flirc/flirc-sofa-launcher.fcfg. Any 'already exists' above means"
echo "that button still shares a code: fix it in the SofaBaton app and rerun."
echo
[[ ${#skipped[@]} -gt 0 ]] && echo "No signal from (give them codes in the SofaBaton app): ${skipped[*]}"
[[ ${#clashed[@]} -gt 0 ]] && echo "Shared codes (fix in the SofaBaton app, then run fix-buttons.sh): ${clashed[*]}"
exit 0
