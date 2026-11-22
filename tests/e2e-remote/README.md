# Remote end-to-end check (manual)

Presses the remote's **Back** and **Home** in every app on a real desktop, through a virtual
keyboard that sends exactly what the Flirc receiver sends, and reports what happened:

```
netflix | opened 'Netflix' | Sofa Home after 1 Back(s) | Home → Sofa Home | log: 1 Back: ctrl+shift+F8 to Netflix (web);1 Back: Netflix asked for home
```

Run it on the TV PC (or a laptop trying Sofa) with Sofa running and the apps signed in; keep
hands off while it runs (about 20 seconds per app):

```bash
tests/e2e-remote/run.sh
APPS="netflix youtube" tests/e2e-remote/run.sh
HOME_KEY=home tests/e2e-remote/run.sh     # if [buttons] home is the keyboard's Home key
```

Only Back and Home are pressed (never OK or arrows), so nothing is chosen, played or switched.
It needs `xdotool`, ImageMagick's `import`, `python3-evdev`, and write access to `/dev/uinput`
(membership of the `input` group). Not for CI: it needs a desktop session and real accounts.

What to expect: streaming apps go to Sofa's Home after one Back from their main screen (YouTube
after its side menu); Jellyfin and Home Assistant are web pages, so Back is the browser's and
stays in them; Nod.ie returns at once; Home returns from everything. A camera opens inside Sofa
and is not covered.
