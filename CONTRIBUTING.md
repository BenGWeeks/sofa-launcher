# Contributing to Sofa Launcher

Thanks for helping make Sofa Launcher better! Sofa Launcher is a full-screen, Smart-TV-style launcher for a
Linux living-room PC, driven entirely by a TV remote. Bug reports, ideas, docs and code are all welcome.

**Found a security problem?** Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Write everything as if it were public

**This repository is public.** Anything you commit, including old commits, branches, issues, PR descriptions
and screenshots, can be read by anyone and stays in the history.

- **Never commit secrets.** That means no passwords, API keys, Home Assistant long-lived tokens, Proton Pass
  items, SSH keys, Wi-Fi details, streaming-service logins, camera passwords, `.env` files, or anything
  copied from a browser profile. Secrets belong in the OS keyring or a local config file outside the repo,
  never in source, tests, fixtures, docs or CI logs.
- **Use placeholders for anything personal or site-specific.** Prefer `example.com`, `192.0.2.10` (a
  documentation address), `my-home-server` and `front_door` over real domains, IP addresses, hostnames,
  usernames, camera names or family members' names. Real values go in your local
  `~/.config/sofa-launcher/config.toml`, not in the repo.
- **Check screenshots and recordings before committing.** Use demo mode (`npm run screenshot` uses demo
  data). Real screenshots can leak tile names, camera views, notifications, email addresses or account names.
- **If a secret is ever committed, treat it as leaked**, even if you delete it in a later commit, because it
  stays in the history. Rotate or revoke it first, then tell the maintainer privately (see
  [SECURITY.md](SECURITY.md)).
- **Keep third-party assets licence-clean.** Service logos and artwork must be ones we're allowed to
  redistribute, with their source noted. If in doubt, leave them out and use a neutral tile.

## Ways to contribute

- **Report a bug or suggest a feature** by opening an issue. Search existing issues first. Include your
  distro, desktop (X11/Wayland, KDE/GNOME), Sofa version (shown bottom-right on the home screen) and, for
  remote problems, what the **Button test** screen shows. Never paste tokens or config secrets.
- **Pick up an issue.** Comment on it first so work isn't duplicated.
- **Improve the docs** in [`docs/`](docs/) or the [README](README.md).

## Development setup

You need Node.js 24 and npm, on a Linux X11 desktop for full testing (Sofa uses X11 window management).

```sh
git clone https://github.com/BenGWeeks/sofa-launcher.git
cd sofa-launcher
npm ci
npm run dev          # windowed, hot reload; --no-sandbox is used in dev only
```

Settings live in `~/.config/sofa-launcher/config.toml`, created on first run. While it runs, Sofa claims the
remote's global Ctrl+Alt+Shift+letter keys on your desktop, so stop it when you're done.

## Checks that must pass

CI runs these on every pull request. Run them locally before you push:

```sh
npm run check        # TypeScript + svelte-check (zero warnings) + Vitest unit tests
npm run build        # production build
```

For UI changes, also regenerate the screenshots with demo data and look at them:

```sh
XDG_CONFIG_HOME=/tmp/sofa-demo-cfg npm run screenshot
```

## Code conventions

- **TypeScript strict mode**, Svelte 5 runes, and no new runtime dependencies without discussion.
- **Security first.** The renderer is sandboxed and context-isolated, with a strict CSP. Expose only typed,
  validated IPC through the preload, and check the sender in every handler. Spawn processes with argument
  arrays only, never a shell string. Validate everything from config before it reaches `spawn`, a URL or the
  X server.
- **Remote-only UX.** Every feature must be fully usable with arrows, OK, Back, Home and Menu. Add new
  buttons to the shared button map (`src/shared/buttons.ts`) so the remote guide, the button test and the
  hint bars stay in step.
- **10-foot UI.** Size things in `rem` (1rem = 1% of screen width), keep text readable from the sofa, and
  give every focusable element a clear focus state in the theme accent colour.
- **No site-specific values in code.** Hostnames, URLs, paths, camera names and app commands belong in config
  or the catalogue's defaults, never hard-coded.

## Testing

- **Unit tests** use Vitest, in `tests/`. Add tests for every behaviour change, especially decision logic
  (navigation, launching, screen-in-screen, key forwarding) and input validation.
- **Demo mode** must never read real data or launch real apps. Screenshots must use demo data only.
- **On a real TV**, run through [`docs/TV_ACCEPTANCE.adoc`](docs/TV_ACCEPTANCE.adoc) for changes to remote
  handling, window management or app launching. Note what you could and couldn't verify in the PR.

## Pull requests

1. Branch from `main`, and keep each PR **small and focused** on one change.
2. Use a [Conventional Commits](https://www.conventionalcommits.org/) style title in the imperative, e.g.
   `fix(back): wait for key release before sending keys to apps`.
3. Describe **what changed, why, and how you verified it**, including what you couldn't test (e.g. "not tried
   on a physical remote").
4. **Include before/after screenshots for any UI change**, taken in demo mode.
5. Make sure the checks above pass, then address review comments until no threads are unresolved.

## Documentation

Design and operational notes live in [`docs/`](docs/): the remote's key map ([`keymap.md`](docs/keymap.md)),
cameras ([`CAMERAS.adoc`](docs/CAMERAS.adoc)), screen-in-screen ([`SCREEN_IN_SCREEN.adoc`](docs/SCREEN_IN_SCREEN.adoc)),
brand guidelines ([`BRAND_GUIDELINES.adoc`](docs/BRAND_GUIDELINES.adoc)) and known problems
([`TROUBLESHOOTING.adoc`](docs/TROUBLESHOOTING.adoc)). If you hit and solve a problem, please add it to the
troubleshooting guide.
