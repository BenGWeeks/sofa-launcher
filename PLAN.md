# sofa-launcher — Plan

A Smart-TV-style launcher for **the TV PC** (a living-room PC), driven by a
**SofaBaton U1** remote. One full-screen, standalone Electron app that switches
between "apps" (streaming services, desktop apps, a camera overlay) using only
the remote.

Status: **draft v2**, 2026-11-08. v1 reviewed by Fable 5.1; findings folded in (see §14).

---

## 1. Goals

1. A 10-foot, full-screen home screen of large tiles, fully usable with arrows / OK / Back.
2. Switch between apps **without reloading** them (bring the existing window forward).
3. **Configurable apps** like a smart TV: add from a built-in catalogue, hide, reorder, custom apps.
4. **Camera picture-in-picture** (Frigate/Reolink) that stays on top of full-screen video.
5. **Nod.ie** voice assistant reachable from anywhere ("talk" button).
6. **Self-explanatory remote**: on-screen remote guide, button-test mode, toasts for every action, hint bar.
7. Open with **Home**, close via **Power** menu; starts at login.

Initial apps: Jellyfin (desktop app), Netflix, Prime Video, YouTube (TV UI), Home Assistant, Nod.ie (desktop app).

## 2. Non-goals

- Not a media player. Playback is done by each app.
- No streaming credentials handled by the launcher; logins live in browser profiles.
- No root daemons, Docker, or system services.
- No changes to the TV PC's Docker stacks, Frigate/go2rtc config, or `/opt/tv-pc`.

## 3. Deployment constraints

| Constraint | Consequence |
|---|---|
| No development on the TV PC | Built and tested on a development PC (Ubuntu 24.04.5, same OS); installed on the TV PC from a release. |
| The TV user has no sudo or Docker access | Fully user-level install: `~/.local`, `~/.config`, KDE autostart. |
| Anything needing root | Separate, reviewed step run by an administrator (listed in §13). |
| Camera transport isolation | Never use go2rtc's API (1984), never expose RTSP to LAN, never touch `exec:` config. Read `rtsp://127.0.0.1:8554/<cam>_sub` only. |
| Secrets | None in repo. Browser logins stay in browser profiles. (No token needed for the camera; RTSP is localhost-only, no auth.) |
| No dependency on a development checkout | Launcher never depends on it. Nod.ie path is config, not code. |

## 4. Known environment (the TV PC)

- Kubuntu 24.04, **Plasma 5.27.12, X11** session, user `tvuser`, `DISPLAY=:0`.
- Display: NVIDIA RTX 3090 (proprietary 580), HDMI-0 at **3840×2160** (4K TV). No VA-API on NVIDIA (`nvidia-vaapi-driver` not installed) → Chromium software-decodes video.
- Browsers: **Edge 157 (deb) is the only Widevine-capable browser** installed; no Chrome/Chromium, Firefox is only the transitional stub. Installing any other browser requires an administrator.
- Installed: `xdotool`, `ffmpeg` (incl. `ffplay`), `gstreamer1.0-plugins-bad`, `python3-gi`, Microsoft Edge. Not installed: `mpv`, `wmctrl`.
- Frigate (home-stack) go2rtc RTSP on `127.0.0.1:8554`. Cameras: `front_door` (working), `barn`, `barn_door`, `chicken_coop`, `paddock` (placeholder IPs, not streaming). `<cam>_sub` H.264 ~640×360 restreams are configured separately on the server.
- Home Assistant: `https://homeassistant.local:8123`.
- Jellyfin: **Jellyfin Desktop 2.0.0** flatpak `org.jellyfin.JellyfinDesktop` (system install). Command `flatpak run --branch=stable --arch=x86_64 --command=jellyfin-desktop org.jellyfin.JellyfinDesktop`; X11 WM_CLASS `jellyfin-desktop` (not the .desktop `StartupWMClass`). Native mpv-based player uses NVDEC; Edge locks up on Jellyfin web, most likely because it software-decodes video on this box. So Jellyfin stays a desktop app.
- Nod.ie: Electron app, launched by `~/.local/bin/nodie-desktop`; WM_CLASS likely `nodie`; hotkeys Ctrl+Shift+Space (toggle mic) and Ctrl+Shift+A (show). Currently **crashing on start** and run from `~/GitHub/Nod.ie` (separate application issue; out of scope here).
- Microphone: Xbox Kinect v2 4-mic array (good far-field for Nod.ie).
- Remote: SofaBaton U1 (IR + Bluetooth). **A Flirc receiver is available** (not currently plugged into the TV PC). Key mapping is set in S3.

## 5. UX

### 5.1 Screens

- **Home**: full-screen dark background, a single row/grid of large tiles (logo + name),
  strong focus state (scale + glow ring, 150 ms ease), clock top-right, hint bar at the bottom:
  `1–9 Apps · 🔴 Camera · ● Nod.ie · ⓘ Help`. Tiles show state: running / not running / not installed.
- **In-app menu** (Menu while watching): app row · Close app · Camera (soon) · Talk to Nod.ie · Remote guide. Menu or Back closes it and refocuses the app. Home always opens the full home screen.
- **Edit apps** (Settings): add from catalogue, hide/show, reorder with arrows, custom app (via keyboard or config file).
- **Settings**: Edit apps · Cameras · Button test · Remote guide · Default browser · About · Quit completely.
- **Remote guide** (ⓘ Info): picture of the U1 with every button labelled with its *current* action (context-aware: home / in an app / camera showing). Generated from the button map.
- **Button test**: press any button → it lights up on the diagram with the key received and the mapped action; checklist (e.g. "32 / 40 working"); flags buttons sending nothing or duplicate keys.
- **Power menu** (⏻): Close Sofa Launcher · Log off · Turn screen off · Cancel (confirmation; never instant).
- **Toasts**: every launcher-level action shows a short OSD ("→ Netflix", "📷 Front door", "Next camera: barn (offline, skipped)", "🎤 Nod.ie listening").

### 5.2 Default button map (provisional — confirmed by Spike S3)

| U1 button | Action | Scope |
|---|---|---|
| Arrows / OK | Navigate / select | Passed to focused window (launcher or app) |
| Back | Browser Back key (`XF86Back`) → the app's own back | Passed through |
| 🏠 Home | Open launcher / return to home screen | Global |
| 1–9 | Jump to app in position 1–9 | Home screen; global only via opt-in F-keys (§8) |
| 🔴 Red | Camera PiP on/off | Global |
| 🟢 Green | Next camera (skips offline) | Global |
| 🟡 Yellow | Move PiP to next corner | Global |
| 🔵 Blue | Spare (full-screen camera view, later) | Global |
| ● Record | Nod.ie talk (sends its hotkey) | Global |
| ⏻ Power | Power menu | Global |
| ⓘ Info | Remote guide for the current screen (home, app, camera) | Global |
| ☰ Menu | Settings on home; slide-up panel in apps (Menu/Back closes) | Global |
| Play/Pause/Stop | Sent via MPRIS to the **frontmost** app (KDE's Media Controller grab unbound) | Global |
| FF/Rew | Media keys | Passed through |
| Vol± / Mute | System volume (KDE handles media keys) | Passed through |

The map lives in config (`[buttons]`), so the guide, the test mode, the hint bar and the tests all read the same source.

### 5.3 Behaviour rules

- Opening an app that is already running **activates its window**; it is never reloaded.
- Apps keep running in the background; "Close app" (tile menu) ends them.
- "Close Sofa Launcher" hides the launcher and closes apps opened or brought forward through Sofa during the session, including Nod.ie, unless explicitly configured with `keepOnClose = true`. The process stays resident (tiny) so **Home** reopens it instantly. "Quit completely" (Settings) performs the same app cleanup and exits the process.
- The camera overlay and toasts **never take keyboard focus** away from the playing app.
- Switching apps **pauses the previous app** via MPRIS (each Edge instance and Jellyfin expose a player), so Netflix doesn't keep playing under Jellyfin.
- If a launched app's window disappears (crash, Ctrl+W, sign-out), the launcher **auto-shows Home**. You never end up on the bare Plasma desktop without a mouse.
- **Back on Home** returns to the last app.
- The mouse cursor is hidden in the launcher (`cursor: none`).
- The TV must never show a lock screen or suspend while idle (see §11). Plasma notifications are suppressed while full screen.
- First sign-in to each streaming service needs a keyboard; the acceptance docs say so.

## 6. Technology

| Part | Choice |
|---|---|
| App shell | **Electron** (current stable), TypeScript, single-instance lock |
| UI | **Svelte 5 + Vite**, CSS animations, no UI framework |
| Config | TOML (`smol-toml`) validated with `zod`; `~/.config/sofa-launcher/config.toml` |
| Global keys | Electron `globalShortcut` (XGrabKey underneath) on **Ctrl+Alt+Shift+letter** for every global action. Flirc sends them (§8, `docs/keymap.md`); they're unbound in KDE by default. Not F13–F24: on X11, xkb maps those to `XF86Tools`/`XF86Launch5–9`/mic-mute/touchpad keysyms. |
| Window control | `xdotool` (installed) behind a `WindowManager` interface, using `windowactivate` for all switching (it bypasses focus-stealing prevention). KWin rules are **merged** into `kwinrulesrc` (append group, bump `count`, never clobber), then `qdbus org.kde.KWin /KWin reconfigure` |
| Media control | MPRIS over D-Bus (`dbus-next`) to pause the app being left |
| Camera | `ffplay` (installed) per camera, low-latency flags |
| Tests | Vitest (unit), Playwright `_electron` (UI/e2e), button-map contract tests |
| Quality | ESLint, Prettier, `tsc --noEmit`, GitHub Actions on every PR |
| Packaging | electron-builder **`.deb`**, installed to root-owned `/opt/sofa-launcher` by an administrator (§11). That's required for the OS sandbox: see S1 / R1. |

## 7. Architecture

```
Electron main process (TypeScript)
├── ConfigStore       load/validate/save config.toml, watch for edits
├── Catalogue         built-in app definitions + icons (bundled)
├── AppManager        launch / activate / close apps; state (running, not installed)
│   ├── WebApp        browser --app window, per-app profile dir
│   └── DesktopApp    command + WM_CLASS match
├── WindowManager     xdotool: find by PID/class, activate, hide; KWin rule install
├── InputManager      global key grabs → actions; button-test capture mode
├── OverlayManager    camera PiP: probe, spawn/kill ffplay, corner, cycle
├── PowerManager      screen off (xset dpms force off), close/quit
├── ToastWindow       2nd frameless, transparent, focusable:false BrowserWindow (own WM_CLASS
│                     + KWin OSD rule) so toasts show while the main window is hidden
├── Watchdog          app window gone → show Home
└── IPC (contextBridge, typed)  ⇄  Renderer (Svelte)
                                   Home · Edit apps · Settings · Guide · Button test · Power · Toasts
```

Security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, renderer loads only bundled local files, strict CSP, no remote content in the launcher window. Child processes are spawned with argument arrays (never a shell string). Config values are validated before reaching `spawn`: a leading `~/` is expanded explicitly, `browser` is limited to fixed known binaries, and web app URLs must be `https:`. KWin rules match on **WM_CLASS only, never window title**: in `--app` mode Chromium sets the title from `document.title`, so any web page could otherwise turn its window into an unfocusable always-on-top OSD.

### 7.1 Web apps

- Launched as `microsoft-edge-stable --user-data-dir=~/.local/share/sofa-launcher/profiles/<app-id> --class=sofa-<app-id> --app=<url> --start-fullscreen --no-first-run --no-default-browser-check --disable-session-crashed-bubble` (exact flags confirmed by Spike S4).
- Apps are closed gracefully (WM close), not SIGKILL, so there's no "restore pages?" bubble.
- Widevine is downloaded **per profile** by Edge's component updater, so a brand-new profile may fail DRM for a minute and need one restart. The first-run flow handles this, and S4 tests it from a cold profile.
- **One browser profile per app**: separate process per app, which gives:
  - a reliable WM_CLASS for window matching
  - crash isolation (an Edge crash in Netflix doesn't touch Prime)
  - a clean close
- Cost: you sign in once per service, which you'd do anyway.
- **Edge only in v1.** It's the only Widevine browser on the TV PC; Firefox lacks `--app`. The `browser` field exists in config but is an enum of one; Chrome can be added later if ever installed.
- YouTube uses `https://www.youtube.com/tv` with a TV user-agent so the 10-foot UI loads. Google intermittently blocks this trick, so the catalogue falls back to `youtube.com` (setting).

### 7.2 Desktop apps

- `command` (argv array) + `wmClass` for matching + optional `hotkeys` (named key combos the launcher can send).
- Jellyfin: Jellyfin Desktop flatpak (command in §4); full-screen/TV mode flags confirmed in S4.
- Nod.ie: `command = ["~/.local/bin/nodie-desktop"]`, `wmClass = "nodie"`, `hotkeys.talk = "ctrl+shift+space"`.
  - ● Record runs `xdotool key ctrl+shift+space`, which reaches Nod.ie's global grab.
  - **No KWin rule for Nod.ie in v1.** A class-wide "accept focus: no" would also make its settings window unusable. Revisit later, scoped by window role.
- Not installed / crashed → tile shows state; opening shows a toast instead of failing silently.

### 7.3 Camera overlay

- Spawned as `ffplay -rtsp_transport tcp -fflags nobuffer -flags low_delay -framedrop -probesize 32 -analyzeduration 0 -an -noborder -loglevel error -x W -y H rtsp://127.0.0.1:8554/<cam>_sub`, with env:
  - `SDL_VIDEO_X11_WMCLASS=sofa-cam`: a fixed class for the KWin rule (never match on title).
  - `SDL_VIDEO_X11_NET_WM_BYPASS_COMPOSITOR=0`: otherwise SDL asks KWin to suspend compositing, which flickers/black-flashes on NVIDIA.
- A user-level **KWin rule** on class `sofa-cam` (and on the toast window's class):
  - Window type forced to **On-screen display**. The OSD layer sits above the active fullscreen layer in KWin 5.27; "keep above" alone does not.
  - Skip taskbar/pager/switcher.
  - **Accept focus: no.**
- **Position**: KWin places OSD windows itself, typically centred in the lower third. So after the window maps, the launcher moves it with `xdotool windowmove` (or a forced-position rule; S2 decides). Corner cycling uses the same move.
- **Focus restore**: before spawning, record the active window, then `xdotool windowactivate` it once the overlay has mapped. That's belt-and-braces in case SDL grabs focus itself.
- The camera cycle probes each camera with `ffprobe` (3 s timeout) and skips offline cameras with a toast.
- An RTSP 404 (go2rtc can't reach the camera) or a connect failure means **camera unavailable**. The PiP shows a "Front door: offline" card instead of video and retries with backoff (10 s → 30 s → 60 s, capped), never in a tight loop. All five `<cam>_sub` restreams exist (server configuration complete); they start working as soon as each camera is back on Wi-Fi.
- Cameras, their order and the PiP size and corner come from config. Default size is 25% of screen width, so 960×540 on the 4K TV. A 640×360 stream upscaled is fine at that size, and CPU decode of 360p H.264 is negligible.
- Fallbacks if S2 fails:
  1. Make the streaming windows **borderless-maximised instead of true fullscreen** (KWin rule, no `--start-fullscreen`), so "keep above" wins.
  2. Last resort: `mpv` (installed by an administrator with apt).

### 7.4 Config (example)

```toml
[ui]
defaultBrowser = "edge"

[[apps]]
id = "jellyfin"; type = "desktop"; command = ["flatpak", "run", "--branch=stable", "--arch=x86_64", "--command=jellyfin-desktop", "org.jellyfin.JellyfinDesktop"]; wmClass = "jellyfin-desktop"

[[apps]]
id = "netflix"; type = "web"; catalogue = "netflix"   # url/icon from catalogue

[[apps]]
id = "nodie"; type = "desktop"; command = ["~/.local/bin/nodie-desktop"]; wmClass = "nodie"
hotkeys = { talk = "ctrl+shift+space" }

[[cameras]]
id = "front_door"; name = "Front door"; url = "rtsp://127.0.0.1:8554/front_door_sub"

[buttons]
home = "Ctrl+Alt+Shift+H"; power = "Ctrl+Alt+Shift+P"; cameraToggle = "Ctrl+Alt+Shift+R"   # see docs/keymap.md
```

(TOML shown compressed; real file uses one key per line.)

## 8. Global key handling

- **Input path: a Flirc USB receiver** with the U1 in IR mode.
  - Flirc maps any remote button to any key, so every *global* action gets its own **Ctrl+Alt+Shift+letter** combo. Those are unbound in KDE, have no clash with in-app keys, and need no extra npm dependency. Full table in `docs/keymap.md`.
  - Not F13–F24: on X11, xkb maps them to `XF86Tools`, `XF86Launch5–9`, `XF86AudioMicMute` and touchpad keysyms (checked on a development PC), and KDE binds some of those. Avoid Ctrl+Alt+Shift+Del/PgUp/PgDn (KDE logout/reboot/halt).
  - Navigation and media buttons send normal keys (arrows, Enter, Escape, media keys) that pass through to apps.
  - Bluetooth stays an option if S3 shows the U1 pairs with BlueZ as a plain keyboard and sends usable keys for the colour, Record and Home buttons. That's unknown, because its Bluetooth mode targets Fire TV, Apple TV and Shield.
- **Digits 1–9 are not grabbed globally by default.** That would break YouTube's number-key seeking and in-app typing. Instead:
  - On the home screen they jump to tiles.
  - Inside apps, global app-jumps are possible only via opt-in Ctrl+Alt+Shift combos.
- The launcher grabs only global keys; everything else reaches the focused app untouched. Any key it couldn't grab is reported as a toast and a button-test warning.
- **Power key safety (before S3):** a HID power key reaches logind as well as X, and Powerdevil's default is the shutdown/logout dialog. The first stray press could shut the box down. Disable both, user-level, before testing:
  - `powerdevilrc` `[AC][HandleButtonEvents] PowerButtonAction=0`
  - clear `org_kde_powerdevil` `PowerOff` in `kglobalshortcutsrc`

  With Flirc the Power button sends Ctrl+Alt+Shift+P, which sidesteps this entirely.
- Every global action is **debounced (~400 ms)**, because a held remote button auto-repeats.
- Single-instance: a second `sofa-launcher` launch (menu icon, or a KDE shortcut as a safety net) tells the running instance to show Home.

## 9. Testing (on a development PC)

- **Unit**: config parsing and validation, catalogue merge, button map → action resolution, camera cycle (skip offline), argv building (no shell injection).
- **Contract**: every global action in the button map has a guide label, a hint, and a handler. The guide can't drift.
- **UI (Playwright `_electron`)**: arrow navigation, focus visibility, edit apps (add/hide/reorder persists), power menu confirm, button test with simulated keys.
- **System layer**: `WindowManager`, `OverlayManager` and spawn behind interfaces with fakes in tests. A `--dev --windowed` mode runs on a development PC with the keyboard.
- Manual acceptance on the TV PC per milestone (checklist in `docs/TV_ACCEPTANCE.adoc`).
- **Remote-only journeys (acceptance gate):** for every initial service (Netflix, Prime, YouTube TV, Jellyfin, Home Assistant, Nod.ie), using only the U1: open from Home → browse → pick something → play/pause/seek → Back out → switch app → return. Note any control that arrows/OK can't reach.
  - Fallbacks, in order: the service's TV UI (e.g. YouTube `/tv`), Tab/Shift+Tab via spare buttons, then a launcher "pointer mode" (arrows move the mouse, OK clicks), which is planned only if needed.

## 10. Milestones (each = one PR, Fable 5.1 review before merge; GPT via codex-review as extra opinion)

- **M0 — Spikes**: throwaway scripts under `spikes/`. Order matters:
  - **S3 first: Flirc mapping.**
    1. In the SofaBaton app, give the U1 a device profile that sends a distinct IR code for every button (a Flirc / Media Center profile, or any unused brand).
    2. Plug the Flirc into **a development PC**, back up its current config, and record each button → key per `docs/keymap.md` (globals on Ctrl+Alt+Shift+letter, navigation and media on standard keys). The mapping is stored on the Flirc itself.
    3. Move the Flirc to the TV PC and verify every button with `xev`/`evtest`; this is the first run of the button-test checklist.
    - Apply the Power-key safety settings (§8) on the TV PC first anyway (user-level).
  - **S1: Electron sandbox on Ubuntu 24.04** (AppArmor userns restriction). Runs on **a development PC** (same OS), so it doesn't need the TV PC.
  - **S2: overlay stacking**, on the TV PC. ffplay + KWin OSD rule above full-screen Edge Netflix/YouTube and Jellyfin Desktop. Check:
    - no focus steal
    - position honoured or corrected by `windowmove`
    - no compositor flicker
    - a transparent `focusable:false` Electron toast window also stays on top
  - **S4: Edge per-app profiles**, on the TV PC. `--class` matching, `--app` + fullscreen, activate/switch, graceful close, and Netflix DRM from a **cold new profile**.
- **M1 — Skeleton + delivery path**:
  - Electron + Svelte + TS, config, home grid, fullscreen.
  - Web + desktop app launch/activate, Home / Power menu, CI.
  - **Minimal `.deb` + `install-system.sh` + `--self-check`**, so every later milestone can be accepted on the TV PC (an administrator installs each milestone build).
- **M2 — Remote UX**:
  - Guide, button test, toasts (ToastWindow), hint bar, contextual Info/Menu, MPRIS pause, watchdog → Home.
  - **Slide-up panel while watching**: Menu in an app shows a panel over the bottom third (app row, camera, Nod.ie, close app) with the video still playing; Menu or Back → dismiss. Home always goes to the full home screen. It's an OSD-layer window like the camera overlay (covered by S2); it takes focus while open and returns it on close.
  - **Local control command**: `sofa-launcher open <app> [--search "<text>"]`, via the single-instance channel. Used by scripts, tests and (M6) Nod.ie.
- **M3 — Camera PiP and media-key ownership**: overlay, cycle, corners, focus restore, KWin rule merge.
  - Grab global `MediaPlayPause` / `MediaStop` and dispatch transport commands over MPRIS only to the foreground app. Today KDE's Media Controller chooses the player; the launcher only pauses the app being left after a successful switch.
  - `--setup-user` reversibly unbinds KDE Media Controller shortcuts, saving their previous values; `--undo-user-setup` restores them. Verify single-player dispatch and restoration before enabling ownership.
- **M4 — Catalogue + edit apps**; Nod.ie talk; screen off (incl. HDMI audio check after DPMS resume).
- **M5 — Polish + ops**: autostart, uninstall, update path, no-lock/no-suspend settings, `docs/` (incl. acceptance checklist).
- **M6 — Voice & search**:
  - Press ● and say "Search Netflix for The Crown" / "Play Bluey on YouTube"; Nod.ie (local STT on the Kinect mic) calls `sofa-launcher open <app> --search …`.
  - The launcher opens the app at its search results: Netflix `/search?q=`, Prime `/search?phrase=`, YouTube TV search, Jellyfin via its server's search.
  - Also an on-screen search box as a typed fallback.
  - Needs Nod.ie healthy again plus a small change in the nodie repo.

## 11. Install & update (the TV PC)

Decided 2026-11-08 (S1): **a root-owned install, run by an administrator**.

- GitHub Release → `sofa-launcher_<ver>_amd64.deb` + `SHA256SUMS`.
- **`install-system.sh`** (reviewed; run by **an administrator**):
  - download a **pinned release tag**
  - verify the SHA256
  - `apt install ./sofa-launcher_<ver>_amd64.deb`
  - The `.deb` installs to `/opt/sofa-launcher`, with `chrome-sandbox` root:root 4755 and/or an AppArmor profile on the `/opt` path, plus `/usr/bin/sofa-launcher` and a menu entry.
- **`sofa-launcher --setup-user`** (run once by **the TV user**, no sudo):
  - `~/.config/autostart` entry
  - KWin rules (merged into `kwinrulesrc`, never clobbered)
  - unbind KDE Media Controller play/pause/stop shortcuts (§8)
  - TV session settings, all user-level and reversible with `--undo-user-setup`:
    - no screen lock (`kscreenlockerrc` `Autolock=false`, `LockOnResume=false`)
    - no idle suspend (Powerdevil AC profile)
    - Power-key handling off (§8)
    - do-not-disturb while full screen
  - seed `config.toml` if absent (never overwrite)
- **Self-check**: `sofa-launcher --self-check` (also on the About screen) must report `osSandboxed: true` (renderer `Seccomp: 2`, `NoNewPrivs: 1`). Never fall back to `--no-sandbox`.
- **Trust path:** an administrator uses a separately reviewed, administrator-owned installer and obtains the release SHA256 independently of the TV user’s files.
- **Update** = an administrator reruns `install-system.sh` with the new `.deb` and its SHA256. Config untouched. (M1 simplification: the script takes a local `.deb` + expected SHA256 rather than downloading a tag. It copies the file to a root-owned temp dir before checking, so the file can't be swapped between check and install.)
- **Uninstall** = `apt remove sofa-launcher` (an administrator) + `--undo-user-setup` (the TV user).
- On a development PC: `npm run dev` adds `--no-sandbox`. That's dev only; the package never does.

## 12. Risks & open questions

| # | Risk | Mitigation |
|---|---|---|
| R1 | Ubuntu 24.04 AppArmor blocks Electron's sandbox for user-level installs | **Resolved (S1)**: root-owned `/opt` `.deb` by an administrator (§11); `--self-check` verifies. |
| R2 | OSD/keep-above doesn't beat full-screen Chromium in KWin 5.27 | S2; fallback borderless-maximised; last resort mpv. |
| R3 | A Ctrl+Alt+Shift combo clashes, or the Flirc can't send AC Back | Checked: no clashes on the TV PC (all 12 combos; no xkb `grp:` options). NumLock/CapsLock is handled by Chromium's grab masks. Back fallback: Ctrl+Alt+Shift+K, translated per app. |
| R4 | A stray Power press shuts the TV PC down (logind/Powerdevil) | Flirc sends Ctrl+Alt+Shift+P, not a power key; Power-key safety settings as a safety net (§8). |
| R5 | Chromium flags (`--class`, fullscreen) behave differently in Edge | S4; matching falls back to PID → window. |
| R6 | Netflix/Prime picture quality is capped in Linux browsers | Accepted; nothing the launcher can change. |
| R7 | Nod.ie currently crashes / lives in `~/GitHub` | Out of scope; tile shows state. Tracked separately from launcher work. |
| R8 | 4K output: the launcher UI must stay crisp and fast at 3840×2160; Edge software-decodes video, so streaming services may be CPU-heavy | UI sized in `vw`/`rem`, tested at 4K in a development PC window. Hardware decode (`nvidia-vaapi-driver`) is out of scope (flaky with Chromium; an administrator step). |
| R9 | Edge and flatpak updates require an administrator; a stale Edge can break DRM | Recurring administrator task (§13); About screen shows Edge version. |
| R10 | Lock screen / idle suspend is unrecoverable from the remote | TV session settings in `--setup-user` (§11). |
| R11 | HDMI audio sink can vanish after `xset dpms force off` on NVIDIA | Tested in M4; fallback: blank the screen with a black OSD window instead of DPMS. |
| R12 | YouTube TV UA blocked by Google | Fallback to `youtube.com` (§7.1). |

## 13. Steps that need an administrator (root), reviewed separately

1. **Install/update the launcher**: `install-system.sh <tag>` (pinned tag, SHA256-verified `.deb` into `/opt`). Once per release.
2. *(Only if S2 fails)* `apt install mpv`.
3. *(Only if missing)* SDDM autologin for `tvuser`, so the TV boots straight to the launcher.
4. **Recurring**: `apt upgrade` for Edge and `flatpak update` for Jellyfin Desktop (R9).

Not needed: anything for the Flirc. It's a plain USB keyboard on the TV PC; it's programmed on a development PC.

Server-side `<cam>_sub` restream configuration is complete.

## 14. Review log

- **v1 → v2 (Fable 5.1, 2026-11-08)**. Accepted:
  - packaging moved to M1
  - Flirc recommended + key-only globals, so the `x11` npm dependency is dropped
  - Power-key safety
  - KWin OSD positioning / WM_CLASS-only rules / SDL compositor env / focus restore
  - ToastWindow
  - Edge flags + cold-profile Widevine
  - 10-foot gaps (no lock, watchdog, MPRIS pause, Back→last app, cursor)
  - sandbox options detail
  - Edge-only v1
  - Nod.ie KWin rule dropped
  - URL/`~`/browser validation
  - `kwinrulesrc` merge
  - update-ops risk
  - HDMI-after-DPMS risk

  Nothing rejected.
- **v2 → v2.1 (2026-11-08)**:
  - A Flirc receiver is available.
  - Global keys changed from F13–F24 to Ctrl+Alt+Shift+letter, because xkb on X11 doesn't produce F13–F24 keysyms (checked on a development PC with `xmodmap -pke`).
  - Added `docs/keymap.md`.
  - Offline-camera backoff.
- **v2.1 → v2.2 (Fable 5.1 review of keymap + S1; sandbox decision, 2026-11-08)**:
  - Install is now a root-owned `/opt` `.deb` by an administrator + user-level `--setup-user` + `--self-check`.
  - Back = Browser Back (AC Back), not Escape.
  - Launcher owns Play/Pause/Stop via MPRIS.
  - Menu is a global quick menu.
  - 400 ms debounce.
  - R1 resolved, R3 lowered.
- **v2.2 → v2.3 (2026-11-08)**:
  - Requested: slide-up panel while watching (M2, Menu → panel; Home → full home screen), local `open --search` command (M2), voice & search via Nod.ie (new M6).
  - Install script takes a local `.deb` + SHA256.
