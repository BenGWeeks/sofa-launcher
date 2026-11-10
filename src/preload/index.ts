import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppearanceState, AboutInfo, ActionEvent, GlobalAction, PanelState, PipState, SofaApi, TileState, Toast } from '@shared/types';
import type { ContainersApi } from '@shared/containers';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: SofaApi = {
  appearance: () => ipcRenderer.invoke('launcher:appearance'),
  browsers: () => ipcRenderer.invoke('launcher:browsers'),
  setBrowser: (browser) => ipcRenderer.invoke('launcher:setBrowser', browser),
  setTheme: (theme) => ipcRenderer.invoke('launcher:setTheme', theme),
  setBackground: (background) => ipcRenderer.invoke('launcher:setBackground', background),
  onAppearance: (cb) => subscribe<AppearanceState>('appearance', cb),
  listApps: () => ipcRenderer.invoke('apps:list'),
  openApp: (id) => ipcRenderer.invoke('apps:open', id),
  closeApp: (id) => ipcRenderer.invoke('apps:close', id),
  closeLauncher: () => ipcRenderer.invoke('launcher:close'),
  username: () => ipcRenderer.invoke('launcher:username'),
  logOff: () => ipcRenderer.invoke('launcher:logOff'),
  screenOff: () => ipcRenderer.invoke('launcher:screenOff'),
  quit: () => ipcRenderer.invoke('launcher:quit'),
  returnToLastApp: () => ipcRenderer.invoke('launcher:lastApp'),
  buttons: () => ipcRenderer.invoke('launcher:buttons') as Promise<Record<GlobalAction, string>>,
  about: () => ipcRenderer.invoke('launcher:about') as Promise<AboutInfo>,
  buttonTest: (active) => ipcRenderer.invoke('launcher:buttonTest', active === true),
  overlayChanged: (open) => ipcRenderer.invoke('launcher:overlay', open),
  guideClosed: () => ipcRenderer.invoke('launcher:guideClosed'),
  panelTalk: () => ipcRenderer.invoke('panel:talk'),
  panelGuide: () => ipcRenderer.invoke('panel:guide'),
  panelPointer: () => ipcRenderer.invoke('panel:pointer'),
  keyboardOpen: () => ipcRenderer.invoke('keyboard:open'),
  activateAction: (action) => ipcRenderer.invoke('launcher:action', action),
  keyboardType: (text) => ipcRenderer.invoke('keyboard:type', text),
  keyboardMic: (active) => ipcRenderer.invoke('keyboard:mic', active),
  keyboardTranscribe: (audio) => ipcRenderer.invoke('keyboard:transcribe', audio),
  onKeyboard: (cb) => subscribe<boolean>('keyboard', cb),
  panelDismiss: () => ipcRenderer.invoke('panel:dismiss'),
  onApps: (cb) => subscribe<TileState[]>('apps', cb),
  onAction: (cb) => subscribe<ActionEvent>('action', cb),
  onLaunchCover: (cb) => subscribe<boolean>('launch-cover', cb),
  onToast: (cb) => subscribe<Toast>('toast', cb),
  onPanel: (cb) => subscribe<PanelState>('panel', cb),
  cameraThumbnail: (appId) => ipcRenderer.invoke('launcher:camera-thumbnail', appId),
  gameArt: (appId) => ipcRenderer.invoke('launcher:game-art', appId),
  onGameArt: (cb) => subscribe<{ appId: string; value: string }>('game-art', cb),
  homeItems: () => ipcRenderer.invoke('home:items'),
  setHomeItem: (id, shown) => ipcRenderer.invoke('home:set', id, shown),
  pipShow: () => ipcRenderer.invoke('pip:show'),
  pipAudio: (which, action) => ipcRenderer.invoke('pip:audio', which, action),
  pipNodie: (action) => ipcRenderer.invoke('pip:nodie', action),
  pipState: () => ipcRenderer.invoke('pip:state'),
  pipStart: (baseId, insetId) => ipcRenderer.invoke('pip:start', baseId, insetId),
  pipControl: (action) => ipcRenderer.invoke('pip:control', action),
  onPip: (cb) => subscribe<PipState>('pip', cb),
};

contextBridge.exposeInMainWorld('sofa', api);

/** The Docker containers view: read-only status, nothing else. */
const containers: ContainersApi = {
  snapshot: (fresh) => ipcRenderer.invoke('containers:snapshot', fresh === true),
  onShow: (cb) => subscribe<void>('containers:show', () => cb()),
};
contextBridge.exposeInMainWorld('sofaContainers', containers);
