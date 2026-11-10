# Spike S1: Electron sandbox on Ubuntu 24.04

Run on **a development PC**: Ubuntu 24.04.5, KDE/X11, the same OS as the TV PC.
`kernel.apparmor_restrict_unprivileged_userns = 1`. Electron 45.2.3.

```
npm install
node_modules/electron/dist/electron .                          # A0: default
node_modules/electron/dist/electron . --disable-setuid-sandbox # A1: userns sandbox only
node_modules/electron/dist/electron . --no-sandbox             # B:  no OS sandbox
```

## Results

| Run | Result |
|---|---|
| A0: default (as installed by npm or a tarball, no root) | **FATAL, aborts on start** (even `electron --version`): `chrome-sandbox` must be owned by root with mode 4755 |
| A1: `--disable-setuid-sandbox` | **FATAL**: "No usable sandbox!" (AppArmor blocks unprivileged user namespaces) |
| B: `--no-sandbox` | Runs, but **no OS sandbox**: renderer `Seccomp: 0`, same user namespace as the main process → `osSandboxed: false` |

How it's measured: `process.sandboxed` (`jsSandboxed`) only reflects
Electron's JS-level renderer sandbox and is `true` even with `--no-sandbox`.
`app.getAppMetrics().sandboxed` is macOS/Windows only. So the spike reads the
renderer's `/proc/<pid>/status` and `/proc/<pid>/ns/user`. A sandboxed
renderer shows `Seccomp: 2`, `NoNewPrivs: 1`, and (under the namespace
sandbox) its own user namespace.

**Conclusion:** a user-level install of Electron on the TV PC cannot start
with the OS sandbox without a root step. That confirms R1. Why: Ubuntu
24.04's fallback `unprivileged_userns` AppArmor profile lets unconfined
processes create a user namespace but strips all capabilities inside it, so
Chromium's namespace sandbox fails, and the setuid helper isn't setuid.

## Options considered

| Option | Root step | Updates | Security |
|---|---|---|---|
| 1. AppArmor profile (`flags=(unconfined)` + `userns`, as Ubuntu ships for Edge/VS Code) on `/home/tvuser/.local/share/sofa-launcher/*/sofa-launcher` | Once | User-level | `flags=(unconfined)` confines nothing; it only re-grants full userns, to **anything the TV user drops at a user-writable path**. AppArmor can't condition attachment on file ownership. |
| **2. Root-owned `/opt/sofa-launcher` (.deb), installed by an administrator** | Once + every update | an administrator, from a pinned, checksum-verified release | Path isn't writable by the TV user. Sandbox via the standard setuid `chrome-sandbox` (root:root 4755) or the same msedge-style profile on the `/opt` path. |
| 3. setuid `chrome-sandbox` in the user-level install | Every update | an administrator per release | Setuid-root helper inside a directory owned by the TV user. |
| 4. `--no-sandbox` | None | User-level | No OS sandbox (measured above). Never. |

## Decision (2026-11-08): **Option 2**

The TV user is unprivileged; user-writable paths must not receive additional sandbox permissions.

- Packaging: electron-builder **`.deb`**, installing to `/opt/sofa-launcher`.
  Its postinst sets `chrome-sandbox` to root:root 4755; check in M1 whether
  it also installs an AppArmor profile on 24.04.
- Install/update: an administrator runs a reviewed script that downloads a **pinned
  release tag**, verifies its SHA256, and runs `apt install ./sofa-launcher_<ver>_amd64.deb`.
- User config stays in `~/.config/sofa-launcher` (the TV user, no root).
- On a development PC: `npm run dev` passes `--no-sandbox`. That's
  dev-only and never in the package; the packaged app never adds it.

**Acceptance check after install** (expected success, run as the TV user): this
spike's measurement, built into the launcher's About screen / `sofa-launcher
--self-check`, must report `osSandboxed: true`, i.e. renderer `Seccomp: 2` and
`NoNewPrivs: 1`. If it reports `false`, or the app aborts, the install is
wrong. Don't fall back to `--no-sandbox`.
