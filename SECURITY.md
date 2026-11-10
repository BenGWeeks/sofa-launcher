# Security Policy

Sofa Launcher runs full-screen on a living-room PC, grabs global keyboard shortcuts, starts other apps, and
can hold a Home Assistant token for camera feeds. We take security reports seriously and appreciate
responsible disclosure.

## Supported versions

Security fixes are made against:

| Version                                                                        | Supported |
| ------------------------------------------------------------------------------ | --------- |
| `main` branch                                                                  | Yes       |
| Latest [release](https://github.com/BenGWeeks/sofa-launcher/releases)          | Yes       |
| Older releases                                                                 | No        |

Please update to the latest release before reporting, and check whether the issue still reproduces. The
version is shown in the bottom-right corner of the home screen and in **Menu → About**.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately:

1. Go to the [Security tab](https://github.com/BenGWeeks/sofa-launcher/security) of this repository and
   choose **Report a vulnerability** (GitHub private vulnerability reporting).
2. Describe the issue, the affected version or commit, the steps to reproduce, and the impact you expect.

**Never include secrets in a report.** Do not paste Home Assistant tokens, camera passwords, streaming-service
logins, SSH keys, or the contents of `~/.config/sofa-launcher/` or a browser profile. If you need to
demonstrate an issue, use demo mode or a throwaway Home Assistant instance. If you have accidentally exposed a
real secret, revoke or rotate it first (for example, delete the Home Assistant long-lived token), then tell us.

## What is in scope

- The Sofa Launcher app in this repository: the main process, preload, renderer and packaging.
- IPC between the renderer and main process, and the validation of everything that crosses it.
- Launching apps and building their command lines, and anything that could inject arguments or commands.
- Handling of `config.toml` and catalogue entries, including URLs, commands, window classes and file paths.
- Global key grabs and synthesised key events sent to other apps.
- The Home Assistant connection: token storage in the OS keyring, the camera snapshot and WebRTC signalling,
  and anything that could leak the token to a renderer, URL, log or third party.
- The Electron sandbox, fuses, AppArmor profile and the `.deb` install (`scripts/install-system.sh`).
- Interactions with Nod.ie that Sofa triggers, such as `--say` announcements.

## What is out of scope

- Vulnerabilities in third-party apps Sofa launches (Microsoft Edge, Jellyfin Desktop, Steam, streaming
  services), in Home Assistant, Frigate or go2rtc, or in the desktop environment. Report those to their
  maintainers.
- Nod.ie itself has its own repository and policy; please report Nod.ie issues there.
- Issues that need physical access to an unlocked PC, root on the machine, or malware already running as the
  same user. Sofa runs as the desktop user and does not defend against that user's own processes.
- Anyone in the room with the remote being able to use the TV. That's the intended design.
- Social engineering, spam, or denial of service through volume.
- Findings from automated scanners without a demonstrated, realistic impact.

## What to expect

- We aim to **acknowledge your report within a few days**.
- We will investigate, keep you updated, and tell you whether we consider it a vulnerability.
- We follow **coordinated disclosure**: please give us reasonable time to ship a fix before you disclose
  publicly. We will agree a disclosure timeline with you, and credit you in the advisory and release notes if
  you wish.
- This is a small, volunteer-run project and we cannot offer a bug bounty.

## How Sofa protects itself

- **Sandboxed renderer:** context isolation, no Node.js in the renderer, a strict Content Security Policy,
  and navigation and pop-ups blocked. Only bundled local files are rendered.
- **Hardened binary:** Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and the inspector, and
  require loading the app from its integrity-checked archive. The packaged app refuses `--no-sandbox`, and
  `sofa-launcher --self-check` confirms the OS sandbox is active.
- **No shell:** every process is spawned with an argument array, after validation.
- **Secrets stay out of the renderer:** the Home Assistant token lives in the OS keyring and is only used by
  the main process, never placed in URLs, IPC payloads or logs.
- **Root-owned install:** the `.deb` installs to `/opt/sofa-launcher` with an AppArmor profile for that path
  only. `install-system.sh` verifies the package's SHA256 on a root-owned copy before installing.
