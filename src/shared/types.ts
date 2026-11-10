/** Data shared between the main process and the renderer (over IPC). */

import type { Background } from './backgrounds';
export type { Background };
export type Theme = 'knowall' | 'nodie';
export interface AppearanceState { theme: Theme; background: Background; version: string; hostname?: string }

export type AppType = 'web' | 'desktop' | 'camera' | 'containers';

/** Visual style for a tile: a CSS "brand" wordmark, or an image. */
export interface TileLook {
  brand?: string;
  image?: string;
}

export interface TileState extends TileLook {
  id: string;
  name: string;
  type: AppType;
  running: boolean;
  installed: boolean;
  /** "games": the home screen's Games row (no 1-9 number, not in the panel or screen-in-screen lists). */
  group?: 'games';
  /** Docker tile: the worst container status (red, amber, green), when known. */
  status?: 'red' | 'amber' | 'green';
}

/** The home screen's three sections, as listed by Edit home screen. */
export type HomeSection = 'apps' | 'games' | 'cameras';

/** One tile in Edit home screen. */
export interface HomeItem extends TileState {
  section: HomeSection;
  /** On the home screen now. */
  shown: boolean;
  /** Why it can't be switched on: its program is missing, or config.toml must give it a URL first. */
  unavailable?: 'not-installed' | 'needs-setup';
}

export interface HomeItems {
  items: HomeItem[];
  /** One-line explanations shown instead of an empty section. */
  notes: Partial<Record<HomeSection, string>>;
}

export type GlobalAction =
  | 'back'
  | 'home'
  | 'power'
  | 'cameraToggle'
  | 'cameraNext'
  | 'cameraCorner'
  | 'blue'
  | 'nodieTalk'
  | 'info'
  | 'menu'
  | 'input'
  | 'spareE';

/** Where the user was when a global button was pressed (drives the remote guide). */
export type ActionContext = 'home' | 'app' | 'panel';

/** A remote button press forwarded to the launcher window. */
export interface ActionEvent {
  action: GlobalAction;
  context: ActionContext;
  /** The app in front (or the one the panel is over), if any. */
  appName?: string;
  /** Main app inferred before opening the screen-in-screen chooser. */
  appId?: string;
}

export interface Toast {
  text: string;
}

/** What the slide-up panel shows. */
export interface PanelState {
  apps: TileState[];
  pip?: PipState;
  /** The app whose window the panel is over, if it's one of ours. */
  currentAppId: string | null;
}

export interface PipState {
  pinned?: boolean;
  active: boolean;
  focused?: 'base' | 'inset';
  baseId?: string;
  insetId?: string;
  corner?: number;
  size?: number;
  expanded?: boolean;
}

export interface AboutInfo {
  version: string;
  electron: string;
  chrome: string;
  configPath: string;
  /** OS-level sandbox evidence for this renderer (see --self-check). */
  sandboxed: boolean;
}

/** The API the preload script exposes to the renderer as window.sofa. */
export interface SofaApi {
  appearance(): Promise<AppearanceState>;
  browsers(): Promise<import('./browsers').BrowserState>;
  setBrowser(browser: import('./browsers').BrowserChoice): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  setBackground(background: Background): Promise<void>;
  onAppearance(cb: (state: AppearanceState) => void): () => void;
  listApps(): Promise<TileState[]>;
  openApp(id: string): Promise<{ ok: boolean; message?: string }>;
  closeApp(id: string): Promise<void>;
  closeLauncher(): Promise<void>;
  screenOff(): Promise<void>;
  username(): Promise<string>;
  logOff(): Promise<void>;
  quit(): Promise<void>;
  returnToLastApp(): Promise<boolean>;
  /** The configured accelerator per global action ([buttons] in config.toml). */
  buttons(): Promise<Record<GlobalAction, string>>;
  about(): Promise<AboutInfo>;
  /** Button test: release / reclaim the global shortcuts so raw keys reach the window. */
  buttonTest(active: boolean): Promise<void>;
  /** Remote guide closed; main returns to the app it was opened over, if any. */
  overlayChanged(open: boolean): Promise<void>;
  guideClosed(): Promise<void>;
  /** Slide-up panel: dismiss and re-activate the window it was opened over. */
  panelDismiss(): Promise<void>;
  panelTalk(): Promise<void>;
  panelGuide(): Promise<void>;
  panelPointer(): Promise<void>;
  keyboardOpen(): Promise<void>;
  activateAction(action: 'cameraToggle' | 'nodieTalk' | 'menu' | 'info' | 'power'): Promise<void>;
  keyboardType(text: string): Promise<void>;
  keyboardMic(active: boolean): Promise<void>;
  keyboardTranscribe(audio: Uint8Array): Promise<string>;
  onKeyboard(cb: (visible: boolean) => void): () => void;
  onApps(cb: (apps: TileState[]) => void): () => void;
  onAction(cb: (e: ActionEvent) => void): () => void;
  onLaunchCover(cb: (covered: boolean) => void): () => void;
  onToast(cb: (toast: Toast) => void): () => void;
  onPanel(cb: (state: PanelState) => void): () => void;
  /** A small recent still of a camera input (data URL), or null if unavailable. */
  cameraThumbnail(appId: string): Promise<string | null>;
  /** A game's artwork as a small JPEG data URL, or null if it has none (yet: see onGameArt). */
  gameArt(appId: string): Promise<string | null>;
  /** Artwork that arrived later (downloaded from Steam). */
  onGameArt(cb: (art: { appId: string; value: string }) => void): () => void;
  /** Everything Edit home screen can show or hide. */
  homeItems(): Promise<HomeItems>;
  /** Show or hide one item on the home screen (saved at once). */
  setHomeItem(id: string, shown: boolean): Promise<{ ok: boolean; message?: string; items: HomeItems }>;
  pipShow(): Promise<void>;
  pipState(): Promise<PipState>;
  pipStart(baseId: string, insetId: string): Promise<{ ok: boolean; message?: string }>;
  pipControl(action: 'base' | 'inset' | 'browse' | 'shrink' | 'close-inset' | 'corner' | 'size' | 'stop'): Promise<void>;
  pipAudio(which: 'base' | 'inset', action: 'get' | 'up' | 'down' | 'mute'): Promise<{ available: boolean; volume: number; muted: boolean }>;
  pipNodie(action: 'camera' | 'mic' | 'speaker'): Promise<void>;
  onPip(cb: (state: PipState) => void): () => void;
}

/** The toast window's preload exposes only this. */
export type ToastApi = Pick<SofaApi, 'onToast' | 'appearance' | 'onAppearance'>;
