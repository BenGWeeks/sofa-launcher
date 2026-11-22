#!/usr/bin/env python3
"""A virtual keyboard (uinput) that presses what the remote's Flirc receiver sends, so the desktop and
Sofa see a real keyboard: back = Ctrl+Alt+Shift+K, home-remote = Ctrl+Alt+Shift+H, home = the Home
key (for a machine whose [buttons] home is set to it). Usage: remote.py back|home|home-remote"""
import sys, time
from evdev import UInput, ecodes as e
chords = {'back': [e.KEY_LEFTCTRL, e.KEY_LEFTALT, e.KEY_LEFTSHIFT, e.KEY_K], 'home': [e.KEY_HOME],
          'home-remote': [e.KEY_LEFTCTRL, e.KEY_LEFTALT, e.KEY_LEFTSHIFT, e.KEY_H]}
keys = chords[sys.argv[1]]
with UInput({e.EV_KEY: sorted({k for c in chords.values() for k in c})}, name='sofa-test-remote') as ui:
    time.sleep(0.6)  # let the desktop pick up the new keyboard
    for k in keys: ui.write(e.EV_KEY, k, 1); ui.syn(); time.sleep(0.02)
    time.sleep(0.12)  # a button held briefly, like the remote
    for k in reversed(keys): ui.write(e.EV_KEY, k, 0); ui.syn(); time.sleep(0.02)
    time.sleep(0.3)
