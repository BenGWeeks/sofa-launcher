# Remote key map: SofaBaton U1 → Flirc → keys

This is what each U1 button must send, so you can program the Flirc. The
launcher's button map (`[buttons]` in `config.toml`), the on-screen remote
guide and the button test all use these same keys.

## Why Ctrl+Alt+Shift+letter for launcher buttons

Launcher buttons need keys that **no app or KDE shortcut uses**. F13–F24 look
ideal but don't work on Linux/X11: xkb renames them (F13 → `XF86Tools`,
F14–F18 → `XF86Launch5–9`, F20 → `XF86AudioMicMute`, F21–F23 → touchpad
toggles; F19 and F24 have no keysym). So launcher buttons use
**Ctrl+Alt+Shift + a letter** instead, which has three advantages:
- Flirc can send it (it supports modifiers).
- Nothing in KDE uses it by default. Checked on a development PC; the TV PC still to check.
- It's easy to remember.

Avoid **Ctrl+Alt+Shift+Del / PgUp / PgDn**: KDE can bind those to log out,
reboot or shut down without confirmation.

## Launcher (global) buttons

These work from anywhere, even inside Netflix.

| U1 button | Flirc sends | Launcher action |
|---|---|---|
| 🏠 Home | Ctrl+Alt+Shift+**H** | Open launcher / go to home screen |
| ⏻ Power | Ctrl+Alt+Shift+**P** | Power menu (close launcher / log off / screen off / cancel) |
| 🔴 Red | Ctrl+Alt+Shift+**R** | Choose two apps for screen-in-screen; stop when active |
| 🟢 Green | Ctrl+Alt+Shift+**G** | Switch remote focus between main and inset apps |
| 🟡 Yellow | Ctrl+Alt+Shift+**Y** | Move inset app to next corner |
| 🔵 Blue | Ctrl+Alt+Shift+**B** | Resize inset app (30%, 40%, 50% width) |
| ● Record | Ctrl+Alt+Shift+**N** | Nod.ie: talk (toggle mic) |
| ⓘ Info | Ctrl+Alt+Shift+**I** | Remote guide for what's on screen now |
| ↩ Back | Ctrl+Alt+Shift+**K** | Back, translated per app (see pass-through table) |
| ☰ Menu | Ctrl+Alt+Shift+**M** | On home: Settings. In an app: slide-up menu (apps, close app, camera, Talk to Nod.ie, remote guide). Menu, Back, or Up from the top row closes it |
| ⇥ Input | Ctrl+Alt+Shift+**S** | Open the on-screen keyboard / microphone |
| E | Ctrl+Alt+Shift+**E** | Subtitles on/off in the selected player, when available |

### Edit home screen

**Menu → Edit home screen** shows Apps, Games and Cameras as grids of tiles
(ten across). Arrows move within a section and, past its edge, into the section
above or below (same column, or its nearest tile); Left/Right stop at a
section's ends. **OK** shows or hides the selected tile at once (a tick: on the
home screen; faded with an empty circle: hidden). **Back** returns to Settings;
**Home** closes everything.

### Home with games but no cameras

The Apps grid keeps six tiles to a row (up to twelve apps), with the Games row
below it. Down moves through the Apps grid, then into Games (same column, or the
last game), then into the bottom controls; Up returns the same way, from the
bottom controls to the tile you left. Left/Right move along a row; the Games
row scrolls sideways.

## Pass-through buttons

**Pointer fallback:** in an app, choose **Menu → Remote pointer**. Arrows move the
mouse, OK clicks and CH ▲/▼ scroll. Back exits without sending Back to the app;
Home and Menu also exit. Switching focus releases these temporary key grabs.
Use this for desktop interfaces without directional navigation, including Nod.ie
and Netflix browsing. Jellyfin uses its native TV mode; YouTube already requests
its TV interface (availability on desktop browsers depends on Google).

The launcher passes navigation keys to the app in front. KDE handles system
volume keys. Sofa routes transport keys as described below. Back uses the launcher translation
shown in the table.

| U1 button | Flirc sends | Notes |
|---|---|---|
| ▲ ▼ ◀ ▶ | Up / Down / Left / Right | |
| OK | Enter | |
| ↩ Back | Ctrl+Alt+Shift+**K** | **Tested 2026-11-09:** the Flirc's Browser Back (HID 0xF1) produces no event on Linux, so Back sends Ctrl+Alt+Shift+K and the launcher translates it for whatever is in front: Alt+Left for Edge apps and the full Edge browser (history back), Escape for Jellyfin Desktop, and Back inside the launcher's own screens. In YouTube, Netflix, Prime Video, TIDAL, Audible and Fountain, Back with nothing left to go back to returns to Sofa home and leaves the app running. |
| CH ▲ / CH ▼ | Page Up / Page Down | Scroll long lists |
| Vol + / − | Volume Up / Down (media key) | KDE handles system volume (with its on-screen volume pop-up) |
| Mute | Mute (media key) | |
| ▶ Play / ⏸ Pause | Play/Pause (media key), both buttons | See *Media keys* below |
| ■ Stop | Stop (media key) | See *Media keys* below |
| ⏩ FF / ⏪ Rew | Fast Forward / Rewind (media keys) | TIDAL: next / previous track. Other apps keep native seek handling. |
| 0–9 | 0–9 | Home screen: jump to tile 1–9 (the Apps row only; games and cameras have no numbers) |
| ▲ ▼ ◀ ▶ / OK / ↩ Back | (as above) | Docker containers view: arrows move between cards, OK shows a container's details, Back closes the details and then the view; Home leaves at once |
| − | Minus | |

### Media keys

While Sofa runs, Play/Pause, Stop, Next and Previous target the app on screen.
A visible Sofa menu targets the app underneath it; Home targets the last app.
TIDAL uses its own bottom player controls when in front, so Play also works for
a loaded track that has not yet published an MPRIS session. Other transport
commands use the selected window's MPRIS owner, matched by PID/Flatpak identity.
They never fall back to another streaming app when the selected app has no player.

Sofa saves KDE's original transport shortcuts before claiming these four keys.
Full Quit restores them; a crash journal is recovered on restart or by running
`sofa-launcher --undo-user-setup` after Sofa is stopped. Volume keys are unchanged.
Outside Sofa-managed apps, transport is passed to KDE's normal Media Controller.

FF/Rew (`XF86AudioForward/Rewind`) reach the app directly. The TIDAL adapter
maps them to next/previous track; video apps retain their native behavior.

### Held buttons

Holding a U1 button keeps the key down, so X auto-repeat fires it
repeatedly. The launcher **debounces each global action (~400 ms)**, so the
Power menu or camera cycle doesn't flap. Arrows still repeat normally, for
scrolling.

Before synthesising an app chord (Back, Nod.ie talk/controls, subtitles or
TIDAL transport), Sofa waits for the keys held at dispatch to be released
(up to 1500 ms). X11's global shortcut grab otherwise captures the translated
key while the remote button is still held. Helper failure/timeout permits a
best-effort send; it does not leave the action waiting indefinitely. Back's
short title poll starts after the send completes, and a Home request is honoured
only while the requesting window is still active.

The U1's top scroll wheel picks which device the remote controls. It doesn't
send codes, so it isn't mapped.

## Programming steps

1. **SofaBaton app (phone)**: add a device to the U1 that sends a **different
   IR code for every button**. Search the database for "Flirc" first; if it's
   not there, pick a Media Center PC (MCE) profile, or any brand that no other
   device in the room responds to (so the TV doesn't react too).
2. **Back up the Flirc**: plug it into **a development PC**, open the Flirc app
   (flirc.tv download) and do *File → Save configuration*. It may already
   hold mappings.
3. **Clear and record**: *Controllers → Full Keyboard* (CLI alternative: `flirc_util record_api 7 <hid-usage>`, where 7 = Ctrl+Shift+Alt). For each row above,
   set the modifiers and click the key, then press the U1 button when the app
   asks. Media keys are under *Controllers → Media Keys* (or similar).
4. **Save** the new configuration as `flirc-sofa-launcher.fcfg`. It's safe to
   commit: IR codes only, no secrets.
5. **Move the Flirc to the TV PC** (any USB port with line of sight to the
   sofa). On the TV PC it's a plain USB keyboard and needs no admin rights.
6. **Check**: run `xev -event keyboard` on the TV PC and press every
   button. Each should show the key in the tables above. Later, the
   launcher's button test does this for you.

## To verify in S3

- ✅ The TV PC has no KDE shortcuts on Ctrl+Alt+Shift+{H,P,R,G,Y,B,N,I,S,E,M,K} (checked 2026-11-08, read-only).
- ✅ No xkb `options` on the TV PC (layout `gb`, model `pc104`, no `grp:` toggles), and KDE sets no layouts.
- ✗ Flirc's AC Back produced no event on Linux (2026-11-09), so the Ctrl+Alt+Shift+K fallback is in use.
- Holding each button: debounce works, nothing flaps.
- Global shortcuts with NumLock/CapsLock on. Expected fine: Chromium's X11 listener grabs with none/Mod2/Lock/Mod2+Lock masks.
- Media Fast Forward / Rewind reach Edge (Netflix, YouTube) and Jellyfin Desktop.
- Browser Back goes back in each app (Netflix browse, Prime, YouTube TV, Jellyfin, Home Assistant).
