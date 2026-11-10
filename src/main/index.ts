import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, screen, session, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AboutInfo, ActionContext, ActionEvent, GlobalAction, HomeItem, HomeItems, PanelState, TileState } from '@shared/types';
import { AppManager, isExecutable } from './apps';
import { AppAudio, type AudioAction } from './app-audio';
import { CameraInputs } from './camera-inputs';
import { ContainerStatusSource, NOT_CONFIGURED } from './containers-status';
import { demoStatusReader, withDemoDocker } from './containers-demo';
import { verifyContainersView } from './containers-check';
import { discoverBrowsers, resolveBrowser, browserTile, type BrowserDiscovery } from './browsers';
import { profileDir, usesBrowserExtension } from './argv';
import { prepareRemoteProfile } from './browser-profile';
import { backKeyFor, backToWebApp } from './back';
import { sendKeysToApp } from './app-keys';
import { homeRequestWatcher } from './home-request';
import { coverToastGate, launchCover, launchCoverTimeout, requiresFullscreen } from './launch-cover';
import { prepareLaunchCover } from './launch-cover-window';
import { parseOpenCommand, searchUrl, validateOpenCommand, type OpenCommand, type ParsedCommand } from './command';
import { ConfigError, parseConfig, SEED_CONFIG, type Config, type ResolvedApp } from './config';
import { validateBackground, validateTheme, validateBrowser, writeBackground, writeTheme, writeBrowser } from './config-writer';
import { Debouncer } from './debounce';
import { DEMO_STEAM_GAMES, demoArtBitmap, demoCameraHasStill, demoCameraStillBitmap, isDemoMode, screenshotConfig, steamGamesRow } from './demo';
import { CameraStills } from './camera-stills';
import { detectRoblox } from './sober';
import { findSteamGames, steamBinary, steamGameApps } from './steam';
import { chooseGameArt, GameArtFetcher } from './game-art';
import { homeCandidates, resolveHome, type HomeCandidate } from './home-items';
import { HOME_FILE, NO_CHOICES, isHomeId, isShown, readHomeVisibility, withChoice, writeHomeChoice, type HomeVisibility } from './home-visibility';
import { DEFAULT_BACKGROUND } from '@shared/backgrounds';
import { FakeMediaController, GdbusMediaController, type MediaController } from './mpris';
import { contextFor, decideMenu } from './panel-logic';
import { logOff } from './power';
import { RemotePointer } from './pointer';
import { PipManager } from './pip';
import { pinCamera } from './pinned-camera';
import { X11PipWindows } from './x11-pip';
import { WindowHandoff, waitForWindowPaint } from './window-handoff';
import { sandboxReport } from './selfcheck';
import { typeText, transcribe } from './text-input';
import { setupUser } from './usersetup-io';
import { DesktopMediaKeys } from './media-keys';
import type { TransportCommand } from './mpris';
import { Watchdog } from './watchdog';
import { FakeWindowManager, XdotoolWindowManager, type WindowManager } from './windows';

// ---- flags -----------------------------------------------------------------
const argv = process.argv.slice(1);
const flag = (name: string) => argv.includes(`--${name}`);
const flagValue = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const DEV = flag('dev');
const SCREENSHOT = flagValue('screenshot');
/**
 * Demo mode (--demo, --screenshot or any --demo-* flag): fake window manager, no global key
 * grabs, demo config and stand-in games only, and nothing is ever launched (safe on a workstation).
 */
const DEMO = isDemoMode(argv);
const SELF_CHECK = flag('self-check');
const DEMO_SCREEN = flagValue('demo-screen');
/** `sofa-launcher open <app> [--search ...]` on our own command line (parsed here, in this process). */
const OWN_COMMAND: ParsedCommand = parseOpenCommand(process.argv);

// ---- paths (XDG; no spaces) ------------------------------------------------
const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sofa-launcher');
const dataDir = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'sofa-launcher');
const configPath = join(configDir, 'config.toml');
/** Edit home screen's choices (launcher-managed; config.toml is never rewritten for them). */
const homePath = join(configDir, HOME_FILE);
const rendererHtml = join(__dirname, '../renderer/index.html');
const rendererFileUrl = pathToFileURL(rendererHtml).href;
app.setName('sofa-launcher');
app.setPath('userData', join(dataDir, 'electron'));

// ---- state -----------------------------------------------------------------
let win: BrowserWindow | null = null;
let panelWin: BrowserWindow | null = null;
let toastWin: BrowserWindow | null = null;
let launchCoverWin: BrowserWindow | null = null;
let toastReady = false;
const pendingToasts: string[] = [];
let toastTimer: NodeJS.Timeout | undefined;
let quitting = false;
let reloadTimer: NodeJS.Timeout | undefined;
let config: Config = parseConfig('');
let browsers: BrowserDiscovery = { installed: [], defaultBrowser: null };
const browserFor = (a: ResolvedApp) => resolveBrowser(browsers, config.ui.browser, a.browser);
let configError: string | null = null;
/** The X11 window the panel / guide was opened over, to re-activate on dismiss. */
let panelReturnTo: string | null = null;
let panelShownAt = 0;
const windowHandoff = new WindowHandoff();
let guideReturnTo: string | null = null;
let buttonTesting = false;
let keyboardTarget: string | null = null;
let keyboardMicAllowed = false;
let lastStates: TileState[] = [];
let pipStartGeneration = 0;
let cameraInputs: CameraInputs | null = null;
let cameraOrigin: string | null = null;
/** The Docker tile's status file ([containers]); null when not set up. */
let containerSource: ContainerStatusSource | null = null;
/** Screenshots: --demo-screen=containers (the view) or --demo-docker (the tile on Home). */
const DEMO_DOCKER = DEMO_SCREEN === 'containers' || flag('demo-docker');
/** Detected games of this login: Roblox (Sober) and installed Steam games (the Games row, after configured games). */
let detectedGames: ResolvedApp[] = [];
let gamesScannedAt = 0;
const gameArtCache = new Map<string, { key: string; value: string | null }>();
/** Shown/hidden choices from home.json, and everything Edit home screen can list. */
let homeChoices: HomeVisibility = NO_CHOICES;
let homeList: HomeCandidate[] = [];
/** Steam's official header art ([games] fetchArt), preferred over the local cache. Never used in demo mode. */
const artFetcher = new GameArtFetcher({ dir: join(dataDir, 'game-art'), enabled: () => config.games.fetchArt && !DEMO });
/**
 * Latest stills on the home screen's camera tiles, refreshed about once a minute while Home is in
 * front (see syncCameraStills). Nothing is requested without a connected Home Assistant; demo
 * mode draws placeholders and never contacts a server.
 */
const cameraStills = new CameraStills({
  ids: () => DEMO
    ? config.apps.filter((a) => a.type === 'camera' && a.entity !== 'all' && demoCameraHasStill(a.id)).map((a) => a.id)
    : cameraInputs?.stillIds() ?? [],
  fetchStill: (id) => DEMO ? Promise.resolve(demoCameraStill(id)) : cameraInputs ? cameraInputs.tileStill(id) : Promise.resolve(null),
  onChange: (appId, value) => { if (win && !win.isDestroyed()) win.webContents.send('camera-still', { appId, value }); },
  log: (message) => console.log(message),
});
/** The camera definitions the stills were fetched for; a change starts them afresh. */
let cameraStillsKey = '';

const wm: WindowManager = DEMO ? demoWindowManager() : new XdotoolWindowManager();
const media: MediaController = DEMO ? new FakeMediaController() : new GdbusMediaController(wm);
const mediaKeys = new DesktopMediaKeys(join(dataDir, 'media-shortcuts.json'), {
  register: (key, callback) => globalShortcut.register(key, callback),
  unregister: key => globalShortcut.unregister(key),
});
let lastTransport = 0;
const remoteExtensionPath = app.isPackaged ? join(process.resourcesPath, 'browser-remote') : join(__dirname, '../../resources/browser-remote');
const watchdog = new Watchdog({
  wm,
  launcherInFront: () => launcherInFront(),
  onGone: (id, seen) => void appGone(id, seen),
});
const apps = new AppManager([], wm, {
  dataDir,
  browserExtensionPath: remoteExtensionPath,
  browserFor,
  prepareWebApp: (a, browser) => { if (usesBrowserExtension(a) && !DEMO) prepareRemoteProfile(profileDir(a.id, dataDir, browser.id), remoteExtensionPath); },
  managed: {
    open: a => { if (!cameraInputs) return Promise.reject(new Error('Camera inputs are unavailable')); return cameraInputs.open(a.id); },
    close: async a => cameraInputs?.close(a.id) ?? false,
    pause: async a => { if (!(pip.pinned && pip.state.insetId === a.id)) cameraInputs?.pause(a.id); },
  },
  media,
  onToast: toast,
  onStateChanged: () => void pushApps(),
  onOpened: (a, spawned) => watchdog.track(a.id, a.wmClass, !spawned),
  onClosed: (a) => watchdog.untrack(a.id),
  containers: { ready: () => !!containerSource, status: () => containerTileStatus() },
  ...(DEMO ? { demo: true, isExecutable: (f: string) => !f.includes('nodie'), flatpakInstalled: async () => true } : {}),
});
const debouncer = new Debouncer(400);
const pointer = new RemotePointer({
  register: (key, callback) => globalShortcut.register(key, callback),
  unregister: (key) => globalShortcut.unregister(key),
  activeWindow: () => wm.activeWindow(),
  command: (args) => new Promise<void>((resolve, reject) => {
    execFile('xdotool', args, { timeout: 2000 }, (error) => error ? reject(error) : resolve());
  }),
});
const audio = new AppAudio();
const volumeKeys: string[] = [];
let volumeAttempted = false;
const x11Pip = new X11PipWindows(wm);
const pip = new PipManager(Object.assign(x11Pip, {
  pin: async (window: import('./pip').PipWindow, bounds: import('./pip').Bounds) => {
    if (!cameraInputs) throw new Error('Camera viewer closed');
    await pinCamera(cameraInputs, x11Pip, screen, window, bounds);
  },
  raise: async (window: import('./pip').PipWindow) => {
    cameraInputs?.raise(window.appId);
    await x11Pip.keepAbove(window.windowId);
  },
  closePinned: async (window: import('./pip').PipWindow) => { cameraInputs?.close(window.appId); },
}), (state) => { send('pip', state); syncPipVolume(state); }, toast);
function syncPipVolume(state: import('@shared/types').PipState): void {
  if (!state.active) {
    for (const key of volumeKeys.splice(0)) globalShortcut.unregister(key);
    volumeAttempted = false;
  } else if (!volumeAttempted && !DEMO) {
    volumeAttempted = true;
    for (const [key, action] of [['VolumeUp', 'up'], ['VolumeDown', 'down'], ['VolumeMute', 'mute']] as const) {
      if (globalShortcut.register(key, () => {
        const state = pip.state;
        void controlPipAudio(state.focused ?? 'base', action).then(result => {
          const target = apps.get(state.focused === 'inset' ? state.insetId! : state.baseId!);
          toast(result.available ? `${target?.name}: ${result.muted ? 'muted' : `${result.volume}%`}` : 'This app has no audio stream yet');
        }).catch(() => toast('App audio control unavailable'));
      })) volumeKeys.push(key);
    }
    if (volumeKeys.length !== 3) {
      for (const key of volumeKeys.splice(0)) globalShortcut.unregister(key);
      toast('Desktop owns the volume keys. Use Screen-in-screen → app audio for separate volume and mute.');
    }
  }
}

async function controlPipAudio(which: 'base' | 'inset', action: AudioAction) {
  const state = pip.state;
  const revision = pip.revision;
  if (!state.active) throw new Error('Screen-in-screen is not active');
  const id = which === 'base' ? state.baseId! : state.insetId!;
  if (!id) throw new Error('Main app closed; open an app to control it');
  const target = apps.get(id)!;
  // Camera renderers share Sofa's PID: OS process matching would affect other apps.
  if (target.type === 'camera') {
    if (!cameraInputs) throw new Error('Camera viewer closed');
    return cameraInputs.audio(id, action);
  }
  const windows = await wm.findByClass(target.wmClass);
  const pid = windows.length ? await wm.pidOf(windows.at(-1)!) : null;
  if (!pid) throw new Error('App window closed');
  return audio.control(pid, target.flatpak, action, () => pip.state.active && pip.revision === revision);
}

function demoWindowManager(): WindowManager {
  const fake = new FakeWindowManager();
  for (const c of ['jellyfin-desktop', 'sofa-netflix', 'sofa-youtube', 'sofa-homeassistant']) fake.windows.set(c, ['1']);
  return fake;
}

async function loadConfig(): Promise<void> {
  browsers = await discoverBrowsers({ demo: DEMO });
  // Demo captures must not depend on (or read) the workstation's config, Steam library or apps.
  if (DEMO) {
    config = screenshotConfig(validateTheme(flagValue('demo-theme') ?? 'knowall'), flagValue('demo-cameras') ? Number(flagValue('demo-cameras')) || 0 : DEMO_SCREEN === 'camera-home' || DEMO_SCREEN === 'edit-home', validateBackground(flagValue('demo-background') ?? DEFAULT_BACKGROUND), flag('demo-games'));
    if (DEMO_DOCKER) config = withDemoDocker(config);
    configureContainers();
    scanGames(); // stand-ins only
    return;
  }
  try {
    if (!existsSync(configPath)) {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, SEED_CONFIG, { mode: 0o600, flag: 'wx' });
    }
    config = parseConfig(readFileSync(configPath, 'utf8'));
    configError = null;
    homeChoices = readHomeVisibility(homePath);
  } catch (e) {
    configError = e instanceof ConfigError ? e.message : `Couldn't read ${configPath}: ${(e as Error).message}`;
    console.error(configError);
  }
  scanGames();
  configureCameras();
  configureContainers();
  for (const w of [win, panelWin, toastWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('appearance', appearance());
  }
}

/**
 * Re-detect games: Sober (Roblox) and the user's Steam library (on config load, and when Home
 * is shown at most every 30 s, so a game installed while Sofa runs appears). Demo: stand-ins only.
 */
function scanGames(): void {
  gamesScannedAt = Date.now();
  detectedGames = steamGamesRow({ on: DEMO, games: flag('demo-games') }, () => {
    // Every detected game is listed (Edit home screen); [games] only decides which are shown by default.
    const roblox = detectRoblox(config, { home: homedir() });
    try {
      const ids = new Set(config.apps.map((a) => a.id));
      const steam = steamBinary((file) => isExecutable(file));
      return [...roblox, ...(steam ? steamGameApps(findSteamGames({ home: homedir() }), steam).filter((a) => !ids.has(a.id)) : [])];
    } catch (e) {
      console.error(`Couldn't read Steam games: ${(e as Error).message}`);
      return roblox;
    }
  });
  applyHome();
}

/** Apply config.toml, the detected games and home.json's choices to what the launcher lists and opens. */
function applyHome(): void {
  homeList = homeCandidates(config, detectedGames).map((c) => ({ ...c, app: browserTile(c.app, browserFor(c.app)) }));
  const { visible, launchable } = resolveHome(homeList, homeChoices);
  apps.setApps(launchable, visible);
}

/** Everything Edit home screen lists, with whether it is shown and whether it can be. */
async function homeItems(): Promise<HomeItems> {
  const list = homeList;
  const tiles = await apps.tiles(list.map((c) => c.app));
  const items = tiles.map((tile, i): HomeItem => {
    const c = list[i]!;
    // The Docker tile is "installed" once [containers] names its status file.
    const unavailable = c.needsSetup || (tile.type === 'containers' && !tile.installed) ? 'needs-setup' : tile.installed ? undefined : 'not-installed';
    return { ...tile, section: c.section, shown: !c.needsSetup && isShown(homeChoices, c.app.id, c.defaultShown), ...(unavailable ? { unavailable } : {}) };
  });
  const notes: HomeItems['notes'] = {};
  if (!items.some((i) => i.section === 'games')) notes.games = 'No games found. Installed Steam games and Roblox (the Sober Flatpak) appear here, and games added to config.toml.';
  if (!items.some((i) => i.section === 'cameras')) {
    notes.cameras = config.homeAssistantUrl
      ? 'No cameras set up. Add [[cameras]] to config.toml to show Home Assistant cameras.'
      : 'No cameras: connect Home Assistant and add [[cameras]] in config.toml.';
  }
  return { items, notes };
}

async function setHomeItem(id: unknown, shown: unknown): Promise<{ ok: boolean; message?: string; items: HomeItems }> {
  if (!isHomeId(id) || typeof shown !== 'boolean') throw new Error('Invalid home screen item');
  const item = homeList.find((c) => c.app.id === id);
  if (!item) throw new Error('Unknown home screen item');
  if (shown && item.needsSetup) return { ok: false, message: `${item.app.name} needs a URL in config.toml first`, items: await homeItems() };
  if (shown && !(await apps.tiles([item.app]))[0]?.installed) return { ok: false, message: `${item.app.name} isn’t installed`, items: await homeItems() };
  if (DEMO) {
    homeChoices = withChoice(homeChoices, id, shown, item.defaultShown); // demo mode never writes files
  } else {
    mkdirSync(configDir, { recursive: true });
    homeChoices = writeHomeChoice(homePath, id, shown, item.defaultShown);
  }
  applyHome();
  await pushApps();
  return { ok: true, items: await homeItems() };
}

/** A game's artwork, resized to a small JPEG data URL (cached until the file changes). */
function gameArt(appId: string): string | null {
  const game = apps.get(appId);
  if (!game || game.group !== 'games') return null;
  const demo = DEMO ? DEMO_STEAM_GAMES.find((g) => `steam-${g.appId}` === appId) : undefined;
  if (demo) {
    if (demo.hue === undefined) return null;
    const cached = gameArtCache.get(appId);
    if (cached) return cached.value;
    const image = nativeImage.createFromBitmap(demoArtBitmap(demo.hue), { width: 460, height: 215 });
    const value = `data:image/jpeg;base64,${image.toJPEG(82).toString('base64')}`;
    gameArtCache.set(appId, { key: 'demo', value });
    return value;
  }
  const steamId = /^steam-(\d{1,10})$/.exec(appId)?.[1];
  const choice = chooseGameArt({
    local: game.art,
    downloaded: steamId && !DEMO ? artFetcher.cached(steamId) : undefined,
    fetchEnabled: !!steamId && config.games.fetchArt && !DEMO,
  });
  if (choice.fetch && steamId) {
    // The official header replaces Steam's local copy (or the name) once it arrives.
    void artFetcher.fetch(steamId).then((saved) => {
      if (!saved) return;
      const value = gameArt(appId);
      if (value) send('game-art', { appId, value });
    });
  }
  // The chosen picture, else the other one (a damaged download must not hide Steam's own copy).
  for (const file of new Set([choice.file, game.art])) {
    const value = file ? artDataUrl(file) : null;
    if (value) return value;
  }
  return null;
}

/** A picture file as a small JPEG data URL, or null if it can't be read (cached until the file changes). */
function artDataUrl(file: string): string | null {
  let key: string;
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 20_000_000) return null;
    key = `${file}:${stat.mtimeMs}:${stat.size}`;
  } catch { return null; }
  const cached = gameArtCache.get(file);
  if (cached?.key === key) return cached.value;
  const image = nativeImage.createFromPath(file);
  const value = image.isEmpty() ? null : `data:image/jpeg;base64,${image.resize({ width: 460, quality: 'good' }).toJPEG(80).toString('base64')}`;
  gameArtCache.set(file, { key, value });
  return value;
}

/** A demo camera's placeholder still (data URL), or null for the demo cameras shown without one. */
const demoStills = new Map<string, string | null>();
function demoCameraStill(appId: string): string | null {
  if (!DEMO) return null;
  if (!demoStills.has(appId)) {
    const index = Number(/^camera-demo-(\d{1,2})$/.exec(appId)?.[1] ?? NaN);
    const image = demoCameraHasStill(appId) ? nativeImage.createFromBitmap(demoCameraStillBitmap(index), { width: 480, height: 270 }) : null;
    demoStills.set(appId, image ? `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}` : null);
  }
  return demoStills.get(appId) ?? null;
}

/** Stills only while Home is in front (demo: while its window is shown); stops when hidden. */
function syncCameraStills(): void {
  cameraStills.setActive(DEMO ? !!win && !win.isDestroyed() && win.isVisible() : launcherInFront());
}

function configureCameras(): void {
  configureCameraInputs();
  // After cameraInputs reflects the new config, so the fresh round asks the new cameras and origin.
  const stillsKey = JSON.stringify([config.homeAssistantUrl ?? null, config.apps.filter((a) => a.type === 'camera').map((a) => [a.id, a.entity])]);
  if (stillsKey !== cameraStillsKey) { cameraStillsKey = stillsKey; cameraStills.reset(); }
}

function configureCameraInputs(): void {
  if (DEMO) return;
  const definitions = config.apps.filter(a => a.type === 'camera').map(a => ({id:a.id,name:a.name,entity:a.entity!,wmClass:a.wmClass}));
  const origin = config.homeAssistantUrl ? new URL(config.homeAssistantUrl).origin : null;
  if (!origin || !definitions.length) { cameraInputs?.dispose(); cameraInputs = null; cameraOrigin = null; return; }
  if (!cameraInputs || cameraOrigin !== origin) {
    cameraInputs?.dispose();
    cameraInputs = new CameraInputs({
      origin, credentialPath:join(dataDir,'camera-connection.json'), rendererHtml,
      preloadPath:join(__dirname,'../preload/camera.js'),
      ...(process.env.ELECTRON_RENDERER_URL && DEV ? {rendererUrl:process.env.ELECTRON_RENDERER_URL} : {}),
      setClass:(id,wmClass) => wm.setClass(id,wmClass),
    });
    cameraOrigin = origin;
  }
  cameraInputs.setInputs(definitions);
}

// ---- Docker containers view ------------------------------------------------
function configureContainers(): void {
  const file = config.containersFile;
  if (!file) { containerSource = null; return; }
  if (DEMO) {
    const mode = flag('demo-containers-error') ? 'error' : 'ok';
    containerSource = new ContainerStatusSource({ path: file, reader: demoStatusReader(mode) });
    if (mode === 'error') void containerSource.refresh(); // the last good read, before the file "goes missing"
    return;
  }
  if (containerSource?.path === file) return;
  containerSource = new ContainerStatusSource({ path: file });
}

/** The Docker tile's dot. While Home is in front, re-read the file at most once a minute. */
function containerTileStatus(): TileState['status'] {
  if (!containerSource) return undefined;
  if (launcherInFront() && containerSource.age > 60_000) {
    void containerSource.refresh(60_000).then(() => pushApps()).catch(() => undefined);
  }
  return containerSource.summary();
}

/** The Docker tile opens the launcher's own containers screen (in the home window). */
async function openContainers(id: string): Promise<{ ok: boolean; message?: string }> {
  const target = apps.get(id)!;
  if (!containerSource) return { ok: false, message: `${target.name} isn’t set up: add a [containers] status file to config.toml` };
  await showHome();
  if (win && !win.isDestroyed()) win.webContents.send('containers:show');
  return { ok: true };
}

function appearance() {
  return { theme: config.ui.theme, background: config.ui.background, version: app.getVersion(), hostname: DEMO ? 'living-room' : hostname() };
}

// ---- windows ---------------------------------------------------------------
function webPreferences(preload: string, extra: Electron.WebPreferences = {}): Electron.WebPreferences {
  return {
    preload: join(__dirname, `../preload/${preload}.js`),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    ...extra,
  };
}

function lockDown(w: BrowserWindow): void {
  // The launcher only ever shows its own bundled UI.
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function load(w: BrowserWindow, hash: string): void {
  if (process.env.ELECTRON_RENDERER_URL && DEV && !app.isPackaged) {
    void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`);
  } else {
    void w.loadFile(rendererHtml, { hash });
  }
}

/** The app icon for the window (task switcher, taskbar). Packaged: resources/icon.png; dev: build/icons. */
function appIcon(): Electron.NativeImage | undefined {
  const file = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icons', '256x256.png');
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}

function createWindow(opts: { show: boolean; hash?: string }): BrowserWindow {
  const w = new BrowserWindow({
    icon: appIcon(),
    width: 1280,
    height: 720,
    show: false,
    fullscreen: !DEV && !SELF_CHECK,
    frame: DEV,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: 'Sofa Launcher',
    webPreferences: webPreferences('index'),
  });
  lockDown(w);
  if (opts.show) w.once('ready-to-show', () => w.show());
  // Stay resident: closing (Alt+F4, KWin) only hides, so Home can bring it back.
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  w.on('closed', () => {
    if (win === w) win = null;
    // A native teardown may leave hidden overlays alive. The main window can
    // only be destroyed on exit; ordinary desktop Close is intercepted above.
    if (!quitting) app.quit();
  });
  w.on('focus', () => {
    if (Date.now() - gamesScannedAt > 30_000) scanGames();
    void pushApps();
    syncCameraStills();
  });
  // Hidden means "not on screen": leave any sub-screen (and release the button test's key grab).
  w.on('hide', () => {
    guideReturnTo = null;
    leaveButtonTest();
    sendAction({ action: 'home', context: 'home' });
  });
  // The button test only makes sense while this window has the keyboard. If anything else
  // comes to the front, or the renderer dies / reloads, the remote must work again at once.
  w.on('blur', () => { leaveButtonTest(); syncCameraStills(); });
  w.webContents.on('render-process-gone', () => leaveButtonTest());
  w.webContents.on('did-start-loading', () => leaveButtonTest());
  load(w, opts.hash ?? 'home');
  return w;
}

/** A frameless, transparent, always-on-top window for the panel or the toasts. */
function createOverlay(kind: 'panel' | 'toast'): BrowserWindow {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  const bounds =
    kind === 'panel'
      ? { x, y, width, height }
      : { x, y, width, height: Math.round(height / 4) };
  const w = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    fullscreen: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: kind === 'panel',
    title: kind === 'panel' ? 'Sofa Panel' : 'Sofa Toast',
    // The toast window gets a preload that exposes only onToast. Neither window is ever
    // "in the background" from the user's point of view: keep their timers/animations running.
    webPreferences: webPreferences(kind === 'toast' ? 'toast' : 'index', { backgroundThrottling: false }),
  });
  lockDown(w);
  // M2: plain "keep above". The KWin OSD-layer rule (above fullscreen video) arrives with the camera overlay.
  w.setAlwaysOnTop(true, 'screen-saver');
  if (kind === 'toast') w.setIgnoreMouseEvents(true);
  if (kind === 'panel') w.on('blur', () => {
    if (!keyboardTarget) return;
    keyboardTarget = null;
    keyboardMicAllowed = false;
    w.webContents.send('keyboard', false);
  });
  // Own WM_CLASS so KWin rules can target it without ever matching on title.
  void wm.setClass(xWindowId(w), `sofa-${kind}`).then(() => kind === 'panel' ? wm.setType?.(xWindowId(w), 'utility') : undefined).catch(() => undefined);
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  load(w, kind);
  return w;
}

function xWindowId(w: BrowserWindow): string {
  return String(w.getNativeWindowHandle().readUInt32LE(0));
}

function setLaunchCover(above: boolean): void {
  send('launch-cover', above);
  if (!launchCoverWin || launchCoverWin.isDestroyed()) return;
  if (above) launchCoverWin.showInactive();
  else launchCoverWin.hide();
}

const coverToasts = coverToastGate(setLaunchCover, showToast);
const coverLaunch = launchCover({
  setAbove: coverToasts.setAbove,
  activeWindow: () => wm.activeWindow(),
  ownWindows: () => [win, panelWin, toastWin, launchCoverWin]
    .filter((w): w is BrowserWindow => !!w && !w.isDestroyed()).map(xWindowId),
  isFullscreen: (id) => wm.isFullscreen?.(id) ?? Promise.resolve(false),
});
/** Keep the desktop covered while launching, and preserve an independent camera inset. */
async function openApp(...args: Parameters<typeof apps.open>): ReturnType<typeof apps.open> {
  await pip.opening(args[0]);
  if (pip.pinned && pip.state.insetId === args[0]) return { ok: true, message: 'Already pinned' };
  const target = apps.get(args[0]);
  if (target?.type === 'containers') return openContainers(args[0]);
  const previous = pip.state;
  if (previous.active && !previous.pinned) args[1] = { ...args[1], pausePrevious: false };
  const result = await (launcherInFront() && !DEMO && target
    ? coverLaunch(() => apps.open(...args), () => wm.findByClass(target.wmClass), requiresFullscreen(target), launchCoverTimeout(target))
    : apps.open(...args));
  if (result.ok && pip.pinned && target) {
    const id = (await wm.findByClass(target.wmClass).catch(() => [])).at(-1);
    if (previous.baseId && previous.baseId !== target.id) void apps.pause(previous.baseId);
    if (id) await pip.opened({ appId: target.id, name: target.name, windowId: id });
  }
  return result;
}

function launcherInFront(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible() && win.isFocused();
}

function panelOpen(): boolean {
  return !!panelWin && !panelWin.isDestroyed() && panelWin.isVisible();
}

async function showHome(): Promise<void> {
  pointer.stop();
  apps.navigate();
  const target = win;
  if (!target || target.isDestroyed() || quitting) return;
  await windowHandoff.run(async () => {
    if (!DEV && !target.isFullScreen()) target.setFullScreen(true);
    if (!target.isVisible()) {
      const shown = new Promise<void>((resolve) => target.once('show', () => resolve()));
      target.show();
      await shown;
    }
    target.focus();
    if (!DEMO) await wm.activate(xWindowId(target));
  }, () => { coverLaunch.cancel(); if (panelOpen()) hidePanel(false); });
  await pip.home();
  void pushApps();
}

/** The home screen itself: show the window and leave any guide, menu or sub-screen. */
function windowTitle(windowId: string): Promise<string> {
  return new Promise<string>((resolve) => execFile('xdotool', ['getwindowname', windowId], { timeout: 1000 }, (_error, stdout) => resolve(stdout?.trim() ?? '')));
}
const watchHomeRequest = homeRequestWatcher({ title: windowTitle });

async function goHome(): Promise<void> {
  pipStartGeneration++;
  guideReturnTo = null;
  await showHome();
  sendAction({ action: 'home', context: 'home' });
}

function hideLauncher(): void {
  coverLaunch.cancel();
  win?.hide();
}

const send = (channel: string, payload: unknown) => {
  for (const w of [win, panelWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
};
const sendAction = (e: ActionEvent) => {
  if (win && !win.isDestroyed()) win.webContents.send('action', e);
};

let homeOverlayOpen = false;
function syncCameraOverlays(): void {
  cameraInputs?.suppressPinned(!!(homeOverlayOpen && win?.isVisible()) || panelOpen());
}

function toast(text: string): void { coverToasts.toast(text); }

function showToast(text: string): void {
  if (!toastWin || toastWin.isDestroyed()) return console.log(`toast: ${text}`);
  if (!toastReady) {
    pendingToasts.push(text); // the window is still loading (e.g. a config error at startup)
    return;
  }
  toastWin.webContents.send('toast', { text });
  toastWin.showInactive();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastWin?.hide(), 4000);
}

async function pushApps(): Promise<TileState[]> {
  lastStates = await apps.states();
  send('apps', lastStates);
  return lastStates;
}

// ---- slide-up panel --------------------------------------------------------
/** Show the panel over the app in front. Over anything else (a bare desktop) the full home screen is the right answer. */
async function openPanel(): Promise<void> {
  windowHandoff.cancel();
  apps.navigate();
  if (!panelWin || panelWin.isDestroyed()) return goHome();
  const active = await wm.activeWindow();
  const current = await apps.appForWindow(active); // one WM_CLASS read
  if (!current) return goHome();
  panelReturnTo = active;
  // Show first with what we already know; fresh running/installed states follow on the 'apps' channel.
  const state: PanelState = { apps: lastStates, currentAppId: current.id, pip: pip.state };
  panelWin.webContents.send('panel', state);
  resizePanel(false);
  // The app must stay in KWin's fullscreen layer while the panel has focus, or the
  // desktop taskbar is raised over it. A failure here costs only that polish.
  if (active) await panelTransientFor(active);
  panelWin.showInactive();
  await panelPainted();
  panelShownAt = Date.now();
  panelWin.focus();
  if (!DEMO) await wm.activate(xWindowId(panelWin)).catch(() => undefined);
  void pushApps();
}

function hidePanel(reactivate: boolean): void | Promise<void> {
  if (reactivate) {
    const back = panelReturnTo;
    if (!back) return goHome();
    return windowHandoff.run(async () => { await wm.activate(back); await panelPainted(); }, () => hidePanel(false)).catch(() => goHome());
  }
  windowHandoff.cancel();
  keyboardTarget = null;
  keyboardMicAllowed = false;
  panelWin?.webContents.send('keyboard', false);
  panelReturnTo = null;
  panelWin?.hide();
  resizePanel(false);
  // Never leave the hidden panel parented to an app window that may close.
  void panelTransientFor(null);
}

/** Serialised, so a clear from an earlier hide can never land after the next open's set. */
let panelTransientQueue: Promise<void> = Promise.resolve();
function panelTransientFor(parent: string | null): Promise<void> {
  panelTransientQueue = panelTransientQueue.then(async () => {
    if (!panelWin || panelWin.isDestroyed() || !wm.setTransientFor) return;
    await wm.setTransientFor(xWindowId(panelWin), parent).catch(() => undefined);
  });
  return panelTransientQueue;
}

async function panelPainted(): Promise<void> {
  if (!panelWin || panelWin.isDestroyed() || !panelWin.isVisible()) return;
  await waitForWindowPaint(() => panelWin!.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'));
}

async function focusPip(action: 'base' | 'inset' | 'browse' | 'shrink'): Promise<void> {
  if (pip.pinned && action !== 'base') return toast('Camera pinned · remote controls stay with the foreground app');
  await windowHandoff.run(async () => {
    if (action === 'browse') await pip.browse();
    else if (action === 'shrink') await pip.shrink();
    else await pip.focus(action);
  }, () => { hidePanel(false); hideLauncher(); });
}

function resizePanel(keyboard: boolean): void {
  if (!panelWin || panelWin.isDestroyed()) return;
  // Keep the transparent overlay screen-sized without native fullscreen.
  // KWin's native-fullscreen transparent surfaces can lose their painted frame.
  if (!DEMO) panelWin.setBounds(screen.getPrimaryDisplay().bounds);
}

async function openKeyboard(): Promise<void> {
  pointer.stop();
  if (!panelOpen()) await openPanel();
  if (!panelReturnTo || !panelWin || !panelOpen()) return toast('Open an app and select a text field first');
  keyboardTarget = panelReturnTo;
  resizePanel(true);
  panelWin.webContents.send('keyboard', true);
}

/** The name of the app in front, for the remote guide. */
async function appNameFor(windowId: string | null): Promise<string | undefined> {
  const byWindow = await apps.appForWindow(windowId);
  return (byWindow ?? (apps.lastAppId ? apps.get(apps.lastAppId) : undefined))?.name;
}

// ---- watchdog --------------------------------------------------------------
/** An app the launcher opened lost its windows. Only take over the screen if that app was what the user was looking at. */
async function appGone(id: string, seen: boolean): Promise<void> {
  if (apps.lastAppId !== id) return; // not the current app: forget it quietly
  const inFront = await apps.appForWindow(await wm.activeWindow());
  if (inFront && inFront.id !== id) return; // the user is already in another app of ours
  const name = apps.get(id)?.name ?? id;
  toast(seen ? `${name} closed` : `${name} didn’t open`);
  await goHome();
}

// ---- remote buttons --------------------------------------------------------
async function onAction(action: GlobalAction): Promise<void> {
  if (quitting) return;
  if (action === 'back' && buttonTesting) return;
  if (!debouncer.allow(action)) return;
  if (pointer.active) {
    pointer.stop();
    if (action === 'back') return toast('Normal remote controls');
  }
  const state = { launcherInFront: launcherInFront(), panelOpen: panelOpen() };
  if (action !== 'info' && action !== 'back') guideReturnTo = null; // any other button abandons a guide opened over an app
  switch (action) {
    case 'cameraToggle':
      if (pip.state.active) { await pip.stop(); return toast('Screen-in-screen stopped'); }
      return showPipMenu();
    case 'cameraNext': {
      const state = pip.state;
      if (!state.active) return toast('Choose two apps with Red or Screen-in-screen');
      const active = await wm.activeWindow();
      const current = await apps.appForWindow(active);
      return focusPip(current?.id === state.insetId ? 'base' : 'inset');
    }
    case 'cameraCorner':
      if (!pip.state.active) return toast('Choose two apps with Red or Screen-in-screen');
      return pip.move();
    case 'blue':
      if (!pip.state.active) return toast('Choose two apps with Red or Screen-in-screen');
      return pip.resize();
    case 'back': {
      // A visible panel is always on top; guides and menus live in the main window.
      if (state.panelOpen) {
        panelWin!.webContents.send('action', { action, context: 'panel' } satisfies ActionEvent);
        return;
      }
      if (state.launcherInFront) {
        sendAction({ action, context: 'home' });
        return;
      }
      const active = await wm.activeWindow();
      const current = await apps.appForWindow(active);
      // Nod.ie's avatar has no page history: Back returns to Sofa, without
      // closing the assistant or changing microphone/camera state.
      if (current?.type === 'camera') return goHome();
      if (current?.id === 'nodie') {
        const title = active ? await windowTitle(active) : '';
        if (title !== 'Nod.ie Settings') return goHome();
      }
      const key = backKeyFor(current ?? undefined);
      if (current?.type === 'web' && active) {
        await backToWebApp(key, active, { sendKeys: sendKeysToApp, watchHome: watchHomeRequest, activeWindow: () => wm.activeWindow(), goHome });
      } else await sendKeysToApp(key);
      return;
    }
    case 'home':
      return goHome();
    case 'menu':
      if (decideMenu(state) === 'close-panel') return hidePanel(true);
      if (decideMenu(state) === 'open-panel') return openPanel();
      await showHome();
      sendAction({ action, context: 'home' });
      return;
    case 'power':
      await showHome();
      sendAction({ action, context: 'home' });
      return;
    case 'info': {
      const context: ActionContext = contextFor(state);
      if (context === 'home') {
        // On the home screen Info toggles the guide; the renderer calls guideClosed(),
        // which returns to the app a previous Info press came from, if any.
        sendAction({ action, context });
        return;
      }
      const back = context === 'panel' ? panelReturnTo : await wm.activeWindow();
      const appName = await appNameFor(back);
      await showHome();
      guideReturnTo = back;
      sendAction({ action, context, appName });
      return;
    }
    case 'nodieTalk': {
      const nodie = config.apps.find((a) => a.hotkeys.talk);
      if (!nodie) return toast('Nod.ie isn’t set up');
      await sendKeysToApp(nodie.hotkeys.talk!).then(
        (sent) => { if (sent) toast('🎤 Nod.ie listening'); }, () => toast('Couldn’t reach Nod.ie'),
      );
      return;
    }
    case 'input':
      if (keyboardTarget) return hidePanel(true);
      return openKeyboard();
    case 'spareE': {
      if (state.launcherInFront || state.panelOpen) return toast('E turns subtitles on/off while watching a video');
      const target = await apps.appForWindow(await wm.activeWindow());
      const key = target?.hotkeys.subtitles;
      if (!key) return toast('Subtitles are not available in this app');
      await sendKeysToApp(key).catch(() => toast('Could not reach the subtitle control'));
      return;
    }
    default:
      toast('Coming soon: camera and spare buttons arrive in a later milestone');
  }
}

async function showPipMenu(): Promise<void> {
  const generation = ++pipStartGeneration;
  // Read the current app before bringing Sofa forward (including panel actions).
  const current = await apps.appForWindow(panelReturnTo ?? await wm.activeWindow());
  if (generation !== pipStartGeneration) return;
  await showHome();
  if (generation !== pipStartGeneration) return;
  sendAction({ action: 'cameraToggle', context: 'home', appId: current?.id });
}

async function startPip(baseId: string, insetId: string): Promise<{ ok: boolean; message?: string }> {
  if (DEMO) return { ok: false, message: 'Screen-in-screen needs two real app windows on an X11 desktop' };
  if (baseId === insetId || !apps.get(baseId) || !apps.get(insetId)) return { ok: false, message: 'Choose two different apps' };
  const generation = ++pipStartGeneration;
  pointer.stop();
  try {
    await pip.stop();
    for (const id of [baseId, insetId]) {
      if (generation !== pipStartGeneration) return { ok: false, message: 'Cancelled' };
      const result = await apps.open(id, { pausePrevious: false });
      if (!result.ok) return { ok: false, message: result.message ?? `${apps.get(id)?.name ?? 'App'} couldn’t open` };
    }
    if (generation !== pipStartGeneration) return { ok: false, message: 'Cancelled' };
    const base = apps.get(baseId)!;
    const inset = apps.get(insetId)!;
    const baseWindows = await wm.findByClass(base.wmClass);
    const insetWindows = await wm.findByClass(inset.wmClass);
    const baseWindow = baseWindows.at(-1);
    const insetWindow = insetWindows.at(-1);
    if (!baseWindow || !insetWindow) throw new Error('One of the app windows closed');
    if (generation !== pipStartGeneration) return { ok: false, message: 'Cancelled' };
    // Keep Sofa covering the desktop while KWin changes both app geometries.
    await showHome();
    if (generation !== pipStartGeneration) return { ok: false, message: 'Cancelled' };
    // Electron reports DIP; EWMH geometry uses physical X11 pixels. Convert
    // the origin separately so mixed-scale display arrangements stay correct.
    const display = screen.getDisplayMatching(win!.getBounds());
    const origin = screen.dipToScreenPoint(display.bounds);
    const physicalBounds = { ...origin, width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
    await pip.start({ appId: baseId, name: base.name, windowId: baseWindow }, { appId: insetId, name: inset.name, windowId: insetWindow, camera: inset.type === 'camera' }, physicalBounds);
    if (generation !== pipStartGeneration) { await pip.stop(); return { ok: false, message: 'Cancelled' }; }
    hidePanel(false);
    hideLauncher();
    toast(`${inset.name} over ${base.name} · Green switches remote · ${volumeKeys.length === 3 ? 'Volume/mute control the selected app' : 'Use app audio in the screen-in-screen menu; volume keys still control the system'} · Yellow moves · Blue resizes · Red stops`);
    return { ok: true };
  } catch (error) {
    await pip.stop();
    await showHome();
    const message = (error as Error).message || 'Couldn’t start screen-in-screen';
    toast(message);
    return { ok: false, message };
  }
}

async function onTransport(command: TransportCommand): Promise<void> {
  if (quitting || Date.now() - lastTransport < 300) return;
  lastTransport = Date.now();
  if (pip.pinned && !pip.state.baseId) {
    toast('Main app closed; open an app to control it');
    return;
  }
  let target = panelOpen() ? panelReturnTo : await wm.activeWindow();
  const lastId = pip.state.active ? (pip.state.focused === 'inset' ? pip.state.insetId : pip.state.baseId) : apps.lastAppId;
  if (launcherInFront() && lastId) {
    const current = apps.get(lastId);
    if (current) target = (await wm.findByClass(current.wmClass)).at(-1) ?? null;
  }
  const current = await apps.appForWindow(target);
  if (!current || !target) return mediaKeys.desktopFallback(command).catch(() => {});
  // Games get no player commands: a stray pause or key in a game is worse than none.
  if (current.type === 'camera' || current.id === 'nodie' || current.group === 'games') return;
  if (current.brand === 'tidal' && target === await wm.activeWindow()) {
    const key = { PlayPause:'F9', Stop:'F7', Next:'F10', Previous:'F11' }[command];
    await sendKeysToApp(`ctrl+shift+${key}`);
    return;
  }
  if (!await media.controlWindow(target, command, { flatpakId: current.flatpak })) toast(`${current.name} has no player ready`);
}

function registerButtons(): void {
  pointer.stop();
  globalShortcut.unregisterAll();
  if (DEMO || buttonTesting) return; // never grab keys in demo mode; the button test wants raw keys
  const failed: string[] = [];
  for (const [action, accel] of Object.entries(config.buttons) as [GlobalAction, string][]) {
    try {
      if (!globalShortcut.register(accel, () => void onAction(action).catch(() => toast('Couldn’t apply that remote action')))) failed.push(`${action} (${accel})`);
    } catch {
      failed.push(`${action} (${accel})`);
    }
  }
  if (!mediaKeys.register(command => void onTransport(command).catch(() => toast('Player control unavailable')))) failed.push('player controls');
  volumeKeys.splice(0);
  volumeAttempted = false;
  syncPipVolume(pip.state);
  if (failed.length) toast(`Couldn’t claim remote buttons: ${failed.join(', ')}`);
}

/** Button test: release the global grabs so the window sees the raw keys; reclaim them after. */
function setButtonTest(active: boolean): void {
  if (buttonTesting === active) return;
  buttonTesting = active;
  registerButtons();
}

/** Force the button test off (window lost focus, renderer gone, another app opened): the remote must work. */
function leaveButtonTest(): void {
  if (!buttonTesting) return;
  setButtonTest(false);
  sendAction({ action: 'home', context: 'home' });
}

// ---- local control command -------------------------------------------------
async function openCommand({ appId, search }: OpenCommand): Promise<void> {
  pipStartGeneration++;
  const previousPair = pip.state;
  pointer.stop();
  leaveButtonTest();
  const target = apps.get(appId);
  if (!target) return toast(`Unknown app: ${appId}`);
  let url: string | undefined;
  let note: string | undefined;
  if (search) {
    if (target.type !== 'web') note = 'search is ignored for desktop apps';
    else if (await apps.isRunning(appId)) note = 'already open, so no search; close it first';
    else if (!target.searchUrl) note = 'it has no search page';
    else url = searchUrl(target, search) ?? undefined;
  }
  const result = await openApp(appId, url ? { url } : {});
  if (result.ok && panelOpen()) hidePanel(false);
  if (result.ok && previousPair.active && !pip.state.active) for (const id of [previousPair.baseId, previousPair.insetId]) if (id && id !== appId) void apps.pause(id);
  const text = [result.message ?? (note ? target.name : ''), note].filter(Boolean).join(' · ');
  if (text) toast(text);
  setTimeout(() => void pushApps(), 1500);
}

async function handleCommand(parsed: ParsedCommand): Promise<void> {
  if (!parsed) return goHome();
  if (!parsed.ok) {
    console.error(parsed.error);
    return toast(parsed.error);
  }
  return openCommand(parsed.command);
}

// ---- IPC -------------------------------------------------------------------
/** Only our own windows, showing our bundled page, may call into the main process. */
function trusted(e: IpcMainInvokeEvent): boolean {
  const ours = [win, panelWin, toastWin].some((w) => w && !w.isDestroyed() && w.webContents === e.sender);
  const url = e.senderFrame?.url ?? '';
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const fromBundle = url.startsWith(rendererFileUrl) || (!!devUrl && DEV && !app.isPackaged && url.startsWith(devUrl));
  return ours && fromBundle;
}

function handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error(`${channel}: untrusted sender`);
    return fn(e, ...args);
  });
}

function fromPanel(e: IpcMainInvokeEvent): boolean {
  return !!panelWin && e.sender === panelWin.webContents;
}

function registerIpc(): void {
  handle('launcher:appearance', () => appearance());
  handle('launcher:setTheme', async (_e, value) => {
    const theme = validateTheme(value);
    if (DEMO) throw new Error('Theme persistence is disabled in demo mode');
    writeTheme(configPath, theme);
    await loadConfig();
  });
  handle('launcher:setBackground', async (_e, value) => {
    const background = validateBackground(value);
    if (DEMO) throw new Error('Background persistence is disabled in demo mode');
    writeBackground(configPath, background);
    await loadConfig();
  });
  handle('launcher:browsers', () => ({ choice: config.ui.browser, installed: browsers.installed.map((b) => b.id), defaultBrowser: browsers.defaultBrowser?.id ?? null }));
  handle('launcher:setBrowser', async (_e, value) => {
    const browser = validateBrowser(value);
    if (DEMO) throw new Error('Browser persistence is disabled in demo mode');
    if (browser !== 'default' && !browsers.installed.some((b) => b.id === browser)) throw new Error('Browser is not installed');
    writeBrowser(configPath, browser);
    await loadConfig();
    await pushApps();
  });
  handle('launcher:overlay', (e, open) => {
    if (e.sender !== win?.webContents || typeof open !== 'boolean') throw new Error('Invalid overlay state');
    homeOverlayOpen = open; syncCameraOverlays();
  });
  handle('apps:list', () => pushApps());
  handle('apps:open', async (e, id) => {
    if (typeof id !== 'string') return { ok: false };
    pipStartGeneration++;
    const previousPair = pip.state;
    const result = await openApp(id);
    if (result.ok && previousPair.active && !pip.state.active) for (const previous of [previousPair.baseId, previousPair.insetId]) if (previous && previous !== id) void apps.pause(previous);
    if (result.message) toast(result.message);
    if (fromPanel(e)) hidePanel(false);
    setTimeout(() => void pushApps(), 1500);
    return result;
  });
  handle('apps:close', async (e, id) => {
    if (typeof id !== 'string') return;
    const target = apps.get(id);
    if (!target) return;
    pipStartGeneration++;
    await pip.closing(id);
    const closed = await apps.close(id);
    toast(closed ? `Closed ${target.name}` : `${target.name} isn’t running`);
    if (fromPanel(e)) await goHome(); // the app under the panel is gone (or never was): nothing to return to
    setTimeout(() => void pushApps(), 1500);
  });
  handle('launcher:close', async () => {
    pointer.stop();
    const generation = ++pipStartGeneration;
    await pip.stop();
    await apps.closeSession();
    // Home may have been pressed while a slow app was closing.
    if (generation === pipStartGeneration) hideLauncher();
  });
  handle('launcher:username', () => (DEMO ? 'tvuser' : userInfo().username));
  handle('launcher:logOff', async () => {
    if (DEMO) return toast('Log off is disabled in demo mode');
    try {
      await logOff(process.env.XDG_SESSION_ID, ({ file, args }) => new Promise<void>((resolve, reject) => {
        execFile(file, args, { timeout: 10_000 }, (err) => err ? reject(err) : resolve());
      }));
    } catch {
      toast('Couldn’t log off. Try again from the desktop.');
      throw new Error('Log off failed');
    }
  });
  handle('launcher:quit', () => {
    quitting = true;
    app.quit();
  });
  // Delay so the OK key-up (and any repeat) doesn't immediately wake the screen via DPMS.
  handle('launcher:screenOff', () => new Promise<void>((r) => setTimeout(() => void wm.screenOff().finally(r), 700)));
  handle('launcher:lastApp', async () => {
    if (!apps.lastAppId || !(await apps.isRunning(apps.lastAppId))) {
      toast('Nothing to go back to');
      return false;
    }
    if (pip.state.active) { await focusPip('base'); return true; }
    return (await openApp(apps.lastAppId)).ok;
  });
  handle('launcher:buttons', () => config.buttons);
  handle('launcher:about', (e): AboutInfo => {
    let sandboxed = false;
    try {
      sandboxed = sandboxReport(e.sender.getOSProcessId()).osSandboxed;
    } catch {
      /* /proc unreadable */
    }
    return { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, configPath, sandboxed };
  });
  handle('launcher:buttonTest', (_e, active) => setButtonTest(active === true));
  handle('launcher:guideClosed', () => {
    const back = guideReturnTo;
    guideReturnTo = null;
    if (back) {
      return windowHandoff.run(() => wm.activate(back), hideLauncher).catch(() => goHome());
    }
  });
  handle('panel:talk', () => onAction('nodieTalk'));
  handle('panel:pointer', async () => {
    if (DEMO) return toast('Pointer controls are disabled in demo mode');
    const target = panelReturnTo;
    if (!target || !panelOpen()) return;
    try {
      await windowHandoff.run(() => wm.activate(target), () => hidePanel(false));
      if (await wm.activeWindow() !== target) throw new Error('App lost focus');
      if (!pointer.start(target)) throw new Error('Keys unavailable');
      toast('Pointer: arrows move · OK clicks · CH +/− scroll · Back exits');
    } catch {
      pointer.stop();
      toast('Couldn’t enable pointer controls');
    }
  });
  handle('panel:guide', () => onAction('info'));
  handle('keyboard:open', () => openKeyboard());
  handle('launcher:action', (_event, action) => {
    if (typeof action !== 'string' || !['cameraToggle', 'nodieTalk', 'menu', 'info', 'power'].includes(action)) throw new Error('Unknown action');
    return onAction(action as GlobalAction);
  });
  handle('keyboard:type', async (event, text) => {
    if (!fromPanel(event) || !keyboardTarget || !panelOpen() || DEMO) throw new Error('Keyboard is not active');
    const target = keyboardTarget;
    if (typeof text !== 'string' || text.length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new Error('Invalid text');
    await windowHandoff.run(() => wm.activate(target), () => hidePanel(false));
    if (await wm.activeWindow() !== target) throw new Error('App lost focus');
    await typeText(text);
  });
  handle('keyboard:mic', (event, active) => {
    keyboardMicAllowed = fromPanel(event) && !!keyboardTarget && panelOpen() && active === true && !DEMO;
  });
  handle('keyboard:transcribe', (event, audio) => {
    if (!fromPanel(event) || !keyboardTarget || !panelOpen() || DEMO) throw new Error('Keyboard is not active');
    return transcribe(audio);
  });
  handle('panel:dismiss', () => hidePanel(true));
  handle('launcher:camera-thumbnail', async (_event, appId) => {
    if (typeof appId !== 'string' || apps.get(appId)?.type !== 'camera') return null;
    if (DEMO) return demoCameraStill(appId);
    return cameraStills.get(appId) ?? (await cameraInputs?.thumbnail(appId)) ?? null;
  });
  handle('launcher:camera-stills', () => cameraStills.stills);
  // Read-only: the view re-reads at most every 5 s (on open, `fresh` reads now).
  handle('containers:snapshot', (_event, fresh) => containerSource?.refresh(fresh === true ? 0 : 5000) ?? NOT_CONFIGURED);
  handle('launcher:game-art', (_event, appId) => (typeof appId === 'string' ? gameArt(appId) : null));
  handle('home:items', () => homeItems());
  handle('home:set', (_event, id, shown) => setHomeItem(id, shown));
  handle('pip:show', () => showPipMenu());
  handle('pip:state', () => pip.state);
  handle('pip:audio', (_event, which, action) => {
    if (!['base', 'inset'].includes(which as string) || !['get', 'up', 'down', 'mute'].includes(action as string)) throw new Error('Invalid audio control');
    return controlPipAudio(which as 'base' | 'inset', action as AudioAction);
  });
  handle('pip:nodie', async (_event, action) => {
    if (!['camera', 'mic', 'speaker'].includes(action as string) || !pip.state.active) throw new Error('Invalid Nodie control');
    const state = pip.state;
    const target = [state.baseId, state.insetId].map(id => apps.get(id!)).find(a => a?.hotkeys.camera && a.hotkeys.mic);
    if (!target) throw new Error('Nodie is not in the selected pair');
    await focusPip(target.id === state.baseId ? 'base' : 'inset');
    await sendKeysToApp(target.hotkeys[action as string]!);
  });
  handle('pip:start', (_event, baseId, insetId) => {
    if (typeof baseId !== 'string' || typeof insetId !== 'string') throw new Error('Invalid app selection');
    return startPip(baseId, insetId);
  });
  handle('pip:control', async (_event, action) => {
    if (!['base', 'inset', 'browse', 'shrink', 'close-inset', 'corner', 'size', 'stop'].includes(action as string)) throw new Error('Unknown screen-in-screen control');
    if (action === 'close-inset') {
      const { baseId, insetId, pinned } = pip.state;
      const generation = ++pipStartGeneration;
      await pip.stop();
      if (generation !== pipStartGeneration) return;
      if (!pinned && insetId && !await apps.close(insetId)) toast(`Screen-in-screen stopped; ${apps.get(insetId)?.name ?? 'the second app'} could not close`);
      if (generation !== pipStartGeneration) return;
      if (pinned) { if (panelOpen()) await hidePanel(true); return; }
      if (baseId) await apps.open(baseId, { pausePrevious: false });
      if (generation !== pipStartGeneration) return;
      hidePanel(false);
      hideLauncher();
      return;
    }
    if (action === 'stop') { pipStartGeneration++; apps.navigate(); await pip.stop(); return; }
    if (action === 'corner') return pip.move();
    if (action === 'size') return pip.resize();
    return focusPip(action as 'base' | 'inset' | 'browse' | 'shrink');
  });
}

// ---- modes -----------------------------------------------------------------
async function runSelfCheck(): Promise<void> {
  const w = createWindow({ show: false });
  await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()));
  const report = sandboxReport(w.webContents.getOSProcessId());
  const ok = report.osSandboxed && !app.commandLine.hasSwitch('no-sandbox');
  console.log(JSON.stringify({ ok, electron: process.versions.electron, ...report }, null, 2));
  app.exit(ok ? 0 : 1);
}

async function runScreenshot(path: string): Promise<void> {
  const w = win!;
  await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()));
  const demoAction = flagValue('demo-action') as GlobalAction | undefined;
  if (demoAction === 'info') setTimeout(() => sendAction({ action: 'info', context: 'app', appName: 'Netflix' }), 400);
  else if (demoAction) setTimeout(() => sendAction({ action: demoAction, context: 'home' }), 400);
  await new Promise((r) => setTimeout(r, 1200));
  if (flag('demo-confirm-logout')) {
    await w.webContents.executeJavaScript(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    `);
    await new Promise((r) => setTimeout(r, 150));
    const cancelFocused = await w.webContents.executeJavaScript(`document.querySelector('.opt.f')?.textContent.trim() === 'Cancel'`);
    if (!cancelFocused) throw new Error('Logout confirmation must focus Cancel');
  }
  const renderedTheme = await w.webContents.executeJavaScript('document.documentElement.dataset.theme');
  if (renderedTheme !== config.ui.theme) throw new Error('Renderer must apply the configured theme');
  if (!DEMO_SCREEN) {
    const renderedBackground = await w.webContents.executeJavaScript('document.documentElement.dataset.background');
    if (renderedBackground !== config.ui.background) throw new Error('Home must apply the configured background');
  }
  if (!DEMO_SCREEN?.startsWith('panel')) {
    const version = await w.webContents.executeJavaScript("document.querySelector('.version')?.textContent");
    if (version !== `v${app.getVersion()}`) throw new Error('Home must display the app version');
  }
  if (DEMO_SCREEN === 'panel-pip') {
    if (!await w.webContents.executeJavaScript("!!document.querySelector('.panel:not(.screen-selecting)') && !!Array.from(document.querySelectorAll('.actions button')).find(b => b.textContent.includes('Close second screen'))")) throw new Error('Menu must initially expose the bottom panel and inset close action');
    for (const [key, expected] of [
      ['ArrowUp', '.main-screen.selected'], ['ArrowRight', '.inset-screen.selected'],
      ['ArrowDown', '.panel:not(.screen-selecting)'], ['ArrowUp', '.inset-screen.selected'],
      ['ArrowLeft', '.main-screen.selected'], ['ArrowRight', '.inset-screen.selected'],
    ]) {
      await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', {key: '${key}', cancelable:true}));`);
      await new Promise(r => setTimeout(r, 50));
      if (!await w.webContents.executeJavaScript(`!!document.querySelector('${expected}')`)) throw new Error('Directional screen selection failed: ' + key);
    }
    console.log('Directional inset selection and panel return verified');
  }
  if (DEMO_SCREEN === 'camera-home') {
    const press = async (key: string) => {
      await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},cancelable:true}));`);
      await new Promise(r => setTimeout(r, 30));
    };
    const focused = (row: string, text: string) => w.webContents.executeJavaScript(`!!document.querySelector('.${row} .focused')?.textContent.includes(${JSON.stringify(text)})`);
    const games = flag('demo-games');
    await press('ArrowDown');
    if (games) {
      if (!await focused('game-row', 'Roblox')) throw new Error('Down must reach the games, configured games first');
      await press('ArrowDown');
    }
    if (!await focused('camera-row', 'All cameras')) throw new Error('Down must reach the camera inputs');
    for (let i=0;i<9;i++) await press('ArrowRight');
    if (!await w.webContents.executeJavaScript("document.querySelector('.camera-row').scrollLeft > 0")) throw new Error('Camera inputs must scroll with remote focus');
    await press('ArrowDown');
    if (!await w.webContents.executeJavaScript("document.querySelector('.footer-button.focused')?.textContent.includes('Power')")) throw new Error('Down from cameras must reach Power');
    await press('ArrowUp'); await press('ArrowUp');
    if (games) {
      if (!await focused('game-row', 'Paper Planets')) throw new Error('Up from cameras must reach the last game');
      if (!await w.webContents.executeJavaScript("document.querySelector('.game-row').scrollLeft > 0")) throw new Error('Games must scroll with remote focus');
      await press('ArrowUp');
      if (!await focused('app-row', 'Audible')) throw new Error('Up must return through games to apps');
    } else if (!await focused('app-row', 'TIDAL')) throw new Error('Up must return through cameras to apps');
    for (let i=0;i<9;i++) await press('ArrowLeft');
    await press('ArrowDown');
    await press('ArrowUp');
    for (let i=0;i<6;i++) await press('ArrowRight');
    if (!await focused('app-row', 'Nodie')) throw new Error('Photo tile focus must be visible');
    if (await w.webContents.executeJavaScript("document.documentElement.scrollHeight > innerHeight || document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight")) throw new Error('Home must fit without vertical scrolling');
    console.log(`Apps, ${games ? 'games, ' : ''}cameras, horizontal scrolling, footer navigation and photo tile focus verified`);
  }
  if (!DEMO_SCREEN && flag('demo-games') && !flagValue('demo-keys')) {
    // Games, no cameras: the Apps grid wraps above the Games row; every direction and the footer must work.
    const press = async (key: string) => {
      await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},cancelable:true}));`);
      await new Promise(r => setTimeout(r, 30));
    };
    const js = (code: string) => w.webContents.executeJavaScript(code) as Promise<unknown>;
    const focused = (row: string, text: string) => js(`!!document.querySelector('.${row} .focused')?.textContent.includes(${JSON.stringify(text)})`);
    if (!await js("!!document.querySelector('main.wrapped')")) throw new Error('Games without cameras must wrap the apps');
    if (!await js("(() => { const s = [...document.querySelectorAll('.app-row > .app-slot')]; return s.length > 6 && s[6].getBoundingClientRect().top > s[0].getBoundingClientRect().bottom; })()")) throw new Error('Apps must wrap onto a second row');
    await press('ArrowDown');
    if (!await focused('app-row', 'Nodie')) throw new Error('Down must move within the Apps grid');
    await press('ArrowDown');
    if (!await focused('game-row', 'Roblox')) throw new Error('Down from the last Apps row must reach the Games row');
    for (let i = 0; i < 7; i++) await press('ArrowRight');
    if (!await focused('game-row', 'Paper Planets')) throw new Error('Right must reach the last game');
    if (!await js("document.querySelector('.game-row').scrollLeft > 0")) throw new Error('Games must scroll with remote focus');
    await press('ArrowDown');
    if (!await js("!!document.querySelector('.footer-button.focused')?.textContent.includes('Power')")) throw new Error('Down from the Games row must reach the footer');
    await press('ArrowUp');
    if (!await focused('game-row', 'Paper Planets')) throw new Error('Up from the footer must return to the game');
    await press('ArrowUp');
    if (!await focused('app-row', 'TIDAL')) throw new Error('Up from a game must reach the last Apps row');
    await press('ArrowUp');
    if (!await focused('app-row', 'Prime Video')) throw new Error('Up must move within the Apps grid');
    for (let i = 0; i < 6; i++) await press('ArrowLeft');
    if (!await focused('app-row', 'Jellyfin')) throw new Error('Left must reach the first app');
    for (const [selector, what] of [['.app-row', 'Apps'], ['.game-row', 'Games']]) {
      if (!await js(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); const f = document.querySelector('footer').getBoundingClientRect(); return r.top >= 0 && r.bottom <= f.top + 1; })()`)) throw new Error(`${what} must sit above the footer, unclipped`);
    }
    if (await js("document.documentElement.scrollHeight > innerHeight || document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight")) throw new Error('Home must fit without vertical scrolling');
    await js("document.querySelector('.game-row').scrollLeft = 0"); // picture the row from its start
    console.log('Wrapped apps, games row, sideways scrolling and footer navigation verified');
  }
  if (DEMO_SCREEN === 'edit-home') {
    // Edit home screen: OK hides the focused tile and the home screen behind updates at once.
    const js = (code: string) => w.webContents.executeJavaScript(code) as Promise<unknown>;
    await new Promise(r => setTimeout(r, 300));
    if (!await js("document.querySelectorAll('.choice').length > 0 && !!document.querySelector('.choice.f')")) throw new Error('Edit home screen must list items with one focused');
    if (!await js("[...document.querySelectorAll('.choice')].some(c => c.textContent.includes('Not installed'))")) throw new Error('A missing program must be marked not installed');
  }
  // --demo-keys=ArrowRight,ArrowRight,Enter presses keys before the capture, to picture a state.
  for (const key of (flagValue('demo-keys') ?? '').split(',').filter((k) => /^[A-Za-z0-9]+$/.test(k))) {
    await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, cancelable: true }))`);
    await new Promise((r) => setTimeout(r, 80));
  }
  if (flagValue('demo-keys')) await new Promise((r) => setTimeout(r, 400)); // let smooth scrolling settle
  // Only the Settings menu itself (optionally with the Browser list open); other --demo-keys
  // paths open different pickers.
  if (DEMO_SCREEN === 'menu' && [undefined, '', 'ArrowDown,ArrowDown,Enter'].includes(flagValue('demo-keys'))) {
    const fits = await w.webContents.executeJavaScript(`(() => {
      const menu = document.querySelector('.menu');
      const rect = menu?.getBoundingClientRect();
      return !!rect && rect.top >= 0 && rect.bottom <= innerHeight && menu.scrollHeight <= menu.clientHeight && menu.scrollWidth <= menu.clientWidth;
    })()`);
    if (!fits) throw new Error('Settings and browser choices must fit without scrolling or clipping');
    console.log('Settings layout fits without scrolling or clipping');
  }
  const image = await w.webContents.capturePage();
  const out = resolve(path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, image.toPNG());
  console.log(`screenshot written: ${out}`);
  if (DEMO_SCREEN === 'menu' && flagValue('demo-keys') === 'ArrowDown,ArrowDown,Enter') {
    if (!await w.webContents.executeJavaScript(`document.querySelector('[aria-label="Browser"]')?.textContent.includes('System default (Microsoft Edge)') && [...document.querySelectorAll('.opt')].map(b => b.textContent.trim()).join('|') === 'System default (Microsoft Edge)|Microsoft Edge|Google Chrome'`)) throw new Error('Demo browser choices must list only the default, Edge and Chrome');
    await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));`);
    await new Promise((r) => setTimeout(r, 80));
    if (!await w.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Couldn’t save browser. Try again?"]')`)) throw new Error('Demo browser changes must refuse persistence');
    await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));`);
    await new Promise((r) => setTimeout(r, 80));
    if (!await w.webContents.executeJavaScript(`document.querySelector('[aria-label="Settings"] .opt.f')?.textContent.includes('Browser')`)) throw new Error('Browser Back must restore Settings focus');
    console.log('Browser arrows, OK, demo persistence refusal and Back verified');
  }
  if (DEMO_SCREEN === 'pip') {
    await w.webContents.executeJavaScript(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    `);
    await new Promise((r) => setTimeout(r, 100));
    const chooserValid = await w.webContents.executeJavaScript(`
      document.querySelector('.pip-chooser p')?.textContent.includes('2 ·') &&
      document.querySelector('.pip-chooser p')?.textContent.includes('Jellyseerr') &&
      !Array.from(document.querySelectorAll('.pip-chooser button')).some((b) => b.textContent.includes('Jellyseerr'))
    `);
    if (!chooserValid) throw new Error('Screen-in-screen must choose a main app and exclude it from the inset choices');
    await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));`);
    await new Promise((r) => setTimeout(r, 100));
    const backValid = await w.webContents.executeJavaScript(`document.querySelector('.pip-chooser p')?.textContent.includes('1 ·')`);
    if (!backValid) throw new Error('Back must return to main-app selection');
    sendAction({ action: 'home', context: 'home' });
    await new Promise(r => setTimeout(r, 50));
    sendAction({ action: 'cameraToggle', context: 'app', appId: 'youtube' });
    await new Promise(r => setTimeout(r, 100));
    const inferred = await w.webContents.executeJavaScript(`!document.querySelector('.pip-chooser p')?.textContent.includes('2 ·') && document.querySelector('.pip-chooser p')?.textContent.includes('Choose what to show over YouTube') && !Array.from(document.querySelectorAll('.pip-chooser button')).some(b => b.textContent.includes('YouTube'))`);
    if (!inferred) throw new Error('Screen-in-screen must infer the current app and only ask for the second');
    await w.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',cancelable:true}));`);
    if (await w.webContents.executeJavaScript("!!document.querySelector('.pip-chooser')")) throw new Error('Back must cancel a one-step inset chooser');
    console.log('Screen-in-screen remote chooser verified');
  }
  if (DEMO_SCREEN === 'containers' && !flagValue('demo-keys')) await verifyContainersView(w.webContents);
  // Exercise the real renderer after each capture: Home must dismiss every overlay,
  // including the Power menu's nested logout confirmation, without returning to an app.
  if (!DEMO_SCREEN?.startsWith('panel')) {
    sendAction({ action: 'home', context: 'home' });
    await new Promise((r) => setTimeout(r, 150));
    const homeVisible = await w.webContents.executeJavaScript(`
      !document.querySelector('[role="dialog"]') && !!document.querySelector('section[aria-label="Apps"]')
    `);
    if (!homeVisible) throw new Error('Home must dismiss overlays and show the app grid');
    console.log('Home overlay dismissal verified');
  }
  app.quit();
}

/** Hash route for the main window in screenshot mode (the renderer seeds demo data). */
function demoHash(): string {
  if (DEMO_SCREEN === 'panel-pip') return 'panel?demo=pip';
  if (DEMO_SCREEN === 'panel') return 'panel?demo=1';
  if (DEMO_SCREEN) return `home?demo=${encodeURIComponent(DEMO_SCREEN)}`;
  return 'home';
}

// ---- lifecycle -------------------------------------------------------------
// The command parsed from our own argv travels to the running instance as additionalData,
// so Chromium's argv rewriting never gets a look-in. The receiver re-validates it.
const lockData = flag('quit') ? { quit: true } : OWN_COMMAND ? { open: OWN_COMMAND } : undefined;
if (flag('setup-user') || flag('undo-user-setup')) {
  try {
    if (flag('setup-user') && flag('undo-user-setup')) throw new Error('Choose either --setup-user or --undo-user-setup');
    console.log(setupUser(homedir(), flag('undo-user-setup')));
    if (flag('undo-user-setup')) void mediaKeys.restore().then(() => app.exit(0), () => app.exit(1));
    else app.exit(0);
  } catch (error) {
    console.error(`User setup failed: ${(error as Error).message}`);
    app.exit(1);
  }
} else if (!SELF_CHECK && !DEMO && !app.requestSingleInstanceLock(lockData)) {
  app.quit();
} else if (flag('quit')) {
  app.exit(0);
} else {
  app.on('second-instance', (_e, _argv, _cwd, data) => {
    if (data && typeof data === 'object' && (data as { quit?: unknown }).quit === true) return app.quit();
    if (quitting) return;
    const open = data && typeof data === 'object' ? (data as { open?: unknown }).open : undefined;
    void handleCommand(validateOpenCommand(open));
  });
  app.whenReady().then(async () => {
    if (app.isPackaged && app.commandLine.hasSwitch('no-sandbox')) {
      console.error('Refusing to run the packaged launcher with --no-sandbox.');
      return app.exit(1);
    }
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      const audioOnly = 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio';
      callback(permission === 'media' && audioOnly && keyboardMicAllowed && !!keyboardTarget && panelOpen() && wc === panelWin?.webContents);
    });
    if (SELF_CHECK) return runSelfCheck();
    await loadConfig();
    if (!DEMO) await mediaKeys.prepare();
    registerIpc();
    win = createWindow({ show: true, hash: demoHash() });
    win.on('show', syncCameraOverlays);
    win.on('hide', syncCameraOverlays);
    win.on('show', syncCameraStills);
    win.on('hide', syncCameraStills);
    if (!SCREENSHOT) {
      toastWin = createOverlay('toast');
      toastWin.on('show', syncCameraOverlays);
      toastWin.on('hide', syncCameraOverlays);
      toastWin.webContents.once('did-finish-load', () => {
        toastReady = true;
        for (const t of pendingToasts.splice(0)) toast(t);
      });
      panelWin = createOverlay('panel');
      panelWin.on('show', syncCameraOverlays);
      panelWin.on('hide', syncCameraOverlays);
      panelWin.on('hide', () => {
        if (win && !win.isDestroyed() && !win.isVisible()) void pushApps();
      });
      // A panel that lost focus is stale: hide it, so the next Menu press opens a fresh panel.
      panelWin.on('blur', () => {
        if (panelOpen() && !windowHandoff.active && Date.now() - panelShownAt > 500) hidePanel(false);
      });
    }
    win.webContents.once('did-finish-load', () => {
      syncCameraStills();
      if (configError) toast(configError);
      registerButtons();
    });
    // Home and its listeners exist before this optional X11 enhancement is prepared.
    if (!DEMO) launchCoverWin = await prepareLaunchCover(wm, lockDown);
    if (SCREENSHOT) return runScreenshot(SCREENSHOT);
    if (OWN_COMMAND) setTimeout(() => void handleCommand(OWN_COMMAND), 500);
    if (!DEMO) try {
      let homeTimer: NodeJS.Timeout | undefined;
      watch(configDir, (_ev, file) => {
        if (file === HOME_FILE) {
          // Our own saves land here too: re-read quietly.
          clearTimeout(homeTimer);
          homeTimer = setTimeout(() => { homeChoices = readHomeVisibility(homePath); applyHome(); void pushApps(); }, 300);
          return;
        }
        if (file !== 'config.toml') return;
        // Editors save atomically (several events, sometimes a half-written file): settle first.
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
          await loadConfig();
          registerButtons();
          void pushApps();
          toast(configError ?? 'Settings reloaded');
        }, 300);
      });
    } catch {
      /* config dir may not be watchable; reload on restart instead */
    }
    setInterval(() => {
      // Only while the launcher is in front: no xdotool churn during video.
      if (launcherInFront()) void pushApps();
      syncCameraStills();
      void pip.check();
    }, 3000);
    if (!DEMO) watchdog.start();
  });
  let cleanupFinished = false;
  let cleanupStarted = false;
  app.on('before-quit', (event) => {
    quitting = true;
    coverLaunch.cancel();
    pointer.stop();
    if (cleanupFinished || DEMO || SELF_CHECK) return;
    event.preventDefault();
    if (!cleanupStarted) {
      // Only one cleanup pass, even if Quit is pressed repeatedly.
      cleanupStarted = true;
      pipStartGeneration++;
      void pip.stop().then(() => apps.closeSession()).finally(async () => {
        await mediaKeys.restore().catch(() => console.error('Could not restore desktop media shortcuts; use --undo-user-setup to retry'));
        cleanupFinished = true;
        app.quit();
      });
    }
  });
  app.on('will-quit', () => {
    cameraInputs?.dispose();
    watchdog.stop();
    globalShortcut.unregisterAll();
  });
  app.on('window-all-closed', () => {
    // Normal Close only hides our windows, so this is an actual teardown (for
    // example Electron handling SIGTERM). Do not retain a windowless lock owner.
    if (!quitting) app.quit();
  });
}
