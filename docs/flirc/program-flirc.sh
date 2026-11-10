#!/usr/bin/env bash
# Program a Flirc for sofa-launcher (see docs/keymap.md).
# Run on a development PC with the Flirc plugged in and the Flirc app CLOSED:
#
#   bash docs/flirc/program-flirc.sh
#
# For each line it tells you which SofaBaton U1 button to press, then waits
# for that button. Point the U1 at the Flirc (it must be on the Flirc/MCE
# device in the SofaBaton app). Press Ctrl+C at any time to stop. Run it
# again with a start number to resume, e.g.  bash program-flirc.sh 12
set -euo pipefail

cd "$(dirname "$0")"
OUT=flirc-sofa-launcher.fcfg
START=${1:-1}
MODS=7 # HID modifier bits: Left Ctrl (1) + Left Shift (2) + Left Alt (4)

# button | how | value | what it does
# how: "key" = flirc_util record <name>; "api" = flirc_util record_api <mods> <hid>
BUTTONS=(
  "HOME (house)|api|$MODS 11|Ctrl+Alt+Shift+H: open launcher"
  "POWER (red, top left)|api|$MODS 19|Ctrl+Alt+Shift+P: power menu"
  "RED|api|$MODS 21|Ctrl+Alt+Shift+R: camera on/off"
  "GREEN|api|$MODS 10|Ctrl+Alt+Shift+G: next camera"
  "YELLOW|api|$MODS 28|Ctrl+Alt+Shift+Y: move camera"
  "BLUE|api|$MODS 5|Ctrl+Alt+Shift+B: spare"
  "RECORD (round dot)|api|$MODS 17|Ctrl+Alt+Shift+N: Nod.ie talk"
  "INFO (i)|api|$MODS 12|Ctrl+Alt+Shift+I: remote guide"
  "MENU (three lines)|api|$MODS 16|Ctrl+Alt+Shift+M: quick menu"
  "INPUT (arrow into box, top right)|api|$MODS 22|Ctrl+Alt+Shift+S: spare"
  "E (next to 9)|api|$MODS 8|Ctrl+Alt+Shift+E: spare"
  "UP (top of the ring)|key|up|Up"
  "DOWN (bottom of the ring)|key|down|Down"
  "LEFT (left of the ring)|key|left|Left"
  "RIGHT (right of the ring)|key|right|Right"
  "OK (centre)|key|return|Enter"
  "BACK (curved arrow)|api|$MODS 14|Ctrl+Alt+Shift+K: Back (launcher translates per app)"
  "CHANNEL UP (^ top right of ring)|key|pageup|Page Up"
  "CHANNEL DOWN (v right of ring)|key|pagedown|Page Down"
  "VOLUME UP|key|vol_up|Volume up"
  "VOLUME DOWN|key|vol_down|Volume down"
  "MUTE (speaker with line)|key|mute|Mute"
  "PLAY|key|play/pause|Play/Pause"
  "PAUSE|key|play/pause|Play/Pause"
  "STOP (square)|key|stop|Stop"
  "FAST FORWARD|key|fast_forward|Fast forward"
  "REWIND|key|rewind|Rewind"
  "1|api|0 30|1"
  "2|api|0 31|2"
  "3|api|0 32|3"
  "4|api|0 33|4"
  "5|api|0 34|5"
  "6|api|0 35|6"
  "7|api|0 36|7"
  "8|api|0 37|8"
  "9|api|0 38|9"
  "0|api|0 39|0"
  "- (bottom left)|api|0 45|Minus"
)

command -v flirc_util >/dev/null || { echo "flirc_util not found: install the Flirc app first."; exit 1; }
if pgrep -x Flirc >/dev/null; then echo "Please close the Flirc app first (it holds the device)."; exit 1; fi
flirc_util version | sed -n '2p'

if [[ $START -eq 1 ]]; then
  echo
  echo "This first ERASES the buttons stored on the Flirc."
  echo "(Back up your current Flirc configuration with the Flirc app first if you may want it back.)"
  read -r -p "Erase and start? [y/N] " yn
  [[ $yn == [yY]* ]] || { echo "Stopped; nothing changed."; exit 0; }
  flirc_util format
fi

total=${#BUTTONS[@]}
skipped=(); clashed=()
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

flirc_util saveconfig "${OUT%.fcfg}" >/dev/null  # flirc_util appends .fcfg itself
echo
echo "Done. Saved the configuration to docs/flirc/$OUT"
echo "Next: plug the Flirc into the TV PC. Check the buttons with:  xev -event keyboard"
echo
[[ ${#skipped[@]} -gt 0 ]] && echo "No signal from (give them codes in the SofaBaton app): ${skipped[*]}"
[[ ${#clashed[@]} -gt 0 ]] && echo "Shared codes (fix in the SofaBaton app, then run fix-buttons.sh): ${clashed[*]}"
exit 0
