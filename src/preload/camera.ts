import { contextBridge, ipcRenderer } from 'electron';
import type { CameraApi } from '@shared/camera-types';
const api: CameraApi = {
  state: () => ipcRenderer.invoke('camera:state'),
  connect: token => ipcRenderer.invoke('camera:connect', token),
  snapshot: index => ipcRenderer.invoke('camera:snapshot', index),
  start: index => ipcRenderer.invoke('camera:start', index),
  rtcOffer: (index, id, offer) => ipcRenderer.invoke('camera:rtc-offer', index, id, offer),
  rtcCandidate: (id, candidate) => ipcRenderer.invoke('camera:rtc-candidate', id, candidate),
  rtcStop: id => ipcRenderer.invoke('camera:rtc-stop', id),
  onRtc: callback => {
    const listener = (_event: unknown, value: import('@shared/camera-types').CameraRtcSignal) => callback(value);
    ipcRenderer.on('camera:rtc', listener);
    return () => ipcRenderer.removeListener('camera:rtc', listener);
  },
  media: (handle, range) => ipcRenderer.invoke('camera:media', handle, range),
  onAudio: callback => {
    const listener = (_event: unknown, value: { volume: number; muted: boolean }) => callback(value);
    ipcRenderer.on('camera:audio', listener);
    return () => ipcRenderer.removeListener('camera:audio', listener);
  },
  onResume: callback => {
    const listener = () => callback();
    ipcRenderer.on('camera:resume', listener);
    return () => ipcRenderer.removeListener('camera:resume', listener);
  },
  onPause: callback => {
    const listener = () => callback();
    ipcRenderer.on('camera:pause', listener);
    return () => ipcRenderer.removeListener('camera:pause', listener);
  },
};
contextBridge.exposeInMainWorld('sofaCamera', api);
