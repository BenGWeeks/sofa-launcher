import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppearanceState, Toast, ToastApi } from '@shared/types';

/** Least privilege: the toast window can read appearance and listen for toasts. */
const api: ToastApi = {
  appearance: () => ipcRenderer.invoke('launcher:appearance'),
  onAppearance: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: AppearanceState) => cb(payload);
    ipcRenderer.on('appearance', listener);
    return () => ipcRenderer.removeListener('appearance', listener);
  },
  onToast: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: Toast) => cb(payload);
    ipcRenderer.on('toast', listener);
    return () => ipcRenderer.removeListener('toast', listener);
  },
};

contextBridge.exposeInMainWorld('sofa', api);
